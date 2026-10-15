// A typed estimate writes a moveLog entry, as a dragged one does — #480, ruled 2026-10-15.
//
// A resize drag that changes hpd writes an entry; typing the same estimate into the Jobs list's
// hpd cell went through commitCellEdit -> updTask with no entry at all on an op or panel, and on a
// whole job it got #494's cascade entry mislabelled "Moved with its parent". commitCellEdit now
// lays a placementEntry on an hpd edit (fromHpd -> toHpd, reason "Estimate typed on the Jobs
// list"); supplying it also stops updTask adding the job-level "Moved with its parent".
//
//   node scripts/estimate-log-test.mjs

import { readFileSync } from "node:fs";
import { placementEntry } from "../src/dragMove.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

const e = placementEntry({ id: "o", start: "2026-10-05", end: "2026-10-06", hpd: 8 }, { id: "o", start: "2026-10-05", end: "2026-10-06", hpd: 12 }, { date: "2026-10-15", movedBy: "T", reason: "Estimate typed on the Jobs list" });
ok("an estimate change alone is an entry", !!e && e.fromHpd === 8 && e.toHpd === 12 && e.reason === "Estimate typed on the Jobs list");
ok("an unchanged estimate is not", placementEntry({ id: "o", hpd: 8 }, { id: "o", hpd: 8 }, { date: "d", movedBy: "T" }) === null);

const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = S.indexOf("const commitCellEdit = (id, key, val, pid) => {");
const fn = S.slice(at, S.indexOf("updTask(id, patch, pid || null);", at) + 40);
ok("commitCellEdit is found", at > 0);
ok("#480 an hpd edit builds a placementEntry", /if \(key === "hpd"\)[\s\S]{0,400}placementEntry\(/.test(fn));
ok("#480 ...with its own reason", /reason: "Estimate typed on the Jobs list"/.test(fn));
ok("#480 ...and puts it on the patch updTask writes", /patch\.moveLog = \[\.\.\.\(_node\.moveLog \|\| \[\]\), _e\]/.test(fn));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
