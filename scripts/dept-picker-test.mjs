#!/usr/bin/env node
// #488. One `deptPicker`, four sites.
//
// `requiredDepartments` was a ~40-line inheritance-aware dropdown written TWICE
// in the wizard — once for a panel, once for a sub-op — and the ruling was to
// move it to Job Details at both levels. Copying it twice more would have made
// four near-copies of a control that already disagreed with itself, so it is
// EXTRACTED first and then used in all four places.
//
// THE SEVEN DIFFERENCES between the two originals, catalogued before extracting
// so none is silently unified away (LESSONS #18 — a partial extraction is a
// defect already written):
//   1. node/parent            panel,null  vs  sub,panel        -> parameters
//   2. the update call        updatePanel vs  updateSub        -> onChange
//   3. the flash-key prefix   "panel-"    vs  "sub-"           -> DELETED. Node
//      ids are unique across the tree, so it could never disambiguate anything;
//      a mutant removing it survived, and the honest fix was to drop it rather
//      than assert a difference that does no work.
//   4. availCheckPassed       NOT reset   vs  reset            -> the CALLER's
//      job, because it is wizard state that Job Details has no equivalent of
//   5. the label's wording    two sources vs  three            -> the op form
//      covers both: a panel can only inherit from the job, so "own ? X : X ·
//      from job" is exactly what the panel version already rendered
//   6. the panel picker was gated on `!hasSubs`                -> kept in the
//      wizard, NOT carried to Job Details, where every panel gets one
//   7. the border colour read `panel.requiredDepartment` / `sub.…`  -> node
//
//   node scripts/dept-picker-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const AT = SRC.indexOf("const deptPicker = ");
if (AT < 0) { console.error("deptPicker was not found — the suite cannot test what it cannot locate"); process.exit(2); }
// To the next component-scope `const`, which is `jdDeptSave`.
const BODY = SRC.slice(AT, SRC.indexOf("\n  const jdDeptSave", AT));

console.log("\n1. THERE IS ONE PICKER");
{
  ok("deptPicker is defined once", (SRC.match(/const deptPicker = /g) || []).length, 1);
  ok("...taking the node, its parent, the job, a change handler and a flash prefix",
    /const deptPicker = \(node, parent, job, onChange\) =>/.test(SRC), true);
  // The definition reads `const deptPicker = (`, which this pattern does not
  // match, so four means four CALL SITES.
  ok("...and it is called exactly four times", (SRC.match(/deptPicker\(/g) || []).length, 4);
}

console.log("\n2. THE OLD COPIES ARE GONE");
{
  // Each original is identified by something only it contained.
  ok("the wizard's panel copy is gone", /resolveDepartments\(panel, null, ed\)/.test(SRC), false);
  ok("the wizard's op copy is gone", /resolveDepartments\(sub, panel, ed\)/.test(SRC), false);
  // SCOPED TO THE PICKER'S OWN KEY. `deptDropId` is also used by the Edit Job
  // page as a generic dropdown key (`deptDropId === "editJobPM"`), so a bare
  // count over the file would be measuring an unrelated control.
  ok("only the shared picker opens on a NODE id",
    (SRC.match(/deptDropId === node\.id/g) || []).length, 1);
  ok("...and no copy opens on a panel or sub id any more",
    /deptDropId\s*===\s*(panel|sub)\.id/.test(SRC), false);
  ok("the add-department row exists once", (SRC.match(/Create new Department/g) || []).length, 1);
  // Both also appear inside the separate MultiDrop-based picker, which is a
  // different control and not in scope here — so these are counted INSIDE the
  // extracted picker rather than across the file.
  ok("the clear row is rendered once by the picker", (BODY.match(/<DeptClearRow /g) || []).length, 1);
  ok("the inherit note is rendered once by the picker", (BODY.match(/<DeptInheritNote /g) || []).length, 1);
}

console.log("\n3. IT IS A COMPLETE EXTRACTION — the rule went with it");
{
  ok("the picker resolves inheritance itself", /resolveDepartments\(node, parent, job\)/.test(BODY), true);
  ok("...for the clear row's parent too", /resolveDepartments\(null, parent, job\)/.test(BODY), true);
  ok("...and toggles through the shared helper", /toggleDept\(node, role, parent, job\)/.test(BODY), true);
  ok("it owns the open/closed state", /const open = deptDropId === node\.id;/.test(BODY), true);
  ok("it owns the add-a-department input", /setOrgSettings\(s=>\(\{\.\.\.s,roles:\[\.\.\.s\.roles,v\]\}\)\)/.test(BODY), true);
  ok("it owns the selection flash", /setDropFlashKey\(/.test(BODY), true);
  // The key carries the NODE. Only one dropdown is open at a time, but a 150ms
  // flash can outlive a switch to another node, and a key without it would flash
  // the same row there.
  ok("...keyed by the node and the role", /const fk = `dept-\$\{node\.id\}-\$\{role\}`;/.test(BODY), true);
  ok("the label names the source it inherited from", /from \$\{r\.from==="job"\?"job":"operation"\}/.test(BODY), true);
  // Difference 4: the caller decides, so the picker must NOT reach for wizard state.
  ok("it does NOT touch the wizard's availability flag", /setAvailCheckPassed/.test(BODY), false);
}

console.log("\n4. THE FOUR SITES, EACH PINNED");
{
  // A count of four would be green with the wrong four (R4).
  ok("wizard panel", /deptPicker\(panel, null, ed, p => updatePanel\(p\)\)/.test(SRC), true);
  ok("wizard op — and it keeps resetting the availability flag",
    /deptPicker\(sub, panel, ed, p => \{ setAvailCheckPassed\(false\); updateSub\(p\); \}\)/.test(SRC), true);
  ok("Job Details panel", /deptPicker\(panel, null, job, p => jdDeptSave\(panel, p, job\.id\)\)/.test(SRC), true);
  ok("Job Details op", /deptPicker\(op, panel, job, p => jdDeptSave\(op, p, panel\.id\)\)/.test(SRC), true);
}

console.log("\n5. JOB DETAILS WRITES IT THE WAY EVERY OTHER CELL DOES");
{
  ok("a jdDeptSave helper exists", /const jdDeptSave = \(node, patch, parentId\) =>/.test(SRC), true);
  // toggleDept returns BOTH keys; writing one and not the other is how the two
  // surfaces disagreed in #426, so both have to land.
  ok("...and it writes BOTH keys the toggle returns",
    /commitCellEdit\(node\.id, "requiredDepartments", patch\.requiredDepartments, parentId\)[\s\S]{0,160}commitCellEdit\(node\.id, "requiredDepartment", patch\.requiredDepartment, parentId\)/.test(SRC), true);
  ok("the table has a Dept column header",
    /"Sub-job", "Name", "Assignee", "Status", "Start", "End", "Est\. h", "Actual h", "Dept"/.test(SRC), true);
}

console.log("\n6. THE WIZARD KEEPS ITS OWN GATE, AND JOB DETAILS DOES NOT INHERIT IT");
{
  // Difference 6. In the wizard a panel with sub-ops shows no picker; on Job
  // Details every panel gets one, because 3 live panels carry a department and
  // some of them have ops.
  ok("the wizard still gates its panel picker on !hasSubs", /\{!hasSubs && deptPicker\(panel, null, ed,/.test(SRC), true);
  ok("Job Details does not", /panelHasOps \? null : deptPicker\(panel/.test(SRC), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
