// #434 — a REFUSED drop must not animate. The flag belongs at the commit.
//
// `setDroppedBarId` was the FIRST thing the schedule's mouseup handler did, and
// every refusal path returns AFTER it:
//
//     setDroppedBarId(_dropId); setTimeout(clear, 500);   <- fired immediately
//     ...
//     return;                                             <- no-op / permission
//     showDepSiblingError(...); return;                   <- dependency sibling
//     if (_refusal) { _refused(_refusal); return; }        <- overlap, PTO, past, department
//     _refused({ kind: "splitPermission" }); return;
//     ...
//     setTasks(prev => _build(prev));                      <- the bar actually moves HERE
//
// So a drop that was REJECTED played the landing animation on a bar that never
// moved, while a refusal dialog opened over it. The flag does not even need a
// remount to do it: React changes the `animation` style from undefined to
// barDropIn, which starts it on the existing element.
//
// IT MATTERS MORE NOW THAN IT DID. #424 put the department and time-off rules on
// the assign path, and #427 made a cross-department drop rewrite rather than
// refuse — so the refusal paths that remain are the ones a user hits by accident,
// and each one was being congratulated with a landing animation.
//
// THIS TEST PINS THE ORDER, not the line. The flag may move anywhere the commit
// is, and may not drift back above a `return`.
//
//   node scripts/drop-flash-order-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));

// The handler: from the mouseup that owns the drop to the commit that ends it.
const start = CODE.indexOf("const onU = me => {");
const commit = CODE.indexOf("setTasks(prev => _build(prev));", start);
const handler = start >= 0 && commit > start ? CODE.slice(start, commit + 200) : "";

console.log("\n1. THE HANDLER IS WHERE WE THINK IT IS");
{
  ok("the mouseup handler was found", start > 0, true);
  ok("...and it ends at the commit", commit > start, true);
  ok("...and the slice is a real span, not a few characters", handler.length > 2000, true);
  // If this count changes, the assertions below are reasoning about a handler that
  // has been restructured and need re-reading rather than quietly still passing.
  const returns = (handler.match(/\breturn;/g) || []).length;
  ok("it still has early returns to protect against (count guard)", returns >= 3, true);
}

console.log("\n2. THE FLAG IS SET EXACTLY ONCE, AT THE COMMIT");
{
  const flagAt = handler.indexOf("setDroppedBarId(");
  ok("setDroppedBarId is in this handler", flagAt > 0, true);
  // The SETTER exactly once. A bare /setDroppedBarId\(/ also counts the clearing
  // call inside the setTimeout on the same line, so it reported 2 for correct code.
  ok("...the setter exactly once", (handler.match(/setDroppedBarId\(_dropId\)/g) || []).length, 1);
  ok("...and the clear exactly once", (handler.match(/setDroppedBarId\(prev =>/g) || []).length, 1);
  // THE WHOLE POINT. Every `return;` in the handler must come BEFORE the flag, so
  // no path that bails can have set it.
  const befores = [...handler.matchAll(/\breturn;/g)].map(m => m.index).filter(i => i > flagAt);
  ok("RED: no early return survives AFTER the flag is set", befores.length, 0);
  // ...and the flag sits with the write, not merely somewhere later.
  const commitAt = handler.indexOf("setTasks(prev => _build(prev));");
  ok("the flag is set within a few lines of the commit", commitAt - flagAt < 400 && commitAt > flagAt, true);
}

console.log("\n3. THE BEHAVIOUR IT PROTECTS IS STILL THERE");
{
  ok("the refusal path still refuses", /if \(_refusal\) \{ _refused\(_refusal\); return; \}/.test(handler), true);
  ok("the dependency-sibling path still refuses", /showDepSiblingError\(/.test(handler), true);
  ok("the split-permission path still refuses", /kind: "splitPermission"/.test(handler), true);
  ok("the commit still happens", /setTasks\(prev => _build\(prev\)\);/.test(handler), true);
  // The flag still clears itself, and still only clears its OWN drop — a second
  // drop inside the window must not have the first one's timer cancel it.
  ok("the flag still clears after the animation",
    /setTimeout\(\(\) => setDroppedBarId\(prev => prev === _dropId \? null : prev\), 500\)/.test(handler), true);
  ok("...and the bar still animates when it lands",
    /droppedBarId === bar\.id \? "barDropIn/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
