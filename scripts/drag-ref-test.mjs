// The schedule drag's landing belongs to ONE drag — #381 (and #378, which it subsumes).
//
// teamDragLiveRef holds the landing the ghost draws and the drop commits. It was set by a
// mousemove that could project a landing and NEVER reset, so a drag whose moves all failed to
// project (snapS null) committed the PREVIOUS drag's landing — another bar's position — and a
// drag with no ref at all fell back to the bar's start at workStartH, i.e. moved it to 08:00.
// Now the ref is cleared when a drag begins, and a drop with no projected landing commits
// nothing. #378 (the last frame failing to project) is not a defect on its own: the ghost and
// the drop read the same ref, so the drop commits exactly what the ghost last showed.
//
// Scoped to handleTeamDrag and its onU, comments stripped (R4).
//
//   node scripts/drag-ref-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");

const at = S.indexOf("const handleTeamDrag = (e) => {");
const end = S.indexOf("const handleTeamResize = (e, side) => {", at);
const drag = S.slice(at, end);
ok("handleTeamDrag is found", at > 0 && end > at);
const regAt = drag.lastIndexOf('document.addEventListener("mousemove", onM);');
const resetAt = drag.lastIndexOf("teamDragLiveRef.current = null;", regAt);
ok("#381 the landing ref is cleared when the drag begins, before its listeners", resetAt > 0 && resetAt < regAt && resetAt > drag.indexOf("const onU = "));
const uAt = drag.indexOf("const onU = ");
const onU = drag.slice(uAt, regAt);
const guardAt = onU.search(/if \(!teamDragLiveRef\.current\)\s*return;/);
const commitAt = onU.indexOf("setTasks(prev => _build(prev))");
ok("#381 a drop with no projected landing commits nothing", guardAt > 0 && commitAt > guardAt);
ok("...and the guard comes after the click (not-moved) branch, so a click still opens the bar", guardAt > onU.indexOf("if (!moved)"));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
