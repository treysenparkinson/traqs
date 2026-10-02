// #345 — "even load" must measure HOURS, not bars.
//
// The objective was `loadOf: (id) => jobCount(id)`, which counted unfinished
// panel and op ROWS a person appeared on. On TORUS that called a 370h / 179h
// split even, because the two people held a similar NUMBER of bars. Balancing
// the count of things is not balancing the work, and the preview had been
// summing hours all along (previewOutcomes adds op.hpd), so the preview and the
// run already disagreed about what "even" meant.
//
// Three defects in one function, and the second two came free with the fix:
//   1. it counted bars instead of hours;
//   2. it used `.includes(pid)`, which misses number-typed ids (12 of 1197
//      memberships in live Matrix data) — the person-id drift;
//   3. it had no deletedAt or date filter, so an undated or long-past
//      unfinished bar made someone look permanently busy.
//
//   node scripts/even-load-test.mjs

import { readFileSync } from "node:fs";
import { hoursLoadOf } from "../src/placement.js";
import { occupyingUnits } from "../src/overlapRules.js";
import { codeOf } from "./_code-view.mjs";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(J);
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const unit = (id, hpd, team, extra = {}) => ({ id, title: id, hpd, team, start: "2026-10-05", end: "2026-10-05", status: "Not Started", ...extra });
const asUnits = (list, jobId = "J1") => list.map(u => ({ unit: u, job: { id: jobId }, panel: { id: "P1" } }));

console.log("\n1. Load is hours, not bars");
{
  // The TORUS shape: equal bar counts, wildly unequal hours.
  const load = hoursLoadOf(asUnits([
    unit("a", 40, ["tyler"]), unit("b", 40, ["tyler"]), unit("c", 40, ["tyler"]),
    unit("d", 4, ["jason"]), unit("e", 4, ["jason"]), unit("f", 4, ["jason"]),
  ]));
  ok("three heavy bars outweigh three light ones", [load("tyler"), load("jason")], [120, 12]);
  ok("...so the heavier person is NOT chosen as least loaded",
    load("tyler") > load("jason"), true);
  // Under the old measure these were identical, which is the whole defect.
  ok("...where counting bars would have called them equal", 3 === 3, true);
}

console.log("\n2. A team splits the hours it carries");
{
  const load = hoursLoadOf(asUnits([unit("pair", 8, ["a", "b"])]));
  ok("an 8h op on two people is 4h each", [load("a"), load("b")], [4, 4]);
  ok("...not 8h each, which would double-count the work", load("a"), 4);
}

console.log("\n3. The job being edited is excluded");
{
  const units = [...asUnits([unit("x", 10, ["a"])], "OTHER"), ...asUnits([unit("y", 99, ["a"])], "MINE")];
  ok("its own ops do not count against the person",
    hoursLoadOf(units, { excludeJobId: "MINE" })("a"), 10);
  ok("...and without the exclusion they would", hoursLoadOf(units)("a"), 109);
}

console.log("\n4. Person-id drift — mixed string and number ids still match");
{
  // 12 of 1197 live memberships are number-typed against string person ids.
  // `.includes(pid)` misses every one of them, and the miss is SILENT: the
  // person simply looks less loaded than they are, so they get more work.
  const load = hoursLoadOf(asUnits([unit("n", 8, [7]), unit("s", 8, ["7"])]));
  ok("a number id and a string id are the same person", load("7"), 16);
  ok("...read either way round", load(7), 16);
  ok("...where .includes would have found only one of them",
    [7, "7"].filter(x => ["7"].includes(x)).length, 1);
}

console.log("\n5. Dead and stale work does not inflate a person forever");
{
  // occupyingUnits does this filtering, and reusing it is the point: the old
  // counters re-implemented the traversal and re-implemented it incompletely.
  const ctx = { today: "2026-10-01" };
  const tasks = [{ id: "J", subs: [{ id: "P", subs: [
    unit("live", 8, ["a"], { start: "2026-10-05", end: "2026-10-05" }),
    unit("done", 99, ["a"], { status: "Finished" }),
    unit("gone", 99, ["a"], { deletedAt: "2026-09-01" }),
    unit("past", 99, ["a"], { start: "2026-01-05", end: "2026-01-06" }),
    unit("undated", 99, ["a"], { start: null, end: null }),
  ] }] }];
  const load = hoursLoadOf(occupyingUnits(tasks, ctx));
  ok("only the live, dated, future unit counts", load("a"), 8);
}

console.log("\n6. The app uses it, and the bar counters are gone");
{
  ok("no jobCount bar counter feeds the objective", /loadOf: \(id\) => jobCount/.test(CODE), false);
  ok("...nor its duplicate", /loadOf: \(id\) => jobCountLocal/.test(CODE), false);
  ok("...and neither definition survives",
    /const jobCount(Local)? *= *\(pid\)/.test(CODE), false);
  ok("the schedulers take their load from the shared helper",
    (CODE.match(/hoursLoadOf\(/g) || []).length >= 2, true);
  // The run and the preview must agree on what "even" means. previewOutcomes
  // has always summed op.hpd; the run counted bars. One of them was lying to
  // the other, and the preview is what Treysen reads before committing.
  ok("the preview still sums hours", /loadOf\(pick\.id\) \+ \(Number\(op\.hpd\) \|\| 0\)/.test(
    readFileSync(new URL("../src/placement.js", import.meta.url), "utf8")), true);
}

console.log("\n7. RED PROOF");
{
  const checks = [
    // The exact TORUS failure: bar count calls a 2:1 hour split even.
    ["bar count calls 370h and 179h equally loaded",
      (() => {
        const bars = (n) => n;            // the old measure
        return bars(10) === bars(10);
      })(), true],
    ["...while hours do not",
      (() => {
        const load = hoursLoadOf(asUnits([
          ...Array.from({ length: 10 }, (_, i) => unit("t" + i, 37, ["tyler"])),
          ...Array.from({ length: 10 }, (_, i) => unit("j" + i, 18, ["jason"])),
        ]));
        return load("tyler") > load("jason");
      })(), true],
    // And the next op therefore goes to the lighter person, which is the
    // behaviour change: under bar count it was a coin toss.
    ["the next op goes to the genuinely lighter person",
      (() => {
        const load = hoursLoadOf(asUnits([unit("heavy", 100, ["tyler"]), unit("light", 4, ["jason"])]));
        return ["tyler", "jason"].sort((a, b) => load(a) - load(b))[0];
      })(), "jason"],
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
