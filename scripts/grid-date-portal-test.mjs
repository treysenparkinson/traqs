// #450 — the Jobs grid's date cells opened a calendar nobody could see.
//
// Clicking START, END or DUE on a grid row mounts `TraqsDatePicker` with
// `autoOpen` inside the cell. Grid rows clip their content (`overflow: hidden`),
// and the picker rendered its calendar in place, under the trigger — so the row
// clipped it. Measured in the sandbox (real app, headless Chrome, 2026-10-07):
// the calendar was in the DOM and `elementFromPoint` at its month header
// returned the next row's text ("Oct 23", then the "Not Started" group header).
// The cell read "Select date", a click on it toggled the invisible calendar
// shut, and nothing was ever written. That is Trey's "blank, unclickable
// field", and it is why a task's dates could not be set from the grid at all.
//
// THE FIX IS THE PICKER'S OWN `portal` MODE, which already exists for exactly
// this (Settings' holiday picker and Edit Job's due date use it): the calendar
// goes to document.body as `position: fixed`, anchored to the trigger, so no
// ancestor's overflow can clip it. Its outside-click handler already treats
// the portalled calendar as inside.
//
// Measured after the fix, same sandbox: the calendar is VISIBLE (elementFromPoint
// lands inside it), START and END each save, and with an assignee the task draws
// on the schedule.
//
// What this file can and cannot prove: it proves the three grid cells ask for
// the portal and that portal mode is what it claims. It cannot prove the calendar
// is visible — jsdom has no layout. That was measured in the browser.
//
// AN EARLIER VERSION OF THIS FIX WAS ON THE WRONG COMPONENT. #450 was first
// logged against the custom-column `DateField` (the `startEdit(e, item.id, key)`
// cell). The sandbox showed the fix there changed nothing: START/END/DUE are a
// different component. The cells are anchored below by the field each commits.
//
//   node scripts/grid-date-portal-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

const SRC = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// R4: each cell is anchored by the one commit it makes. Exactly one picker tag
// may carry each anchor; anything else is a broken test, not a pass — exit 2.
const pickerFor = (commit) => {
  const tags = (SRC.match(/<TraqsDatePicker\b[\s\S]*?\/>/g) || []).filter(t => t.includes(commit));
  if (tags.length !== 1) { console.error(`expected one TraqsDatePicker committing ${commit}, found ${tags.length}`); process.exit(2); }
  return tags[0];
};
const CELLS = {
  START: pickerFor('commitEdit(item.id, "start", v, pid)'),
  END: pickerFor('commitEdit(item.id, "end", v, pid)'),
  DUE: pickerFor('commitEdit(item.id, "dueDate", v || null)'),
};

console.log("\n1. THE GRID'S DATE CELLS RENDER THEIR CALENDAR OUTSIDE THE ROW");
for (const [name, tag] of Object.entries(CELLS)) {
  ok(`RED: ${name} asks for portal mode`, /\sportal\b/.test(tag), true);
  ok(`...and still opens on the click that mounted it (autoOpen)`, /\sautoOpen\b/.test(tag), true);
}

console.log("\n2. PORTAL MODE IS WHAT IT CLAIMS TO BE");
// The fix leans on the picker's portal branch; if that branch stopped existing,
// passing `portal` would be a no-op and section 1 would be green over nothing.
const at = SRC.indexOf("const TraqsDatePicker = (");
if (at < 0) { console.error("TraqsDatePicker not found"); process.exit(2); }
const comp = SRC.slice(at, SRC.indexOf("\nconst ", at + 10));
ok("TraqsDatePicker takes a `portal` prop", /^const TraqsDatePicker = \(\{[^\n]*\bportal = false\b/.test(comp), true);
ok("...and in portal mode mounts the calendar on document.body", /portal \? createPortal\(node, document\.body\) : node/.test(comp), true);
ok("...positioned fixed, so no ancestor overflow clips it", /portal \? \{ position: "fixed"/.test(comp), true);
ok("...and a click inside the portalled calendar is not 'outside'", /!popRef\.current\?\.contains\(e\.target\)/.test(comp), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
