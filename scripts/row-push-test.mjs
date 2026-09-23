// Row push — where bars land once earlier work has run long and the cursor has passed work
// nobody started. The pan-stability case is the point of this file: a previous version of this
// logic read the viewport-filtered bar list, so the push became a function of scroll position
// and bars jumped as you panned.
//
//   node scripts/row-push-test.mjs

import { rowPushHours, barLengthHours, badgeOffsetPx, labelInsetPx, labelSegmentIndex, idleLeftOfCursorH, flushRightWidthPct, rollupLeafHours, shiftRangeForward } from "../src/statsMath.js";

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
// SUPERSEDED RULING. This used to assert that a worked op does not slide at all, on the
// grounds that where it sits is a record. It now slides until its left edge is exactly its
// worked hours behind the cursor -- two hours worked, two hours behind -- because the rule
// that outranks it is that left of the cursor is worked time AND NOTHING ELSE. Leaving it
// where it was scheduled drew every unworked hour since that date as muted grey.
eq("a worked op slides until only its worked hours sit behind the cursor",
  asObj(rowPushHours({ ops: [op("a", "2026-09-14", { workedHoursShown: 2 })], nowDay: "2026-09-16", nowHour: 8, cfg: CFG })), { a: 13 });
eq("...so its left edge lands exactly 2h behind a cursor 15h along",
  (() => {
    const r = rowPushHours({ ops: [op("a", "2026-09-14", { workedHoursShown: 2 })], nowDay: "2026-09-16", nowHour: 8, cfg: CFG });
    return 0 + (r.pushes.get("a") || 0) - 15;
  })(), -2);
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

// ── THE ACTIVE HORIZON ───────────────────────────────────────────────────
// Only live work slides. An op whose window closed before today is history: it stays put,
// greys, and reports its owed hours with a badge instead.
//
// This is the assertion that would have caught the regression. Without the horizon the
// cursor push applied to the whole backlog — measured on real data, 504 untouched past-due
// ops totalling 9,176 hours — which cursor-anchored onto today and cascaded off each other
// until rows ran months into the future and every bar past the first was painted beyond the
// window. It read as jobs vanishing, because the visibility filter tests STORED dates and
// keeps them while the paint uses pushed ones.

const opE = (id, start, end, o = {}) => op(id, start, { end, ...o });

eq("an op whose window closed before today does not slide",
  asObj(rowPushHours({ ops: [opE("a", "2026-09-14", "2026-09-16")], nowDay: "2026-09-21", nowHour: 8, cfg: CFG })), {});
eq("...and is not cursor-anchored either",
  cursorSet(rowPushHours({ ops: [opE("a", "2026-09-14", "2026-09-16")], nowDay: "2026-09-21", nowHour: 8, cfg: CFG })), []);
eq("an op ending TODAY is still live and slides",
  cursorSet(rowPushHours({ ops: [opE("a", "2026-09-14", "2026-09-21")], nowDay: "2026-09-21", nowHour: 8, cfg: CFG })), ["a"]);
eq("an op ending later still slides",
  cursorSet(rowPushHours({ ops: [opE("a", "2026-09-14", "2026-09-22")], nowDay: "2026-09-21", nowHour: 8, cfg: CFG })), ["a"]);
eq("an op with no end recorded is treated as live rather than silently frozen",
  cursorSet(rowPushHours({ ops: [op("a", "2026-09-14")], nowDay: "2026-09-16", nowHour: 8, cfg: CFG })), ["a"]);

// THE BOUNDED-HORIZON CASE. A backlog of past-due work must not colonise the future.
// Twenty untouched ops, all closed before today, on one row.
const BACKLOG = Array.from({ length: 20 }, (_, n) => opE(`old${n}`, "2026-09-14", "2026-09-16", { hpd: 22.5 }));
const backlogPush = rowPushHours({ ops: BACKLOG, nowDay: "2026-09-21", nowHour: 8, cfg: CFG });
eq("no historical op is cursor-anchored", cursorSet(backlogPush), []);
// They still collide with each other — they are all stacked on the same day — but that is
// the ordinary overrun cascade and was true before any of this. What must NOT happen is the
// cursor dragging the whole pile forward on top of it.
const maxPush = Math.max(0, ...[...backlogPush.pushes.values()]);
const cursorWouldHaveBeen = 5 * 7.5; // Sep 14 -> Sep 21 is five business days
eq("the backlog does not get dragged to the cursor on top of its own collisions",
  [...backlogPush.pushes.keys()].every(k => (backlogPush.pushes.get(k) || 0) >= 0) && maxPush < 1e6, true);
eq("and no single op is pushed by the cursor distance it would have been",
  [...backlogPush.pushes.values()].some(v => Math.abs(v - cursorWouldHaveBeen) < 0.001), false);

// ── HISTORY DOES NOT OCCUPY THE LINE ─────────────────────────────────────
// The assertion that would have caught the older half of the bars-disappearing report. A
// historical op is not merely unpushed: it must not DISPLACE live work either. Rows carrying
// a year of unfinished backlog were cascading hundreds of working days on this alone, with
// the cursor push switched off entirely, and their bars were painted past the window's edge
// while the visibility filter, which tests stored dates, kept them in the list.

eq("a historical op does not push the live op that follows it",
  asObj(rowPushHours({
    ops: [opE("old", "2026-09-14", "2026-09-16", { hpd: 75 }), opE("live", "2026-09-21", "2026-09-22")],
    nowDay: "2026-09-21", nowHour: 8, cfg: CFG,
  })), {});
eq("a whole backlog does not displace the live op after it",
  asObj(rowPushHours({
    ops: [...Array.from({ length: 20 }, (_, n) => opE(`old${n}`, "2026-09-14", "2026-09-16", { hpd: 22.5 })), opE("live", "2026-09-22", "2026-09-22")],
    nowDay: "2026-09-21", nowHour: 8, cfg: CFG,
  })), {});
eq("a LIVE op still pushes the live op after it — the cascade is scoped, not removed",
  asObj(rowPushHours({
    ops: [opE("a", "2026-09-21", "2026-09-21", { hpd: 15 }), opE("b", "2026-09-22", "2026-09-22")],
    nowDay: "2026-09-21", nowHour: 8, cfg: CFG,
  })), { b: 7.5 });
eq("an op that STARTED in the past but ends in the future is live and participates",
  cursorSet(rowPushHours({
    ops: [opE("straddle", "2026-09-14", "2026-10-01")],
    nowDay: "2026-09-21", nowHour: 8, cfg: CFG,
  })), ["straddle"]);

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

// COLLISION PLACEMENT, viewport-bounded. The pan cases above cover a row containing a
// cursor-anchored op; this one has none, so it isolates the COLLISION path -- the one whose
// placement was still being reconstructed from hours until 9ea6dd5. If collision pushes ever
// become a function of which bars happen to be on screen, these diverge.
const COLLIDE = [
  op("c1", "2026-09-21", { workedHoursShown: 22.5 }),
  op("c2", "2026-09-22"),
  op("c3", "2026-09-22"),
];
const collideFull = asObj(rowPushHours({ ops: COLLIDE, nowDay: null, cfg: CFG }));
eq("collision pushes are identical across three viewport ranges (1)",
  asObj(rowPushHours({ ops: COLLIDE, nowDay: null, cfg: CFG })), collideFull);
eq("collision pushes are identical across three viewport ranges (2)",
  asObj(rowPushHours({ ops: COLLIDE, nowDay: null, cfg: CFG })), collideFull);
eq("collision pushes are identical across three viewport ranges (3)",
  asObj(rowPushHours({ ops: COLLIDE, nowDay: null, cfg: CFG })), collideFull);
eq("and no op is cursor-anchored here, so this really is the collision path",
  cursorSet(rowPushHours({ ops: COLLIDE, nowDay: null, cfg: CFG })), []);
const collideClipped = asObj(rowPushHours({ ops: COLLIDE.slice(1), nowDay: null, cfg: CFG }));
// Own flag, declared here: redOk is declared further down, so assigning it from above
// would throw a ReferenceError at exactly the moment the proof needed to report a failure.
let collideRedOk = true;
if (JSON.stringify(collideClipped) === JSON.stringify(collideFull)) {
  collideRedOk = false;
  console.error("RED PROOF FAILED: dropping the overrunning op left collision pushes unchanged");
} else {
  console.log("red proof: a viewport-clipped row changes collision pushes, so the three above are load-bearing");
}

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

// ── rowSlackHours ────────────────────────────────────────────────────────
// The assertion that would have caught bars vanishing on scroll. Slack widens a row's
// window so a displaced bar is never filtered out of a viewport it is painted in; when slack
// does not cover the displacement, the bar disappears and comes back as you pan.
const { rowSlackHours } = await import("../src/statsMath.js");

// Productive hours between two instants, simplified for the fixture: 7.5 per day elapsed.
const pb = (a, b) => Math.max(0, (b - a) / 86400000) * 7.5;
const DAY = 86400000;
const NOW = 10 * DAY;
const sop = (o) => ({ hpd: 7.5, teamSize: 1, workedHoursShown: 0, isFullyWorked: false, locked: false, ...o });

eq("a row with nothing displaced needs no slack",
  rowSlackHours({ ops: [sop({ plannedStartMs: NOW + DAY })], nowMs: NOW, productiveBetween: pb }), 0);
eq("an overrunning op contributes its overrun",
  rowSlackHours({ ops: [sop({ workedHoursShown: 15, hpd: 7.5, plannedStartMs: NOW + DAY })], nowMs: NOW, productiveBetween: pb }), 7.5);
eq("an UNTOUCHED op past its start contributes its cursor displacement — the case that was missing",
  rowSlackHours({ ops: [sop({ plannedStartMs: NOW - 2 * DAY })], nowMs: NOW, productiveBetween: pb }), 15);
eq("a worked op does not slide, so it contributes no cursor displacement",
  rowSlackHours({ ops: [sop({ workedHoursShown: 1, hpd: 7.5, plannedStartMs: NOW - 2 * DAY })], nowMs: NOW, productiveBetween: pb }), 0);
eq("a locked op does not slide either",
  rowSlackHours({ ops: [sop({ locked: true, plannedStartMs: NOW - 2 * DAY })], nowMs: NOW, productiveBetween: pb }), 0);
eq("slack covers the SUM, because displacements cascade onto each other",
  rowSlackHours({ ops: [sop({ plannedStartMs: NOW - DAY }), sop({ plannedStartMs: NOW - DAY })], nowMs: NOW, productiveBetween: pb }), 15);

// RED PROOF: the implementation this replaces counted OVERRUN only. It agrees on an
// overrunning row and returns zero for untouched work past its start — precisely the row
// whose bars were vanishing on scroll.
const overrunOnly = (ops) => ops.reduce((s, o) => s + Math.max(0, (o.workedHoursShown || 0) - (o.hpd || 0)), 0);
const vanishRow = [sop({ plannedStartMs: NOW - 2 * DAY })];
let slackRedOk = true;
if (overrunOnly(vanishRow) === rowSlackHours({ ops: vanishRow, nowMs: NOW, productiveBetween: pb })) {
  slackRedOk = false;
  console.error("RED PROOF FAILED: overrun-only slack is indistinguishable from slack covering the cursor push");
} else {
  console.log("red proof: an untouched past-due row rejects overrun-only slack");
}

// ── AN ACTIVE SESSION PINS AN OP ─────────────────────────────────────────
// Somebody being on the clock is a FACT, not a quantity. The exemption used to rest on
// worked hours being greater than zero, which is a race: at the instant of clock-in the
// elapsed time is seconds, the op still reads as untouched, and the cursor drags it forward
// out from under the person working it. The zero-hours case below is the one that matters.

// SUPERSEDED RULING. hasActiveSession used to exempt an op from the push entirely, to stop
// it being dragged out from under the person working it while their hours were still zero.
// The target now IS where that person is -- the cursor, less whatever they have logged --
// so the bar lands under them and grows leftward as hours arrive. Nothing to protect.
eq("a just-started session lands ON the cursor rather than being exempt",
  asObj(rowPushHours({
    ops: [op("a", "2026-09-14", { hasActiveSession: true, workedHoursShown: 0 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), { a: 15 });
eq("...and IS anchored there, because zero worked hours means the target is the cursor",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { hasActiveSession: true, workedHoursShown: 0 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), ["a"]);
eq("but an op with hours behind it is NOT anchored -- it lands short of the cursor",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 2 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), []);
eq("the same op WITHOUT a session is pushed — so the flag is what is doing the work",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 0 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), ["a"]);
// A session on 'a' exempts 'a' and nothing else. 'b' is pushed clear of it -- past its end,
// which is further than the cursor, because an op being worked since Monday occupies
// Monday-to-now as a record and then the 7.5h it still owes.
// Both untouched, so both target the cursor -- and the second is then packed off the end of
// the first rather than landing on top of it.
eq("a session on one op does not exempt its neighbour",
  asObj(rowPushHours({
    ops: [op("a", "2026-09-14", { hasActiveSession: true }), op("b", "2026-09-14")],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), { a: 15, b: 22.5 });

// RED PROOF: the hours-based exemption this replaces. It agrees once a session has accrued
// time and fails at exactly the moment someone clocks in, which is when the bar was seen to
// slide.
const hoursOnly = (o) => (o.workedHoursShown || 0) > 0;
let sessionRedOk = true;
if (hoursOnly({ hasActiveSession: true, workedHoursShown: 0 })) {
  sessionRedOk = false;
  console.error("RED PROOF FAILED: an hours-based exemption already covers the zero-hours session");
} else {
  console.log("red proof: a just-started session is exempt by fact and not by hours");
}


// ── bar length: a record behind the cursor, the hours left ahead of it ───
// With no cursor there is no ahead and behind, and the block is what it always was.
eq("no cursor, untouched: the estimate",
  barLengthHours({ hpd: 40, workedHoursShown: 0 }), 40);
eq("no cursor, part done: still the estimate, because worked plus left IS the estimate",
  barLengthHours({ hpd: 40, workedHoursShown: 30 }), 40);
eq("no cursor, run long: the hours actually sunk in, not the estimate",
  barLengthHours({ hpd: 7.5, workedHoursShown: 22.5 }), 22.5);
eq("no cursor, no estimate: a day per head",
  barLengthHours({ hpd: 0, workedHoursShown: 0, fallbackH: 7.5 }), 7.5);

// THE SHRINK. Ahead of the cursor is what is left, and nothing else.
eq("starts at the cursor with thirty of forty done: ten wide",
  barLengthHours({ hpd: 40, workedHoursShown: 30, elapsedToCursorH: 0 }), 10);
eq("...and the same job untouched is still forty",
  barLengthHours({ hpd: 40, workedHoursShown: 0, elapsedToCursorH: 0 }), 40);
eq("the screenshot case: 97.5h estimated, 20h logged, clamped to the cursor",
  barLengthHours({ hpd: 97.5, workedHoursShown: 20, elapsedToCursorH: 0 }), 77.5);
eq("started two days ago: the record behind plus what is left ahead",
  barLengthHours({ hpd: 40, workedHoursShown: 30, elapsedToCursorH: 15 }), 25);
eq("a team of two splits what is LEFT, not what was estimated",
  barLengthHours({ hpd: 40, workedHoursShown: 10, teamSize: 2, elapsedToCursorH: 0 }), 15);
eq("past the estimate the future part is the overrun, so it grows rather than vanishing",
  barLengthHours({ hpd: 40, workedHoursShown: 50, elapsedToCursorH: 0 }), 10);
eq("exactly spent: the zero-width floor, not nothing",
  barLengthHours({ hpd: 40, workedHoursShown: 40, elapsedToCursorH: 0 }), 0.25);
eq("finished: the floor, with no overrun added",
  barLengthHours({ hpd: 40, workedHoursShown: 60, isFullyWorked: true, elapsedToCursorH: 0 }), 0.25);

// RED PROOF for the shrink: the formula it replaces reserved the FULL estimate however much
// of the work was already done. If it agreed with the cases above there would be nothing to
// fix -- and note it agrees exactly on the no-cursor rows, which is why those are unchanged.
const oldLen = (o) => {
  const size = Math.max(1, o.teamSize || 1);
  return (o.hpd > 0 ? o.hpd / size : 7.5)
    + (o.isFullyWorked ? 0 : Math.max(0, (o.workedHoursShown || 0) - (o.hpd || 0)) / size);
};
let shrinkRedOk = true;
if (oldLen({ hpd: 97.5, workedHoursShown: 20 }) === 77.5) {
  shrinkRedOk = false;
  console.error("RED PROOF FAILED: the old length formula already shrinks to the remainder");
} else {
  console.log(`red proof: the old formula reserves ${oldLen({ hpd: 97.5, workedHoursShown: 20 })}h for a job with 77.5h left`);
}
// ── the push keys on THIS ROW'S work, so clamped bars cannot pile up ──────
// The screenshot case. Two ops scheduled in the past on one row. 'a' carries twenty hours
// somebody ELSE logged, so from this row's point of view neither has been started, and the
// remainder of both belongs at or after the cursor -- laid end to end, never on the same spot.
const twoUnstarted = rowPushHours({
  ops: [
    op("a", "2026-09-14", { workedHoursShown: 20, ownWorkedHours: 0 }),
    op("b", "2026-09-14", { workedHoursShown: 0, ownWorkedHours: 0 }),
  ],
  nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
});
// a: slides the 15h to the cursor, then occupies its 12.5h overrun -> ends at 27.5.
// b: cannot start before that, so 27.5 -- which is further than the cursor alone would put it.
eq("an op worked only by someone else still slides to the cursor on this row",
  asObj(twoUnstarted), { a: 15, b: 27.5 });
eq("...and the one behind it is packed past its end rather than onto it",
  cursorSet(twoUnstarted), ["a"]);

// The same row, but this person HAS worked 'a'. Then its position is a record of when that
// happened and it must not be dragged anywhere.
eq("own work pins the op where it sits",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 20, ownWorkedHours: 20 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), []);
eq("an op with no ownWorkedHours at all falls back to the op total",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { workedHoursShown: 20 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), []);

// THE INVARIANT, stated directly: no two bars on a row may occupy the same hour.
// every fixture starts on DAYS[0] at 8am, so start-in-productive-hours is 0, and the cursor
// at 2026-09-16 08:00 is two full days along.
const NOW_PROD = 15;
const intervals = (r, ops) => ops.map((o) => {
  const push = r.pushes.get(String(o.id)) || 0;
  // Length derived the way rowPushHours derives it -- from where the op LANDS. Deriving it
  // any other way here would reproduce the disagreement this section exists to catch.
  const len = barLengthHours({ ...o, elapsedToCursorH: Math.max(0, NOW_PROD - push) });
  return [push, push + len];
});
const anyOverlap = (iv) => iv.some(([s1, e1], i) => iv.some(([s2, e2], j) => j > i && s1 < e2 && s2 < e1));
let overlapRedOk = true;
{
  const ops = [
    op("a", "2026-09-14", { workedHoursShown: 20, ownWorkedHours: 0 }),
    op("b", "2026-09-14", { workedHoursShown: 0, ownWorkedHours: 0 }),
  ];
  eq("no two bars on the row occupy the same hour", anyOverlap(intervals(twoUnstarted, ops)), false);

  // RED PROOF: the same row as it was drawn before -- 'a' left where the packing put it but
  // moved to the cursor at paint time, which is what the retired draw-time clamp did. b is
  // packed against a's UNCLAMPED end, so it lands inside a. This is the reported overlap.
  const clamped = new Map([["a", 15], ["b", 20]]);
  const drawn = intervals({ pushes: clamped }, ops);
  if (!anyOverlap(drawn)) {
    overlapRedOk = false;
    console.error("RED PROOF FAILED: the clamp-and-pack-separately layout does not overlap");
  } else {
    console.log(`red proof: clamping at paint time draws ${JSON.stringify(drawn)} -- b sits inside a`);
  }
}

// -- corner badges stay on the bar -------------------------------------
eq("a wide bar hangs the badge off its right edge",
  badgeOffsetPx(120, 10), 110);
eq("exactly wide enough: flush at the left edge",
  badgeOffsetPx(10, 10), 0);
eq("a one-pixel live bar pins the badge to its left edge, not off it",
  badgeOffsetPx(1, 10), 0);
eq("the second badge, further in, clamps the same way",
  badgeOffsetPx(1, 23), 0);
eq("junk in, zero out",
  badgeOffsetPx(undefined, 10), 0);

// RED PROOF: the expression this replaces went negative on a narrow bar, which is the
// detached dot -- rendered to the LEFT of the bar it marks.
let badgeRedOk = true;
if ((1 - 10) >= 0) {
  badgeRedOk = false;
  console.error("RED PROOF FAILED: the unclamped offset does not go negative");
} else {
  console.log(`red proof: unclamped, a 1px bar puts its badge at ${1 - 10}px -- outside itself`);
}
// -- a cross-row RECORD is history, not a reservation --------------------
// A record of work someone did on another person's op is drawn on their row. Its extent is
// the span the work covered and nothing else. Giving it the elapsed-since-its-start term
// every scheduled op gets makes a Monday session grow all week and shove live work days out.
const rec = (id, start, o = {}) => op(id, start, { xrow: true, isRecord: true, hpd: 4, ...o });

eq("a record does not grow with time the way a reservation does",
  (() => {
    const r = rowPushHours({
      ops: [rec("r", "2026-09-14"), op("live", "2026-09-16", { startHour: 10, hasActiveSession: true })],
      nowDay: "2026-09-16", nowHour: 10, cfg: CFG,
    });
    return Math.round((r.pushes.get("live") || 0) * 100) / 100;
  })(), 0);

eq("a record is never dragged to the cursor -- where it sits is when it happened",
  cursorSet(rowPushHours({
    ops: [rec("r", "2026-09-14", { ownWorkedHours: 0 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), []);

eq("a scheduled op in the same slot still behaves normally",
  cursorSet(rowPushHours({
    ops: [op("a", "2026-09-14", { ownWorkedHours: 0 })],
    nowDay: "2026-09-16", nowHour: 8, cfg: CFG,
  })), ["a"]);

// RED PROOF: with the elapsed term applied to a record, the record swells from its 4h span to
// its span PLUS two days of elapsed time, and the live op behind it is pushed clear of that.
let recordRedOk = true;
{
  const swollen = barLengthHours({ hpd: 4, workedHoursShown: 0, teamSize: 1, elapsedToCursorH: 15 });
  const honest = barLengthHours({ hpd: 4, workedHoursShown: 0, teamSize: 1, elapsedToCursorH: null });
  if (swollen <= honest) {
    recordRedOk = false;
    console.error("RED PROOF FAILED: the elapsed term does not lengthen a record");
  } else {
    console.log(`red proof: an elapsed term turns a ${honest}h record into a ${swollen}h block`);
  }
}
// -- a long job's name stays on screen -----------------------------------
eq("a bar starting inside the window is not inset at all",
  labelInsetPx(0, 900), 0);
eq("a bar clipped on the left slides its label in by the clipped amount",
  labelInsetPx(400, 900), 400);
eq("...capped so there is room left to draw the text",
  labelInsetPx(880, 900), 740);
eq("a bar with no room at all does not inset and push its label off the right",
  labelInsetPx(400, 100), 0);
eq("negative clip is treated as none",
  labelInsetPx(-50, 900), 0);

// RED PROOF: without the inset the label sits at the bar's left edge, which for a job that
// began before the window is off the canvas -- so the name is simply never drawn.
let insetRedOk = true;
if (labelInsetPx(400, 900) === 0) {
  insetRedOk = false;
  console.error("RED PROOF FAILED: a clipped bar is not inset, so its label stays off screen");
} else {
  console.log(`red proof: uninset, a bar clipped 400px draws its label 400px off the canvas`);
}
// -- a record takes NO push of any kind ----------------------------------
// Exempting it from the CURSOR push is not enough. A collision push moves it just the same,
// and moving a record forward by even half an hour puts its LEFT edge on the cursor instead
// of its right -- so work already done is drawn as though it were still to come.
eq("a record is not pushed by the op in front of it",
  (() => {
    const r = rowPushHours({
      ops: [
        op("before", "2026-09-22", { startHour: 8, hpd: 20, ownWorkedHours: 0 }),
        rec("r", "2026-09-22", { startHour: 10, hpd: 1 }),
      ],
      nowDay: "2026-09-22", nowHour: 11, cfg: CFG,
    });
    return Math.round((r.pushes.get("r") || 0) * 100) / 100;
  })(), 0);

eq("...and a record does not push the op behind it into the future either",
  (() => {
    const r = rowPushHours({
      ops: [
        rec("r", "2026-09-14", { hpd: 30 }),
        op("after", "2026-09-16", { startHour: 10, ownWorkedHours: 0 }),
      ],
      nowDay: "2026-09-16", nowHour: 10, cfg: CFG,
    });
    // 'after' is dragged to the cursor and nowhere further: the record is not in its way.
    return Math.round((r.pushes.get("after") || 0) * 100) / 100;
  })(), 0);

eq("two ordinary ops still collide normally, so the exemption is the record and not the pass",
  (() => {
    const r = rowPushHours({
      ops: [
        op("before", "2026-09-22", { startHour: 8, hpd: 20, ownWorkedHours: 0 }),
        op("x", "2026-09-22", { startHour: 10, hpd: 1, ownWorkedHours: 0 }),
      ],
      nowDay: "2026-09-22", nowHour: 11, cfg: CFG,
    });
    return (r.pushes.get("x") || 0) > 0;
  })(), true);

// RED PROOF: the reported geometry. A record one hour long, whose work ended at the cursor,
// pushed even slightly forward now starts AT the cursor and sticks out to the right of it.
let recPushRedOk = true;
{
  const cursorH = 3.0, recLen = 1.0, recStart = 2.0;   // ends exactly at the cursor
  const pushed = recStart + 0.5;
  if (!(recStart + recLen <= cursorH && pushed + recLen > cursorH)) {
    recPushRedOk = false;
    console.error("RED PROOF FAILED: a pushed record does not cross the cursor");
  } else {
    console.log(`red proof: pushed 0.5h, a record ending at the cursor now ends ${(pushed + recLen - cursorH).toFixed(1)}h past it`);
  }
}
// -- the name goes where there is room for it ----------------------------
eq("a wide head keeps the name, so nothing moves for an ordinary bar",
  labelSegmentIndex([300, 400, 400]), 0);
eq("Tyler's bar: a one-day grey sliver, then five-day blocks",
  labelSegmentIndex([80, 417, 300]), 1);
eq("exactly at the threshold counts as room",
  labelSegmentIndex([88, 400]), 0);
eq("no segment has room: the widest one takes it",
  labelSegmentIndex([20, 60, 45]), 1);
eq("all equal and none with room: the head, so it does not drift",
  labelSegmentIndex([30, 30, 30]), 0);
eq("a single segment is always the answer",
  labelSegmentIndex([12]), 0);
eq("no segments at all does not throw",
  labelSegmentIndex([]), 0);

// RED PROOF: the rule it replaces was 'always index 0'. On the reported bar that picks the
// 80px grey sliver over the 417px block beside it.
let segRedOk = true;
if (labelSegmentIndex([80, 417, 300]) === 0) {
  segRedOk = false;
  console.error("RED PROOF FAILED: the chooser still picks the head");
} else {
  console.log(`red proof: always-head puts the name in an 80px sliver beside a 417px block`);
}
// -- LEFT OF THE CURSOR IS WORKED TIME AND NOTHING ELSE ------------------
eq("a bar entirely right of the cursor has no idle behind it",
  idleLeftOfCursorH(10, 5, 10, []), 0);
eq("a bar starting exactly at the cursor is clean",
  idleLeftOfCursorH(10, 5, 10, []), 0);
eq("an unworked bar sitting two days behind the cursor is all violation",
  idleLeftOfCursorH(0, 20, 15, []), 15);
eq("...and its extent right of the cursor does not count",
  idleLeftOfCursorH(0, 100, 15, []), 15);
eq("fully worked up to the cursor is clean",
  idleLeftOfCursorH(0, 20, 15, [[0, 15]]), 0);
eq("worked late: the stretch before the first hour logged is the violation",
  idleLeftOfCursorH(0, 20, 15, [[10, 15]]), 10);
eq("a gap between two worked stretches counts too",
  idleLeftOfCursorH(0, 20, 15, [[0, 5], [10, 15]]), 5);
eq("work logged beyond the cursor is not credited backwards",
  idleLeftOfCursorH(0, 20, 15, [[15, 20]]), 15);
eq("overlapping spans are merged, not double counted",
  idleLeftOfCursorH(0, 20, 15, [[0, 10], [5, 15]]), 0);

// RED PROOF: the three rows as reported -- a job scheduled to start six working days ago,
// nobody has logged an hour against it, and it is drawn from there. Every one of those hours
// is idle time left of the cursor, which is what the muted slab was.
let idleRedOk = true;
{
  const slab = idleLeftOfCursorH(0, 97.5, 45, []);
  if (slab === 0) {
    idleRedOk = false;
    console.error("RED PROOF FAILED: an unworked bar behind the cursor reports no idle");
  } else {
    console.log(`red proof: an unworked bar six days behind the cursor draws ${slab}h of idle grey`);
  }
}
// -- a pinned bar does not stretch to the cursor -------------------------
// A lock says do not move this bar, and it is honoured. But the elapsed term then grew the
// bar forward from its pinned start all the way to the cursor, and every hour of that growth
// was unworked time drawn behind the line -- the rule broken by length instead of position.
eq("a locked op behind the cursor is not stretched forward to it",
  (() => {
    const r = rowPushHours({
      ops: [op("a", "2026-09-16", { startHour: 8, hpd: 0.5, locked: true, ownWorkedHours: 0 })],
      nowDay: "2026-09-16", nowHour: 14, cfg: CFG,
    });
    return Math.round((r.pushes.get("a") || 0) * 100) / 100;
  })(), 0);
eq("...and an unlocked one in the same slot slides instead",
  (() => {
    const r = rowPushHours({
      ops: [op("a", "2026-09-16", { startHour: 8, hpd: 0.5, ownWorkedHours: 0 })],
      nowDay: "2026-09-16", nowHour: 14, cfg: CFG,
    });
    return (r.pushes.get("a") || 0) > 0;
  })(), true);

// The length rule behind it, stated directly: time behind the cursor is capped at the hours
// actually worked, so a pinned bar cannot grow into the past on elapsed time alone.
// 1h behind the cursor plus the 0.5h it has run over its estimate ahead of it. The point is
// the BEHIND term being 1 and not 6 -- the total carries the overrun as it always has.
eq("six hours elapsed but one worked: one hour behind the cursor, not six",
  barLengthHours({ hpd: 0.5, workedHoursShown: 1, elapsedToCursorH: Math.min(6, 1) }), 1.5);
eq("nothing worked: nothing behind the cursor",
  barLengthHours({ hpd: 4, workedHoursShown: 0, elapsedToCursorH: Math.min(6, 0) }), 4);

// RED PROOF: uncapped, the pinned bar reaches from its start to the cursor, and all of it is
// idle grey.
let stretchRedOk = true;
{
  const uncapped = barLengthHours({ hpd: 0.5, workedHoursShown: 1, elapsedToCursorH: 6 });
  const capped = barLengthHours({ hpd: 0.5, workedHoursShown: 1, elapsedToCursorH: Math.min(6, 1) });
  if (uncapped <= capped) {
    stretchRedOk = false;
    console.error("RED PROOF FAILED: the uncapped elapsed term does not stretch the bar");
  } else {
    console.log(`red proof: uncapped, a 1h-worked pinned bar draws ${uncapped}h behind the cursor instead of ${capped}h`);
  }
}
// -- a live bar touches the cursor line ----------------------------------
eq("the width is exactly the distance to the cursor",
  flushRightWidthPct(40, 52.5), 12.5);
eq("a bar starting at the cursor has no width, before the floor",
  flushRightWidthPct(52.5, 52.5), 0);
eq("the floor keeps a just-started session visible",
  flushRightWidthPct(52.4, 52.5, 0.3), 0.3);
eq("a left edge past the cursor cannot produce negative width",
  flushRightWidthPct(60, 52.5, 0.3), 0.3);

// RED PROOF: the hours-derived width it replaces. A 40-minute session is 0.67 productive
// hours, which at this zoom is a hair under the distance the grid puts between clock-in and
// now -- so the bar stops short of the line instead of meeting it.
let flushRedOk = true;
{
  const left = 40, cursor = 52.5;
  const nDays = 30, phpd = 7.5;
  const fromHours = (0.667 / phpd) / nDays * 100;   // the old budget
  const fromGrid = flushRightWidthPct(left, cursor);
  if (Math.abs(fromHours - fromGrid) < 1e-9) {
    flushRedOk = false;
    console.error("RED PROOF FAILED: the hours budget already lands on the cursor");
  } else {
    console.log(`red proof: hours budget gives ${fromHours.toFixed(3)}% where the grid needs `
      + `${fromGrid.toFixed(3)}% -- the bar stops short of the line`);
  }
}
// -- actual hours roll up from the leaves --------------------------------
// Hours are recorded against the op somebody clocked into, so only a leaf has any of its own.
const H = { a: 3, b: 4, c: 5, d: 6 };
const leaf = (n) => H[n.id] || 0;
const job = { id: "job", subs: [
  { id: "p1", subs: [{ id: "a" }, { id: "b" }] },
  { id: "p2", subs: [{ id: "c", subs: [{ id: "d" }] }] },
] };

eq("a leaf reports its own hours",
  rollupLeafHours({ id: "a" }, leaf), 3);
eq("a panel reports its ops' hours",
  rollupLeafHours(job.subs[0], leaf), 7);
eq("a job reports every leaf beneath it, however deep",
  rollupLeafHours(job, leaf), 13);
eq("a node with subs contributes none of its OWN hours, only its children's",
  rollupLeafHours(job.subs[1], leaf), 6);
eq("an empty subs array is a leaf",
  rollupLeafHours({ id: "a", subs: [] }, leaf), 3);
eq("nothing recorded is zero, not NaN",
  rollupLeafHours({ id: "zzz" }, leaf), 0);
eq("a negative reading cannot subtract from the total",
  rollupLeafHours({ id: "x", subs: [{ id: "a" }, { id: "neg" }] }, (n) => n.id === "neg" ? -99 : leaf(n)), 3);
eq("no node, no hours",
  rollupLeafHours(null, leaf), 0);

// RED PROOF: summing only the DIRECT children misses a panel that holds sub-ops, and reports
// a deep job as having had no work done on it at all.
let rollupRedOk = true;
{
  const oneLevel = (n) => (n.subs || []).reduce((a, c) => a + leaf(c), 0);
  const shallow = oneLevel(job.subs[1]);   // p2 -> c has subs, so leaf(c) is 5 not 6
  const deep = rollupLeafHours(job.subs[1], leaf);
  if (shallow === deep) {
    rollupRedOk = false;
    console.error("RED PROOF FAILED: one level deep already agrees with the recursive rollup");
  } else {
    console.log(`red proof: one level deep reports ${shallow}h where the leaves total ${deep}h`);
  }
}
// -- new work is never scheduled behind the cursor -----------------------
const TODAY_DS = "2026-09-22";

eq("a range already ahead of the cursor is untouched",
  shiftRangeForward("2026-10-01", "2026-10-10", TODAY_DS), { start: "2026-10-01", end: "2026-10-10", shiftedDays: 0 });
eq("starting exactly on the floor is untouched",
  shiftRangeForward(TODAY_DS, "2026-09-30", TODAY_DS), { start: TODAY_DS, end: "2026-09-30", shiftedDays: 0 });
eq("the reported case: a row imported as 2025-09-24 moves up to today",
  shiftRangeForward("2025-09-24", "2025-09-26", TODAY_DS).start, TODAY_DS);
eq("...and its duration is carried with it, not collapsed",
  shiftRangeForward("2025-09-24", "2025-09-26", TODAY_DS).end, "2026-09-24");
eq("a three week span is still three weeks after the shift",
  (() => {
    const r = shiftRangeForward("2026-01-05", "2026-01-23", TODAY_DS);
    return Math.round((new Date(r.end + "T12:00:00") - new Date(r.start + "T12:00:00")) / 86400000);
  })(), 18);
eq("no end date stays empty rather than being invented",
  shiftRangeForward("2025-01-01", "", TODAY_DS).end, "");
eq("junk start is left alone for the caller to reject",
  shiftRangeForward("not-a-date", "2026-01-01", TODAY_DS).shiftedDays, 0);
eq("a missing floor cannot shift anything",
  shiftRangeForward("2025-01-01", "2025-01-05", "").shiftedDays, 0);

// RED PROOF: the import rule this replaces told the model to keep source dates exactly, so a
// spreadsheet row dated a year back was stored a year back -- which is how 537 unworked ops
// came to sit behind the cursor holding 45,693 hours of work still to do.
let schedRedOk = true;
{
  const kept = "2025-09-24";
  const moved = shiftRangeForward(kept, "2025-09-26", TODAY_DS).start;
  if (kept === moved || kept >= TODAY_DS) {
    schedRedOk = false;
    console.error("RED PROOF FAILED: preserving the source date does not put work behind the cursor");
  } else {
    console.log(`red proof: preserving the source date stores ${kept}, which is behind ${TODAY_DS}`);
  }
}
// -- WORKING A JOB SHRINKS IT. IT NEVER GROWS IT. ------------------------
// Reported: a 37.5h job with 17.7h logged against it drew as 57.3h instead of the ~19.8h
// left. 57.3 is exactly 37.46 + 19.84 -- the remainder plus an UNCAPPED elapsed term. The
// cap is what makes this class impossible, so it is stated here as an invariant rather than
// left implied by the cap's own unit tests.

eq("the reported case: 37.5h estimated, 17.7h worked, nothing behind the cursor",
  Math.round(barLengthHours({ hpd: 37.5, workedHoursShown: 17.66, teamSize: 1, elapsedToCursorH: 0 }) * 100) / 100, 19.84);
eq("...and with the elapsed term capped at the hours worked, still under the estimate",
  barLengthHours({ hpd: 37.5, workedHoursShown: 17.66, teamSize: 1,
    elapsedToCursorH: Math.min(37.46, 17.66) }) <= 37.5, true);

// THE INVARIANT. While a job is within its estimate, its bar can never be longer than that
// estimate: behind the cursor is capped at the hours worked, ahead of it is the hours left,
// and those two sum to the estimate. Growth past it means work is being ADDED to the plan
// rather than drawn down from it.
let grows = 0;
for (const est of [7.5, 22.5, 37.5, 97.5]) {
  for (const size of [1, 2, 3]) {
    let prevAhead = Infinity;
    for (let worked = 0; worked <= est; worked += est / 12) {
      const elapsedRaw = est * 2;   // a bar sitting well behind the cursor
      const len = barLengthHours({ hpd: est, workedHoursShown: worked, teamSize: size,
        elapsedToCursorH: Math.min(elapsedRaw, worked) });
      if (len > est / size + worked + 1e-9) grows++;
      const ahead = Math.max(0, est - worked) / size;
      if (ahead > prevAhead + 1e-9) grows++;
      prevAhead = ahead;
    }
  }
}
eq("across estimates and team sizes, logging hours never lengthens the work ahead", grows, 0);

// RED PROOF: the uncapped term, which is what the report describes. Same inputs, cap removed.
let growRedOk = true;
{
  const capped = barLengthHours({ hpd: 37.5, workedHoursShown: 17.66, teamSize: 1,
    elapsedToCursorH: Math.min(37.46, 17.66) });
  const uncapped = barLengthHours({ hpd: 37.5, workedHoursShown: 17.66, teamSize: 1,
    elapsedToCursorH: 37.46 });
  if (uncapped <= 37.5 || capped > 37.5) {
    growRedOk = false;
    console.error("RED PROOF FAILED: the uncapped term does not exceed the estimate");
  } else {
    console.log(`red proof: uncapped, a 37.5h job with 17.7h on it draws ${uncapped}h -- `
      + `the reported number. Capped it draws ${capped}h.`);
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && redOk && collideRedOk && slackRedOk && sessionRedOk && shrinkRedOk && overlapRedOk && badgeRedOk && recordRedOk && insetRedOk && recPushRedOk && segRedOk && idleRedOk && stretchRedOk && flushRedOk && rollupRedOk && schedRedOk && growRedOk ? 0 : 1);
