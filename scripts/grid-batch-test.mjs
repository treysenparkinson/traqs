// #456 — scheduling a task from the Jobs grid is ONE save, not three.
//
// START (save), END (save), ASSIGNEE (save), in a forced order, each a write to
// the shared file. Ruled 2026-10-08: batch only an UNSCHEDULED task being
// scheduled; a half-filled draft is SAVED ON LEAVE, never dropped silently.
// The completing write is Drop in Schedule's own: commitDates(node, { start,
// end, team }).
//
// Sections 1-3 run the pure rules (src/schedDraft.js). Section 4 checks the
// wiring in TRAQS.jsx, scoped per site (R4). What a source check cannot prove —
// that the browser makes one POST — was measured in the sandbox.
//
//   node scripts/grid-batch-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { isUnscheduledLeaf, holdsDateEdit, withDraftValue, overlayDraft, flushPatch, completionPatch } from "../src/schedDraft.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. WHAT BATCHES (ruling 2: only an unscheduled task being scheduled)");
const bare = { id: "o1", title: "T", start: "", end: "", team: [] };
ok("an undated, unassigned leaf batches", isUnscheduledLeaf(bare), true);
ok("one date set and nobody on it still batches (not yet scheduled)", isUnscheduledLeaf({ ...bare, start: "2026-10-21" }), true);
ok("a dated task does NOT batch — a change to it is one immediate save", isUnscheduledLeaf({ ...bare, start: "2026-10-21", end: "2026-10-22" }), false);
ok("an assigned task does NOT batch", isUnscheduledLeaf({ ...bare, team: ["7"] }), false);
ok("...nor one assigned by number id", isUnscheduledLeaf({ ...bare, team: [7] }), false);
ok("a parent (has subs) does NOT batch", isUnscheduledLeaf({ ...bare, subs: [{ id: "x" }] }), false);
ok("only START and END are held", [holdsDateEdit(bare, "start"), holdsDateEdit(bare, "end"), holdsDateEdit(bare, "dueDate"), holdsDateEdit(bare, "team")], [true, true, false, false]);

console.log("\n2. THE DRAFT");
const d1 = withDraftValue(null, bare, "start", "2026-10-21");
ok("typing START opens a draft for that row", d1, { id: "o1", start: "2026-10-21", end: "" });
const d2 = withDraftValue(d1, bare, "end", "2026-10-22");
ok("typing END adds to the same draft", d2, { id: "o1", start: "2026-10-21", end: "2026-10-22" });
ok("a value for ANOTHER row starts that row's draft (the caller flushes the first)", withDraftValue(d2, { ...bare, id: "o2" }, "start", "2026-11-02"), { id: "o2", start: "2026-11-02", end: "" });
ok("the row shows the draft's dates", [overlayDraft(bare, d2).start, overlayDraft(bare, d2).end], ["2026-10-21", "2026-10-22"]);
ok("...and only on its own row", overlayDraft({ ...bare, id: "o9" }, d2).start, "");
ok("...matching ids across string/number", overlayDraft({ ...bare, id: 1 }, { id: "1", start: "2026-10-21", end: "" }).start, "2026-10-21");

console.log("\n3. WHAT GETS WRITTEN — once");
ok("RULING 1: leaving a half-filled row saves what was typed", flushPatch(d1), { start: "2026-10-21" });
ok("...both dates when both were typed, in one patch", flushPatch(d2), { start: "2026-10-21", end: "2026-10-22" });
ok("...and nothing when nothing was typed", flushPatch({ id: "o1", start: "", end: "" }), null);
ok("picking who completes it: dates AND team in ONE patch", completionPatch(d2, ["7"]), { start: "2026-10-21", end: "2026-10-22", team: ["7"] });
ok("...team ids are written as strings", completionPatch(d2, [7]).team, ["7"]);
ok("...and it refuses to complete without both dates", completionPatch(d1, ["7"]), null);

console.log("\n4. THE GRID IS WIRED TO IT (R4: each check scoped to its site)");
const SRC = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const between = (startMark, endMark) => {
  const a = SRC.indexOf(startMark);
  if (a < 0 || SRC.indexOf(startMark, a + 1) >= 0) { console.error(`anchor not found exactly once: ${startMark}`); process.exit(2); }
  const b = SRC.indexOf(endMark, a + startMark.length);
  return SRC.slice(a, b < 0 ? undefined : b);
};
const cce = between("const commitCellEdit = (id, key, val, pid) => {", "\n  };");
ok("RED: a START/END edit on an unscheduled task is HELD, not saved", /if \(node && holdsDateEdit\(node, key\)\) \{\s*const d = withDraftValue\(schedDraftRef\.current, node, key, val\);\s*schedDraftRef\.current = d;\s*setSchedDraft\(d\);\s*return;/.test(cce), true);
ok("...the held branch returns before commitDates", (() => { const h = cce.indexOf("holdsDateEdit(node, key)"), c = cce.indexOf("commitDates(node"); return h >= 0 && c >= 0 && h < c; })(), true);
ok("...and a draft for ANOTHER row is flushed first (leaving it saves it)", /flushSchedDraft\(\)/.test(cce), true);
const flush = between("const flushSchedDraft = () => {", "\n  };");
ok("flush saves through commitDates with flushPatch — one write", /flushPatch\(d\)/.test(flush) && /commitDates\(node, patch\)/.test(flush), true);
const startCell = between('case "start": { const _sd = overlayDraft(item, schedDraft);', 'case "end": {');
ok("START shows the draft's date", /value=\{_sd\.start\}/.test(startCell), true);
const endCell = between('case "end": { const _sd = overlayDraft(item, schedDraft);', 'case "due": return (');
ok("END shows the draft's date", /value=\{_sd\.end\}/.test(endCell), true);
const assign = between("const _leaf = !(item.subs || []).length;", 'case "appr": {');
ok("the assignee gate reads the draft's dates", /const hasDates = !!\(_ad\.start && _ad\.end\)/.test(assign), true);
// R4: two call sites, the menu's rows and the pick's busy check — each asserted on its own.
ok("...and the menu marks busy against the draft's dates", /const rows = assignPickerFor\(_ad, _panel, _job\)/.test(assign), true);
ok("...and the pick refuses busy against the draft's dates", /const picked = assignPickerFor\(_ad, _panel, _job\)/.test(assign), true);
ok("picking who on a drafted row completes with ONE commitDates", /completionPatch\(_draftHere, \[v\]\)/.test(assign) && /commitDates\(_node, _patch\)/.test(assign), true);
ok("...and a refused completion keeps the draft (nothing typed is lost)", /=== false\) setSchedDraft\(_draftHere\)/.test(assign), true);
ok("the row claims its own clicks, portalled pickers included", /onMouseDownCapture=\{\(\) => \{ schedDraftHitRef\.current = item\.id; \}\}/.test(SRC), true);
ok("a mousedown the row did not claim flushes the draft", /if \(!sameId\(schedDraftHitRef\.current, schedDraft\.id\)\) flushSchedDraftRef\.current\(\);/.test(SRC), true);
ok("...and the claim is cleared in the CAPTURE phase first, so a stale one cannot shadow a click away",
  /const reset = \(\) => \{ schedDraftHitRef\.current = null; \};[\s\S]{0,400}document\.addEventListener\("mousedown", reset, true\)/.test(SRC), true);
ok("changing view flushes it", /useEffect\(\(\) => \(\) => \{ flushSchedDraftRef\.current\(\); \}, \[view\]\);/.test(SRC), true);
ok("closing the tab with a draft flushes it and asks first", /if \(!schedDraftRef\.current\) return;\s*flushSchedDraftRef\.current\(\);\s*e\.preventDefault\(\);/.test(SRC), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
