// Worked SPANS — the record of when an op was worked.
//
// Structured after scripts/live-hours-test.mjs: values are asserted, and then the assertions
// are shown to FAIL against a deliberately wrong implementation. A test that has only ever
// been green says nothing about whether it can discriminate, which is the same trap as a build
// check that has never gone red.
//
//   node scripts/worked-spans-test.mjs

import { workedSpansByOp, mergeSpans, spansToPct, pushedBarRange, spansDurationMs } from "../src/statsMath.js";

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

// ── pushedBarRange ───────────────────────────────────────────────────────
// The push rule: where a bar sits once the clock has moved past work nobody did.

const H = 3600000;
const pr = (o) => {
  const r = pushedBarRange(o);
  return [r.startMs, r.remainderStartMs, r.endMs, r.pushedMs];
};

eq("before its window opens, nothing moves — Thursday's bar is not late on Tuesday",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 0, nowMs: T(8) }),
  [T(9), T(9), T(17), 0]);
eq("exactly at the planned start, nothing has been missed yet",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 0, nowMs: T(9) }),
  [T(9), T(9), T(17), 0]);
eq("untouched and an hour late: the whole block slides, duration intact",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 0, nowMs: T(10) }),
  [T(9), T(10), T(18), 1 * H]);
eq("half worked: the remainder resumes at the cursor and only the remainder is left",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 4 * H, nowMs: T(14) }),
  [T(9), T(14), T(18), 1 * H]);
eq("fully worked: nothing left to push, planned extent kept",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 8 * H, nowMs: T(20) }),
  [T(9), T(17), T(17), 0]);
eq("worked MORE than planned does not invert the bar — overrun is Q7a's, not a negative remainder",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 20 * H, nowMs: T(20) }),
  [T(9), T(17), T(17), 0]);
eq("the left edge never moves: history stays where it happened",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 2 * H, nowMs: T(16) })[0], T(9));
eq("a degenerate window is returned untouched rather than divided by",
  pr({ plannedStartMs: T(9), plannedEndMs: T(9), workedMs: 0, nowMs: T(12) }),
  [T(9), T(9), T(9), 0]);
eq("an inverted window is returned untouched rather than 'fixed' into something plausible",
  pr({ plannedStartMs: T(17), plannedEndMs: T(9), workedMs: 0, nowMs: T(12) }),
  [T(17), T(17), T(9), 0]);
eq("a missing now does not silently push to 1970",
  pr({ plannedStartMs: T(9), plannedEndMs: T(17), workedMs: 0, nowMs: undefined }),
  [T(9), T(9), T(17), 0]);

eq("spansDurationMs sums merged spans", spansDurationMs([[T(9), T(11)], [T(13), T(14)]]), 3 * H);
eq("spansDurationMs of nothing is nothing", spansDurationMs([]), 0);

// RED PROOF for the push: the plausible wrong rule is "slide by how late you are", which is
// right for an untouched op and wrong the moment any work exists — it double-counts the worked
// portion and pushes the end an extra four hours in the half-worked case above.
const naivePush = ({ plannedStartMs, plannedEndMs, nowMs }) => {
  const late = Math.max(0, nowMs - plannedStartMs);
  return [plannedStartMs, plannedStartMs + late, plannedEndMs + late, late];
};
const pushRed = naivePush({ plannedStartMs: T(9), plannedEndMs: T(17), nowMs: T(14) });
if (JSON.stringify(pushRed) === JSON.stringify([T(9), T(14), T(18), 1 * H])) {
  console.error("RED PROOF FAILED: the half-worked case does not distinguish the push rule from sliding by lateness");
  process.exitCode = 1;
} else {
  console.log("red proof: the half-worked case rejects a push that slides by lateness alone");
}

// ── complementSpans ──────────────────────────────────────────────────────
// The idle layer needs the gaps, not a boundary: idle is everything left of the cursor that
// was not worked, which can be several intervals rather than one.
const { complementSpans } = await import("../src/statsMath.js");

eq("no work means the whole window is idle", complementSpans([]), [[0, 100]]);
eq("a span in the middle leaves a gap either side", complementSpans([[40, 60]]), [[0, 40], [60, 100]]);
eq("a span at the left edge leaves only the right gap", complementSpans([[0, 30]]), [[30, 100]]);
eq("a span at the right edge leaves only the left gap", complementSpans([[70, 100]]), [[0, 70]]);
eq("a full-width span leaves no gap at all", complementSpans([[0, 100]]), []);
eq("two spans leave three gaps", complementSpans([[20, 30], [60, 70]]), [[0, 20], [30, 60], [70, 100]]);
eq("touching spans do not emit a zero-width gap between them", complementSpans([[20, 40], [40, 60]]), [[0, 20], [60, 100]]);
eq("spans are clipped to the window before complementing", complementSpans([[-20, 30]]), [[30, 100]]);
eq("a custom window is respected", complementSpans([[40, 60]], 0, 80), [[0, 40], [60, 80]]);
eq("the late-start case: idle BEFORE the hatch, which extent can never produce",
  complementSpans([[75, 87.5]]), [[0, 75], [87.5, 100]]);



// ── productiveHoursBetween ───────────────────────────────────────────────
// Local time throughout, matching hourTs. Dates below are LOCAL so the assertions do not
// drift with the runner timezone.
const { productiveHoursBetween } = await import("../src/statsMath.js");

const L = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
// Mon 2026-09-21 .. Fri 2026-09-25 are weekdays; Sat/Sun 26-27 are not.
const CFG = { workStartH: 8, workEndH: 16, deadWindows: [{ start: 12, dur: 1 }], workDays: [1,2,3,4,5], holidays: [] };

eq("a morning inside one day, no lunch reached", productiveHoursBetween(L(2026,9,21,9), L(2026,9,21,11), CFG), 2);
eq("a span crossing lunch loses the lunch hour", productiveHoursBetween(L(2026,9,21,11), L(2026,9,21,14), CFG), 2);
eq("a whole working day is the day minus lunch", productiveHoursBetween(L(2026,9,21,8), L(2026,9,21,16), CFG), 7);
eq("before work does not count", productiveHoursBetween(L(2026,9,21,5), L(2026,9,21,8), CFG), 0);
eq("after work does not count", productiveHoursBetween(L(2026,9,21,16), L(2026,9,21,23), CFG), 0);
eq("overnight counts neither night", productiveHoursBetween(L(2026,9,21,15), L(2026,9,22,9), CFG), 2);
eq("Friday lunchtime to Monday morning is hours, not days",
  productiveHoursBetween(L(2026,9,25,13), L(2026,9,28,9), CFG), 4);
eq("a weekend on its own is nothing", productiveHoursBetween(L(2026,9,26,0), L(2026,9,28,0), CFG), 0);
eq("a holiday is skipped like a weekend",
  productiveHoursBetween(L(2026,9,22,8), L(2026,9,23,16), { ...CFG, holidays: ["2026-09-22"] }), 7);
eq("backwards is zero, not negative", productiveHoursBetween(L(2026,9,21,14), L(2026,9,21,9), CFG), 0);
eq("equal instants are zero", productiveHoursBetween(L(2026,9,21,9), L(2026,9,21,9), CFG), 0);
eq("a non-finite bound is zero rather than NaN", productiveHoursBetween(NaN, L(2026,9,21,9), CFG), 0);
eq("an inverted working day yields zero rather than negative hours",
  productiveHoursBetween(L(2026,9,21,9), L(2026,9,21,15), { ...CFG, workStartH: 16, workEndH: 8 }), 0);
eq("a partial lunch overlap deducts only the part reached",
  productiveHoursBetween(L(2026,9,21,11), L(2026,9,21,12,30), CFG), 1);

// RED PROOF: the plausible wrong implementation is wall-clock elapsed, which agrees on a
// simple morning and is wildly wrong across a weekend -- the case the push rule depends on.
const wallClock = (a, b) => (b - a) / 3600000;
if (wallClock(L(2026,9,25,13), L(2026,9,28,9)) === 4) {
  console.error("RED PROOF FAILED: the Friday-to-Monday case does not distinguish productive hours from wall clock");
  process.exitCode = 1;
} else {
  console.log("red proof: the weekend case rejects wall-clock elapsed");
}

// Summary LAST. This block has been stranded mid-file twice by appending a new section
// after it -- the run stayed green while the new assertions never executed, which is the
// same green-and-blind failure the red proofs exist to catch. If you add a section, add it
// ABOVE this line.
console.log(`${pass} passed, ${fail} failed (cumulative)`);
process.exit(fail === 0 && redOk && !process.exitCode ? 0 : 1);