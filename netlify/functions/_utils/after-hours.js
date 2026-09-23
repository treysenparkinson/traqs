// When a still-running job clock should raise the "clocked in after hours" push.
//
// Pure (no S3, no clock reads) so the timezone arithmetic can be exercised on its
// own — forgot-clockout.js is the only caller.
//
// The rule, for a session that clocked in at `clockIn`:
//   • Clocked in BEFORE the shop's end of day → alert GRACE_MS after that end of day.
//   • Clocked in AT/AFTER end of day → deliberate after-hours work, so that day's
//     end does not count; the next day's end of day does.
//   • Either way, never later than BACKSTOP_MS after clock-in. That is what catches
//     a 7pm clock-in left running overnight, which the rule above would not reach
//     until the following evening.
//
// With no org timeZone configured there is no way to know when the shop's day
// ends (the server runs on UTC), so only the backstop applies.

export const GRACE_MS = 30 * 60 * 1000;
export const BACKSTOP_MS = 12 * 60 * 60 * 1000;
// Matches the web app's fallback when an org has never set working hours.
export const DEFAULT_WORK_END = "15:00";

// Offset (ms) of `timeZone` from UTC at instant `ms`: local wall clock minus UTC.
function tzOffsetMs(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms)).map(p => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// The UTC instant at which the wall clock in `timeZone` reads `day` (YYYY-MM-DD) at `hhmm`.
// Offset is resolved twice so a date on the far side of a DST change lands correctly.
export function zonedTimeToUtcMs(day, hhmm, timeZone) {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = String(hhmm).split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h || 0, mi || 0);
  let utc = wall - tzOffsetMs(wall, timeZone);
  utc = wall - tzOffsetMs(utc, timeZone);
  return utc;
}

// YYYY-MM-DD of instant `ms` in `timeZone`.
export function zonedDay(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function nextDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// ms timestamp at which to alert, or null when clockIn is unusable.
export function afterHoursAlertAt(clockIn, { workEnd, timeZone } = {}) {
  const ciMs = new Date(clockIn).getTime();
  if (!Number.isFinite(ciMs)) return null;
  const backstop = ciMs + BACKSTOP_MS;
  if (!timeZone) return backstop;
  try {
    const end = /^\d{1,2}:\d{2}$/.test(String(workEnd || "")) ? workEnd : DEFAULT_WORK_END;
    const day = zonedDay(ciMs, timeZone);
    let eod = zonedTimeToUtcMs(day, end, timeZone);
    if (ciMs >= eod) eod = zonedTimeToUtcMs(nextDay(day), end, timeZone);
    return Math.min(eod + GRACE_MS, backstop);
  } catch {
    return backstop;   // bad IANA name — fall back rather than never alerting
  }
}
