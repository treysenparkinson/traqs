// The job editor's per-op team picker lets the department follow the work, like a drop — #156,
// ruled 2026-10-15 ("#427 governs — the drop CHANGES the department, so the picker should NOT
// filter. Filtering would refuse what the drop permits ... Make the wizard's per-op picker match").
//
// The picker offered everyone (right) but wrote only `team`, so picking someone outside the op's
// department left the department saying someone else's — the stale state #427's own comment calls
// "a third behaviour worse than either". It now runs departmentFollow, the function every drop
// runs inside applyDragMove, and writes the same two fields. It still does not filter.
//
//   node scripts/picker-follow-test.mjs

import { readFileSync } from "node:fs";
import { departmentFollow } from "../src/dragMove.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// The rule, executed: what the picker now asks.
const people = [{ id: "w", name: "Wes", department: "Wire" }, { id: "c", name: "Cam", department: "Cut" }];
const op = { id: "o", title: "Wire", requiredDepartments: ["Wire"], team: ["w"] };
const toCam = departmentFollow(op, null, null, { reassigned: true, from: { team: ["w"] }, to: { team: ["w", "c"] } }, people);
ok("#156 adding someone from another department moves the department to theirs", JSON.stringify(toCam?.to) === '["Cut"]');
ok("...adding someone inside it changes nothing", departmentFollow(op, null, null, { reassigned: true, from: { team: [] }, to: { team: ["w"] } }, people) === null);

const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const at = S.indexOf("<SearchSelect\n                                multi\n                                values={(op.team || []).map(String)}");
const picker = S.slice(at, S.indexOf("/>", at));
ok("the job editor's per-op team picker is found", at > 0);
ok("#156 it still offers everyone (no department filter)", /options=\{people\.filter\(pp => pp && !pp\.deletedAt\)/.test(picker));
ok("#156 a pick runs departmentFollow", /departmentFollow\(op, panel, ej, \{ reassigned: true/.test(picker));
ok("#156 ...and writes the followed department with the team", /requiredDepartments: _dept\.to/.test(picker) && /team: _team/.test(picker));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
