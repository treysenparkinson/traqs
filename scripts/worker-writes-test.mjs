// Worker (non-admin) session writes, end to end against the REAL timeclock.js and
// tasks.js handlers on an in-memory S3 and fake auth (same loader as
// timeclock-itest).
//
//   node scripts/worker-writes-test.mjs
//
// SCHEDULE_MAP root cause 2 (#181): every worker task write 403'd because the
// fields a clock action changes were POSTed through /tasks, which demands
// editJobs for them. The contract this suite holds:
//   - clock-in status, end-job hours, the shrink startHour and the freeze stamp
//     are written by the timeclock action the worker already makes;
//   - raising a finish request stays on /tasks and needs no permission, but only
//     as the caller and only as a new pending request;
//   - everything else a worker could POST still 403s (the negative controls).
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

let timeclock, tasksFn;
try {
  timeclock = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler;
  tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
} catch (e) {
  console.error("could not load the handlers under test:", e);
  process.exit(2);
}
if (typeof timeclock !== "function" || typeof tasksFn !== "function") { console.error("handler missing"); process.exit(2); }

const K = {
  people: "orgs/TESTORG/people.json",
  tasks: "orgs/TESTORG/tasks.json",
  settings: "orgs/TESTORG/settings.json",
};

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const WORKER = "7", OTHER = "8";
const reset = () => {
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver", workStart: "07:00", workEnd: "15:00" },
    [K.people]: [
      { id: 7, name: "Wendy Worker", userRole: "user", activeClockIn: { clockIn: new Date(Date.now() - 4 * 3600e3).toISOString() } },
      { id: 8, name: "Oscar Other", userRole: "user" },
    ],
    [K.tasks]: [{
      id: "JOB", title: "Job", status: "Not Started", loggedHours: 2,
      subs: [{
        id: "PANEL", title: "Panel", status: "Not Started", loggedHours: 2,
        subs: [{ id: "OP", title: "Op", status: "Not Started", loggedHours: 2, team: [7],
                 start: "2026-09-30", end: "2026-09-30", startHour: 7, endHour: 15 }],
      }],
    }],
  };
  globalThis.__WRITES = [];
  globalThis.__AUTH = { personId: WORKER, isAdmin: false, email: "w@x.com" };
};
const clock = (body) => timeclock({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const postTasks = (tasks) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(tasks) });
const stored = () => JSON.parse(JSON.stringify(globalThis.__S3[K.tasks]));
const job = () => globalThis.__S3[K.tasks][0];
const panel = () => job().subs[0];
const op = () => panel().subs[0];
const person = (id) => globalThis.__S3[K.people].find(p => String(p.id) === String(id));
const clockIn = () => clock({ action: "jobClockIn", personId: 7, jobId: "JOB", panelId: "PANEL", opId: "OP",
  sessionId: "S1", reservoirOpId: "OP", sessionSnapshot: [] });
// Backdate the session so there is time on it to credit.
const backdate = (hours) => { const jc = person(7).activeJobClock; jc.clockIn = jc.drainCheckpoint = new Date(Date.now() - hours * 3600e3).toISOString(); };

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Clock-in: the action sets status on the op, its panel and its job");
reset();
{
  const res = await clockIn();
  ok("jobClockIn as the worker", res.statusCode, 200);
  ok("op status", op().status, "In Progress");
  ok("panel status (the field the client used to POST)", panel().status, "In Progress");
  ok("job status", job().status, "In Progress");
  // The web still renders the change optimistically; if its autosave ever
  // re-POSTs that tree, it now matches what is stored and is a no-op.
  ok("re-POST of the clocked-in tree is a no-op, not a 403", (await postTasks(stored())).statusCode, 200);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. End job: hours are credited server-side; the shrink startHour rides the clock-out");
reset();
{
  await clockIn(); backdate(1.5);
  const res = await clock({ action: "jobClockOut", personId: 7, startHour: 8.5 });
  ok("jobClockOut as the worker", res.statusCode, 200);
  ok("returned hours", res.body.hours, 1.5);
  ok("job loggedHours", job().loggedHours, 3.5);
  ok("panel loggedHours", panel().loggedHours, 3.5);
  ok("op loggedHours", op().loggedHours, 3.5);
  ok("op startHour raised to the proposed edge", op().startHour, 8.5);
  const log = (op().moveLog || []).at(-1) || {};
  ok("moveLog entry written by the server", [log.fromStartHour, log.toStartHour, log.sessionId, log.movedBy],
     [7, 8.5, "S1", "Wendy Worker"]);
}
console.log("   bounds on the proposed startHour");
for (const [label, sh, want] of [
  ["lower than stored is ignored (raise-only)", 6, 7],
  ["equal to stored is ignored", 7, 7],
  ["past endHour minus the 5-minute floor is ignored", 14.99, 7],
  ["at endHour is ignored", 15, 7],
  ["non-numeric is ignored", "9", 7],
]) {
  reset(); await clockIn(); backdate(1);
  const res = await clock({ action: "jobClockOut", personId: 7, startHour: sh });
  ok(`${label} (clock-out still 200)`, [res.statusCode, op().startHour, (op().moveLog || []).length], [200, want, 0]);
}
reset();
{
  await clockIn(); backdate(1);
  op().status = "Finished";
  await clock({ action: "jobClockOut", personId: 7, startHour: 9 });
  ok("a Finished op is never moved", op().startHour, 7);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. Freeze: updateJobSession stamps pendingSession from the server's session");
reset();
{
  await clockIn();
  const res = await clock({ action: "updateJobSession", personId: 7, sessionId: "S1", frozenAtMs: 1234 });
  ok("updateJobSession as the worker", res.statusCode, 200);
  const ps = op().pendingSession || {};
  ok("pendingSession stamped on the session's op", [ps.sessionId, ps.frozenAtMs, ps.reservoirOpId, ps.clockIn === person(7).activeJobClock.clockIn],
     ["S1", 1234, "OP", true]);
  const again = await clock({ action: "updateJobSession", personId: 7, sessionId: "S1", drainCheckpoint: new Date().toISOString() });
  ok("a checkpoint-only update does not restamp or clear it", [again.statusCode, op().pendingSession?.frozenAtMs], [200, 1234]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Finish request: raising one as yourself passes; anything else still needs approval");
const raise = (by, { singular = true, list = true } = {}) => {
  const t = stored();
  const o = t[0].subs[0].subs[0];
  if (singular) o.finishRequest = { requestId: "R1", by, byName: "x", at: "2026-09-30T12:00:00Z" };
  if (list) o.finishRequests = [...(o.finishRequests || []), { id: "R1", by, byName: "x", at: "2026-09-30T12:00:00Z", status: "pending" }];
  return t;
};
reset();
ok("raise as yourself (finishRequest + finishRequests)", (await postTasks(raise(WORKER))).statusCode, 200);
reset();
ok("raise on behalf of someone else", (await postTasks(raise(OTHER))).statusCode, 403);
reset();
ok("singular finishRequest with no matching new entry", (await postTasks(raise(WORKER, { list: false }))).statusCode, 403);
reset();
{
  globalThis.__S3[K.tasks] = raise(WORKER);
  const t = stored(); t[0].subs[0].subs[0].finishRequests[0].status = "approved"; t[0].subs[0].subs[0].finishRequest = null;
  ok("resolving a request", (await postTasks(t)).statusCode, 403);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Negative controls: a worker still cannot edit the schedule through /tasks");
for (const [label, mut, want] of [
  ["no-op re-POST", () => {}, 200],
  ["title", t => { t[0].title = "Mine now"; }, 403],
  ["loggedHours", t => { t[0].subs[0].subs[0].loggedHours = 99; }, 403],
  ["status", t => { t[0].subs[0].status = "In Progress"; }, 403],
  ["startHour", t => { t[0].subs[0].subs[0].startHour = 9; }, 403],
  ["pendingSession", t => { t[0].subs[0].subs[0].pendingSession = { sessionId: "S9" }; }, 403],
]) {
  reset(); const t = stored(); mut(t);
  ok(`worker POST changing ${label}`, (await postTasks(t)).statusCode, want);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
