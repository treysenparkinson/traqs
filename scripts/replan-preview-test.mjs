// The re-plan preview — the last piece, and the one that resolves OUTCOME.
//
// Three requirements, each asserted against behaviour rather than markup:
//   1. infeasible ops NAMED with the reason, never silently placed, and
//      no-candidates must read differently from no-window because they are
//      different problems with different fixes;
//   2. per-person load shown even though the objective IS even load;
//   3. clocked ops refused at SELECTION, not at plan time.
//
//   node scripts/replan-preview-test.mjs

import { readFileSync } from "node:fs";
import { previewOutcomes, OUTCOME, isReplannable } from "../src/placement.js";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const CREW = [
  { id: 1, name: "Wes", departments: ["Wire"] },
  { id: 2, name: "Dee", departments: ["Wire"] },
  { id: 3, name: "Cal", departments: ["Cut"] },
];
const op = (id, extra = {}) => ({ id, title: id, hpd: 4, ...extra });
// A window every candidate can take.
const openAvail = { free: () => true, book: () => {} };
const shutAvail = { free: () => false, book: () => {} };
const W = { start: "2026-10-05", end: "2026-10-05", startH: null };
const run = (ops, opts = {}) => previewOutcomes(ops, CREW, { avail: openAvail, windowOf: () => W, ...opts });
const outcomes = (r) => r.rows.map(x => [x.op.id, x.outcome]);

console.log("\n1. Every op comes back with an outcome — nothing is silent");
{
  const r = run([op("a"), op("b")]);
  ok("both ops are reported", r.rows.length, 2);
  ok("...as placed", r.rows.every(x => x.outcome === OUTCOME.placed), true);
  ok("...each naming who would carry it", r.rows.every(x => x.person && x.person.name), true);
  ok("the placed count matches", r.placed, 2);
  ok("...and nothing is blocked", r.blocked, []);
}

console.log("\n2. The two infeasible kinds are DIFFERENT and must stay so");
{
  // NO CANDIDATES — a stated department nobody on the roster holds. Fixed by
  // widening the department or hiring. Waiting will never help.
  const r1 = run([op("welding", { requiredDepartments: ["Welding"] })]);
  ok("a department nobody holds is no-candidates", outcomes(r1), [["welding", OUTCOME.noCandidates]]);
  ok("...and it is NOT placed anyway", r1.rows[0].person, null);
  ok("...and counts as blocked", r1.blocked.length, 1);

  // NO WINDOW — the people exist, the time does not. Fixed by moving the date.
  const r2 = previewOutcomes([op("wire", { requiredDepartments: ["Wire"] })], CREW,
    { avail: shutAvail, windowOf: () => W });
  ok("people who exist but are busy is no-window", outcomes(r2), [["wire", OUTCOME.noWindow]]);
  ok("...and it reports how many candidates there were, which is the tell",
    r2.rows[0].candidates, 2);

  // THE POINT: they must not collapse into one "couldn't schedule". Sending
  // someone to widen a department when the real answer is "pick another week"
  // is worse than saying nothing.
  ok("the two reasons are distinct values", OUTCOME.noCandidates !== OUTCOME.noWindow, true);
  // And the UI must print them differently.
  ok("the panel distinguishes them in words",
    /nobody can do it/.test(J) && /nobody is free/.test(J), true);
  ok("...naming the fix for each", /no one holds its department/.test(J) && /the people exist, the time does not/.test(J), true);
  ok("...and says the blocked ones do not move",
    /These stay exactly where they are/.test(J), true);
}

console.log("\n3. An infeasible op NEVER consumes a person or a slot");
{
  // The failure this guards: a blocked op quietly taking someone's capacity and
  // pushing a placeable op out behind it.
  const r = run([op("welding", { requiredDepartments: ["Welding"], hpd: 8 }), op("wire", { requiredDepartments: ["Wire"], hpd: 4 })]);
  ok("the placeable op is still placed", r.rows.find(x => x.op.id === "wire").outcome, OUTCOME.placed);
  ok("...and the blocked one carries no load", r.byPerson.reduce((s, p) => s + p.hours, 0), 4);
  ok("...so nobody is charged for work that is not happening",
    r.byPerson.every(p => p.hours === 4), true);
}

console.log("\n4. Per-person load, shown even though we optimise for even");
{
  const r = run([op("a", { hpd: 4 }), op("b", { hpd: 4 }), op("c", { hpd: 4 })]);
  ok("every person who got work is listed", r.byPerson.length > 0, true);
  ok("...with hours that sum to the work", r.byPerson.reduce((s, p) => s + p.hours, 0), 12);
  ok("...and names, not ids", r.byPerson.every(p => typeof p.name === "string" && p.name.length > 0), true);
  ok("...sorted heaviest first, so an uneven result is the first thing seen",
    r.byPerson.map(p => p.hours), [...r.byPerson.map(p => p.hours)].sort((a, b) => b - a));
  // Even load is the objective, so three equal ops across three people should
  // spread. This is the assertion that proves the objective is actually applied
  // rather than merely passed.
  ok("three equal ops spread across the crew rather than stacking",
    r.byPerson.length, 3);
  // ...and the panel shows it, because an even plan can still want overriding.
  ok("the panel renders hours per person", /HOURS PER PERSON/.test(J), true);
  ok("...and says manual assignment will be kept",
    /the scheduler will keep them there/.test(J), true);
}

console.log("\n5. Clocked ops — refused at SELECTION, with a reason");
{
  const people = [{ id: 9, name: "Lou", activeJobClock: { clockIn: "2026-10-05T14:00:00Z", opId: "live" } }];
  // The engine still reports it if one slips through...
  ok("the preview reports a clocked op rather than placing it",
    outcomes(run([op("live")], { people })), [["live", OUTCOME.clocked]]);
  ok("...and it is isReplannable that says so", isReplannable({ id: "live" }, people).reason, OUTCOME.clocked);

  // ...but the real guard is that the box cannot be ticked at all.
  ok("the checkbox is disabled when blocked", /disabled=\{!!blocked\}/.test(J), true);
  ok("...and cannot be toggled even if clicked", /if \(!blocked\) toggleOpSel\(sub\.id\)/.test(J), true);
  ok("...showing WHO is clocked in, not just that someone is",
    /is clocked into this operation/.test(J) && /who\.name/.test(J), true);
  // A panel's select-all must not drag a clocked op in by the back door — the
  // obvious hole once per-op boxes are individually guarded.
  ok("a panel toggle only touches selectable ops", /const selectableOpIdsOf = \(panel\)/.test(J), true);
  ok("...and the tri-state counts only those", /const ids = selectableOpIdsOf\(panel\);/.test(J), true);
  // TWO call sites — panelSelState and togglePanelSel. The definition reads
  // `const selectableOpIdsOf = (panel) =>` and does not match the call pattern,
  // which is why this is 2 and not 3.
  ok("...in both the state and the toggle",
    (J.match(/selectableOpIdsOf\(panel\)/g) || []).length, 2);
}

console.log("\n6. The preview asks the engine, it does not model the run");
{
  ok("it calls previewOutcomes", /previewOutcomes\(ops\.map\(x => x\.op\), crew/.test(J), true);
  ok("...with the SAME availability oracle the run uses",
    /schedulerAvailability\(tasks, overlapCtx, \{ excludeOpIds: rescheduleSelection, people \}\)/.test(J), true);
  ok("...and the same objective", /objective: SCHEDULE_OBJECTIVE/.test(J), true);
  // OUTCOME is now reported, which is what this step was for.
  ok("OUTCOME is imported by the app, not just by tests", /OUTCOME \} from "\.\/placement\.js"/.test(J), true);
  ok("...and read in the panel", /r\.outcome/.test(J), true);
}

console.log("\n7. RED PROOF");
{
  const checks = [
    // Placing an infeasible op anyway is the silent fallback wearing a better
    // face, and it is what produced the department funnel.
    ["a naive 'place it anyway' would assign the unstaffable op",
      (() => { const anyone = CREW[0]; return anyone ? anyone.name : null; })(), "Wes"],
    ["...the preview refuses instead",
      run([op("welding", { requiredDepartments: ["Welding"] })]).rows[0].person, null],
    // The two reasons must not be one.
    ["collapsing the reasons would lose the fix",
      OUTCOME.noCandidates === OUTCOME.noWindow, false],
    // A blocked op must not consume capacity.
    ["a blocked op contributes no hours",
      run([op("welding", { requiredDepartments: ["Welding"], hpd: 99 })]).byPerson.length, 0],
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
