// Worked time is only counted while somebody is actually on the job.
//
// liveOpHours read RAW WALL-CLOCK elapsed -- now minus clock-in. A session nobody
// closed kept accruing through the evening, the night and the weekend, so a bar
// quietly converted unworked time into worked time around the clock. A clock left
// open on Friday afternoon read about 64 hours by Monday and the hatch ate the
// whole bar with work nobody did.
//
// It was also the wrong unit: `hpd` is PRODUCTIVE hours (workday minus breaks and
// lunch) and workedFraction is shown/hpd, so wall-clock over productive hours is
// not a fraction of anything.
//
//   node scripts/job-live-hours-test.mjs
import { readFileSync } from "node:fs";
import { productiveHoursBetween, openSessionEnd, liveElapsedHours } from "../src/statsMath.js";
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// ── wiring ───────────────────────────────────────────────────────────────────
const FN = S.slice(S.indexOf("const liveOpHours = (op) => {"), S.indexOf("const liveOpHours = (op) => {") + 900);
ok("live job hours are bounded by openSessionEnd", FN.includes("openSessionEnd({"));
ok("...and measured in productive hours", FN.includes("productiveHoursBetween(startMs, endMs, liveJobCfg)"));
ok("...not raw wall clock", !FN.includes("liveElapsedHours"));
// The bound has to be the SAME one the bar geometry already uses, or a forgotten
// session freezes on one and keeps growing on the other.
ok("the hours use the same Q7b bound the geometry does",
  (S.match(/openSessionEnd\(\{/g) || []).length >= 4);
ok("the config carries work days and holidays, not just the day window",
  S.includes("const liveJobCfg = { ...dayWindowCfg, workDays: orgSettings.workDays || DEFAULT_WORK_DAYS, holidays: orgSettings.holidays || [] };"));
// The payroll clock legitimately measures wall clock; only the JOB clock changed.
ok("the payroll clock still measures wall clock", S.includes("liveElapsedHours({"));
// Sessions are left open on purpose: people do work late.
ok("nothing here closes the session", !/clockOut|activeJobClock: null/.test(FN));
// forgot-clockout.js is what notices a forgotten clock, and it deliberately only
// notifies. Counting it correctly is a separate thing from ending it.
ok("...and the after-hours notice is still the thing that notices",
  readFileSync(new URL("../netlify/functions/forgot-clockout.js", import.meta.url), "utf8")
    .includes("Never closes or"));

// ── the arithmetic ───────────────────────────────────────────────────────────
// A 07:00-15:00 shop, half an hour of lunch at 12:00, Monday to Friday.
const cfg = { workStartH: 7, workEndH: 15, deadWindows: [{ start: 12, dur: 0.5 }], workDays: [1, 2, 3, 4, 5], holidays: [] };
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
const live = (clockInMs, nowMs, jc = {}) => {
  const { endMs } = openSessionEnd({ clockInMs, pausedAt: jc.pausedAt, frozenAtMs: jc.frozenAtMs, nowMs, cfg });
  return productiveHoursBetween(clockInMs, endMs, cfg);
};
// 2026-09-25 is a Friday, 2026-09-28 the Monday after.
const friPM = at(2026, 9, 25, 13, 0);
const monAM = at(2026, 9, 28, 9, 0);

const wall = liveElapsedHours({ clockIn: new Date(friPM).toISOString(), now: monAM });
ok(`wall clock really did read ~${wall.toFixed(0)}h across the weekend`, wall > 60);
const worked = live(friPM, monAM);
ok("...while the productive answer is Friday afternoon only", Math.abs(worked - 2) < 0.01);
ok("...so the weekend counts for nothing", worked < wall / 30);

// Bounded to the day it STARTED on, so an unclosed session does not renew daily.
ok("a session open for three days still only holds that first afternoon",
  Math.abs(live(friPM, at(2026, 9, 30, 12, 0)) - 2) < 0.01);

// The ordinary case is untouched: a live session during the shift still accrues.
ok("a session running right now still counts", Math.abs(live(at(2026, 9, 28, 8, 0), at(2026, 9, 28, 11, 0)) - 3) < 0.01);
ok("...and lunch comes off it", Math.abs(live(at(2026, 9, 28, 11, 0), at(2026, 9, 28, 14, 0)) - 2.5) < 0.01);
ok("...and it stops at the end of the working day", Math.abs(live(at(2026, 9, 28, 14, 0), at(2026, 9, 28, 20, 0)) - 1) < 0.01);
// An open pause stops it where the work stopped.
ok("a paused clock stops accruing",
  Math.abs(live(at(2026, 9, 28, 8, 0), at(2026, 9, 28, 13, 0), { pausedAt: at(2026, 9, 28, 10, 0) }) - 2) < 0.01);
// A held session (pendingFinish) pins where it was frozen.
ok("a frozen clock pins where it froze",
  Math.abs(live(at(2026, 9, 28, 8, 0), at(2026, 9, 28, 13, 0), { frozenAtMs: at(2026, 9, 28, 9, 30) }) - 1.5) < 0.01);
ok("a clock-in with no timestamp counts nothing", live(NaN, monAM) === 0);

// ── the unit, which is the whole point ───────────────────────────────────────
// workedFraction is shown/hpd. hpd is productive hours, so shown must be too, or
// the fraction is wall clock over productive hours and means nothing.
{
  const hpd = 8;                                  // an eight productive-hour estimate
  const shownOld = liveElapsedHours({ clockIn: new Date(friPM).toISOString(), now: monAM });
  const shownNew = live(friPM, monAM);
  ok("the old number filled the whole bar by Monday", Math.min(1, shownOld / hpd) === 1);
  ok("...while the new one is the quarter that was actually worked", Math.abs(Math.min(1, shownNew / hpd) - 0.25) < 0.01);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
