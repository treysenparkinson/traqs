// #438 — ticking every department NARROWS the op, and #426 — the picker never
// said whether what it showed was the op's own or its parent's.
//
// ─── #438, THE COLLAPSE THAT INVERTS INTENT ───
//
// `normalizeDepartments(value, allKnown)` returns `[]` when `value` covers every
// known department, because "all of them" and "anyone" are the same statement.
// That is TRUE AT THE TOP and FALSE BELOW IT, because `[]` does not mean anyone —
// it means SAY NOTHING, and `unitDepartments` then asks the parent:
//
//     op [] under a panel saying Wire        -> Wire
//     op [all 11 roles] under the same panel -> all 11
//
// So ticking every box collapses to `[]`, which resolves to the panel's ONE
// department. THE MOST EXPANSIVE GESTURE THE CONTROL OFFERS PRODUCES ITS MOST
// RESTRICTIVE RESULT, silently. Reachable today: Matrix has 11 roles configured
// and a panel that states "Admin" with three ops under it.
//
// The collapse is right when nothing above states anything and wrong when
// something does, so that is the distinction it is now made on — not a flag, and
// not removing the collapse, which is correct and wanted at the top level.
//
// ─── #426, THE PICKER THAT SHOWED A VALUE WITHOUT ITS ORIGIN ───
//
// Every picker read `unitDepartments(node, null, null)` — panel and job passed
// as NULL — so an op that inherits showed nothing ticked. TWO SURFACES, TWO
// DIFFERENT WRONG ANSWERS FOR ONE STATE, which is the two-surfaces shape again:
//
//     edit-job form (MultiDrop)   "Anyone"   <- an outright false statement
//     schedule modal pickers      "Dept"     <- a placeholder, reads as unset
//
// Neither is true: the op is constrained to its parent's department and the
// scheduler enforces it. Precedence is RIGHT and is not touched — the nearest
// statement wins, which is what makes an override an override. What was missing
// is that the control could not say which level it was reading.
//
//   node scripts/dept-inherit-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { unitDepartments, resolveDepartments, departmentsAfterToggle, normalizeDepartments } from "../src/scheduleRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const RAW = read("../src/TRAQS.jsx");
const CODE = codeOf(RAW);

const ROLES = ["Wire", "Cut", "Layout"];
const node = (d) => d == null ? { id: "n" } : { id: "n", requiredDepartments: d, requiredDepartment: d[0] || "" };
const PANEL_WIRE = { id: "p", requiredDepartments: ["Wire"], requiredDepartment: "Wire" };
const JOB_CUT = { id: "j", requiredDepartments: ["Cut"], requiredDepartment: "Cut" };

console.log("\n1. #438 RED PROOF — the most expansive gesture must not be the most restrictive");
{
  // The collapse itself is unchanged and still correct where it applies.
  ok("all known departments still collapse to the empty set",
    normalizeDepartments(ROLES, ROLES), []);

  // AT THE TOP, where [] genuinely means anyone, the collapse is right.
  ok("ticking the last box on an op with NO constrained parent opens it to anyone",
    departmentsAfterToggle(node(["Wire", "Cut"]), null, null, "Layout", ROLES), []);
  ok("...and that really does resolve to anyone",
    unitDepartments(node(departmentsAfterToggle(node(["Wire", "Cut"]), null, null, "Layout", ROLES)), null, null), []);

  // UNDER A CONSTRAINED PARENT it is wrong, and this is the defect.
  const all = departmentsAfterToggle(node(["Wire", "Cut"]), PANEL_WIRE, null, "Layout", ROLES);
  ok("ticking the last box under a constrained operation keeps the explicit set",
    all, ["Wire", "Cut", "Layout"]);
  ok("...so the op is NOT narrowed back to the operation's one department",
    unitDepartments(node(all), PANEL_WIRE, null), ["Wire", "Cut", "Layout"]);
  // The job level counts as a constrained parent too.
  ok("a constrained JOB prevents the collapse as well",
    departmentsAfterToggle(node(["Wire", "Cut"]), null, JOB_CUT, "Layout", ROLES), ["Wire", "Cut", "Layout"]);
  // And an unconstrained parent does not prevent it.
  ok("an UNCONSTRAINED parent leaves the collapse alone",
    departmentsAfterToggle(node(["Wire", "Cut"]), { id: "p" }, { id: "j" }, "Layout", ROLES), []);
}

console.log("\n2. #438 — the toggle edits WHAT YOU SEE");
{
  // The picker now shows the effective set, so a click has to start from the
  // effective set. Starting from the node's own (empty) would make the first
  // click on an inheriting op silently DROP the inherited department.
  ok("clicking a second department on an inheriting op keeps the inherited one",
    departmentsAfterToggle(node(null), PANEL_WIRE, null, "Cut", ROLES), ["Wire", "Cut"]);
  ok("...rather than replacing it with only the clicked one",
    departmentsAfterToggle(node(null), PANEL_WIRE, null, "Cut", ROLES).includes("Wire"), true);
  // Unticking the sole inherited department cannot produce "anyone" — it is
  // unrepresentable (#439) — so it returns to inheriting, which is where it was.
  ok("unticking the sole inherited department returns the empty set",
    departmentsAfterToggle(node(null), PANEL_WIRE, null, "Wire", ROLES), []);
  ok("...which still resolves to the operation's department, as it must",
    unitDepartments(node([]), PANEL_WIRE, null), ["Wire"]);

  // Ordinary own-set editing is unchanged.
  ok("toggling a department off an own set removes it",
    departmentsAfterToggle(node(["Wire", "Cut"]), null, null, "Cut", ROLES), ["Wire"]);
  ok("toggling one on adds it", departmentsAfterToggle(node(["Wire"]), null, null, "Cut", ROLES), ["Wire", "Cut"]);
  ok("case is not significant", departmentsAfterToggle(node(["Wire"]), null, null, "wire", ROLES), []);
}

console.log("\n3. #426 — resolve WITH ORIGIN, beside unitDepartments");
{
  ok("an op's own departments report as own",
    resolveDepartments(node(["Cut"]), PANEL_WIRE, JOB_CUT), { depts: ["Cut"], from: "own" });
  ok("an empty own set falls through to the panel, and says so",
    resolveDepartments(node([]), PANEL_WIRE, JOB_CUT), { depts: ["Wire"], from: "panel" });
  ok("a missing field falls through too",
    resolveDepartments(node(null), PANEL_WIRE, JOB_CUT), { depts: ["Wire"], from: "panel" });
  ok("past an unconstrained panel to the job",
    resolveDepartments(node(null), { id: "p" }, JOB_CUT), { depts: ["Cut"], from: "job" });
  ok("nothing anywhere is 'none', not an empty 'own'",
    resolveDepartments(node(null), null, null), { depts: [], from: "none" });
  ok("a panel resolving against its job reports job",
    resolveDepartments(node(null), null, JOB_CUT), { depts: ["Cut"], from: "job" });
  // The legacy single-string shape still participates in precedence.
  ok("the old requiredDepartment string is still read",
    resolveDepartments({ id: "n", requiredDepartment: "Layout" }, PANEL_WIRE, null), { depts: ["Layout"], from: "own" });

  // ONE IMPLEMENTATION OF PRECEDENCE. unitDepartments keeps its signature and
  // all eight of its callers, including the server path, but delegates — two
  // copies of a precedence rule is how this file got four disagreeing readers.
  for (const [n, p, j] of [[node(["Cut"]), PANEL_WIRE, JOB_CUT], [node(null), PANEL_WIRE, null],
    [node(null), null, JOB_CUT], [node(null), null, null], [node([]), { id: "p" }, JOB_CUT]]) {
    ok(`unitDepartments agrees with resolveDepartments (${JSON.stringify(resolveDepartments(n, p, j).from)})`,
      unitDepartments(n, p, j), resolveDepartments(n, p, j).depts);
  }
}

console.log("\n4. #426 — BOTH SURFACES STATE THE ORIGIN");
{
  // The two-surfaces shape: one control said "Anyone" and the other said "Dept"
  // for the same state, and neither was true. Both are asserted here so they
  // cannot drift apart again.
  const multidrop = (() => {
    const at = CODE.indexOf("function MultiDrop(");
    const end = CODE.indexOf("function AssigneeDrop(", at);
    return at < 0 ? "" : CODE.slice(at, end > at ? end : at + 4000);
  })();
  ok("MultiDrop was found", multidrop.length > 0, true);
  // EXACT WIRING, not mention. Six mutants survived the first version of this
  // section because every assertion here checked that a name APPEARED: deleting
  // `inheritedFrom=` from the call site left `/inheritedFrom/` green, because the
  // prop is still destructured in the signature. Same mistake as #414's, one
  // turn later, so these are pinned to the whole expression.
  ok("the label distinguishes an inherited set from an own one",
    /const label = sel\.length === 0 \? emptyLabel\s*: inherited \?/.test(multidrop), true);
  ok("...and `inherited` is derived from the origin, not from emptiness",
    /const inherited = inheritedFrom === "panel" \|\| inheritedFrom === "job"/.test(multidrop), true);
  // RE-ANCHORED when the row and the note were extracted into shared pieces.
  // The guards did not change; they moved out of MultiDrop so the two
  // schedule-modal pickers could have them too.
  ok("the clear row is gated on overriding something that exists",
    /if \(!onClear \|\| !isOwn \|\| !deptInheritable\(parent\)\) return null;/.test(CODE), true);
  ok("...and 'inheritable' requires the parent to actually name departments",
    /return !!parent && parent\.from !== "none" && \(parent\.depts \|\| \[\]\)\.length > 0;/.test(CODE), true);

  // The schedule-modal pickers read the node WITH its ancestors now. The
  // `null, null` pair was the whole defect, so the replacement arguments are
  // asserted rather than just the function name.
  // RE-ANCHORED 2026-10-08 (#488), same rule, one picker instead of two (R3).
  // The two schedule-modal pickers became one shared `deptPicker`, so the ticks
  // resolve once against the ancestors it was HANDED. The `null, null` pair that
  // was the original defect is still asserted absent below, and each call site's
  // ancestors are pinned per site in scripts/dept-picker-test.mjs.
  ok("the shared picker's ticks resolve against the ancestors it was given",
    /const r = resolveDepartments\(node, parent, job\);/.test(CODE), true);
  ok("...and the ticks read that same resolution, not a fresh one with null",
    /const isOn = r\.depts\.some\(d => d\.toLowerCase\(\) === role\.toLowerCase\(\)\);/.test(CODE), true);
  ok("no picker still reads a node with null ancestors for its ticks",
    /isOn=(unitDepartments|resolveDepartments)\((panel|sub),null,null\)/.test(CODE), false);
  // Both button LABELS resolve too — they were the two-surfaces problem itself,
  // one saying "Anyone" and the other "Dept" for the same state.
  // One label now, reading the same resolution as the ticks — which is stronger
  // than the two it replaced: the label and the ticks CANNOT disagree, because
  // they are the same value rather than two calls that happen to match.
  ok("the label reads the same resolution as the ticks",
    /\{r\.depts\.length \? \(r\.from==="own" \?/.test(CODE), true);
  ok("...and names the ancestor it inherited from",
    /from \$\{r\.from==="job"\?"job":"operation"\}/.test(CODE), true);

  // The edit-form picker passes the ancestors AND both new props.
  const flat = RAW.replace(/\n\s*/g, " ");
  ok("the edit-form picker resolves against the operation and the job",
    /<MultiDrop values=\{resolveDepartments\(op, panel, ej\)\.depts\}/.test(flat), true);
  ok("...and passes the origin to the control",
    /inheritedFrom=\{resolveDepartments\(op, panel, ej\)\.from\}/.test(flat), true);
  ok("...and what it would fall back to",
    /parent=\{resolveDepartments\(null, panel, ej\)\}/.test(flat), true);
  ok("...and wires the clear verb to the null role",
    /onClearToInherit=\{\(\) => updOp\(pi, oi, toggleDept\(op, null, panel, ej\)\)\}/.test(flat), true);
}

console.log("\n5. #426 — CLEAR TO INHERIT, as an explicit row");
{
  ok("clearing writes the empty set and the empty string",
    departmentsAfterToggle(node(["Cut"]), PANEL_WIRE, null, null, ROLES), []);
  ok("...and the node then inherits", unitDepartments(node([]), PANEL_WIRE, null), ["Wire"]);

  // Offered ONLY when there is something to fall back to AND the node is
  // currently overriding it. On a node with no constrained parent it would be
  // indistinguishable from "set to anyone", which is a different statement.
  ok("the row is offered when the node overrides a parent",
    resolveDepartments(node(["Cut"]), PANEL_WIRE, null).from === "own"
      && resolveDepartments(node([]), PANEL_WIRE, null).from !== "none", true);
  ok("...and not when there is nothing above to inherit",
    resolveDepartments(node([]), { id: "p" }, null).from, "none");

  // SCOPED TO MultiDrop (R4). Written against the whole file this was GREEN ON
  // UNFIXED CODE, because `GroupingSelect` — an unrelated control 150 lines
  // away — already has an `onClear`. A presence assertion over a 31,000-line
  // file tests the file, not the change.
  const md = (() => {
    const at = CODE.indexOf("function MultiDrop(");
    const end = CODE.indexOf("function AssigneeDrop(", at);
    return at < 0 ? "" : CODE.slice(at, end > at ? end : at + 4000);
  })();
  ok("the clear row lives in the shared control", /<DeptClearRow /.test(md), true);

  // ALL THREE PICKERS, not just the one that happens to use MultiDrop. Fixing
  // the edit form and leaving the two schedule-modal pickers without the clear
  // row or the limitation line would have RECREATED the two-surfaces problem
  // inside the fix for it — one surface explaining what it cannot do, the others
  // silently unable to do it.
  // RE-ANCHORED 2026-10-08 (#488), same rule, fewer pickers (R3). The two
  // schedule-modal pickers were extracted into one shared `deptPicker` used by
  // FOUR sites — the two wizard ones and two new Job Details ones — so there are
  // now two picker implementations, not three, and the rule is unchanged: every
  // one of them offers the clear row and carries the limitation line.
  ok("every picker offers the clear row", (CODE.match(/<DeptClearRow /g) || []).length, 2);
  ok("every picker carries the limitation line", (CODE.match(/<DeptInheritNote /g) || []).length, 2);
  // ONE definition of each, because the wording is the deliverable for #439 and
  // three copies of a sentence is how this field got four disagreeing readers.
  ok("the clear row is defined once", (CODE.match(/function DeptClearRow\(/g) || []).length, 1);
  ok("the note is defined once", (CODE.match(/function DeptInheritNote\(/g) || []).length, 1);
  ok("...and the 'can it inherit' test is shared, not re-derived per caller",
    (CODE.match(/function deptInheritable\(/g) || []).length, 1);

  // Each is wired to the right ancestors: a panel falls back to the JOB, a task
  // to its OPERATION then the job.
  // The shared picker takes the ancestor as a PARAMETER, so one assertion covers
  // its clear row and the four call sites supply the right ancestor each — a
  // panel passes null (falling back to the job), an op passes its panel. Those
  // four are pinned per site in scripts/dept-picker-test.mjs; what matters here
  // is that the fallback is still resolved from the ancestor and not hardcoded.
  ok("the shared picker's clear row falls back to whatever ancestor it was given",
    /<DeptClearRow parent=\{resolveDepartments\(null, parent, job\)\}/.test(CODE), true);
  ok("...and no caller hardcodes the ancestor into the row",
    /<DeptClearRow parent=\{resolveDepartments\(null, (null|panel), ed\)\}/.test(CODE), false);
  ok("the edit-form clear row falls back to its operation",
    /parent=\{resolveDepartments\(null, panel, ej\)\}/.test(CODE), true);
}

console.log("\n6. #439 — THE CONTROL SAYS WHAT IT CANNOT DO");
{
  // "Anyone" is UNREPRESENTABLE on a node whose parent states a department:
  // [] is the only empty encoding and it already means inherit. Not built —
  // it needs a third state in the data and touches the iOS string read. But the
  // control must not leave someone to discover it by trying.
  // Asserted as LITERAL FRAGMENTS plus the noun mapping, because the sentence
  // interpolates `{upWord}` — a regex for "follows the operation" cannot match
  // source that reads "follows the {upWord}", and would have been red forever
  // for the wrong reason.
  ok("the limitation is stated in the control, not only in the entry",
    /can&apos;t be opened to anyone while the/.test(RAW), true);
  ok("...and it says what unticking everything WILL do instead",
    /Untick everything and this follows the/.test(RAW), true);
  ok("...naming the parent's actual departments, not just its level",
    /Untick everything and this follows the \{w\} \(\{\(parent\.depts \|\| \[\]\)\.join\(" or "\)\}\)/.test(RAW), true);
  // The UI's own nouns: a panel is an "operation", an op is a "task".
  ok("it uses the UI's nouns, not the code's",
    /return parent && parent\.from === "job" \? "job" : "operation";/.test(RAW), true);
  ok("...from ONE definition — MultiDrop carried its own copy for a revision",
    (RAW.match(/\? "job" : "operation"/g) || []).length, 1);
  ok("the line is shown only when there IS something to inherit",
    /function DeptInheritNote\(\{ parent \}\) \{\s*\n\s*if \(!deptInheritable\(parent\)\) return null;/.test(RAW), true);
  ok("...and the UI nouns come from the shared helper, not each caller",
    /function deptParentWord\(parent\) \{\s*\n\s*return parent && parent\.from === "job" \? "job" : "operation";/.test(RAW), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
