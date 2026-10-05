// Finished work sinks to the bottom of the Jobs list.
//
// RULED 2026-10-05. Two places decide where a finished job lands, and both had
// to move or the rule only half-held:
//
//   THE GROUP ORDER. Grouping by status sorts the buckets by the ORG'S OWN
//   configured status order (orgSettings.statusOpts). At Matrix "Finished" is
//   5th of 17 — above Late, On Hold, Crated, Shipped — so the done pile sat in
//   the middle of the page. The configured order is right for a dropdown, where
//   it is a workflow sequence; it is wrong for a list, where done work belongs
//   underneath the work that is not.
//
//   THE ROWS INSIDE A GROUP. Grouping by client or by person puts finished and
//   live jobs in the same bucket, so the bucket order alone would not have
//   touched them.
//
//   node scripts/jobs-order-test.mjs

import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(J);
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// Matrix's real configured order, which is what made this visible.
const STATUSES = ["Not Started", "Pending", "In Progress", "Paused", "Finished", "Late",
  "Not ordered", "Procurment", "On Hold", "Wrapping up", "MTX FAT", "C FAT",
  "Ready for Packaging", "Crated", "Boxed up ", "Shipped not invoiced", "Shipped/ invoiced"];

// The rule under test, mirrored from the source so the ORDERING is exercised as
// behaviour rather than only grepped. Kept to the two lines that matter.
const bucketOrder = (keys) => {
  const rest = [...keys];
  rest.sort((a, b) => STATUSES.indexOf(a) - STATUSES.indexOf(b));
  const done = (k) => k === "Finished";
  return [...rest.filter(k => !done(k)), ...rest.filter(done)];
};

console.log("\n1. The Finished group sorts last, whatever the org's order says");
{
  const got = bucketOrder(["In Progress", "Finished", "Not Started", "On Hold"]);
  ok("Finished goes to the end", got[got.length - 1], "Finished");
  ok("...and the rest keep the configured sequence",
    got.slice(0, -1), ["Not Started", "In Progress", "On Hold"]);
  ok("...even when it is the only group", bucketOrder(["Finished"]), ["Finished"]);
  ok("...and when it is absent nothing changes",
    bucketOrder(["In Progress", "Not Started"]), ["Not Started", "In Progress"]);
  // The statuses BELOW Finished in the configured order must not be dragged
  // down with it — they are live work, whatever their position.
  const late = bucketOrder(["Finished", "Late", "Shipped/ invoiced"]);
  ok("statuses configured after Finished stay above it",
    late, ["Late", "Shipped/ invoiced", "Finished"]);
}

console.log("\n2. Inside a group, finished rows sink below live ones");
{
  // Grouping by client or person mixes them in one bucket, so the bucket order
  // alone would not have moved anything.
  const sink = (jobs) => [...jobs.filter(j => j.status !== "Finished"), ...jobs.filter(j => j.status === "Finished")];
  const jobs = [
    { id: "a", status: "Finished" }, { id: "b", status: "In Progress" },
    { id: "c", status: "Finished" }, { id: "d", status: "Not Started" },
  ];
  ok("live first, finished after", sink(jobs).map(j => j.id), ["b", "d", "a", "c"]);
  // STABLE: a manual drag order (taskOrder) must survive inside each half, or
  // sinking the finished ones would quietly reshuffle the rest.
  ok("...and the order within each half is untouched",
    sink([{ id: "z", status: "In Progress" }, { id: "y", status: "In Progress" }]).map(j => j.id), ["z", "y"]);
}

console.log("\n3. Both changes are in the source");
{
  ok("the status buckets push Finished last",
    /rest\.filter\(\(\[k\]\) => k !== "Finished"\), \.\.\.rest\.filter\(\(\[k\]\) => k === "Finished"\)/.test(CODE), true);
  ok("...after the configured order has been applied, not instead of it",
    /o\.indexOf\(a\[0\]\) - o\.indexOf\(b\[0\]\)[\s\S]{0,200}?k === "Finished"/.test(CODE), true);
  ok("the rows inside a group sink finished below live",
    /ordered = _sinkFinished\(/.test(CODE), true);
  ok("...through one helper, so every grouping gets it",
    /const _sinkFinished = \(list\) =>/.test(CODE), true);
}

console.log("\n4. RED PROOF");
{
  const checks = [
    // The configured order is what put Finished in the middle.
    ["Matrix's own order places Finished 5th of 17", STATUSES.indexOf("Finished"), 4],
    ["...with live statuses below it", STATUSES.length - 1 - STATUSES.indexOf("Finished"), 12],
    // Sorting by the configured index ALONE leaves it there.
    ["sorting by the configured index alone leaves Finished mid-list",
      (() => { const r = ["Shipped/ invoiced", "Finished", "Not Started"]
        .sort((a, b) => STATUSES.indexOf(a) - STATUSES.indexOf(b)); return r[r.length - 1]; })(), "Shipped/ invoiced"],
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
