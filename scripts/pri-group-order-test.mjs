// #543 — the Jobs grid's priority GROUPS follow the org's priority order.
//
// `sortBuckets` ordered priority groups by a hardcoded ["High", "Medium", "Low"].
// Priorities are the org's list (`orgSettings.priOpts`); Matrix's carries "On time"
// and "Late", which `indexOf` put at -1 — above High. The column sort beside it
// already reads `PRIORITIES`; the grouping now does too, as status grouping reads
// `STATUSES`.
//
// Executes the REAL `sortBuckets`, sliced out of TRAQS.jsx and compiled with its
// free variables injected — not a mirror of it.
//
//   node scripts/pri-group-order-test.mjs

import { readFileSync } from "node:fs";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const HEAD = "const sortBuckets = (colKey, entries) => {";
const TAIL = "return [...rest, ...empties];";
const count = J.split(HEAD).length - 1;
if (count !== 1) { console.error(`sortBuckets anchor found ${count} times, want 1`); process.exit(2); }
const at = J.indexOf(HEAD);
const end = J.indexOf(TAIL, at);
if (end < 0 || end - at > 4000) { console.error("sortBuckets body not found"); process.exit(2); }
const body = J.slice(at + HEAD.length, end + TAIL.length);

const make = (PRIORITIES, STATUSES = ["Not Started", "In Progress", "Finished"]) =>
  new Function("PRIORITIES", "STATUSES", "isFinished",
    `return (colKey, entries) => {${body}};`)(PRIORITIES, STATUSES, (s) => s === "Finished");

const groups = (sortBuckets, keys) =>
  sortBuckets("pri", keys.map(k => [k, { label: k }])).map(([k]) => k);

console.log("\n1. Priority groups follow the org's order");
{
  const matrix = make(["Late", "On time", "High", "Medium", "Low"]);
  ok("org-only values sort where the org put them, not above High",
    groups(matrix, ["High", "On time", "Low", "Late"]), ["Late", "On time", "High", "Low"]);
  ok("the empty group still goes last",
    groups(matrix, ["__empty__", "Low", "Late"]), ["Late", "Low", "__empty__"]);
}

console.log("\n2. The default list orders as the column sort does");
{
  const dflt = make(["Low", "Medium", "High"]);
  ok("Low, Medium, High — PRIORITIES' order, same as sortTasks",
    groups(dflt, ["High", "Low", "Medium"]), ["Low", "Medium", "High"]);
}

console.log("\n3. Status grouping is untouched (sanity: the slice is the real function)");
{
  const s = make(["Low"]);
  ok("Finished sinks last", s("status", [["Finished", {}], ["Not Started", {}], ["In Progress", {}]]).map(([k]) => k),
    ["Not Started", "In Progress", "Finished"]);
}

// #471, ruled 2026-10-15: "sort by the org's priority ORDER, as #543 did for grouping". The
// column sort already did — it keys on PRI_ORDER, which IS the org's PRIORITIES (priOpts order).
// Held here so the sort and the grouping cannot drift onto different orders again.
{
  const Jn = J.replace(/\r\n/g, "\n");
  ok("#471 the Jobs-list priority sort uses the org's own order", /const PRI_ORDER = PRIORITIES;/.test(Jn) && /pri:\s*t => PRI_ORDER\.indexOf\(/.test(Jn), true);
  ok("#471 ...which is the org's priOpts list", /const PRIORITIES = useMemo\(\(\) => priOpts\.map\(o => o\.name\)/.test(Jn), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass === 0) process.exit(2);
process.exit(fail ? 1 : 0);
