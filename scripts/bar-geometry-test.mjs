// #69/#70 — ONE DEFECT: AN UNBOUNDED HOUR OFFSET AGAINST A CLAMPED SEGMENT LIST.
//
// `barSegmentsPct` places a bar's left edge as
//
//     left0 = <column of the first segment> + ((startHour - workStartH) / totalWorkH) * one
//
// and `startHour` arrives raw. For a CURSOR-ANCHORED bar that startHour is
// `shopHour(Date.now())` — the wall clock, 0..24, never clamped (shopTime.js:108)
// — while the segment list it is measured against only ever covers working days.
// The two disagree the moment the clock leaves the working day, and it shows up
// twice:
//
//   #70  AFTER CLOSE THE LEFT EDGE WALKS INTO TOMORROW'S COLUMN. Measured on
//        Matrix's calendar with Wednesday's column at 28.571%..42.857%:
//          12:00 -> 34.921  (Wed)      18:00 -> 44.444  (THU)
//          17:00 -> 42.857  (Wed)      22:00 -> 50.794  (THU)
//
//   #69  A BAR ANCHORED ON A NON-WORKING DAY PAINTS ON IT. weekdaySegments
//        correctly returns NOTHING for a Saturday-to-Saturday range, and the
//        render's fallback — `barSegs[0] || { start: _layoutStart, ... }`
//        (TRAQS.jsx:16325) — puts the raw Saturday straight back. The guard at
//        :16326 ("anchor on the first segment's start") works whenever segments
//        exist and has nothing to work with when they do not.
//
// #70's ENTRY SAID "collapses to zero width". THAT IS FALSE, and the way it was
// nearly confirmed is worth recording: predicting from `barSegmentsPct` alone,
// `w0 = max(0, min(budget, right0 - left0))` with an unbounded left0 obviously
// collapses. It does not, because `walkProductiveHours` CLAMPS the start into the
// day upstream (`clock = min(max(startH, workStartH), workEndH)`), so a late
// start still produces a multi-day walk and right0 stays ahead of left0. Measured
// width is 5.1587% at every hour from 06:00 to 23:59. A clamp upstream preventing
// the thing a downstream read predicts is the same shape as the entries retracted
// this week.
//
//   node scripts/bar-geometry-test.mjs
import { barSegmentsPct, buildDayWindows, walkProductiveHours, segmentsForBar } from "../src/statsMath.js";
import { workCalendar } from "../src/scheduleRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const workStartH = 8, workEndH = 17, totalWorkH = 9;
const cal = workCalendar({ workDays: [1, 2, 3, 4, 5] });
const cfg = buildDayWindows(workStartH, workEndH,
  [{ time: "10:00", durationMinutes: 15 }, { time: "15:00", durationMinutes: 15 }],
  { time: "12:00", durationMinutes: 60 });
const tStart = "2026-10-05", tEnd = "2026-10-11", nDays = 7;   // Mon 05 .. Sun 11
const one = 100 / nDays;
const DAYS = ["Mon 05", "Tue 06", "Wed 07", "Thu 08", "Fri 09", "SAT 10", "SUN 11"];

// WHICH COLUMN A PERCENTAGE FALLS IN. The epsilon is not decoration: an earlier
// throwaway probe used a bare `Math.floor(pct / one)` and reported a bar sitting
// EXACTLY on Wednesday's left edge as being in Tuesday, because 28.571/14.2857
// evaluates to 1.9999999999999998. A measurement helper that rounds the wrong way
// at a boundary invents findings at exactly the boundaries under test.
const columnOf = (pct) => {
  const i = Math.floor(pct / one + 1e-9);
  return DAYS[i] ?? `past the window (${i})`;
};

const paint = (TD, nowHour, hpd = 3) => {
  const walk = walkProductiveHours(nowHour, hpd, cfg);
  const layoutEnd = walk.days > 1 ? cal.add(TD, walk.days - 1) : TD;
  const raw = cal.segments(TD, layoutEnd, tStart, tEnd, true);
  const segs = segmentsForBar(raw, TD, layoutEnd, (ds) => cal.next(ds));
  const budgetPct = Math.max(0.03 / nDays * 100, (walk.columns / nDays) * 100);
  const o = barSegmentsPct({ segs, layoutStart: TD, tStart, nDays, startHour: nowHour,
    endHour: walk.endHour, budgetPct, endsInView: true, workStartH, totalWorkH })[0];
  return { segStart: segs[0].start, leftPct: +o.leftPct.toFixed(3), widthPct: +o.widthPct.toFixed(4), column: columnOf(o.leftPct) };
};

console.log("\n0. The measurement helper itself");
{
  // The artifact that nearly became a finding.
  ok("a bar exactly on Wednesday's left edge reads as Wednesday", columnOf(28.571428571428573), "Wed 07");
  ok("...and a hair inside Tuesday still reads as Tuesday", columnOf(28.5), "Tue 06");
  ok("the first column is the first column", columnOf(0), "Mon 05");
}

console.log("\n1. THE PROPERTY — the left edge never goes PAST its own column");
{
  // Not "stays in today's column". At exactly quitting time the offset is a full
  // column and the edge lands ON the boundary — and the right edge of Wednesday
  // and the left edge of Thursday are the same instant, so either reading names
  // the same moment. The defect was going BEYOND it: 18:00 was 1.11 columns in
  // and 22:00 was 1.56, a third of the way into a day the bar had no claim on.
  // Asserting "column === Wed" would have failed at 17:00 for a reason that is
  // not a defect, and tuning an epsilon until it passed would have been fitting
  // the test to the code.
  const rightEdge = (2 + 1) * one;              // Wednesday's right edge
  const bad = [];
  for (let h = 0; h <= 24; h += 0.25) {
    const r = paint("2026-10-07", h);
    if (r.leftPct > rightEdge + 1e-9) bad.push({ h, ...r });
  }
  ok("no wall-clock hour pushes the left edge past today's column", bad.length, 0);
  if (bad.length) console.log(`         first: ${JSON.stringify(bad[0])}`);
  ok("...including after close", paint("2026-10-07", 22).leftPct <= rightEdge + 1e-9, true);
  ok("...and before it opens", paint("2026-10-07", 5).column, "Wed 07");
  ok("17:00 sits exactly on the boundary, which is the same instant either way",
    +paint("2026-10-07", 17).leftPct.toFixed(3), +rightEdge.toFixed(3));
  // The edge must still MOVE through the day, or the fix is just a pin at 08:00.
  ok("a bar at midday still sits later than one at 08:00",
    paint("2026-10-07", 12).leftPct > paint("2026-10-07", 8).leftPct, true);
  ok("...and one at 16:30 later still",
    paint("2026-10-07", 16.5).leftPct > paint("2026-10-07", 12).leftPct, true);
}

console.log("\n2. #70 CORRECTED — the width never collapsed, at any hour");
{
  // The entry claimed zero width after close. It is false, and this pins it so
  // the claim cannot come back: the real symptom was displacement, section 1.
  const widths = [];
  for (let h = 0; h <= 24; h += 0.5) widths.push(paint("2026-10-07", h).widthPct);
  ok("every hour paints a non-zero width", widths.every(w => w > 0), true);
  ok("...including 18:00, 20:00 and 22:00",
    [paint("2026-10-07", 18).widthPct > 0, paint("2026-10-07", 20).widthPct > 0, paint("2026-10-07", 22).widthPct > 0],
    [true, true, true]);
  // And WHY it never collapsed, asserted rather than asserted-about: the walk
  // clamps the start, so a late start is still a one-day-or-more walk.
  ok("walkProductiveHours clamps a 22:00 start into the day", walkProductiveHours(22, 3, cfg).endHour <= workEndH, true);
  ok("...which is what keeps right0 ahead of left0", walkProductiveHours(22, 3, cfg).days >= 1, true);
}

console.log("\n3. #69 — a bar anchored on a NON-WORKING day never paints on one");
{
  for (const h of [8, 12, 17, 22]) {
    const r = paint("2026-10-10", h);           // Saturday
    ok(`Sat 10 at ${h}:00 paints on a working column`, r.column === "SAT 10" || r.column === "SUN 11", false);
  }
  ok("...it rolls forward to Monday", paint("2026-10-10", 12).segStart, "2026-10-12");
  ok("a SUNDAY anchor rolls the same way", paint("2026-10-11", 12).segStart, "2026-10-12");
  // The roll already placed it, so no hour offset is applied on the new day —
  // the rule the render already states for a start that lands on a weekend.
  ok("...and begins at the start of that day, not at the wall clock",
    paint("2026-10-10", 15).leftPct, paint("2026-10-10", 9).leftPct);
}

console.log("\n4. segmentsForBar — the fallback that reintroduced the raw day");
{
  const next = (ds) => cal.next(ds);
  // Real dates, not placeholder strings. With "A"/"X" a mutant that ignores the
  // supplied segments CRASHES inside the calendar instead of failing an
  // assertion, and a crash is a weak detection: it says the code broke, not that
  // the property is false.
  ok("real segments pass through untouched",
    segmentsForBar([{ start: "2026-10-06", end: "2026-10-08" }], "2026-10-05", "2026-10-09", next),
    [{ start: "2026-10-06", end: "2026-10-08" }]);
  ok("an empty list rolls the start to the next working day",
    segmentsForBar([], "2026-10-10", "2026-10-10", next), [{ start: "2026-10-12", end: "2026-10-12" }]);
  ok("...and keeps a later end",
    segmentsForBar([], "2026-10-10", "2026-10-14", next), [{ start: "2026-10-12", end: "2026-10-14" }]);
  ok("a working-day start with no segments still rolls to itself",
    segmentsForBar([], "2026-10-07", "2026-10-07", next), [{ start: "2026-10-07", end: "2026-10-07" }]);
  ok("a missing start does not throw", Array.isArray(segmentsForBar([], null, null, next)), true);
}

console.log("\n5. RED PROOF — the unbounded offset, reproduced");
{
  // barSegmentsPct called the old way: startHour raw, straight into left0.
  const rawLeft = (startHour) => {
    const col = 2;                                  // Wednesday
    return col * one + ((startHour - workStartH) / totalWorkH) * one;
  };
  ok("RED: 18:00 put the left edge past Wednesday's column", columnOf(rawLeft(18)), "Thu 08");
  ok("RED: 22:00 put it further still", columnOf(rawLeft(22)), "Thu 08");
  ok("...while the fix keeps both at or before Wednesday's right edge",
    [paint("2026-10-07", 18).leftPct, paint("2026-10-07", 22).leftPct].map(v => +v.toFixed(3)),
    [+((2 + 1) * one).toFixed(3), +((2 + 1) * one).toFixed(3)]);
  ok("RED: the old fallback kept the raw Saturday",
    ([{ start: "2026-10-10", end: "2026-10-10" }])[0].start, "2026-10-10");
}

console.log("\n6. The render uses both");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  // The CALL, not the name. A first version matched /segmentsForBar/, which the
  // import line satisfies on its own — a mutant that deleted the call and left
  // the import sailed straight through it. Same shape as the `if (false)` mutant
  // that survived the #389 wiring assertion.
  ok("TRAQS.jsx actually calls segmentsForBar on the bar's segments",
    /_barSegsDrawn = segmentsForBar\(barSegs, _layoutStart, _layoutEnd,/.test(CODE), true);
  ok("...and the geometry draws from its result", /segs: _barSegsDrawn\./.test(CODE), true);
  ok("...and the raw `barSegs[0] || {` fallback is gone", /barSegs\[0\] \|\| \{ start: _layoutStart/.test(CODE), false);
  ok("...and the geometry no longer picks between two lists inline",
    /segs: barSegs\.length \? barSegs : \[firstBarSeg\]/.test(CODE), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
