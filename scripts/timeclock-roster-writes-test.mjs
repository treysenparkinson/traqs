// #292. SEVENTEEN UNCONDITIONAL ROSTER WRITES IN timeclock.js.
//
// Every one read the whole roster at the top of the handler, changed one
// person, and PUT the lot back — the lost-write shape of #196, #453 and #386,
// seventeen times in the handler that decides hours. A write landing in between
// was erased by a copy of the roster that predated it.
//
// THE GUARDS HAD TO MOVE WITH THE WRITE, and that is the whole of why this is
// not a find-and-replace. Each branch checked its precondition against the
// roster it read at the top — "not currently clocked in", "already on lunch",
// "not on break" — and `updateJson` RE-RUNS its mutate when the conditional
// write finds the object changed. A guard left above the write runs once, on
// stale data, and the retry writes anyway: **a guard above a conditional write
// is the same as no guard.** So every precondition now lives inside the mutate
// and throws, exactly as #511's status check does.
//
// ORDER OF CONVERSION — by blast radius ascending, not file order:
//   1. the six pure-session branches (lunch/break start+end, breakBegin/Clear),
//      which touch one person's activeClockIn and nothing else;
//   2. the two clock-outs, where the roster write is already non-fatal because
//      the punch is saved to payhours first;
//   3. the admin session branches;
//   4. the four job-clock branches, which also write productionhours and the
//      task tree — last, when the pattern had been proved three times.
//
//   node scripts/timeclock-roster-writes-test.mjs
import { register } from "module";
import { readFileSync } from "node:fs";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
const { handler } = await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href);

const K = { people: "orgs/TESTORG/people.json", pay: "orgs/TESTORG/payhours.json",
  prod: "orgs/TESTORG/productionhours.json", tasks: "orgs/TESTORG/tasks.json", settings: "orgs/TESTORG/settings.json" };
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const SRC = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ─────────────────────────────────────────────────────────────────────────────
// TWELVE OF SEVENTEEN ARE CONVERTED, AND THE FIVE ARE NAMED RATHER THAN IMPLIED.
// The four job-clock branches also write productionhours.json and the task
// tree, and `releaseJobSession` and `adminEditEvent` rebuild a session's event
// cache from the punch log — each needs its OWN reasoning about what the retry
// re-reads, which is the work, not the find-and-replace. Converting them badly
// is worse than leaving them: these are the branches that decide job cost.
//
// The remainder is a RATCHET, not a note. The count below goes red the moment
// somebody converts one without updating it, which is the same mechanism the
// membership lint uses — and it cannot drift upward either, so a NEW plain
// roster write is caught as well.
const NOT_YET = ["adminEditEvent", "jobClockOut", "jobPause", "jobResume", "releaseJobSession"];

console.log("\n1. THE PLAIN ROSTER PUTS THAT REMAIN ARE EXACTLY THE FIVE NAMED");
{
  ok("twelve of seventeen are gone",
    (SRC.match(/writeStampedArray\(peopleKey/g) || []).length, NOT_YET.length);
  ok("no writeJson on peopleKey either",
    (SRC.match(/writeJson\(peopleKey/g) || []).length, 0);
  // The other two files are NOT in scope and are asserted so, because a sweep
  // that quietly widened would be the harder thing to notice later.
  ok("the payhours writes are deliberately untouched",
    (SRC.match(/writeStampedArray\(payKey/g) || []).length > 0, true);
}

console.log("\n2. EVERY BRANCH THAT WROTE THE ROSTER NOW GOES THROUGH mutatePersonFresh");
{
  // SITE-LEVEL, not a count: a count is green with the wrong seventeen (R4).
  // Each branch's text is sliced out and checked on its own.
  const CONVERTED = [
    "adminClockIn", "adminEditActiveClockIn", "adminReopenEntry",
    "breakBegin", "breakClear", "clockOut", "lunchStart", "lunchEnd", "breakStart", "breakEnd",
  ];
  for (const a of CONVERTED) {
    const at = SRC.indexOf(`if (action === "${a}")`);
    const body = at < 0 ? "" : SRC.slice(at, at + 4200);
    ok(`${a} uses the conditional single-person write`, /mutatePersonFresh\(/.test(body), true);
  }
  // adminClockOut shares its branch opener with adminClockIn, so it is checked
  // by its own clear instead — the one write it makes to the roster.
  ok("adminClockOut's session clear is conditional too",
    (SRC.match(/try \{ await mutatePersonFresh\(peopleKey, personId, \(fresh\) => \(\{ \.\.\.fresh, activeClockIn: null, activeBreak: null \}\)\); \} catch \{ \/\* non-fatal \*\/ \}/g) || []).length, 2);
  // adminBreakStart shares the admin lunch/break handler with three siblings.
  const al = SRC.indexOf('action === "adminLunchStart"');
  ok("the admin lunch/break handler uses it too",
    /mutatePersonFresh\(/.test(al < 0 ? "" : SRC.slice(al, al + 4200)), true);
}

console.log("\n3. THE GUARDS ARE INSIDE THE MUTATE, NOT ABOVE IT");
{
  // The property the conversion exists for. updateJson re-runs the mutate on a
  // precondition failure, so a check left outside runs once on stale data.
  // `refuse(status, message)` is the idiom: it throws, so updateJson's retry
  // re-runs it against the data that actually landed.
  ok("the refuse helper exists and throws",
    /const refuse = \(status, message\) => \{ const e = new Error\(message\); e\.status = status; throw e; \};/.test(SRC), true);
  for (const guard of ["Not currently clocked in", "Already on lunch", "Not on lunch", "Already on break", "Not on break"]) {
    ok(`"${guard}" refuses from inside the mutate`,
      new RegExp(`refuse\\(409, "${guard}"\\)`).test(SRC), true);
  }
  // And no session guard still returns early on the roster the handler read at
  // the top — the form that runs once and lets the retry through.
  for (const guard of ["Already on lunch", "Not on lunch", "Already on break", "Not on break"]) {
    ok(`...and no early return survives for "${guard}"`,
      new RegExp(`return err\\(409, "${guard}"\\)`).test(SRC), false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOURAL: one representative per shape, driven through the REAL handler
// with a competing write landing inside its window. Section 2 pins every site;
// these prove the mechanism actually survives a race.
const reset = () => {
  globalThis.__S3 = {
    [K.settings]: { timeZone: "America/Denver", workStart: "08:00", workEnd: "17:00" },
    [K.people]: [
      { id: 7, name: "Worker", pin: "1234", activeClockIn: { clockIn: "2026-10-05T15:00:00.000Z", jobRefs: [], events: [], source: "kiosk" } },
      { id: 42, name: "Bystander", pushToken: "tok-42" },
    ],
    [K.pay]: [], [K.prod]: [], [K.tasks]: [],
  };
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__PRECONDITION_FAILURES = [];
  globalThis.__AUTH = { orgCode: "TESTORG", personId: 7, isAdmin: true, email: "a@x.com" };
  globalThis.__BEFORE_WRITE = null;
};
const post = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const people = () => globalThis.__S3[K.people];
const byId = (id) => people().find(p => String(p.id) === String(id));
const competeOnPeople = () => {
  let fired = false;
  globalThis.__BEFORE_WRITE = async (k) => {
    if (fired || k !== K.people) return;
    fired = true;
    const arr = globalThis.__S3[K.people];
    const i = arr.findIndex(p => String(p.id) === "42");
    arr[i] = { ...arr[i], name: "Bystander RENAMED", pushToken: "tok-42-new" };
    globalThis.__ETAGS[K.people] = String(Number(globalThis.__ETAGS[K.people] ?? 0) + 1);
  };
};

console.log("\n4. A CONCURRENT ROSTER WRITE SURVIVES EACH SHAPE");
for (const [label, body] of [
  ["lunchStart (pure session)", { action: "lunchStart", personId: 7, pin: "1234" }],
  ["breakStart (pure session)", { action: "breakStart", personId: 7, pin: "1234" }],
  ["breakBegin (the lightweight status)", { action: "breakBegin", personId: 7 }],
  ["adminEditActiveClockIn (admin)", { action: "adminEditActiveClockIn", personId: 7, clockIn: "2026-10-05T16:00:00.000Z" }],
]) {
  reset(); competeOnPeople();
  const res = await post(body);
  ok(`${label}: the action succeeds`, res.statusCode, 200);
  ok(`${label}: the bystander's concurrent rename survives`, byId(42)?.name, "Bystander RENAMED");
  ok(`${label}: ...and their push token`, byId(42)?.pushToken, "tok-42-new");
}

console.log("\n5. A GUARD STILL REFUSES WHEN THE STATE CHANGED UNDER IT");
{
  // The reason the guards had to move. The handler reads "not on lunch", a
  // concurrent write starts one, and the retry must see it.
  reset();
  let fired = false;
  globalThis.__BEFORE_WRITE = async (k) => {
    if (fired || k !== K.people) return;
    fired = true;
    const arr = globalThis.__S3[K.people];
    const i = arr.findIndex(p => String(p.id) === "7");
    arr[i] = { ...arr[i], activeClockIn: { ...arr[i].activeClockIn, events: [{ type: "lunchStart", ts: "2026-10-05T18:00:00.000Z" }] } };
    globalThis.__ETAGS[K.people] = String(Number(globalThis.__ETAGS[K.people] ?? 0) + 1);
  };
  const res = await post({ action: "lunchStart", personId: 7, pin: "1234" });
  ok("a second lunchStart racing the first is refused", res.statusCode, 409);
  ok("...with the guard's own words", res.body?.error, "Already on lunch");
  ok("...and only one lunchStart event exists", (byId(7)?.activeClockIn?.events || []).filter(e => e.type === "lunchStart").length, 1);
}

console.log("\n6. THE ORDINARY PATHS STILL WORK");
{
  reset();
  const a = await post({ action: "lunchStart", personId: 7, pin: "1234" });
  ok("lunchStart returns 200", a.statusCode, 200);
  ok("...and records the event on the session", (byId(7)?.activeClockIn?.events || []).map(e => e.type), ["lunchStart"]);
  const b = await post({ action: "lunchEnd", personId: 7, pin: "1234" });
  ok("lunchEnd returns 200", b.statusCode, 200);
  ok("...and both events are on the session", (byId(7)?.activeClockIn?.events || []).map(e => e.type), ["lunchStart", "lunchEnd"]);
  const c = await post({ action: "lunchEnd", personId: 7, pin: "1234" });
  ok("a second lunchEnd is refused", c.statusCode, 409);

  reset();
  const d = await post({ action: "clockOut", personId: 7, pin: "1234" });
  ok("clockOut returns 200", d.statusCode, 200);
  ok("...clears the session", byId(7)?.activeClockIn, null);
  ok("...and wrote the punch", globalThis.__S3[K.pay].filter(r => !r.eventType).length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
