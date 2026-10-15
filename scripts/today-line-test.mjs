// Where "now" sits inside today's column — #129.
//
// The split gantt drew its today line at `dToX(TD) + cW / 2`: the middle of the column at any
// hour, so at 08:05 and at 15:55 it said it was lunchtime. The schedule places now by the
// fraction of the WORKING day that has passed, clamped to the column; this is that rule as one
// function, and the split gantt reads it.
//
//   node scripts/today-line-test.mjs

import { readFileSync } from "node:fs";
import { nowColumnFrac } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// An 08:00-17:00 day.
const W = { workStartH: 8, totalWorkH: 9 };
ok("#129 at work start, now is the column's left edge", near(nowColumnFrac({ nowHour: 8, ...W }), 0));
ok("#129 two hours in, now is 2/9 across", near(nowColumnFrac({ nowHour: 10, ...W }), 2 / 9));
ok("#129 at 12:30 it is half way", near(nowColumnFrac({ nowHour: 12.5, ...W }), 0.5));
ok("#129 at work end, now is the right edge", near(nowColumnFrac({ nowHour: 17, ...W }), 1));
ok("#129 before work start it stays on the left edge", near(nowColumnFrac({ nowHour: 5, ...W }), 0));
ok("#129 after hours it stays on the right edge", near(nowColumnFrac({ nowHour: 22, ...W }), 1));
ok("#129 a missing hour does not produce NaN", near(nowColumnFrac({ nowHour: NaN, ...W }), 0));
ok("#129 a zero-length day does not divide by zero", near(nowColumnFrac({ nowHour: 10, workStartH: 8, totalWorkH: 0 }), 0));

// The split gantt reads it (comments stripped, R4), and the fixed half-column is gone.
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const g = S.slice(S.indexOf("const renderSplitGantt ="), S.indexOf("const renderAdmin =")).replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
ok("#129 the split gantt's today line is placed by nowColumnFrac", /dToX\(TD\)\s*\+\s*cW\s*\*\s*nowColumnFrac\(/.test(g));
ok("#129 ...not at a fixed half column", !/dToX\(TD\)\s*\+\s*cW\s*\/\s*2/.test(g));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
