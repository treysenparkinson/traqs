// A tombstoned panel or op is not a child — #209 (a counting defect, ruled out of the id
// cluster and into the rollup family).
//
// The wizard's AI suggest (suggestSchedule) and the save-time overlap check walked `subs` as
// children with no deletedAt test, so a deleted op would be suggested, and checked for — and
// refused on — overlaps it cannot have. Both now go through `liveSubs`, the one definition of
// "this node's children". Latent: nothing writes deletedAt below the job level today. The
// other ~40 `.subs` walks are NOT swept here; most already filter, and a full sweep is a survey.
//
// Scoped to each walk, comments stripped (R4).
//
//   node scripts/live-subs-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = S.replace(/^\s*\/\/.*$/gm, "");

// The definition, evaluated rather than read.
const defAt = code.indexOf("const liveSubs = ");
ok("liveSubs is defined once, at module scope", defAt > 0 && code.indexOf("const liveSubs = ", defAt + 1) < 0);
const liveSubs = eval(code.slice(defAt + "const liveSubs = ".length, code.indexOf(";", defAt)));
ok("#209 it drops tombstoned children", JSON.stringify(liveSubs({ subs: [{ id: "a" }, { id: "b", deletedAt: "2026" }, null] }).map(x => x.id)) === '["a"]');
ok("...and copes with a node that has none", liveSubs({}).length === 0 && liveSubs(null).length === 0);

const sAt = code.indexOf("const suggestSchedule = () => {");
const suggest = code.slice(sAt, code.indexOf("if (rawOps.length === 0)", sAt));
ok("#209 AI suggest takes a panel's ops from liveSubs", /liveSubs\(panel\)/.test(suggest) && !/panel\.subs \|\| \[\]/.test(suggest));
const cAt = code.indexOf("const opsToCheck = [];");
const check = code.slice(cAt, code.indexOf("const checkTasks", cAt));
ok("#209 the save-time overlap check takes a panel's ops from liveSubs", /liveSubs\(sub\)/.test(check) && !/sub\.subs \|\| \[\]/.test(check));
ok("#209 ...and skips a tombstoned panel", /withIds\.subs[^)]*\)\.forEach|liveSubs\(withIds\)\.forEach/.test(check) && /liveSubs\(withIds\)/.test(check));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
