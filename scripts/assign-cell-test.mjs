// Quick-assign from the Jobs page: press the Unassigned cell on an OPERATION
// row and pick someone.
//
// Two rulings shape it (2026-10-05):
//   1. OPERATION ROWS ONLY. A job or phase row rolls up everyone beneath it, so
//      "assign" there would mean writing every op under it from one click. The
//      leaf is the only level where the write is exactly what was pressed.
//   2. DEPARTMENT MATCHES FIRST, THEN EVERYONE. The people who hold the op's
//      department sort to the top; the rest of the crew follow a divider.
//      Nobody is hidden — an op whose department nobody holds must still be
//      assignable, which a strict filter would have made impossible.
//
// The ORDERING lives in placement.js, not in the component, so it can be tested
// as a function rather than grepped as markup — and so it asks candidatesFor,
// the same resolver the scheduler uses, instead of inventing a fifth idea of
// who may do an op.
//
//   node scripts/assign-cell-test.mjs

import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { assignPickerOptions } from "../src/placement.js";
import { placeDropMenu } from "../src/menuPlacement.js";
import { occupyingUnits } from "../src/overlapRules.js";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(J);
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const CREW = [
  { id: "q", name: "Quincy", departments: ["Layout"] },
  { id: "d", name: "Danny", departments: ["Layout"] },
  { id: "w", name: "Draven", departments: ["Wire"] },
  { id: "t", name: "Tyler", departments: ["Wire"] },
  { id: "c", name: "Cal", departments: ["Cut"] },
];
const names = (rows) => rows.map(r => r.divider ? "──" : r.name);

// The text of one `const NAME = ...` arrow body, brace-matched. Assertions about
// a specific function must be scoped to it: a pattern checked against the whole
// file can be satisfied by any other call site that happens to look the same,
// which is how a mutation to commitAssign went undetected.
const bodyOf = (anchor) => {
  const at = CODE.indexOf(anchor);
  if (at < 0) return "";
  let d = 0, started = false;
  for (let i = at; i < CODE.length; i++) {
    const c = CODE[i];
    if (c === "{") { d++; started = true; }
    else if (c === "}") { d--; if (started && d === 0) return CODE.slice(at, i + 1); }
  }
  return CODE.slice(at);
};
const COMMIT = bodyOf("const commitAssign = (op, nextTeam) => {");
const PICKER = bodyOf("const assignPickerFor = (op, panel, job) => {");

console.log("\n1. Department matches first, then everyone, nobody hidden");
{
  const rows = assignPickerOptions({ id: "o1", requiredDepartments: ["Layout"] }, CREW);
  ok("matches lead", names(rows).slice(0, 2), ["Danny", "Quincy"]);
  ok("...a divider separates them from the rest", names(rows)[2], "──");
  ok("...and the rest follow", names(rows).slice(3), ["Cal", "Draven", "Tyler"]);
  ok("every person appears exactly once",
    rows.filter(r => !r.divider).length, CREW.length);
  ok("...so the picker can always assign somebody", rows.some(r => !r.divider), true);
  ok("matches are flagged, so the UI need not re-derive it",
    rows.filter(r => r.match).map(r => r.name), ["Danny", "Quincy"]);
}

console.log("\n2. An op nobody matches is still assignable — the reason a strict filter was refused");
{
  const rows = assignPickerOptions({ id: "o2", requiredDepartments: ["Welding"] }, CREW);
  ok("no divider, because there is nothing to divide", rows.some(r => r.divider), false);
  ok("...and the whole crew is offered", names(rows), ["Cal", "Danny", "Draven", "Quincy", "Tyler"]);
  ok("...none of them flagged as a match", rows.some(r => r.match), false);
}

console.log("\n3. An op with no department is open to anyone — one flat list");
{
  // Department absence means OPEN TO ANYONE (ruling 1, 2026-10-02). Everyone
  // matches, so a divider with nothing after it would be noise.
  const rows = assignPickerOptions({ id: "o3" }, CREW);
  ok("no divider", rows.some(r => r.divider), false);
  ok("everyone offered", names(rows).length, 5);
  ok("...and all flagged as matches, because they are", rows.every(r => r.match), true);
}

console.log("\n4. The department is carried for the row label");
{
  const rows = assignPickerOptions({ id: "o4", requiredDepartments: ["Wire"] }, CREW);
  ok("each row names the person's department", rows.find(r => r.name === "Draven").dept, "Wire");
  ok("...and somebody with none reads empty, not undefined",
    assignPickerOptions({ id: "o5" }, [{ id: "x", name: "New" }])[0].dept, "");
}

console.log("\n5. An op that already carries a team still offers everyone");
{
  // Found by mutation: no case exercised an op with a team, so the line that
  // strips it could be deleted with the suite green.
  //
  // candidatesFor puts an EXISTING TEAM ahead of the department and returns only
  // them — correct for the scheduler, which must respect a manual assignment,
  // and wrong for a picker whose entire job is to offer a change. A reassign
  // would have shown one name: the person already on it.
  const withTeam = { id: "o6", requiredDepartments: ["Layout"], team: ["w"] };
  const rows = assignPickerOptions(withTeam, CREW);
  ok("the whole crew is still offered", rows.filter(r => !r.divider).length, CREW.length);
  ok("...and the flags follow the DEPARTMENT, not the existing team",
    rows.filter(r => r.match).map(r => r.name), ["Danny", "Quincy"]);
  ok("...so the person already on it is not the only choice",
    rows.filter(r => !r.divider).map(r => r.name).includes("Draven"), true);
}

console.log("\n6. The cell: OPERATION rows only");
{
  // Both halves of the gate asserted together. Checking only that
  // `canQuickAssign` exists let the permission be deleted from it with the suite
  // still green — found by mutation.
  // Three conditions, each named, so a mutation that drops any one of them is
  // caught rather than hidden behind a single compound expression.
  ok("...the row must be a leaf operation", /const _leaf = !\(item\.subs \|\| \[\]\)\.length/.test(CODE), true);
  ok("...the user must hold reassign", /const canReassign = can\("reassign"\) && _leaf/.test(CODE), true);
  ok("...and the op must have dates", /const canQuickAssign = canReassign && hasDates/.test(CODE), true);
  // A job or phase row rolls up its children, so pressing it would write many
  // ops from one click. Explicitly excluded rather than left to chance.
  ok("...which requires there to be no children", /!\(item\.subs \|\| \[\]\)\.length/.test(CODE), true);
  // The trigger is whatever the cell already rendered, in BOTH states, so the
  // column gains no new furniture AND the crew rendering is not duplicated —
  // `wrap` takes the branch's own content and either makes it pressable or does
  // not. The first cut built a parallel trigger and broke assignee-col-test.
  ok("...the cell's own content is the trigger", /trigger=\{content\}/.test(CODE), true);
  ok("...through one wrapper used by every branch",
    /const wrap = \(content, style, t\) => canQuickAssign/.test(CODE), true);
  ok("...which falls back to a plain cell when not assignable",
    /\) : <div style=\{style\} title=\{t\}>\{content\}<\/div>;/.test(CODE), true);
  ok("...and all three branches go through it",
    (CODE.match(/return wrap\(|wrap\(<>/g) || []).length, 3);
}

console.log("\n7. The write goes through the permission-gated path");
{
  // RULED: assigning writes to the SCHEDULE, so it takes the drag's path, not
  // the cell-edit path. commitLanding runs the no-overlap backstop and refuses
  // rather than rearranging; applyDragMove writes the node and appends the
  // shared moveLog entry in one step.
  ok("it commits through commitAssign", /commitAssign\(item, \[v\]\)/.test(CODE), true);
  ok("commitAssign has a body to check", COMMIT.length > 80, true);
  ok("...which goes through commitLanding, the drag's backstop",
    /commitLanding\(\(list\) => recalcBounds\(applyDragMove\(list, \[mover\]/.test(COMMIT), true);
  ok("...and nothing else commits the assignment", /setTasks\(/.test(COMMIT), false);
  ok("...and the op id is what the backstop checks",
    /\[String\(op\.id\)\], op\.title/.test(CODE), true);
  ok("...with the mover marked as a reassignment, so team and moveLog are written",
    /const mover = \{ id: String\(op\.id\), reassigned: true,/.test(CODE), true);
  // The dates must NOT change: this cell assigns, it does not schedule.
  ok("...and from/to carry the SAME dates", /from: \{ \.\.\.at, team: op\.team \|\| \[\] \}, to: \{ \.\.\.at, team: nextTeam \}/.test(CODE), true);
}

console.log("\n8. The shared dropdown was EXTENDED, not forked");
{
  // This file already carries SimpleDrop, AssigneeSelect, AssigneeDrop and
  // CustomDrop. A fifth would be the exact shape this campaign has spent itself
  // removing, so SimpleDrop gained two backward-compatible props instead.
  ok("SimpleDrop takes an optional custom trigger",
    /function SimpleDrop\(\{[^}]*\btrigger\b/.test(CODE), true);
  // The default path must survive untouched, or every existing caller changes
  // appearance. Asserted by the pill's own class still being rendered.
  ok("...and renders its own pill when none is given",
    /\{trigger\s*\?/.test(CODE) && /className="tq-drop"/.test(CODE), true);
  ok("...and a divider option is not clickable",
    /o\.divider/.test(CODE), true);
  // SIX is the count this change inherited: SimpleDrop, CustomDrop, MultiDrop,
  // TemplateDrop, AssigneeDrop, AssigneeSelect. Pinned rather than guessed, so
  // the assertion fails if a SEVENTH is added — which is the thing worth
  // catching. The six already there are a separate debt, logged, not touched
  // here.
  ok("no new dropdown component was added — still six",
    (CODE.match(/^function (?:\w*Drop\w*|Assignee\w*)\(/gm) || []).length, 6);
}

console.log("\n9. The menu sizes to its CONTENT, not to the trigger");
{
  // The first cut took the menu's width from the trigger's rect, which was right
  // while the trigger was a full-width pill and wrong the moment it became the
  // word "Unassigned": the menu rendered about 70px wide and every name in it
  // was clipped to two letters.
  const vw = 1280;
  const narrow = placeDropMenu({ left: 900, width: 70, viewportWidth: vw, custom: true });
  ok("a narrow trigger does not pin the menu's width", narrow.width === undefined, true);
  ok("...it gets a readable minimum instead", narrow.minWidth >= 200, true);
  ok("...and never runs off the right edge", narrow.left + narrow.minWidth <= vw - 8, true);

  // A trigger near the right edge pulls the menu back rather than clipping it.
  const edge = placeDropMenu({ left: 1250, width: 70, viewportWidth: vw, custom: true });
  ok("a trigger at the edge pulls the menu back into view", edge.left < 1250, true);
  ok("...without pushing it off the left", edge.left >= 8, true);

  // A viewport narrower than the minimum still yields something on screen.
  const tiny = placeDropMenu({ left: 10, width: 70, viewportWidth: 180, custom: true });
  ok("a viewport narrower than the minimum still fits on screen",
    tiny.left >= 8 && tiny.left + tiny.minWidth <= 180, true);

  // THE DEFAULT PATH IS UNTOUCHED: every existing caller still matches its own
  // trigger exactly, which is what keeps this a safe change to a shared control.
  const pill = placeDropMenu({ left: 100, width: 320, viewportWidth: vw, custom: false });
  ok("a default dropdown still matches its trigger width", pill.width, 320);
  ok("...and keeps its left edge", pill.left, 100);
  ok("...and asks for no minimum", pill.minWidth === undefined, true);
}

console.log("\n10. Availability — eligible but busy is SHOWN, marked, and refused on pick");
{
  // "Why isn't Caleb in the list" is a worse question than "Caleb is booked".
  // Busy people stay visible, carry the conflict, and sort below the free ones
  // inside their own group so the pickable names lead.
  const busyWith = (pid) => pid === "d" ? { title: "401992-01 Wire" } : null;
  const rows = assignPickerOptions({ id: "o7", requiredDepartments: ["Layout"] }, CREW, { busyWith });
  const inOrder = rows.filter(r => !r.divider).map(r => r.name);
  ok("the busy person is still offered", inOrder.includes("Danny"), true);
  ok("...marked as busy", rows.find(r => r.name === "Danny").busy, true);
  ok("...naming what they are booked on, so the reason is actionable",
    rows.find(r => r.name === "Danny").busyWith.title, "401992-01 Wire");
  ok("...and free matches lead the busy ones", inOrder.slice(0, 2), ["Quincy", "Danny"]);
  ok("a free person is not marked", rows.find(r => r.name === "Quincy").busy, false);
  ok("...and carries no conflict", rows.find(r => r.name === "Quincy").busyWith, null);
  // Marking must not reorder across the match divider — department still wins.
  ok("busy does not promote a non-match above a match",
    rows.findIndex(r => r.divider) > rows.findIndex(r => r.name === "Danny"), true);
}

console.log("\n10b. The busy path: refused at pick, and the op never blocks itself");
{
  // A busy pick must be REFUSED, with the reason, and must not write.
  ok("a busy pick is refused", /if \(picked && picked\.busy\) \{/.test(CODE), true);
  ok("...through the shared refusal, naming who is not free",
    /showLandingRefusal\(\{ kind: "overlap", title: item\.title \|\| "", other: picked\.busyWith\.other \}/.test(CODE), true);
  ok("...and returns before committing", /return;\s*\}\s*commitAssign\(item, \[v\]\)/.test(CODE.replace(/\r?\n\s*/g, "")), true);

  // THE OP MUST LEAVE ITS OWN OBSTACLE SET. Without this a reassignment asks
  // "is Quincy free?" while the op Quincy is being put on is still standing in
  // the way, so every candidate reads busy and nothing can ever be assigned.
  ok("the op is excluded from the obstacle set it is being placed into",
    /excludeOpIds: \[op\.id\]/.test(PICKER), true);
  ok("...and from the standing units the clash is named from",
    /\.filter\(u => !sameId\(u\.unit\?\.id, op\.id\)\)/.test(PICKER), true);
  ok("...asked about the op's OWN dates, since this cell never moves anything",
    /avail\.free\(pid, op\.start, op\.end, op\.startHour \?\? null\)/.test(PICKER), true);
}

console.log("\n11. Dates first — the cell assigns a person, it does not schedule");
{
  ok("an op with no dates is refused with a reason, not a menu",
    /Can't assign until dates are set/.test(J), true);
  ok("...gated on the op actually having both ends",
    /const hasDates = !!\(item\.start && item\.end\)/.test(CODE), true);
  ok("...and the picker requires them", /canQuickAssign = [^;]*hasDates/.test(CODE), true);
}

console.log("\n12. Reopen to change or clear");
{
  ok("an assigned cell opens the menu too",
    /canReassign/.test(CODE), true);
  ok("...with an Unassign option", /label: "Unassign"/.test(CODE), true);
  ok("...that clears the team rather than writing a person",
    /commitAssign\(item, \[\]\)/.test(CODE), true);
}

console.log("\n13. Assigning writes to the SCHEDULE — the op must become a bar");
{
  // The point of the cell. Asked of occupyingUnits, the schedule's own
  // collector, rather than a new predicate: if it returns the unit, the row
  // draws it.
  const ctx = { today: "2026-10-01" };
  const mk = (team) => [{ id: "J", subs: [{ id: "P", subs: [
    { id: "op", title: "Layout", start: "2026-10-06", end: "2026-10-07", status: "Not Started", team },
  ] }] }];
  ok("an op with dates and nobody on it draws no bar",
    occupyingUnits(mk([]), ctx).filter(u => (u.unit.team || []).length).length, 0);
  ok("...and the same op with a person on it DOES",
    occupyingUnits(mk(["q"]), ctx).filter(u => (u.unit.team || []).includes("q")).length, 1);
  // Dates are what takesPart requires; a team without them is not a bar, which
  // is exactly why the cell refuses to assign before they are set.
  const undated = [{ id: "J", subs: [{ id: "P", subs: [{ id: "op", title: "Layout", status: "Not Started", team: ["q"] }] }] }];
  ok("a person on an UNDATED op draws nothing — the reason for ruling 2",
    occupyingUnits(undated, ctx).length, 0);
  // And the commit goes through the same backstop a drag uses.
  ok("the write goes through commitLanding, not a bare setTasks",
    /commitLanding\(/.test(CODE), true);
  // applyDragMove appends moveLogEntry itself, and moveLogEntry already writes
  // fromTeam/toTeam when the mover is a reassignment — so the log comes from the
  // same shape a drag produces rather than a second entry format.
  // `people` joined the options in #427: applyDragMove needs the roster to let a
  // department follow the work, and a caller that omits it accepts the drop and
  // leaves the department stale. Pinned here as well as in department-follow-test,
  // because this is the assertion that names THIS call site.
  ok("...and the moveLog comes from the shared writer",
    /applyDragMove\(list, \[mover\], \{ date: TD, movedBy, reason, people \}\)/.test(CODE), true);
  ok("...marked as a reassignment so fromTeam/toTeam are written",
    /reassigned: true/.test(CODE), true);
}

console.log("\n14. RED PROOF");
{
  const checks = [
    // A strict department filter would make some ops unassignable — the reason
    // ruling 2 put everyone in the list.
    ["a strict filter would offer nobody for an unmatched op",
      CREW.filter(p => (p.departments || []).includes("Welding")).length, 0],
    ["...while the picker offers the whole crew",
      assignPickerOptions({ id: "x", requiredDepartments: ["Welding"] }, CREW).length, 5],
    // Sorting must be stable and by name, or the list reorders between opens.
    ["the order is deterministic",
      JSON.stringify(names(assignPickerOptions({ id: "y", requiredDepartments: ["Layout"] }, CREW)))
      === JSON.stringify(names(assignPickerOptions({ id: "y", requiredDepartments: ["Layout"] }, [...CREW].reverse()))), true],
    // And the divider must never be selectable.
    ["the divider carries no id to assign",
      assignPickerOptions({ id: "z", requiredDepartments: ["Layout"] }, CREW).find(r => r.divider).id, undefined],
  ];
  let red = 0;
  for (const [label, got, want] of checks) {
    if (JSON.stringify(got) === JSON.stringify(want)) red++;
    else { console.error(`  RED FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); fail++; }
  }
  console.log(`  red proof: ${red}/${checks.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
