// #223/#224 — A PERSISTED DEFAULT IS INDISTINGUISHABLE FROM A CHOICE.
//
// `normalizeTasks` and `normalizePeople` fill derived values on LOAD, and the
// client then autosaves the whole tree — so the guess is written to S3 and
// becomes indistinguishable from something somebody typed. Same shape as #341's
// title heuristic, which left 87 ops carrying a constraint nobody chose and cost
// a review nobody could complete.
//
// MEASURED ON MATRIX BEFORE BUILDING:
//
//   department === role                    18 of 18 live people
//   requiredDepartment === ""             109 of 294 live nodes (persisted)
//   panels whose colour equals the job's   118 of 118
//   ops whose colour equals the panel's    112 of 112
//   nodes carrying their own id's hash       0  — _colorForId has NEVER fired
//
// NOT ONE COLOUR BELOW JOB LEVEL WAS EVER DELIBERATELY CHOSEN, and all 112 ops
// would be stranded by a panel colour change: `updPanel` patches `{ ...pn,
// ...patch }` with no cascade, and `op.color || panel.color` prefers the stored
// value. The panel colour picker is live; the ops will not follow it.
//
// THE FIX IS ABOUT PERSISTENCE, NOT COMPUTATION. The normaliser may still derive
// for the screen — that is what makes the colours stable across reloads. What it
// may not do is send the guess back. Fields it FILLED are marked and stripped
// before the POST; fields that ARRIVED from the server are left exactly as they
// are, because the existing 230 are unknowable and cleaning them would be
// guessing a second time.
//
// The marker follows the codebase's own convention for run-local scratch
// (`_outcome`, `_placed`) and iOS's `hpdPresence.wasAbsent` — "absent on decode,
// remembered, so encode leaves the key off again".
//
//   node scripts/derived-defaults-test.mjs
import { DERIVED_KEY, markDerived, stripDerived } from "../src/derived.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. THE PROPERTY — a value this client DERIVED is not sent back");
{
  const node = markDerived({ id: "P", title: "Panel", color: "#6366f1" }, "color");
  ok("the derived value is present in memory, for the screen", node.color, "#6366f1");
  const out = stripDerived(node);
  ok("...and absent from what is saved", "color" in out, false);
  ok("...while everything else survives", [out.id, out.title], ["P", "Panel"]);
  ok("the marker itself never reaches the payload", DERIVED_KEY in out, false);
}

console.log("\n2. A VALUE THAT CAME FROM THE SERVER IS LEFT ALONE");
{
  // The 230 colours, the 109 empty strings and the 18 departments already stored
  // arrive with their key present. The normaliser does not fill them, so they are
  // not marked, so they are not stripped. Cleaning them would be a second guess.
  const stored = { id: "P", color: "#f43f5e", requiredDepartment: "", department: "Wire" };
  ok("an unmarked node passes through untouched", stripDerived(stored), stored);
  // And a node where only ONE field was derived keeps the others.
  const mixed = markDerived({ id: "O", color: "#10b981", requiredDepartment: "Layout" }, "color");
  const out = stripDerived(mixed);
  ok("only the marked field is removed", out, { id: "O", requiredDepartment: "Layout" });
}

console.log("\n3. SEVERAL FIELDS, AND MARKING TWICE");
{
  let n = markDerived({ id: "X", color: "#000", requiredDepartment: "" }, "color");
  n = markDerived(n, "requiredDepartment");
  ok("both are stripped", stripDerived(n), { id: "X" });
  ok("...and marking the same field twice does not duplicate",
    markDerived(markDerived({ id: "Y", color: "#0" }, "color"), "color")[DERIVED_KEY], ["color"]);
}

console.log("\n4. IT GOES ALL THE WAY DOWN");
{
  const tree = [{ id: "J", color: "#1", subs: [
    markDerived({ id: "P", color: "#1", subs: [
      markDerived({ id: "O", color: "#1", requiredDepartment: "" }, "color"),
    ] }, "color"),
  ] }];
  const out = stripDerived(tree);
  ok("the job keeps its own colour", out[0].color, "#1");
  ok("the panel's derived colour is gone", "color" in out[0].subs[0], false);
  ok("the op's too", "color" in out[0].subs[0].subs[0], false);
  ok("...and a field it did NOT mark survives", out[0].subs[0].subs[0].requiredDepartment, "");
  ok("no marker anywhere in the tree", JSON.stringify(out).includes(DERIVED_KEY), false);
}

console.log("\n5. IT MUST NEVER THROW ON THE SAVE PATH");
{
  ok("null", stripDerived(null), null);
  ok("undefined", stripDerived(undefined), undefined);
  ok("a primitive", stripDerived(7), 7);
  ok("an empty array", stripDerived([]), []);
  ok("a node with a non-array marker is not trusted",
    stripDerived({ id: "Z", color: "#9", [DERIVED_KEY]: "color" }), { id: "Z", color: "#9" });
  ok("a marker naming a field that is not there", stripDerived(markDerived({ id: "Q" }, "color")), { id: "Q" });
  ok("marking a non-object is a no-op", markDerived(null, "color"), null);
}

console.log("\n6. RED PROOF — what the old normaliser sent");
{
  // Before this, the filled value was simply part of the object and went out with
  // everything else. There was no way to tell it from a choice at the far end.
  const oldWay = { id: "P", color: "#6366f1", department: "Wire", requiredDepartment: "" };
  ok("RED: every derived value was in the payload", Object.keys(oldWay).sort(),
    ["color", "department", "id", "requiredDepartment"]);
  ok("...and the fix withholds exactly the ones it filled",
    Object.keys(stripDerived(markDerived({ ...oldWay }, "color", "department", "requiredDepartment"))), ["id"]);
}

console.log("\n7. The normalisers mark, and the save strips");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("TRAQS.jsx imports the helpers", /markDerived|stripDerived/.test(CODE), true);
  ok("normalizePeople marks a department it filled",
    /department: p\.department \?\? p\.role \?\? ""/.test(CODE), false);
  ok("...using the marker instead", /markDerived\([\s\S]{0,200}?"department"\)/.test(CODE), true);
  ok("normalizeOp marks a requiredDepartment it filled",
    /markDerived\([\s\S]{0,240}?"requiredDepartment"\)/.test(CODE), true);
  ok("normalizeTasks marks a colour it filled", /markDerived\([\s\S]{0,200}?"color"\)/.test(CODE), true);
  // THE SAVE SIDE, which is the half that matters — a mark nobody strips is noise.
  //
  // EACH CALL SITE NAMED SEPARATELY. A bare `/stripDerived\(/` passes as long as
  // ANY instance survives, so removing it from the tasks payload while leaving it
  // on people read as green — both of those mutants survived the first version of
  // this section, and they are the two that matter most. Same shape as #410's
  // count pattern and #389's guard condition: assert the statement, not the name.
  const at = CODE.indexOf("const doSaveOnce = useCallback(async () => {");
  const body = at < 0 ? "" : CODE.slice(at, at + 9000);
  ok("doSaveOnce was found", body.length > 500, true);
  ok("the TASKS payload is stripped",
    /const dedupedTasks = stripDerived\(tasks\.filter\(/.test(body), true);
  ok("the PEOPLE payload is stripped",
    /const people = stripDerived\(latestPeopleRef\.current\);/.test(body), true);
  // THE CHAIN, not one pair (#339). The body sent is no longer `dedupedTasks`
  // itself: it is the delta built FROM it, so the property to hold is that the
  // thing going out still descends from the stripped array. Every index is
  // required to be found — `indexOf` returns -1 when absent, and -1 is less than
  // everything, so an ordering check passes when the FIRST thing is missing (R4).
  const order = (...names) => {
    const at = names.map(n => body.indexOf(n));
    if (at.some(i => i < 0)) return names.filter((_, i) => at[i] < 0);   // name what is missing
    return at.every((v, i) => i === 0 || at[i - 1] < v) ? [] : ["out of order"];
  };
  ok("...and the delta is built from the stripped array, before the POST",
    order("const dedupedTasks = stripDerived(", "buildDelta(dedupedTasks,", "saveTasks(_tasksBody"), []);
}

console.log("\n8. #461/#462 — RUN-LOCAL SCRATCH NEVER REACHES S3");
{
  // The convention was a leading underscore and nothing enforced it. Measured
  // 2026-10-08 on Matrix: `_rescheduleStartDate` — the schedule modal's own
  // date input — persisted on 4 live nodes, and `placedSubs` (a preview, no
  // underscore, so outside the convention entirely) on 18 panels at 107 KB,
  // 15.6% of tasks.json, read by nothing.
  const tree = [{
    id: "j", title: "J", _rescheduleStartDate: "2026-10-01", _cc_abc: "a custom column value",
    subs: [{ id: "p", _placed: true, _outcome: null, _panelScheduled: true, _cc_x: "keep",
      subs: [{ id: "o", hpd: 4, _derived: ["color"], color: "#fff" }] }],
  }];
  const out = stripDerived(tree);
  const j = out[0], p = j.subs[0], o = p.subs[0];
  ok("the modal's draft date does not reach S3", "_rescheduleStartDate" in j, false);
  ok("...nor the replan's run-local flags", ["_placed", "_outcome", "_panelScheduled"].some(k => k in p), false);
  // `_cc_<uuid>` is REAL DATA under an underscore key, which is why this cannot
  // simply drop everything starting with one.
  ok("custom-column values survive at job level", j._cc_abc, "a custom column value");
  ok("...and below it", p._cc_x, "keep");
  ok("a derived default is still stripped by its marker", "color" in o, false);
  ok("...and the marker goes with it", "_derived" in o, false);
  ok("real fields are untouched", [j.title, o.hpd], ["J", 4]);

  // `placedSubs` has no underscore, so it is NOT the strip's job — it is dropped
  // where it is created, in the replan's own write path.
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("the replan drops placedSubs rather than spreading it",
    /const \{placedSubs:placed,\.\.\.opRest\}=op;/.test(CODE), true);
  ok("...and no longer spreads the op wholesale into the write",
    /return \{\.\.\.op,start:opStart,end:opEnd,team:placed\[0\]\?\.team/.test(CODE), false);
  ok("...and strips the per-sub scratch too",
    /subs:placed\.map\(\(\{_placed,_outcome,\.\.\.rest\}\) => rest\)/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
