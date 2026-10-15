// The User Permissions modal's PIN control is offered only to someone whose PIN save can land —
// #298 (its one clear bug; the gate-split items are recorded in the entry).
//
// It rendered on `isAdmin` and toasted "PIN saved" after any 2xx. people.js keeps every OTHER
// person's stored row verbatim for a caller without manageTeam, so a restricted admin's PIN save
// returned 200 having changed nothing: the toast said saved, the PIN was not. It now renders only
// with manageTeam, and a failed save says so instead of only logging to the console.
//
// Scoped to the PIN block, comments stripped (R4).
//
//   node scripts/pin-gate-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const at = S.indexOf("{/* Clock-In PIN");
const block = S.slice(at, S.indexOf('toast("PIN saved")', at) + 600).replace(/^\s*\/\/.*$/gm, "");
ok("the PIN block is found", at > 0);
ok("#298 the PIN control renders only for manageTeam", /\{can\("manageTeam"\) && \(\(\) => \{/.test(block));
ok("#298 a failed PIN save tells the user", /catch \(e\) \{[^}]*toast\(/.test(block));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
