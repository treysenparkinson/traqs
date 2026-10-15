// The stored preferences that drove an uncontrollable sort are gone — #320, ruled 2026-10-15
// ("remove the stored preference that drives the dead grouping").
//
// `jobSort` (Jobs list) and `gSort` (schedule bars) chose between date, project and client order,
// but no control could set either: their only setters were the account-blob sync. An account blob
// carrying an old "client" would silently reorder the list and the schedule with nothing on screen
// to say so or change it. Both states, their blob reads and writes, and the project/client branches
// are removed; both sorts are the date order the default already gave.
//
//   node scripts/dead-sort-pref-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
ok("#320 jobSort is gone", !/\bjobSort\b|\bsetJobSort\b/.test(S));
ok("#320 gSort is gone", !/\bgSort\b|\bsetGSort\b/.test(S));
ok("#320 the account blob no longer restores either", !/remote\.jobSort|remote\.gSort/.test(S));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
