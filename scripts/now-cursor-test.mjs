// One "now" position on the schedule — #74.
//
// The schedule placed now three times with three formulas: each bar's cursor (`_nowHourFrac`
// inside the bar loop, recomputed per bar), the today line (`_tlFrac`, which also read the
// clock AFRESH through shopHour() instead of the render's instant — the one read #75 missed,
// because it hides behind a default argument), and the split gantt's line (#129). They agreed
// only while each happened to clamp the same way at the same instant. Now renderTeam computes
// ONE position — nowColumnFrac at _renderNowMs, the rule the split gantt already uses — once
// per render, and the bars and the line both read it.
//
// Scoped to renderTeam, comments stripped (R4).
//
//   node scripts/now-cursor-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const a = S.indexOf("  const renderTeam = () => {\n"), b = S.indexOf("\n  const renderAnalytics = () => {");
const code = S.slice(a, b).replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

ok("#74 the schedule computes now's column fraction exactly once", (code.match(/nowColumnFrac\(/g) || []).length === 1);
ok("#74 ...at the render's instant", /nowColumnFrac\(\{ nowHour: shopHour\(_renderNowMs\)/.test(code));
ok("#74 no second now-fraction formula is left", !/shopHour\([^)]*\)\s*-\s*workStartH\)\s*\/\s*totalWorkH/.test(code) && !/\(_tlH - workStartH\)/.test(code));
// Drop handlers inside renderTeam read real time on purpose (they run after the render); what is
// banned is a render-time read. Those handlers pass the read straight into refuseDragMove/a ctx.
const renderReads = (code.match(/[^\n]*shopHour\(\)[^\n]*/g) || []).filter(l => !/nowDay: shopDay\(\), nowHour: shopHour\(\)/.test(l));
ok(`#74 nothing in the render reads the clock outside the one instant (found ${renderReads.length})`, renderReads.length === 0);
ok("#74 the bars read the one position", /const _nowGridPct = _nowGridPctR;/.test(code));
ok("#74 ...and so does the today line", /_tlLeft = [^;]*_nowIdxR[^;]*_nowFracR/.test(code));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
