// #428/#430 — the value is shared, the visibility is personal (#429's ruling).
//
// HIDING A COLUMN DID NOT SURVIVE A RELOAD, and the cause was an encoding rather
// than a missing save. Hiding removed the id from `colOrder`; both readers then
// ran it through `backfillColOrder`, which adds back every known column missing
// from the saved list. So ABSENCE FROM THE ARRAY MEANT TWO THINGS — "I hid this"
// and "this column shipped after you last saved" — and backfill resolved the
// ambiguity in favour of the second, every time.
//
// Backfill is not wrong: without it a newly shipped column is stripped a moment
// after appearing, on every load. The ENCODING is what made the two facts
// indistinguishable. Same shape `scheduleRules` records for departments — "'Wire
// or Cut' had to be written as 'nothing', which is also how you write 'anyone'" —
// and the same fix: store the set explicitly.
//
//   colOrder    ORDER ONLY. Always complete; backfill still appends new columns.
//   hiddenCols  WHICH ARE HIDDEN. Explicit, so absence from the order no longer
//               carries a second meaning.
//
// Both live in the per-account blob (`user-settings.js`, keyed by the
// authenticated email server-side), so the preference follows the person to
// another browser — the second half of the ruling.
//
//   node scripts/col-visibility-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { backfillColOrder, visibleColOrder, hiddenFromLegacy } from "../src/columnPrefs.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The real list lives with the grid that defines it (STD_COL_DEFS in TRAQS.jsx),
// and these helpers take it as an argument so there is never a second copy to
// drift. This fixture exercises the logic; section 4 asserts the app passes its
// own, and the check below ties the two together so the fixture cannot rot into
// describing columns the grid no longer has.
const STD_COL_IDS = ["name", "jobNum", "client", "status", "pri", "start", "end", "due", "hrs", "progress", "team", "appr", "assignee"];
const K = STD_COL_IDS;

console.log("\n1. THE TWO FACTS ARE NOW SEPARATE");
{
  const known = STD_COL_IDS;
  const SRC = read("../src/TRAQS.jsx");
  ok("every id in the fixture is a column the grid really defines",
    STD_COL_IDS.filter(id => !SRC.includes(`id: "${id}",`)), []);
  ok("...including the one Trey hid", known.includes("team"), true);
  // RED: hiding `team` used to mean removing it from the order, which backfill undid.
  const order = backfillColOrder(known.filter(id => id !== "team"), K);
  ok("a column missing from a saved ORDER is still restored to the order", order.includes("team"), true);
  ok("...because that is what backfill is for — a newly shipped column", order.length, known.length);
  // ...and hiding is now said separately, so backfill cannot undo it.
  ok("RED: a hidden column is NOT visible, even though the order contains it",
    visibleColOrder(order, ["team"]).includes("team"), false);
  ok("...and every other column still is", visibleColOrder(order, ["team"]).length, known.length - 1);
  ok("hiding nothing shows everything", visibleColOrder(order, []).length, known.length);
  ok("the order is preserved, not re-sorted",
    visibleColOrder(["due", "name", "team"], ["team"]), ["due", "name"]);
}

console.log("\n2. THE MIGRATION — one bounded guess, to end a permanent ambiguity");
{
  // An account saved BEFORE this change has no hiddenCols, and its colOrder is
  // missing exactly the columns it hid. That is the only moment the old encoding
  // can still be read, so it is read once and written down explicitly.
  const saved = STD_COL_IDS.filter(id => id !== "team" && id !== "appr");
  ok("absence in a legacy order is taken as hidden", hiddenFromLegacy(saved, undefined, K).sort(), ["appr", "team"]);
  ok("...and an account with nothing hidden gets nothing", hiddenFromLegacy(STD_COL_IDS, undefined, K), []);
  // Once migrated the stored value wins outright — the guess happens once.
  ok("an explicit hiddenCols is used as-is", hiddenFromLegacy(saved, ["name"], K), ["name"]);
  ok("...including an explicit EMPTY list, which is not 'unset'", hiddenFromLegacy(saved, [], K), []);
  // THE TRADE, stated because it is a guess: a column that shipped after this
  // account last saved is indistinguishable from one they hid, and migration reads
  // it as hidden. Bounded and recoverable — the picker lists hidden columns and
  // puts one back in a click — and it happens once, after which the encoding is
  // unambiguous forever.
  ok("a never-seen column migrates as hidden (the known trade)",
    hiddenFromLegacy(["name"], undefined, K).includes("team"), true);
  ok("no saved order at all hides nothing", hiddenFromLegacy(null, undefined, K), []);
  ok("...nor does an empty one", hiddenFromLegacy([], undefined, K), []);
}

console.log("\n3. EDGES THAT MUST NOT THROW ON A PREFERENCE PATH");
{
  ok("unknown ids in the order are dropped", backfillColOrder(["team", "ghost"], K).includes("ghost"), false);
  ok("unknown ids in hiddenCols are harmless", visibleColOrder(["team"], ["ghost"]), ["team"]);
  ok("a non-array order", backfillColOrder(null, K).length, STD_COL_IDS.length);
  ok("a non-array hidden list", visibleColOrder(["team"], null), ["team"]);
  ok("duplicates in the order are collapsed", backfillColOrder(["team", "team"], K).filter(id => id === "team").length, 1);
}

console.log("\n4. IT IS WIRED — and both halves reach the per-account blob");
{
  const CODE = codeOf(read("../src/TRAQS.jsx"));
  ok("columnPrefs is imported", /from "\.\/columnPrefs\.js"/.test(CODE), true);
  ok("hiddenCols is state", /const \[hiddenCols, setHiddenCols\] = useState/.test(CODE), true);
  // RED: the bundle carried colOrder but no hiddenCols and no colWidths.
  ok("the per-account bundle carries hiddenCols",
    /const bundle = \{[^}]*\bhiddenCols\b[^}]*\}/.test(CODE), true);
  ok("...and colWidths (#3 — it persisted nowhere at all)",
    /const bundle = \{[^}]*\bcolWidths\b[^}]*\}/.test(CODE), true);
  ok("...and still carries what it already had",
    ["themeMode", "customTheme", "colOrder", "colLabels", "groupColPref", "userPrefs"]
      .filter(k => !new RegExp(`const bundle = \\{[^}]*\\b${k}\\b[^}]*\\}`).test(CODE)), []);
  // THE CALL, not the name (R4). `/remote\.hiddenCols/` also matches the `if`
  // condition that guards it, so replacing the call with `setHiddenCols([])` left
  // the assertion green — that mutant survived the first run.
  ok("the remote load applies hiddenCols through the migration",
    /setHiddenCols\(migrateHiddenCols\(remote\.colOrder, remote\.hiddenCols\)\)/.test(CODE), true);
  ok("...and colWidths", /setColWidths\(remote\.colWidths\)/.test(CODE), true);
  // RE-ANCHORED by #431. This pinned the dep array as a LITERAL, so it went red
  // the moment seven preferences joined the bundle — a true assertion failing
  // for a reason it was not about, which is the fixed-width slice problem in
  // another costume. What it is actually for is that these two keys retrigger
  // the save, so it asserts MEMBERSHIP of that effect's deps instead.
  // Read from CODE, where the trailing eslint-disable comment has been stripped,
  // so the dep array ends at `]);` and nothing else.
  const saveDeps = (() => {
    const at = CODE.indexOf("const bundle = {");
    if (at < 0) return [];
    const open = CODE.indexOf("}, [", at);
    const close = CODE.indexOf("]", open);
    if (open < 0 || close < 0) return [];
    return CODE.slice(open + 4, close).split(",").map(s => s.trim()).filter(Boolean);
  })();
  ok("the save effect's deps were found", saveDeps.length > 0, true);
  ok("...and hiddenCols retriggers it", saveDeps.includes("hiddenCols"), true);
  ok("...and colWidths too", saveDeps.includes("colWidths"), true);
}

console.log("\n5. HIDING NO LONGER MUTATES THE ORDER");
{
  const CODE = codeOf(read("../src/TRAQS.jsx"));
  // RED: `setColOrder(prev => prev.filter(id => id !== colCtxMenu.colId))`.
  ok("hiding a standard column adds to hiddenCols",
    /setHiddenCols\(prev => \[\.\.\.prev\.filter\(id => id !== colId\), colId\]\)/.test(CODE), true);
  ok("...and no longer removes it from the order",
    /setColOrder\(prev => prev\.filter\(id => id !== colCtxMenu\.colId\)\)/.test(CODE), false);
  // The picker that puts one back reads and writes the same list.
  ok("the picker lists hidden columns from hiddenCols",
    /STD_COL_DEFS\.filter\(c => hiddenCols\.includes\(c\.id\)\)/.test(CODE), true);
  ok("...and unhides by removing from it",
    /setHiddenCols\(prev => prev\.filter\(id => id !== c\.id\)\)/.test(CODE), true);
  ok("...not by appending to the order", /setColOrder\(prev => \[\.\.\.prev, c\.id\]\)/.test(CODE), false);
  // The grid renders the visible set, not the raw order.
  // NAMED BY SITE (R4). `visibleColOrder(colOrder, hiddenCols)` appears twice —
  // the grid and the grouping dropdown — so a bare presence check stayed green
  // with the GRID's call reverted. Each site asserted separately.
  ok("the grid's column list is the visible set",
    /const orderedStdCols = visibleColOrder\(colOrder, hiddenCols\)\.map\(/.test(CODE), true);
  ok("...and so is the grouping dropdown's",
    /columnOpts=\{\[\.\.\.visibleColOrder\(colOrder, hiddenCols\)\.map\(/.test(CODE), true);
}

console.log("\n6. #430 — ONE LABEL STOPS COVERING TWO DIFFERENT OPERATIONS");
{
  const CODE = codeOf(read("../src/TRAQS.jsx"));
  // A custom column's delete removes it from orgSettings.customCols — for the
  // whole organisation, with its data. A standard column's is a personal view
  // toggle. Same menu row, same word, and one of them is destructive and shared.
  ok("the row is labelled by what it does", /\{colCtxMenu\.isCustom \? "Delete Column" : "Hide Column"\}/.test(CODE), true);
  // THE DELETE MUST HAPPEN ONLY INSIDE THE CONFIRM. Asserting that the confirm
  // block merely CONTAINS a removeCustomCol left a mutant alive that called it
  // outright and returned before ever opening the dialog — the dead confirm below
  // still satisfied the pattern. So: exactly one call in the handler, and it is
  // the one in onConfirm.
  const h0 = CODE.indexOf("const colId = colCtxMenu.colId;");
  const handler = h0 < 0 ? "" : CODE.slice(h0, h0 + 1400);
  ok("the handler was found", handler.length > 400, true);
  ok("removeCustomCol is called exactly once in it",
    (handler.match(/removeCustomCol\(/g) || []).length, 1);
  ok("...and that call is inside onConfirm",
    /onConfirm: \(\) => \{ removeCustomCol\(colId\); setConfirmMove\(null\); \}/.test(handler), true);
  ok("...and the question says it is for everyone",
    /removes it and its data for everyone/.test(CODE), true);
  ok("...and names the column being deleted", /confirmMove[\s\S]{0,200}|title:/.test(CODE), true);
  // ASSERTED STRUCTURALLY, not by proximity. The first version was
  // /setConfirmMove\([\s\S]{0,200}setHiddenCols/ — which matches because the
  // confirm block simply SITS NEAR the hide line, and would have gone on matching
  // however the branches were arranged. What makes hiding unprompted is that the
  // custom branch RETURNS before the hide is reached.
  ok("the destructive branch returns before the hide line",
    /if \(colCtxMenu\.isCustom\) \{[\s\S]{0,1200}?\breturn;\s*\}\s*setHiddenCols\(/.test(CODE), true);
  ok("...so hiding is not wrapped in a confirm",
    /setConfirmMove\(\{[^}]*onConfirm: \(\) => \{ setHiddenCols/.test(CODE), false);
}

console.log("\n7. THE SERVER STORES IT PER PERSON — checked, not assumed");
{
  const us = read("../netlify/functions/user-settings.js");
  ok("the key is derived from the authenticated email, not client input",
    /function userSettingsKey\(orgCode, email\)/.test(us), true);
  ok("...and the blob is per org and per user",
    /orgs\/\$\{orgCode\}\/user-settings\//.test(us), true);
  // It replaces the blob wholesale, so a key the client stops sending is LOST.
  // That is why the bundle must carry every preference every time.
  ok("the client sends the whole bundle, not a patch",
    /const bundle = \{/.test(codeOf(read("../src/TRAQS.jsx"))), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
