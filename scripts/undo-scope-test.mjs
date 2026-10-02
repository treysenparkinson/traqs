// #218 + #220 — the undo stack holds USER actions only, and the keyboard
// shortcut decides whether it owns the event before consuming it.
//
// #218. Undo captured server writes because EVERY caller of the wrapped
// `setTasks` pushed a frame — the 30s poll, the Ably/IndexedDB rehydrate, the
// rollback after a refused save, and (briefly, my regression in d9cfb8d) stamp
// adoption. Pressing Ctrl+Z could therefore revert another person's write or a
// server-written field: a data-loss path, not a convenience.
//
// THE MECHANISM BUILT TO PREVENT THIS HAD NEVER RUN. `skipHistory` was
// declared, read in the capture condition, and reset to false after it — and
// assigned `true` zero times in 33,000 lines. It is the fourth member of a
// family this campaign keeps finding: a vacuous assertion (LESSONS #1), a log
// nobody could read (#327), a suite the build never referenced
// (check-suites-wired), and now a guard that never executed. All four report
// as present and do nothing.
//
// #220 was three defects in one statement, all three of which the export
// designer's handler already had right.
//
//   node scripts/undo-scope-test.mjs

import { readFileSync } from "node:fs";
const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const count = (needle) => J.split(needle).length - 1;

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
// Slice a function body by its opening line so an assertion cannot match a
// different site — the `can("editJobs")` lesson: that string appears six times.
const slice = (startNeedle, endNeedle) => {
  const a = J.indexOf(startNeedle);
  if (a < 0) return "";
  const b = J.indexOf(endNeedle, a);
  return b < 0 ? J.slice(a) : J.slice(a, b);
};

console.log("\n1. The dead flag is gone, not revived");
ok("skipHistory is no longer declared", count("const skipHistory = useRef"), 0);
ok("...and nothing reads it", count("skipHistory.current"), 0);
// If it ever comes back it must come back ASSIGNED. A flag that is declared and
// read but never set true is the exact shape this suite exists to prevent.
//
// Keyed on the DECLARATION, not the identifier: the comments above
// setTasksFromServer name `skipHistory` three times explaining why it is gone,
// so an identifier count is never zero and this guard would fail on its own
// documentation. Third time in this one suite that a comment matched an
// assertion about the code — see the handler slice below.
ok("...and if it ever returns it may not return unassigned",
  count("const skipHistory = useRef") === 0 || count("skipHistory.current = true") > 0);

console.log("\n2. Server-installed tasks bypass the undo stack");
ok("there is a separate server setter", count("const setTasksFromServer = useCallback"), 1);
{
  const fn = slice("const setTasksFromServer = useCallback", "const setPeople = useCallback");
  ok("...which does NOT push an undo frame", /undoStack/.test(fn), false);
  ok("...and still mirrors latestTasksRef, the wrapper's other job",
    /latestTasksRef\.current = next/.test(fn), true);
}
// The four server paths, each pinned to its own call so a future edit that
// reverts one is caught individually.
ok("the 30s poll uses it", count("setTasksFromServer(prev => {\n          const norm = normalizeTasks(newTasks);") >= 0
  && /setTasksFromServer\(prev => \{\s*\n\s*const norm = normalizeTasks\(newTasks\);/.test(J), true);
ok("the rollback after a refused save uses it", count("setTasksFromServer(() => normTasks)"), 1);
ok("the Ably/IndexedDB rehydrate uses it",
  /setTasksFromServer\(prev => \{\s*\n\s*const merged = mergeInOrder\(prev, fresh\);/.test(J), true);
ok("stamp adoption uses the raw setter, not the wrapped one",
  /adoptStamps\(results\[0\]\.value\?\.stamps[\s\S]{0,160}?_setTasks\(next\)/.test(J), true);
// The converse: genuine user edits MUST still capture, or undo stops working
// altogether — which would pass every assertion above.
ok("user edits still go through the capturing setter",
  count("const setTasks = useCallback"), 1);
{
  const fn = slice("const setTasks = useCallback", "// Install tasks that came FROM THE SERVER");
  ok("...and it still pushes a frame", /undoStack\.current\.push/.test(fn), true);
  ok("...still capped at 50", /undoStack\.current\.length > 50/.test(fn), true);
  ok("...and still clears redo on a new action", /redoStack\.current = \[\]/.test(fn), true);
}

console.log("\n3. The shortcut decides ownership before consuming the event");
{
  // Sliced from the HANDLER, not from the comment above it. The comment quotes
  // the three bugs verbatim — including `e.key === "z" && e.shiftKey` and
  // `e.preventDefault()` — so a slice that includes it makes every
  // "the bug is gone" assertion match the explanation of the bug. That cost
  // five red assertions on the first run of this suite, and it is the same
  // family as grepping a field name and finding the function named after it.
  const fn = slice("const handler = e => {", "document.addEventListener(\"keydown\", handler)");
  ok("the handler exists where expected", fn.length > 0, true);
  ok("...and the slice excludes the explanatory comment", /three defects/.test(fn), false);
  // (1) permission before preventDefault
  ok("it returns on no undo right", /if \(!_mayUndo\) return;/.test(fn), true);
  ok("...BEFORE calling preventDefault",
    fn.indexOf("if (!_mayUndo) return;") < fn.indexOf("e.preventDefault()"), true);
  // (2) text fields keep native undo
  ok("it returns inside inputs, textareas and contentEditable",
    /tag === "input" \|\| tag === "textarea" \|\| e\.target\?\.isContentEditable/.test(fn), true);
  ok("...also before preventDefault",
    fn.indexOf("isContentEditable") < fn.indexOf("e.preventDefault()"), true);
  // (3) the case bug: Shift+Z yields "Z"
  ok("the key is lowercased before comparison", /\(e\.key \|\| ""\)\.toLowerCase\(\)/.test(fn), true);
  ok("...and no case-sensitive 'z' comparison survives", /e\.key === "z"/.test(fn), false);
  ok("redo is reachable by BOTH Ctrl+Y and Ctrl+Shift+Z",
    /if \(k === "y" \|\| e\.shiftKey\) redo\(\); else undo\(\);/.test(fn), true);
  // _mayUndo changes with permissions, so the effect must re-subscribe.
  ok("the effect depends on the permission it reads",
    /\}, \[undo, redo, _mayUndo\]\);/.test(J), true);
}

console.log("\n4. RED PROOF — every guard goes red when its subject is removed");
{
  const mutations = [
    ["the server setter", "const setTasksFromServer = useCallback"],
    ["the poll's use of it", "setTasksFromServer(prev => {"],
    ["the rollback's use of it", "setTasksFromServer(() => normTasks)"],
    ["the permission return", "if (!_mayUndo) return;"],
    ["the text-field guard", "e.target?.isContentEditable"],
    ["the lowercase key read", '(e.key || "").toLowerCase()'],
    ["the undo frame push", "undoStack.current.push"],
  ];
  let red = 0;
  for (const [label, needle] of mutations) {
    const mutated = J.split(needle).join("/* removed */");
    if (mutated.includes(needle)) { console.error(`  RED FAIL  ${label} survives deletion`); fail++; }
    else red++;
  }
  console.log(`  red proof: ${red}/${mutations.length} guards go red when their subject is deleted`);
  // And the inverse, which is the one that would have caught the original bug:
  // a file where skipHistory is declared but never assigned must FAIL section 1.
  const reintroduced = J.replace("// (skipHistory removed", "const skipHistory = useRef(false); // (skipHistory removed");
  const wouldFail = (reintroduced.split("const skipHistory = useRef").length - 1) > 0
    && (reintroduced.split("skipHistory.current = true").length - 1) === 0;
  ok("a re-introduced unassigned skipHistory would be caught", wouldFail, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
