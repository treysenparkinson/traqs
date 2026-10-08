#!/usr/bin/env node
// #495. THE JOB DETAILS EDIT BUTTON IS RETIRED, AND THE THREE THINGS IT ALONE
// REACHED MOVE OR GO.
//
// Walked from what RENDERS, not from the source's structure — which is how this
// took four turns to get right (#496). The modal it opens is `editJobModal`, a
// SINGLE PAGE, and against the General card it had exactly three things:
//
//   Load Template     -> moves to Job Details, beside "+ Add sub-job"
//   the colour swatch -> moves, panel level only, same jobBarMode gate
//   drag-to-reorder   -> DELETED, same ruling and evidence as #487
//
// Everything else on it — the seven job fields, add/rename/delete, departments,
// assignment, hours — Job Details already does, and the General card carries
// Status, Priority, Start, End and Est. hours/day besides.
//
//   node scripts/edit-button-retired-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(SRC);
const at = SRC.indexOf('if (modal.type === "detail") {');
const JD = at < 0 ? "" : SRC.slice(at, SRC.indexOf("\n    if (modal.type ===", at + 10));
if (!JD) { console.error("the Job Details page was not found"); process.exit(2); }

console.log("\n1. LOAD TEMPLATE IS ON JOB DETAILS");
{
  ok("the page renders a TemplateDrop", /<TemplateDrop templates=\{templates\}/.test(JD), true);
  ok("...wired to a loader that writes through the saved tree",
    /onLoad=\{jdLoadTemplate\}/.test(JD), true);
  ok("a jdLoadTemplate exists", /const jdLoadTemplate = \(tpl\) =>/.test(CODE), true);
  // It must go through nodesFromTemplate, or it reintroduces #467's bug: fresh
  // ids with deps still pointing at the template's own op ids.
  ok("...and it mints ids and remaps deps through the shared helper",
    /nodesFromTemplate\(tpl\.ops, \{ uid, nextIndex: \(_jt\.subs \|\| \[\]\)\.length \}\)/.test(CODE), true);
  ok("...appending to the job's panels, not replacing them",
    /subs: \[\.\.\.\(_jt\.subs \|\| \[\]\), \.\.\._r\.ops\]/.test(CODE), true);
  ok("...and saving, because Job Details edits a SAVED job not a draft",
    /doSaveRef\.current\(\)/.test(CODE.slice(CODE.indexOf("const jdLoadTemplate"), CODE.indexOf("const jdLoadTemplate") + 700)), true);
  ok("the delete-a-template path still works from here",
    /onDeleteRequest=\{tpl => setTemplateDeleteConfirm\(tpl\)\}/.test(JD), true);
  // The modal it came off was behind `can("editJobs")` on the button that opened
  // it; on a page anyone with the link can reach, the gate has to be on the
  // action itself. A mutant removing it survived until this was added.
  ok("...and loading one needs editJobs",
    /const jdLoadTemplate = \(tpl\) => \{\s*if \(!can\("editJobs"\)\) return denied\(PERM_VERB\.editJobs\);/.test(CODE), true);
}

console.log("\n2. THE COLOUR SWATCH IS ON JOB DETAILS, PANEL LEVEL ONLY");
{
  ok("a panel row renders a colour swatch", /jdColorSwatch\(panel\)/.test(JD), true);
  ok("...and an OP row does not — it was panel-only before and stays so",
    /jdColorSwatch\(op\)/.test(JD), false);
  ok("the swatch is gated on jobBarMode === \"system\", as it was",
    /if \(jobBarMode !== "system"\) return/.test(CODE.slice(CODE.indexOf("const jdColorSwatch"), CODE.indexOf("const jdColorSwatch") + 900)), true);
  ok("it offers the palette and the free picker, as it did",
    /HexColorPicker color=\{_pc\}/.test(CODE) && /COLORS\.map\(c =>/.test(CODE), true);
  ok("...and reset-to-the-job's-colour",
    /jdColorSave\(panel, job\.color\)/.test(CODE), true);
  ok("it writes through commitCellEdit like every other cell on the page",
    /const jdColorSave = \(node, c\) => commitCellEdit\(node\.id, "color", c, job\.id\);/.test(CODE), true);
}

console.log("\n3. DRAG-TO-REORDER IS GONE FROM THE EDIT MODAL TOO");
{
  // #487 deleted the wizard's and left this one — a ruling applied only to the
  // surface the finding was made on (#497).
  ok("no editDrag state survives", /editDrag/.test(CODE), false);
  ok("no panel row is draggable in the edit modal", /setEditDrag\(\{ kind: "panel"/.test(CODE), false);
  ok("...nor an op row", /setEditDrag\(\{ kind: "op"/.test(CODE), false);
  // Scoped to the wizard's own step 2 — the glyph exists elsewhere (the Jobs
  // list row handle), so a bare search over the file would never go false.
  ok("and the wizard's is still gone, from #487",
    /⠿/.test(CODE.slice(CODE.indexOf('key="step2"'), CODE.indexOf('key="step3"'))), false);
  // The schedule's own row drag is a different feature and must survive.
  ok("the schedule's row drag is untouched", /startRowDrag\(e, p\.id\)/.test(CODE), true);
}

console.log("\n4. THE EDIT BUTTON IS GONE — BUT THE MODAL IS NOT, AND CANNOT BE");
{
  ok("Job Details has no Edit button", /openEditStacked\(|openEdit\(/.test(JD), false);
  // `openEditStacked` existed only for this button, so it goes.
  ok("openEditStacked is gone with its only caller", /const openEditStacked = /.test(CODE), false);
  // THE MODAL SURVIVES, AND THIS IS ASSERTED RATHER THAN ASSUMED. The first
  // version of this suite demanded `editJobModal`, `openEdit` and
  // `_loadEditDraft` be deleted — which would have broken FOUR live surfaces.
  // Retiring one button does not retire a modal with five entry points (#495).
  ok("openEdit survives, because four other surfaces call it", /const openEdit = /.test(CODE), true);
  // THREE, not four: the context menu's round pencil went too, on Trey's
  // instruction mid-build — it opened the same modal the retired button did.
  // The Jobs "cards" sub-view, the Clients page and the mobile job view remain.
  // (The fourth match is a comment naming the function, which codeOf strips.)
  ok("...and there are exactly three callers left", (CODE.match(/openEdit\(/g) || []).length, 3);
  ok("the context menu has no Edit pencil",
    /<Tip label="Edit"><button onClick=\{\(\) => \{ setCtxMenu\(null\); openEdit/.test(CODE), false);
  ok("the modal itself survives", /const \[editJobModal, setEditJobModal\]/.test(CODE), true);
  ok("...and its draft loader", /_loadEditDraft/.test(CODE), true);
}

console.log("\n5. WHAT MUST NOT HAVE MOVED");
{
  // The three-step wizard is a DIFFERENT modal and is the New Job and Reschedule
  // flow. Retiring the Edit button must not touch it.
  ok("the New Job wizard survives", /\{modalStep === 1 && <div key="step1"/.test(CODE), true);
  ok("...with all three steps", [/key="step1"/, /key="step2"/, /key="step3"/].every(r => r.test(CODE)), true);
  ok("...and openNew still opens it", /const openNew = \(pid = null\) =>/.test(CODE), true);
  ok("the context menu's Reschedule still opens it",
    /setModal\(\{ type: "edit", data: \{ \.\.\.job \}, parentId: null \}\)/.test(CODE), true);
  // THREE, not two: the wizard's, Job Details' new one, and the edit modal's —
  // which stays, because the modal stays. The first version of this assertion
  // assumed retiring the button retired the modal; it has three other openers.
  ok("the wizard and the edit modal both keep their template control",
    (CODE.match(/<TemplateDrop templates=\{templates\}/g) || []).length, 3);
  // Job Details keeps everything it had.
  for (const k of ["jdAddPhase", "jdAddOp", "deptPicker", "jdCell", "whoCell", "statusChip"])
    ok(`Job Details still has ${k}`, new RegExp(`${k}\\(`).test(JD), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
