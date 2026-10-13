// #505, CORRECTED 2026-10-13. Trey's rule:
//   BREAK — pay keeps running, PRODUCTION STOPS.
//   LUNCH — both stop.
//
// #505 shipped two changes together, and only one was right:
//
//   (1) the SCHEDULED window — RIGHT, and kept. sessionWorkedHours took its
//       gross from productiveHoursBetween, which strips the org's dead windows
//       (lunch AND both breaks) from a MEASURED span. A worker who worked
//       through lunch and clocked nothing lost it anyway. A measured session
//       takes its RECORDED pauses, not the shop's estimate of them.
//   (2) the CLOCKED pause — WRONG, and reverted. #505 stopped a clocked break
//       pausing the job clock, so a break stayed in production. It pauses again
//       (applyBreakJobPause at the server's five break sites).
//
// THE TWO FIXES MUST LAND TOGETHER OR LUNCH IS COUNTED AS WORK. Before, gross
// removed the scheduled lunch and `manualH` deliberately EXCLUDED the auto
// share so it was not subtracted twice. Once gross stops removing it, that
// exclusion becomes the bug in the other direction — so the subtraction is now
// the FULL recorded pause. Section 3 is that property, and it is the one a
// half-applied fix breaks.
//
//   node scripts/break-lunch-ledger-test.mjs
import { readFileSync } from "node:fs";
import { sessionWorkedHours, buildDayWindows } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const H = 3600000;
// Matrix's real shop: 08:00-17:00, 60min lunch at 12:00, 15min breaks at 10:00 and 14:00.
const cfg = {
  ...buildDayWindows(8, 17, [{ durationMinutes: 15, time: "10:00" }, { durationMinutes: 15, time: "14:00" }],
    { durationMinutes: 60, time: "12:00" }),
  workStartH: 8, workEndH: 17, workDays: [1, 2, 3, 4, 5], holidays: [], timeZone: "America/Denver",
};
// 2026-08-03 is a Monday.
const at = (h, m = 0) => Date.parse(`2026-08-03T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-06:00`);
const hrs = (o) => sessionWorkedHours({ cfg, ...o }).hours;

console.log("\n1. A MEASURED SESSION IS NOT CHARGED FOR A BREAK IT DID NOT TAKE");
{
  // 08:00-17:00 spans the whole shop day, which holds 1.5h of scheduled dead
  // windows. Nothing was clocked, so nothing comes off.
  ok("a full day with no pause clocked credits the whole day", hrs({ clockInMs: at(8), clockOutMs: at(17) }), 9);
  ok("a half day with no pause clocked credits the whole half", hrs({ clockInMs: at(8), clockOutMs: at(12) }), 4);
  // The window straddles both breaks and lunch; still nothing clocked.
  ok("09:00-16:00 with nothing clocked credits 7h", hrs({ clockInMs: at(9), clockOutMs: at(16) }), 7);
}

console.log("\n2. A CLOCKED BREAK COMES OFF PRODUCTION — EXACTLY ONCE");
{
  // The break pauses the job clock, so it reaches totalPausedMs (and, being
  // automatic, autoPausedMs). The gross no longer strips the scheduled break
  // windows (section 1), so the recorded pause is the ONLY removal — which is
  // what makes the full subtraction safe. The trap #505 named was a break
  // removed twice: once as a scheduled window, once as a clocked pause. With no
  // scheduled window in the gross, there is nothing for it to double with.
  const Q = 0.25 * H;
  ok("one 15m break clocked at 10:00 — inside the scheduled window — comes off once",
    hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: Q, autoPausedMs: Q }), 8.75);
  ok("two 15m breaks clocked come off as 30m", hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: 2 * Q, autoPausedMs: 2 * Q }), 8.5);
  ok("a break clocked OUTSIDE the scheduled windows comes off the same", hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: Q, autoPausedMs: Q }), 8.75);
  ok("breaks and a 1h lunch, all clocked, come off once each",
    hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: 2 * Q + H, autoPausedMs: 2 * Q + H }), 7.5);
  ok("a break NOT clocked takes nothing off (no scheduled estimate)", hrs({ clockInMs: at(8), clockOutMs: at(17) }), 9);
}

console.log("\n3. A CLOCKED LUNCH COMES OFF, EXACTLY ONCE");
{
  // THE PROPERTY A HALF-APPLIED FIX BREAKS. Lunch still pauses the job clock,
  // so it arrives as totalPausedMs (and autoPausedMs). With the scheduled
  // window no longer removed from gross, the FULL recorded pause must now be
  // subtracted — if the old `total - auto` survives, lunch is counted as work.
  ok("a 1h clocked lunch comes off", hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: 1 * H, autoPausedMs: 1 * H }), 8);
  ok("a 40m lunch comes off as 40m, not as the scheduled 60m",
    hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: (40 / 60) * H, autoPausedMs: (40 / 60) * H }), 8.33);
  ok("a deliberate manual hold still comes off",
    hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: 2 * H, autoPausedMs: 0 }), 7);
  ok("lunch AND a manual hold both come off",
    hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: 2 * H, autoPausedMs: 1 * H }), 7);
  // A legacy row carries everything in totalPausedMs and no autoPausedMs. Under
  // the new rule that is simply "2h of pause", which is the right answer for it
  // too — the #199 double-subtraction has nothing left to double.
  ok("a legacy row with no autoPausedMs is no longer double-subtracted",
    hrs({ clockInMs: at(8), clockOutMs: at(17), totalPausedMs: 2 * H }), 7);
}

console.log("\n4. #194 IS NOT RE-BROKEN — the calendar still bounds the window");
{
  // The reason productiveHoursBetween is there at all: a Friday session closed
  // on Monday credited 67.84h. Only the INTRA-DAY windows were dropped.
  const friday = Date.parse("2026-07-31T15:00:00-06:00");     // Fri 15:00
  const monday = Date.parse("2026-08-03T09:00:00-06:00");     // Mon 09:00
  const r = sessionWorkedHours({ clockInMs: friday, clockOutMs: monday, cfg });
  ok("a Friday-afternoon session closed on Monday is capped at end of day", r.hours, 2);
  ok("...and is reported unclosed", r.unclosed, true);
  ok("a session over a weekend does not credit the weekend", r.hours <= 2, true);
}

console.log("\n5. A BREAK PAUSES THE JOB CLOCK AGAIN — at every one of the five sites");
{
  // Pinned by SITE. There are five, and a count alone would stay green with the
  // wrong five (R4).
  const TC = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8");
  ok("the break alias exists, beside lunch's",
    /const applyBreakJobPause = \(person, starting, nowIso\) => applyAutoJobPause\(person, "break", starting, nowIso\);/.test(TC), true);
  ok("admin break events pause / resume it (admin handler)",
    /albIsLunch \? applyLunchJobPause\(withEvent, evtType === "lunchStart", albTimestamp\) : applyBreakJobPause\(withEvent, evtType === "breakStart", albTimestamp\)/.test(TC), true);
  ok("breakBegin pauses it (kiosk / phone break pill)",
    /applyBreakJobPause\(\{ \.\.\.fresh, activeBreak: \{ startedAt: bbStart, durationMinutes: bbMinutes \} \}, true, bbStart\)/.test(TC), true);
  ok("breakClear resumes it",
    /applyBreakJobPause\(\{ \.\.\.fresh, activeBreak: null \}, false, bcEnd\)/.test(TC), true);
  ok("breakStart pauses it", /applyBreakJobPause\([\s\S]{0,260}?type: "breakStart", ts: timestamp/.test(TC), true);
  ok("breakEnd resumes it", /applyBreakJobPause\([\s\S]{0,260}?type: "breakEnd", ts: timestamp/.test(TC), true);
  ok("no #505 'not paused' comment survives at a break site",
    /#505: (a break does not pause the job clock|nothing to resume|recorded, not paused)/.test(TC), false);
  // Lunch must keep doing exactly what it did.
  // REWRITTEN FOR #292, which moved these into mutatePersonFresh. The old
  // assertions pinned the literal call text (`{ ...person, activeClockIn: ... }`)
  // and went red on a change that altered no behaviour — a pattern scoped to a
  // shape rather than to the thing it is about. What matters is that the LUNCH
  // events reach applyLunchJobPause and the BREAK events do not.
  ok("lunchStart still pauses the job clock", /applyLunchJobPause\([\s\S]{0,260}?type: "lunchStart"/.test(TC), true);
  ok("lunchEnd still resumes it", /applyLunchJobPause\([\s\S]{0,260}?type: "lunchEnd"/.test(TC), true);
  ok("...and a break still reaches neither", /applyLunchJobPause\([\s\S]{0,260}?type: "break/.test(TC), false);
  ok("the lunch alias survives", /const applyLunchJobPause = \(person, starting, nowIso\) => applyAutoJobPause\(person, "lunch", starting, nowIso\);/.test(TC), true);
}

console.log("\n6. THE PAY LEDGER IS NOT TOUCHED, AND MUST NEVER CONSULT A CALENDAR");
{
  // A finding in its own right (#506): pay subtracts ACTUAL clocked lunch and
  // nothing else — 346 of 347 live punches match that to the cent. Pinned so
  // nobody "fixes" it into consistency with the job ledger later.
  const TC = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8");
  const payFns = /function hoursElapsedMinusPauses\(([^)]*)\)/.exec(TC);
  ok("hoursElapsedMinusPauses takes no cfg", /cfg|settings|deadWindows/.test(payFns?.[1] || ""), false);
  const netFn = /function netHoursForPunch\(([^)]*)\)/.exec(TC);
  ok("netHoursForPunch takes no cfg", /cfg|settings|deadWindows/.test(netFn?.[1] || ""), false);
  ok("neither pay function calls productiveHoursBetween",
    /function (hoursElapsedMinusPauses|netHoursForPunch)[\s\S]{0,400}productiveHoursBetween/.test(TC), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
