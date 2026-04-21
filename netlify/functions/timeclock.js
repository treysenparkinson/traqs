import { validateToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

const failedAttempts = new Map(); // ip -> { count, firstAttempt }

function getOrgCode(event) {
  const code = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!code || !/^[a-zA-Z0-9]{3,20}$/.test(code)) return null;
  return code;
}

function hoursElapsed(isoStart, isoEnd) {
  const ms = new Date(isoEnd) - new Date(isoStart);
  return Math.max(0, Math.round((ms / 3600000) * 100) / 100);
}

function addWorkingDays(dateStr, days) {
  let date = new Date(dateStr + "T12:00:00Z");
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date.toISOString().slice(0, 10);
}

function subtractWorkingDays(dateStr, days) {
  let date = new Date(dateStr + "T12:00:00Z");
  let subtracted = 0;
  while (subtracted < days) {
    date.setUTCDate(date.getUTCDate() - 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) subtracted++;
  }
  return date.toISOString().slice(0, 10);
}

async function runSpliceAlgorithm(orgCode, switchingWorkerId, fromOpId, fromPanelId, fromJobId, toOpId, toPanelId, toJobId, activeJobClock) {
  const tasksKey = `orgs/${orgCode}/tasks.json`;
  const productiveHoursPerDay = 7.5;

  // STEP 1 — Hours completed on the interrupted job
  const nowMs = Date.now();
  const clockInMs = new Date(activeJobClock.clockIn).getTime();
  const totalPausedMs = activeJobClock.totalPausedMs || 0;
  const hoursCompleted = Math.max(0, Math.round(((nowMs - clockInMs - totalPausedMs) / 3600000) * 100) / 100);

  if (hoursCompleted < 0.05) return null;

  // STEP 2 — Read tasks
  let tasks;
  try { tasks = await readJson(tasksKey) ?? []; } catch { return null; }

  function findOp(opId) {
    for (const job of tasks) {
      for (const panel of (job.subs || [])) {
        for (const op of (panel.subs || [])) {
          if (op.id === opId) return op;
        }
      }
    }
    return null;
  }

  // STEP 3 — Find interrupted sub-op
  const fromOp = findOp(fromOpId);
  if (!fromOp || !fromOp.start) return null;
  if (fromOp.status === "Finished") return null;

  // STEP 4 — Split the interrupted sub-op
  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const todayDow = new Date(today + "T12:00:00Z").getUTCDay();
  const workingToday = todayDow === 0 ? addWorkingDays(today, 1) : todayDow === 6 ? addWorkingDays(today, 2) : today;
  const spliceId = `splice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const snapshotBefore = {
    start: fromOp.start,
    end: fromOp.end,
    segments: fromOp.segments ? [...fromOp.segments] : [],
  };

  const existingWorkerSegs = (fromOp.segments || []).filter(s => s.workerId === switchingWorkerId);
  const nextSegIndex = existingWorkerSegs.length;

  const seg0 = {
    segmentId: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    workerId: switchingWorkerId,
    start: workingToday,
    end: workingToday,
    hoursPlanned: hoursCompleted,
    hoursLogged: hoursCompleted,
    status: "complete",
    segmentIndex: nextSegIndex,
  };

  const spliceLogEntry = {
    spliceId,
    triggeredAt: nowIso,
    workerId: switchingWorkerId,
    hoursCompletedAtSplice: hoursCompleted,
    hoursRemainingAtSplice: (fromOp.hpd || productiveHoursPerDay) - hoursCompleted,
    interruptedByOpId: toOpId,
    originalStart: fromOp.start,
    originalEnd: fromOp.end,
    snapshotBefore,
  };

  // STEP 5 — Find inserted sub-op
  const toOp = findOp(toOpId);
  if (!toOp) return null;

  // STEP 6 — toOp insertion position (anchored to today, not the past job start)
  const insertStart = workingToday;
  const toOpLoggedHours = toOp.loggedHours || 0;
  const toOpRemainingHours = Math.max(productiveHoursPerDay * 0.1, (toOp.hpd || productiveHoursPerDay) - toOpLoggedHours);
  const toOpDuration = Math.max(1, Math.ceil(toOpRemainingHours / productiveHoursPerDay));
  const insertEnd = toOpDuration > 1 ? addWorkingDays(insertStart, toOpDuration - 1) : insertStart;

  // STEP 7 — Remaining fromOp segment placed after toOp
  const remainingHours = Math.max(0, (fromOp.hpd || productiveHoursPerDay) - hoursCompleted);
  const remainingDuration = Math.max(1, Math.ceil(remainingHours / productiveHoursPerDay));
  const remainingStart = addWorkingDays(insertEnd, 1);
  const remainingEnd = remainingDuration > 1 ? addWorkingDays(remainingStart, remainingDuration - 1) : remainingStart;

  const seg1 = {
    segmentId: `seg_${Date.now() + 1}_${Math.random().toString(36).slice(2, 7)}`,
    workerId: switchingWorkerId,
    start: remainingStart,
    end: remainingEnd,
    hoursPlanned: remainingHours,
    hoursLogged: 0,
    status: "remaining",
    segmentIndex: nextSegIndex + 1,
  };

  // STEP 9 — Two-worker scenario: prepare segments for existing toOp workers
  const affectedWorkerIds = [switchingWorkerId];
  const owSegmentsForToOp = [];
  const originalWorkerIds = [];

  if (toOp.team && toOp.team.length > 0) {
    for (const owId of toOp.team) {
      if (owId === switchingWorkerId) continue;
      affectedWorkerIds.push(owId);
      originalWorkerIds.push(owId);

      const owLoggedHours = toOp.loggedHours || 0;

      if (owLoggedHours > 0) {
        const owSeg0 = {
          segmentId: `seg_${Date.now()}_ow0_${Math.random().toString(36).slice(2, 7)}`,
          workerId: owId,
          start: today,
          end: today,
          hoursPlanned: owLoggedHours,
          hoursLogged: owLoggedHours,
          status: "complete",
          segmentIndex: 0,
        };
        owSegmentsForToOp.push(owSeg0);
      }

      const owRemHours = Math.max(0, (toOp.hpd || productiveHoursPerDay) - owLoggedHours);
      const owRemDuration = Math.max(1, Math.ceil(owRemHours / productiveHoursPerDay));
      const owRemStart = addWorkingDays(insertEnd, 1);
      const owRemEnd = owRemDuration > 1 ? addWorkingDays(owRemStart, owRemDuration - 1) : owRemStart;

      const owSeg1 = {
        segmentId: `seg_${Date.now() + 1}_ow1_${Math.random().toString(36).slice(2, 7)}`,
        workerId: owId,
        start: owRemStart,
        end: owRemEnd,
        hoursPlanned: owRemHours,
        hoursLogged: 0,
        status: "remaining",
        segmentIndex: owLoggedHours > 0 ? 1 : 0,
      };

      owSegmentsForToOp.push(owSeg1);
    }
  }

  const switchingWorkerSeg = {
    segmentId: `seg_${Date.now()}_sw_${Math.random().toString(36).slice(2, 7)}`,
    workerId: switchingWorkerId,
    start: insertStart,
    end: insertEnd,
    hoursPlanned: toOpRemainingHours,
    hoursLogged: 0,
    status: "active",
    segmentIndex: owSegmentsForToOp.length,
  };

  // Apply all changes in a single pass (STEPS 8, 9, 10)
  const updatedTasks = tasks.map(job => ({
    ...job,
    subs: (job.subs || []).map(panel => ({
      ...panel,
      subs: (panel.subs || []).map(op => {
        // fromOp: add segments and spliceLog entry
        if (op.id === fromOpId) {
          return {
            ...op,
            start: seg0.start,
            end: seg0.end,
            segments: [...(op.segments || []), seg0, seg1],
            spliceLog: [...(op.spliceLog || []), spliceLogEntry],
          };
        }

        // toOp: update dates (only if not yet started), add switchingWorker to team, add original worker segments
        if (op.id === toOpId) {
          const alreadyStarted = (op.loggedHours || 0) > 0;
          const newTeam = (op.team || []).includes(switchingWorkerId)
            ? op.team
            : [...(op.team || []), switchingWorkerId];
          return {
            ...op,
            team: newTeam,
            start: alreadyStarted ? op.start : insertStart,
            end: alreadyStarted ? op.end : insertEnd,
            segments: [...(op.segments || []), ...owSegmentsForToOp, switchingWorkerSeg],
          };
        }

        // STEP 8 — Push downstream ops for switchingWorkerId
        if (
          (op.team || []).includes(switchingWorkerId) &&
          op.id !== fromOpId &&
          op.id !== toOpId &&
          op.start && op.start > today
        ) {
          return {
            ...op,
            start: addWorkingDays(op.start, toOpDuration),
            end: op.end ? addWorkingDays(op.end, toOpDuration) : op.end,
          };
        }

        // Push downstream ops for original workers displaced from toOp
        for (const owId of originalWorkerIds) {
          if (
            (op.team || []).includes(owId) &&
            op.id !== fromOpId &&
            op.id !== toOpId &&
            op.start && op.start > today
          ) {
            return {
              ...op,
              start: addWorkingDays(op.start, toOpDuration),
              end: op.end ? addWorkingDays(op.end, toOpDuration) : op.end,
            };
          }
        }

        return op;
      }),
    })),
  }));

  // STEP 11 — Apply status update and write to S3 in a single pass
  const finalTasks = updatedTasks.map(job => {
    if (job.id === toJobId) {
      return {
        ...job,
        status: job.status === "In Progress" ? job.status : "In Progress",
        subs: (job.subs || []).map(panel => ({
          ...panel,
          subs: (panel.subs || []).map(op => {
            if (op.id !== toOpId) return op;
            return { ...op, status: "In Progress" };
          }),
        })),
      };
    }
    if (job.id === fromJobId) {
      return {
        ...job,
        status: job.status === "In Progress" ? job.status : "In Progress",
      };
    }
    return job;
  });
  try { await writeJson(tasksKey, finalTasks); } catch { return null; }

  // STEP 12 — Return splice result
  return {
    spliceOccurred: true,
    fromOpId,
    toOpId,
    insertStart,
    insertEnd,
    remainingStart,
    remainingEnd,
    affectedWorkerIds,
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const orgCode = getOrgCode(event);
  if (!orgCode) return err(400, "Missing or invalid X-Org-Code header");

  const peopleKey = `orgs/${orgCode}/people.json`;
  const clockKey = `orgs/${orgCode}/timeclock.json`;
  const tasksKey = `orgs/${orgCode}/tasks.json`;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    try {
      const data = await readJson(clockKey);
      const entries = Array.isArray(data) ? data : [];
      const { personId } = Object.fromEntries(
        (event.queryStringParameters ? Object.entries(event.queryStringParameters) : [])
      );
      const filtered = personId ? entries.filter(e => e.personId === personId) : entries;
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
    if (action === "adminClockOut" || action === "adminEditEntry") {
      try { await validateToken(event); } catch (e) { return err(401, e.message); }

      // ── Admin Clock Out ────────────────────────────────────────────────
      if (action === "adminClockOut") {
        const { personId, clockOutTime } = body;
        if (!personId) return err(400, "Missing personId");

        let people;
        try { people = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

        const personIdx = people.findIndex(p => p.id === personId);
        if (personIdx === -1) return err(404, "Person not found");

        const person = people[personIdx];
        if (!person.activeClockIn) return err(409, "Not currently clocked in");

        const clockOut = clockOutTime || new Date().toISOString();
        const { clockIn, jobRefs = [] } = person.activeClockIn;
        const hours = hoursElapsed(clockIn, clockOut);
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
        try { await writeJson(clockKey, log); } catch { return err(500, "Failed to save clock entry"); }

        people[personIdx] = { ...person, activeClockIn: null };
        try { await writeJson(peopleKey, people); } catch { /* non-fatal */ }

        // Update loggedHours on each job in tasks.json
        if (jobRefs.length > 0 && hours > 0) {
          try {
            let tasks = await readJson(tasksKey) ?? [];
            tasks = tasks.map(job => {
              const ref = jobRefs.find(r => String(r.jobId) === String(job.id));
              if (!ref) return job;
              return { ...job, loggedHours: Math.round(((job.loggedHours || 0) + hours) * 100) / 100 };
            });
            await writeJson(tasksKey, tasks);
          } catch { /* non-fatal */ }
        }

        return json(200, { ok: true, entry });
      }

      // ── Admin Edit Entry ───────────────────────────────────────────────
      if (action === "adminEditEntry") {
        const { entryId, clockIn, clockOut } = body;
        if (!entryId || !clockIn || !clockOut) return err(400, "Missing entryId, clockIn, or clockOut");

        let log;
        try { log = await readJson(clockKey) ?? []; } catch { return err(500, "Failed to read timeclock"); }

        let found = false;
        log = log.map(e => {
          if (e.id !== entryId) return e;
          found = true;
          const hours = hoursElapsed(clockIn, clockOut);
          return { ...e, clockIn, clockOut, hours, date: clockIn.slice(0, 10) };
        });

        if (!found) return err(404, "Entry not found");
        try { await writeJson(clockKey, log); } catch { return err(500, "Failed to save timeclock"); }

        const updated = log.find(e => e.id === entryId);
        return json(200, { ok: true, entry: updated });
      }
    }

    // ── Job Clock In (Bearer token, no PIN) ──────────────────────────────────
    if (action === "jobClockIn") {
      try { await validateToken(event); } catch (e) { return err(401, e.message); }

      const { personId: jciPersonId, jobId, panelId, opId, jobTitle, panelTitle, opTitle } = body;
      if (!jciPersonId || !jobId) return err(400, "Missing personId or jobId");

      let jciPeople;
      try { jciPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jciIdx = jciPeople.findIndex(p => p.id === jciPersonId);
      if (jciIdx === -1) return err(404, "Person not found");

      const jciPerson = jciPeople[jciIdx];

      // If already on a job, check whether this is a switch to a different op
      let spliceResult = null;
      if (jciPerson.activeJobClock) {
        const isSameOp = jciPerson.activeJobClock.jobId === jobId && jciPerson.activeJobClock.opId === opId;
        if (isSameOp) return err(409, "Already clocked into this job");
        spliceResult = await runSpliceAlgorithm(
          orgCode,
          jciPersonId,
          jciPerson.activeJobClock.opId,
          jciPerson.activeJobClock.panelId,
          jciPerson.activeJobClock.jobId,
          opId,
          panelId,
          jobId,
          jciPerson.activeJobClock,
        );
      }

      const jciClockIn = new Date().toISOString();
      jciPeople[jciIdx] = { ...jciPerson, activeJobClock: { clockIn: jciClockIn, jobId, panelId, opId, jobTitle, panelTitle, opTitle } };
      try { await writeJson(peopleKey, jciPeople); } catch { return err(500, "Failed to save"); }

      // Update job and sub-operation status to "In Progress" in tasks.json
      // (skipped when spliceResult is set — status update was already applied inside runSpliceAlgorithm)
      if (spliceResult === null) {
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
            await writeJson(tasksKey, jciTasks);
          }
        } catch (e) { console.warn("jobClockIn: failed to update task status", e); }
      }

      return json(200, { ok: true, clockIn: jciClockIn, spliceResult });
    }

    // ── Job Clock Out (Bearer token, no PIN) ──────────────────────────────────
    if (action === "jobClockOut") {
      try { await validateToken(event); } catch (e) { return err(401, e.message); }

      const { personId: jcoPId } = body;
      if (!jcoPId) return err(400, "Missing personId");

      let jcoPeople;
      try { jcoPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jcoIdx = jcoPeople.findIndex(p => p.id === jcoPId);
      if (jcoIdx === -1) return err(404, "Person not found");

      const jcoPerson = jcoPeople[jcoIdx];
      if (!jcoPerson.activeJobClock) return err(409, "Not clocked into any job");

      const jcoClockOut = new Date().toISOString();
      const { clockIn: jcoClockIn, jobId: jcoJobId, panelId: jcoPanelId, opId: jcoOpId, totalPausedMs: jcoPausedMs = 0 } = jcoPerson.activeJobClock;
      const jcoRawMs = new Date(jcoClockOut) - new Date(jcoClockIn);
      const jcoHours = Math.max(0, Math.round(((jcoRawMs - jcoPausedMs) / 3600000) * 100) / 100);

      jcoPeople[jcoIdx] = { ...jcoPerson, activeJobClock: null };
      try { await writeJson(peopleKey, jcoPeople); } catch { return err(500, "Failed to save"); }

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
                  const updatedSegments = op.segments
                    ? op.segments.map(seg => {
                        if (seg.workerId !== jcoPId || (seg.status !== "remaining" && seg.status !== "active")) return seg;
                        return { ...seg, hoursLogged: Math.round(((seg.hoursLogged || 0) + jcoHours) * 100) / 100, status: "complete" };
                      })
                    : op.segments;
                  return {
                    ...op,
                    loggedHours: Math.round(((op.loggedHours || 0) + jcoHours) * 100) / 100,
                    ...(updatedSegments ? { segments: updatedSegments } : {}),
                  };
                }),
              };
            }) : job.subs;
            return { ...job, loggedHours: newJobHours, subs: newSubs };
          });
          await writeJson(tasksKey, tasks);
        } catch { /* non-fatal */ }
      }

      return json(200, { ok: true, hours: jcoHours });
    }

    // ── Job Pause (Bearer token, no PIN) ──────────────────────────────────────
    if (action === "jobPause") {
      try { await validateToken(event); } catch (e) { return err(401, e.message); }

      const { personId: jpPId } = body;
      if (!jpPId) return err(400, "Missing personId");

      let jpPeople;
      try { jpPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jpIdx = jpPeople.findIndex(p => p.id === jpPId);
      if (jpIdx === -1) return err(404, "Person not found");

      const jpPerson = jpPeople[jpIdx];
      if (!jpPerson.activeJobClock) return err(409, "Not clocked into any job");
      if (jpPerson.activeJobClock.pausedAt) return err(409, "Job already paused");

      const pausedAt = new Date().toISOString();
      jpPeople[jpIdx] = { ...jpPerson, activeJobClock: { ...jpPerson.activeJobClock, pausedAt } };
      try { await writeJson(peopleKey, jpPeople); } catch { return err(500, "Failed to save"); }

      return json(200, { ok: true, pausedAt });
    }

    // ── Job Resume (Bearer token, no PIN) ─────────────────────────────────────
    if (action === "jobResume") {
      try { await validateToken(event); } catch (e) { return err(401, e.message); }

      const { personId: jrPId } = body;
      if (!jrPId) return err(400, "Missing personId");

      let jrPeople;
      try { jrPeople = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

      const jrIdx = jrPeople.findIndex(p => p.id === jrPId);
      if (jrIdx === -1) return err(404, "Person not found");

      const jrPerson = jrPeople[jrIdx];
      if (!jrPerson.activeJobClock) return err(409, "Not clocked into any job");
      if (!jrPerson.activeJobClock.pausedAt) return err(409, "Job is not paused");

      const pausedDuration = Date.now() - new Date(jrPerson.activeJobClock.pausedAt).getTime();
      const totalPausedMs = (jrPerson.activeJobClock.totalPausedMs || 0) + pausedDuration;
      const { pausedAt: _removed, ...jrJobClock } = jrPerson.activeJobClock;
      jrPeople[jrIdx] = { ...jrPerson, activeJobClock: { ...jrJobClock, totalPausedMs } };
      try { await writeJson(peopleKey, jrPeople); } catch { return err(500, "Failed to save"); }

      return json(200, { ok: true, totalPausedMs });
    }

    // ── PIN-authenticated actions ──────────────────────────────────────────
    const { personId, pin } = body;
    if (!pin) return err(400, "Missing pin");

    let people;
    try { people = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

    // ── Identify (PIN lookup by scanning all people — no personId needed) ───
    if (action === "identify") {
      const ip = event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
      const attempts = failedAttempts.get(ip) || { count: 0, firstAttempt: Date.now() };
      if (Date.now() - attempts.firstAttempt > 15 * 60 * 1000) {
        failedAttempts.delete(ip);
      } else if (attempts.count >= 5) {
        return err(429, "Too many failed attempts. Try again later.");
      }
      const person = people.find(p => p.pin && String(p.pin) === String(pin));
      if (!person) {
        failedAttempts.set(ip, { count: (attempts.count || 0) + 1, firstAttempt: attempts.firstAttempt || Date.now() });
        return err(401, "Invalid PIN");
      }
      failedAttempts.delete(ip);
      return json(200, { ok: true, personId: person.id, name: person.name, activeClockIn: person.activeClockIn || null });
    }

    // All other PIN actions require personId
    if (!personId) return err(400, "Missing personId");

    const personIdx = people.findIndex(p => p.id === personId);
    if (personIdx === -1) return err(404, "Person not found");

    const person = people[personIdx];
    const _ip = event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
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
      try { await writeJson(peopleKey, people); } catch { return err(500, "Failed to save clock-in"); }
      return json(200, { ok: true, clockIn });
    }

    // ── Clock Out ────────────────────────────────────────────────────────────
    if (action === "clockOut") {
      if (!person.activeClockIn) {
        return err(409, "Not currently clocked in");
      }
      const clockOut = new Date().toISOString();
      const { clockIn, jobRefs = [] } = person.activeClockIn;
      const hours = hoursElapsed(clockIn, clockOut);
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
      try { await writeJson(clockKey, log); } catch { return err(500, "Failed to save clock entry"); }

      people[personIdx] = { ...person, activeClockIn: null };
      try { await writeJson(peopleKey, people); } catch { /* non-fatal */ }

      // Update loggedHours on each job in tasks.json
      if (jobRefs.length > 0 && hours > 0) {
        try {
          let tasks = await readJson(tasksKey) ?? [];
          tasks = tasks.map(job => {
            const ref = jobRefs.find(r => String(r.jobId) === String(job.id));
            if (!ref) return job;
            return { ...job, loggedHours: Math.round(((job.loggedHours || 0) + hours) * 100) / 100 };
          });
          await writeJson(tasksKey, tasks);
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
      try { await writeJson(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "lunchStart", timestamp };
      let log1; try { log1 = await readJson(clockKey) ?? []; } catch { log1 = []; }
      log1.push(evt); try { await writeJson(clockKey, log1); } catch { }
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
      try { await writeJson(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "lunchEnd", timestamp };
      let log2; try { log2 = await readJson(clockKey) ?? []; } catch { log2 = []; }
      log2.push(evt); try { await writeJson(clockKey, log2); } catch { }
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
      try { await writeJson(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "breakStart", timestamp };
      let log3; try { log3 = await readJson(clockKey) ?? []; } catch { log3 = []; }
      log3.push(evt); try { await writeJson(clockKey, log3); } catch { }
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
      try { await writeJson(peopleKey, people); } catch { return err(500, "Failed to save"); }
      const evt = { id: `tce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, date: timestamp.slice(0, 10), eventType: "breakEnd", timestamp };
      let log4; try { log4 = await readJson(clockKey) ?? []; } catch { log4 = []; }
      log4.push(evt); try { await writeJson(clockKey, log4); } catch { }
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
      try { await writeJson(tasksKey, tasks); } catch { return err(500, "Failed to save tasks"); }
      return json(200, { ok: true });
    }

    return err(400, "Unknown action");
  }

  return err(405, "Method not allowed");
}
