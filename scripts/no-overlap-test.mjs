// No overlap — the shared predicate every placement path asks.
//
// The invariant is hard: two ops on one row may never occupy the same time. These are the
// functions that define what that means, so a disagreement here is a disagreement everywhere.
//
//   node scripts/no-overlap-test.mjs

import { opInterval, intervalsOverlap, rowOverlaps, firstFreeStart, dayHourMs } from "../src/statsMath.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};

const CFG = { workStartH: 8, workEndH: 16 };
const H = 3600000;
const op = (id, start, end, o = {}) => ({ id, start, end, ...o });
const at = (ds, h) => dayHourMs(ds, h);
const names = (pairs) => pairs.map((p) => [p.a.id, p.b.id].sort().join("+")).sort();

// ── opInterval ───────────────────────────────────────────────────────────
eq("a multi-day op runs to the end of the working day",
  opInterval(op("a", "2026-09-21", "2026-09-22"), CFG),
  { s: at("2026-09-21", 8), e: at("2026-09-22", 16) });
eq("an explicit start hour is honoured",
  opInterval(op("a", "2026-09-21", "2026-09-21", { startHour: 10, endHour: 12 }), CFG),
  { s: at("2026-09-21", 10), e: at("2026-09-21", 12) });
eq("a single-day op with no endHour ends at start plus its duration",
  opInterval(op("a", "2026-09-21", "2026-09-21", { startHour: 9, durationH: 3 }), CFG),
  { s: at("2026-09-21", 9), e: at("2026-09-21", 12) });
eq("...and is capped at the end of the working day",
  opInterval(op("a", "2026-09-21", "2026-09-21", { startHour: 14, durationH: 9 }), CFG),
  { s: at("2026-09-21", 14), e: at("2026-09-21", 16) });
eq("an op with no dates has no interval", opInterval(op("a", null, null), CFG), null);

// ── the predicate ────────────────────────────────────────────────────────
const iv = (a, b) => ({ s: a, e: b });
eq("plain overlap", intervalsOverlap(iv(0, 10), iv(5, 15)), true);
eq("containment", intervalsOverlap(iv(0, 20), iv(5, 15)), true);
eq("TOUCHING end-to-start is adjacency, not overlap", intervalsOverlap(iv(0, 10), iv(10, 20)), false);
eq("disjoint", intervalsOverlap(iv(0, 5), iv(10, 20)), false);
eq("order does not matter", intervalsOverlap(iv(10, 20), iv(0, 15)), true);

// ── rowOverlaps ──────────────────────────────────────────────────────────
eq("a clean row reports nothing",
  names(rowOverlaps([op("a", "2026-09-21", "2026-09-21", { startHour: 8, endHour: 12 }),
                     op("b", "2026-09-21", "2026-09-21", { startHour: 12, endHour: 16 })], CFG)), []);
eq("same day, different hours is NOT a clash — the reason dates alone are the wrong test",
  names(rowOverlaps([op("a", "2026-09-21", "2026-09-21", { startHour: 8, endHour: 12 }),
                     op("b", "2026-09-21", "2026-09-21", { startHour: 13, endHour: 16 })], CFG)), []);
eq("two multi-day ops offset by a day DO clash — the shape the real data is full of",
  names(rowOverlaps([op("a", "2026-09-21", "2026-09-23"), op("b", "2026-09-22", "2026-09-24")], CFG)),
  ["a+b"]);
eq("three mutually overlapping ops report all three pairs",
  names(rowOverlaps([op("a", "2026-09-21", "2026-09-24"), op("b", "2026-09-22", "2026-09-25"),
                     op("c", "2026-09-23", "2026-09-26")], CFG)),
  ["a+b", "a+c", "b+c"]);
eq("a zero-width op cannot clash with anything",
  names(rowOverlaps([op("a", "2026-09-21", "2026-09-21", { startHour: 10, endHour: 10 }),
                     op("b", "2026-09-21", "2026-09-21", { startHour: 8, endHour: 16 })], CFG)), []);
eq("an undated op is ignored rather than crashing the check",
  names(rowOverlaps([op("a", null, null), op("b", "2026-09-21", "2026-09-21")], CFG)), []);

// ── firstFreeStart ───────────────────────────────────────────────────────
eq("an empty row leaves the desired start alone", firstFreeStart(100, 50, []), 100);
eq("a free slot is not moved — placing work later than it must be is its own error",
  firstFreeStart(100, 50, [iv(200, 300)]), 100);
eq("a collision slides to the end of what it hit", firstFreeStart(100, 50, [iv(80, 160)]), 160);
eq("it keeps sliding through a run of back-to-back blocks",
  firstFreeStart(100, 50, [iv(80, 160), iv(160, 240), iv(240, 260)]), 260);
eq("it stops at the first gap big enough",
  firstFreeStart(100, 50, [iv(80, 160), iv(400, 500)]), 160);
eq("touching the end of a block is allowed", firstFreeStart(160, 50, [iv(80, 160)]), 160);
eq("unsorted occupancy is handled", firstFreeStart(100, 50, [iv(240, 260), iv(80, 160), iv(160, 240)]), 260);
eq("a zero duration is returned unchanged rather than looping", firstFreeStart(100, 0, [iv(80, 160)]), 100);

// ── RED PROOFS ───────────────────────────────────────────────────────────
// Each names the plausible wrong implementation and asserts the suite rejects it.
let redOk = true;
const red = (label, wrongResult, rightResult) => {
  if (JSON.stringify(wrongResult) === JSON.stringify(rightResult)) {
    redOk = false;
    console.error(`RED PROOF FAILED: ${label}`);
  } else console.log(`red proof: ${label}`);
};
// 1. Inclusive bounds. The obvious `<=` treats adjacency as overlap, which would refuse every
//    correctly packed row — a guard that fires on the good case gets switched off.
red("adjacency is rejected as overlap by an inclusive comparison",
  (0 <= 20 && 10 <= 10), intervalsOverlap(iv(0, 10), iv(10, 20)));
// 2. Date-only comparison. Ignores hours, so two ops sharing a day always clash.
const dateOnly = (a, b) => a.start <= b.end && b.start <= a.end;
red("a date-only comparison flags same-day non-overlapping ops",
  dateOnly({ start: "2026-09-21", end: "2026-09-21" }, { start: "2026-09-21", end: "2026-09-21" }), false);
// 3. A slot finder that always appends rather than reusing the requested position.
const alwaysAppend = (d, dur, occ) => Math.max(d, ...occ.map((x) => x.e));
red("a slot finder that always appends moves work that did not need moving",
  alwaysAppend(100, 50, [iv(200, 300)]), firstFreeStart(100, 50, [iv(200, 300)]));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && redOk ? 0 : 1);
