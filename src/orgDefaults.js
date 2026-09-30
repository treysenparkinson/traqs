// The org settings every surface falls back to — SCHEDULE_MAP root cause 6 (#213, #214).
//
// Shared by the web, the server (netlify/functions import src/) and statsMath. Pure,
// no imports. iOS mirrors it in OrgSettings.default.
//
// These are what a new org sees on first run: org creation seeds only the timezone and
// pay period, so the settings screen, the web, iOS and Android all show 07:00–15:00, a
// 30-minute lunch at noon and one 15-minute break at 10:00. Ten places used to carry
// their own fallback (08:00–17:00, 8–16, a 60-minute lunch, no breaks…), so a new org
// was 7.25 productive hours a day on the web and 7.5 on the server.
export const DEFAULT_ORG_SETTINGS = Object.freeze({
  workStart: "07:00",
  workEnd: "15:00",
  lunch: Object.freeze({ time: "12:00", durationMinutes: 30 }),
  breaks: Object.freeze([Object.freeze({ time: "10:00", durationMinutes: 15 })]),
  workDays: Object.freeze([1, 2, 3, 4, 5]),
  holidays: Object.freeze([]),
});

const HHMM = /^\d{1,2}:\d{2}$/;
const unset = (v) => v === undefined || v === null || v === "";

/**
 * `settings` with every work-schedule field filled from the defaults when it is
 * missing — and a stored null or empty value counts as missing, so a spread can't let
 * `workStart: null` through. An empty work week is missing too. An org that chose no
 * breaks (`breaks: []`) keeps none. Everything else in `settings` is passed through.
 */
export function withOrgDefaults(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  const d = DEFAULT_ORG_SETTINGS;
  const validDays = Array.isArray(s.workDays) ? s.workDays.filter(x => Number.isInteger(x) && x >= 0 && x <= 6) : [];
  // A lunch that is already valid is kept exactly as stored; only its missing parts fill in.
  const lunchTimeOk = s.lunch && HHMM.test(String(s.lunch.time || ""));
  const lunchDurOk = s.lunch && s.lunch.durationMinutes !== null && s.lunch.durationMinutes !== "" && Number.isFinite(Number(s.lunch.durationMinutes));
  const lunch = s.lunch && typeof s.lunch === "object"
    ? (lunchTimeOk && lunchDurOk ? s.lunch
      : { ...s.lunch, time: lunchTimeOk ? s.lunch.time : d.lunch.time, durationMinutes: lunchDurOk ? Number(s.lunch.durationMinutes) : d.lunch.durationMinutes })
    : { ...d.lunch };
  return {
    ...s,
    workStart: !unset(s.workStart) && HHMM.test(String(s.workStart)) ? s.workStart : d.workStart,
    workEnd: !unset(s.workEnd) && HHMM.test(String(s.workEnd)) ? s.workEnd : d.workEnd,
    lunch,
    breaks: Array.isArray(s.breaks) ? s.breaks : d.breaks.map(b => ({ ...b })),
    workDays: validDays.length ? validDays : [...d.workDays],
    holidays: Array.isArray(s.holidays) ? s.holidays : [],
  };
}
