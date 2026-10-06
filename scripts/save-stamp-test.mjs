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
import { readFileSync } from "node:fs";
// The shared comment-stripped view. Section 7 asserts about the ORDER of two
// lines inside doSave, and the comment above adoptStamps names the conflict
// path in order to explain it -- a raw scan would match the prose.
import { codeOf } from "./_code-view.mjs";
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

// #387 -- A REFUSED SAVE MUST LEAVE THE CLIENT ABLE TO SAVE AGAIN.
//
// #337 above made the server return its stamps and the client adopt them -- ON
// THE SUCCESS PATH ONLY. In doSave the conflict branch returns at
// TRAQS.jsx:8126 and `adoptStamps` is not defined until :8144, so the one
// response that most needs its stamps read is the one response that never
// reaches the reader.
//
// The intended recovery was `rollbackToServer`, which refetches everything --
// but it opens with `if (saveStatusRef.current === "unsaved") return;`. It
// bails whenever the user has edited again since the save began, which is
// precisely when a conflict happens. Bail, and the client still holds the stamp
// it was just refused for: save, refused, bail, save, refused, forever.
//
// LIVE, 2026-10-06, the day enforce went on: fourteen task-conflict records,
// one job (402057), caller 99 -- Treysen conflicting with himself. His
// `incomingStamp` sat at 14:18:11.418Z across saves at :17, :18 and :20 while
// the stored stamp advanced 14:18:14.690 -> 14:18:17.733.
//
// THE PROPERTY, and nothing was checking it: a save that was REFUSED must still
// hand back the stamps, and a client that adopts them must get through next
// time. Section 6 proves it against the real handler; section 7 pins the client
// line that was missing.
console.log("\n6. THE PROPERTY — a refused save still returns stamps, and the next one lands");
{
  const storedHour = () => globalThis.__S3[K.tasks]?.[0]?.subs?.[0]?.subs?.[0]?.startHour;
  // Someone else wrote after we loaded: stored is NEWER than the copy we hold.
  const seedNewer = () => {
    reset({ mode: "enforce" });
    globalThis.__S3[K.tasks] = STORED().map(j => ({ ...j, lastModifiedAt: "2026-10-01T12:30:00.000Z",
      subs: j.subs.map(p => ({ ...p, subs: p.subs.map(o => ({ ...o, startHour: 20 })) })) }));
  };

  seedNewer();
  const copy = STORED();                      // stamp 12:00 -- stale by half an hour
  copy[0].subs[0].subs[0].startHour = 9;
  const r1 = await post(copy);
  ok("the stale save is refused", (r1.body.conflicts || []), ["JOB"]);
  ok("...and the server keeps its own copy", storedHour(), 20);

  // The half the server already does, asserted because the client fix rests on
  // it: without these the client has nothing to adopt and the loop is sealed.
  ok("the REFUSED response still carries stamps", typeof r1.body.stamps?.JOB, "string");
  ok("...and the stamp handed back is the STORED one", r1.body.stamps.JOB, storedStampOf("JOB"));
  ok("...not the stamp the client was just refused for", r1.body.stamps.JOB !== "2026-10-01T12:00:00.000Z", true);

  // A model of doSave's conflict branch run against the REAL handler.
  // `adoptOnConflict` is the entire difference between the client before this
  // fix and after it. `rollbackToServer` is deliberately NOT modelled: it bails
  // whenever the user has edited since the save began, which is every round
  // here, and the point of the fix is that the client recovers WITHOUT it.
  const run = async (adoptOnConflict, rounds = 3) => {
    seedNewer();
    let held = STORED();                      // what the client is holding
    const refused = [];
    for (let i = 0; i < rounds; i++) {
      held[0].subs[0].subs[0].startHour = 9 + i;   // the user edits again
      const r = await post(held);
      const hit = (r.body.conflicts || []).length > 0;
      refused.push(hit);
      if (hit && !adoptOnConflict) continue;  // the old client: body dropped
      held = adopt(held, r.body.stamps);
    }
    return refused;
  };
  // RED PROOF. This is Trey's loop, reproduced headlessly.
  ok("RED: not adopting on conflict, EVERY save is refused, forever", await run(false), [true, true, true]);
  // And the fix, stated as the property rather than as the line that causes it.
  ok("adopting on conflict, only the FIRST save is refused", await run(true), [true, false, false]);
  ok("...and the client's edit then lands", storedHour(), 11);
}

console.log("\n7. The client half — doSave adopts before it returns, and cancels its own debounce");
{
  const SRC = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  // Scoped by brace-free landmarks rather than searched file-wide: an earlier
  // suite in this campaign matched a second call site 17,000 lines away and
  // reported a fix that was not there.
  // `doSaveOnce` since #388 — `doSave` is now the serialised wrapper around it.
  const a = SRC.indexOf("const doSaveOnce = useCallback(async () => {");
  const b = SRC.indexOf("const rollbackToServer = async () => {", a);
  const DOSAVE = (a >= 0 && b > a) ? SRC.slice(a, b) : "";
  ok("doSave's body was located", DOSAVE.length > 1000, true);

  // FIX 2. Asserted by POSITION, because that is exactly what was wrong: both
  // lines existed, in the wrong order. A `/adoptStamps/.test()` would have been
  // green throughout the bug.
  const adoptAt = DOSAVE.indexOf("const adoptStamps =");
  const branchAt = DOSAVE.indexOf("status: 409,");
  ok("the 409 branch exists", branchAt > 0, true);
  ok("adoptStamps is DEFINED above the 409 branch", adoptAt > 0 && adoptAt < branchAt, true);
  const rollbackAt = DOSAVE.indexOf("rollbackToServerRef.current();", branchAt);
  const branch = rollbackAt > branchAt ? DOSAVE.slice(branchAt, rollbackAt) : "";
  // Through the wrapper, and the wrapper is resolved rather than trusted: an
  // `adoptAll()` that had stopped calling adoptStamps would satisfy a name
  // match and assert nothing (LESSONS #8 -- grepping a name returns the things
  // named after it).
  ok("...and the 409 branch ADOPTS before it rolls back and returns",
    /adoptAll\(\)|adoptStamps\(/.test(branch), true);
  const wrapAt = DOSAVE.indexOf("const adoptAll =");
  const wrap = wrapAt > 0 ? DOSAVE.slice(wrapAt, wrapAt + 600) : "";
  ok("...and adoptAll is defined above the branch", wrapAt > 0 && wrapAt < branchAt, true);
  ok("...and really does adopt all three slices",
    (wrap.match(/adoptStamps\(/g) || []).length, 3);
  ok("...tasks among them, which is the slice that conflicts",
    /adoptStamps\(results\[0\]\.value\?\.stamps/.test(wrap), true);

  // FIX 1. Every one of doSave's ~22 explicit callers is a `setTimeout(() =>
  // doSaveRef.current(), 0)` fired straight after a `setTasks`, and that
  // setTasks arms the 1s debounce at :8484. So one drag POSTs twice: once at
  // ~0ms, once at ~1000ms carrying the stamps from BEFORE the first save
  // adopted them. The live records are 70ms, 88ms and 1.03s apart with
  // identical bodies. One cancel inside doSave covers all 22 callers.
  ok("doSave cancels the queued debounced save", /clearTimeout\(saveTimerRef\.current\)/.test(DOSAVE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
