// #390 — ONE ROUNDING, NOT TWO. A bar starting at the work-day start had a
// three-pixel landing zone with a one-day cliff on its left.
//
// Trey, after #389 fixed the 5pm half: "it still snaps back when dropping it at
// 8am for the start." A different bug from #389, not the same one from the other
// side — see the correction on that entry.
//
// THE PATTERN. The drag derived a DAY and an HOUR from one quantity using TWO
// DIFFERENT ROUNDINGS:
//
//     const dx       = Math.floor(contVal);                        // the day
//     const _colFrac = contVal - Math.floor(contVal);
//     dropHour       = Math.round((workStartH + _colFrac * totalWorkH) * 2) / 2;   // the hour
//
// They disagree at a boundary. `_origColOffset` is
// `max(0, startHour - workStartH) / totalWorkH`, which is EXACTLY ZERO for a bar
// that starts at 08:00 — its left edge sits on a column boundary with no
// cushion. Measured on a 120px column:
//
//     pxDx  -1  ->  day -1, 16:30      <-- PREVIOUS DAY
//     pxDx   0  ->  day  0, 08:00
//     pxDx   3  ->  day  0, 08:00
//
// A one-pixel leftward tremor on mouse-up — routine — relocated the op a full
// day backwards. The band yielding "08:00, same day" was pxDx 0..3.25, 2.7% of
// the column, one-sided. A bar starting at 12:30 has no cliff at all, because
// its offset is mid-column.
//
// The code had already unified the COORDINATE BASIS for exactly this reason
// ("Derive the intra-day hour offset from the SAME delta-based column value the
// day snap uses"). It left two roundings of that one value.
//
// THE PROPERTY, the mirror of #389's: FOR A BAR AT ANY _origColOffset, THE DAY
// AND THE HOUR MUST DESCRIBE THE SAME PLACE — both equal to the ONE rounded
// continuous position. Monotonicity and the absence of day-sized jumps follow
// from that; they are asserted too, but they are consequences.
//
// CONSISTENCY, NOT SMOOTHNESS, AND THAT CORRECTION COST A DRAFT. The first
// version of this suite measured only the working-hours axis and the red proof
// came back GREEN — because (day −1, 17:00) and (day 0, 08:00) are the SAME
// POINT on that axis. The axis was never discontinuous. What differs is the
// DATE, which is what gets stored and what Trey sees, and it only becomes
// visible once #389's clamp pulls 17:00 back to 16:30: the hour moves half an
// hour, the day cannot follow, and the landing settles a day early. Measuring
// the smooth quantity and calling it the symptom is LESSONS #11 in miniature.
//
//   node scripts/column-snap-test.mjs
import { buildDayWindows, snapWorkHourPosition, clampStartHour, productiveHoursLeftInDay, CLOCK_EPS } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const MTX = buildDayWindows(8, 17,
  [{ time: "10:00", durationMinutes: 15 }, { time: "15:00", durationMinutes: 15 }],
  { time: "12:00", durationMinutes: 60 });
const TOTAL = MTX.workEndH - MTX.workStartH;      // 9
const CW = 120;                                   // column width in px
const STEP = 0.5;

// The landing as ONE number on the working-hours axis, so "a day-sized jump" is
// measurable rather than a matter of opinion.
const axis = ({ dayOffset, hour }) => dayOffset * TOTAL + (hour - MTX.workStartH);

// THE FIX: one rounding, day and hour both derived from the result.
const land = (pxDx, origColOffset) =>
  snapWorkHourPosition((pxDx / CW + origColOffset) * TOTAL, MTX, STEP);

// THE OLD FORMULA, kept verbatim as the red proof.
const landOld = (pxDx, origColOffset) => {
  const contVal = pxDx / CW + origColOffset;
  const dayOffset = Math.floor(contVal);                       // rounding ONE: the day
  const colFrac = Math.min(0.9999, Math.max(0, contVal - Math.floor(contVal)));
  const hour = Math.round(Math.max(0, MTX.workStartH + colFrac * TOTAL) * 2) / 2;  // rounding TWO
  // …and #389's clamp on top, which is what was SHIPPED when Trey retested and
  // reported 8am still broken. It is load-bearing for the red proof: without it
  // the old pair reads (day −1, 17:00), which sits at the same point on the axis
  // as (day 0, 08:00) and looks harmless. The clamp pulls the HOUR back half an
  // hour, but it cannot pull the DAY forward — so the landing settles a day early.
  return { dayOffset, hour: clampStartHour(hour, MTX, STEP) };
};

// The ONE value both ought to describe: the continuous position, snapped once.
const snappedAxis = (pxDx, origColOffset) =>
  Math.round(((pxDx / CW + origColOffset) * TOTAL) / STEP) * STEP;

const sweep = (fn, offset) => {
  const out = [];
  for (let px = -2 * CW; px <= 2 * CW; px++) out.push({ px, ...fn(px, offset) });
  return out;
};
const worstJump = (rows) => {
  let worst = 0, at = null;
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(axis(rows[i]) - axis(rows[i - 1]));
    if (d > worst) { worst = d; at = rows[i].px; }
  }
  return { worst: +worst.toFixed(6), at };
};
const isMonotonic = (rows) => rows.every((r, i) => i === 0 || axis(r) >= axis(rows[i - 1]) - 1e-9);

console.log("\n1. THE PROPERTY — monotonic, no day-sized jumps, at EVERY bar offset");
{
  // 0 is the bar starting at 08:00 — the one with no cushion. The rest are
  // included so the fix cannot be a special case bolted onto zero.
  for (const off of [0, 0.125, 0.25, 0.5, 0.75, 0.9]) {
    const rows = sweep(land, off);
    ok(`offset ${off}: the landing never goes backwards as the cursor goes right`, isMonotonic(rows), true);
    const { worst } = worstJump(rows);
    ok(`offset ${off}: no adjacent pixel moves it more than one ${STEP}h slot`, worst <= STEP + 1e-9, true);
    // THE ONE THAT MATTERS, and the one my first draft of this suite missed: the
    // DAY and the HOUR must describe the same place. The axis alone does not
    // catch the bug — (day −1, 17:00) and (day 0, 08:00) are the SAME point on
    // it — but they are different DATES, and the date is what gets stored and
    // what Trey sees. Consistency is the property; smoothness is a consequence.
    const inconsistent = rows.filter(r => Math.abs(axis(r) - snappedAxis(r.px, off)) > 1e-9);
    ok(`offset ${off}: the day and the hour agree with the single rounded position`, inconsistent.length, 0);
    if (inconsistent.length) console.log(`         e.g. px ${inconsistent[0].px}: day ${inconsistent[0].dayOffset} hour ${inconsistent[0].hour} vs axis ${snappedAxis(inconsistent[0].px, off)}`);
  }
}

console.log("\n2. RED PROOF — the two-rounding formula, same sweep");
{
  // The exact rows from the investigation table, as shipped.
  ok("RED: one pixel left of the boundary lands on the PREVIOUS day", landOld(-1, 0), { dayOffset: -1, hour: 16.5 });
  ok("...while the boundary itself lands on 08:00", landOld(0, 0), { dayOffset: 0, hour: 8 });
  ok("...so ONE PIXEL changes the DATE", landOld(-1, 0).dayOffset !== landOld(0, 0).dayOffset, true);
  // And it is inconsistent with its own continuous position: the cursor is
  // 0.075h before the boundary, which snaps to 0 — the day's start — yet the
  // pair says half an hour BEFORE that, on the previous day.
  ok("RED: the old pair disagrees with the one rounded position",
    +(axis(landOld(-1, 0)) - snappedAxis(-1, 0)).toFixed(4), -0.5);
  const rows = sweep(landOld, 0);
  const bad = rows.filter(r => Math.abs(axis(r) - snappedAxis(r.px, 0)) > 1e-9);
  ok("RED: and it disagrees at every column boundary in the sweep", bad.length > 0, true);
  ok("...while the fix agrees everywhere",
    sweep(land, 0).filter(r => Math.abs(axis(r) - snappedAxis(r.px, 0)) > 1e-9).length, 0);
  // And the contrast that located it: a mid-column bar never had the cliff.
  ok("RED: a bar at 12:30 was always fine, which is why it looked time-specific",
    worstJump(sweep(landOld, 0.5)).worst <= STEP + 1e-9, true);
}

console.log("\n3. The 08:00 landing band is now symmetric, not one-sided");
{
  const band = [];
  for (let px = -CW; px <= CW; px += 0.25) {
    const l = land(px, 0);
    if (l.dayOffset === 0 && l.hour === 8) band.push(px);
  }
  const lo = Math.min(...band), hi = Math.max(...band);
  ok("the band straddles the boundary instead of starting at it", lo < 0, true);
  ok("...by a quarter hour of travel on each side",
    [Math.abs(lo) >= (0.25 / TOTAL) * CW - 0.5, hi >= (0.25 / TOTAL) * CW - 0.5], [true, true]);
  // The old band was 0..3.25px. The new one must be wider AND centred.
  ok("...and is wider than the old 3.25px sliver", hi - lo > 3.25, true);
  ok("a one-pixel tremor no longer changes the day", land(-1, 0).dayOffset, 0);
  ok("...nor the hour", land(-1, 0).hour, 8);
}

console.log("\n4. #389 IS NOT REGRESSED — no drop lands on an hour with no work in it");
{
  const bad = [];
  for (const off of [0, 0.25, 0.5, 0.75]) {
    for (let px = -2 * CW; px <= 2 * CW; px += 0.5) {
      const l = land(px, off);
      if (productiveHoursLeftInDay(l.hour, MTX) <= CLOCK_EPS) bad.push({ px, off, ...l });
    }
  }
  ok("no landing has zero work time left in the day", bad.length, 0);
  if (bad.length) console.log(`         e.g. ${JSON.stringify(bad[0])}`);
  // 17:00 is now unreachable by construction — the hour is derived from a value
  // already reduced modulo the day — but a dead window butting the day's end can
  // still make a legal-looking hour illegal, which is what clampStartHour is for.
  const late = buildDayWindows(8, 17, [], { time: "16:00", durationMinutes: 60 });
  const lateTotal = 9;
  const l = snapWorkHourPosition(0.999 * lateTotal, late, STEP);
  ok("with lunch at 16:00–17:00 the last legal start is still honoured",
    productiveHoursLeftInDay(l.hour, late) > 0, true);
}

console.log("\n5. The same helper serves the dependency snap (_phiInv's pattern)");
{
  // _phiInv did `Math.floor(clock / totalWorkH)` for the day and
  // `Math.round((workStartH + hrOff) * 2) / 2` for the hour — the same two
  // roundings of the same quantity, so the same cliff, which is why #389 needed
  // a choke point rather than a patch at one site.
  const old_phiInv = (clock) => {
    const bdOff = Math.floor(clock / TOTAL);
    const hrOff = clock - bdOff * TOTAL;
    return { dayOffset: bdOff, hour: Math.round((MTX.workStartH + hrOff) * 2) / 2 };
  };
  ok("RED: _phiInv's old form jumps a day just below a boundary",
    old_phiInv(-0.01), { dayOffset: -1, hour: 17 });
  ok("...and could produce 17:00, which has no work in it", productiveHoursLeftInDay(17, MTX), 0);
  ok("the helper rounds that to the day's start instead",
    snapWorkHourPosition(-0.01, MTX, STEP), { dayOffset: 0, hour: 8 });
  ok("...and a real step back is still a real step back",
    snapWorkHourPosition(-4.5, MTX, STEP), { dayOffset: -1, hour: 12.5 });
}

console.log("\n6. The drag derives day and hour from ONE rounding");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("TRAQS.jsx imports the shared snap", /snapWorkHourPosition/.test(CODE), true);
  // The old pattern, gone from all three sites. Asserted as ABSENCE of the
  // floor, because that is the half that picked the wrong day.
  ok("no `Math.floor(... / liveCW + _origColOffset)` remains",
    /Math\.floor\(\s*px[A-Za-z0-9]*\s*\/\s*liveCW\s*\+\s*_origColOffset\s*\)/.test(CODE), false);
  ok("no `_colFrac` intra-day fraction remains", /_colFrac/.test(CODE), false);
  ok("_phiInv no longer floors by totalWorkH itself",
    /const bdOff = Math\.floor\(clock \/ totalWorkH\)/.test(CODE), false);
  ok("...and uses the shared snap", /_phiInv = \(clock\) => \{[\s\S]{0,300}?snapWorkHourPosition/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
