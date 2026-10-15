// The AI's update_operation moves and reassigns through the same commit as every other path — #400 (item 2, the op half).
//
// It wrote start/end/team with updTask, a plain patch: no refusal chain (clocked-in, locked,
// record, time-off, past, department follow), no overlap backstop. The Jobs list had the same
// "quieter path" and #398 ruled it the defect. The schedule half of update_operation now goes
// through commitDates (with the AI's own moveLog reason); a status change stays a plain patch,
// because it is not a schedule field. A refused move is not reported as applied.
//
// NOT DONE here, and recorded in the entry: update_job's dates and the job-level assign/remove
// and create — job dates are rolled up from their ops, so what an AI "move the job" should do
// to the children is a decision, not a routing change.
//
// Scoped to the handler and to commitDates, comments stripped (R4).
//
//   node scripts/ai-op-commit-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = S.lastIndexOf('case "update_operation": {');
const h = S.slice(at, S.indexOf("break;", at) + 6);
ok("the update_operation handler is found", at > 0);
ok("#400 its dates and team go through commitDates", /commitDates\(/.test(h));
ok("#400 ...with the AI's own reason on the moveLog", /commitDates\([^)]*"Moved by TRAQS AI"\)/.test(h));
ok("#400 ...and never as a plain updTask patch", !/updTask\([^;]*(start|end|team)/.test(h.replace(/updTask\(input\.operation_id, \{ status: input\.status \}[^;]*;/, "")));
ok("#400 a refused move is not reported as applied", /=== false/.test(h));
ok("commitDates takes a reason, defaulting to the Jobs list's", /const commitDates = \(op, next, reason = "Date typed on the Jobs list"\) => \{/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
