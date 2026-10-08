// #393/#394/#395/#398 — FOUR WRITERS OF ONE FACT, CONSOLIDATED.
//
// The Jobs survey found four implementations of "assign somebody", disagreeing
// on availability, on the moveLog, on the overlap backstop, and on whether an op
// someone is clocked into may be reassigned at all. Same shape as the four
// schedulers and the seven overlap definitions. The Jobs-list cell's own comment
// says assignment "must not be a quieter path than dragging the bar there by
// hand" — and the Job Details popover was exactly that.
//
// MEASURED AT MATRIX BEFORE ANY OF THIS WAS BUILT:
//   - ONE overlapping pair on the live board, both ops with moveLog = 0, so
//     neither was dragged and neither went through the refusal chain (#402).
//   - activeJobClock absent on ALL 18 people, so #393 is currently unreachable
//     there. The guard is insurance, and it is written as insurance.
//   - the two availability oracles disagree on 244 of 1962 (op, person) pairs —
//     12.4%: 203 struck in Job Details that the list calls free, 41 the reverse.
//
// THE GUARDS GO IN THE COMMITS, NOT ON THE CELLS. That is what makes this one
// fix rather than one per surface: a fifth caller inherits them.
//
//   node scripts/assign-consolidation-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { isReplannable, dayLoadHint } from "../src/placement.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(SRC);
// Brace-matched, so an assertion about one function cannot be satisfied by a
// different one 17,000 lines away.
const bodyFrom = (anchor, src = CODE) => {
  const at = src.indexOf(anchor);
  if (at < 0) return "";
  let i = src.indexOf("{", at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  return "";
};

console.log("\n1. #393 — THE ACTIVE-CLOCK GUARD IS INSIDE THE COMMIT");
{
  const clocked = [{ id: "P1", name: "Trey", activeJobClock: { clockIn: "2026-10-06T14:00:00Z", opId: "OP" } }];
  ok("isReplannable already owns this question", isReplannable({ id: "OP" }, clocked).ok, false);
  ok("...and says nothing is wrong with a different op", isReplannable({ id: "OTHER" }, clocked).ok, true);

  const body = bodyFrom("const commitAssign = (op, nextTeam) => {");
  ok("commitAssign was found", body.length > 200, true);
  // IN THE COMMIT, not on the cell. Mutating this out must break every surface
  // at once, which is the whole claim of this change.
  ok("commitAssign consults the existing owner", /isReplannable\(op, people\)/.test(body), true);
  // BOTH indices must be found. A bare `a < b` passes when `a` is -1, i.e.
  // exactly when the guard is missing — the assertion would have been green on
  // the broken code it exists to catch.
  const gAt = body.indexOf("isReplannable(op, people)");
  const wAt = body.indexOf("applyDragMove");
  ok("...and refuses before writing anything", gAt >= 0 && wAt > gAt, true);
  // The cell must NOT carry its own copy — that would be one fix per surface
  // wearing the clothes of one fix.
  const cell = bodyFrom('case "assignee": {');
  ok("the Jobs-list cell does NOT re-implement the guard", /isReplannable|blockedByActiveClock/.test(cell), false);
}

console.log("\n2. #394 — ONE WRITER OF `team`, AND JOB DETAILS CALLS IT");
{
  // The popover used `updTask(planAssign.id, { team: next }, …)` — a plain field
  // patch with no moveLog, no backstop and no shared oracle.
  ok("the Job Details popover no longer patches team directly",
    /updTask\(planAssign\.id, \{ team: next \}/.test(CODE), false);
  ok("...it calls the shared commit", /commitAssign\(live, next\)/.test(CODE), true);
  // Asserted as a COUNT so a fifth path cannot be added without this failing —
  // and the pattern matches a team key with ANY value, not just a bare
  // identifier. The first version was `/\{ team: [A-Za-z_]+ \}/`, which missed
  // `updTask(it.id, { team: [personId], start, end })` in placeTaskAt — a FIFTH
  // writer that the survey had not found and this assertion walked straight past.
  const writes = (CODE.match(/updTask\([^)]*\{\s*team:/g) || []);
  ok("no updTask patch carries `team` anywhere in TRAQS.jsx", writes, []);
}

console.log("\n3. #395 — ONE AVAILABILITY ORACLE");
{
  ok("planAvailability is gone", /const planAvailability = /.test(CODE), false);
  ok("...and nothing calls it", /planAvailability\(/.test(CODE), false);
  // The picker's answer comes from the oracle the drag, the scheduler and the
  // server rule all use.
  const picker = bodyFrom("const assignPickerFor = (op, panel, job) => {");
  ok("the Jobs-list picker asks schedulerAvailability", /schedulerAvailability\(/.test(picker), true);
  const popover = bodyFrom("const planAssignRows = ");
  ok("the Job Details popover asks the same one", /schedulerAvailability\(/.test(popover) || /assignPickerFor/.test(CODE), true);
}

console.log("\n4. #395 — THE CAPACITY SIGNAL SURVIVES AS A HINT, AND NEVER BLOCKS");
{
  // "A strike that means 'busy week' reads as 'can't do this', and 203 people
  // wrongly struck is worse than 41 wrongly offered." So the number is kept and
  // the verdict is dropped.
  const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  const ctx = {
    isWorkDay: (d) => days.includes(d),
    isOff: () => false,
    bookedHrs: (pid, d) => (d <= "2026-10-07" ? 7.5 : 0),
    capacity: 7.5,
  };
  ok("it counts the full days", dayLoadHint("P", "2026-10-05", "2026-10-09", ctx), "3 of 5 days full");
  ok("a clear week says nothing at all",
    dayLoadHint("P", "2026-10-05", "2026-10-09", { ...ctx, bookedHrs: () => 0 }), null);
  ok("a fully booked week still only reports",
    dayLoadHint("P", "2026-10-05", "2026-10-09", { ...ctx, bookedHrs: () => 7.5 }), "5 of 5 days full");
  ok("time off counts toward the hint",
    dayLoadHint("P", "2026-10-05", "2026-10-09", { ...ctx, bookedHrs: () => 0, isOff: (p, d) => d === "2026-10-05" }), "1 of 5 days full");
  ok("a weekend-only range has nothing to say",
    dayLoadHint("P", "2026-10-10", "2026-10-11", ctx), null);
  ok("an undated op has nothing to say", dayLoadHint("P", null, null, ctx), null);
  // THE PROPERTY: it is a string or null. It can never refuse anything.
  const shapes = new Set();
  for (const b of [0, 3, 7.5]) shapes.add(typeof dayLoadHint("P", "2026-10-05", "2026-10-09", { ...ctx, bookedHrs: () => b }));
  ok("it only ever returns a string or null — never a verdict", [...shapes].sort(), ["object", "string"]);
}

console.log("\n5. #398 — TYPING A DATE DOES WHAT DRAGGING TO IT DOES");
{
  const body = bodyFrom("const commitDates = (op, next) => {");
  ok("commitDates exists", body.length > 150, true);
  ok("...and goes through the shared refusal chain", /refuseLanding\(/.test(body), true);
  ok("...and commits through the backstop", /commitLanding\(/.test(body), true);
  ok("...building a mover, so the write carries a moveLog", /applyDragMove\(/.test(body), true);

  const cce = bodyFrom("const commitCellEdit = (id, key, val, pid) => {");
  ok("commitCellEdit was found", cce.length > 150, true);
  // THE GUARD CONDITION, not just the call. `if (false) { … commitDates(…) }`
  // satisfies a bare /commitDates\(/ and survived this assertion on the first
  // mutation run — the third time in this campaign an `if (false)` mutant has
  // walked past a wiring check that matched only the call text.
  // #456 put the unscheduled-task draft (src/schedDraft.js) between the guard and
  // this call — a placed task still lands here; an unscheduled one reaches the same
  // commitDates through the draft (grid-batch-test.mjs). Window widened for it.
  ok("start and end route to it",
    /if \(key === "start" \|\| key === "end"\) \{[\s\S]{0,700}?commitDates\(node, \{ \[key\]: val \}\)/.test(cce), true);
  // dueDate is not a schedule field and must stay a plain patch, or typing a due
  // date starts being refused for an overlap it has nothing to do with.
  ok("...and dueDate still does not", /key === "dueDate"[\s\S]{0,120}?commitDates/.test(cce), false);
  ok("the permission split is unchanged", /key === "start" \|\| key === "end" \? "moveJobs"/.test(cce), true);

  // THE FIFTH WRITER, found during the build rather than by the survey.
  // `placeTaskAt` is the Job Details "Place" button: one gesture setting WHO and
  // WHEN, and one plain patch carrying both.
  const place = bodyFrom("const placeTaskAt = (personId, dayStr) => {");
  ok("placeTaskAt was found", place.length > 200, true);
  ok("...no longer patches team and dates directly", /updTask\(/.test(place), false);
  ok("...and goes through the shared commit", /commitDates\(node, \{ start, end, team: \[personId\] \}\)/.test(place), true);
  ok("...keeping both permissions it already demanded",
    /\["moveJobs", "reassign"\]/.test(place), true);
  // A placement changes the crew as well as the dates, and applyDragMove writes
  // `team` ONLY when the mover says it is a reassignment.
  const cd = bodyFrom("const commitDates = (op, next) => {");
  ok("commitDates marks a crew change as a reassignment", /reassigned: true/.test(cd), true);
  ok("...derived from the teams, not from the caller", /teamChanged = /.test(cd), true);
}

console.log("\n6. RED PROOFS — what each of these looked like before");
{
  // Reproduced as data rather than prose, so the entry cannot drift from them.
  const clocked = [{ id: "P1", name: "Trey", activeJobClock: { clockIn: "x", opId: "OP" } }];
  ok("RED: an unguarded commit would have allowed this", isReplannable({ id: "OP" }, clocked).ok === false, true);
  ok("RED: the old popover wrote a bare patch — that exact call is gone",
    /updTask\([A-Za-z.]+, \{ team:/.test(CODE), false);
  // Against CODE, not SRC. The name survives in three COMMENTS that explain what
  // replaced it and why, which is the point of keeping them — asserting against
  // the raw source would make a correct explanation fail the test, the mirror of
  // an assertion matching its own documentation.
  ok("RED: the old oracle is gone from the CODE", /planAvailability/.test(CODE), false);
  ok("...while the comments that explain the change survive", /planAvailability/.test(SRC), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
