// The schedule's sticky name column paints over what scrolls under it — #114, #115.
//
// The bar area under a row creates no stacking context (position: relative, no z-index), so
// bars, the today line and the sticky name cell compete in one context. The name cell was z10:
// a HIGHLIGHTED bar (z10) tied it and won on tree order, and the today line (z12, dot z13) beat it
// outright, so both painted across people's names in a horizontally scrolled month. Measured in
// headless Chrome on that structure: at z10 elementFromPoint over the names returns the bar and
// the line; at 14 it returns the name cell. The cells now use STICKY_NAME_Z = 14 — above bars
// and the line, below the header's own sticky cell (15) and the drag feedback (34-40).
//
// The z-order is arithmetic once the structure is fixed, so the suite checks the numbers the
// render actually uses (comments stripped).
//
//   node scripts/sticky-names-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = S.replace(/^\s*\/\/.*$/gm, "");
const zDef = Number((code.match(/const STICKY_NAME_Z = (\d+);/) || [])[1]);
const a = code.indexOf("  const renderTeam = () => {\n"), b = code.indexOf("\n  const renderAnalytics = () => {");
const team = code.slice(a, b);

const stickyCells = (team.match(/position: "sticky", left: 0[^}]*zIndex: ([A-Z_0-9]+)/g) || []);
ok("the sticky name cells in the schedule are found", stickyCells.length >= 3);
const rowCells = stickyCells.filter(c => !/zIndex: 15/.test(c));
ok(`#114/#115 every row's name cell uses STICKY_NAME_Z (${rowCells.length})`, rowCells.length >= 2 && rowCells.every(c => /zIndex: STICKY_NAME_Z/.test(c)));
const highlighted = Number((team.match(/isHighlighted \? (\d+)/) || [])[1]);
const lineZ = Math.max(...[...team.matchAll(/today-(?:line|dot)"[^>]*zIndex: (\d+)/g)].map(m => Number(m[1])));
ok(`#114 a highlighted bar (z${highlighted}) is under the names (z${zDef})`, highlighted > 0 && zDef > highlighted);
ok(`#115 the today line and dot (up to z${lineZ}) are under the names`, lineZ > 0 && zDef > lineZ);
ok("...and the header's own sticky cell (15) still sits above them", zDef < 15);
const dragZ = Number((team.match(/isDraggingThis \? (\d+)/) || [])[1]);
ok(`...and a bar being dragged (z${dragZ}) still shows over them`, dragZ > zDef);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
