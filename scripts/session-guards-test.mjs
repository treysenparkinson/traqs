// Session-field guards — SCHEDULE_MAP root cause 3 (#195, #198, #287).
//
//   node scripts/session-guards-test.mjs
//
// REAL timeclock.js and people.js on an in-memory S3, in each SCHEDULE_RULES_MODE
// (off | log, the default | enforce):
//   #195 updateJobSession validates each field before merging it.
//   #198 people PATCH pins activeJobClock/activeClockIn/activeBreak for every
//        caller; only the timeclock actions write them.
//   #287 jobClockOut caps the proposed shrink startHour at the stored edge plus
//        the hours the server counted for the session.
// Refusals, pins and caps happen only in enforce; log records what would have.
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

let tc, peopleFn;
try {
  tc = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler;
  peopleFn = (await import(new URL("../netlify/functions/people.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the handlers under test:", e); process.exit(2); }

const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json" };
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
let logs = [];
const realWarn = console.warn;
console.warn = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("{")) { try { const o = JSON.parse(a[0]); if (o.tag) { logs.push(o); return; } } catch {} }
  realWarn(...a);
};
const guardLogs = () => logs.filter(l => l.tag === "session-guard").map(l => [l.mode, l.guard, l.field ?? null]);

const WORKER = { personId: "7", isAdmin: false, email: "w@x" };
const ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const CLOCK_IN_AGO_H = 2;
const reset = (mode) => {
  if (mode === undefined) delete process.env.SCHEDULE_RULES_MODE; else process.env.SCHEDULE_RULES_MODE = mode;
  logs = [];
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver", workStart: "07:00", workEnd: "15:00" },
    [K.people]: [
      { id: 1, name: "Admin", userRole: "admin" },
      { id: 7, name: "Wendy", userRole: "user", color: "#111",
        activeClockIn: { clockIn: new Date(Date.now() - 5 * 3600e3).toISOString() } },
    ],
    [K.tasks]: [{ id: "JOB", title: "Job", subs: [{ id: "PANEL", title: "Panel",
      subs: [{ id: "OP", title: "Op", status: "In Progress", start: "2026-09-30", end: "2026-09-30", startHour: 7, endHour: 15, team: [7] }] }] }],
  };
  globalThis.__AUTH = { ...WORKER };
};
const clock = (b) => tc({ httpMethod: "POST", headers: {}, body: JSON.stringify(b) });
const patch = (personId, fields) => peopleFn({ httpMethod: "PATCH", headers: {}, body: JSON.stringify({ personId, fields }) });
const person = (id) => globalThis.__S3[K.people].find(p => String(p.id) === String(id));
const op = () => globalThis.__S3[K.tasks][0].subs[0].subs[0];
async function startSession() {
  const r = await clock({ action: "jobClockIn", personId: 7, jobId: "JOB", panelId: "PANEL", opId: "OP", sessionId: "S1", reservoirOpId: "OP", sessionSnapshot: [] });
  if (r.statusCode !== 200) throw new Error("clock-in failed: " + JSON.stringify(r.body));
  const jc = person(7).activeJobClock;
  jc.clockIn = jc.drainCheckpoint = new Date(Date.now() - CLOCK_IN_AGO_H * 3600e3).toISOString();
  return jc;
}
const ujs = (fields) => clock({ action: "updateJobSession", personId: 7, sessionId: "S1", ...fields });
const iso = (hoursFromNow) => new Date(Date.now() + hoursFromNow * 3600e3).toISOString();
const ms = (hoursFromNow) => Date.now() + hoursFromNow * 3600e3;

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. #195 updateJobSession — enforce");
const BAD = [
  ["frozenAtMs not a number", { frozenAtMs: "soon" }, "frozenAtMs"],
  ["frozenAtMs before clock-in", { frozenAtMs: ms(-3) }, "frozenAtMs"],
  ["frozenAtMs in the future", { frozenAtMs: ms(1) }, "frozenAtMs"],
  ["drainCheckpoint not a time", { drainCheckpoint: "yesterday" }, "drainCheckpoint"],
  ["drainCheckpoint before clock-in", { drainCheckpoint: iso(-3) }, "drainCheckpoint"],
  ["drainCheckpoint in the future", { drainCheckpoint: iso(1) }, "drainCheckpoint"],
  ["pausedMsAtCheckpoint negative", { pausedMsAtCheckpoint: -1 }, "pausedMsAtCheckpoint"],
  ["pausedMsAtCheckpoint over elapsed", { pausedMsAtCheckpoint: 3 * 3600e3 }, "pausedMsAtCheckpoint"],
  ["unclosedAt before clock-in", { unclosedAt: iso(-3) }, "unclosedAt"],
];
for (const [label, fields, field] of BAD) {
  reset("enforce"); await startSession();
  const before = JSON.stringify(person(7).activeJobClock);
  const res = await ujs(fields);
  ok(`${label}: 400, nothing merged, logged`, [res.statusCode, JSON.stringify(person(7).activeJobClock) === before, guardLogs()],
     [400, true, [["enforce", "updateJobSession", field]]]);
}
reset("enforce"); await startSession();
{
  const res = await ujs({ frozenAtMs: ms(-0.5), drainCheckpoint: iso(-1), pausedMsAtCheckpoint: 600000, unclosedAt: iso(-0.25) });
  ok("valid values merge", [res.statusCode, person(7).activeJobClock.pausedMsAtCheckpoint], [200, 600000]);
  const res2 = await ujs({ frozenAtMs: ms(2 / 60) });   // two minutes of skew
  ok("a frozenAtMs within the 5-minute skew allowance merges", res2.statusCode, 200);
}

console.log("\n2. #195 updateJobSession — log (default) and off");
reset(); await startSession();
{
  const res = await ujs({ frozenAtMs: "soon" });
  ok("log: merged as before, logged", [res.statusCode, person(7).activeJobClock.frozenAtMs, guardLogs()], [200, "soon", [["log", "updateJobSession", "frozenAtMs"]]]);
}
reset("off"); await startSession();
{
  const res = await ujs({ frozenAtMs: "soon" });
  ok("off: merged, not logged", [res.statusCode, guardLogs()], [200, []]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. #198 people PATCH — enforce");
const FORGED = { clockIn: iso(-10), jobId: "JOB", panelId: "PANEL", opId: "OP" };
for (const [who, auth] of [["worker on their own row", WORKER], ["admin", ADMIN]]) {
  reset("enforce");
  globalThis.__AUTH = { ...auth };
  const before = JSON.stringify([person(7).activeJobClock ?? null, person(7).activeClockIn, person(7).activeBreak ?? null]);
  const res = await patch(7, { color: "#222", activeJobClock: FORGED, activeClockIn: { clockIn: iso(-20) }, activeBreak: { startedAt: iso(-1) } });
  ok(`${who}: 200, session fields untouched`, [res.statusCode, JSON.stringify([person(7).activeJobClock ?? null, person(7).activeClockIn, person(7).activeBreak ?? null]) === before], [200, true]);
  ok(`${who}: the other field still applies`, person(7).color, "#222");
  ok(`${who}: each pinned field is logged`, guardLogs().sort(), [["enforce", "peoplePatch", "activeBreak"], ["enforce", "peoplePatch", "activeClockIn"], ["enforce", "peoplePatch", "activeJobClock"]]);
}
reset();
{
  const res = await patch(7, { activeJobClock: FORGED });
  ok("log: merged as before, logged", [res.statusCode, person(7).activeJobClock?.clockIn, guardLogs()], [200, FORGED.clockIn, [["log", "peoplePatch", "activeJobClock"]]]);
}
reset("enforce");
{
  const res = await patch(7, { color: "#333" });
  ok("control: a PATCH without session fields logs nothing", [res.statusCode, person(7).color, guardLogs()], [200, "#333", []]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. #287 jobClockOut startHour cap — enforce");
// 2h on the session: the edge can move at most 2h past the stored 7.0.
reset("enforce"); await startSession();
{
  const res = await clock({ action: "jobClockOut", personId: 7, startHour: 13 });
  ok("a startHour beyond stored + worked is capped", [res.statusCode, op().startHour], [200, 9]);
  ok("the moveLog records the capped value", op().moveLog?.at(-1)?.toStartHour, 9);
  ok("the cap is logged", guardLogs(), [["enforce", "shrinkStartHour", "startHour"]]);
}
reset("enforce"); await startSession();
{
  const res = await clock({ action: "jobClockOut", personId: 7, startHour: 8.5 });
  ok("control: within stored + worked it applies as proposed, no log", [res.statusCode, op().startHour, guardLogs()], [200, 8.5, []]);
}
reset(); await startSession();
{
  const res = await clock({ action: "jobClockOut", personId: 7, startHour: 13 });
  ok("log: applied as proposed, logged", [res.statusCode, op().startHour, guardLogs()], [200, 13, [["log", "shrinkStartHour", "startHour"]]]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
