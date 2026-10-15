// #386. timeoff.js WROTE BOTH ITS FILES WITH A PLAIN PUT.
//
// Third instance of the lost-write shape after #196 (the clock) and #453 (the
// roster), in a file neither touched. Every branch read `timeoff.json` and
// `people.json` at the top of the handler, mutated them, and PUT them back — so
// anything that landed in between was overwritten by a stale copy.
//
// TWO DIRECTIONS, AND THEY ARE DIFFERENT DEFECTS:
//
//   people.json — the approval carries its own copy of EVERYONE's record. A
//     roster save landing inside its window is erased by it. Since #349 the
//     people POST is itself conditional, so the reverse can no longer happen;
//     this is the half that was left.
//
//   timeoff.json — two admins deciding the same request at once. The second
//     read the request as `pending`, decided, and PUT a list that still said
//     pending for it — so the first decision vanished and the second one
//     silently won. The status check has to run on the data being written, not
//     on a copy read seconds earlier.
//
// THE HARNESS HAD TO BE FIXED BEFORE THIS COULD GO RED. `__BEFORE_WRITE` fired
// only inside `writeJsonIfMatch`, so against a plain PUT the competing write
// never landed and a race test passed while proving nothing. The stub's
// `writeJson` now calls it too (timeclock-itest-loader.mjs).
//
//   node scripts/timeoff-concurrency-test.mjs
import { register } from "module";
import { readFileSync } from "node:fs";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
const { handler } = await import(new URL("../netlify/functions/timeoff.js", import.meta.url).href);

const K = { req: "orgs/TESTORG/timeoff.json", people: "orgs/TESTORG/people.json" };
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const REQ = (over = {}) => ({ id: "R1", personId: 9, personName: "Quincy", type: "PTO",
  start: "2026-11-02", end: "2026-11-03", note: "", status: "pending", createdAt: "2026-10-01T00:00:00.000Z", ...over });
const reset = () => {
  globalThis.__S3 = {
    [K.req]: [REQ()],
    [K.people]: [
      { id: 1, name: "Admin", userRole: "admin", email: "a@x.com", adminPerms: { approveTimeOff: true } },
      { id: 9, name: "Quincy", timeOff: [] },
      { id: 42, name: "Bystander", pushToken: "tok-42" },
    ],
  };
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__PRECONDITION_FAILURES = [];
  globalThis.__AUTH = { orgCode: "TESTORG", personId: 1, isAdmin: true, email: "a@x.com" };
  globalThis.__BEFORE_WRITE = null;
};
const post = (body) => handler({ httpMethod: "PATCH", headers: {}, body: JSON.stringify(body) });   // decisions are PATCH; POST creates
const people = () => globalThis.__S3[K.people];
const reqs = () => globalThis.__S3[K.req];
const personBy = (id) => people().find(p => String(p.id) === String(id));

// Land one competing write the FIRST time `key` is about to be written.
const competeOnce = (key, mutate) => {
  let fired = false;
  globalThis.__BEFORE_WRITE = async (k) => {
    if (fired || k !== key) return;
    fired = true;
    mutate();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. A ROSTER SAVE INSIDE AN APPROVAL'S WINDOW SURVIVES IT");
{
  reset();
  // Someone edits a DIFFERENT person while the approval is in flight. The
  // approval holds its own copy of that record and must not write it back.
  competeOnce(K.people, () => {
    const arr = globalThis.__S3[K.people];
    const i = arr.findIndex(p => String(p.id) === "42");
    arr[i] = { ...arr[i], name: "Bystander RENAMED", pushToken: "tok-42-new" };
    globalThis.__ETAGS[K.people] = String(Number(globalThis.__ETAGS[K.people] ?? 0) + 1);
  });
  const res = await post({ id: "R1", action: "approve" });
  ok("the approval still succeeds", res.statusCode, 200);
  ok("the concurrent rename is NOT erased", personBy(42).name, "Bystander RENAMED");
  ok("...nor the push token it wrote", personBy(42).pushToken, "tok-42-new");
  ok("and the approval's own change landed", (personBy(9).timeOff || []).map(t => t.reqId), ["R1"]);
}

console.log("\n2. TWO ADMINS DECIDING AT ONCE — THE SECOND SEES THE FIRST");
{
  reset();
  // The first decision lands while the second is in flight. The second read
  // "pending"; by the time it writes, the request is denied. It must refuse
  // rather than overwrite, because an approval and a denial are not mergeable.
  competeOnce(K.req, () => {
    const arr = globalThis.__S3[K.req];
    arr[0] = { ...arr[0], status: "denied", decidedBy: "2", denialReason: "no cover" };
    globalThis.__ETAGS[K.req] = String(Number(globalThis.__ETAGS[K.req] ?? 0) + 1);
  });
  const res = await post({ id: "R1", action: "approve" });
  ok("the second decision is refused, not applied", res.statusCode !== 200, true);
  ok("the first admin's denial stands", reqs()[0].status, "denied");
  ok("...with its reason intact", reqs()[0].denialReason, "no cover");
  ok("no timeOff entry was written for a request that was denied",
    (personBy(9).timeOff || []).length, 0);
}

console.log("\n3. THE SAME FOR A CANCEL LANDING ON AN ALREADY-DECIDED REQUEST");
{
  reset();
  globalThis.__S3[K.req] = [REQ({ status: "approved" })];
  globalThis.__S3[K.people][1].timeOff = [{ start: "2026-11-02", end: "2026-11-03", reqId: "R1", type: "PTO" }];
  competeOnce(K.req, () => {
    const arr = globalThis.__S3[K.req];
    arr[0] = { ...arr[0], status: "cancelled" };
    globalThis.__ETAGS[K.req] = String(Number(globalThis.__ETAGS[K.req] ?? 0) + 1);
  });
  const res = await post({ id: "R1", action: "cancel" });
  ok("a cancel racing a cancel does not resurrect the request", reqs()[0].status, "cancelled");
  ok("...and leaves no duplicate timeOff entry",
    (personBy(9).timeOff || []).filter(t => t.reqId === "R1").length <= 1, true);
  ok("the handler answered rather than throwing", typeof res.statusCode, "number");
}

console.log("\n4. THE ORDINARY PATHS STILL WORK");
{
  reset();
  const res = await post({ id: "R1", action: "approve" });
  ok("approve returns 200", res.statusCode, 200);
  ok("the request is approved", reqs()[0].status, "approved");
  ok("the entry is linked by reqId", (personBy(9).timeOff || [])[0]?.reqId, "R1");

  reset();
  const d = await post({ id: "R1", action: "deny", reason: "busy week" });
  ok("deny returns 200", d.statusCode, 200);
  ok("...and records the reason", reqs()[0].denialReason, "busy week");
  ok("...and writes no timeOff entry", (personBy(9).timeOff || []).length, 0);

  reset();
  globalThis.__S3[K.req] = [REQ({ status: "approved" })];
  globalThis.__S3[K.people][1].timeOff = [{ start: "2026-11-02", end: "2026-11-03", reqId: "R1", type: "PTO" }];
  const r = await post({ id: "R1", action: "reopen" });
  ok("reopen returns 200", r.statusCode, 200);
  ok("...and pulls the entry back out of timeOff", (personBy(9).timeOff || []).length, 0);
}

console.log("\n4b. #151 — AN EDIT DOES NOT WRITE BACK THE PERSON IT READ AT THE START");
{
  // The edit branch ran inside commitPerson but returned `people[pIdx]` — the copy read at
  // the top of the handler — instead of building on `cur`, the fresh one. A profile edit to
  // the SAME person landing in between was erased. #292 and #511 are the same shape.
  for (const [what, body, want] of [
    ["a type/note change on an approved request", { id: "R1", action: "edit", type: "UTO", note: "moved" }, 1],
    ["a date change that sends it back for re-approval", { id: "R1", action: "edit", start: "2026-11-09", end: "2026-11-10" }, 0],
  ]) {
    reset();
    globalThis.__S3[K.req] = [REQ({ status: "approved" })];
    globalThis.__S3[K.people][1].timeOff = [{ start: "2026-11-02", end: "2026-11-03", reqId: "R1", type: "PTO" }];
    competeOnce(K.people, () => {
      const arr = globalThis.__S3[K.people];
      const i = arr.findIndex(p => String(p.id) === "9");
      arr[i] = { ...arr[i], phone: "555-0199", name: "Quincy R." };
      globalThis.__ETAGS[K.people] = String(Number(globalThis.__ETAGS[K.people] ?? 0) + 1);
    });
    const res = await post(body);
    ok(`${what}: 200`, res.statusCode, 200);
    ok(`...the concurrent profile edit to that person survives`, [personBy(9).phone, personBy(9).name], ["555-0199", "Quincy R."]);
    ok(`...and the time-off change still lands`, (personBy(9).timeOff || []).length, want);
  }
}

console.log("\n4c. #411, REVERSE DIRECTION — THE REQUEST'S GROUP USES THE ROSTER'S IDS");
{
  // This roster's ids are NUMBERS (1, 9, 42). The group was written with String() on every
  // member, and the web reads a group's memberIds with a strict `.includes(p.id)` — so on a
  // numeric roster nobody in the thread was found.
  reset();
  globalThis.__AUTH = { orgCode: "TESTORG", personId: 9, isAdmin: false, email: "q@x.com" };
  globalThis.__S3[K.people][1].email = "q@x.com";
  const res = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ type: "PTO", start: "2099-11-02", end: "2099-11-03", note: "" }) });
  ok("the request is created", res.statusCode, 200);
  const grp = (globalThis.__S3["orgs/TESTORG/groups.json"] || []).slice(-1)[0];
  ok("...and its group seats the requester and the approver under their roster ids", grp?.memberIds, [9, 1]);
}

console.log("\n5. NO PLAIN PUT SURVIVES ON EITHER FILE");
{
  const SRC = readFileSync(new URL("../netlify/functions/timeoff.js", import.meta.url), "utf8");
  ok("timeoff.json is never written with writeJson", /writeJson\(reqKey/.test(SRC), false);
  ok("people.json is never written with writeJson", /writeJson\(peopleKey/.test(SRC), false);
  ok("the file imports updateJson", /import \{ updateJson \} from "\.\/_utils\/update-json\.js"/.test(SRC), true);
  // The messages and groups writes are a different question and are NOT in
  // scope here — asserted so a later reader knows the omission was deliberate.
  ok("the chat-delivery write is deliberately left alone", /writeJson\(messagesKey/.test(SRC), true);
}

console.log("\n6. THE HARNESS KEEPS THE HOOK THAT MADE THIS GO RED");
{
  // THIS ASSERTION PROTECTS A RED PROOF, NOT A BEHAVIOUR, and it is here because
  // nothing else can. `__BEFORE_WRITE` originally fired only inside
  // `writeJsonIfMatch`. Against the plain PUTs this entry replaced, the hook was
  // never called, so the competing write never landed and sections 1–3 would
  // have passed while proving nothing.
  //
  // Now that timeoff.js is conditional, the hook fires from `writeJsonIfMatch`
  // anyway — so DELETING IT FROM `writeJson` LEAVES THIS SUITE GREEN. The next
  // person writing a race test against a path that has NOT been converted would
  // then get a silent false pass, which is the exact trap #386 fell into. One
  // source assertion is the only thing standing between here and that.
  const LOADER = readFileSync(new URL("./timeclock-itest-loader.mjs", import.meta.url), "utf8");
  const stub = /export const writeJson = async \(key, v\) => \{([\s\S]{0,200}?)\};/.exec(LOADER);
  ok("the in-memory writeJson calls __BEFORE_WRITE", /__BEFORE_WRITE/.test(stub?.[1] || ""), true);
  ok("...and writeJsonIfMatch still does too",
    /export const writeJsonIfMatch = async \(key, v, etag\) => \{\s*\n?\s*const hook = globalThis\.__BEFORE_WRITE;/.test(LOADER), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
