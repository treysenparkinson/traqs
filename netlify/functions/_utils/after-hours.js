// When a still-running job clock should raise the "clocked in after hours" push.
//
// Pure (no S3, no clock reads) so the timezone arithmetic can be exercised on its
// own — forgot-clockout.js is the only caller.
//
// The rule, for a session that clocked in at `clockIn`:
//   • The session's end of day is THE end-of-day rule, shopTime.endOfDayFor (#215) —
//     the same instant the web freezes the session and marks it unclosed: workEnd on
//     the clock-in's shop day, or the next WORKING day's for a clock-in at or after it.
//   • Alert GRACE_MS after that. The grace is for the notification only.
//   • Never later than BACKSTOP_MS after clock-in. That is what catches a 7pm
//     clock-in left running overnight (or over a weekend), which the rule above
//     would not reach until the next working evening. Notification only, too.
//
// With no org timeZone configured there is no way to know when the shop's day
// ends (the server runs on UTC), so only the backstop applies.

import { DEFAULT_ORG_SETTINGS } from "../../../src/orgDefaults.js";
import { endOfDayFor, shopMs, shopDay } from "../../../src/shopTime.js";
import { workCalendar } from "../../../src/scheduleRules.js";

export const GRACE_MS = 30 * 60 * 1000;
export const BACKSTOP_MS = 12 * 60 * 60 * 1000;
// Matches the web app's fallback when an org has never set working hours.
// The org default (src/orgDefaults.js) — one value on every surface.
export const DEFAULT_WORK_END = DEFAULT_ORG_SETTINGS.workEnd;

// The UTC instant at which the wall clock in `timeZone` reads `day` (YYYY-MM-DD) at `hhmm`,
// and the YYYY-MM-DD of instant `ms` in `timeZone`. Both are shopTime.js — one zone
// conversion for the web and the server.
export function zonedTimeToUtcMs(day, hhmm, timeZone) {
  const [h, mi] = String(hhmm).split(":").map(Number);
  return shopMs(day, (h || 0) + (mi || 0) / 60, timeZone);
}

export function zonedDay(ms, timeZone) {
  return shopDay(ms, timeZone);
}

// ms timestamp at which to alert, or null when clockIn is unusable.
export function afterHoursAlertAt(clockIn, { workEnd, timeZone, workDays, holidays } = {}) {
  const ciMs = new Date(clockIn).getTime();
  if (!Number.isFinite(ciMs)) return null;
  const backstop = ciMs + BACKSTOP_MS;
  if (!timeZone) return backstop;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });   // a bad IANA name throws here → backstop
    const end = /^\d{1,2}:\d{2}$/.test(String(workEnd || "")) ? workEnd : DEFAULT_WORK_END;
    const [h, m] = end.split(":").map(Number);
    const cal = workCalendar({ workDays, holidays });
    const eod = endOfDayFor(ciMs, { workEndH: h + m / 60, timeZone, isWorkDay: cal.isWorkDay });
    return Math.min(eod + GRACE_MS, backstop);
  } catch {
    return backstop;   // bad IANA name — fall back rather than never alerting
  }
}
