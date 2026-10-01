// The conflict record has to be good enough to decide on, and safe enough to leave on.
//
// #327: console.warn into the Netlify function log is written to nowhere retrievable —
// `netlify logs:function` only streams, and the API has no method for function logs. Four
// env flags have been sitting in `log` waiting on evidence that was never being collected.
// This suite covers the durable record that replaces it for TASK_CONFLICT_MODE.
//
// What it must prove:
//   - a conflict is recorded, with the FIELD LIST — a count alone leaves you where you were;
//   - a loggedHours clobber still shows, even though #323 silently repaired it first;
//   - nothing is recorded when there is no conflict, so the file is signal;
//   - recording cannot fail the write it describes;
//   - behaviour in `log` is unchanged by any of this.
//
//   node scripts/conflict-log-test.mjs
import { register } from "module";
// The real-timestamps loader, NOT timeclock-itest-loader: that one stubs changedIds to []
// so the conflict check can never see a content difference, and every assertion here would
// pass by never detecting a conflict at all.
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let tasksFn;
try { tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load tasks.js:", e); process.exit(2); }

const K = { tasks: "orgs/TESTORG/tasks.json", conflicts: "orgs/TESTORG/conflicts.json",
  people: "orgs/TESTORG/people.json", settings: "orgs/TESTORG/settings.json" };

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const STORED = () => ([{
  id: "JOB", title: "Job", status: "In Progress", loggedHours: 10, lastModifiedAt: "2026-10-01T12:00:05.000Z",
  subs: [{ id: "PANEL", title: "Panel", loggedHours: 10, lastModifiedAt: "2026-10-01T12:00:05.000Z",
    subs: [{ id: "OP", title: "Op", loggedHours: 10, status: "In Progress", startHour: 8, team: [7],
      start: "2026-10-01", end: "2026-10-01", lastModifiedAt: "2026-10-01T12:00:05.000Z" }] }],
}]);
const reset = ({ mode = "log" } = {}) => {
  process.env.TASK_CONFLICT_MODE = mode;
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver" },
    [K.people]: [{ id: 7, name: "Admin", userRole: "admin" }],
    [K.tasks]: STORED(),
  };
  globalThis.__WRITES = [];
  globalThis.__ETAGS = {};
  globalThis.__AUTH = { personId: "7", isAdmin: true, email: "a@x.com" };
};
const post = (tasks) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(tasks) });
const log = () => globalThis.__S3[K.conflicts];
const recs = () => (log()?.records || []);
// A client copy taken BEFORE the stored version — the stale-copy shape.
const staleCopy = () => {
  const t = STORED();
  t[0].lastModifiedAt = "2026-10-01T12:00:00.000Z";
  return t;
};

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. A stale copy that changes something is recorded, with its fields");
reset();
{
  const t = staleCopy();
  t[0].subs[0].subs[0].startHour = 13;
  t[0].subs[0].subs[0].status = "On Hold";
  const res = await post(t);
  ok("the write still goes through in log mode", res.statusCode, 200);
  ok("one record written", recs().length, 1);
  const r = recs()[0] || {};
  ok("...tagged, with the job id", [r.tag, r.jobId], ["task-conflict", "JOB"]);
  ok("...carrying both stamps", [r.incomingStamp, r.storedStamp],
    ["2026-10-01T12:00:00.000Z", "2026-10-01T12:00:05.000Z"]);
  ok("...and the stale direction as a signed gap", r.staleByMs, -5000);
  ok("...naming the caller", [r.by, r.isAdmin], ["7", true]);
  const fields = (r.fields || []).map(f => `${f.level}.${f.field}`).sort();
  ok("...and WHICH fields differed, not just how many", fields, ["op.startHour", "op.status"]);
  const sh = (r.fields || []).find(f => f.field === "startHour") || {};
  ok("...with the values on both sides", [sh.incoming, sh.stored], ["13", "8"]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. A loggedHours clobber is still visible, though #323 repaired it first");
reset();
{
  const t = staleCopy();
  delete t[0].subs[0].subs[0].loggedHours;          // the client that never saw the credit
  t[0].subs[0].subs[0].startHour = 13;              // plus a real edit, so it is a conflict
  await post(t);
  ok("the counter was still protected", globalThis.__S3[K.tasks][0].subs[0].subs[0].loggedHours, 10);
  const fields = (recs()[0]?.fields || []).map(f => f.field).sort();
  ok("...and the attempt on it is in the record anyway", fields.includes("loggedHours"), true);
  ok("...alongside the edit that made it a conflict", fields.includes("startHour"), true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. No conflict, no record — the file has to be signal");
reset();
{
  await post(STORED());
  ok("a current copy re-POSTed writes nothing", log() ?? null, null);
}
reset();
{
  const t = STORED();
  t[0].subs[0].subs[0].startHour = 13;              // current stamp, a normal edit
  await post(t);
  ok("an ordinary edit from a current copy writes nothing", log() ?? null, null);
}
reset();
{
  const t = staleCopy();                            // stale stamp, identical content
  await post(t);
  ok("a stale stamp with no content change writes nothing", log() ?? null, null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Records accumulate, and enforce is marked as such");
reset();
for (const sh of [13, 14, 15]) {
  const t = staleCopy();
  t[0].subs[0].subs[0].startHour = sh;
  await post(t);
}
ok("three conflicts, three records", recs().length, 3);
ok("...all marked as not refused, because the mode is log", recs().every(r => r.refused === false), true);
reset({ mode: "enforce" });
{
  const t = staleCopy();
  t[0].subs[0].subs[0].startHour = 13;
  const res = await post(t);
  ok("enforce refuses the job back to the client", res.body?.conflicts, ["JOB"]);
  ok("...the stored copy is kept", globalThis.__S3[K.tasks][0].subs[0].subs[0].startHour, 8);
  ok("...and the record says it was refused", recs()[0]?.refused, true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Recording can never fail the write it describes");
reset();
{
  // The S3 layer throws for the conflicts key only. The task write must still land.
  const realS3 = globalThis.__S3;
  globalThis.__S3 = new Proxy(realS3, {
    get(t, k) { if (k === K.conflicts) throw new Error("S3 is down"); return t[k]; },
    set(t, k, v) { if (k === K.conflicts) throw new Error("S3 is down"); t[k] = v; return true; },
  });
  const t = staleCopy();
  t[0].subs[0].subs[0].startHour = 13;
  let res, threw = null;
  try { res = await post(t); } catch (e) { threw = e.message; }
  globalThis.__S3 = realS3;
  ok("the POST does not throw", threw, null);
  ok("...and still returns 200", res?.statusCode, 200);
  ok("...and the task edit landed", globalThis.__S3[K.tasks][0].subs[0].subs[0].startHour, 13);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
