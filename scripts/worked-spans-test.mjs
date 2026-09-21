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

// ── workedSpansForPerson ─────────────────────────────────────────────────
// A row belongs to a person, so cross-row work is per person rather than per op.
const { workedSpansForPerson } = await import("../src/statsMath.js");

const sess = (personId, opId, a, b) => ({ personId, opId, clockIn: new Date(a).toISOString(), clockOut: new Date(b).toISOString() });

eq("only this person’s sessions come back",
  [...workedSpansForPerson([sess(1, "opA", T(9), T(10)), sess(2, "opA", T(11), T(12))], 1).entries()],
  [["opA", [[T(9), T(10)]]]]);
eq("a numeric id matches a string id, as everywhere else in this codebase",
  [...workedSpansForPerson([sess("1", "opA", T(9), T(10))], 1).entries()],
  [["opA", [[T(9), T(10)]]]]);
eq("two sittings on one op merge per person",
  [...workedSpansForPerson([sess(1, "opA", T(9), T(10)), sess(1, "opA", T(10), T(11))], 1).entries()],
  [["opA", [[T(9), T(11)]]]]);
eq("an open clock is passed in rather than read from the wall clock",
  [...workedSpansForPerson([], 1, new Map([["opB", [[T(13), T(14)]]]])).entries()],
  [["opB", [[T(13), T(14)]]]]);
eq("an open clock merges with the closed session it continues",
  [...workedSpansForPerson([sess(1, "opA", T(9), T(10))], 1, new Map([["opA", [[T(10), T(11)]]]])).entries()],
  [["opA", [[T(9), T(11)]]]]);
eq("no person, nothing", [...workedSpansForPerson([sess(1, "opA", T(9), T(10))], null).entries()], []);

// ── splitWorkedOp ────────────────────────────────────────────────────────
// The worked half is history and stays; the unworked half is what the admin is dragging.
// A remainder of zero must come back NULL rather than as a zero-width record -- that is the
// shape that inverts on write and destroyed tzf8ivwbh.
const { splitWorkedOp } = await import("../src/statsMath.js");

const sp = (o) => { const r = splitWorkedOp(o); return [r.keep && r.keep.hpd, r.remainder && r.remainder.hpd]; };

eq("half worked splits into two records", sp({ hpd: 8, workedMs: 4 * H }), [4, 4]);
eq("the kept half is locked", splitWorkedOp({ hpd: 8, workedMs: 4 * H }).keep.locked, true);
eq("untouched: nothing to keep, the whole op moves — an ordinary drag, not a split",
  sp({ hpd: 8, workedMs: 0 }), [null, 8]);
eq("fully worked: nothing left to move, and NO zero-width remainder is minted",
  sp({ hpd: 8, workedMs: 8 * H }), [8, null]);
eq("worked past the estimate still yields no negative remainder",
  sp({ hpd: 8, workedMs: 20 * H }), [8, null]);
eq("a sliver of float noise does not mint a remainder record",
  sp({ hpd: 8, workedMs: (8 - 0.0001) * H }), [8 - 0.0001, null]);
eq("a sliver of float noise does not mint a kept record either",
  sp({ hpd: 8, workedMs: 0.0001 * H }), [null, 8 - 0.0001]);
eq("team size divides the per-person durations but not the hour totals",
  (() => { const r = splitWorkedOp({ hpd: 8, workedMs: 4 * H, teamSize: 2 }); return [r.keep.hpd, r.perPersonKeepH, r.perPersonRemainderH]; })(),
  [4, 2, 2]);
eq("a zero-hour op splits into nothing at all", sp({ hpd: 0, workedMs: 0 }), [null, null]);

// RED PROOF: the plausible wrong implementation returns a record for both halves always,
// which looks right on the half-worked case and mints exactly the zero-width block §6b bans.
const naiveSplit = ({ hpd, workedMs }) => [ (workedMs || 0) / 3600000, hpd - (workedMs || 0) / 3600000 ];
if (JSON.stringify(naiveSplit({ hpd: 8, workedMs: 8 * H })) === JSON.stringify([8, null])) {
  console.error("RED PROOF FAILED: the fully-worked case does not reject a split that always returns two records");
  process.exitCode = 1;
} else {
  console.log("red proof: the fully-worked case rejects a split that always mints a remainder");
}

// ── openSessionEnd (Q7b) ─────────────────────────────────────────────────
// A clock nobody stopped must not accrue all night. The bound is the end of the day the
// clock STARTED on, and the fact it was applied is what flags the session unclosed.
const { openSessionEnd, endOfWorkingDayMs } = await import("../src/statsMath.js");

const DCFG = { workEndH: 16 };
const ose = (o) => { const r = openSessionEnd({ ...o, cfg: DCFG }); return [r.endMs, r.frozen, r.unclosed]; };

eq("end of the working day is that day at workEndH",
  endOfWorkingDayMs(L(2026, 9, 21, 9), DCFG), L(2026, 9, 21, 16));
eq("mid-day, still running: now, not frozen, not unclosed",
  ose({ clockInMs: L(2026, 9, 21, 9), nowMs: L(2026, 9, 21, 11) }),
  [L(2026, 9, 21, 11), false, false]);
eq("past shop close: capped at close, frozen, and flagged unclosed",
  ose({ clockInMs: L(2026, 9, 21, 9), nowMs: L(2026, 9, 21, 20) }),
  [L(2026, 9, 21, 16), true, true]);
eq("still open days later is ONE unclosed session from its own day, not a renewing one",
  ose({ clockInMs: L(2026, 9, 21, 9), nowMs: L(2026, 9, 24, 11) }),
  [L(2026, 9, 21, 16), true, true]);
eq("an explicit HELD freeze wins and is not an unclosed session",
  ose({ clockInMs: L(2026, 9, 21, 9), frozenAtMs: L(2026, 9, 21, 10), nowMs: L(2026, 9, 21, 20) }),
  [L(2026, 9, 21, 10), true, false]);
eq("a freeze stamp in the future cannot push the clock forward",
  ose({ clockInMs: L(2026, 9, 21, 9), frozenAtMs: L(2026, 9, 21, 23), nowMs: L(2026, 9, 21, 11) }),
  [L(2026, 9, 21, 11), true, false]);
eq("exactly at close is not yet over", ose({ clockInMs: L(2026, 9, 21, 9), nowMs: L(2026, 9, 21, 16) }),
  [L(2026, 9, 21, 16), false, false]);

// RED PROOF: the plausible wrong bound is the end of TODAY rather than of the day the clock
// started, which agrees on every same-day case and lets a Friday punch keep growing all
// weekend -- the exact case Q7b exists for.
const endOfToday = (nowMs) => { const d = new Date(nowMs); d.setHours(0,0,0,0); return d.getTime() + 16 * 3600000; };
if (endOfToday(L(2026, 9, 24, 11)) === L(2026, 9, 21, 16)) {
  console.error("RED PROOF FAILED: the days-later case does not distinguish the clock-in day from today");
  process.exitCode = 1;
} else {
  console.log("red proof: the days-later case rejects bounding by today instead of the clock-in day");
}

// ── workedSpansByPersonOp ──────────────────────────────
// The grouped form the schedule uses; must agree with the per-person one it replaces.
const { workedSpansByPersonOp } = await import("../src/statsMath.js");

const grouped = workedSpansByPersonOp([sess(1,"opA",T(9),T(10)), sess(1,"opA",T(10),T(11)), sess(2,"opB",T(9),T(10))]);
eq("grouped by person then op, merged", [...grouped.get("1").entries()], [["opA", [[T(9), T(11)]]]]);
eq("a second person is separate", [...grouped.get("2").entries()], [["opB", [[T(9), T(10)]]]]);
eq("it agrees with the per-person function it replaces",
  [...grouped.get("1").entries()],
  [...workedSpansForPerson([sess(1,"opA",T(9),T(10)), sess(1,"opA",T(10),T(11))], 1).entries()]);
eq("rows with no person are skipped", workedSpansByPersonOp([{ opId: "opA", clockIn: new Date(T(9)).toISOString(), clockOut: new Date(T(10)).toISOString() }]).size, 0);

// ── openSessionEnd, LUNCH ────────────────────────────────────────────────
// An open pause stops the hatch where the work stopped while the cursor carries on. That
// gap IS being on lunch; without it a bar on a break looked exactly like one being worked.

eq("lunch freezes the span at the moment the pause began",
  ose({ clockInMs: L(2026, 9, 21, 9), pausedAt: L(2026, 9, 21, 12), nowMs: L(2026, 9, 21, 14) }),
  [L(2026, 9, 21, 12), true, false]);
eq("a pause as an ISO string is parsed, since that is how the clock stores it",
  ose({ clockInMs: L(2026, 9, 21, 9), pausedAt: new Date(L(2026, 9, 21, 12)).toISOString(), nowMs: L(2026, 9, 21, 14) }),
  [L(2026, 9, 21, 12), true, false]);
eq("a pause is NOT an unclosed session — somebody is coming back from it",
  openSessionEnd({ clockInMs: L(2026, 9, 21, 9), pausedAt: L(2026, 9, 21, 12), nowMs: L(2026, 9, 21, 14), cfg: DCFG }).unclosed,
  false);
eq("HELD outranks an open pause: that one was asked for",
  ose({ clockInMs: L(2026, 9, 21, 9), pausedAt: L(2026, 9, 21, 12), frozenAtMs: L(2026, 9, 21, 10), nowMs: L(2026, 9, 21, 14) }),
  [L(2026, 9, 21, 10), true, false]);
eq("a pause stamped before the clock-in is ignored rather than rewinding the bar",
  ose({ clockInMs: L(2026, 9, 21, 9), pausedAt: L(2026, 9, 21, 7), nowMs: L(2026, 9, 21, 11) }),
  [L(2026, 9, 21, 11), false, false]);
eq("no pause, no freeze — normal running work still tracks the cursor",
  ose({ clockInMs: L(2026, 9, 21, 9), pausedAt: null, nowMs: L(2026, 9, 21, 11) }),
  [L(2026, 9, 21, 11), false, false]);

// Summary LAST. This block has been stranded mid-file twice by appending a new section
// after it -- the run stayed green while the new assertions never executed, which is the
// same green-and-blind failure the red proofs exist to catch. If you add a section, add it
// ABOVE this line.
console.log(`${pass} passed, ${fail} failed (cumulative)`);
process.exit(fail === 0 && redOk && !process.exitCode ? 0 : 1);