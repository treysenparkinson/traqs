// What the health dot means (#440).
//
// ─── THE CORRECTION THIS FILE EXISTS BECAUSE OF ───
//
// The entry said the dot "reports a data-entry state rather than a work state"
// and that 142 units were ONE DAY from red. Both were wrong.
//
// MEASURED: 133 of 182 dated units are genuinely past their end date and
// unfinished — median 130 days, 75 of them beyond 90. And FOUR DIFFERENT RULES
// produce that same 133: today's; dropping the "Not Started" short-circuit; red
// purely on the end date; adding a last-working-day amber. **If the thresholds
// were the fault, changing them would move the number.** They are not. The dot
// was not lying about any single unit.
//
// WHAT IS WRONG IS THE LEVEL IT ASKS AT. 110 of the 133 sit on a job in a
// terminal status: the job shipped, its operations were never individually
// closed, and nothing consulted the parent. The dot judged each one against a
// schedule that stopped mattering the day the job left the building.
//
//     ask the parent, Finished/Shipped only:  red 133 -> 42, on-time 27% -> 74%
//
// ─── THE STATES, IN THE ORDER THEY ARE DECIDED ───
//
//   done      finished, or on a job that is finished — nothing to say
//   notyet    has not reached its start date, or has no dates. NOT JUDGED, and
//             deliberately not counted as on time: 12 units were inflating the
//             KPI by not having begun.
//   critical  its end date has passed and it is still open. LATE is a fact
//             about the calendar, not an inference about progress.
//   behind    inside its window, over half gone, nothing booked against it.
//   ontime    none of the above.
//
// Order matters and is asserted: a closed job beats a unit's own status, which
// beats the calendar.

import { isClosedStatus } from "./statusText.js";

/**
 * @param {object} unit  the op or panel
 * @param {object} ctx   { today, jobStatus, pctDone }
 *   `jobStatus` is the PARENT job's status — the whole point of the fix. Absent
 *   means "not known", which degrades to judging the unit alone rather than
 *   guessing the job is open.
 *   `pctDone` is real progress 0..1 where the caller can supply it. Absent is
 *   treated as nothing logged, which only ever affects the amber warning.
 */
export function healthState(unit, { today, jobStatus = null, pctDone = null } = {}) {
  if (!unit) return "notyet";
  if (isClosedStatus(unit.status)) return "done";
  if (jobStatus != null && isClosedStatus(jobStatus)) return "done";

  const { start, end } = unit;
  if (!start || !end) return "notyet";          // no dates — nothing to measure against
  if (today < start) return "notyet";           // has not begun
  if (today > end) return "critical";           // its date passed and it is still open

  // Inside the window. The only question left is whether anything is happening,
  // and the answer is deliberately coarse: a day-by-day burn-down would need
  // hours data this product does not reliably have (`loggedHours` is documented
  // unreliable), so the warning fires on "half the window gone and nothing
  // booked" rather than pretending to a precision it cannot support.
  const done = typeof pctDone === "number" ? pctDone : 0;
  if (done > 0) return "ontime";
  const total = Math.max(dayCount(start, end), 1);
  const gone = Math.max(dayCount(start, today), 1);
  return gone / total > 0.5 ? "behind" : "ontime";
}

// Calendar days, not working days. The warning is a nudge rather than a
// measurement, and a working-day count here would need the org's calendar
// threaded through every caller for a difference of at most a day or two.
function dayCount(a, b) {
  const ms = Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z");
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) + 1 : 1;
}

/**
 * Whether a state should be counted in an on-time percentage at all.
 *
 * `notyet` is EXCLUDED rather than counted as on time. Today the dashboard tile
 * and the employee page both count work that has not started as a success,
 * which is a KPI flattering itself — 12 of Matrix's 182 units.
 */
export function isJudged(state) {
  return state !== "notyet";
}

/** Whether a judged state is a success. */
export function countsAsOnTime(state) {
  return state === "ontime" || state === "done";
}
