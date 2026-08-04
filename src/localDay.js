// Which calendar day an instant belongs to, in the shop's timezone.
//
// Mirrors `orgLocalDay` in netlify/functions/timeclock.js — the server stamps
// `date` on a row and the client buckets by day, so the two must agree or a
// shift lands in one day's column and is summed under another. (Same
// deliberate-duplication arrangement as statsMath.js ↔ StatsMath.swift; the
// functions bundle does not share modules with the app bundle.)
//
// The bug this replaces: reading the day off a UTC timestamp with
// `iso.slice(0, 10)`. That is the shop's day only for a shop on UTC. At UTC-6,
// everything from 18:00 local onward is stamped with tomorrow's date — an
// 18:23-21:53 shift was filed on the following day, so the day it was worked
// reported 8.7h of a 12.2h total and the missing 3.5h appeared on a day the
// worker had not started yet.

/**
 * @param {string} iso     an ISO timestamp
 * @param {string|null} timeZone  IANA zone, e.g. "America/Denver". Falsy → UTC.
 * @returns {string} "YYYY-MM-DD"
 */
export function localDay(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "").slice(0, 10);
  // No zone configured → the previous UTC behaviour, so an org that has not set
  // one keeps exactly the numbers it has today rather than silently shifting to
  // a timezone nobody picked.
  if (!timeZone) return d.toISOString().slice(0, 10);
  try {
    // en-CA renders YYYY-MM-DD, matching the day keys used everywhere else.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);   // unknown IANA name — don't lose the row
  }
}

/**
 * The zone to bucket by: the org's configured zone, else this device's own.
 *
 * Falling back to the device keeps a day boundary that matches what the person
 * looking at the screen calls "today", which is strictly better than UTC for
 * every shop that is not on UTC. The SERVER cannot make that guess — it has no
 * device — which is why the stored `date` falls back to UTC instead.
 */
export function resolveTimeZone(orgTimeZone) {
  if (orgTimeZone) return orgTimeZone;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}
