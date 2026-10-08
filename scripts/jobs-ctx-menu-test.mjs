#!/usr/bin/env node
// #478. Three capabilities leave the JOBS LIST right-click menu and stay on the
// schedule, because the menu is ONE component shared by three sources.
//
//   handleCtx(e, item, "job-detail")  the Jobs list rows (the name is a misnomer)
//   handleCtx(e, item, "team")        the team schedule
//   handleCtx(e, item)                the gantt — the default
//
// Removed from the Jobs list only:
//   Add/Edit Dependencies  — the Edit Job wizard has a per-panel Dependencies
//                            control with the same depsMode (free/locked/unlocked)
//   Reschedule operation…  — the Reschedule wizard re-plans selected ops from a
//                            new start date, which is this and more
//   Split Job              — splitting is a schedule gesture: the Gantt drag runs
//                            dragMove.applySplit directly, and the Jobs page
//                            reflects the result
//
// SCOPED TO THE MENU BLOCK, per R4: a bare search for "Split Job" over TRAQS.jsx
// finds the modal's own title and its comments, so a presence check would pass
// however the menu item was written. Everything here is asserted inside the
// extracted context-menu JSX and nowhere else.
//
//   node scripts/jobs-ctx-menu-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

// ── Find the context-menu block and cut it out by brace depth, so the slice is
//    the menu and not a magic number of characters (a fixed width expires).
const anchor = SRC.indexOf('const isPanel = it.level === 1 ||');
if (anchor < 0) { console.error("the context menu's locals were not found — has it been renamed?"); process.exit(2); }
const endMark = SRC.indexOf("Request Completion", anchor);
if (endMark < 0) { console.error("the end of the menu block was not found"); process.exit(2); }
const MENU = SRC.slice(anchor, endMark);
console.log(`\ncontext-menu block: ${MENU.length} chars, ${MENU.split("\n").length} lines`);

console.log("\n1. THE BLOCK IS THE RIGHT ONE");
{
  // If the slice does not contain the things that must STAY, it is the wrong slice
  // and every absence assertion below would pass for the wrong reason.
  ok("it holds the View Details item", /View Details/.test(MENU), true);
  ok("it holds the Take me to schedule item", /Take me to schedule/.test(MENU), true);
  ok("it holds the job-level Reschedule/Edit item", /billingTier === "business" \? <CtxMenuItem/.test(MENU), true);
  ok("it reads ctxMenu.source, so a source gate is possible here", /ctxMenu\.source/.test(MENU), true);
}

console.log("\n2. THE JOBS LIST IS NAMED ONCE, NOT SPELLED OUT THREE TIMES");
{
  ok("a single `fromJobsList` local exists", /const fromJobsList = ctxMenu\.source === "job-detail";/.test(MENU), true);
  // Pinned per item rather than counted: a threshold over three sites is green
  // when the one under test is the broken one (R4).
  ok("...and it gates exactly the three items", (MENU.match(/!fromJobsList &&/g) || []).length, 3);
}

console.log("\n3. EACH ITEM IS GATED, BY NAME");
{
  // Each item is found by a marker that the GATE ITSELF cannot change — the setter
  // it calls — and then read BACKWARDS to the start of its JSX item. Keying on the
  // item's opening line instead would mean the assertion matches the exact text
  // being edited, which is how this check passed for the wrong reason once already.
  const opening = (marker) => {
    const at = MENU.indexOf(marker);
    if (at < 0) return null;                       // null, so a missing item FAILS
    const start = MENU.lastIndexOf("\n      {", at);
    return start < 0 ? null : MENU.slice(start, at);
  };
  const gated = (marker) => { const o = opening(marker); return o === null ? "ITEM NOT FOUND" : /!fromJobsList &&/.test(o); };
  ok("Add/Edit Dependencies is gated", gated("setDepsModal({"), true);
  ok("Reschedule operation is gated", gated("setRescheduleModal({"), true);
  ok("Split Job is gated", gated("setSplitModal({"), true);
}

console.log("\n4. NOTHING IS STRANDED — each modal still has exactly one opener");
{
  // The three modals are opened from this menu and nowhere else, so a FULL removal
  // would orphan all three. Scoping to the Jobs list keeps every opener alive. These
  // assert the opener still exists AND is still only one, so a later full removal
  // cannot quietly leave the modal behind.
  for (const [what, setter] of [["dependencies", "setDepsModal"], ["reschedule-op", "setRescheduleModal"], ["split", "setSplitModal"]]) {
    const opens = (SRC.match(new RegExp(`${setter}\\(\\{`, "g")) || []).length;
    ok(`the ${what} modal has exactly one opener`, opens, 1);
  }
  ok("the dependencies modal still renders", /Add\/Edit Dependencies/.test(SRC), true);
  ok("the reschedule-op modal still renders", /setRescheduleModal\(p => \(\{ \.\.\.p, newStart/.test(SRC), true);
  ok("the split modal still renders", /Split Job<\/div>/.test(SRC), true);
}

console.log("\n5. THE CAPABILITIES SURVIVE SOMEWHERE ELSE");
{
  // Dependencies: the Edit Job wizard's per-panel control, with the same three modes.
  ok("the wizard's Dependencies control exists", /Link sub-ope/.test(SRC), true);
  ok("...with the same depsMode vocabulary", /panel\.depsMode === "locked"/.test(SRC), true);
  // Reschedule: the wizard that re-plans selected ops from a new start date.
  ok("the Reschedule wizard exists", /const \[rescheduleSelection, setRescheduleSelection\]/.test(SRC), true);
  ok("...and selects ops, not panels", /OP ids selected to be re-planned/.test(SRC), true);
  // Split: the Gantt drag, which calls applySplit without any modal.
  ok("the Gantt drag split exists", /applySplit\(next, \{ node: bar\.task/.test(SRC), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
