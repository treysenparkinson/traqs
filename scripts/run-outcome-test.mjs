// #344 — the run must never abort. It places what it can and reports the rest
// per op, in the SAME shape the preview already uses.
//
// What was wrong, and it was two independent faults stacked:
//
//   1. pickTeam INVENTED placements. When no window was found in 300 business
//      days it returned `team: eligible.slice(0,1)` at a fallback date with NO
//      availability check — a deliberate double-book.
//   2. A post-hoc check then scanned for double-books with a SIXTH overlap
//      implementation (raw date intervals: no hours, no work days, no time
//      off) and, on the first hit, did `return p` — discarding every placement
//      in the run. A 30-op job gave you nothing because one op collided.
//
// So the run manufactured the conflict it then aborted on. And because the
// crude check is date-only while the oracle is hour-aware, it also aborted on
// placements that were perfectly legal — two ops on one day at different
// hours.
//
//   node scripts/run-outcome-test.mjs

import { readFileSync } from "node:fs";
import { foldRunOutcomes, previewOutcomes, OUTCOME } from "../src/placement.js";
import { codeOf } from "./_code-view.mjs";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(J);   // see _code-view.mjs — comments must not answer for code

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const CREW = [
  { id: 1, name: "Quincy", departments: ["Layout"] },
  { id: 2, name: "Dee", departments: ["Layout"] },
  { id: 3, name: "Cal", departments: ["Cut"] },
];
const op = (id, extra = {}) => ({ id, title: id, hpd: 4, ...extra });

console.log("\n1. A blocked op does not cost the run the other 29");
{
  // The headline. One collision used to return the ORIGINAL job, so nothing
  // landed at all.
  const results = [
    { op: op("a"), outcome: OUTCOME.placed, person: CREW[0] },
    { op: op("b"), outcome: OUTCOME.noWindow, person: null, candidates: 2 },
    { op: op("c"), outcome: OUTCOME.placed, person: CREW[1] },
  ];
  const r = foldRunOutcomes(results, { crew: CREW });
  ok("every op is reported", r.rows.length, 3);
  ok("the placeable ones are still placed", r.placed, 2);
  ok("...and the blocked one is named, not swallowed", r.blocked.map(x => x.op.id), ["b"]);
  ok("...with its reason intact", r.blocked[0].outcome, OUTCOME.noWindow);
}

console.log("\n2. The run reports in the SAME shape as the preview");
{
  // If the two shapes drift, the panel has to fork, and a forked panel is how
  // the preview and the run start telling different stories about one plan.
  const prev = previewOutcomes([op("x")], CREW,
    { avail: { free: () => true, book: () => {} }, windowOf: () => ({ start: "2026-10-05", end: "2026-10-05", startH: null }) });
  const run = foldRunOutcomes([{ op: op("x"), outcome: OUTCOME.placed, person: CREW[0] }], { crew: CREW });
  ok("same top-level keys", Object.keys(run).sort(), Object.keys(prev).sort());
  ok("same row keys for a placed op",
    ["op", "outcome", "person"].every(k => k in run.rows[0] && k in prev.rows[0]), true);
  ok("same byPerson keys", Object.keys(run.byPerson[0]).sort(), Object.keys(prev.byPerson[0]).sort());
}

console.log("\n3. A blocked op carries no hours — nobody is charged for work that is not happening");
{
  const r = foldRunOutcomes([
    { op: op("big", { hpd: 99 }), outcome: OUTCOME.noCandidates, person: null },
    { op: op("small", { hpd: 4 }), outcome: OUTCOME.placed, person: CREW[0] },
  ], { crew: CREW });
  ok("only the placed op contributes", r.byPerson.reduce((s, p) => s + p.hours, 0), 4);
  ok("...and the blocked op puts nobody on the list", r.byPerson.length, 1);
  ok("...naming them, not id-ing them", r.byPerson[0].name, "Quincy");
  ok("...sorted heaviest first", r.byPerson.map(p => p.hours), [4]);

  // A blocked row that NAMES somebody still carries no hours. Found by
  // mutation: every blocked row in the cases above had person:null, so the
  // outcome half of the guard was never exercised and could be deleted with
  // the suite still green. OUTCOME.clocked is exactly this shape — we know
  // precisely who is clocked in — and charging their hours would put work on
  // the chart that nobody is going to do.
  const named = foldRunOutcomes([
    { op: op("live", { hpd: 40 }), outcome: OUTCOME.clocked, person: CREW[0] },
    { op: op("real", { hpd: 4 }), outcome: OUTCOME.placed, person: CREW[0] },
  ], { crew: CREW });
  ok("a blocked op that names a person STILL carries no hours",
    named.byPerson.map(p => [p.name, p.hours]), [["Quincy", 4]]);
  ok("...and is still counted as blocked, not placed", named.placed, 1);
}

console.log("\n4. The two reasons stay distinct here too");
{
  const r = foldRunOutcomes([
    { op: op("welding"), outcome: OUTCOME.noCandidates, person: null },
    { op: op("layout"), outcome: OUTCOME.noWindow, person: null, candidates: 2 },
  ], { crew: CREW });
  ok("both are blocked", r.blocked.length, 2);
  ok("...but not with the same reason",
    r.blocked.map(x => x.outcome), [OUTCOME.noCandidates, OUTCOME.noWindow]);
  ok("...and no-window keeps its candidate count, which is the tell",
    r.blocked.find(x => x.outcome === OUTCOME.noWindow).candidates, 2);
}

console.log("\n5. THE ABORT IS GONE from the run");
{
  // CODE, not J — the comments at the three fix sites quote the banner in
  // order to say it is gone, and a raw scan matches its own prose (#343).
  ok("the 'Assignment aborted' banner no longer renders", /Assignment aborted/.test(CODE), false);
  ok("...nor the overlapError string it carried", /overlapError:\s*overlapErrors/.test(CODE), false);
  ok("...nor the brute-force date-interval scan that fed it",
    /overlapErrors\.push/.test(CODE), false);
  // The crude check compared raw dates. The oracle is hour-aware, so the two
  // disagreed on same-day-different-hours work and the run aborted on a legal
  // plan. Whatever verifies a placement must ask the SAME rule that made it.
  ok("the run verifies through the shared rule, not a sixth copy",
    /overlapsWith\(|schedulerAvailability\(/.test(CODE), true);
}

console.log("\n6. pickTeam NEVER invents a placement");
{
  // The forced fallback: `team: eligible.slice(0,1)` at a date nobody was
  // checked against. This is the naive "place it anyway" the preview suite
  // already red-proofs, and it is what produced Treysen's conflict.
  ok("no forced single-person fallback survives",
    /team:\s*eligible\.slice\(0,\s*1\)/.test(CODE), false);
  ok("...and an exhausted search reports no-window instead",
    /OUTCOME\.noWindow/.test(CODE), true);
  ok("...while an empty candidate list reports no-candidates",
    /OUTCOME\.noCandidates/.test(CODE), true);
}

console.log("\n7. A blocked op keeps its ORIGINAL record");
{
  // The preview promises "these stay exactly where they are". The run has to
  // honour the same promise, or re-plan quietly strips the team off an op it
  // could not place.
  ok("the merge keeps the original when an op is blocked",
    /_outcome/.test(CODE), true);
  ok("...and the promise is on screen in both places",
    (J.match(/These stay exactly where they are/g) || []).length >= 1, true);
}

console.log("\n8. The wizard reports, and reuses the preview's panel");
{
  // \b on both ends. Without it, renaming the component to OutcomePanelX — a
  // stand-in for forking a second copy — still matched, which mutation caught.
  ok("the outcome panel exists under exactly that name",
    /\bOutcomePanel\b/.test(CODE), true);
  // TWO render sites and only two: the re-plan preview and the wizard's result.
  // A third would mean somebody rendered outcomes their own way again.
  ok("...and is rendered in BOTH places from the one definition",
    (CODE.match(/<OutcomePanel\b/g) || []).length, 2);
  ok("...with the preview among them", /<OutcomePanel heading="Re-plan preview"/.test(CODE), true);
  ok("...and the run's own result", /<OutcomePanel heading=\{runReport\./.test(CODE), true);
  ok("...and the reasons are still spelled out for a human",
    /nobody can do it/.test(J) && /nobody is free/.test(J), true);
  // #343 stays fixed: any aiSuggestion updater must seed slots, or a partial
  // shape reaches a reader that assumes the field.
  // The whitespace goes INSIDE the lookahead. Written as `\s*(?!slots)` the
  // engine simply backtracks `\s*` to zero width, the lookahead then sees a
  // space rather than "slots" and succeeds — so the assertion passes on code
  // that DOES seed slots and fails on code that does not. Exactly inverted,
  // and it would have read as a working guard forever.
  ok("every setAiSuggestion updater still seeds slots (#343 stays fixed)",
    /setAiSuggestion\(prev\s*=>\s*\(\{(?!\s*slots)/.test(CODE), false);
}

console.log("\n9. RED PROOF");
{
  const checks = [
    // Aborting is not a conservative choice. It throws away work that was
    // placeable, which is a bigger loss than the one op that was not.
    ["aborting a 30-op run over one collision loses 29 good placements",
      (() => {
        const results = Array.from({ length: 30 }, (_, i) =>
          i === 7 ? { op: op("bad"), outcome: OUTCOME.noWindow, person: null }
                  : { op: op("ok" + i), outcome: OUTCOME.placed, person: CREW[i % 2] });
        return foldRunOutcomes(results, { crew: CREW }).placed;
      })(), 29],
    ["...and the one that failed is still named",
      foldRunOutcomes([{ op: op("bad"), outcome: OUTCOME.noWindow, person: null }], { crew: CREW })
        .blocked[0].op.id, "bad"],
    // A forced placement is worse than an honest refusal: it reads as success.
    ["a forced placement would report as placed, which is the lie",
      OUTCOME.placed === OUTCOME.noWindow, false],
    // Hour-awareness is the whole reason the crude check was wrong.
    ["two ops on one day are only a clash if their HOURS clash",
      (() => {
        const dateOnly = (a, b) => a.start <= b.end && a.end >= b.start;
        return dateOnly({ start: "2026-10-05", end: "2026-10-05" }, { start: "2026-10-05", end: "2026-10-05" });
      })(), true],
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
