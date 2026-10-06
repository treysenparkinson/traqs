// A control must describe what it does, and a control that does nothing must go.
//
// #405 and #419 are the same cause with opposite symptoms, and RULE R3 is the rule
// they produced: WHEN A REWRITE REMOVES OR RELOCATES BEHAVIOUR, THE CONTROL THAT
// INVOKED IT IS PART OF THE DIFF.
//
//   #405  `bae5483` took an UNLABELLED cloud button and wrapped it in a <Tip>
//         reading "FAST TRAQS — import or update jobs from a file". That button
//         opens TRAQS Cloud, a queue of jobs parked for later scheduling. The
//         label was written from an assumption about the button's purpose rather
//         than from reading its handler. FAST TRAQS itself is fully built and
//         lives on the app rail.
//
//   #419  `04957e1` ("move settings into the sidebar") replaced the mobile
//         settings body with one list and left the General/Organization tab strip
//         standing. `settingsTab` had three body reads before it and none after.
//
// A DEAD CONTROL DISAPPOINTS ONCE. A MISLABELLED ONE SENDS SOMEONE LOOKING FOR
// FILE IMPORT INSIDE A SCHEDULING QUEUE — which is why #405 is the worse half,
// and why the ratchet below pairs every FAST TRAQS label with its handler rather
// than just checking the string is gone.
//
//   node scripts/stranded-control-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
// Newlines normalised before any multi-line match. SCHEDULE_MAP.md is CRLF on
// disk, so `indexOf("---\n---")` found nothing there — caught by `eol-safety-test`,
// which exists for exactly this and is the reason it runs early in the build.
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SRC = read("../src/TRAQS.jsx");
const CODE = codeOf(SRC);

console.log("\n1. #405 — every FAST TRAQS label opens FAST TRAQS");
{
  // THE RATCHET, and it is a pairing rather than a string ban. Banning the phrase
  // would pass the moment someone writes a DIFFERENT wrong label; this fails
  // whenever a control promising FAST TRAQS does not reach the importer.
  const tips = [...CODE.matchAll(/<Tip label="([^"]*FAST TRAQS[^"]*)">([\s\S]{0,400}?)<\/Tip>/g)];
  const strays = tips
    .filter(([, , body]) => !/setUploadModal\(true\)|setFastTraqsPhase\(/.test(body))
    .map(([, label]) => label);
  ok("RED: no FAST TRAQS label wraps a handler that opens something else", strays, []);
  // ...and the inverse: the phrase must not have simply been deleted everywhere.
  ok("the real FAST TRAQS entry point still carries its name",
    /FAST TRAQS/.test(CODE), true);
  ok("...and still opens the importer",
    /setFastTraqsPhase\("intro"\); setFastTraqsExiting\(false\); setUploadModal\(true\);/.test(CODE), true);
  // The importer itself is untouched — this entry was never about building one.
  ok("the three-phase importer is intact",
    ["intro", "input", "preview"].every(p => CODE.includes(`fastTraqsPhase === "${p}"`)), true);
}

console.log("\n2. #405 — the cloud buttons say what they open");
{
  const cloudTips = [...CODE.matchAll(/<Tip label="([^"]*)">\s*(?:<button[^>]*onClick=\{\(\) => setBcModalState\("open"\)\})/g)].map(m => m[1]);
  ok("both toolbar buttons were found", cloudTips.length, 2);
  ok("...and neither promises a file import", cloudTips.filter(l => /import|file/i.test(l)), []);
  ok("...and both name the panel they open", cloudTips.every(l => /TRAQS Cloud/.test(l)), true);
  // The panel is a real feature and must stay reachable. SCOPED TO ITS OWN BLOCK:
  // `setModalStep(2)` appears elsewhere, so an unscoped check stayed green with
  // this row's call deleted — that mutant survived the first run.
  const cloudAt = CODE.indexOf("const laterJobs = tasks.filter(t => t.scheduledLater);");
  ok("TRAQS Cloud still lists the jobs parked for later", cloudAt > 0, true);
  const cloud = cloudAt > 0 ? CODE.slice(cloudAt, cloudAt + 2500) : "";
  ok("...and a row inside it still opens the scheduling wizard",
    /setModalStep\(2\)[\s\S]{0,400}setModal\(\{ type: "edit"/.test(cloud), true);
}

console.log("\n3. #419 — the tabs that did nothing are gone");
{
  ok("RED: settingsTab is gone entirely", /settingsTab/.test(CODE), false);
  ok("...and so is the General / Organization strip",
    /\{ id: "main", label: "General" \}/.test(CODE), false);
  // What the strip sat above must still render. The body branches on prefOpen and
  // always did — that is why the tabs were decorative.
  ok("the mobile settings body still branches on prefOpen", /\{prefOpen \? <>/.test(CODE), true);
  ok("...and the modal still has its header", /\{prefOpen \? "Preferences" : "Settings"\}/.test(CODE), true);
  // A REMOVAL MUST NOT TAKE A NEIGHBOUR WITH IT. These sit inside the block the
  // strip was cut from, and are what a sloppy cut would swallow. SCOPED TO THAT
  // MODAL: `setOrgSettingsOpen(true)` also appears in the org-settings modal
  // itself, so an unscoped check stayed green with the mobile entry deleted.
  const modalAt = CODE.indexOf('{prefOpen ? "Preferences" : "Settings"}');
  ok("the mobile settings modal was found", modalAt > 0, true);
  const modal = modalAt > 0 ? CODE.slice(modalAt, modalAt + 9000) : "";
  ok("the org settings entry survives in it", /setOrgSettingsOpen\(true\)/.test(modal), true);
  ok("the sign-off entry survives", /setSignOffSettingsOpen\(true\)/.test(modal), true);
  ok("the roles entry survives", /setRolesSettingsOpen\(true\)/.test(modal), true);
}

console.log("\n4. THE RULE IS WRITTEN DOWN (R3)");
{
  const MAP = read("../SCHEDULE_MAP.md");
  // Matched as a HEADING, the form R1 and R2 use. A bare /^R3\./ missed it and the
  // next assertion then passed off `indexOf("R3.")` finding the same heading by
  // accident — two assertions, one of them green for the wrong reason.
  const at = MAP.indexOf("### R3. ");
  ok("R3 exists in the RULES section as a heading", at > 0, true);
  ok("...and it sits in the RULES block, above the defect list",
    at > 0 && at < MAP.indexOf("## DEFECT LIST"), true);
  const body = at > 0 ? MAP.slice(at, MAP.indexOf("---\n---", at)) : "";
  ok("...and names all three instances", ["#49", "#405", "#419"].filter(n => !body.includes(n)), []);
  ok("...and states the rule itself",
    /the control that invoked it is part\s*\n?of the diff/i.test(body), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
