// A bar running over its estimate can be dragged and resized — #102, ruled 2026-10-15
// ("overrunning bars should be draggable. Work that ran long is exactly the work someone needs to
// move").
//
// `_dragBlocked` held every overrunning bar, and its stated reason was geometry: the bar is
// PAINTED at its pushed position while the drag measured from the stored start, so a drop would
// land somewhere other than where it was dropped. That reason is gone — since #25 the drag
// anchors on where the bar is painted (`_paintedDay = _layoutStart`), and resize works from the
// painted start and end. Only cross-row RECORD bars stay held (a synthetic id, not this row's
// work). NOT changed: a multi-drag MEMBER running over is still refused by name — it moves from
// its stored position (#309), so it would land somewhere it is not drawn.
//
// Scoped, comments stripped (R4).
//
//   node scripts/overrun-drag-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const block = (S.match(/const _dragBlocked = [^;]*;/) || [""])[0];
ok("the drag block is found", block.length > 0);
ok("#102 an overrunning bar is no longer held", !/_isOverrunning/.test(block));
ok("...a cross-row record still is", /bar\.crossRow/.test(block));
ok("the reason it is safe: the drag anchors on the painted position", /const _paintedDay = _layoutStart, _paintedHour = _barStartH;/.test(S));
ok("a multi-drag member running over is still refused by name (#309)", /isOverdue: n => _overdueIds\.has\(String\(n\?\.id\)\)/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
