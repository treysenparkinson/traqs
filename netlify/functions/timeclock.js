import { validateToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

function getOrgCode(event) {
  const code = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!code || !/^[a-zA-Z0-9]{3,20}$/.test(code)) return null;
  return code;
}

function hoursElapsed(isoStart, isoEnd) {
  const ms = new Date(isoEnd) - new Date(isoStart);
  return Math.max(0, Math.round((ms / 3600000) * 100) / 100);
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

    // ── PIN-authenticated actions ──────────────────────────────────────────
    const { personId, pin } = body;
    if (!pin) return err(400, "Missing pin");

    let people;
    try { people = await readJson(peopleKey) ?? []; } catch { return err(500, "Failed to read people"); }

    // ── Identify (PIN lookup by scanning all people — no personId needed) ───
    if (action === "identify") {
      const person = people.find(p => p.pin && String(p.pin) === String(pin));
      if (!person) return err(401, "Invalid PIN");
      return json(200, { ok: true, personId: person.id, name: person.name, activeClockIn: person.activeClockIn || null });
    }

    // All other PIN actions require personId
    if (!personId) return err(400, "Missing personId");

    const personIdx = people.findIndex(p => p.id === personId);
    if (personIdx === -1) return err(404, "Person not found");

    const person = people[personIdx];
    if (!person.pin || String(person.pin) !== String(pin)) {
      return err(401, "Invalid PIN");
    }

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
