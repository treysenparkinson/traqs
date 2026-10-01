// One person, one live clock — and the structural rule that makes it true.
//
// #196. Three paths read the clock state, decided, and then wrote with a plain PUT, so two
// requests that both read "not clocked in" both wrote. Matrix holds six (person, clockIn)
// pairs in payhours that appear more than once — including three rows sharing a clock-in
// instant to the millisecond, two of them written 2.1 seconds apart — and two job sessions
// duplicated the same way, hours 4.13/4.15 and 0.62/0.62.
//
// The fix is the mechanism already in this file: updateJson reads with the ETag, writes only
// if nothing landed in between, and re-runs the mutate against newer data when it did.
//
// THE PART THAT DECAYS is not the mechanism, it is WHERE THE GUARD SITS. A check made before
// the conditional write and a mutation made inside it looks almost identical and restores the
// whole race, because the retry re-runs the write without re-running the check. Section 3 is
// a source assertion for exactly that, so it is a test rather than a convention somebody has
// to remember.
//
//   node scripts/clock-atomicity-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
import { readFileSync } from "node:fs";

let timeclock;
try { timeclock = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load timeclock.js:", e); process.exit(2); }

const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json",
  settings: "orgs/TESTORG/settings.json", pay: "orgs/TESTORG/payhours.json", prod: "orgs/TESTORG/productionhours.json" };

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const reset = () => {
  globalThis.__S3 = {
    [K.settings]: { timeZone: "UTC", workStart: "00:00", workEnd: "24:00", workDays: [0,1,2,3,4,5,6], lunch: { durationMinutes: 0 }, breaks: [] },
    [K.people]: [{ id: 7, name: "Wendy", userRole: "user", pin: "PIN7" }],
    [K.tasks]: [{ id: "JOB", title: "Job", subs: [{ id: "PANEL", title: "Panel", subs: [{ id: "OP", title: "Op", team: [7] }] }] }],
    [K.pay]: [], [K.prod]: [],
  };
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__AUTH = { personId: "7", isAdmin: false, email: "w@x.com" };
};
const call = (body) => timeclock({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const person = () => globalThis.__S3[K.people][0];
const punches = () => globalThis.__S3[K.pay].filter(e => e && !e.eventType);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Two clock-ins racing — only one may win");
// __BEFORE_WRITE fires inside writeJsonIfMatch, after the read and before the compare, which
// is precisely the window the old code wrote into. A second clock-in landing there makes the
// first one's ETag stale, so it must retry, re-run its guard against the NEW data, and lose.
reset();
{
  let injected = false;
  globalThis.__BEFORE_WRITE = async (key) => {
    if (injected || key !== K.people) return;
    injected = true;
    globalThis.__BEFORE_WRITE = null;                       // the injected call writes cleanly
    await call({ action: "clockIn", personId: 7, pin: "PIN7" });
  };
  const res = await call({ action: "clockIn", personId: 7, pin: "PIN7" });
  globalThis.__BEFORE_WRITE = null;
  ok("the loser is refused with a 409, not silently duplicated", res.statusCode, 409);
  ok("...and exactly one clock-in is stored", person().activeClockIn != null, true);
  ok("...and the retry actually happened", (globalThis.__PRECONDITION_FAILURES || []).length > 0, true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. A retried clock-out writes one session row, not two");
reset();
{
  person().activeJobClock = { clockIn: "2026-10-01T09:00:00.000Z", sessionId: "S1",
    jobId: "JOB", panelId: "PANEL", opId: "OP", frozenAtMs: Date.parse("2026-10-01T11:00:00.000Z") };
  await call({ action: "jobClockOut", personId: 7 });
  const first = globalThis.__S3[K.prod].length;
  // The same clock-out arriving again — a network retry, which is how Matrix got two rows
  // with identical clockIns and hours 0.62/0.62.
  person().activeJobClock = { clockIn: "2026-10-01T09:00:00.000Z", sessionId: "S1",
    jobId: "JOB", panelId: "PANEL", opId: "OP", frozenAtMs: Date.parse("2026-10-01T11:00:00.000Z") };
  await call({ action: "jobClockOut", personId: 7 });
  ok("the first clock-out wrote one row", first, 1);
  ok("...and the repeat added none", globalThis.__S3[K.prod].length, 1);
  // Awaited. An un-awaited call here finished after the next reset() and nulled the clock
  // that section 4 had just set up — two failures, one dangling promise.
  person().activeJobClock = { clockIn: "2026-10-01T13:00:00.000Z", sessionId: "S2",
    jobId: "JOB", panelId: "PANEL", opId: "OP", frozenAtMs: Date.parse("2026-10-01T14:00:00.000Z") };
  await call({ action: "jobClockOut", personId: 7 });
  ok("...matched on (person, clockIn, op), so a DIFFERENT session still records",
    globalThis.__S3[K.prod].length, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. The guard has to live INSIDE the conditional write");
// Not a behaviour test — a shape test. A guard that drifts outside the mutate reintroduces
// #196 while every behaviour test above still passes, because a single-threaded test never
// hits the retry. This is the assertion that notices.
const SRC = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const body = (startMark, endMark) => {
  const a = SRC.indexOf(startMark);
  if (a < 0) return null;
  const b = SRC.indexOf(endMark, a);
  return b < 0 ? null : SRC.slice(a, b);
};
{
  // mutatePersonFresh must be the ETag path, not a read-then-PUT.
  const fn = body("async function mutatePersonFresh(", "\n}\n");
  ok("mutatePersonFresh goes through updateJson", !!fn && fn.includes("await updateJson("), true);
  ok("...and no longer ends in a bare writeStampedArray", !!fn && !fn.includes("writeStampedArray("), true);
}
{
  // Every clock-state guard must sit inside a mutate. The reliable tell is that the 409 is
  // raised from inside the callback passed to the conditional writer.
  const sites = [
    ["kiosk clockIn", 'if (action === "clockIn") {', 'if (action === "clockOut") {'],
    ["iOS payClockIn", 'committed = await mutatePersonFresh(peopleKey, pcPId, (fresh) => {', "} catch (e) { return err(e.status"],
  ];
  for (const [label, from, to] of sites) {
    const b = body(from, to);
    ok(`${label}: the "already clocked in" 409 is raised inside the mutate`,
      !!b && /mutatePersonFresh\([\s\S]*fresh\.activeClockIn[\s\S]*e\.status = 409/.test(b), true);
  }
  // jobClockIn uses updateStampedArray directly; its guard must be in that callback.
  const jci = body('if (action === "jobClockIn") {', 'if (action === "jobClockOut") {');
  ok("jobClockIn: the one-job-clock guard is inside updateStampedArray",
    !!jci && /updateStampedArray\(peopleKey, \(stored\) => \{[\s\S]*person\.activeJobClock\) \{ jciFail = err\(409/.test(jci), true);
  // ...and the productionhours dedupe likewise.
  const jco = body('if (action === "jobClockOut") {', 'if (action === "updateJobSession") {');
  ok("jobClockOut: the session dedupe is inside the conditional write",
    !!jco && /updateStampedArray\(prodKey, \(stored\) => \{[\s\S]*const dup = arr\.some/.test(jco), true);
}
{
  // No clock path may write people.json or productionhours.json with an unconditional PUT.
  // writeStampedArray is legitimate where there is no read-decide-write pair (closing a
  // break alongside an already-committed action), so this checks the two files that carry
  // live clock state are not written that way from the clock-in/out paths.
  const offenders = [];
  for (const [label, from, to] of [
    ["kiosk clockIn", 'if (action === "clockIn") {', 'if (action === "clockOut") {'],
    ["jobClockIn", 'if (action === "jobClockIn") {', 'if (action === "jobClockOut") {'],
  ]) {
    const b = body(from, to);
    if (b && /writeStampedArray\(peopleKey/.test(b)) offenders.push(label);
  }
  ok(`no clock-in path writes people.json unconditionally${offenders.length ? " — " + offenders.join(", ") : ""}`, offenders, []);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3b. Mixed id types on the credit path (#205/#206/#324)");
// Every fixture in this repo uses string ids, so reverting the credit to `job.id !== jcoJobId`
// breaks nothing any test can see — which is exactly what makes it dangerous. Person ids are
// documented as mixed Int/String across web and iOS, and on the credit path a type miss is
// SILENT: the hours are simply not credited and nothing reports it.
//
// So this fixture stores NUMERIC ids and the session references them as strings, which is the
// shape that actually occurs.
reset();
{
  globalThis.__S3[K.tasks] = [{ id: 101, title: "Job", loggedHours: 0,
    subs: [{ id: 202, title: "Panel", loggedHours: 0, subs: [{ id: 303, title: "Op", loggedHours: 0, team: [7] }] }] }];
  person().activeJobClock = { clockIn: "2026-10-01T09:00:00.000Z", sessionId: "S9",
    jobId: "101", panelId: "202", opId: "303", frozenAtMs: Date.parse("2026-10-01T11:00:00.000Z") };
  const res = await call({ action: "jobClockOut", personId: 7 });
  const job = globalThis.__S3[K.tasks][0];
  ok("the clock-out succeeds", [res.statusCode, res.body.hours], [200, 2]);
  ok("...and 2h is credited to the job, panel and op despite Number vs String ids",
    [job.loggedHours, job.subs[0].loggedHours, job.subs[0].subs[0].loggedHours], [2, 2, 2]);
  ok("...and the session row records the op", globalThis.__S3[K.prod].at(-1)?.opId, "303");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Idempotent session merges (#189/#193)");
reset();
{
  person().activeJobClock = { clockIn: "2026-10-01T09:00:00.000Z", sessionId: "S1",
    jobId: "JOB", panelId: "PANEL", opId: "OP", drainCheckpoint: "2026-10-01T10:00:00.000Z" };
  globalThis.__AUTH = { personId: "7", isAdmin: false, email: "w@x.com" };
  await call({ action: "updateJobSession", personId: 7, sessionId: "S1", frozenAtMs: 1759312800000 });
  ok("frozenAtMs is stamped once", person().activeJobClock.frozenAtMs, 1759312800000);
  await call({ action: "updateJobSession", personId: 7, sessionId: "S1", frozenAtMs: 1759316400000 });
  ok("...and a second, later stamp is ignored — write-once", person().activeJobClock.frozenAtMs, 1759312800000);
}
reset();
{
  person().activeJobClock = { clockIn: "2026-10-01T09:00:00.000Z", sessionId: "S1",
    jobId: "JOB", panelId: "PANEL", opId: "OP", drainCheckpoint: "2026-10-01T10:00:00.000Z", pausedMsAtCheckpoint: 0 };
  await call({ action: "updateJobSession", personId: 7, sessionId: "S1", drainCheckpoint: "2026-10-01T11:00:00.000Z", pausedMsAtCheckpoint: 600000 });
  ok("drainCheckpoint moves forward", [person().activeJobClock.drainCheckpoint, person().activeJobClock.pausedMsAtCheckpoint],
    ["2026-10-01T11:00:00.000Z", 600000]);
  await call({ action: "updateJobSession", personId: 7, sessionId: "S1", drainCheckpoint: "2026-10-01T10:30:00.000Z", pausedMsAtCheckpoint: 1 });
  ok("...and never backward, taking its paused baseline with it",
    [person().activeJobClock.drainCheckpoint, person().activeJobClock.pausedMsAtCheckpoint],
    ["2026-10-01T11:00:00.000Z", 600000]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
