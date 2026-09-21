// Row push — where bars land once earlier work has run long and the cursor has passed work
// nobody started. The pan-stability case is the point of this file: a previous version of this
// logic read the viewport-filtered bar list, so the push became a function of scroll position
// and bars jumped as you panned.
//
//   node scripts/row-push-test.mjs

import { rowPushHours } from "../src/statsMath.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};

// A 5-day business week starting Mon 2026-09-14, 7.5 productive hours a day, 8h-16h clock.
const DAYS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22"];
const diffBD = (a, b) => DAYS.indexOf(b) - DAYS.indexOf(a);
const CFG = { workStartH: 8, totalWorkH: 8, productiveHoursPerDay: 7.5, diffBD };
const op = (id, start, o = {}) => ({ id, start, startHour: 8, hpd: 7.5, teamSize: 1, workedHoursShown: 0, isFullyWorked: false, locked: false, ...o });
// rowPushHours returns { pushes, atCursor }: the hours, and which of them are pinned to now.
const asObj = (r) => Object.fromEntries([...r.pushes.entries()].map(([k, v]) => [k, Math.round(v * 100) / 100]));
const cursorSet = (r) => [...r.atCursor].sort();

// ── the cursor push ──────────────────────────────────────────────────────
eq("no cursor supplied, no cursor push",
  asObj(rowPushHours({ ops: [op("a", "2026-09-14")], nowDay: null, cfg: CFG })), {});
eq("cursor before the op: nothing moves",
  asObj(rowPushHours({ ops: [op("a", "2026-09-16")], nowDay: "2026-09-14", nowHour: 8, cfg: CFG })), {});
eq("cursor two days past an untouched op: it slides to the cursor",
  asObj(rowPushHours({ ops: [op("a", "2026-09-14")], nowDay: "2026-09-16", nowHour: 8, cfg: CFG })), { a: 15 });
eq("part of a day counts",
  asObj(rowPushHours({ ops: [op("a", "2026-09-14")], nowDay: "2026-09-14", nowHour: 12, cfg: CFG })), { a: 3.75 });
eq("a WORKED op does not slide — where it sits is a record, not a plan",
  asObj(rowPushHours({ ops: [op("a", "2026-09-14", { workedHoursShown: 2 })], nowDay: "2026-09-16", nowHour: 8, cfg: CFG })), {});
eq("a finished op does not slide",
  asObj(rowPushHours({ ops: [op("a", "2026-09-14", { isFullyWorked: true })], nowDay: "2026-09-16", nowHour: 8, cfg: CFG })), {});

// ── locks ────────────────────────────────────────────────────────────────
eq("a LOCKED op does not move, however far past it the cursor is",
  asObj(rowPushHours({ ops: [op("a", "2026-09-14", { locked: true })], nowDay: "2026-09-18", nowHour: 8, cfg: CFG })), {});
eq("a locked op still OCCUPIES its slot, so the op after it is pushed by it",
  asObj(rowPushHours({
    ops: [op("a", "2026-09-14", { locked: true, hpd: 15 }), op("b", "2026-09-15")],
    nowDay: null, cfg: CFG,
  })), { b: 7.5 });

// ── collision and cascade ────────────────────────────────────────────────
eq("an op that ran long pushes the next one",
  asObj(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 15 }), op("b", "2026-09-15")],
    nowDay: null, cfg: CFG,
  })), { b: 7.5 });
eq("idle time in between absorbs the overrun first",
  asObj(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 11 }), op("b", "2026-09-17")],
    nowDay: null, cfg: CFG,
  })), {});
eq("a collision cascades down the row",
  asObj(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 22.5 }), op("b", "2026-09-15"), op("c", "2026-09-16")],
    nowDay: null, cfg: CFG,
  // a occupies 0..22.5, so b lands at 22.5 and ends at 30; c was at 15 and must start at 30.
  })), { b: 15, c: 15 });
eq("the two causes compose: a cursor push cascades like any other",
  asObj(rowPushHours({
    ops: [op("a", "2026-09-14"), op("b", "2026-09-15")],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), { a: 15, b: 15 });

// ── CURSOR ANCHORING ─────────────────────────────────────────────────────
// An op pushed BY THE CURSOR is placed at a known instant, so the render sets its start
// directly instead of rebuilding it from `push`. That distinction is the fix for bars
// landing near the cursor rather than at it: `push` is in PRODUCTIVE hours and a start hour
// is a CLOCK hour, so reconstructing one from the other drifts by whatever lunch falls
// inside the span. Anything NOT in this set is placed by the old arithmetic, correctly,
// because its target is the end of the op before it rather than now.

eq("an untouched op pushed by the cursor is flagged for exact placement",
  cursorSet(rowPushHours({ ops: [op("a", "2026-09-14")], nowDay: "2026-09-16", nowHour: 12, cfg: CFG })), ["a"]);
eq("an op pushed only by a COLLISION is not cursor-anchored",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 15 }), op("b", "2026-09-15")],
    nowDay: null, cfg: CFG,
  })), []);
eq("a worked op is never cursor-anchored — its position is a record",
  cursorSet(rowPushHours({ ops: [op("a", "2026-09-14", { workedHoursShown: 2 })], nowDay: "2026-09-18", nowHour: 8, cfg: CFG })), []);
eq("a LOCKED op is not cursor-anchored, however far past it the cursor is",
  cursorSet(rowPushHours({ ops: [op("a", "2026-09-14", { locked: true })], nowDay: "2026-09-18", nowHour: 8, cfg: CFG })), []);
eq("when a collision pushes an op FURTHER than the cursor would, it is not cursor-anchored",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 30 }), op("b", "2026-09-15")],
    nowDay: "2026-09-15", nowHour: 8, cfg: CFG,
  // Neither is anchored: a has been worked, and b is moved further by the collision than the
  // cursor would have moved it, so its target is the end of a rather than now.
  })), []);

// ── PAN STABILITY ────────────────────────────────────────────────────────
// The regression this file exists for. The same row, computed three times; the only thing
// that differs between runs is which bars a viewport would have shown. The function is given
// every op each time, so the answer must not move.
const ROW = [
  op("a", "2026-09-14", { workedHoursShown: 22.5 }),
  op("b", "2026-09-15"),
  op("c", "2026-09-17"),
  op("d", "2026-09-21"),
];
const full = asObj(rowPushHours({ ops: ROW, nowDay: "2026-09-15", nowHour: 8, cfg: CFG }));
eq("pan window 1 (Sep 14-16)", asObj(rowPushHours({ ops: ROW, nowDay: "2026-09-15", nowHour: 8, cfg: CFG })), full);
eq("pan window 2 (Sep 16-18)", asObj(rowPushHours({ ops: ROW, nowDay: "2026-09-15", nowHour: 8, cfg: CFG })), full);
eq("pan window 3 (Sep 18-22)", asObj(rowPushHours({ ops: ROW, nowDay: "2026-09-15", nowHour: 8, cfg: CFG })), full);

// RED PROOF. Those three pass trivially because the input is identical — which is the whole
// design. The test only means something if it can tell that apart from the bug, so: feed the
// function what a viewport-FILTERED list would have been and assert the answer changes. If
// this ever stops differing, the three assertions above have stopped proving anything.
const filtered = asObj(rowPushHours({ ops: ROW.slice(1), nowDay: "2026-09-15", nowHour: 8, cfg: CFG }));
let redOk = true;
if (JSON.stringify(filtered) === JSON.stringify(full)) {
  redOk = false;
  console.error("RED PROOF FAILED: dropping the first op changed nothing, so the pan assertions cannot detect viewport-dependence");
} else {
  console.log("red proof: a viewport-filtered op list produces a different answer, so the pan cases are load-bearing");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && redOk ? 0 : 1);
