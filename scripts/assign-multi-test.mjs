// The Jobs-list assign cell edits a CREW, not a single name — #396, ruled 2026-10-15 ("make the
// Jobs-list assign cell multi-select. Replacing a crew silently because the control only holds one
// name is wrong").
//
// Picking a name called commitAssign(item, [v]): a three-person crew became one person, with no
// word. Each pick now TOGGLES that person — on the crew, they come off; not on it, they go on
// (still refused at pick if they are busy) — and current members are marked in the list. Unassign
// still clears everyone. Built on the cell's existing picker rather than a second control, so the
// refusal, the draft path and the department follow (#427, via commitAssign) are unchanged.
//
// Scoped to the cell, comments stripped (R4).
//
//   node scripts/assign-multi-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = S.indexOf("const canQuickAssign = canReassign && hasDates;");
const cell = S.slice(at, S.indexOf("if (!who.length) return wrap(", at));
ok("the assign cell is found", at > 0);
ok("#396 a pick no longer replaces the crew with one name", !/commitAssign\(item, \[v\]\)/.test(cell));
ok("#396 a pick toggles that person on or off the crew", /const _onCrew = onTeam\(item\.team, v\);/.test(cell) && /_onCrew \? withoutPerson\(item\.team, v\) : withPerson\(item\.team, v\)/.test(cell));
ok("#396 ...and commits the whole crew", /commitAssign\(item, _nextTeam\)/.test(cell));
ok("#396 the busy refusal applies only to ADDING someone", /if \(!_onCrew && picked && picked\.busy\)/.test(cell));
ok("#396 current members are marked in the list", /onTeam\(item\.team, r\.id\)\s*\?/.test(cell));
ok("Unassign still clears everyone", /if \(v === "__clear"\) \{ commitAssign\(item, \[\]\); return; \}/.test(cell));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
