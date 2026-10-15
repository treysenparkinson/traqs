// Right-click Delete on a schedule bar deletes THAT item, not its job — #167, ruled 2026-10-15
// ("right-click Delete on a bar should delete the OP, not the job. Deleting a job from a schedule
// bar is not what anyone means by that gesture. If the job genuinely needs deleting, that's the
// Jobs page").
//
// The context menu's Delete had a branch for the schedule (`ctxMenu.source === "team"`) that
// walked from the bar up to its parent JOB and deleted that — one op's right-click took the whole
// job, every panel and op under it. The branch is gone: the bar's own item is deleted, with its
// parent id, exactly as every other surface's Delete does.
//
// Scoped to the menu's Delete, comments stripped (R4).
//
//   node scripts/bar-delete-target-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = S.indexOf("const deleteTarget = { id: it.id, title: it.title, pid: null };");
const del = S.slice(at, S.indexOf("setConfirmDelete(deleteTarget);", at) + 40);
ok("the context menu's Delete is found", at > 0);
ok("#167 nothing climbs from the bar to its job", !/parentJob/.test(del) && !/ctxMenu\.source === "team"/.test(del));
ok("#167 the item itself is the target, with its parent id", /deleteTarget\.pid = it\.isSub \? it\.pid : null;/.test(del));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
