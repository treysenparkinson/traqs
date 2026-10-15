// Edit and delete entry points that must ask before they act — #161, #165.
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

// #165. Bulk bar delete removed tasks from jobs someone was clocked into; a single delete has
// always refused that (delTask -> blockedByActiveClock). The bulk Delete must ask the same
// question of every job its plan touches, and ask it BEFORE it deletes.
{
  const modalAt = S.indexOf("{/* Bar Delete Confirmation Modal */}");
  const delAt = S.indexOf("applyBarDelete(prev, selBars)", modalAt);
  const btnAt = S.lastIndexOf("onClick={() => {", delAt);
  const del = S.slice(btnAt, S.indexOf("}}>Delete</Btn>", delAt)).replace(/^\s*\/\/.*$/gm, "");
  const guardAt = del.search(/blockedByActiveClock\(/);
  const applyAt = del.search(/applyBarDelete\(/);
  ok("#165 the bulk Delete is found", modalAt > 0 && delAt > modalAt && applyAt > 0);
  ok("#165 ...it asks blockedByActiveClock before it deletes", guardAt >= 0 && guardAt < applyAt);
  ok("#165 ...of every job in the delete plan", /planBarDelete\(/.test(del.slice(0, guardAt)) && /\.jobs\.(some|find|filter)\(/.test(del.slice(0, applyAt)));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
