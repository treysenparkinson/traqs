// Integration test for the job-hours paths: runs the REAL timeclock handler
// against an in-memory S3 and fake auth, so the arithmetic, the day stamping and
// the counter bookkeeping are all exercised end to end without AWS or Auth0.
//
//   node scripts/timeclock-itest.mjs
//
// Covers the two bugs this suite was written for — an evening shift stamped with
// tomorrow's UTC date, and counters that fell behind the session rows — plus the
// pause arithmetic and the walk-back, which are easy to break from either side.
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);
const { handler } = await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href);

const K = {
  people: "orgs/TESTORG/people.json",
  tasks: "orgs/TESTORG/tasks.json",
  pay: "orgs/TESTORG/payhours.json",
  prod: "orgs/TESTORG/productionhours.json",
  settings: "orgs/TESTORG/settings.json",
};

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? ` = ${JSON.stringify(got)}` : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const reset = ({ timeZone = "America/Denver" } = {}) => {
  globalThis.__S3 = {
    [K.settings]: { timeZone },
    [K.people]: [{ id: 99, name: "Trey", pin: "1234" }],
    [K.tasks]: [{
      id: "JOB", title: "TRAQS Development", loggedHours: 0,
      subs: [{ id: "PANEL", title: "Development", subs: [{ id: "OP", title: "Desktop Site Development", hpd: 15 }] }],
    }],
    [K.pay]: [], [K.prod]: [],
  };
  globalThis.__WRITES = [];
  globalThis.__AUTH = { personId: 99, isAdmin: true, email: "t@x.com" };
};

const post = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const setJobClock = (clockIn, extra = {}) => {
  globalThis.__S3[K.people][0].activeJobClock = {
    clockIn, jobId: "JOB", panelId: "PANEL", opId: "OP",
    jobTitle: "TRAQS Development", panelTitle: "Development", opTitle: "Desktop Site Development",
    ...extra,
  };
};
const op = () => globalThis.__S3[K.tasks][0].subs[0].subs[0];
const panel = () => globalThis.__S3[K.tasks][0].subs[0];
const job = () => globalThis.__S3[K.tasks][0];
const rows = () => globalThis.__S3[K.prod].filter(r => !r.deletedAt);
const sum = () => Math.round(rows().reduce((a, r) => a + (r.hours || 0), 0) * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Evening job clock-out lands on the LOCAL day (the reported bug)");
reset();
// 18:23 -> 21:53 Mountain on Aug 3 = 00:23 -> 03:53 UTC on Aug 4.
setJobClock("2026-08-04T00:23:11.000Z");
{
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-04T03:53:51.000Z").getTime();
  const OrigDate = Date;
  globalThis.Date = class extends OrigDate {
    constructor(...a) { return a.length ? new OrigDate(...a) : new OrigDate("2026-08-04T03:53:51.000Z"); }
    static now() { return new OrigDate("2026-08-04T03:53:51.000Z").getTime(); }
  };
  const res = await post({ action: "jobClockOut", personId: 99 });
  globalThis.Date = OrigDate; Date.now = realNow;
  ok("returned hours", res.body.hours, 3.51);
  ok("session date is the local day, not UTC", rows()[0].date, "2026-08-03");
  ok("op counter credited", op().loggedHours, 3.51);
  ok("panel counter credited (was never written before)", panel().loggedHours, 3.51);
  ok("job counter credited", job().loggedHours, 3.51);
  ok("counters agree with the session record", op().loggedHours, sum());
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. Same instant with NO org timezone falls back to UTC (no silent shift)");
reset({ timeZone: null });
setJobClock("2026-08-04T00:23:11.000Z");
{
  const OrigDate = Date;
  globalThis.Date = class extends OrigDate {
    constructor(...a) { return a.length ? new OrigDate(...a) : new OrigDate("2026-08-04T03:53:51.000Z"); }
    static now() { return new OrigDate("2026-08-04T03:53:51.000Z").getTime(); }
  };
  await post({ action: "jobClockOut", personId: 99 });
  globalThis.Date = OrigDate;
  ok("unset timeZone keeps the old UTC date", rows()[0].date, "2026-08-04");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. Lunch pause is not billed to the job");
reset();
setJobClock("2026-08-03T15:45:03.000Z", { totalPausedMs: 36 * 60 * 1000 });  // 36min lunch
{
  const OrigDate = Date;
  globalThis.Date = class extends OrigDate {
    constructor(...a) { return a.length ? new OrigDate(...a) : new OrigDate("2026-08-03T19:01:35.000Z"); }
    static now() { return new OrigDate("2026-08-03T19:01:35.000Z").getTime(); }
  };
  const res = await post({ action: "jobClockOut", personId: 99 });
  globalThis.Date = OrigDate;
  // 3h16m32s wall = 3.28h, minus 0.6h lunch = 2.68h
  ok("paused time excluded", res.body.hours, 2.68);
  ok("counter matches", op().loggedHours, 2.68);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Clocking out WHILE paused doesn't bill the open pause");
reset();
setJobClock("2026-08-03T15:00:00.000Z", { pausedAt: "2026-08-03T16:00:00.000Z" });
{
  const OrigDate = Date;
  globalThis.Date = class extends OrigDate {
    constructor(...a) { return a.length ? new OrigDate(...a) : new OrigDate("2026-08-03T18:00:00.000Z"); }
    static now() { return new OrigDate("2026-08-03T18:00:00.000Z").getTime(); }
  };
  const res = await post({ action: "jobClockOut", personId: 99 });
  globalThis.Date = OrigDate;
  ok("3h elapsed, 2h of it paused -> 1h billed", res.body.hours, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Manual credit, then a walk-back of part of it");
reset();
{
  let r = await post({
    action: "adminJobHours", personId: 99, jobId: "JOB", panelId: "PANEL", opId: "OP",
    hours: 4.21, date: "2026-08-04",
  });
  ok("credited", r.body.credited, 4.21);
  ok("one manual row", rows().length, 1);
  ok("row hours", rows()[0].hours, 4.21);
  ok("row clockOut matches its hours", rows()[0].clockOut, "2026-08-04T16:12:36.000Z");
  ok("panel counter credited", panel().loggedHours, 4.21);

  r = await post({
    action: "adminJobHours", personId: 99, jobId: "JOB", panelId: "PANEL", opId: "OP",
    hours: -4, date: "2026-08-04",
  });
  ok("walk-back reported", r.body.credited, -4);
  ok("row reduced to remainder", rows()[0].hours, 0.21);
  ok("clockOut pulled back with it (was the stale-span bug)", rows()[0].clockOut, "2026-08-04T12:12:36.000Z");
  ok("panel counter followed the walk-back", panel().loggedHours, 0.21);
  ok("counter still agrees with the record", panel().loggedHours, sum());
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. Walk-back larger than what exists moves the counter only by what was removed");
reset();
{
  await post({ action: "adminJobHours", personId: 99, jobId: "JOB", panelId: "PANEL", opId: "OP", hours: 2, date: "2026-08-04" });
  await post({ action: "adminJobHours", personId: 99, jobId: "JOB", panelId: "PANEL", opId: "OP", hours: -10, date: "2026-08-04" });
  ok("all manual rows gone", rows().length, 0);
  ok("panel counter floors at 0, not negative", panel().loggedHours, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. Two clock-outs on the same op accumulate (no lost credit)");
reset();
for (const [inT, outT] of [["2026-08-03T15:00:00.000Z", "2026-08-03T17:00:00.000Z"],
                           ["2026-08-03T18:00:00.000Z", "2026-08-03T21:30:00.000Z"]]) {
  setJobClock(inT);
  const OrigDate = Date;
  globalThis.Date = class extends OrigDate {
    constructor(...a) { return a.length ? new OrigDate(...a) : new OrigDate(outT); }
    static now() { return new OrigDate(outT).getTime(); }
  };
  await post({ action: "jobClockOut", personId: 99 });
  globalThis.Date = OrigDate;
}
ok("two rows", rows().length, 2);
ok("op counter = 2 + 3.5", op().loggedHours, 5.5);
ok("panel counter = 5.5", panel().loggedHours, 5.5);
ok("counters agree with the record", op().loggedHours, sum());

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. A clock-out on one panel must not touch another panel's counter");
reset();
globalThis.__S3[K.tasks][0].subs.push({ id: "PANEL2", title: "Other", loggedHours: 7, subs: [{ id: "OP2", title: "x" }] });
setJobClock("2026-08-03T15:00:00.000Z");
{
  const OrigDate = Date;
  globalThis.Date = class extends OrigDate {
    constructor(...a) { return a.length ? new OrigDate(...a) : new OrigDate("2026-08-03T16:00:00.000Z"); }
    static now() { return new OrigDate("2026-08-03T16:00:00.000Z").getTime(); }
  };
  await post({ action: "jobClockOut", personId: 99 });
  globalThis.Date = OrigDate;
  ok("target panel credited", panel().loggedHours, 1);
  ok("sibling panel untouched", globalThis.__S3[K.tasks][0].subs[1].loggedHours, 7);
  ok("sibling op untouched", globalThis.__S3[K.tasks][0].subs[1].subs[0].loggedHours, undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
