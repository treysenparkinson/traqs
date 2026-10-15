// One panel, one name — #420, ruled 2026-10-15 ("rename all three to one name. You pick it;
// bcModalState is the one nobody would guess").
//
// The queue of jobs parked by the wizard's "Schedule Later..." button was `bcModalState` in state,
// "TRAQS Cloud" in its header and tooltips, and "Pending Scheduling" in its content. It is now
// "Scheduled Later" everywhere: what the jobs in it are, named after the button that puts them
// there and the `scheduledLater` flag they carry. Not "Pending Scheduling", which sits one letter
// from the unrelated floating "Pending Schedule" tray.
//
//   node scripts/panel-name-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const RAW = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
ok("#420 the old state name is gone", !/bcModalState|setBcModalState/.test(RAW));
ok("#420 \"TRAQS Cloud\" is gone", !/TRAQS Cloud/.test(RAW));
ok("#420 \"Pending Scheduling\" is gone", !/Pending Scheduling/i.test(RAW));
ok("#420 the state is scheduledLaterPanel", /const \[scheduledLaterPanel, setScheduledLaterPanel\] = useState\("closed"\)/.test(RAW));
const tips = [...RAW.matchAll(/<Tip label="([^"]*)">\s*<button[^>]*onClick=\{\(\) => setScheduledLaterPanel\("open"\)\}/g)].map(m => m[1]);
ok(`#420 both toolbar buttons name it (${tips.length})`, tips.length === 2 && tips.every(t => /^Scheduled Later/.test(t)));
ok("#420 its header names it", />Scheduled Later<\/span>/.test(RAW));
ok("#420 its content heading names it", /Scheduled Later — \{laterJobs\.length\}/.test(RAW));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
