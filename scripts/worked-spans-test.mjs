// Worked SPANS — the record of when an op was worked.
//
// Structured after scripts/live-hours-test.mjs: values are asserted, and then the assertions
// are shown to FAIL against a deliberately wrong implementation. A test that has only ever
// been green says nothing about whether it can discriminate, which is the same trap as a build
// check that has never gone red.
//
//   node scripts/worked-spans-test.mjs

import { workedSpansByOp, mergeSpans, spansToPct } from "../src/statsMath.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
  return false;
};

const T = (h, m = 0) => Date.parse(`2026-09-21T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
const row = (o) => ({ opId: "op1", clockIn: new Date(o.a).toISOString(), clockOut: new Date(o.b).toISOString(), ...o.extra });

// ── mergeSpans ───────────────────────────────────────────────────────────
eq("disjoint spans stay separate", mergeSpans([[1, 2], [5, 6]]), [[1, 2], [5, 6]]);
eq("overlapping spans merge", mergeSpans([[1, 4], [3, 6]]), [[1, 6]]);
eq("touching spans merge", mergeSpans([[1, 3], [3, 5]]), [[1, 5]]);
eq("a contained span vanishes into its container", mergeSpans([[1, 9], [3, 5]]), [[1, 9]]);
eq("unsorted input is sorted", mergeSpans([[5, 6], [1, 2]]), [[1, 2], [5, 6]]);
eq("empty is empty", mergeSpans([]), []);
// Two people on one op is the case that matters: the op was worked once, and painting the
// union twice would compound the hatch alpha over the overlap.
eq("two workers on one op union rather than double",
  mergeSpans([[T(9), T(12)], [T(10), T(11)]]), [[T(9), T(12)]]);

// ── workedSpansByOp ──────────────────────────────────────────────────────
eq("a session becomes a span",
  [...workedSpansByOp([row({ a: T(9), b: T(10) })]).entries()],
  [["op1", [[T(9), T(10)]]]]);
eq("deletedAt rows are skipped, as producedHoursByScope skips them",
  [...workedSpansByOp([row({ a: T(9), b: T(10), extra: { deletedAt: "2026-09-21T00:00:00Z" } })]).entries()],
  []);
eq("a session with no clockOut is skipped rather than guessed at",
  [...workedSpansByOp([{ opId: "op1", clockIn: new Date(T(9)).toISOString() }]).entries()], []);
eq("an unparseable stamp is skipped",
  [...workedSpansByOp([{ opId: "op1", clockIn: "not a date", clockOut: new Date(T(9)).toISOString() }]).entries()], []);
eq("a backwards session is skipped", [...workedSpansByOp([row({ a: T(10), b: T(9) })]).entries()], []);
eq("a zero-length session is skipped", [...workedSpansByOp([row({ a: T(9), b: T(9) })]).entries()], []);
eq("rows without an opId are skipped",
  [...workedSpansByOp([{ opId: null, clockIn: new Date(T(9)).toISOString(), clockOut: new Date(T(10)).toISOString() }]).entries()], []);
eq("numeric and string opIds are the same op — ids are mixed types in this codebase",
  [...workedSpansByOp([
    { opId: 7, clockIn: new Date(T(9)).toISOString(), clockOut: new Date(T(10)).toISOString() },
    { opId: "7", clockIn: new Date(T(10)).toISOString(), clockOut: new Date(T(11)).toISOString() },
  ]).entries()],
  [["7", [[T(9), T(11)]]]]);

// ── spansToPct ───────────────────────────────────────────────────────────
const W0 = T(8), W1 = T(16); // an 08:00-16:00 planned window
eq("a span across the second half reads as the second half", spansToPct([[T(12), T(16)]], W0, W1), [[50, 100]]);
eq("the late-start case the ratio gets wrong", spansToPct([[T(14), T(15)]], W0, W1), [[75, 87.5]]);
eq("a span starting before the window clips to its left edge", spansToPct([[T(6), T(10)]], W0, W1), [[0, 25]]);
eq("a span running past the window clips to its right edge", spansToPct([[T(14), T(20)]], W0, W1), [[75, 100]]);
eq("a span entirely outside the window is dropped", spansToPct([[T(2), T(4)]], W0, W1), []);
eq("a degenerate window returns nothing rather than dividing by zero", spansToPct([[T(9), T(10)]], W0, W0), []);
eq("no spans, no output", spansToPct([], W0, W1), []);

// ── RED PROOF ────────────────────────────────────────────────────────────
// The assertions above are only worth their green if they can go red. A merge that simply
// sorts without unioning is the most plausible wrong implementation, and it is the one that
// would double-paint overlaps at compounding alpha.
const naiveMerge = (spans) => [...(spans || [])].sort((x, y) => x[0] - y[0]);
const redCases = [
  ["overlapping spans merge", [[1, 4], [3, 6]], [[1, 6]]],
  ["two workers on one op union rather than double", [[T(9), T(12)], [T(10), T(11)]], [[T(9), T(12)]]],
];
let caught = 0;
for (const [label, input, want] of redCases) {
  if (JSON.stringify(naiveMerge(input)) !== JSON.stringify(want)) caught++;
  else console.error(`RED PROOF FAILED: "${label}" passes against a merge that does not merge — it discriminates nothing`);
}
const redOk = caught === redCases.length;
if (redOk) console.log(`red proof: ${caught}/${redCases.length} assertions reject a non-merging implementation`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && redOk ? 0 : 1);
