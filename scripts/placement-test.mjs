// src/placement.js — the one placement engine, and the department SET that
// feeds it.
//
// THE ENGINE IS NOT WIRED YET, deliberately and temporarily. The step boundary
// is "the field shape and the one engine", reported before the four existing
// implementations are retired onto it. That makes this suite the only thing
// executing the module, which is precisely the shape this campaign keeps
// finding (LESSONS #7: a mechanism that never runs). It is called out in the
// report rather than left to be discovered, and the next step removes it.
//
//   node scripts/placement-test.mjs

import {
  candidatesFor, constraintRank, orderOps, pickCandidate, isReplannable, OUTCOME,
} from "../src/placement.js";
import {
  normalizeDepartments, personDepartments, personDeptMatch,
  unitDepartments, unitDepartment, withDepartmentDualWrite,
} from "../src/scheduleRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const names = (list) => (list || []).map(p => p.name);

// Matrix's real shape: Wire has several holders, Cut and Layout have one each.
const CREW = [
  { id: 1, name: "Wes", departments: ["Wire"] },
  { id: 2, name: "Dee", departments: ["Wire"] },
  { id: "3", name: "Cal", departments: ["Cut"] },
  { id: 4, name: "Lou", departments: ["Layout"] },
  { id: 5, name: "Ash", departments: [] },            // holds none: a generalist
];

console.log("\n1. Departments are a set, and empty means anyone");
{
  ok("an empty required set admits everyone", names(candidatesFor({ id: "o" }, CREW)), ["Wes", "Dee", "Cal", "Lou", "Ash"]);
  ok("one department narrows to its holders",
    names(candidatesFor({ id: "o", requiredDepartments: ["Cut"] }, CREW)), ["Cal"]);
  // THE POINT OF THE WHOLE CHANGE: "either" is now expressible.
  ok("two departments admit the union, which is what 'either' means",
    names(candidatesFor({ id: "o", requiredDepartments: ["Wire", "Cut"] }, CREW)), ["Wes", "Dee", "Cal"]);
  ok("a legacy single-string op still narrows correctly",
    names(candidatesFor({ id: "o", requiredDepartment: "Layout" }, CREW)), ["Lou"]);
  // A person holding none of the named departments is simply not a candidate —
  // the generalist is not a universal fallback.
  ok("a generalist does not satisfy a stated department",
    names(candidatesFor({ id: "o", requiredDepartments: ["Cut"] }, CREW)).includes("Ash"), false);
  // NO FALLBACK TO ALL CREW. This is the department funnel's actual mechanism:
  // `matched.length > 0 ? matched : allCrew` looked like a kindness.
  ok("a department nobody holds yields NOBODY, not everybody",
    names(candidatesFor({ id: "o", requiredDepartments: ["Welding"] }, CREW)), []);
}

console.log("\n2. Normalisation — empty is canonical");
{
  ok("trims, dedupes and drops blanks",
    normalizeDepartments([" Wire ", "wire", "", "Cut"]), ["Wire", "Cut"]);
  ok("a single string becomes a one-element set", normalizeDepartments("Wire"), ["Wire"]);
  ok("nothing becomes []", [normalizeDepartments(""), normalizeDepartments(null), normalizeDepartments([])], [[], [], []]);
  // "all departments" and "no departments" are the same statement, so one has
  // to be the stored form or they diverge.
  const ALL = ["Wire", "Cut", "Layout"];
  ok("a set covering every known department collapses to []",
    normalizeDepartments(["Wire", "Cut", "Layout"], ALL), []);
  ok("...case-insensitively", normalizeDepartments(["wire", "CUT", "Layout"], ALL), []);
  ok("a partial set is left alone", normalizeDepartments(["Wire", "Cut"], ALL), ["Wire", "Cut"]);
  // Without the org list the collapse is SKIPPED rather than guessed.
  ok("with no known list, nothing is collapsed",
    normalizeDepartments(["Wire", "Cut", "Layout"]), ["Wire", "Cut", "Layout"]);
}

console.log("\n3. Precedence and the person side");
{
  const job = { requiredDepartments: ["Layout"] };
  const panel = { requiredDepartments: ["Wire", "Cut"] };
  const op = { requiredDepartments: ["Cut"] };
  ok("the nearest level that states anything wins outright",
    [unitDepartments(op, panel, job), unitDepartments({}, panel, job), unitDepartments({}, {}, job)],
    [["Cut"], ["Wire", "Cut"], ["Layout"]]);
  // Not unioned up the tree: a panel saying "Wire or Cut" is MORE SPECIFIC than
  // a job saying "Layout", not additional to it.
  ok("...and is not unioned with its ancestors", unitDepartments({}, panel, job), ["Wire", "Cut"]);
  ok("nothing anywhere is []", unitDepartments({}, {}, {}), []);
  // The person side reads the new set and the old pair.
  ok("a person's set is read", personDepartments({ departments: ["Wire", "Cut"] }), ["Wire", "Cut"]);
  ok("...and the legacy pair still is", personDepartments({ department: "Wire", secondaryDepartment: "Cut" }), ["Wire", "Cut"]);
  ok("...with no tier between them", personDeptMatch({ department: "A", secondaryDepartment: "B" }, ["B"]), true);
}

console.log("\n4. Dual-write keeps the old readers alive");
{
  const n = withDepartmentDualWrite({ id: "o", requiredDepartments: ["Cut", "Wire"] });
  ok("the array is the truth", n.requiredDepartments, ["Cut", "Wire"]);
  // iOS reads extras.text("requiredDepartment"); an array decodes there as nil,
  // which would make it treat every op as having NO department. That widens
  // rather than breaks, but it would leave web and iOS scheduling to different
  // rules with nothing failing — worse than either on its own.
  ok("...and the string carries the FIRST element for older readers", n.requiredDepartment, "Cut");
  ok("a legacy string node gains the array", withDepartmentDualWrite({ requiredDepartment: "Wire" }).requiredDepartments, ["Wire"]);
  // An empty set is ALREADY canonical, so the node comes back untouched and the
  // string key stays absent rather than being added as "". That is deliberate:
  // absent and "" are the same to every reader (iOS's extras.text gives nil for
  // both), and adding the key to every departmentless node would put a dead
  // field on hundreds of ops in a payload that is already 500 KB.
  //
  // Asked as "is the key there", not "=== undefined": ok()'s signature is
  // (label, got, want = true), so passing undefined as `want` takes the DEFAULT
  // and silently asserts true. Hit twice now, in two suites — the shape to
  // remember is that a default parameter cannot tell "omitted" from "undefined".
  ok("an empty set leaves the node alone rather than adding an empty string",
    "requiredDepartment" in withDepartmentDualWrite({ requiredDepartments: [] }), false);
  // ...but a node that HAD a string and now has an empty set does get it cleared,
  // or the stale name would outlive the set it came from.
  ok("...while a set emptied from a real value clears the string",
    withDepartmentDualWrite({ requiredDepartments: [], requiredDepartment: "Wire" }).requiredDepartment, "");
  // A node that says nothing about departments is returned UNCHANGED, so this
  // can run over a whole tree without rewriting rows that have nothing to say.
  const bare = { id: "x", title: "t" };
  ok("a node with no departments is returned by identity", withDepartmentDualWrite(bare) === bare, true);
  const already = { requiredDepartments: ["Wire"], requiredDepartment: "Wire" };
  ok("...and so is one already in both shapes", withDepartmentDualWrite(already) === already, true);
  ok("unitDepartment still answers with one name for printers", unitDepartment(n, null, null), "Cut");
}

console.log("\n5. Manual assignment wins over the department");
{
  // Ruled: manual assignment is a state the scheduler respects. Checked BEFORE
  // departments, because a person deliberately put on an op is a stronger
  // statement than the department the op happens to name.
  const op = { id: "o", team: [2], requiredDepartments: ["Cut"] };
  ok("the named person is the only candidate, department notwithstanding",
    names(candidatesFor(op, CREW)), ["Dee"]);
  ok("ids are compared as strings — mixed string/number is the norm here",
    names(candidatesFor({ id: "o", team: ["3"] }, CREW)), ["Cal"]);
  ok("...and the other way round", names(candidatesFor({ id: "o", team: [3] }, CREW)), ["Cal"]);
  // A stale assignment is not a constraint to honour.
  ok("a team of people who have left falls through to the department",
    names(candidatesFor({ id: "o", team: [99], requiredDepartments: ["Cut"] }, CREW)), ["Cal"]);
}

console.log("\n6. Order is the whole difference — most constrained first");
{
  const ops = [
    { id: "free", hpd: 2 },                                   // anyone: 5 candidates
    { id: "wire", requiredDepartments: ["Wire"], hpd: 2 },    // 2 candidates
    { id: "cut", requiredDepartments: ["Cut"], hpd: 2 },      // 1 candidate
    { id: "named", team: [1], hpd: 2 },                       // exactly 1
  ];
  const order = orderOps(ops, CREW).map(o => o.id);
  // MEMBERSHIP FIRST (R4). `indexOf` returns -1 when an id is absent, and -1 is
  // less than everything, so "cut comes before wire" passes if orderOps DROPS cut
  // entirely — the assertion would go green on an op vanishing from the plan.
  ok("every op is in the order", [...order].sort(), ["cut", "free", "named", "wire"]);
  const before = (a, b2) => { const i = order.indexOf(a), j = order.indexOf(b2); return i >= 0 && j >= 0 && i < j; };
  ok("the one-candidate ops come before the many-candidate ones",
    before("cut", "wire") && before("wire", "free"), true);
  ok("...and an op with a named person is at the front too", before("named", "free"), true);
  // Determinism: a re-run over an unchanged selection must produce the same
  // order, or the preview reshuffles every time it is opened.
  ok("the order is stable across runs", orderOps(ops, CREW).map(o => o.id), order);
  // Longest first among equally-constrained ops: a long op is harder to fit.
  const same = [{ id: "short", hpd: 1 }, { id: "long", hpd: 8 }];
  ok("equally constrained, the longer op is placed first", orderOps(same, CREW).map(o => o.id), ["long", "short"]);
}

console.log("\n7. The objective is a choice, and even load is the default");
{
  const load = { 1: 16, 2: 0 };
  const cands = [CREW[0], CREW[1]];                       // Wes loaded, Dee free
  const earliest = { 1: "2026-10-05", 2: "2026-10-08" };  // but Wes could start sooner
  const loadOf = (id) => load[id] || 0;
  const earliestFor = (p) => earliest[p.id] || null;
  // RULED: even load. Dee waits until Thursday but carries nothing yet.
  ok("even load picks the lighter person even though they start later",
    pickCandidate(cands, { objective: "even", loadOf, earliestFor }).name, "Dee");
  // The alternative, which is the same data read the other way. This pair IS
  // the trade: "Thursday work for someone when another could have done it
  // Tuesday."
  ok("finish-soonest picks the earlier start even though they are loaded",
    pickCandidate(cands, { objective: "soonest", loadOf, earliestFor }).name, "Wes");
  ok("even load is the default when no objective is given",
    pickCandidate(cands, { loadOf, earliestFor }).name, "Dee");
  // Somebody who cannot start at all never wins, under either objective.
  ok("a candidate with no possible start is never picked",
    pickCandidate(cands, { objective: "soonest", loadOf, earliestFor: (p) => (p.id === 1 ? null : "2026-10-08") }).name, "Dee");
  ok("...and no candidates at all yields null",
    pickCandidate(cands, { earliestFor: () => null }), null);
  ok("an empty candidate list yields null", pickCandidate([], {}), null);
}

console.log("\n8. The only real lock is an active clock");
{
  const people = [{ id: 7, activeJobClock: { clockIn: "2026-10-05T14:00:00Z", opId: "OP" } }];
  ok("an op somebody is clocked into is refused from the selection",
    isReplannable({ id: "OP" }, people), { ok: false, reason: OUTCOME.clocked });
  ok("...matched across id types", isReplannable({ id: "OP" }, [{ id: 7, activeJobClock: { clockIn: "x", opId: "OP" } }]).ok, false);
  ok("another op is replannable", isReplannable({ id: "OTHER" }, people), { ok: true });
  // A clock record with no clockIn is not an active clock.
  ok("a stale clock record with no clockIn does not lock",
    isReplannable({ id: "OP" }, [{ id: 7, activeJobClock: { opId: "OP" } }]), { ok: true });
  ok("nobody clocked in at all is replannable", isReplannable({ id: "OP" }, []), { ok: true });
}

console.log("\n9. RED PROOF");
{
  const checks = [
    // The funnel: the old fallback turned "nobody holds Welding" into everybody.
    ["the old all-crew fallback would have returned the whole roster",
      (() => { const m = CREW.filter(p => personDeptMatch(p, ["Welding"])); return (m.length > 0 ? m : CREW).length; })(), 5],
    ["...and the engine returns none", candidatesFor({ id: "o", requiredDepartments: ["Welding"] }, CREW).length, 0],
    // Order: arbitrary order would put the 5-candidate op first.
    ["unordered, the unconstrained op comes first",
      [{ id: "free" }, { id: "cut", requiredDepartments: ["Cut"] }][0].id, "free"],
    ["...ordered, the single-candidate op does",
      orderOps([{ id: "free" }, { id: "cut", requiredDepartments: ["Cut"] }], CREW)[0].id, "cut"],
    // The objectives must actually differ, or the choice is decoration.
    ["the two objectives disagree on the same data",
      pickCandidate([CREW[0], CREW[1]], { objective: "even", loadOf: (id) => (id === 1 ? 16 : 0), earliestFor: (p) => (p.id === 1 ? "2026-10-05" : "2026-10-08") }).name
      !== pickCandidate([CREW[0], CREW[1]], { objective: "soonest", loadOf: (id) => (id === 1 ? 16 : 0), earliestFor: (p) => (p.id === 1 ? "2026-10-05" : "2026-10-08") }).name,
      true],
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
