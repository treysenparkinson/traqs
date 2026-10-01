// What a job-clock session is worth, end to end through the real timeclock.js handler.
//
// Root cause: timeclock & sessions, chunk A (#194/#199/#200). There were two definitions of a
// worked hour and they disagreed by as much as 14x:
//
//   the live bar    productiveHoursBetween over the session window — org hours, minus lunch
//                   and breaks, skipping weekends and holidays, bounded by frozenAtMs and by
//                   the end of the working day it started in
//   jobClockOut     clockOut - clockIn - totalPausedMs. Raw wall clock. No calendar at all.
//
// On Matrix that credited one unclosed Friday-afternoon session 67.84h — the whole weekend —
// against 1.32h of working time the bar had been showing all along, and nine sessions over
// twelve hours held 320.55h of the org's 1,083.6h of recorded production.
//
// Both now call sessionWorkedHours. The assertions below are about the CREDIT, because the
// live side is covered in job-live-hours-test; what matters here is that the number written
// to loggedHours and to productionhours.json is the one the bar was drawing.
//
//   node scripts/session-hours-test.mjs
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

let timeclock;
try { timeclock = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load timeclock.js:", e); process.exit(2); }
if (typeof timeclock !== "function") { console.error("handler missing"); process.exit(2); }

const K = { people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json",
  settings: "orgs/TESTORG/settings.json", prod: "orgs/TESTORG/productionhours.json" };

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// 08:00-17:00 Mon-Fri with an hour of lunch at noon — Matrix's actual shape — in UTC so the
// arithmetic in the assertions is readable.
const SETTINGS = { timeZone: "UTC", workStart: "08:00", workEnd: "17:00", workDays: [1, 2, 3, 4, 5],
  lunch: { durationMinutes: 60, time: "12:00" }, breaks: [], holidays: [] };

const reset = () => {
  globalThis.__S3 = {
    [K.settings]: { ...SETTINGS },
    [K.people]: [{ id: 7, name: "Wendy Worker", userRole: "user" }],
    [K.tasks]: [{ id: "JOB", title: "Job", loggedHours: 0,
      subs: [{ id: "PANEL", title: "Panel", loggedHours: 0,
        subs: [{ id: "OP", title: "Op", loggedHours: 0, team: [7], start: "2026-09-25", end: "2026-09-25" }] }] }],
    [K.prod]: [],
  };
  globalThis.__WRITES = [];
  globalThis.__AUTH = { personId: "7", isAdmin: false, email: "w@x.com" };
};
const clock = (body) => timeclock({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const person = () => globalThis.__S3[K.people][0];
const job = () => globalThis.__S3[K.tasks][0];
const panel = () => job().subs[0];
const op = () => panel().subs[0];
const sessions = () => globalThis.__S3[K.prod];

// The handler stamps clockOut with the real clock, so a session is set up by writing
// activeJobClock directly and then freezing the END with frozenAtMs — which is also the
// field #194 was ignoring, so using it here exercises the fix rather than working around it.
const session = async ({ clockIn, endAt, totalPausedMs = 0, autoPausedMs = 0 }) => {
  reset();
  person().activeJobClock = {
    clockIn, jobId: "JOB", panelId: "PANEL", opId: "OP", sessionId: "S1",
    drainCheckpoint: clockIn, totalPausedMs, autoPausedMs,
    ...(endAt ? { frozenAtMs: Date.parse(endAt) } : {}),
  };
  return clock({ action: "jobClockOut", personId: 7 });
};

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. The credit is productive hours, not wall clock");
{
  const res = await session({ clockIn: "2026-09-25T09:00:00.000Z", endAt: "2026-09-25T11:00:00.000Z" });
  ok("two hours inside the working day credit two hours", [res.statusCode, res.body.hours], [200, 2]);
  ok("...on the op, the panel and the job", [op().loggedHours, panel().loggedHours, job().loggedHours], [2, 2, 2]);
  ok("...and one session row carries the same number", [sessions().length, sessions()[0]?.hours], [1, 2]);
}
{
  const res = await session({ clockIn: "2026-09-25T11:30:00.000Z", endAt: "2026-09-25T13:30:00.000Z" });
  ok("a span across lunch credits only the worked half", res.body.hours, 1);
}
{
  const res = await session({ clockIn: "2026-09-25T16:00:00.000Z", endAt: "2026-09-25T20:00:00.000Z" });
  ok("work past the end of the day stops at the end of the day", res.body.hours, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. The session nobody closed — the defect that cost the most");
{
  // Friday 15:40, never closed — the real shape of 401944 Thacker II / CUT, which was
  // credited 67.84h. No frozenAtMs: this is a forgotten clock-out, not a held session, and
  // the distinction matters (see the HELD case below). The handler stamps clockOut with the
  // real clock, so this stays deterministic however long after the fact the suite runs —
  // the unclosed cap pins the window to the end of the day the session STARTED in.
  const res = await session({ clockIn: "2026-09-25T15:40:00.000Z" });
  ok("a Friday session nobody closed credits Friday afternoon only", res.body.hours, 1.33);
  ok("...not the 67.8h of wall clock it used to", res.body.hours < 2, true);
  ok("...and the op counter agrees with the session row", [op().loggedHours, sessions()[0]?.hours], [1.33, 1.33]);
}
{
  // A HELD session is the opposite case and must not be capped: somebody explicitly froze it
  // at an instant, and openSessionEnd says an explicit decision outranks the day boundary.
  // Friday 15:40 held at Monday 11:30 = Friday's 1.33h plus Monday's 3.5h.
  const res = await session({ clockIn: "2026-09-25T15:40:00.000Z", endAt: "2026-09-28T11:30:00.000Z" });
  ok("a HELD session credits through to where it was frozen", res.body.hours, 4.83);
  ok("...and the weekend between still counts for nothing", res.body.hours < 5, true);
}
{
  // A weekend-only session has no working time in it at all.
  const res = await session({ clockIn: "2026-09-26T09:00:00.000Z", endAt: "2026-09-26T17:00:00.000Z" });
  ok("a Saturday session credits nothing", res.body.hours, 0);
  ok("...and writes no session row, because there is nothing to record", sessions().length, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. Pauses (#199/#200): manual comes off, lunch does not come off twice");
{
  const res = await session({ clockIn: "2026-09-25T09:00:00.000Z", endAt: "2026-09-25T11:00:00.000Z",
    totalPausedMs: 30 * 60e3 });
  ok("a closed manual pause is subtracted", res.body.hours, 1.5);
}
{
  const res = await session({ clockIn: "2026-09-25T11:30:00.000Z", endAt: "2026-09-25T13:30:00.000Z",
    totalPausedMs: 60 * 60e3, autoPausedMs: 60 * 60e3 });
  // The dead window already removed the hour; subtracting totalPausedMs as well would bill
  // lunch twice and credit 0 for an hour of real work.
  ok("a lunch pause is not billed twice", res.body.hours, 1);
}
{
  const res = await session({ clockIn: "2026-09-25T09:00:00.000Z", endAt: "2026-09-25T10:00:00.000Z",
    totalPausedMs: 5 * 3600e3 });
  ok("a pause longer than the window floors at zero rather than going negative", res.body.hours, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. The live bar and the credit are the same number");
// The point of the fix is not any single figure but that two callers cannot drift. Both go
// through sessionWorkedHours, so the same inputs must produce the same answer on both sides.
{
  const { sessionWorkedHours, buildDayWindows } = await import(new URL("../src/statsMath.js", import.meta.url).href);
  const cfg = { ...buildDayWindows(8, 17, [], SETTINGS.lunch), workDays: SETTINGS.workDays, holidays: [], timeZone: "UTC" };
  for (const [label, clockIn, endAt] of [
    ["mid-morning", "2026-09-25T09:00:00.000Z", "2026-09-25T11:00:00.000Z"],
    ["across lunch", "2026-09-25T11:30:00.000Z", "2026-09-25T13:30:00.000Z"],
    ["held over a weekend", "2026-09-25T15:40:00.000Z", "2026-09-28T11:30:00.000Z"],
    ["after hours", "2026-09-25T16:00:00.000Z", "2026-09-25T20:00:00.000Z"],
  ]) {
    const credited = (await session({ clockIn, endAt })).body.hours;
    const live = sessionWorkedHours({ clockInMs: Date.parse(clockIn), frozenAtMs: Date.parse(endAt), nowMs: Date.parse(endAt), cfg }).hours;
    ok(`${label}: credited === what the bar shows`, credited, live);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
