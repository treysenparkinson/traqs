// Settling a job reorders only the phase the edit touched — #415, ruled 2026-10-15 ("settle only
// the phase that was touched").
//
// updTask's settle ran reflowJob over EVERY phase of the job whenever a date moved, while every
// other commit path settles only what moved (enforceNoOverlap(list, touchedIds)). An op edit or a
// panel edit now settles that panel alone; a JOB edit still settles every phase, because moving
// the job moves all of them. The rollup of dates is unchanged and still covers the whole job.
//
// Scoped, comments stripped (R4).
//
//   node scripts/settle-scope-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const rj = S.slice(S.indexOf("const reflowJob = (job, opts) => {"), S.indexOf("\n};", S.indexOf("const reflowJob = (job, opts) => {")));
ok("reflowJob is found", rj.length > 0);
ok("#415 reflowJob can be told which phases to settle", /opts\?\.phaseIds && !opts\.phaseIds\.has\(String\(pn\.id\)\)\) return;/.test(rj));
ok("#415 ...and still rolls the dates up over the whole job", /return rollUpJobDates\(out\);/.test(rj));
const settle = (S.match(/const settle = [^;]*;/) || [""])[0];
ok("#415 updTask's settle passes the phases through", /phaseIds/.test(settle));
ok("#415 an op edit settles its own panel", /return settle\(\{ \.\.\.t, subs: newSubs \}, new Set\(\[String\(pid\)\]\)\);/.test(S));
ok("#415 a panel edit settles that panel", /return settle\(\{ \.\.\.t, subs: newSubs \}, new Set\(\[String\(id\)\]\)\);/.test(S));
ok("#415 a job edit still settles every phase", /return settle\(updated\);/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
