// Concurrency on tasks.json and people.json — SCHEDULE_MAP root cause 3 (#185).
//
//   node scripts/concurrency-test.mjs
//
// REAL tasks.js + timeclock.js + timestamps.js on an in-memory S3 that has S3's
// conditional-write semantics (see timeclock-itest-loader.mjs S3_STUB). Two bugs:
//
//   1. Stale job copies. A client POSTs its whole array; a job it holds from
//      before a server write (clock-in status, clock-out hours, a finish request)
//      overwrote that write. Fixed per job by lastModifiedAt: a POSTed job whose
//      stamp is not the stored one keeps the stored version and is reported in
//      `conflicts`. Behind TASK_CONFLICT_MODE — off | log | enforce, default log.
//   2. Read-modify-write with no lock. tasks.js and timeclock.js both read the
//      file, change it and write it back; a write landing in between was lost.
//      Fixed with conditional writes (If-Match on the ETag, retry on 412). Not
//      behind a mode — a retry refuses nothing.
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let tc, tasksFn;
try {
  tc = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler;
  tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the handlers under test:", e); process.exit(2); }

const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json" };
const ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const WORKER = { personId: "7", isAdmin: false, email: "w@x" };
const OLD = "2026-09-30T10:00:00.000Z";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// Structured log lines the handlers emit (console.warn of a JSON object with a tag).
let logs = [];
const realWarn = console.warn;
console.warn = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("{")) { try { const o = JSON.parse(a[0]); if (o.tag) { logs.push(o); return; } } catch {} }
  realWarn(...a);
};
const tagged = (tag) => logs.filter(l => l.tag === tag);

const reset = ({ conflictMode } = {}) => {
  if (conflictMode === undefined) delete process.env.TASK_CONFLICT_MODE; else process.env.TASK_CONFLICT_MODE = conflictMode;
  logs = [];
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__PRECONDITION_FAILURES = [];
  globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    // A 24/7 calendar with no lunch or breaks, so productive hours == wall clock and the
    // hours assertions below do not depend on what time of day the suite is run. Since #194
    // jobClockOut measures through productiveHoursBetween; with the real 07:00-15:00 window
    // this fixture passed in the afternoon and credited 0h in the evening. The calendar has
    // its own coverage in session-hours-test; this suite is about permissions and plumbing.
    [K.settings]: { timeZone: "America/Denver", workStart: "00:00", workEnd: "24:00", workDays: [0,1,2,3,4,5,6], lunch: { durationMinutes: 0 }, breaks: [] },
    [K.people]: [
      { id: 1, name: "Admin", userRole: "admin", lastModifiedAt: OLD },
      { id: 7, name: "Wendy", userRole: "user", pin: "1234", lastModifiedAt: OLD,
        activeClockIn: { clockIn: new Date(Date.now() - 5 * 3600e3).toISOString() } },
    ],
    [K.tasks]: [
      { id: "JOB", title: "Job", status: "Not Started", loggedHours: 2, lastModifiedAt: OLD,
        subs: [{ id: "PANEL", title: "Panel", status: "Not Started", loggedHours: 2,
          subs: [{ id: "OP", title: "Op", status: "Not Started", loggedHours: 2, team: [7] },
                 { id: "OP2", title: "Op 2", status: "Not Started", loggedHours: 0, team: [7] }] }] },
      { id: "JOB2", title: "Other job", subs: [], lastModifiedAt: OLD },
    ],
  };
};
const as = (who) => { globalThis.__AUTH = { ...who }; };
const clock = (b) => tc({ httpMethod: "POST", headers: {}, body: JSON.stringify(b) });
const post = (t) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(t) });
const clone = (x) => JSON.parse(JSON.stringify(x));
const job = (id) => globalThis.__S3[K.tasks].find(j => j.id === id);
const op = () => job("JOB").subs[0].subs[0];
const person = (id) => globalThis.__S3[K.people].find(p => String(p.id) === String(id));
const clockIn = (opId = "OP", sessionId = "S1") => clock({ action: "jobClockIn", personId: 7, jobId: "JOB", panelId: "PANEL", opId, sessionId, reservoirOpId: opId, sessionSnapshot: [] });
// Worker session: clock in, 1.5h on it, clock out, raise a finish request — four server writes to JOB.
async function workerSession() {
  as(WORKER);
  await clockIn();
  person(7).activeJobClock.clockIn = new Date(Date.now() - 1.5 * 3600e3).toISOString();
  await clock({ action: "jobClockOut", personId: 7 });
  await clock({ action: "finishRequest", jobId: "JOB", panelId: "PANEL", opId: "OP", personId: 7, pin: "1234" });
}
const opState = () => [op().status, op().loggedHours, op().pendingFinish ?? null, (op().finishRequests || []).length];
const WORKED = ["In Progress", 3.5, true, 1];

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Stale job copy — TASK_CONFLICT_MODE=enforce");
reset({ conflictMode: "enforce" });
{
  const adminCopy = clone(globalThis.__S3[K.tasks]);          // loaded before the session
  await workerSession();
  ok("the worker's session is stored", opState(), WORKED);
  adminCopy[1].title = "Other job (renamed)";
  as(ADMIN);
  const res = await post(adminCopy);
  ok("admin's POST still succeeds", res.statusCode, 200);
  ok("the stale job is reported", res.body?.conflicts, ["JOB"]);
  ok("the worker's status, hours and finish request survive", opState(), WORKED);
  ok("the admin's edit to the fresh job is applied", job("JOB2").title, "Other job (renamed)");
  ok("a conflict log line names the job", tagged("task-conflict").map(l => [l.mode, l.jobId]), [["enforce", "JOB"]]);
}
reset({ conflictMode: "enforce" });
{
  await workerSession();
  const fresh = clone(globalThis.__S3[K.tasks]);              // loaded AFTER the session
  fresh[0].title = "Job (renamed)";
  as(ADMIN);
  const res = await post(fresh);
  ok("control: a fresh copy of the same job applies with no conflict", [res.statusCode, res.body?.conflicts, job("JOB").title, opState()],
     [200, [], "Job (renamed)", WORKED]);
}
reset({ conflictMode: "enforce" });
{
  const t = clone(globalThis.__S3[K.tasks]);
  t.push({ id: "JOB3", title: "New job", subs: [] });
  as(ADMIN);
  const res = await post(t);
  ok("control: a new job has no stamp to conflict with", [res.statusCode, res.body?.conflicts, !!job("JOB3")], [200, [], true]);
}

console.log("\n2. Stale job copy — log mode (the default) and off");
reset();
{
  const adminCopy = clone(globalThis.__S3[K.tasks]);
  await workerSession();
  adminCopy[1].title = "Other job (renamed)";
  as(ADMIN);
  const res = await post(adminCopy);
  // The stale copy still lands in log mode — that is what log mode means. What changed is
  // that loggedHours does NOT come back with it: since #323 the server restores the stored
  // counter on every whole-tree POST, regardless of mode. Status, pendingFinish and the
  // request list are still clobbered here, which is precisely the damage enforce exists to
  // stop, and precisely why leaving that switch at its default was not harmless.
  ok("log: the stale copy is still written — but the counter survives it",
    [res.statusCode, opState()], [200, ["Not Started", 3.5, null, 0]]);
  ok("log: no conflicts reported to the client", res.body?.conflicts ?? null, null);
  ok("log: the would-be conflict is logged", tagged("task-conflict").map(l => [l.mode, l.jobId]), [["log", "JOB"]]);
}
reset({ conflictMode: "off" });
{
  const adminCopy = clone(globalThis.__S3[K.tasks]);
  await workerSession();
  as(ADMIN);
  await post(adminCopy);
  ok("off: no conflict log", tagged("task-conflict").length, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. A write inside another handler's read-modify-write window (conditional writes)");
reset();
{
  // jobClockOut reads tasks.json; before it writes, an admin renames JOB2.
  as(WORKER); await clockIn();
  person(7).activeJobClock.clockIn = new Date(Date.now() - 1.5 * 3600e3).toISOString();
  let fired = false;
  globalThis.__BEFORE_WRITE = async (key) => {
    if (key !== K.tasks || fired) return; fired = true;
    const t = clone(globalThis.__S3[K.tasks]); t[1].title = "Renamed mid-clock-out";
    as(ADMIN); const r = await post(t); as(WORKER);
    if (r.statusCode !== 200) throw new Error("competing POST failed: " + r.statusCode);
  };
  const res = await clock({ action: "jobClockOut", personId: 7 });
  globalThis.__BEFORE_WRITE = null;
  ok("clock-out succeeds", res.statusCode, 200);
  ok("the clock-out's write retried after the precondition failed", globalThis.__PRECONDITION_FAILURES.filter(k => k === K.tasks).length >= 1, true);
  ok("the admin's rename survives", job("JOB2").title, "Renamed mid-clock-out");
  ok("the clock-out's hours are credited", op().loggedHours, 3.5);
}
reset({ conflictMode: "enforce" });
{
  // An admin's POST reads tasks.json; before it writes, the worker clocks out.
  as(WORKER); await clockIn();
  person(7).activeJobClock.clockIn = new Date(Date.now() - 1.5 * 3600e3).toISOString();
  const adminCopy = clone(globalThis.__S3[K.tasks]);          // fresh: loaded after clock-in
  adminCopy[1].title = "Renamed by admin";
  let fired = false;
  globalThis.__BEFORE_WRITE = async (key) => {
    if (key !== K.tasks || fired) return; fired = true;
    as(WORKER); const r = await clock({ action: "jobClockOut", personId: 7 }); as(ADMIN);
    if (r.statusCode !== 200) throw new Error("competing clock-out failed: " + r.statusCode);
  };
  as(ADMIN);
  const res = await post(adminCopy);
  globalThis.__BEFORE_WRITE = null;
  ok("admin's POST succeeds after retrying", res.statusCode, 200);
  ok("the clock-out's hours survive (the retry saw JOB go stale)", [op().loggedHours, res.body?.conflicts], [3.5, ["JOB"]]);
  ok("the admin's rename is applied", job("JOB2").title, "Renamed by admin");
}

console.log("\n4. One live job clock per person under a race (INV #5)");
reset();
{
  let second = null, fired = false;
  globalThis.__BEFORE_WRITE = async (key) => {
    if (key !== K.people || fired) return; fired = true;
    second = await clockIn("OP2", "S2");
  };
  as(WORKER);
  const first = await clockIn("OP", "S1");
  globalThis.__BEFORE_WRITE = null;
  ok("exactly one clock-in wins", [first.statusCode, second?.statusCode].sort(), [200, 409]);
  ok("the stored session is the winner's", person(7).activeJobClock?.sessionId, "S2");
}

console.log("\n5. Retries are bounded");
reset();
{
  globalThis.__BEFORE_WRITE = async (key) => {
    if (key !== K.tasks) return;
    const cur = globalThis.__S3[K.tasks]; globalThis.__S3[K.tasks] = clone(cur);
    globalThis.__ETAGS[K.tasks] = String(Number(globalThis.__ETAGS[K.tasks] ?? 0) + 1);   // someone always writes first
  };
  const t = clone(globalThis.__S3[K.tasks]); t[1].title = "Never lands";
  as(ADMIN);
  const res = await post(t);
  globalThis.__BEFORE_WRITE = null;
  ok("gives up with a 503 instead of looping", res.statusCode, 503);
  ok("and wrote nothing", job("JOB2").title, "Other job");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. Server-owned counters (#323): a new node still brings its own");
// The protection applies only to nodes the stored tree already has. If it applied to every
// node, a split could not write loggedHours: 0 onto the op it creates and the new bar would
// inherit the parent's hours. Posted as an admin because creating a job needs editJobs.
reset();
{
  as(ADMIN);
  const t = clone(globalThis.__S3[K.tasks]);
  t.push({ id: "JOBN", title: "Fresh", status: "Not Started", loggedHours: 0,
    subs: [{ id: "PN", title: "P", loggedHours: 0, subs: [{ id: "ON", title: "O", loggedHours: 0 }] }] });
  const res = await post(t);
  const fresh = globalThis.__S3[K.tasks].find(j => j.id === "JOBN");
  ok("a brand-new node keeps the counter it was created with",
    [res.statusCode, fresh?.loggedHours, fresh?.subs?.[0]?.loggedHours, fresh?.subs?.[0]?.subs?.[0]?.loggedHours], [200, 0, 0, 0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
