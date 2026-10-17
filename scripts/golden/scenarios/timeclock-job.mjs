// Goldens: the job clock in netlify/functions/timeclock.js.
//
// jobClockIn / jobClockOut / updateJobSession / jobPause / jobResume / breakBegin / breakClear /
// releaseJobSession / setOpWorkedHours / adminJobHours / finishRequest (PIN) and the
// productionhours GET. Flows run on the org's clock: America/Denver, which is MDT (UTC-6) on
// the dates used here, so Mon 2026-10-19 07:00 local is 13:00Z.
import { AUTH, orgSeed, ORG } from "../fixture-org.mjs";

const K = (file) => `orgs/${ORG}/${file}`;

// Local Denver wall time on a given day (MDT, UTC-6) -> ISO instant.
const at = (hhmm, day = "2026-10-19") => {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 6, m)).toISOString();
};
const MON = (hhmm) => at(hhmm, "2026-10-19");
const FRI = (hhmm) => at(hhmm, "2026-10-16");

// A bearer-authenticated timeclock POST.
const post = (auth, body, now) => ({ fn: "timeclock", method: "POST", auth, body, ...(now ? { now } : {}) });
// A PIN (kiosk) POST: no token.
const kiosk = (body, now) => ({ fn: "timeclock", method: "POST", auth: null, body, ...(now ? { now } : {}) });

const O2 = { jobId: "j1", panelId: "p1", opId: "o2", jobTitle: "Lift Station 4", panelTitle: "MCC-1", opTitle: "Wire terminals" };
const O4 = { jobId: "j1", panelId: "p2", opId: "o4", jobTitle: "Lift Station 4", panelTitle: "RTU", opTitle: "Fab enclosure" };

const wIn = (now, extra = {}) => post(AUTH.wendy, { action: "jobClockIn", personId: "7", ...O2, ...extra }, now);
const wOut = (now, extra = {}) => post(AUTH.wendy, { action: "jobClockOut", personId: "7", ...extra }, now);
const wPayIn = (now) => kiosk({ action: "clockIn", personId: "7", pin: "1111" }, now);
const wPayOut = (now) => kiosk({ action: "clockOut", personId: "7", pin: "1111" }, now);
const wLunch = (now) => kiosk({ action: "lunchStart", personId: "7", pin: "1111" }, now);
const wLunchEnd = (now) => kiosk({ action: "lunchEnd", personId: "7", pin: "1111" }, now);
const GET_PEOPLE = { fn: "people", method: "GET", auth: AUTH.ada };

// Seed helpers.
const withPerson = (id, patch) => () => {
  const s = orgSeed();
  s[K("people.json")] = s[K("people.json")].map((p) => (String(p.id) === String(id) ? { ...p, ...patch } : p));
  return s;
};
const SESS_W = "sess_7_" + MON("07:00");
const wendyOnO2 = (extraJc = {}, mod) => () => {
  const s = withPerson("7", {
    activeJobClock: {
      clockIn: MON("07:00"), ...O2, sessionId: SESS_W, drainCheckpoint: MON("07:00"), reservoirOpId: "o2",
      sessionSnapshot: [{ opId: "o2", start: "2026-10-13", end: "2026-10-14", startHour: 7, endHour: 15.5, hpd: 16 }],
      ...extraJc,
    },
  })();
  if (mod) mod(s);
  return s;
};
// Whole tree not started, so the clock-in's status push is visible.
const notStarted = () => {
  const s = orgSeed();
  s[K("tasks.json")] = s[K("tasks.json")].map((j) => (j.id !== "j1" ? j : {
    ...j, status: "Not Started",
    subs: j.subs.map((p) => ({ ...p, status: "Not Started", subs: p.subs.map((o) => ({ ...o, status: o.id === "o1" ? o.status : "Not Started" })) })),
  }));
  return s;
};
const basic = (mod) => () => { const s = mod ? mod() : orgSeed(); s[K("billing.json")] = { tier: "basic", lastModifiedAt: "2026-10-01T12:00:00.000Z" }; return s; };

export default [
  // ── jobClockIn ─────────────────────────────────────────────────────────────
  { name: "jobClockIn: worker, no session fields -> server-derived session, op/panel pushed to active", now: MON("07:00"),
    seed: notStarted, steps: [wIn(), GET_PEOPLE] },
  { name: "jobClockIn: job already active keeps its status, panel and op stamped", now: MON("07:00"),
    steps: [wIn()] },
  { name: "jobClockIn: renamed active status is what gets stamped", now: MON("07:00"),
    seed: () => {
      const s = notStarted();
      s[K("settings.json")].statusOpts = s[K("settings.json")].statusOpts.map((o) => (o.isActive ? { ...o, name: "Running" } : o));
      return s;
    }, steps: [wIn()] },
  { name: "jobClockIn: client-sent session fields are authoritative", now: MON("07:00"),
    steps: [wIn(undefined, { sessionId: "sess_client_1", reservoirOpId: "o1", sessionSnapshot: [{ opId: "o2", start: "2026-10-13", end: "2026-10-14", startHour: 7, endHour: 15.5, hpd: 16 }] })] },
  { name: "jobClockIn: explicit reservoirOpId null is preserved, rest derived", now: MON("07:00"),
    steps: [wIn(undefined, { reservoirOpId: null })] },
  { name: "jobClockIn: sessionId only, no snapshot -> no snapshot, no derivation", now: MON("07:00"),
    steps: [wIn(undefined, { sessionId: "sess_client_2" })] },
  { name: "jobClockIn: off-team op derives no reservoir", now: MON("07:00"),
    steps: [post(AUTH.wendy, { action: "jobClockIn", personId: "7", ...O4 })] },
  { name: "jobClockIn: unknown jobId still clocks in, tasks untouched", now: MON("07:00"),
    steps: [post(AUTH.wendy, { action: "jobClockIn", personId: "7", jobId: "j_missing", panelId: null, opId: null })] },
  { name: "jobClockIn: second clock-in refused 409", now: MON("07:00"),
    steps: [wIn(), wIn(MON("07:05"))] },
  { name: "jobClockIn: refusals (missing jobId, someone else, canClockInOut=false, unknown person, no token)", now: MON("07:00"),
    steps: [
      post(AUTH.wendy, { action: "jobClockIn", personId: "7" }),
      post(AUTH.wendy, { action: "jobClockIn", personId: "99", ...O4 }),
      post(AUTH.sam, { action: "jobClockIn", personId: "99", ...O4 }),
      post(AUTH.ada, { action: "jobClockIn", personId: "nobody", ...O2 }),
      post(null, { action: "jobClockIn", personId: "7", ...O2 }),
    ] },
  { name: "jobClockIn: admin clocks in a worker, and a canClockInOut=false worker", now: MON("07:00"),
    steps: [post(AUTH.ada, { action: "jobClockIn", personId: "7", ...O2 }), post(AUTH.ada, { action: "jobClockIn", personId: "99", ...O4 }, MON("07:02"))] },
  { name: "jobClockIn: Basic tier + TIER_RULES_MODE=enforce refused 403 and recorded", now: MON("07:00"),
    seed: basic(), env: { TIER_RULES_MODE: "enforce" }, steps: [wIn()] },
  { name: "jobClockIn: Basic tier in log mode goes through and is recorded", now: MON("07:00"),
    seed: basic(), steps: [wIn()] },
  { name: "jobClockOut: Basic tier + enforce is recorded but not refused", now: MON("10:00"),
    seed: basic(wendyOnO2()), env: { TIER_RULES_MODE: "enforce" }, steps: [wOut()] },

  // ── jobClockOut ────────────────────────────────────────────────────────────
  { name: "day flow: pay in 07:00, job in, kiosk lunch 12:00-12:30, job out 15:30, pay out", now: MON("07:00"),
    steps: [wPayIn(), wIn(MON("07:01")), wLunch(MON("12:00")), GET_PEOPLE, wLunchEnd(MON("12:30")), wOut(MON("15:30")), wPayOut(MON("15:31")),
      { fn: "timeclock", method: "GET", auth: AUTH.wendy, query: { dataset: "productionhours" } }] },
  { name: "day flow: iOS payLunchStart/End pauses the job, kiosk source on clock-out", now: MON("07:00"),
    steps: [wPayIn(), wIn(MON("07:00")),
      post(AUTH.wendy, { action: "payLunchStart", personId: "7" }, MON("12:00")),
      post(AUTH.wendy, { action: "payLunchEnd", personId: "7" }, MON("12:30")),
      wOut(MON("15:30"), { source: "kiosk" })] },
  { name: "day flow: break 10:00-10:15 and lunch both come out of production", now: MON("07:00"),
    steps: [wPayIn(), wIn(MON("07:00")),
      post(AUTH.wendy, { action: "breakBegin", personId: "7" }, MON("10:00")),
      post(AUTH.wendy, { action: "breakClear", personId: "7" }, MON("10:15")),
      wLunch(MON("12:00")), wLunchEnd(MON("12:30")), wOut(MON("15:30")), wPayOut(MON("15:30"))] },
  { name: "jobClockOut: 07:00-10:00 credits 3h to op, panel and job", now: MON("07:00"),
    steps: [wIn(), wOut(MON("10:00"))] },
  { name: "jobClockOut: clocking out while on lunch stops at the lunch start", now: MON("07:00"),
    steps: [wPayIn(), wIn(MON("07:00")), wLunch(MON("12:00")), wOut(MON("12:20"))] },
  { name: "jobClockOut: manual pause 09:00-09:30 excluded", now: MON("07:00"),
    steps: [wIn(), post(AUTH.wendy, { action: "jobPause", personId: "7" }, MON("09:00")),
      post(AUTH.wendy, { action: "jobResume", personId: "7" }, MON("09:30")), wOut(MON("11:00"))] },
  { name: "jobClockOut: clocking out while manually paused", now: MON("07:00"),
    steps: [wIn(), post(AUTH.wendy, { action: "jobPause", personId: "7" }, MON("09:00")), wOut(MON("11:00"))] },
  { name: "jobClockOut: dedupe on (personId, opId, clockIn) skips the row, counters still credited", now: MON("10:00"),
    seed: wendyOnO2({}, (s) => {
      s[K("productionhours.json")].push({ id: "js_dup", personId: 7, jobId: "j1", panelId: "p1", opId: "o2", clockIn: MON("07:00"), clockOut: MON("10:00"), hours: 3, date: "2026-10-19", source: "ios-app", lastModifiedAt: MON("10:00") });
    }), steps: [wOut()] },
  { name: "jobClockOut: tombstoned duplicate does not dedupe", now: MON("10:00"),
    seed: wendyOnO2({}, (s) => {
      s[K("productionhours.json")].push({ id: "js_dead", personId: "7", jobId: "j1", panelId: "p1", opId: "o2", clockIn: MON("07:00"), clockOut: MON("10:00"), hours: 3, date: "2026-10-19", source: "ios-app", deletedAt: MON("09:00"), lastModifiedAt: MON("09:00") });
    }), steps: [wOut()] },
  { name: "jobClockOut: forgotten Friday session capped at Friday's day end", now: MON("08:00"),
    seed: wendyOnO2({ clockIn: FRI("14:00"), sessionId: "sess_7_" + FRI("14:00"), drainCheckpoint: FRI("14:00") }), steps: [wOut()] },
  { name: "jobClockOut: same-instant clock-out credits 0h, writes no row", now: MON("07:00"),
    steps: [wIn(), wOut(MON("07:00"))] },
  { name: "jobClockOut: open break is closed with a payhours breakEnd row", now: MON("07:00"),
    steps: [wIn(), post(AUTH.wendy, { action: "breakBegin", personId: "7", durationMinutes: 10 }, MON("10:00")), wOut(MON("10:05"))] },
  { name: "jobClockOut: shrink startHour inside the cap is applied with a moveLog entry", now: MON("10:00"),
    seed: wendyOnO2(), steps: [wOut(undefined, { startHour: 9.5 })] },
  { name: "jobClockOut: shrink startHour over the cap, log mode records and applies", now: MON("10:00"),
    seed: wendyOnO2(), steps: [wOut(undefined, { startHour: 14 })] },
  { name: "jobClockOut: shrink startHour over the cap, enforce caps it", now: MON("10:00"),
    seed: wendyOnO2(), env: { SCHEDULE_RULES_MODE: "enforce" }, steps: [wOut(undefined, { startHour: 14 })] },
  { name: "jobClockOut: job-only session credits the job, no panel/op", now: MON("07:00"),
    steps: [post(AUTH.wendy, { action: "jobClockIn", personId: "7", jobId: "j2", jobTitle: "Crusher Retrofit" }), wOut(MON("09:00"))] },
  { name: "jobClockOut: not clocked in 409; missing personId 400", now: MON("10:00"),
    steps: [wOut(), post(AUTH.wendy, { action: "jobClockOut" })] },
  { name: "jobClockOut: worker for someone else 403, admin for the worker 200", now: MON("10:00"),
    seed: wendyOnO2(), steps: [post(AUTH.sam, { action: "jobClockOut", personId: "7" }), post(AUTH.ada, { action: "jobClockOut", personId: "7" })] },
  { name: "jobClockOut: canClockInOut=false worker may still clock out", now: MON("10:00"),
    seed: withPerson(99, { activeJobClock: { clockIn: MON("07:00"), ...O4, sessionId: "sess_99_x", drainCheckpoint: MON("07:00"), reservoirOpId: "o4", sessionSnapshot: [] } }),
    steps: [post(AUTH.sam, { action: "jobClockOut", personId: "99" })] },

  // ── updateJobSession ───────────────────────────────────────────────────────
  { name: "updateJobSession: drainCheckpoint + pausedMsAtCheckpoint advance, frozenAtMs stamps pendingSession", now: MON("09:00"),
    seed: wendyOnO2(), steps: [
      post(AUTH.wendy, { action: "updateJobSession", personId: "7", sessionId: SESS_W, drainCheckpoint: MON("08:30"), pausedMsAtCheckpoint: 60000 }),
      post(AUTH.wendy, { action: "updateJobSession", personId: "7", sessionId: SESS_W, frozenAtMs: Date.parse(MON("09:00")) }),
      wOut(MON("11:00")),
    ] },
  { name: "updateJobSession: frozenAtMs write-once, checkpoint never moves back, unclosedAt set", now: MON("10:00"),
    seed: wendyOnO2({ drainCheckpoint: MON("09:00"), frozenAtMs: Date.parse(MON("09:30")) }), steps: [
      post(AUTH.wendy, { action: "updateJobSession", personId: "7", sessionId: SESS_W, drainCheckpoint: MON("08:00"), pausedMsAtCheckpoint: 5, frozenAtMs: Date.parse(MON("09:45")), unclosedAt: MON("09:50") }),
    ] },
  { name: "updateJobSession: bad fields in log mode are recorded and merged", now: MON("09:00"),
    seed: wendyOnO2(), steps: [
      post(AUTH.wendy, { action: "updateJobSession", personId: "7", sessionId: SESS_W, drainCheckpoint: MON("11:00"), pausedMsAtCheckpoint: -4 }),
    ] },
  { name: "updateJobSession: bad fields in enforce mode refused 400", now: MON("09:00"),
    seed: wendyOnO2(), env: { SCHEDULE_RULES_MODE: "enforce" }, steps: [
      post(AUTH.wendy, { action: "updateJobSession", personId: "7", sessionId: SESS_W, drainCheckpoint: "not a time", frozenAtMs: Date.parse(MON("06:00")) }),
    ] },
  { name: "updateJobSession: session mismatch 409, missing sessionId 400, other person 403, not clocked in 409", now: MON("09:00"),
    seed: wendyOnO2(), steps: [
      post(AUTH.wendy, { action: "updateJobSession", personId: "7", sessionId: "sess_old", drainCheckpoint: MON("08:00") }),
      post(AUTH.wendy, { action: "updateJobSession", personId: "7" }),
      post(AUTH.wendy, { action: "updateJobSession", personId: "99", sessionId: "x" }),
      post(AUTH.ada, { action: "updateJobSession", personId: "99", sessionId: "x" }),
    ] },

  // ── jobPause / jobResume ───────────────────────────────────────────────────
  { name: "jobPause/jobResume: refusals (already paused, not paused, not clocked in, someone else)", now: MON("09:00"),
    seed: wendyOnO2(), steps: [
      post(AUTH.wendy, { action: "jobResume", personId: "7" }),
      post(AUTH.wendy, { action: "jobPause", personId: "7" }),
      post(AUTH.wendy, { action: "jobPause", personId: "7" }, MON("09:05")),
      post(AUTH.wendy, { action: "jobPause", personId: "99" }),
      post(AUTH.ada, { action: "jobPause", personId: "99" }),
      post(AUTH.ada, { action: "jobResume", personId: "7" }, MON("09:20")),
      post(AUTH.wendy, { action: "jobPause", personId: "7" }, MON("09:40")),
      post(AUTH.wendy, { action: "jobResume", personId: "7" }, MON("09:50")),
    ] },

  // ── breakBegin / breakClear ────────────────────────────────────────────────
  { name: "breakBegin/breakClear: no job, default 15 minutes, refusals", now: MON("10:00"),
    steps: [
      post(AUTH.wendy, { action: "breakClear", personId: "7" }),
      post(AUTH.wendy, { action: "breakBegin", personId: "7" }),
      post(AUTH.wendy, { action: "breakBegin", personId: "7" }, MON("10:01")),
      post(AUTH.wendy, { action: "breakBegin", personId: "99" }),
      post(AUTH.wendy, { action: "breakClear", personId: "7" }, MON("10:15")),
    ] },
  { name: "breakClear does not resume a job the worker paused by hand", now: MON("09:00"),
    seed: wendyOnO2(), steps: [
      post(AUTH.wendy, { action: "jobPause", personId: "7" }),
      post(AUTH.wendy, { action: "breakBegin", personId: "7" }, MON("10:00")),
      post(AUTH.wendy, { action: "breakClear", personId: "7" }, MON("10:15")),
      GET_PEOPLE,
    ] },

  // ── releaseJobSession ──────────────────────────────────────────────────────
  { name: "releaseJobSession resume: un-freezes and keeps the worker on the job", now: MON("09:00"),
    seed: wendyOnO2({ frozenAtMs: Date.parse(MON("08:30")), unclosedAt: MON("08:45") }), steps: [
      post(AUTH.rita, { action: "releaseJobSession", personId: "7", sessionId: SESS_W, outcome: "resume" }),
      wOut(MON("10:00")),
    ] },
  { name: "releaseJobSession clear: ends the session, nothing credited", now: MON("09:00"),
    seed: wendyOnO2({ frozenAtMs: Date.parse(MON("08:30")) }), steps: [
      post(AUTH.wendy, { action: "releaseJobSession", personId: "7", outcome: "clear" }),
      wOut(MON("09:01")),
    ] },
  { name: "releaseJobSession: no-ops and refusals", now: MON("09:00"),
    seed: wendyOnO2(), steps: [
      post(AUTH.ada, { action: "releaseJobSession", personId: "7", sessionId: "sess_ended", outcome: "clear" }),
      post(AUTH.ada, { action: "releaseJobSession", personId: "99", outcome: "clear" }),
      post(AUTH.ada, { action: "releaseJobSession", personId: "7", outcome: "approve" }),
      post(AUTH.sam, { action: "releaseJobSession", personId: "7", outcome: "resume" }),
      post(AUTH.ada, { action: "releaseJobSession", personId: "nobody", outcome: "resume" }),
      post(AUTH.ada, { action: "releaseJobSession", outcome: "resume" }),
    ] },

  // ── setOpWorkedHours ───────────────────────────────────────────────────────
  { name: "setOpWorkedHours: editJobs admin sets the op counter", steps: [post(AUTH.rita, { action: "setOpWorkedHours", opId: "o2", hours: 5.257 })] },
  { name: "setOpWorkedHours: refusals (worker, negative, missing, unknown op)", steps: [
    post(AUTH.wendy, { action: "setOpWorkedHours", opId: "o2", hours: 1 }),
    post(AUTH.ada, { action: "setOpWorkedHours", opId: "o2", hours: -1 }),
    post(AUTH.ada, { action: "setOpWorkedHours", hours: 1 }),
    post(AUTH.ada, { action: "setOpWorkedHours", opId: "o_missing", hours: 1 }),
    post(AUTH.ada, { action: "setOpWorkedHours", opId: "o3", hours: "2" }),
  ] },

  // ── adminJobHours ──────────────────────────────────────────────────────────
  { name: "adminJobHours: positive credit writes a manual row and credits the panel", steps: [
    post(AUTH.ada, { action: "adminJobHours", personId: "7", ...O2, hours: 2.5, date: "2026-10-13" }),
  ] },
  { name: "adminJobHours: positive credit with no date uses today's local day", now: MON("20:00"), steps: [
    post(AUTH.ada, { action: "adminJobHours", personId: "7", jobId: "j1", panelId: "p1", opId: "o2", hours: "1.234" }),
  ] },
  { name: "adminJobHours: negative partly consumes the newest manual row", steps: [
    post(AUTH.ada, { action: "adminJobHours", personId: "7", jobId: "j1", panelId: "p1", opId: "o1", hours: -0.2 }),
  ] },
  { name: "adminJobHours: negative beyond manual rows writes an adjustment capped at the op total", steps: [
    post(AUTH.ada, { action: "adminJobHours", personId: "7", jobId: "j1", panelId: "p1", opId: "o1", hours: -100, date: "2026-10-14" }),
  ] },
  { name: "adminJobHours: refusals, zero, non-numeric, and a walk-back on an op with no rows", steps: [
    post(AUTH.rita, { action: "adminJobHours", personId: "7", ...O2, hours: 1 }),
    post(AUTH.wendy, { action: "adminJobHours", personId: "7", ...O2, hours: 1 }),
    post(AUTH.ada, { action: "adminJobHours", personId: "7", hours: 1 }),
    post(AUTH.ada, { action: "adminJobHours", personId: "7", ...O2, hours: 0 }),
    post(AUTH.ada, { action: "adminJobHours", personId: "7", ...O2, hours: "abc" }),
    post(AUTH.ada, { action: "adminJobHours", personId: "7", ...O2, hours: -3 }),
  ] },

  // ── finishRequest (PIN) ────────────────────────────────────────────────────
  { name: "finishRequest: new request freezes the session on that op and posts to the group", now: MON("07:00"),
    steps: [wIn(), kiosk({ action: "finishRequest", personId: "7", pin: "1111", jobId: "j1", panelId: "p1", opId: "o2", personName: "Spoofed" }, MON("11:00")),
      wOut(MON("12:00"))] },
  { name: "finishRequest: a second request is alreadyOpen", now: MON("11:00"),
    steps: [kiosk({ action: "finishRequest", personId: "7", pin: "1111", jobId: "j1", panelId: "p1", opId: "o2" }),
      kiosk({ action: "finishRequest", personId: "7", pin: "1111", jobId: "j1", panelId: "p1", opId: "o2" }, MON("11:01"))] },
  { name: "finishRequest: no admin can approve -> noApprover", now: MON("11:00"),
    seed: () => {
      const s = orgSeed();
      s[K("people.json")] = s[K("people.json")].map((p) => (p.userRole === "admin" ? { ...p, adminPerms: { ...(p.adminPerms || {}), approveCompletions: false } } : p));
      return s;
    },
    steps: [kiosk({ action: "finishRequest", personId: "7", pin: "1111", jobId: "j1", panelId: "p1", opId: "o2" })] },
  { name: "finishRequest: worker not on the op's team refused 403, and the session on it is not frozen (#560)", now: MON("07:00"),
    steps: [post(AUTH.wendy, { action: "jobClockIn", personId: "7", ...O4 }),
      kiosk({ action: "finishRequest", personId: "7", pin: "1111", jobId: "j1", panelId: "p2", opId: "o4" }, MON("09:00")), GET_PEOPLE] },
  { name: "finishRequest: admin via PIN may request off-team", now: MON("11:00"),
    steps: [kiosk({ action: "finishRequest", personId: "1", pin: "4321", jobId: "j1", panelId: "p2", opId: "o4" })] },
  { name: "finishRequest: unknown op 404, missing ids 400", now: MON("11:00"),
    steps: [kiosk({ action: "finishRequest", personId: "7", pin: "1111", jobId: "j1", panelId: "p1", opId: "o_missing" }),
      kiosk({ action: "finishRequest", personId: "7", pin: "1111", jobId: "j1", opId: "o2" })] },

  // ── GET productionhours ────────────────────────────────────────────────────
  { name: "GET productionhours: admin sees every live row, full fields; personId filter", seed: () => {
      const s = orgSeed();
      s[K("productionhours.json")].push(
        { id: "js_sam", personId: 99, jobId: "j1", panelId: "p2", opId: "o4", jobTitle: "Lift Station 4", panelTitle: "RTU", opTitle: "Fab enclosure", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T15:00:00.000Z", hours: 2, date: "2026-10-13", source: "kiosk", lastModifiedAt: "2026-10-13T15:00:00.000Z" },
        { id: "js_gone", personId: "7", jobId: "j1", panelId: "p1", opId: "o2", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T14:00:00.000Z", hours: 1, date: "2026-10-13", source: "ios-app", deletedAt: "2026-10-13T16:00:00.000Z", lastModifiedAt: "2026-10-13T16:00:00.000Z" });
      return s;
    }, steps: [
      { fn: "timeclock", method: "GET", auth: AUTH.ada, query: { dataset: "productionhours" } },
      { fn: "timeclock", method: "GET", auth: AUTH.ada, query: { dataset: "productionhours", personId: "99" } },
      { fn: "timeclock", method: "GET", auth: AUTH.ada, query: { dataset: "jobsessions", personId: "7" } },
    ] },
  { name: "GET productionhours: worker gets own rows whole, others projected", seed: () => {
      const s = orgSeed();
      s[K("productionhours.json")].push(
        { id: "js_sam", personId: 99, jobId: "j1", panelId: "p2", opId: "o4", jobTitle: "Lift Station 4", panelTitle: "RTU", opTitle: "Fab enclosure", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T15:00:00.000Z", hours: 2, date: "2026-10-13", source: "kiosk", enteredBy: "1", lastModifiedAt: "2026-10-13T15:00:00.000Z" });
      return s;
    }, steps: [
      { fn: "timeclock", method: "GET", auth: AUTH.sam, query: { dataset: "productionhours" } },
      { fn: "timeclock", method: "GET", auth: AUTH.sam, query: { dataset: "productionhours", personId: "7" } },
      { fn: "timeclock", method: "GET", auth: AUTH.wendy, query: { dataset: "jobsessions" } },
      { fn: "timeclock", method: "GET", auth: AUTH.wendy, query: {} },
    ] },
  { name: "GET productionhours: no token 401", auth: null, steps: [{ fn: "timeclock", method: "GET", query: { dataset: "productionhours" } }] },
];
