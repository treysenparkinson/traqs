// productiveClockHours clips to the working day, as WorkDayClock.productiveHours does — #359.
//
// The JS took the raw span `b − a` and subtracted dead windows; the Swift clamps a and b to
// [workStart, workEnd] first. They agreed inside the day — the only way today's callers use it —
// and differed for any span reaching outside it: 06:00–09:00 on a 07:00 day was 3 hours in JS
// and 2 in Swift. The JS clamps now, and the parity fixture carries out-of-day pairs so the
// Swift suite holds both sides to it.
//
//   node scripts/clock-hours-clip-test.mjs

import { productiveClockHours, buildDayWindows } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
// 07:00–15:00, a 15-minute break at 10:00 and 30 minutes of lunch at 12:00.
const cfg = buildDayWindows(7, 15, [{ time: "10:00", durationMinutes: 15 }], { time: "12:00", durationMinutes: 30 });

ok("inside the day: unchanged (09:00–11:00 around the break is 1.75 h)", near(productiveClockHours(9, 11, cfg), 1.75));
ok("#359 a span starting before work start counts from work start (06:00–09:00 is 2 h)", near(productiveClockHours(6, 9, cfg), 2));
ok("#359 a span ending after work end stops at work end (14:00–18:00 is 1 h)", near(productiveClockHours(14, 18, cfg), 1));
ok("#359 a span covering the whole day and more is the productive day (7.25 h)", near(productiveClockHours(4, 22, cfg), 7.25));
ok("#359 a span wholly outside the day is nothing", near(productiveClockHours(16, 20, cfg), 0) && near(productiveClockHours(3, 6, cfg), 0));
ok("a backwards span is nothing", near(productiveClockHours(11, 9, cfg), 0));
ok("a cfg with no working window does not turn into NaN", Number.isFinite(productiveClockHours(9, 11, { deadWindows: [] })));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
