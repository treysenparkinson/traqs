#!/usr/bin/env node
// #479. Start, End and Est. h become editable in the Job Details table, at panel
// and op level — through the SAME `commitCellEdit` the General card already uses,
// so start/end get the refusal chain, the unscheduled-date hold and the moveLog
// for free (#398 routes them to `commitDates`).
//
// THE PART THAT IS NOT UNIFORM, and the reason this is not six identical cells:
// HALF OF THESE VALUES ARE DERIVED, and an editable cell whose value is computed
// is a defect — you type, and the next roll-up puts it back.
//
//   op.start / op.end       the node's own. EDITABLE.
//   op Est. h               `_opHoursPair(op).est` IS `op.hpd`. EDITABLE.
//   panel.start / .end      `rollUpJobDates` recomputes them from the panel's
//                           DATED ops. Editable only when it has none.
//   panel Est. h            `_panelHoursPair` SUMS the ops when there are any.
//                           Editable only when the panel has no ops at all.
//
// So each panel cell asks whether the panel owns its own value before offering an
// editor, and renders the roll-up as text when it does not.
//
//   node scripts/jd-inline-cells-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

// Cut the Job Details table by its own landmarks, not a character width.
const start = SRC.indexOf('const td = { padding: "9px 10px"');
const end = SRC.indexOf("jdAddPhase(job.id)", start);
if (start < 0 || end < 0) { console.error("the Job Details table was not found — has it been renamed?"); process.exit(2); }
const TBL = SRC.slice(start, end);
console.log(`\nJob Details table block: ${TBL.split("\n").length} lines`);

console.log("\n1. THE BLOCK IS THE RIGHT ONE");
{
  ok("it holds the column headers", /"Sub-job", "Name", "Assignee", "Status", "Start", "End", "Est\. h", "Actual h"/.test(TBL), true);
  ok("it holds the assignee cell", /const whoCell = \(ids, onPick\)/.test(TBL), true);
  ok("it holds the row menu", /const rowMenu = \(node, parentId, kind, count\)/.test(TBL), true);
  ok("it holds both row levels", [/statusChip\(panel, job\.id\)/.test(TBL), /statusChip\(op, panel\.id\)/.test(TBL)], [true, true]);
}

console.log("\n2. ONE CELL HELPER, NOT SIX HAND-WRITTEN CELLS");
{
  ok("a jdCell helper exists", /const jdCell = \(node, key, kind, parentId, own\)/.test(TBL), true);
  // PINNED PER BRANCH. There are TWO commitCellEdit calls in this helper — the
  // date one and the number one — and a single regex matched whichever came
  // first, so a mutant that dropped `parentId` from the date branch survived.
  // The same R4 shape as #476's threshold: one match standing in for two sites.
  ok("the NUMBER branch passes the node's own id and its parent",
    /if \(String\(next \?\? ""\) !== String\(raw \?\? ""\)\) commitCellEdit\(node\.id, key, next, parentId\);/.test(TBL), true);
  ok("the DATE branch passes the node's own id and its parent",
    /onChange=\{v => commitCellEdit\(node\.id, key, v \|\| null, parentId\)\}/.test(TBL), true);
  ok("...neither passes the job's id, which is what the General card passes",
    /commitCellEdit\(job\.id, key/.test(TBL), false);
  ok("a date cell uses the same DateField the General card uses", /kind === "date"[\s\S]{0,200}DateField/.test(TBL), true);
  ok("a number cell commits on blur, like jdField", /onBlur=\{commit\}/.test(TBL), true);
  // An unchanged value must not write: every blur would otherwise be a save, and
  // for start/end that means a moveLog entry recording a move that never happened.
  ok("an unchanged value does not write", /if \(String\(next \?\? ""\) !== String\(raw \?\? ""\)\)/.test(TBL), true);
  ok("a negative estimate is clamped to zero", /Math\.max\(0, Number\(v\) \|\| 0\)/.test(TBL), true);
  ok("...and an emptied cell clears rather than writing 0", /v\.trim\(\) === "" \? null :/.test(TBL), true);
  ok("it refuses to render an editor without editJobs", /own && canEdit/.test(TBL), true);
}

console.log("\n3. THE SIX CELLS ARE WIRED, EACH BY NAME");
{
  // Pinned per cell. A count of jdCell calls would be green with the wrong six.
  for (const [what, re] of [
    ["op start", /jdCell\(op, "start", "date", panel\.id, true\)/],
    ["op end", /jdCell\(op, "end", "date", panel\.id, true\)/],
    ["op est", /jdCell\(op, "hpd", "number", panel\.id, true\)/],
    // The panel cells branch on ownership OUTSIDE jdCell and pass `true`, so the
    // helper's read-only path is not a branch only panels can reach. The ternary
    // is what keeps a DERIVED value rendering in the panel row's own styling
    // rather than the dimmer op styling jdCell would give it.
    ["panel start", /panelOwnsDates\s*\?\s*jdCell\(panel, "start", "date", job\.id, true\)/],
    ["panel end", /panelOwnsDates\s*\?\s*jdCell\(panel, "end", "date", job\.id, true\)/],
    ["panel est", /panelOwnsHours\s*\?\s*jdCell\(panel, "hpd", "number", job\.id, true\)/],
  ]) ok(`${what} is an inline cell`, re.test(TBL), true);
  ok("exactly six cells", (TBL.match(/jdCell\(/g) || []).length, 6);
}

console.log("\n4. A DERIVED VALUE IS NEVER OFFERED AS AN EDITOR");
{
  ok("panel date ownership is computed from its DATED ops",
    /const panelOwnsDates = !\(panel\.subs \|\| \[\]\)\.some\(o => o && !o\.deletedAt && isDated\(o\)\);/.test(TBL), true);
  ok("...matching rollUpJobDates' own condition", /isDated\(o\)/.test(SRC.slice(SRC.indexOf("const rollUpJobDates"), SRC.indexOf("const rollUpJobDates") + 700)), true);
  ok("panel hours ownership is computed from whether it has ops at all",
    /const panelOwnsHours = !\(panel\.subs \|\| \[\]\)\.length;/.test(TBL), true);
  ok("...matching _panelHoursPair's own condition",
    /if \(!ops\.length\) return _opHoursPair\(panel\);/.test(SRC), true);
  // The roll-up must still SHOW when it is not editable, or the page loses a number.
  ok("a non-owning panel still renders its rolled-up hours", /ph\.est \? fmtH\(ph\.est\) : "—"/.test(TBL), true);
  ok("a non-owning panel still renders its rolled-up dates", /panel\.start \? fm\(panel\.start\) : "—"/.test(TBL), true);
}

console.log("\n5. START AND END STILL REACH THE REFUSAL CHAIN");
{
  // The whole point of routing through commitCellEdit rather than updTask.
  const CCE = SRC.slice(SRC.indexOf("const commitCellEdit ="), SRC.indexOf("const signOffQueueByTemplate"));
  ok("commitCellEdit routes start/end to commitDates", /if \(node\) return commitDates\(node, \{ \[key\]: val \}\);/.test(CCE), true);
  ok("...behind the moveJobs permission", /key === "start" \|\| key === "end" \? "moveJobs"/.test(CCE), true);
  ok("...and holds the date on an unscheduled task", /holdsDateEdit\(node, key\)/.test(CCE), true);
  // hpd deliberately does NOT take that path — #480, logged rather than changed.
  ok("hpd still falls through to updTask", /updTask\(id, patch, pid \|\| null\);/.test(CCE), true);
  ok("...and is NOT named as a schedule field", /key === "hpd" \? "moveJobs"/.test(CCE), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
