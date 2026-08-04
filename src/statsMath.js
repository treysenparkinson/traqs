// Pure math behind the Stats/Analytics cards, kept out of TRAQS.jsx so it can be
// exercised directly. Mirrors `StatsMath` in the iOS app — the two platforms
// report the same numbers only if they run the same algorithm.

/**
 * Paid break hours bucketed by the calendar day each break STARTED.
 *
 * Rows are paired within each person's own sequence. Pairing everyone against a
 * single global cursor silently lost time whenever two people were on break at
 * once — the normal case, since a shop breaks together. One worker's start
 * overwrote another's, so the ends that followed either paired with the wrong
 * start or were dropped: fifteen workers taking fifteen minutes together
 * reported fifteen minutes instead of 3h45m, which inflated `working` and
 * pushed team efficiency down.
 *
 * An unpaired start is ignored rather than guessed at — the live accrual covers
 * a break that is still open right now.
 *
 * Days are keyed UTC (`toISOString().slice(0, 10)`), unchanged from the previous
 * implementation.
 *
 * @param {Array} timeclock  pay-clock rows, event rows included
 * @param {string|null} personId  null = the whole team
 * @returns {Object<string, number>} "YYYY-MM-DD" → hours
 */
export function breakHoursByDay(timeclock, personId) {
  const byPerson = new Map();
  (timeclock || [])
    .filter(e => e && !e.deletedAt
      && (e.eventType === "breakStart" || e.eventType === "breakEnd")
      && (personId == null || String(e.personId) === String(personId)))
    .forEach(e => {
      const t = new Date(e.timestamp).getTime();
      if (!t) return;
      const key = String(e.personId);
      if (!byPerson.has(key)) byPerson.set(key, []);
      byPerson.get(key).push({ type: e.eventType, t });
    });

  const out = {};
  for (const rows of byPerson.values()) {
    rows.sort((a, b) => a.t - b.t);
    let open = null;
    for (const ev of rows) {
      if (ev.type === "breakStart") open = ev.t;
      else if (open != null) {
        const day = new Date(open).toISOString().slice(0, 10);
        out[day] = (out[day] || 0) + Math.max(0, (ev.t - open) / 3600000);
        open = null;
      }
    }
  }
  return out;
}
