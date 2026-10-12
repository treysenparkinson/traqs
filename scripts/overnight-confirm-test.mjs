// #503. TWO GATES AROUND A SHIFT NOBODY CLOSED.
//
// #502 measured 22 punches over 12h carrying 904.21 hours, none confirmed, and
// found two things missing:
//
//   1. The sweep that warns about them leaves NO MARK. `forgotNotifiedAt` is
//      stamped on `activeClockIn`, and clock-out destructures
//      `{ clockIn, jobRefs, events, source }` off it and drops the rest — so
//      "did anyone warn this worker" is unanswerable after the fact.
//
//   2. Nothing stops the hours becoming money. `confirmTimesheet` stamps every
//      punch in a range without looking at any of them.
//
// Runs the REAL handler against the in-memory S3 (timeclock-itest-loader).
//
//   node scripts/overnight-confirm-test.mjs
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);
const { handler } = await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href);

const K = {
  people: "orgs/TESTORG/people.json",
  pay: "orgs/TESTORG/payhours.json",
  settings: "orgs/TESTORG/settings.json",
  tasks: "orgs/TESTORG/tasks.json",
  prod: "orgs/TESTORG/productionhours.json",
};

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const reset = () => {
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver" },
    [K.people]: [{ id: 99, name: "Trey", pin: "1234" }, { id: 100, name: "Max", pin: "5678" }],
    [K.pay]: [], [K.prod]: [], [K.tasks]: [],
  };
  globalThis.__WRITES = [];
  globalThis.__AUTH = { personId: 1, isAdmin: true, email: "admin@x.com" };
};
const post = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const pay = () => globalThis.__S3[K.pay];
const byId = (id) => pay().find(e => e.id === id);

// Freeze the clock so a clock-out writes a known instant.
//
// RESTORES ONLY `globalThis.Date`, AND NEVER ASSIGNS `Date.now`. The shim that
// clock-shift-test preloads replaces Date with a Proxy whose `get` trap serves
// its own `now`, and which has no `set` trap — so `Date.now = saved` writes the
// shifted `now` onto the REAL Date, and `now()`'s own `RealDate.now()` call then
// recurses until the stack dies. The class below carries a static `now`, so
// there was never anything to save.
const at = async (iso, fn) => {
  const OrigDate = Date;
  globalThis.Date = class extends OrigDate {
    constructor(...a) { return a.length ? new OrigDate(...a) : new OrigDate(iso); }
    static now() { return new OrigDate(iso).getTime(); }
  };
  try { return await fn(); } finally { globalThis.Date = OrigDate; }
};

// A stored punch. Times are UTC; the shop is America/Denver (UTC-6 in summer).
const punch = (o) => ({ id: o.id, personId: o.personId ?? 99, date: o.date,
  clockIn: o.clockIn, clockOut: o.clockOut, hours: o.hours ?? 8, jobRefs: [], source: "kiosk", ...o.extra });

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. THE WARNING SURVIVES THE CLOCK-OUT — all three paths");
// One stamp, three writers. Asserted at each SITE, not as a count: #502 only
// exists because a population statement ("the sweep notifies") was taken for a
// statement about every row.
{
  const STAMP = "2026-09-26T03:00:00.000Z";

  reset();
  globalThis.__S3[K.people][0].activeClockIn = { clockIn: "2026-09-25T16:24:00.000Z", jobRefs: [], events: [], source: "kiosk", forgotNotifiedAt: STAMP };
  await at("2026-09-28T16:18:00.000Z", () => post({ action: "clockOut", personId: 99, pin: "1234" }));
  ok("kiosk clockOut carries forgotNotifiedAt onto the punch", pay()[0]?.forgotNotifiedAt, STAMP);

  reset();
  globalThis.__S3[K.people][0].activeClockIn = { clockIn: "2026-09-25T16:24:00.000Z", jobRefs: [], events: [], source: "ios-app", forgotNotifiedAt: STAMP };
  globalThis.__AUTH = { personId: 99, isAdmin: false, email: "t@x.com" };
  await at("2026-09-28T16:18:00.000Z", () => post({ action: "payClockOut", personId: 99, pin: "1234" }));
  ok("iOS payClockOut carries it too", pay()[0]?.forgotNotifiedAt, STAMP);

  reset();
  globalThis.__S3[K.people][0].activeClockIn = { clockIn: "2026-09-25T16:24:00.000Z", jobRefs: [], events: [], source: "kiosk", forgotNotifiedAt: STAMP };
  await at("2026-09-28T16:18:00.000Z", () => post({ action: "adminClockOut", personId: 99 }));
  ok("adminClockOut carries it too", pay()[0]?.forgotNotifiedAt, STAMP);

  // A punch nobody was warned about must not grow an empty field — an absent
  // key and a null one read differently in a measurement.
  reset();
  globalThis.__S3[K.people][0].activeClockIn = { clockIn: "2026-09-25T16:24:00.000Z", jobRefs: [], events: [], source: "kiosk" };
  await at("2026-09-25T23:00:00.000Z", () => post({ action: "clockOut", personId: 99, pin: "1234" }));
  ok("an unwarned punch has no forgotNotifiedAt key at all", "forgotNotifiedAt" in pay()[0], false);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. CONFIRM REFUSES A RANGE HOLDING AN UNACKNOWLEDGED OVERNIGHT PUNCH");
{
  reset();
  // 13:41 MDT 9/21 -> 10:04 MDT 9/22. Trey's real 20.37h punch.
  pay().push(punch({ id: "A", date: "2026-09-21", clockIn: "2026-09-21T19:41:00.000Z", clockOut: "2026-09-22T16:04:00.000Z", hours: 20.37 }));
  const res = await post({ action: "confirmTimesheet", start: "2026-09-21", end: "2026-09-27" });
  ok("status is 409, not 200", res.statusCode, 409);
  ok("the punch was NOT confirmed", !!byId("A").confirmed, false);
  ok("nothing was written", globalThis.__WRITES.includes(K.pay), false);
  ok("the refusal names the row", (res.body.needsAcknowledgement || []).map(r => r.id), ["A"]);
  ok("...with enough to show it", Object.keys(res.body.needsAcknowledgement?.[0] || {}).sort(),
    ["clockIn", "clockOut", "date", "hours", "id", "personId"]);
}

console.log("\n3. THE LINE IS THE LOCAL DAY, NOT THE LENGTH");
{
  // Quincy's real 12.01h punch: 08:45 -> 20:45 MDT, one local day, two UTC days.
  // A gate written on elapsed hours or on the UTC date blocks this; it must not.
  reset();
  // 12.02h elapsed, deliberately OVER any 12h threshold — a gate written on
  // length rather than on the calendar has to break here, not squeak past.
  pay().push(punch({ id: "LONG", date: "2026-10-01", clockIn: "2026-10-01T14:45:00.000Z", clockOut: "2026-10-02T02:46:00.000Z", hours: 12.02 }));
  const res = await post({ action: "confirmTimesheet", start: "2026-10-01", end: "2026-10-07" });
  ok("a 12h day that ends before local midnight confirms freely", res.statusCode, 200);
  ok("...and really is stamped", !!byId("LONG").confirmed, true);

  // The mirror: one hour long, across local midnight. Short, and still unattended.
  reset();
  pay().push(punch({ id: "SHORT", date: "2026-10-01", clockIn: "2026-10-02T05:30:00.000Z", clockOut: "2026-10-02T06:30:00.000Z", hours: 1 }));
  const res2 = await post({ action: "confirmTimesheet", start: "2026-10-01", end: "2026-10-07" });
  ok("a 1h punch crossing local midnight is still gated", res2.statusCode, 409);
}

console.log("\n4. ACKNOWLEDGING IS PER ROW");
{
  reset();
  pay().push(punch({ id: "A", personId: 99, date: "2026-09-21", clockIn: "2026-09-21T19:41:00.000Z", clockOut: "2026-09-22T16:04:00.000Z", hours: 20.37 }));
  pay().push(punch({ id: "B", personId: 100, date: "2026-09-25", clockIn: "2026-09-25T16:24:00.000Z", clockOut: "2026-09-28T16:18:00.000Z", hours: 71.89 }));
  pay().push(punch({ id: "C", personId: 99, date: "2026-09-22", clockIn: "2026-09-22T15:00:00.000Z", clockOut: "2026-09-22T23:00:00.000Z", hours: 8 }));

  const partial = await post({ action: "confirmTimesheet", start: "2026-09-21", end: "2026-09-27", acknowledge: ["A"] });
  ok("acknowledging one of two still refuses", partial.statusCode, 409);
  ok("...and names only the one still outstanding", (partial.body.needsAcknowledgement || []).map(r => r.id), ["B"]);
  ok("...and confirmed nothing", pay().filter(e => e.confirmed).length, 0);

  const full = await post({ action: "confirmTimesheet", start: "2026-09-21", end: "2026-09-27", acknowledge: ["A", "B"] });
  ok("acknowledging both lets it through", full.statusCode, 200);
  ok("all three punches are confirmed", pay().filter(e => e.confirmed).length, 3);
  ok("the acknowledgement is recorded on the row", !!byId("A").overnightAckAt, true);
  ok("...with who did it", byId("A").overnightAckBy, 1);
  ok("the ordinary punch is not marked acknowledged", "overnightAckAt" in byId("C"), false);
}

console.log("\n5. AN ACKNOWLEDGEMENT STICKS");
{
  reset();
  pay().push(punch({ id: "A", date: "2026-09-21", clockIn: "2026-09-21T19:41:00.000Z", clockOut: "2026-09-22T16:04:00.000Z", hours: 20.37,
    extra: { overnightAckAt: "2026-09-23T00:00:00.000Z", overnightAckBy: 1 } }));
  const res = await post({ action: "confirmTimesheet", start: "2026-09-21", end: "2026-09-27" });
  ok("a row acknowledged earlier does not ask again", res.statusCode, 200);
}

console.log("\n6. THE GATE CANNOT BE TALKED PAST");
{
  reset();
  pay().push(punch({ id: "A", date: "2026-09-21", clockIn: "2026-09-21T19:41:00.000Z", clockOut: "2026-09-22T16:04:00.000Z", hours: 20.37 }));
  // Acknowledging a row that is not the gated one must not open the gate.
  const other = await post({ action: "confirmTimesheet", start: "2026-09-21", end: "2026-09-27", acknowledge: ["NOT-A-ROW"] });
  ok("acknowledging an id that is not in range changes nothing", other.statusCode, 409);
  ok("...and stamps nothing", "overnightAckAt" in byId("A"), false);

  // RE-OPENING MUST NEVER BE GATED. The gate exists to stop hours becoming
  // money; unconfirming takes money off the table and has to stay available,
  // or a bad confirm cannot be undone.
  reset();
  pay().push(punch({ id: "A", date: "2026-09-21", clockIn: "2026-09-21T19:41:00.000Z", clockOut: "2026-09-22T16:04:00.000Z", hours: 20.37,
    extra: { confirmed: true, confirmedAt: "2026-09-23T00:00:00.000Z", confirmedBy: 1 } }));
  const un = await post({ action: "unconfirmTimesheet", start: "2026-09-21", end: "2026-09-27" });
  ok("unconfirm is never gated", un.statusCode, 200);
  ok("...and really re-opens the row", !!byId("A").confirmed, false);
}

console.log("\n7. AN OPEN SHIFT IS NOT AN OVERNIGHT PUNCH");
{
  // A punch still running has no clockOut; confirmTimesheet already skips it,
  // and the gate must not read the missing value as "a different day".
  reset();
  pay().push({ id: "OPEN", personId: 99, date: "2026-09-21", clockIn: "2026-09-21T19:41:00.000Z", clockOut: null, hours: 0 });
  const res = await post({ action: "confirmTimesheet", start: "2026-09-21", end: "2026-09-27" });
  ok("an open shift neither blocks nor confirms", [res.statusCode, res.body.count], [200, 0]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. THE DESKTOP SHOWS THE REFUSAL INSTEAD OF SWALLOWING IT");
// A 409 the client does not understand reads as "Failed to confirm timesheet",
// which is the same message a broken deploy gives — so the gate would look like
// a bug and get worked around rather than used.
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("doConfirm sends the acknowledged ids",
    /confirmTimesheetAction\(\{ start: range\.start, end: range\.end, acknowledge \}/.test(CODE), true);
  ok("...and takes them as an argument with a safe default",
    /const doConfirm = async \(range, acknowledge = \[\]\) =>/.test(CODE), true);
  ok("a 409 is read as rows to show, not as a failure",
    /else if \(Array\.isArray\(res\.needsAcknowledgement\)\)/.test(CODE), true);
  ok("the rows are rendered", /tsOvernight\.map\(r => \{/.test(CODE), true);
  ok("each row has its own checkbox", /type="checkbox" checked=\{ticked\}/.test(CODE), true);
  ok("the button sends the ticks", /doConfirm\(range, tsOvernightAck\)/.test(CODE), true);
  ok("...and is dead until every row is ticked",
    /const blocked = gated && tsOvernightAck\.length < tsOvernight\.length;/.test(CODE), true);
  // Opening and closing must clear the list, or a stale refusal from a previous
  // range is still on screen for the next one.
  ok("opening the modal clears any previous refusal",
    /const openConfirm = \(\) => \{ setTsConfirmRange\(\{[^}]*\}\); setTsOvernight\(\[\]\); setTsOvernightAck\(\[\]\);/.test(CODE), true);
  ok("closing it does too",
    /const closeConfirm = \(\) => \{[^}]*setTsOvernight\(\[\]\); setTsOvernightAck\(\[\]\);/.test(CODE), true);
}

console.log("\n9. ALL THREE CLOCK-OUT WRITERS GO THROUGH THE ONE CARRIER");
// Pinned by SITE and by COUNT together: a count alone is green with the wrong
// three, and three site regexes alone stay green when a fourth writer appears.
{
  const { readFileSync } = await import("node:fs");
  const SRC = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8");
  ok("carryForgotNotice is called exactly three times",
    (SRC.match(/\.\.\.carryForgotNotice\(acForgot\),/g) || []).length, 3);
  ok("every clock-out destructure takes forgotNotifiedAt off activeClockIn",
    (SRC.match(/source: acSource = "(?:kiosk|ios-app)", forgotNotifiedAt: acForgot \} =/g) || []).length, 3);
  ok("no clock-out destructure is left without it",
    /source: acSource = "(?:kiosk|ios-app)" \} =/.test(SRC), false);
  ok("an absent notice contributes no key",
    /return forgotNotifiedAt \? \{ forgotNotifiedAt \} : \{\};/.test(SRC), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
