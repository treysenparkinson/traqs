// #389 — A DROP NEAR THE RIGHT EDGE OF A COLUMN LANDED ON THE NEXT DAY.
//
// Trey: "it snaps back, but ONLY when you drag it to 8am for the start and 5pm
// for the end." Both ends of that are one event. The drag's intra-day hour is
//
//     _colFrac = Math.min(0.9999, …)                    ← clamped BEFORE
//     dropHour = Math.round((workStartH + _colFrac * totalWorkH) * 2) / 2   ← rounded AFTER
//
// and the rounding defeats the clamp. On Matrix (08:00–17:00) anything from
// _colFrac ≈ 0.972 up — raw hour ≥ 16.75 — rounds UP to 17.0, which is quitting
// time. walkProductiveHours clamps the clock to workEndH, finds tail === 0, and
// rolls the whole op to the NEXT WORKING DAY at 08:00. The ghost drew it where
// the cursor was, because the ghost reads the same dropHour; the commit walked
// it and put it a day later. Confirmed by Trey: "it lands on a day starting at
// 8am."
//
// The 0.9999 clamp was trying to stop exactly this. It is applied to the
// FRACTION; it has to be applied to the HOUR, after the rounding.
//
// The property, which nothing was checking: FOR EVERY CURSOR POSITION IN A
// COLUMN, THE RESULTING START HOUR MUST LEAVE WORK TIME IN THE DAY.
//
//   node scripts/day-boundary-test.mjs
import { buildDayWindows, walkProductiveHours, productiveHoursLeftInDay, clampStartHour, CLOCK_EPS } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// Matrix's own calendar, which is where this was found.
const MTX = buildDayWindows(8, 17,
  [{ time: "10:00", durationMinutes: 15 }, { time: "15:00", durationMinutes: 15 }],
  { time: "12:00", durationMinutes: 60 });
// The drag's formula, verbatim from TRAQS.jsx's onM.
const rawDropHour = (colFrac, cfg) => {
  const total = cfg.workEndH - cfg.workStartH;
  return Math.round(Math.max(0, cfg.workStartH + Math.min(0.9999, Math.max(0, colFrac)) * total) * 2) / 2;
};

console.log("\n1. THE PROPERTY — every cursor position leaves work time in the day");
{
  const bad = [];
  for (let i = 0; i < 1000; i++) {
    const colFrac = i / 1000;                       // the whole column, [0, 1)
    const h = clampStartHour(rawDropHour(colFrac, MTX), MTX);
    // ε of work: if even a sliver cannot be placed today, the op rolls over.
    if (walkProductiveHours(h, 0.25, MTX).days !== 1) bad.push({ colFrac, h });
  }
  ok("no cursor position in the column rolls the op to the next day", bad.length, 0);
  if (bad.length) console.log(`         first bad: ${JSON.stringify(bad[0])}  (${bad.length} of 1000)`);
  // And it must still reach the end of the day — a clamp that parked everything
  // at 08:00 would pass the line above and be useless.
  const hours = new Set();
  for (let i = 0; i < 1000; i++) hours.add(clampStartHour(rawDropHour(i / 1000, MTX), MTX));
  ok("...and the latest reachable start is 16:30, not 17:00", Math.max(...hours), 16.5);
  ok("...while 08:00 is still reachable", Math.min(...hours), 8);
}

console.log("\n2. RED PROOF — the raw formula puts the cursor on quitting time");
{
  // The table from the investigation. These are the rows that fail today.
  ok("RED: colFrac 0.99 rounds up to 17:00", rawDropHour(0.99, MTX), 17);
  ok("RED: colFrac 0.9999 rounds up to 17:00", rawDropHour(0.9999, MTX), 17);
  ok("...and 17:00 has no work time left in it", productiveHoursLeftInDay(17, MTX), 0);
  ok("...so the op rolls to the NEXT day at the day's start hour",
    [walkProductiveHours(17, 3, MTX).days, walkProductiveHours(17, 3, MTX).endHour > 8], [2, true]);
  ok("...which is what Trey saw: 'it lands on a day starting at 8am'",
    clampStartHour(rawDropHour(0.9999, MTX), MTX) < 17, true);
}

console.log("\n3. The clamp does nothing to an hour that is already legal");
{
  for (const h of [8, 8.5, 12, 12.5, 16, 16.5]) ok(`${h}:00 is unchanged`, clampStartHour(h, MTX), h);
}

console.log("\n4. It is computed from the DEAD WINDOWS, not from workEndH − 0.5");
{
  // Lunch butted against the end of the day: 16:00–17:00 is dead, so 16:30 has
  // no work time in it either and the last legal start is 15:30. A clamp
  // written as `workEndH - 0.5` would return 16:30 and still roll over.
  const late = buildDayWindows(8, 17, [], { time: "16:00", durationMinutes: 60 });
  ok("16:30 has no work time when lunch runs 16:00–17:00", productiveHoursLeftInDay(16.5, late), 0);
  ok("...so the clamp steps back past the whole window", clampStartHour(16.5, late), 15.5);
  ok("...and a drop at the right edge lands there too", clampStartHour(rawDropHour(0.9999, late), late), 15.5);
  ok("...which still leaves work time", productiveHoursLeftInDay(15.5, late) > 0, true);
}

console.log("\n5. productiveHoursLeftInDay reads the windows, in any order");
{
  ok("a full day from 08:00 is the day minus its dead time", productiveHoursLeftInDay(8, MTX), 7.5);
  ok("from 13:00, after lunch, 3.75h remain", productiveHoursLeftInDay(13, MTX), 3.75);
  ok("from 16:30, half an hour", productiveHoursLeftInDay(16.5, MTX), 0.5);
  ok("from before the day, the whole day", productiveHoursLeftInDay(6, MTX), 7.5);
  ok("from after it, nothing", productiveHoursLeftInDay(18, MTX), 0);
  // The forward walk's own comment warns it is order-sensitive and unprotected
  // (statsMath.js: "Do not read this as 'forward is safe'"). This one sorts.
  const shuffled = { ...MTX, deadWindows: [...MTX.deadWindows].reverse() };
  ok("DESCENDING windows give the same answer, unlike the forward walk",
    productiveHoursLeftInDay(8, shuffled), 7.5);
}

console.log("\n6. endHour never runs past quitting time while claiming one day");
{
  // CLOCK_EPS is a full minute, and `left <= tail + CLOCK_EPS` let the clock
  // settle PAST workEndH: 7.5166h from 08:00 reported days 1, endHour 17.0166 —
  // a bar drawn 1.0011 columns wide instead of 1.0.
  const over = [];
  for (let hpd = 0.25; hpd <= 9; hpd += 0.0083) {
    const w = walkProductiveHours(8, hpd, MTX);
    if (w.days === 1 && w.endHour > MTX.workEndH + 1e-9) over.push({ hpd: +hpd.toFixed(4), endHour: w.endHour });
  }
  ok("no single-day span ends after workEndH", over.length, 0);
  if (over.length) console.log(`         e.g. ${JSON.stringify(over[0])}`);
  ok("the exact fit still ends exactly at 17:00", walkProductiveHours(8, 7.5, MTX).endHour, 17);
  ok("...and is still one day", walkProductiveHours(8, 7.5, MTX).days, 1);
  // The tolerance itself is kept: a sub-minute overrun must still NOT spill a
  // sliver onto tomorrow, which is what CLOCK_EPS is for.
  ok("a half-minute overrun stays on today", walkProductiveHours(8, 7.5083, MTX).days, 1);
  ok("...pinned to the end of the day rather than past it", walkProductiveHours(8, 7.5083, MTX).endHour, 17);
  ok("...while a real overrun still rolls over", walkProductiveHours(8, 7.6, MTX).days, 2);
  ok("CLOCK_EPS is unchanged — the tolerance was never the bug", CLOCK_EPS, 1 / 60);
}

console.log("\n7. The drag actually clamps");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("TRAQS.jsx imports the clamp", /clampStartHour/.test(CODE), true);
  // After every way dropHour is derived — the column fraction, the weekend
  // shift, the end-of-day magnet and the dependency snap — and before the plan
  // is built from it. A clamp applied at only one of those is the 0.9999 bug
  // again in a new place.
  const at = CODE.indexOf("const _plan = _planAt(snapS, dropHour");
  ok("the drag's plan site was found", at > 0, true);
  const before = CODE.slice(Math.max(0, at - 700), at);
  // The GUARD is part of the assertion, not just the call. A first version of
  // this matched `dropHour = clampStartHour(…)` alone, and the mutant
  // `if (false) dropHour = clampStartHour(…)` sailed through it — a line that is
  // present, reads correctly, and never executes. Same family as LESSONS #1.
  ok("...and dropHour is clamped before the plan is built",
    /if \(dropHour !== null\) dropHour = clampStartHour\(dropHour, dayWindowCfg\);/.test(before), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
