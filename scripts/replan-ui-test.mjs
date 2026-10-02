// Re-planning UI: multi-select departments, the stamped-department filter,
// op-level selection with tri-state panels, and per-op obstacle exclusion.
//
//   node scripts/replan-ui-test.mjs

import { readFileSync } from "node:fs";
import { schedulerAvailability, overlapContext } from "../src/overlapRules.js";
import { unitDepartments, normalizeDepartments } from "../src/scheduleRules.js";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

console.log("\n1. The department pickers are multi-select");
{
  ok("there is a MultiDrop", /function MultiDrop\(/.test(J), true);
  // It MUST stay open on a toggle. Closing after each pick is what makes a
  // multi-select feel broken — you reopen it for the second choice and most
  // people conclude it is still single-select.
  const comp = J.slice(J.indexOf("function MultiDrop("), J.indexOf("function MultiDrop(") + 3600);
  ok("...which stays open when an option is toggled", /onClick=\{\(\) => onToggle\(r\)\}/.test(comp), true);
  ok("...and never closes itself on pick", /onToggle\(r\); setOpen\(false\)/.test(comp), false);
  // Empty reads "Anyone", not "none": empty IS the canonical way to say anyone,
  // and "none" would describe the same data as a restriction.
  ok("...labels the empty set as Anyone", /emptyLabel = "Anyone"/.test(comp), true);
  ok("...and joins a set with the word the rule uses", /sel\.join\(" or "\)/.test(comp), true);

  // All three pickers toggle through ONE helper rather than three copies of
  // "set the department" — departments are exactly the field where three copies
  // produced four disagreeing readers.
  ok("there is one toggle helper", (J.match(/const toggleDept = /g) || []).length, 1);
  ok("the op-level picker uses MultiDrop", /<MultiDrop values=\{unitDepartments\(op, null, null\)\}/.test(J), true);
  ok("...the panel picker toggles through it", /updatePanel\(toggleDept\(panel,r\)\)/.test(J), true);
  ok("...and the sub picker too", /updateSub\(toggleDept\(sub,r\)\)/.test(J), true);
  // No single-value writer may survive, or one picker silently overwrites a set.
  ok("no picker writes a bare requiredDepartment string",
    /updatePanel\(\{requiredDepartment:|updateSub\(\{requiredDepartment:/.test(J), false);
  ok("...and the op-level CustomDrop is gone",
    /CustomDrop value=\{op\.requiredDepartment/.test(J), false);
}

console.log("\n2. The toggle helper's contract");
{
  // Modelled here rather than string-matched, because this is the behaviour.
  const toggle = (node, role, allKnown) => {
    const cur = unitDepartments(node, null, null);
    const next = cur.some(d => d.toLowerCase() === role.toLowerCase())
      ? cur.filter(d => d.toLowerCase() !== role.toLowerCase()) : [...cur, role];
    const set = normalizeDepartments(next, allKnown);
    return { requiredDepartments: set, requiredDepartment: set[0] || "" };
  };
  const ALL = ["Wire", "Cut", "Layout"];
  ok("adds to an empty node", toggle({}, "Wire", ALL).requiredDepartments, ["Wire"]);
  ok("adds a second rather than replacing", toggle({ requiredDepartments: ["Wire"] }, "Cut", ALL).requiredDepartments, ["Wire", "Cut"]);
  ok("removes one that is on", toggle({ requiredDepartments: ["Wire", "Cut"] }, "Wire", ALL).requiredDepartments, ["Cut"]);
  ok("upgrades a legacy string node", toggle({ requiredDepartment: "Wire" }, "Cut", ALL).requiredDepartments, ["Wire", "Cut"]);
  // Selecting every department is the same statement as selecting none, so it
  // collapses — otherwise the two diverge the day a sixth department is added.
  ok("selecting them all collapses to the canonical empty",
    toggle({ requiredDepartments: ["Wire", "Cut"] }, "Layout", ALL).requiredDepartments, []);
  // Dual-write, every time, because iOS reads the string.
  ok("the string trails the array", toggle({ requiredDepartments: ["Wire"] }, "Cut", ALL).requiredDepartment, "Wire");
  ok("...and empties with it", toggle({ requiredDepartments: ["Wire"] }, "Wire", ALL).requiredDepartment, "");
}

console.log("\n3. The stamped-department filter");
{
  ok("there is a filter flag", /const \[fDeptEqTitle, setFDeptEqTitle\]/.test(J), true);
  ok("...it counts as an active filter", /\(fDeptEqTitle \? 1 : 0\)/.test(J), true);
  ok("...and appears in BOTH filter panels",
    (J.match(/Department matches the op title/g) || []).length, 2);
  // Modelled: the predicate must read the op's OWN department, not an inherited
  // one. A panel saying "Wire" over an op titled "Wire" is one deliberate
  // statement, not a stamp, and flagging it would bury the real ones.
  const matches = (op) => {
    const own = unitDepartments({ requiredDepartments: op.requiredDepartments, requiredDepartment: op.requiredDepartment }, null, null);
    // EXACTLY ONE department equal to the title is the stamp signature: the
    // heuristic could only write a single name, and only the title. Widened
    // means reviewed, so it drops off the list.
    if (own.length !== 1) return false;
    const t = String(op.title || "").trim().toLowerCase();
    return t.length > 0 && String(own[0]).trim().toLowerCase() === t;
  };
  ok("an op titled Wire with department Wire is flagged", matches({ title: "Wire", requiredDepartment: "Wire" }), true);
  ok("...case- and space-insensitively", matches({ title: " wire ", requiredDepartment: "WIRE" }), true);
  ok("an op titled LABELS with department Layout is NOT", matches({ title: "LABELS", requiredDepartment: "Layout" }), false);
  ok("an op with no department is NOT", matches({ title: "Wire" }), false);
  ok("an untitled op is NOT", matches({ title: "", requiredDepartment: "Wire" }), false);
  // Once widened, it stops being flagged — which is the point: the review ends.
  ok("widening it to a set clears the flag",
    matches({ title: "Wire", requiredDepartments: ["Wire", "Cut"] }), false);
}

console.log("\n4. Selection is OP ids, with tri-state panels");
{
  ok("the comment says op ids", /OP ids selected to be re-planned/.test(J), true);
  ok("there is a panel tri-state", /const panelSelState = \(panel\)/.test(J), true);
  ok("...wired to the checkbox's indeterminate", /el\.indeterminate = panelSelState\(panel\) === "some"/.test(J), true);
  ok("there is a per-op checkbox", /onChange=\{\(\) => toggleOpSel\(sub\.id\)\}/.test(J), true);
  ok("the panel box no longer stores panel ids",
    /rescheduleSelection\.includes\(panel\.id\)/.test(J), false);

  // Modelled: the tri-state rules, including the one that is a judgement call.
  const sel = (ids) => {
    const state = (opIds) => {
      if (opIds.length === 0) return "none";
      const on = opIds.filter(id => ids.includes(id)).length;
      return on === 0 ? "none" : on === opIds.length ? "all" : "some";
    };
    return state;
  };
  ok("none selected", sel([])(["a", "b"]), "none");
  ok("some selected", sel(["a"])(["a", "b"]), "some");
  ok("all selected", sel(["a", "b"])(["a", "b"]), "all");
  ok("a panel with no ops is none, not all", sel([])([]), "none");
  // A half-filled box reads as "not finished", so clicking it finishes the job
  // rather than undoing it.
  const toggle = (prev, ids) => {
    const all = ids.length > 0 && ids.every(id => prev.includes(id));
    return all ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])];
  };
  ok("clicking a PARTLY selected panel selects the rest", toggle(["a"], ["a", "b"]), ["a", "b"]);
  ok("clicking a FULLY selected panel clears it", toggle(["a", "b"], ["a", "b"]), []);
  ok("...and leaves other panels' ops alone", toggle(["a", "b", "z"], ["a", "b"]), ["z"]);
}

console.log("\n5. Unselected ops stay as obstacles — excludeOpIds");
{
  const ctx = overlapContext({ workStart: "08:00", workEnd: "16:00", workDays: [1, 2, 3, 4, 5] }, "2026-10-05");
  const op = (id) => ({ id, title: id, start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 16, hpd: 8, team: ["7"], status: "Not Started" });
  const tasks = [{ id: "J", title: "J", subs: [{ id: "P", title: "P", subs: [op("KEEP"), op("MOVE")] }] }];

  // THE PROPERTY. Excluding the whole job frees both ops; excluding one frees
  // only that one, so the job's own unselected op still blocks.
  const wholeJob = schedulerAvailability(tasks, ctx, { excludeJobId: "J", people: [] });
  ok("excluding the whole job leaves nothing in the way", wholeJob.free("7", "2026-10-05", "2026-10-05"), true);

  const perOp = schedulerAvailability(tasks, ctx, { excludeOpIds: ["MOVE"], people: [] });
  ok("excluding ONE op leaves the other blocking", perOp.free("7", "2026-10-05", "2026-10-05"), false);

  const bothOps = schedulerAvailability(tasks, ctx, { excludeOpIds: ["MOVE", "KEEP"], people: [] });
  ok("...and excluding both frees the day", bothOps.free("7", "2026-10-05", "2026-10-05"), true);

  // Ops on OTHER jobs were always obstacles and still are.
  const other = [{ id: "OTHER", title: "O", subs: [{ id: "P2", subs: [op("X")] }] }, ...tasks];
  ok("another job's op is still an obstacle",
    schedulerAvailability(other, ctx, { excludeOpIds: ["MOVE", "KEEP"], people: [] }).free("7", "2026-10-05", "2026-10-05"), false);
  // Ids compared as strings, as everywhere else.
  ok("op ids are matched across types",
    schedulerAvailability([{ id: "J", subs: [{ id: "P", subs: [{ ...op("7"), id: 7 }] }] }], ctx, { excludeOpIds: ["7"], people: [] })
      .free("7", "2026-10-05", "2026-10-05"), true);

  ok("the caller passes op ids when a selection exists",
    /excludeOpIds: rescheduleSelection, people/.test(J), true);
  ok("...and falls back to the whole job when nothing is selected",
    /rescheduleSelection\.length > 0 && ed\.isReschedule/.test(J), true);
}

console.log("\n6. RED PROOF");
{
  const ctx = overlapContext({ workStart: "08:00", workEnd: "16:00", workDays: [1, 2, 3, 4, 5] }, "2026-10-05");
  const op = (id) => ({ id, title: id, start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 16, hpd: 8, team: ["7"], status: "Not Started" });
  const tasks = [{ id: "J", subs: [{ id: "P", subs: [op("KEEP"), op("MOVE")] }] }];
  const checks = [
    // The old whole-job exclusion IS the bug for a selection: it un-obstacles
    // the op that was deliberately left alone.
    ["the old whole-job exclusion frees an op that should block",
      schedulerAvailability(tasks, ctx, { excludeJobId: "J", people: [] }).free("7", "2026-10-05", "2026-10-05"), true],
    ["...and per-op exclusion does not",
      schedulerAvailability(tasks, ctx, { excludeOpIds: ["MOVE"], people: [] }).free("7", "2026-10-05", "2026-10-05"), false],
    // A single-select picker would replace rather than add.
    ["a single-select toggle would replace the first department",
      (() => { const single = (node, r) => ({ requiredDepartment: r }); return single({ requiredDepartment: "Wire" }, "Cut").requiredDepartment; })(), "Cut"],
    ["...the multi-select keeps both",
      normalizeDepartments([...unitDepartments({ requiredDepartment: "Wire" }, null, null), "Cut"], null), ["Wire", "Cut"]],
  ];
  let red = 0;
  for (const [label, got, want] of checks) {
    if (JSON.stringify(got) === JSON.stringify(want)) red++;
    else { console.error(`  RED FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); fail++; }
  }
  console.log(`  red proof: ${red}/${checks.length} — the old behaviour is reproduced and the new one differs`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
