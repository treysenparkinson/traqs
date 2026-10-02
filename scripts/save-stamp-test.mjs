// #337 — a save tells the client what stamp it just wrote, and the client's
// NEXT save carries it.
//
// THE PROPERTY NOTHING WAS CHECKING: after a successful save, the stamp the
// client holds must equal the stamp now stored. Everything about conflict
// detection rests on it, and it was false for every save in a session.
//
// Found by reading orgs/MTX2026TRAQS/rule-events.json on its first real read:
// five task-conflict records, one job, one caller, inside eight seconds — and
// an incomingStamp that NEVER MOVED (2026-10-01T19:39:52.595Z on all five)
// while each storedStamp was the previous record's own write. The client was
// conflicting with itself, because POST /tasks returned `{ ok: true }` and
// doSave read the body only for `conflicts`.
//
// That is why TASK_CONFLICT_MODE could not be flipped: in `enforce`, four of
// those five writes would have been refused. The detection was right; the
// client was wrong. This suite pins both halves.
//
//   node scripts/save-stamp-test.mjs
import { register } from "module";
// The real-timestamps loader, NOT timeclock-itest-loader: that one stubs
// changedIds to [] so no content difference is ever seen, and the conflict
// assertions below would pass by never detecting anything.
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let tasksFn;
try { tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load tasks.js:", e); process.exit(2); }

const K = { tasks: "orgs/TESTORG/tasks.json", conflicts: "orgs/TESTORG/rule-events.json",
  people: "orgs/TESTORG/people.json", settings: "orgs/TESTORG/settings.json" };

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const STORED = () => ([{
  id: "JOB", title: "Job", status: "In Progress", lastModifiedAt: "2026-10-01T12:00:00.000Z",
  subs: [{ id: "PANEL", title: "Panel", lastModifiedAt: "2026-10-01T12:00:00.000Z",
    subs: [{ id: "OP", title: "Op", status: "In Progress", startHour: 8, team: [7],
      start: "2026-10-01", end: "2026-10-01", lastModifiedAt: "2026-10-01T12:00:00.000Z" }] }],
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
const post = async (tasks) => {
  const res = await tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(tasks) });
  // The cors stub returns the body as an OBJECT, not a JSON string, unlike the
  // real `json()`. Handle both so this suite does not silently read `{}` and
  // report every stamp assertion as a code failure.
  const body = typeof res.body === "string" ? (() => { try { return JSON.parse(res.body); } catch { return {}; } })() : (res.body ?? {});
  return { status: res.statusCode, body };
};
const recs = () => (globalThis.__S3[K.conflicts]?.records || []);
const storedStampOf = (id) => (globalThis.__S3[K.tasks] || []).find(j => j.id === id)?.lastModifiedAt;

// What the FIXED client does: take the stamps the save returned and put them on
// the copy it keeps editing. Mirrors `adoptStamps` in doSave -- STAMP ONLY, the
// content stays whatever the client holds.
const adopt = (copy, stamps) => copy.map(j =>
  (stamps && stamps[String(j.id)]) ? { ...j, lastModifiedAt: stamps[String(j.id)] } : j);

console.log("\n1. The save RETURNS the stamp it wrote");
reset();
{
  const t = STORED();
  t[0].subs[0].subs[0].startHour = 9;
  const r1 = await post(t);
  ok("the save succeeds", r1.status, 200);
  ok("...and the body carries stamps", typeof r1.body.stamps, "object");
  ok("...for the job that was written", typeof r1.body.stamps?.JOB, "string");
  // The returned stamp must be the one actually stored, or adopting it just
  // moves the lie into the client.
  ok("...and the returned stamp IS the stored stamp", r1.body.stamps.JOB, storedStampOf("JOB"));
  ok("...which has advanced past what the client sent", r1.body.stamps.JOB !== "2026-10-01T12:00:00.000Z", true);
}

console.log("\n2. THE PROPERTY — save 2's incoming stamp is what save 1 stored");
reset();
{
  let copy = STORED();
  copy[0].subs[0].subs[0].startHour = 9;
  const r1 = await post(copy);
  const afterFirst = storedStampOf("JOB");

  // The client adopts, then edits again -- the real sequence: drag, drag.
  copy = adopt(copy, r1.body.stamps);
  ok("the client's copy now holds the stored stamp", copy[0].lastModifiedAt, afterFirst);

  copy[0].subs[0].subs[0].startHour = 11;
  const r2 = await post(copy);
  ok("the second save succeeds", r2.status, 200);
  // THE assertion. Everything else in this file supports it.
  ok("NO conflict is recorded — the second save was not stale", recs().length, 0);
  ok("...and its stamp advanced again", r2.body.stamps.JOB !== afterFirst, true);

  // Three in a row, because the production trace was five.
  copy = adopt(copy, r2.body.stamps);
  copy[0].subs[0].subs[0].startHour = 13;
  const r3 = await post(copy);
  ok("a third sequential save is also clean", [r3.status, recs().length], [200, 0]);
}

console.log("\n3. RED PROOF — the OLD client reproduces the production trace");
reset();
{
  // Exactly the old behaviour: POST, ignore the body, POST again from the same
  // copy. This is what produced five records with one frozen incomingStamp.
  const copy = STORED();
  copy[0].subs[0].subs[0].startHour = 9;
  await post(copy);                       // body dropped, as doSave used to
  const afterFirst = storedStampOf("JOB");

  copy[0].subs[0].subs[0].startHour = 11; // edit again, stamp NOT adopted
  await post(copy);

  ok("the un-adopted second save IS recorded as a conflict", recs().length, 1);
  const r = recs()[0] || {};
  // The signature of the bug: the client posts the stamp it loaded with...
  ok("...with the stamp the client loaded with, unmoved", r.incomingStamp, "2026-10-01T12:00:00.000Z");
  // ...against the stamp its OWN previous write stored.
  ok("...against the stamp its own previous save stored", r.storedStamp, afterFirst);
  ok("...so the client is conflicting with itself", r.staleByMs < 0, true);
  if (recs().length !== 1) {
    console.error("  RED PROOF FAILED: the old sequence no longer conflicts, so section 2 proves nothing");
    fail++;
  }
}

console.log("\n4. Why TASK_CONFLICT_MODE could not be flipped");
{
  // enforce + old client: the second write is REFUSED. This is the finding that
  // reversed #185's recommendation -- correct detection against a broken client.
  reset({ mode: "enforce" });
  const stale = STORED();
  stale[0].subs[0].subs[0].startHour = 9;
  await post(stale);
  stale[0].subs[0].subs[0].startHour = 11;
  const bad = await post(stale);
  ok("the un-adopted second save is refused in enforce", (bad.body.conflicts || []), ["JOB"]);

  // enforce + fixed client: clean. Same mode, same edits, one difference.
  reset({ mode: "enforce" });
  let good = STORED();
  good[0].subs[0].subs[0].startHour = 9;
  const g1 = await post(good);
  good = adopt(good, g1.body.stamps);
  good[0].subs[0].subs[0].startHour = 11;
  const g2 = await post(good);
  ok("...while the adopting client is accepted in the SAME mode", (g2.body.conflicts || []), []);
  ok("...and stamps are returned in enforce too, or the fix dies on flip", typeof g2.body.stamps?.JOB, "string");
}

console.log("\n5. Adopting is safe when there is nothing to adopt");
reset();
{
  // A no-op save changes no content, so stampArray preserves the old stamp and
  // the client's copy is already correct. Nothing should be recorded and the
  // client must not be handed a stamp that moved for no reason.
  const same = STORED();
  const r = await post(same);
  ok("a no-op save still succeeds", r.status, 200);
  ok("...records no conflict", recs().length, 0);
  ok("...and reports the UNCHANGED stamp, so adopting is a no-op",
    r.body.stamps?.JOB, "2026-10-01T12:00:00.000Z");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
