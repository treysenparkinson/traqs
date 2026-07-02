import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgCodeFromHeader } from "./_utils/org.js";
import { stampArray } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";

const failedAttempts = new Map(); // ip -> { count, firstAttempt }

// Use Netlify's trusted client IP for rate limiting. `x-forwarded-for` is
// client-supplied and was trivially spoofable (set a new value per request to
// get a fresh bucket), which defeated the limiter. `x-nf-client-connection-ip`
// is set by Netlify's edge and cannot be forged by the caller.
function clientIp(event) {
  const h = event.headers || {};
  return (
    h["x-nf-client-connection-ip"] ||
    h["client-ip"] ||
    h["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// Reject a client-supplied timestamp that isn't a parseable date in a sane
// window. Without this, `new Date("garbage")` yields NaN and corrupts payroll
// records (hours = NaN, date = "Invalid…".slice(0,10)).
function validTs(s) {
  if (typeof s !== "string") return false;
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return false;
  const y = new Date(t).getUTCFullYear();
  return y >= 2000 && y <= 2100;
}

function hoursElapsed(isoStart, isoEnd) {
  const ms = new Date(isoEnd) - new Date(isoStart);
  return Math.max(0, Math.round((ms / 3600000) * 100) / 100);
}

// Sum closed lunch/break ranges from a session's events. Open ranges are closed at `endIso` so
// a worker who clocks out while still on lunch/break has that final stretch excluded too.
function pausedMsFromEvents(events, endIso) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  const endMs = new Date(endIso).getTime();
  let pausedMs = 0, lunchOpen = null, breakOpen = null;
  for (const ev of events) {
    const t = new Date(ev.ts).getTime();
    if (ev.type === "lunchStart") lunchOpen = t;
    else if (ev.type === "lunchEnd" && lunchOpen != null) { pausedMs += Math.max(0, t - lunchOpen); lunchOpen = null; }
    else if (ev.type === "breakStart") breakOpen = t;
    else if (ev.type === "breakEnd" && breakOpen != null) { pausedMs += Math.max(0, t - breakOpen); breakOpen = null; }
  }
  if (lunchOpen != null) pausedMs += Math.max(0, endMs - lunchOpen);
  if (breakOpen != null) pausedMs += Math.max(0, endMs - breakOpen);
  return pausedMs;
}
function hoursElapsedMinusPauses(isoStart, isoEnd, events) {
  const totalMs = new Date(isoEnd) - new Date(isoStart);
  const netMs = totalMs - pausedMsFromEvents(events, isoEnd);
  return Math.max(0, Math.round((netMs / 3600000) * 100) / 100);
}

// Stamp entity-array writes so timeclock's server-side mutations (clock
// state on people, logged hours on tasks, punches on the clock log) advance
// lastModifiedAt and propagate through /sync. Re-reads the previous version
// to diff against (cheap: clock actions are low-frequency) so only the
// record(s) this action touched restamp. jobsessions.json is NOT a synced
// entity, so its writes stay on plain writeJson.
async function writeStampedArray(key, nextArr) {
  let prev = null;
  try { prev = await readJson(key); } catch { prev = null; }
  await writeJson(key, stampArray(nextArr, prev));
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const orgCode = orgCodeFromHeader(event);
  if (!orgCode) return err(400, "Missing or invalid X-Org-Code header");

  const peopleKey = `orgs/${orgCode}/people.json`;
  const clockKey = `orgs/${orgCode}/timeclock.json`;
  const tasksKey = `orgs/${orgCode}/tasks.json`;
  // Timestamped per-session job-clock log (one row per jobClockOut) so the app
  // can report job hours within a pay period — separate from the cumulative
  // loggedHours totals kept on each job/op in tasks.json.
  const jobSessionsKey = `orgs/${orgCode}/jobsessions.json`;

  // ── GET ──────────────────────────────────────────────────────────────────
  // Payroll-grade PII. Membership required, AND non-admins can only see
  // their own entries — admins see the whole org's history. Without this,
  // anyone guessing the org code could pull every employee's full
  // clock-in/out log.
  if (event.httpMethod === "GET") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const { personId, dataset } = Object.fromEntries(
        (event.queryStringParameters ? Object.entries(event.queryStringParameters) : [])
      );
      // `dataset=jobsessions` returns the timestamped job-clock log instead of
      // the payroll clock entries. Both are payroll-grade PII, scoped the same.
      const key = dataset === "jobsessions" ? jobSessionsKey : clockKey;
      const data = await readJson(key);
      const entries = Array.isArray(data) ? data : [];
      // Admin: optional personId filter. Non-admin: force-filter to self,
      // regardless of what `personId` they asked for.
      const scopeId = member.isAdmin ? personId : member.personId;
      const filtered = scopeId ? entries.filter(e => String(e.personId) === String(scopeId)) : entries;
      return json(200, filtered);
    } catch (e) {
      console.error("timeclock GET error:", e);
      return err(500, "Failed to read timeclock");
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }

    const { action } = body;
    if (!action) return err(400, "Missing action");

    // ── Admin actions (Bearer token, no PIN) ──────────────────────────────
    if (action === "adminClockOut" || action === "adminClockIn" || action === "adminEditEntry") {
      let _m;
      try { _m = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
      if (!_m.isAdmin) return err(403, "Admin only");

      // ── Admin Clock In ─────────────────────────────────────────────────
      if (action === "adminClockIn") {
        const { personId, clockInTime } = body;
        if (!personId) return err(400, "Missing personId");
        if (clockInTime != null && !validTs(clockInTime)) return err(400, "Invalid clockInTime");

        let people;
        try { people = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

        const personIdx = people.findIndex(p => String(p.id) === String(personId));
        if (personIdx === -1) return err(404, "Person not found");

        const person = people[personIdx];
        if (person.activeClockIn) return err(409, "Already clocked in");

        const clockIn = clockInTime || new Date().toISOString();
        people[personIdx] = { ...person, activeClockIn: { clockIn, jobRefs: [], events: [] } };
        try { await writeStampedArray(peopleKey, people); } catch { return err(500, "Failed to save people"); }

        return json(200, { ok: true, activeClockIn: people[personIdx].activeClockIn });
      }

      // ── Admin Clock Out ────────────────────────────────────────────────
      if (action === "adminClockOut") {
        const { personId, clockOutTime } = body;
        if (!personId) return err(400, "Missing personId");
        if (clockOutTime != null && !validTs(clockOutTime)) return err(400, "Invalid clockOutTime");

        let people;
        try { people = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

        const personIdx = people.findIndex(p => String(p.id) === String(personId));
        if (personIdx === -1) return err(404, "Person not found");

        const person = people[personIdx];
        if (!person.activeClockIn) return err(409, "Not currently clocked in");

        const clockOut = clockOutTime || new Date().toISOString();
        const { clockIn, jobRefs = [], events = [] } = person.activeClockIn;
        const hours = hoursElapsedMinusPauses(clockIn, clockOut, events);
        const dateStr = clockIn.slice(0, 10);

        const entry = {
          id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          personId,
          date: dateStr,
          clockIn,
          clockOut,
          hours,
          jobRefs,
          note: body.note || "",
        };

        let log;
        try { log = await readJson(clockKey) ?? []; } catch { log = []; }
        log.push(entry);
        try { await writeStampedArray(clockKey, log); } catch { return err(500, "Failed to save clock entry"); }

        people[personIdx] = { ...person, activeClockIn: null };
        try { await writeStampedArray(peopleKey, people); } catch { /* non-fatal */ }

        // Update loggedHours on each job in tasks.json
        if (jobRefs.length > 0 && hours > 0) {
          try {
            let tasks = await readJson(tasksKey) ?? [];
            tasks = tasks.map(job => {
              const ref = jobRefs.find(r => String(r.jobId) === String(job.id));
              if (!ref) return job;
              return { ...job, loggedHours: Math.round(((job.loggedHours || 0) + hours) * 100) / 100 };
            });
            await writeStampedArray(tasksKey, tasks);
          } catch { /* non-fatal */ }
        }

        return json(200, { ok: true, entry });
      }

      // ── Admin Edit Entry ───────────────────────────────────────────────
      if (action === "adminEditEntry") {
        const { entryId, clockIn, clockOut } = body;
        if (!entryId || !clockIn || !clockOut) return err(400, "Missing entryId, clockIn, or clockOut");
        if (!validTs(clockIn) || !validTs(clockOut)) return err(400, "Invalid clockIn or clockOut");

        let log;
        try { log = await readJson(clockKey) ?? []; } catch { return err(500, "Failed to read timeclock"); }

        // Confirmed punches are locked — the admin must re-open the timesheet first.
        const existing = log.find(e => e.id === entryId);
        if (!existing) return err(404, "Entry not found");
        if (existing.confirmed) return err(409, "This entry is in a confirmed timesheet. Re-open the timesheet to edit it.");

        let found = false;
        log = log.map(e => {
          if (e.id !== entryId) return e;
          found = true;
          const hours = hoursElapsed(clockIn, clockOut);
          return { ...e, clockIn, clockOut, hours, date: clockIn.slice(0, 10) };
        });

        if (!found) return err(404, "Entry not found");
        try { await writeStampedArray(clockKey, log); } catch { return err(500, "Failed to save timeclock"); }

        const updated = log.find(e => e.id === entryId);
        return json(200, { ok: true, entry: updated });
      }
    }

    // ── Confirm / Re-open Timesheet (admin only, Bearer token) ────────────────
    // Confirming stamps every completed pay-clock punch in [start, end] as
    // confirmed (confirmedAt/confirmedBy). Confirmed punches are locked from
    // edits and are the ONLY ones the accountant's pay-period hours export
    // pulls. Re-opening clears the lock so the range can be edited again.
    if (action === "confirmTimesheet" || action === "unconfirmTimesheet") {
      let _cm;
      try { _cm = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
      if (!_cm.isAdmin) return err(403, "Admin only");

      const { start, end } = body;
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRe.test(start || "") || !dateRe.test(end || "")) return err(400, "Invalid start or end date (expected YYYY-MM-DD)");
      if (start > end) return err(400, "start must be on or before end");

      let log;
      try { log = await readJson(clockKey) ?? []; } catch { return err(500, "Failed to read timeclock"); }

      const confirming = action === "confirmTimesheet";
      const stamp = new Date().toISOString();
      const by = _cm.personId || _cm.email || "admin";
      let count = 0;
      const next = log.map(e => {
        // Only completed pay-clock punches in range — not lunch/break events, not open shifts.
        if (e.eventType || !e.clockIn || !e.clockOut) return e;
        if (e.date < start || e.date > end) return e;
        count++;
        if (confirming) return { ...e, confirmed: true, confirmedAt: stamp, confirmedBy: by };
        const { confirmed, confirmedAt, confirmedBy, ...rest } = e;
        return rest;
      });

      // Nothing matched — skip the write (and dodge the empty-overwrite guard).
      if (count === 0) return json(200, { ok: true, count: 0, confirmed: confirming, start, end });

      try { await writeStampedArray(clockKey, next); } catch { return err(500, "Failed to save timeclock"); }
      return json(200, { ok: true, count, confirmed: confirming, start, end, confirmedAt: confirming ? stamp : null, confirmedBy: confirming ? by : null });
    }

    // ── Admin Lunch/Break Events (Bearer token, no PIN) ──────────────────────
    if (action === "adminLunchStart" || action === "adminLunchEnd" || action === "adminBreakStart" || action === "adminBreakEnd") {
      let _ml;
      try { _ml = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
      if (!_ml.isAdmin) return err(403, "Admin only");
      const { personId: albPersonId, ts: albTs } = body;
      if (!albPersonId) return err(400, "Missing personId");
      if (albTs != null && !validTs(albTs)) return err(400, "Invalid ts");

      let albPeople;
      try { albPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const albIdx = albPeople.findIndex(p => String(p.id) === String(albPersonId));
      if (albIdx === -1) return err(404, "Person not found");

      const albPerson = albPeople[albIdx];
      if (!albPerson.activeClockIn) return err(409, "Not currently clocked in");

      const albEvents = albPerson.activeClockIn.events || [];
      const evtType = action === "adminLunchStart" ? "lunchStart"
                    : action === "adminLunchEnd"   ? "lunchEnd"
                    : action === "adminBreakStart" ? "breakStart"
                    :                                "breakEnd";

      // Guard against doubling up the same state.
      if (evtType === "lunchStart" || evtType === "lunchEnd") {
        const lastLunch = [...albEvents].reverse().find(e => e.type === "lunchStart" || e.type === "lunchEnd");
        if (evtType === "lunchStart" && lastLunch?.type === "lunchStart") return err(409, "Already on lunch");
        if (evtType === "lunchEnd" && (!lastLunch || lastLunch.type !== "lunchStart")) return err(409, "Not on lunch");
      } else {
        const lastBreak = [...albEvents].reverse().find(e => e.type === "breakStart" || e.type === "breakEnd");
        if (evtType === "breakStart" && lastBreak?.type === "breakStart") return err(409, "Already on break");
        if (evtType === "breakEnd" && (!lastBreak || lastBreak.type !== "breakStart")) return err(409, "Not on break");
      }

      const albTimestamp = albTs || new Date().toISOString();
      albPeople[albIdx] = { ...albPerson, activeClockIn: { ...albPerson.activeClockIn, events: [...albEvents, { type: evtType, ts: albTimestamp }] } };
      try { await writeStampedArray(peopleKey, albPeople); } catch { return err(500, "Failed to save"); }

      const albEvt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId: albPersonId, date: albTimestamp.slice(0, 10), eventType: evtType, timestamp: albTimestamp };
      let albLog; try { albLog = await readJson(clockKey) ?? []; } catch { albLog = []; }
      albLog.push(albEvt); try { await writeStampedArray(clockKey, albLog); } catch { /* non-fatal */ }

      return json(200, { ok: true, event: albEvt, activeClockIn: albPeople[albIdx].activeClockIn });
    }

    // ── Job Clock In (Bearer token, no PIN) ──────────────────────────────────
    if (action === "jobClockIn") {
      let _jc;
      try { _jc = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

      const { personId: jciPersonId, jobId, panelId, opId, jobTitle, panelTitle, opTitle } = body;
      if (!jciPersonId || !jobId) return err(400, "Missing personId or jobId");
      // Non-admins can only clock themselves into jobs; admins can clock anyone.
      if (!_jc.isAdmin && String(_jc.personId) !== String(jciPersonId)) return err(403, "Can only clock yourself in");

      let jciPeople;
      try { jciPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jciIdx = jciPeople.findIndex(p => String(p.id) === String(jciPersonId));
      if (jciIdx === -1) return err(404, "Person not found");

      const jciPerson = jciPeople[jciIdx];
      if (jciPerson.activeJobClock) return err(409, "Already clocked into a job");

      const jciClockIn = new Date().toISOString();
      jciPeople[jciIdx] = { ...jciPerson, activeJobClock: { clockIn: jciClockIn, jobId, panelId, opId, jobTitle, panelTitle, opTitle } };
      try { await writeStampedArray(peopleKey, jciPeople); } catch { return err(500, "Failed to save"); }

      // Update job and sub-operation status to "In Progress" in tasks.json
      try {
        let jciTasks = await readJson(tasksKey) ?? [];
        const jciTaskIdx = jciTasks.findIndex(t => t.id === jobId);
        if (jciTaskIdx !== -1) {
          const jciJob = jciTasks[jciTaskIdx];
          jciTasks[jciTaskIdx] = {
            ...jciJob,
            status: jciJob.status === "In Progress" ? jciJob.status : "In Progress",
            subs: (jciJob.subs || []).map(panel => ({
              ...panel,
              subs: (panel.subs || []).map(op => {
                if (op.id !== opId) return op;
                return { ...op, status: "In Progress" };
              }),
            })),
          };
          await writeStampedArray(tasksKey, jciTasks);
        }
      } catch (e) { console.warn("jobClockIn: failed to update task status", e); }

      return json(200, { ok: true, clockIn: jciClockIn });
    }

    // ── Job Clock Out (Bearer token, no PIN) ──────────────────────────────────
    if (action === "jobClockOut") {
      let _jco;
      try { _jco = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

      const { personId: jcoPId } = body;
      if (!jcoPId) return err(400, "Missing personId");
      if (!_jco.isAdmin && String(_jco.personId) !== String(jcoPId)) return err(403, "Can only clock yourself out");

      let jcoPeople;
      try { jcoPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jcoIdx = jcoPeople.findIndex(p => String(p.id) === String(jcoPId));
      if (jcoIdx === -1) return err(404, "Person not found");

      const jcoPerson = jcoPeople[jcoIdx];
      if (!jcoPerson.activeJobClock) return err(409, "Not clocked into any job");

      const jcoClockOut = new Date().toISOString();
      const { clockIn: jcoClockIn, jobId: jcoJobId, panelId: jcoPanelId, opId: jcoOpId, totalPausedMs: jcoPausedMs = 0 } = jcoPerson.activeJobClock;
      const jcoRawMs = new Date(jcoClockOut) - new Date(jcoClockIn);
      const jcoHours = Math.max(0, Math.round(((jcoRawMs - jcoPausedMs) / 3600000) * 100) / 100);

      jcoPeople[jcoIdx] = { ...jcoPerson, activeJobClock: null };
      try { await writeStampedArray(peopleKey, jcoPeople); } catch { return err(500, "Failed to save"); }

      if (jcoHours > 0 && jcoJobId) {
        try {
          let tasks = await readJson(tasksKey) ?? [];
          tasks = tasks.map(job => {
            if (job.id !== jcoJobId) return job;
            const newJobHours = Math.round(((job.loggedHours || 0) + jcoHours) * 100) / 100;
            const newSubs = jcoOpId ? (job.subs || []).map(panel => {
              if (panel.id !== jcoPanelId) return panel;
              return {
                ...panel,
                subs: (panel.subs || []).map(op => {
                  if (op.id !== jcoOpId) return op;
                  return { ...op, loggedHours: Math.round(((op.loggedHours || 0) + jcoHours) * 100) / 100 };
                }),
              };
            }) : job.subs;
            return { ...job, loggedHours: newJobHours, subs: newSubs };
          });
          await writeStampedArray(tasksKey, tasks);
        } catch { /* non-fatal */ }
      }

      // Append a timestamped job-session row so pay-period job hours can be
      // reported per person (the loggedHours totals above are cumulative only).
      if (jcoHours > 0 && jcoJobId) {
        try {
          const { jobTitle: jcoJobTitle, panelTitle: jcoPanelTitle, opTitle: jcoOpTitle } = jcoPerson.activeJobClock || {};
          let sessions = await readJson(jobSessionsKey) ?? [];
          if (!Array.isArray(sessions)) sessions = [];
          sessions.push({
            id: `js_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            personId: jcoPId,
            jobId: jcoJobId,
            panelId: jcoPanelId ?? null,
            opId: jcoOpId ?? null,
            jobTitle: jcoJobTitle ?? null,
            panelTitle: jcoPanelTitle ?? null,
            opTitle: jcoOpTitle ?? null,
            clockIn: jcoClockIn,
            clockOut: jcoClockOut,
            hours: jcoHours,
            date: jcoClockIn.slice(0, 10),
          });
          await writeJson(jobSessionsKey, sessions);
        } catch { /* non-fatal */ }
      }

      return json(200, { ok: true, hours: jcoHours });
    }

    // ── Job Pause (Bearer token, no PIN) ──────────────────────────────────────
    if (action === "jobPause") {
      let _jp;
      try { _jp = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

      const { personId: jpPId } = body;
      if (!jpPId) return err(400, "Missing personId");
      if (!_jp.isAdmin && String(_jp.personId) !== String(jpPId)) return err(403, "Can only pause your own clock");

      let jpPeople;
      try { jpPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jpIdx = jpPeople.findIndex(p => String(p.id) === String(jpPId));
      if (jpIdx === -1) return err(404, "Person not found");

      const jpPerson = jpPeople[jpIdx];
      if (!jpPerson.activeJobClock) return err(409, "Not clocked into any job");
      if (jpPerson.activeJobClock.pausedAt) return err(409, "Job already paused");

      const pausedAt = new Date().toISOString();
      jpPeople[jpIdx] = { ...jpPerson, activeJobClock: { ...jpPerson.activeJobClock, pausedAt } };
      try { await writeStampedArray(peopleKey, jpPeople); } catch { return err(500, "Failed to save"); }

      return json(200, { ok: true, pausedAt });
    }

    // ── Job Resume (Bearer token, no PIN) ─────────────────────────────────────
    if (action === "jobResume") {
      let _jr;
      try { _jr = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

      const { personId: jrPId } = body;
      if (!jrPId) return err(400, "Missing personId");
      if (!_jr.isAdmin && String(_jr.personId) !== String(jrPId)) return err(403, "Can only resume your own clock");

      let jrPeople;
      try { jrPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jrIdx = jrPeople.findIndex(p => String(p.id) === String(jrPId));
      if (jrIdx === -1) return err(404, "Person not found");

      const jrPerson = jrPeople[jrIdx];
      if (!jrPerson.activeJobClock) return err(409, "Not clocked into any job");
      if (!jrPerson.activeJobClock.pausedAt) return err(409, "Job is not paused");

      const pausedDuration = Date.now() - new Date(jrPerson.activeJobClock.pausedAt).getTime();
      const totalPausedMs = (jrPerson.activeJobClock.totalPausedMs || 0) + pausedDuration;
      const { pausedAt: _removed, ...jrJobClock } = jrPerson.activeJobClock;
      jrPeople[jrIdx] = { ...jrPerson, activeJobClock: { ...jrJobClock, totalPausedMs } };
      try { await writeStampedArray(peopleKey, jrPeople); } catch { return err(500, "Failed to save"); }

      return json(200, { ok: true, totalPausedMs });
    }

    // ── Break Begin (Bearer token, no PIN) ────────────────────────────────────
    // Lightweight status: marks the worker on break WITHOUT touching the job
    // clock (the job keeps logging time — break time is accounted for
    // elsewhere). `durationMinutes` is a snapshot of the configured break
    // length, used by the app for the reminder + countdown. A breakStart row
    // is logged to timeclock.json for payroll. Distinct from the PIN-based
    // "breakStart"/"breakEnd" kiosk actions below.
    if (action === "breakBegin") {
      let _bb;
      try { _bb = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

      const { personId: bbPId, durationMinutes: bbDur } = body;
      if (!bbPId) return err(400, "Missing personId");
      if (!_bb.isAdmin && String(_bb.personId) !== String(bbPId)) return err(403, "Can only start your own break");

      let bbPeople;
      try { bbPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }
      const bbIdx = bbPeople.findIndex(p => String(p.id) === String(bbPId));
      if (bbIdx === -1) return err(404, "Person not found");
      if (bbPeople[bbIdx].activeBreak) return err(409, "Already on break");

      const bbStart = new Date().toISOString();
      const bbMinutes = Number.isFinite(bbDur) ? bbDur : 15;
      bbPeople[bbIdx] = { ...bbPeople[bbIdx], activeBreak: { startedAt: bbStart, durationMinutes: bbMinutes } };
      try { await writeStampedArray(peopleKey, bbPeople); } catch { return err(500, "Failed to save"); }

      // Log to timeclock.json for payroll records.
      const bbEvt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId: String(bbPId), date: bbStart.slice(0, 10), eventType: "breakStart", timestamp: bbStart };
      let bbLog; try { bbLog = await readJson(clockKey) ?? []; } catch { bbLog = []; }
      bbLog.push(bbEvt); try { await writeStampedArray(clockKey, bbLog); } catch { }

      return json(200, { ok: true, startedAt: bbStart, durationMinutes: bbMinutes });
    }

    // ── Break Clear (Bearer token, no PIN) — ends the lightweight break ───────
    if (action === "breakClear") {
      let _bc;
      try { _bc = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

      const { personId: bcPId } = body;
      if (!bcPId) return err(400, "Missing personId");
      if (!_bc.isAdmin && String(_bc.personId) !== String(bcPId)) return err(403, "Can only end your own break");

      let bcPeople;
      try { bcPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }
      const bcIdx = bcPeople.findIndex(p => String(p.id) === String(bcPId));
      if (bcIdx === -1) return err(404, "Person not found");
      if (!bcPeople[bcIdx].activeBreak) return err(409, "Not on break");

      const bcEnd = new Date().toISOString();
      bcPeople[bcIdx] = { ...bcPeople[bcIdx], activeBreak: null };
      try { await writeStampedArray(peopleKey, bcPeople); } catch { return err(500, "Failed to save"); }

      const bcEvt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId: String(bcPId), date: bcEnd.slice(0, 10), eventType: "breakEnd", timestamp: bcEnd };
      let bcLog; try { bcLog = await readJson(clockKey) ?? []; } catch { bcLog = []; }
      bcLog.push(bcEvt); try { await writeStampedArray(clockKey, bcLog); } catch { }

      return json(200, { ok: true, endedAt: bcEnd });
    }

    // ── PIN-authenticated actions ──────────────────────────────────────────
    const { personId, pin } = body;
    if (!pin) return err(400, "Missing pin");

    let people;
    try { people = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

    // ── Identify (PIN lookup by scanning all people — no personId needed) ───
    if (action === "identify") {
      const ip = clientIp(event);
      const attempts = failedAttempts.get(ip) || { count: 0, firstAttempt: Date.now() };
      if (Date.now() - attempts.firstAttempt > 15 * 60 * 1000) {
        failedAttempts.delete(ip);
      } else if (attempts.count >= 5) {
        return err(429, "Too many failed attempts. Try again later.");
      }
      // Scan LIVE people only — a soft-deleted (tombstoned) person must not be
      // able to clock in even though their record (and, for legacy tombstones,
      // their PIN) is still in the raw array. No live match → 401, same as a
      // wrong PIN, so we never leak that a removed employee's PIN once existed.
      const person = filterLive(people).find(p => p.pin && String(p.pin) === String(pin));
      if (!person) {
        failedAttempts.set(ip, { count: (attempts.count || 0) + 1, firstAttempt: attempts.firstAttempt || Date.now() });
        return err(401, "Invalid PIN");
      }
      failedAttempts.delete(ip);
      return json(200, { ok: true, personId: person.id, name: person.name, activeClockIn: person.activeClockIn || null });
    }

    // All other PIN actions require personId
    if (!personId) return err(400, "Missing personId");

    const personIdx = people.findIndex(p => String(p.id) === String(personId));
    if (personIdx === -1) return err(404, "Person not found");

    const person = people[personIdx];
    const _ip = clientIp(event);
    const _attempts = failedAttempts.get(_ip) || { count: 0, firstAttempt: Date.now() };
    if (Date.now() - _attempts.firstAttempt > 15 * 60 * 1000) {
      failedAttempts.delete(_ip);
    } else if (_attempts.count >= 5) {
      return err(429, "Too many failed attempts. Try again later.");
    }
    if (!person.pin || String(person.pin) !== String(pin)) {
      failedAttempts.set(_ip, { count: (_attempts.count || 0) + 1, firstAttempt: _attempts.firstAttempt || Date.now() });
      return err(401, "Invalid PIN");
    }
    failedAttempts.delete(_ip);

    // ── Clock In ────────────────────────────────────────────────────────────
    if (action === "clockIn") {
      if (person.activeClockIn) {
        return err(409, "Already clocked in");
      }
      const { jobRefs = [] } = body;
      const clockIn = new Date().toISOString();
      people[personIdx] = { ...person, activeClockIn: { clockIn, jobRefs } };
      try { await writeStampedArray(peopleKey, people); } catch { return err(500, "Failed to save clock-in"); }
      return json(200, { ok: true, clockIn });
    }

    // ── Clock Out ────────────────────────────────────────────────────────────
    if (action === "clockOut") {
      if (!person.activeClockIn) {
        return err(409, "Not currently clocked in");
      }
      const clockOut = new Date().toISOString();
      const { clockIn, jobRefs = [], events = [] } = person.activeClockIn;
      const hours = hoursElapsedMinusPauses(clockIn, clockOut, events);
      const dateStr = clockIn.slice(0, 10);

      const entry = {
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        personId,
        date: dateStr,
        clockIn,
        clockOut,
        hours,
        jobRefs,
        note: body.note || "",
      };

      let log;
      try { log = await readJson(clockKey) ?? []; } catch { log = []; }
      log.push(entry);
      try { await writeStampedArray(clockKey, log); } catch { return err(500, "Failed to save clock entry"); }

      people[personIdx] = { ...person, activeClockIn: null };
      try { await writeStampedArray(peopleKey, people); } catch { /* non-fatal */ }

      // Update loggedHours on each job in tasks.json
      if (jobRefs.length > 0 && hours > 0) {
        try {
          let tasks = await readJson(tasksKey) ?? [];
          tasks = tasks.map(job => {
            const ref = jobRefs.find(r => String(r.jobId) === String(job.id));
            if (!ref) return job;
            return { ...job, loggedHours: Math.round(((job.loggedHours || 0) + hours) * 100) / 100 };
          });
          await writeStampedArray(tasksKey, tasks);
        } catch { /* non-fatal */ }
      }

      return json(200, { ok: true, entry });
    }

    // ── Lunch Start ──────────────────────────────────────────────────────────
    if (action === "lunchStart") {
      if (!person.activeClockIn) return err(409, "Not currently clocked in");
      const events = person.activeClockIn.events || [];
      const lastLunch = [...events].reverse().find(e => e.type === "lunchStart" || e.type === "lunchEnd");
      if (lastLunch?.type === "lunchStart") return err(409, "Already on lunch");
      const timestamp = new Date().toISOString();
      people[personIdx] = { ...person, activeClockIn: { ...person.activeClockIn, events: [...events, { type: "lunchStart", ts: timestamp }] } };
      try { await writeStampedArray(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "lunchStart", timestamp };
      let log1; try { log1 = await readJson(clockKey) ?? []; } catch { log1 = []; }
      log1.push(evt); try { await writeStampedArray(clockKey, log1); } catch { }
      return json(200, { ok: true, event: evt });
    }

    // ── Lunch End ────────────────────────────────────────────────────────────
    if (action === "lunchEnd") {
      if (!person.activeClockIn) return err(409, "Not currently clocked in");
      const events = person.activeClockIn.events || [];
      const lastLunch = [...events].reverse().find(e => e.type === "lunchStart" || e.type === "lunchEnd");
      if (!lastLunch || lastLunch.type !== "lunchStart") return err(409, "Not on lunch");
      const timestamp = new Date().toISOString();
      people[personIdx] = { ...person, activeClockIn: { ...person.activeClockIn, events: [...events, { type: "lunchEnd", ts: timestamp }] } };
      try { await writeStampedArray(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "lunchEnd", timestamp };
      let log2; try { log2 = await readJson(clockKey) ?? []; } catch { log2 = []; }
      log2.push(evt); try { await writeStampedArray(clockKey, log2); } catch { }
      return json(200, { ok: true, event: evt });
    }

    // ── Break Start ──────────────────────────────────────────────────────────
    if (action === "breakStart") {
      if (!person.activeClockIn) return err(409, "Not currently clocked in");
      const events = person.activeClockIn.events || [];
      const lastBreak = [...events].reverse().find(e => e.type === "breakStart" || e.type === "breakEnd");
      if (lastBreak?.type === "breakStart") return err(409, "Already on break");
      const timestamp = new Date().toISOString();
      people[personIdx] = { ...person, activeClockIn: { ...person.activeClockIn, events: [...events, { type: "breakStart", ts: timestamp }] } };
      try { await writeStampedArray(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "breakStart", timestamp };
      let log3; try { log3 = await readJson(clockKey) ?? []; } catch { log3 = []; }
      log3.push(evt); try { await writeStampedArray(clockKey, log3); } catch { }
      return json(200, { ok: true, event: evt });
    }

    // ── Break End ────────────────────────────────────────────────────────────
    if (action === "breakEnd") {
      if (!person.activeClockIn) return err(409, "Not currently clocked in");
      const events = person.activeClockIn.events || [];
      const lastBreak = [...events].reverse().find(e => e.type === "breakStart" || e.type === "breakEnd");
      if (!lastBreak || lastBreak.type !== "breakStart") return err(409, "Not on break");
      const timestamp = new Date().toISOString();
      people[personIdx] = { ...person, activeClockIn: { ...person.activeClockIn, events: [...events, { type: "breakEnd", ts: timestamp }] } };
      try { await writeStampedArray(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "breakEnd", timestamp };
      let log4; try { log4 = await readJson(clockKey) ?? []; } catch { log4 = []; }
      log4.push(evt); try { await writeStampedArray(clockKey, log4); } catch { }
      return json(200, { ok: true, event: evt });
    }

    // ── Finish Request ────────────────────────────────────────────────────────
    if (action === "finishRequest") {
      const { jobId, panelId, opId } = body;
      if (!jobId || !panelId || !opId) return err(400, "Missing jobId, panelId, or opId");

      let tasks;
      try { tasks = await readJson(tasksKey) ?? []; } catch { return err(500, "Failed to read tasks"); }

      let updated = false;
      tasks = tasks.map(job => {
        if (job.id !== jobId) return job;
        return {
          ...job,
          subs: (job.subs || []).map(panel => {
            if (panel.id !== panelId) return panel;
            return {
              ...panel,
              subs: (panel.subs || []).map(op => {
                if (op.id !== opId) return op;
                updated = true;
                return { ...op, pendingFinish: true };
              }),
            };
          }),
        };
      });

      if (!updated) return err(404, "Operation not found");
      try { await writeStampedArray(tasksKey, tasks); } catch { return err(500, "Failed to save tasks"); }
      return json(200, { ok: true });
    }

    return err(400, "Unknown action");
  }

  return err(405, "Method not allowed");
}
