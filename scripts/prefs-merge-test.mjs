// #441 — the user-settings blob is replaced wholesale, so an unrelated write
// from a stale tab reverts everything. And #431 — seven view preferences join
// it, but only once the write is safe.
//
// ─── #441, THE WRITE ───
//
// `user-settings.js` did `writeJson(key, stampObject(settings, existing))`: no
// merge, no ETag, no conditional put. The client sent ALL keys on every write,
// and fetched the blob ONCE per session — it is not in sync.js, not on Ably,
// not in IndexedDB. So:
//
//     09:00  tabs A and B both load the blob
//     15:00  widen a column in A   -> A writes all 8 keys from A's state
//     16:00  switch theme in B     -> B writes all 8 keys from B's 09:00 state
//            -> the column width is silently back to 09:00
//
// THE STALE WINDOW IS THE LIFETIME OF THE OLDER TAB, not a debounce. Nothing
// errors, and the write that destroyed the edit was about an unrelated
// preference.
//
// #339's shape, and EASIER here than it was there: a preference is only ever
// SET, never removed, so "absence means delete" — the thing that made the task
// delta hard — does not arise at all. The client sends only changed keys and
// the server merges them over what is stored.
//
// Not 409-on-stale: a conflict dialog on a theme toggle is worse than the bug.
//
// ─── #431, AND WHY 19 PREFERENCES STAY PUT ───
//
// Only seven move. The next person will see 26 localStorage keys and read the
// inconsistency as the defect, so the reasoning is recorded here as well as in
// the entry:
//
//   FREE TEXT IS WORSE THAN INCONSISTENT. `fJobNum`, `sFJobNum` and `fCustom`
//   hold a string you typed. Carried to another machine they filter a board for
//   a reason you cannot see and do not remember setting.
//
//   A FILTER IS A CURRENT INVESTIGATION, NOT A PREFERENCE. The eleven `f*`/`sF*`
//   filters hide work. Left on, they hide it on ONE machine today; migrated,
//   they hide it everywhere, which turns a personal annoyance into a support
//   call about missing jobs.
//
//   TRANSIENT STATE HAS NO MEANING ELSEWHERE. `expandedJobs`, `groupCollapsed`
//   and `tCollapsed` are id sets that grow with the board; `pmSectionsCollapsed`
//   and `detailSecClosed` are which accordions you left open.
//
// What moves is what you SET ON PURPOSE and would expect to find again.
//
//   node scripts/prefs-merge-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { changedPrefs } from "../src/prefsDelta.js";
import { mergePrefs, wouldEmptyPrefs } from "../netlify/functions/_utils/merge-prefs.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const RAW = read("../src/TRAQS.jsx");
const CODE = codeOf(RAW);

// The seven that move, and the nineteen that do not.
const MOVED = ["grouping", "jobSort", "colSort", "gSort", "jobsView", "showCompleted", "adminFilter"];
const STAY = ["fStat", "fDeptEqTitle", "fPers", "fJobNum", "fRole", "fHpd", "fOverloaded", "sFStat",
  "sFClient", "sFJobNum", "sFPers", "sFRole", "expandedJobs", "groupCollapsed", "pmSectionsCollapsed",
  "detailSecClosed", "fClient", "fCustom", "tCollapsed"];

console.log("\n1. #441 RED PROOF — the stale tab that reverts an unrelated preference");
{
  // The exact sequence from the measurement, played through both halves.
  const stored = { themeMode: "dark", colWidths: [100, 100], colOrder: ["a", "b"] };
  // 15:00 — tab A widens a column. Under the patch it sends ONLY colWidths.
  const aLoaded = { themeMode: "dark", colWidths: [100, 100], colOrder: ["a", "b"] };
  const aNow = { ...aLoaded, colWidths: [240, 100] };
  const aPatch = changedPrefs(aNow, aLoaded);
  ok("tab A sends only the key it changed", aPatch, { colWidths: [240, 100] });
  const afterA = mergePrefs(stored, aPatch);
  ok("...and the server stores it", afterA.colWidths, [240, 100]);

  // 16:00 — tab B, open since 09:00, switches theme. Its colWidths is STALE.
  const bLoaded = { themeMode: "dark", colWidths: [100, 100], colOrder: ["a", "b"] };
  const bNow = { ...bLoaded, themeMode: "light" };
  const bPatch = changedPrefs(bNow, bLoaded);
  ok("tab B sends only the theme", bPatch, { themeMode: "light" });
  const afterB = mergePrefs(afterA, bPatch);
  ok("THE COLUMN WIDTH SURVIVES THE UNRELATED WRITE", afterB.colWidths, [240, 100]);
  ok("...and the theme change landed too", afterB.themeMode, "light");
  ok("...and nothing else moved", afterB.colOrder, ["a", "b"]);

  // The old behaviour, for contrast: a wholesale write of B's state.
  const wholesale = { ...bNow };
  ok("the old wholesale write would have reverted it", wholesale.colWidths, [100, 100]);
}

console.log("\n2. #441 — changedPrefs, and which direction it fails in");
{
  const last = { a: 1, b: { x: 1 }, c: [1, 2] };
  ok("nothing changed sends nothing", changedPrefs({ ...last }, last), null);
  ok("one scalar change sends one key", changedPrefs({ ...last, a: 2 }, last), { a: 2 });
  ok("a nested change is seen", changedPrefs({ ...last, b: { x: 2 } }, last), { b: { x: 2 } });
  ok("an array change is seen", changedPrefs({ ...last, c: [1, 3] }, last), { c: [1, 3] });
  ok("two changes send two keys",
    changedPrefs({ ...last, a: 2, c: [9] }, last), { a: 2, c: [9] });
  // NOTHING KNOWN -> SEND EVERYTHING. The ref starts null and is only set after
  // a save the server accepted, so the first write of a session is full. Same
  // rule as deltaWrite's empty ack (#339).
  ok("a null baseline sends the whole bundle", changedPrefs(last, null), last);
  ok("...and so does a non-object one", changedPrefs(last, "nonsense"), last);
  // FALSE DIRTY IS SAFE, FALSE CLEAN IS NOT. JSON.stringify is key-order
  // sensitive and React rebuilds these objects by spreading, so a reordered
  // object reads as CHANGED. That over-sends a few bytes; the reverse would
  // lose the preference.
  ok("a reordered object is treated as changed, not as clean",
    changedPrefs({ b: { y: 1, x: 1 } }, { b: { x: 1, y: 1 } }), { b: { y: 1, x: 1 } });
  ok("a key the baseline has never seen is sent",
    changedPrefs({ ...last, d: 4 }, last), { d: 4 });
  ok("an empty bundle sends nothing", changedPrefs({}, last), null);
}

console.log("\n3. #441 — the merge, and the guard that cannot fire");
{
  ok("a patch lands on top of what is stored",
    mergePrefs({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
  ok("keys the patch does not mention are kept", mergePrefs({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  ok("a first write with nothing stored is just the patch", mergePrefs(null, { a: 1 }), { a: 1 });
  ok("a non-object stored value is treated as empty", mergePrefs("junk", { a: 1 }), { a: 1 });
  ok("an array stored value is treated as empty too", mergePrefs([1, 2], { a: 1 }), { a: 1 });
  ok("an empty patch changes nothing", mergePrefs({ a: 1 }, {}), { a: 1 });
  // LEGACY KEYS SURVIVE, and that is a real consequence of merging rather than
  // replacing. `statusOpts`/`priOpts` used to be garbage-collected by the next
  // write; now they linger. Harmless — the fold that reads them is idempotent
  // and gated by a localStorage flag — but the comment that said otherwise had
  // to be corrected, and this pins the behaviour so the next reader is not
  // surprised by a key nothing writes.
  ok("a key no client sends any more is preserved",
    mergePrefs({ statusOpts: [{ name: "x" }], themeMode: "dark" }, { themeMode: "light" }),
    { statusOpts: [{ name: "x" }], themeMode: "light" });

  // THE GUARD IS STRUCTURALLY UNREACHABLE, like #339's. A merge can only ever
  // add keys, so the stored result is a superset of what was there. It is kept
  // rather than deleted because it is the thing standing between this endpoint
  // and the 2026-06-03 shape, and a future change back to replace semantics
  // would need it again.
  ok("emptying a populated blob is refused", wouldEmptyPrefs({}, { a: 1 }), true);
  ok("...but a merge can never produce that", wouldEmptyPrefs(mergePrefs({ a: 1 }, {}), { a: 1 }), false);
  ok("an already-empty blob is not locked out", wouldEmptyPrefs({}, {}), false);
  ok("...nor one that was never written", wouldEmptyPrefs({}, null), false);
  ok("a populated result is fine", wouldEmptyPrefs({ a: 1 }, { a: 1 }), false);
  // THE STAMP IS NOT A PREFERENCE. `stampObject` writes `lastModifiedAt` into
  // every blob, so a blob that holds ONLY a stamp holds nothing a user set — and
  // counting it would make the guard treat that account as populated and refuse
  // its first real write. No fixture carried a stamp until a mutant walked
  // straight through this branch.
  ok("a blob holding only a stamp counts as empty",
    wouldEmptyPrefs({}, { lastModifiedAt: "2026-10-07T00:00:00Z" }), false);
  ok("...and the stamp does not make a result look populated either",
    wouldEmptyPrefs({ lastModifiedAt: "2026-10-07T00:00:00Z" }, { a: 1 }), true);
}

console.log("\n4. #441 — the endpoint and the client are wired to them");
{
  const fn = read("../netlify/functions/user-settings.js");
  ok("the endpoint merges rather than replacing", /mergePrefs\(existing, settings\)/.test(fn), true);
  ok("...and no longer writes the body straight through",
    /writeJson\(s3Key, stampObject\(settings, existing\)\)/.test(fn), false);
  ok("...and stores the merged object", /writeJson\(s3Key, stampObject\(merged, existing\)\)/.test(fn), true);
  ok("the guard asks about the RESULT, not the request's shape",
    /wouldEmptyPrefs\(merged, existing\)/.test(fn), true);
  ok("...and the old empty-body shape test is gone",
    /Object\.keys\(settings\)\.length === 0/.test(fn), false);
  ok("...and ?force=1 still overrides it, as it does on every other endpoint",
    /if \(!force && wouldEmptyPrefs\(merged, existing\)\)/.test(fn), true);

  // The client sends the patch, and only advances its baseline on success.
  const save = CODE.slice(CODE.indexOf("const bundle = {"), CODE.indexOf("const bundle = {") + 1400);
  ok("the save block was found", save.length > 0, true);
  ok("the client sends a patch", /changedPrefs\(bundle, lastSyncedUserSettingsRef\.current\)/.test(save), true);
  ok("...and sends nothing at all when nothing changed", /if \(!patch\) return;/.test(save), true);
  ok("...and passes the PATCH to the endpoint, not the bundle",
    /saveUserSettings\(patch, /.test(save), true);
  ok("the baseline advances only after the server accepted it",
    /\.then\(\(\) => \{ lastSyncedUserSettingsRef\.current = bundle; \}\)/.test(save), true);
}

console.log("\n5. #431 — the seven move, and only the seven");
{
  const bundleLine = (() => {
    const at = CODE.indexOf("const bundle = {");
    return at < 0 ? "" : CODE.slice(at, CODE.indexOf("}", at) + 1);
  })();
  ok("the bundle was found", bundleLine.length > 0, true);
  for (const k of MOVED) ok(`${k} is in the bundle`, bundleLine.includes(k), true);
  for (const k of STAY) ok(`${k} is NOT in the bundle`, bundleLine.includes(k), false);

  // Each of the seven is also READ BACK, or it would sync one way and never
  // arrive on the second machine — which is the whole point. Asserted as the
  // SETTER CALL and the TYPE GUARD, not as a mention: `/remote\.jobSort/` also
  // matches the guard, so dropping the guard and applying the raw value left it
  // green, and that mutant survived the first run.
  const GUARDED = {
    grouping: /if \(Array\.isArray\(remote\.grouping\)\) setGrouping\(remote\.grouping\)/,
    jobSort: /if \(typeof remote\.jobSort === "string"\) setJobSort\(remote\.jobSort\)/,
    colSort: /if \(remote\.colSort && typeof remote\.colSort === "object" && !Array\.isArray\(remote\.colSort\)\) setColSort\(remote\.colSort\)/,
    gSort: /if \(typeof remote\.gSort === "string"\) setGSort\(remote\.gSort\)/,
    jobsView: /if \(typeof remote\.jobsView === "string"\) setJobsView\(remote\.jobsView\)/,
    showCompleted: /if \(typeof remote\.showCompleted === "boolean"\) setShowCompleted\(remote\.showCompleted\)/,
    adminFilter: /if \(typeof remote\.adminFilter === "string"\) setAdminFilter\(remote\.adminFilter\)/,
  };
  for (const k of MOVED) {
    ok(`${k} is applied from the remote blob, behind a type check`, GUARDED[k].test(CODE), true);
  }

  // And each retriggers the save, or it would be read at load and never written
  // back. Membership of the dep array, not the array as a literal — pinning the
  // literal is what made col-visibility-test go red when this pass added keys.
  const saveDeps = (() => {
    const at = CODE.indexOf("const bundle = {");
    if (at < 0) return [];
    const open = CODE.indexOf("}, [", at);
    const close = CODE.indexOf("]", open);
    if (open < 0 || close < 0) return [];
    return CODE.slice(open + 4, close).split(",").map(s => s.trim()).filter(Boolean);
  })();
  ok("the save effect's deps were found", saveDeps.length > 0, true);
  for (const k of MOVED) ok(`${k} retriggers the save`, saveDeps.includes(k), true);
  for (const k of STAY) ok(`${k} does NOT retrigger it`, saveDeps.includes(k), false);
  // The nineteen keep their localStorage hook and gain nothing.
  for (const k of STAY) {
    ok(`${k} still persists locally only`,
      new RegExp(`usePersistedUI\\("${k}"`).test(CODE), true);
  }
}

console.log("\n6. HOW MANY WRITES, before and after");
{
  // The question that matters operationally: does merging make the endpoint
  // chattier? It does not. The debounce and the no-change skip are untouched,
  // so one settled change is still one write — what shrinks is the payload.
  // What DOES add writes is the migration: seven preferences that used to touch
  // localStorage only now reach the server.
  const base = { themeMode: "dark", colOrder: ["a"], colWidths: [100], grouping: [], jobSort: "date" };
  const session = [
    { ...base, themeMode: "light" },                       // theme toggle
    { ...base, themeMode: "light", colWidths: [240] },     // resize a column
    { ...base, themeMode: "light", colWidths: [240] },     // something re-renders, no change
    { ...base, themeMode: "light", colWidths: [240], jobSort: "client" }, // re-sort (newly synced)
  ];
  let last = base, writes = 0, bytes = 0, fullBytes = 0;
  for (const next of session) {
    const patch = changedPrefs(next, last);
    if (!patch) continue;
    writes++;
    bytes += JSON.stringify(patch).length;
    fullBytes += JSON.stringify(next).length;
    last = next;
  }
  ok("a session of 4 renders with 3 real changes makes 3 writes", writes, 3);
  ok("...the no-op render sends nothing", session.length - writes, 1);
  console.log(`         payload: ${bytes} B as patches vs ${fullBytes} B as whole bundles`);
  ok("the patches are smaller than the bundles would be", bytes < fullBytes, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
