// The AI moving a job moves its operations, keeping their relative offsets — #400 (job half),
// ruled 2026-10-15 ("A job's dates are a rollup of its ops, so moving the parent without the
// children means either the move doesn't happen or the rollup fights it. Same as updTask's
// cascade in #492 — one moveLog entry on the parent, not one per child").
//
// update_job passed the model's start/end straight to updTask, whose job-level cascade shifts
// the panels and ops only when BOTH dates move by the SAME delta. "Move it to the 20th" — a start
// alone — moved nothing, and the rollup put the job's dates straight back. jobMoveWindow turns
// any AI move into a whole-job shift by ONE delta (the start's if given, otherwise the end's), so
// updTask's existing cascade moves every dated panel and op and writes one entry on the parent.
//
//   node scripts/ai-job-move-test.mjs

import { readFileSync } from "node:fs";
import { jobMoveWindow } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// A plain calendar: every day a working day, so deltas are easy to read.
const D = (s) => Date.parse(s + "T12:00:00Z");
const cal = {
  diffSigned: (a, b) => Math.round((D(b) - D(a)) / 86400000),
  add: (s, n) => new Date(D(s) + n * 86400000).toISOString().slice(0, 10),
};
const job = { start: "2026-10-05", end: "2026-10-09" };

ok("#400 a start alone moves the whole window by its delta", JSON.stringify(jobMoveWindow(job, { start: "2026-10-12" }, cal)) === JSON.stringify({ start: "2026-10-12", end: "2026-10-16" }));
ok("#400 an end alone moves it by the end's delta", JSON.stringify(jobMoveWindow(job, { end: "2026-10-11" }, cal)) === JSON.stringify({ start: "2026-10-07", end: "2026-10-11" }));
ok("#400 start and end that disagree: the start leads, the duration is the ops'", JSON.stringify(jobMoveWindow(job, { start: "2026-10-12", end: "2026-10-30" }, cal)) === JSON.stringify({ start: "2026-10-12", end: "2026-10-16" }));
ok("no date asked for: nothing to move", jobMoveWindow(job, {}, cal) === null);
ok("an undated job has no window to shift", jobMoveWindow({ start: null, end: null }, { start: "2026-10-12" }, cal) === null);
ok("a move of zero is no move", jobMoveWindow(job, { start: "2026-10-05" }, cal) === null);

const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = S.lastIndexOf('case "update_job": {');
const h = S.slice(at, S.indexOf("break;", at));
ok("#400 update_job asks jobMoveWindow for the window it moves to", /jobMoveWindow\(/.test(h));
ok("#400 ...and hands updTask BOTH dates, so its cascade moves the children", /upd\.start = _win\.start; upd\.end = _win\.end;/.test(h));
ok("...still through updTask, which writes the one entry on the parent", /updTask\(input\.job_id/.test(h));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
