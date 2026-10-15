// Edit entry points that must ask for the permission before they open — #161.
//
// #161: clicking a job in the TRAQS Cloud tray (jobs parked by Schedule Later) opened the
// scheduling wizard for anyone. The save was refused by /tasks and rolled back, so nothing was
// written — but a worker could open the wizard, schedule a job, and watch it vanish behind an
// error. Same class as #160, and the same answer: without editJobs the click goes where a bar
// click goes, openJobDetailOrEdit (Job Details on Business; nothing on Basic, which has no
// details page).
//
// Scoped (R4): each check reads ONLY the click handler of the element it is about, with
// comments stripped, and asks that the gate comes BEFORE the wizard opens — a gate after it
// would be no gate.
//
//   node scripts/edit-gates-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

// The tray's job list: from the parked-jobs filter to the end of the item's click handler.
const listAt = S.indexOf("const laterJobs = tasks.filter(t => t.scheduledLater);");
ok("#161 the tray's parked-job list is found exactly once", listAt > 0 && S.indexOf("const laterJobs = tasks.filter(t => t.scheduledLater);", listAt + 1) < 0);
const clickAt = S.indexOf("onClick={() => {", listAt);
const click = S.slice(clickAt, S.indexOf("onMouseEnter=", clickAt)).replace(/^\s*\/\/.*$/gm, "");
const gateAt = click.search(/if \(!can\("editJobs"\)\)/);
const wizardAt = click.search(/setModal\(\{\s*type:\s*"edit"/);
ok("#161 the tray click opens the wizard", wizardAt > 0);
ok("#161 ...only after asking for editJobs", gateAt >= 0 && gateAt < wizardAt);
ok("#161 without it, the click goes where a bar click goes", /openJobDetailOrEdit\(job\)/.test(click.slice(gateAt, wizardAt)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
