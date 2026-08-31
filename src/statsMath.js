// Pure math behind the Stats/Analytics cards, kept out of TRAQS.jsx so it can be
// exercised directly. Mirrors `StatsMath` in the iOS app — the two platforms
// report the same numbers only if they run the same algorithm.

import { localDay } from "./localDay.js";

/**
 * Paid break hours bucketed by the calendar day each break STARTED,
 * including a break that is still running.
 *
 * Rows are paired within each person's own sequence. Pairing everyone against a
 * single global cursor silently lost time whenever two people were on break at
 * once — the normal case, since a shop breaks together. One worker's start
 * overwrote another's, so the ends that followed either paired with the wrong
 * start or were dropped: fifteen workers taking fifteen minutes together
 * reported fifteen minutes instead of 3h45m, which inflated `working` and
 * pushed team efficiency down.
 *
 * A break still RUNNING is closed at `now`, exactly as the server closes an open
 * lunch range at clock-out.
 *
 * This used to ignore an unpaired start, on the assumption that "the live accrual
 * covers a break that is still open right now." It did not. The only break flow
 * workers use is `breakBegin`/`breakClear`, which writes `person.activeBreak`
 * plus a payhours row and never touches `activeClockIn.events` — the sole source
 * the live accrual read. So an open break was subtracted from NEITHER: pay kept
 * accruing gross while the job clock sat paused, and efficiency sagged by the
 * whole elapsed break until the worker ended it. These rows are the one place
 * every break shows up whichever path recorded it, so the open range is closed
 * here and the live accrual no longer computes break time at all.
 *
 * A start left open on an EARLIER day is still ignored. Accruing it to `now`
 * would bill an abandoned break every hour since, overrun the day's pay and clamp
 * working time — and so efficiency — to zero. The server pairs a forgotten break
 * at clock-out (`closeActiveBreak`); until then it stays out.
 *
 * Days are keyed by the shop's calendar day (see localDay.js). They used to be
 * keyed UTC, which put an evening break on the following day at any negative
 * offset — the same off-by-one that misfiled whole evening shifts.
 *
 * @param {Array} timeclock  pay-clock rows, event rows included
 * @param {string|null} personId  null = the whole team
 * @param {string|null} timeZone  IANA zone; falsy keeps the old UTC keying
 * @param {number} now  epoch ms an open break is measured to
 * @returns {Object<string, number>} "YYYY-MM-DD" → hours
 */
export function breakHoursByDay(timeclock, personId, timeZone = null, now = Date.now()) {
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
  const nowDay = localDay(new Date(now).toISOString(), timeZone);
  for (const rows of byPerson.values()) {
    rows.sort((a, b) => a.t - b.t);
    let open = null;
    for (const ev of rows) {
      if (ev.type === "breakStart") open = ev.t;
      else if (open != null) {
        const day = localDay(new Date(open).toISOString(), timeZone);
        out[day] = (out[day] || 0) + Math.max(0, (ev.t - open) / 3600000);
        open = null;
      }
    }
    // Still on break: count what has elapsed so far, same-day only.
    if (open != null) {
      const day = localDay(new Date(open).toISOString(), timeZone);
      if (day === nowDay) out[day] = (out[day] || 0) + Math.max(0, (now - open) / 3600000);
    }
  }
  return out;
}

/**
 * Production hours actually recorded, totalled by op, by panel and by job.
 *
 * The session rows are the authoritative record of production: every job clock
 * out and every manual hours credit appends one. The `loggedHours` counters
 * carried on each job/op are a parallel, incrementally-maintained tally that
 * several write paths never touch — the pay-clock clock-out paths credit
 * `job.loggedHours` only, and `jobClockOut` credits an op only when the clock
 * carried an `opId`. So the counter drifts BELOW the real record: a job with
 * 11h of sessions showed 4.3h striped on the schedule.
 *
 * Summing here means the schedule and the Analytics production number are
 * computed from the same rows and agree by construction, rather than by two
 * counters happening to stay in step.
 *
 * A session clocked at panel level carries no `opId`; it still counts toward
 * its panel and job. Ids are keyed as strings so older numeric ids and current
 * string ids land in the same bucket.
 *
 * @param {Array} sessions  production session rows (jobsessions.json)
 * @returns {{byOp: Map<string, number>, byPanel: Map<string, number>, byJob: Map<string, number>}}
 */
export function producedHoursByScope(sessions) {
  const byOp = new Map(), byPanel = new Map(), byJob = new Map();
  const add = (map, key, h) => {
    if (key == null || key === "") return;
    const k = String(key);
    map.set(k, (map.get(k) || 0) + h);
  };
  for (const s of sessions || []) {
    if (!s || s.deletedAt) continue;
    const h = Number(s.hours) || 0;
    if (!h) continue;
    add(byOp, s.opId, h);
    add(byPanel, s.panelId, h);
    add(byJob, s.jobId, h);
  }
  return { byOp, byPanel, byJob };
}


/**
 * Pay, production and break hours bucketed by the shop's calendar day.
 *
 * This is the single algorithm behind BOTH the Analytics Efficiency card and the
 * Performance box on the Employees page. They used to compute different things:
 * Analytics reported production ÷ working time, while Employees reported pay ÷
 * PLANNED hours and called it efficiency — a schedule-adherence number that has
 * nothing to do with efficiency and moved independently of the Analytics card.
 *
 * Day keying derives the day rather than trusting a row's stored `date`, and
 * derives it identically for both datasets: payhours `date` is still a UTC slice
 * (moving it would move punches between pay periods, a payroll decision), while
 * production rows are stamped shop-local. Reading each row's own field would put
 * a late shift's pay in one day and its production in the next.
 *
 * Open clocks accrue live so the numbers grow during a shift: pay is gross
 * elapsed NET of lunch, exactly as the server's pausedMsFromEvents does when the
 * punch is finalised, and production is elapsed minus paused. Break time is not
 * computed from `activeClockIn.events` — only the admin-correction path writes
 * those, so a worker's own break was missed while an admin-entered one counted
 * twice. breakHoursByDay owns break time outright, open ranges included.
 *
 * @returns {{payByDay: Object, prodByDay: Object, breakByDay: Object}} "YYYY-MM-DD" → hours
 */
export function payProdByDay({ timeclock, productionHours, people, personId = null, timeZone = null, now = Date.now() }) {
  const mine = id => personId == null || String(id) === String(personId);
  const dayOf = e => (e && e.clockIn ? localDay(e.clockIn, timeZone) : (e && e.date) || null);
  const bump = (map, day, h) => { if (day && h) map[day] = (map[day] || 0) + h; };

  const payByDay = {}, prodByDay = {};
  for (const e of timeclock || []) {
    if (!e || e.deletedAt || e.eventType || !e.clockIn || !e.clockOut || !mine(e.personId)) continue;
    bump(payByDay, dayOf(e), Number(e.hours) || 0);
  }
  for (const s of productionHours || []) {
    if (!s || s.deletedAt || !mine(s.personId)) continue;
    bump(prodByDay, dayOf(s), Number(s.hours) || 0);
  }

  for (const person of people || []) {
    if (!mine(person?.id)) continue;
    const ac = person.activeClockIn;
    if (ac?.clockIn) {
      const start = new Date(ac.clockIn).getTime();
      if (start) {
        let ms = now - start;
        let lunchOpen = null;
        [...(ac.events || [])]
          .map(ev => ({ type: ev.type, t: new Date(ev.ts || ev.at).getTime() }))
          .filter(ev => ev.t)
          .sort((a, b) => a.t - b.t)
          .forEach(ev => {
            if (ev.type === "lunchStart") lunchOpen = ev.t;
            else if (ev.type === "lunchEnd" && lunchOpen != null) { ms -= Math.max(0, ev.t - lunchOpen); lunchOpen = null; }
          });
        if (lunchOpen != null) ms -= Math.max(0, now - lunchOpen);
        bump(payByDay, localDay(ac.clockIn, timeZone), Math.max(0, ms / 3600000));
      }
    }
    const jc = person.activeJobClock;
    if (jc?.clockIn) {
      const start = new Date(jc.clockIn).getTime();
      if (start) {
        let ms = now - start - (jc.totalPausedMs || 0);
        if (jc.pausedAt) ms -= (now - new Date(jc.pausedAt).getTime());
        bump(prodByDay, localDay(jc.clockIn, timeZone), Math.max(0, ms / 3600000));
      }
    }
  }

  return { payByDay, prodByDay, breakByDay: breakHoursByDay(timeclock, personId, timeZone, now) };
}

/**
 * Total pay / production / break / working hours over a set of days.
 *
 * Working time is paid time minus the breaks a worker was required to take.
 * Breaks are mandatory paid downtime that cannot be converted into production,
 * so they come out of the denominator — otherwise following the rules caps
 * everyone at ~93.75%. 100% means "worked continuously outside scheduled
 * breaks"; any idle above 0 is unexpected downtime.
 *
 * Clamped PER DAY, because malformed data can record more break than pay and a
 * single bad day must not eat a good one's working time.
 */
export function totalsForDays({ payByDay, prodByDay, breakByDay }, days) {
  let pay = 0, prod = 0, brk = 0, working = 0;
  for (const d of days || []) {
    const p = payByDay[d] || 0, r = prodByDay[d] || 0, b = breakByDay[d] || 0;
    pay += p; prod += r; brk += b;
    working += Math.max(0, p - b);
  }
  return { pay, prod, brk, working };
}

/** Production ÷ working time as a whole percent, or null when there is no working time. */
export function efficiencyPct({ prod, working }) {
  return working > 0 ? Math.round((prod / working) * 100) : null;
}
