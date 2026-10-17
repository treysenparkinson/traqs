// #557. A REOPENED SHIFT CLOCKED OUT WITH `hours: null`.
//
// adminReopenEntry ("Undo clock-out") rebuilds activeClockIn.events from the
// shift's lunch/break rows in payhours. It wrote them as `{ type, at }`; every
// reader of that cache expects `{ type, ts }` — pausedMsFromEvents above all,
// which is what every clock-out path subtracts lunch with. `new Date(undefined)`
// is NaN, NaN survives Math.max, and JSON.stringify stores NaN as null: the
// punch the reopened shift closed into carried `hours: null` in payhours. Only
// shifts that had a lunch were hit (no lunchStart, nothing reads the time).
//
// TWO HALVES, BOTH PINNED:
//   1. reopen writes the shape the readers use, so a reopened shift clocks out
//      with its real hours and its lunch still deducted;
//   2. the reader also accepts `at`, because a shift reopened before this fix
//      and still open in production holds the old shape in people.json, and the
//      first half does nothing for it. That session closes through the same
//      reader, so tolerating `at` there is what keeps its punch from nulling.
//
//   node scripts/reopen-events-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
// Pinned, never inherited (#529).
process.env.TIER_RULES_MODE = "off";
const { handler } = await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href);

const K = { people: "orgs/TESTORG/people.json", pay: "orgs/TESTORG/payhours.json",
  prod: "orgs/TESTORG/productionhours.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json" };
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// The clock-outs below use the real clock, so the shift is placed relative to
// now: in 9h before the clock-out, a 30-minute lunch inside it. 9 - 0.5 = 8.5.
const NOW = Date.now();
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();
const SHIFT = { clockIn: iso(9), clockOut: iso(1), lunchStart: iso(6), lunchEnd: iso(5.5), breakStart: iso(4), breakEnd: iso(3.75) };

const reset = (activeClockIn = null) => {
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver" },
    [K.people]: [{ id: 7, name: "Wendy Worker", userRole: "user", pin: "1111", ...(activeClockIn ? { activeClockIn } : {}) }],
    [K.pay]: activeClockIn ? [] : [
      { id: "tc_1", personId: 7, date: SHIFT.clockIn.slice(0, 10), clockIn: SHIFT.clockIn, clockOut: SHIFT.clockOut, hours: 7.25, jobRefs: [], source: "kiosk" },
      { id: "ev_ls", personId: 7, eventType: "lunchStart", timestamp: SHIFT.lunchStart },
      { id: "ev_le", personId: 7, eventType: "lunchEnd", timestamp: SHIFT.lunchEnd },
      { id: "ev_bs", personId: 7, eventType: "breakStart", timestamp: SHIFT.breakStart },
      { id: "ev_be", personId: 7, eventType: "breakEnd", timestamp: SHIFT.breakEnd },
    ],
    [K.prod]: [], [K.tasks]: [],
  };
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__PRECONDITION_FAILURES = [];
  globalThis.__AUTH = { orgCode: "TESTORG", personId: 1, isAdmin: true, email: "a@x.com" };
  globalThis.__BEFORE_WRITE = null;
};
const post = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const wendy = () => globalThis.__S3[K.people].find(p => String(p.id) === "7");
const livePunches = () => globalThis.__S3[K.pay].filter(r => !r.eventType && !r.deletedAt);

console.log("\n1. REOPEN WRITES THE SHAPE EVERY READER USES");
{
  reset();
  const res = await post({ action: "adminReopenEntry", entryId: "tc_1" });
  ok("the reopen succeeds", res.statusCode, 200);
  const evs = wendy().activeClockIn?.events || [];
  ok("the cache carries the shift's four rows, in time order", evs.map(e => e.type), ["lunchStart", "lunchEnd", "breakStart", "breakEnd"]);
  ok("...each keyed `ts`, with the row's timestamp", evs.map(e => e.ts), [SHIFT.lunchStart, SHIFT.lunchEnd, SHIFT.breakStart, SHIFT.breakEnd]);
  ok("...and none keyed `at`", evs.filter(e => "at" in e).length, 0);
  ok("the response's activeClockIn is the same cache", res.body.activeClockIn?.events, evs);
}

console.log("\n2. THE REOPENED SHIFT CLOCKS OUT WITH ITS REAL HOURS");
{
  reset();
  await post({ action: "adminReopenEntry", entryId: "tc_1" });
  const res = await post({ action: "clockOut", personId: 7, pin: "1111" });
  ok("the kiosk clock-out succeeds", res.statusCode, 200);
  const live = livePunches();
  ok("one live punch: the new one (the reopened one is tombstoned)", live.length, 1);
  ok("its hours are a number, not null", typeof live[0]?.hours, "number");
  // 9h on the clock minus the 30-minute lunch. The break is paid and stays in.
  ok("...9h minus the 30-minute lunch, the paid break left in", live[0]?.hours, 8.5);
  ok("...on the original clock-in", live[0]?.clockIn, SHIFT.clockIn);
}

console.log("\n3. A SESSION ALREADY HOLDING THE OLD `at` SHAPE STILL CLOSES CORRECTLY");
// What a shift reopened before the fix, and still open, looks like in people.json.
const legacy = () => ({ clockIn: SHIFT.clockIn, jobRefs: [], source: "kiosk", events: [
  { type: "lunchStart", at: SHIFT.lunchStart }, { type: "lunchEnd", at: SHIFT.lunchEnd },
  { type: "breakStart", at: SHIFT.breakStart }, { type: "breakEnd", at: SHIFT.breakEnd },
] });
for (const [label, body] of [
  ["kiosk clockOut", { action: "clockOut", personId: 7, pin: "1111" }],
  ["adminClockOut", { action: "adminClockOut", personId: 7 }],
]) {
  reset(legacy());
  const res = await post(body);
  ok(`${label}: succeeds`, res.statusCode, 200);
  const live = livePunches();
  ok(`${label}: the punch's hours are 8.5, lunch deducted`, live[0]?.hours ?? null, 8.5);
}
{
  // An OPEN lunch in the old shape is closed at clock-out like any other: from
  // 1h ago to now is unpaid, so 9h - 0.5h - 1h = 7.5.
  reset({ ...legacy(), events: [...legacy().events, { type: "lunchStart", at: iso(1) }] });
  await post({ action: "clockOut", personId: 7, pin: "1111" });
  ok("an open `at` lunch is closed at clock-out and deducted", livePunches()[0]?.hours ?? null, 7.5);
}

console.log("\n4. THE LUNCH-CACHE REBUILD ORDERS AN OLD `at` EVENT BY ITS TIME");
{
  // adminAddEvent rebuilds the lunch half of the cache from the log and keeps
  // the other events, then sorts the lot by time. An `at` break sorted as NaN
  // (every comparison 0), so it stayed wherever it was rather than in time order.
  reset({ ...legacy(), events: legacy().events.filter(e => !e.type.startsWith("lunch")) });
  await post({ action: "adminAddEvent", personId: 7, eventType: "lunchStart", timestamp: SHIFT.lunchStart });
  const res = await post({ action: "adminAddEvent", personId: 7, eventType: "lunchEnd", timestamp: SHIFT.lunchEnd });
  ok("the second lunch row lands", res.statusCode, 200);
  ok("the rebuilt cache is in time order, old `at` breaks included",
    (wendy().activeClockIn?.events || []).map(e => e.type), ["lunchStart", "lunchEnd", "breakStart", "breakEnd"]);
  await post({ action: "clockOut", personId: 7, pin: "1111" });
  ok("...and the shift still clocks out at 8.5", livePunches()[0]?.hours ?? null, 8.5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
