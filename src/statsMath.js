// Pure math behind the Stats/Analytics cards, kept out of TRAQS.jsx so it can be
// exercised directly. Mirrors `StatsMath` in the iOS app — the two platforms
// report the same numbers only if they run the same algorithm.

import { localDay } from "./localDay.js";

/**
 * Hours accrued on ONE open job clock, net of paused time.
 *
 * The single definition of live job hours for every surface on every platform.
 * Before this existed the same arithmetic was written seventeen times in three
 * variants, and which variant you got decided what the number meant:
 *
 *   A. open pause subtracted, floored  — correct; `liveOpHours` only
 *   B. open pause subtracted, unfloored — a `pausedAt` in the FUTURE (phone/server
 *      clock skew) subtracts a negative and ADDS time
 *   C. no open-pause term at all        — keeps counting straight through lunch,
 *      because `totalPausedMs` is the CLOSED total and an open pause lands in it
 *      only when the pause ends
 *
 * Variant C is why the current-work card and the op-progress percentage climbed
 * during a break on web, iOS and Android alike — the same omission written three
 * times independently, and filed once as an iOS-only cosmetic gap.
 *
 * `now` is injectable because the cases worth testing — a future `pausedAt`, a
 * frozen session — are otherwise races against the wall clock.
 *
 * NOT for the drain/checkpoint window: `sessionElapsedMs` and the drag
 * rebaseline measure from `drainCheckpoint` and baseline their pause on
 * `pausedMsAtCheckpoint` deliberately. Different origin, different window; they
 * are not copies of this and must not be migrated onto it.
 *
 * `frozenAtMs` FREEZES the clock. It is set server-side while a finish request
 * awaits approval, and until it was honoured here a held session kept accruing:
 * the bar's geometry stopped (shrunkStartH already read `frozenAtMs`) while the
 * hours beside it climbed, and the same inflation reached the Analytics
 * efficiency card through payProdByDay. A request sitting three hours showed
 * three hours nobody worked.
 *
 * Taken as `min(now, frozenAtMs)` rather than used directly, so a freeze stamp
 * can only ever STOP the clock and never advance it — the same one-directional
 * reasoning as the open-pause floor. A session frozen before it began floors at
 * zero like any other.
 */
export function liveElapsedHours({ clockIn, pausedAt = null, frozenAtMs = null, totalPausedMs = 0, now = Date.now() }) {
  // Falsy is rejected BEFORE parsing: `new Date(null)` is the epoch, not an
  // invalid date, so a missing clockIn would otherwise read as fifty-six years
  // of elapsed time rather than as no session. Every legacy variant had this
  // hole and was saved only by its caller guarding first.
  if (!clockIn) return 0;
  const started = clockIn instanceof Date ? clockIn.getTime() : new Date(clockIn).getTime();
  if (!Number.isFinite(started)) return 0;
  // A held session stops here. The open pause is measured against the same
  // frozen instant, so freezing mid-pause does not keep deducting pause time
  // from a clock that has already stopped.
  const frozen = frozenAtMs instanceof Date ? frozenAtMs.getTime() : frozenAtMs;
  const effNow = Number.isFinite(frozen) ? Math.min(now, frozen) : now;
  let ms = effNow - started - (totalPausedMs || 0);
  // Floored: an open pause can only ever REMOVE time. Without this a pausedAt
  // ahead of `now` adds it instead — variant B's defect.
  if (pausedAt) {
    const pausedSince = pausedAt instanceof Date ? pausedAt.getTime() : new Date(pausedAt).getTime();
    if (Number.isFinite(pausedSince)) ms -= Math.max(0, effNow - pausedSince);
  }
  return Math.max(0, ms) / 3600000;
}

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
      const liveH = liveElapsedHours({
        clockIn: jc.clockIn, pausedAt: jc.pausedAt, frozenAtMs: jc.frozenAtMs,
        totalPausedMs: jc.totalPausedMs, now,
      });
      if (liveH > 0) bump(prodByDay, localDay(jc.clockIn, timeZone), liveH);
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

// ─── Worked SPANS ──────────────────────────────────────────────────────────
//
// WHEN an op was worked, not how much. The hours total answers "how much" and already has
// three call sites; this answers the question the schedule's hatch actually asks, and the two
// are not interchangeable. An op estimated at 8h and clocked into at 14:00 for one hour has a
// worked FRACTION of 12.5% and a worked SPAN of 14:00-15:00 — draw the fraction as a position
// and the bar reports work in a window where nobody was working.
//
// Sessions are the record: every js_ row in productionhours.json carries clockIn and clockOut.
// Rows without both are skipped rather than guessed at, and deletedAt rows are skipped for the
// same reason producedHoursByScope skips them.
//
// KNOWN GAP, deliberate: a lunch taken mid-session is not carved out, so a span can cover time
// that was paused. Under the three-region model that time is "elapsed but not worked" and
// should read as idle, but pause boundaries live in the pay timeclock's lunchStart/lunchEnd
// events rather than on the session row, so joining them is its own piece of work.
export function workedSpansByOp(sessions) {
  const byOp = new Map();
  for (const s of sessions || []) {
    if (!s || s.deletedAt || s.opId == null || s.opId === "") continue;
    const a = Date.parse(s.clockIn), b = Date.parse(s.clockOut);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const k = String(s.opId);
    const list = byOp.get(k) || [];
    list.push([a, b]);
    byOp.set(k, list);
  }
  for (const [k, list] of byOp) byOp.set(k, mergeSpans(list));
  return byOp;
}

/**
 * Sorted, non-overlapping spans. Two people on one op produce overlapping rows and the op was
 * worked once, not twice — for a fill extent the union is the answer, and leaving them
 * unmerged would paint the same region twice at compounding alpha.
 */
export function mergeSpans(spans) {
  const out = [];
  for (const [a, b] of [...(spans || [])].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Spans clipped to a window and expressed as percentages across it, for a bar that occupies
 * that window. Returns [] when the window is degenerate rather than dividing by zero, and
 * clamps to 0..100 because a span may start before the bar or run past it — a session that
 * began yesterday is real, it just is not this bar's to draw.
 */
export function spansToPct(spans, fromMs, toMs) {
  const width = toMs - fromMs;
  if (!Number.isFinite(width) || width <= 0) return [];
  const out = [];
  for (const [a, b] of spans || []) {
    const s = Math.max(fromMs, a), e = Math.min(toMs, b);
    if (e <= s) continue;
    out.push([((s - fromMs) / width) * 100, ((e - fromMs) / width) * 100]);
  }
  return out;
}

// ─── Push ──────────────────────────────────────────────────────────────────
//
// Where a bar actually sits once the clock has moved past work nobody did.
//
// PER OP, not per row. The cascade this replaces pushed every op on the clocked-in person's
// row that overlapped the new work's footprint, so clocking into A moved B. Under the
// three-region model B moves because B is untouched and the cursor has passed it, which is a
// property of B alone — clocking into A says nothing about B, and B stays recoverable when a
// drag on A is refused.
//
// The rule is one sentence: the unworked remainder cannot sit to the LEFT of now, so it starts
// at the cursor and keeps its duration. Everything else follows. An untouched op whose window
// has passed slides whole and leaves flat idle behind it. A half-worked op keeps its hatch
// where the work happened, shows idle from there to the cursor, and its remainder resumes
// ahead. A bar whose work is done stops moving, because there is no remainder to push.
//
// `workedMs` is time actually clocked against the op, which is NOT the same as the elapsed
// window: an op can be a day old with twenty minutes on it. Pass the merged spans' duration,
// not `now - start`.
export function pushedBarRange({ plannedStartMs, plannedEndMs, workedMs = 0, nowMs }) {
  const duration = plannedEndMs - plannedStartMs;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(nowMs)) {
    return { startMs: plannedStartMs, endMs: plannedEndMs, remainderStartMs: plannedStartMs, pushedMs: 0 };
  }
  // Worked time is clamped into the op's own duration. More worked than planned is an overrun,
  // which grows the bar (Q7a) rather than producing a negative remainder that would pull the
  // end backwards past the start and write an inverted block.
  const worked = Math.max(0, Math.min(duration, workedMs || 0));
  const remaining = duration - worked;

  // Before the op's window opens nothing is pushed: a bar scheduled for Thursday is not late on
  // Tuesday. This is what keeps the push from dragging the whole future forward.
  if (nowMs <= plannedStartMs) {
    return { startMs: plannedStartMs, endMs: plannedEndMs, remainderStartMs: plannedStartMs, pushedMs: 0 };
  }
  // Nothing left to place. The bar keeps its planned extent; overrun growth is Q7a's business
  // and is measured from the clock still running, not from a remainder that no longer exists.
  if (remaining <= 0) {
    return { startMs: plannedStartMs, endMs: plannedEndMs, remainderStartMs: plannedEndMs, pushedMs: 0 };
  }
  const remainderStartMs = nowMs;
  const endMs = remainderStartMs + remaining;
  return {
    startMs: plannedStartMs,          // history stays put; the left edge is where it was planned
    endMs,
    remainderStartMs,
    pushedMs: Math.max(0, endMs - plannedEndMs),
  };
}

/** Total duration of merged, non-overlapping spans. Merge first — overlaps would double-count. */
export function spansDurationMs(spans) {
  let total = 0;
  for (const [a, b] of spans || []) total += Math.max(0, b - a);
  return total;
}

/**
 * The gaps between spans across a window — the intervals where nothing happened.
 *
 * Under the three-region model the hatch is drawn wherever work was clocked and the idle grey
 * covers everything else left of the cursor, so the idle layer needs the COMPLEMENT of the
 * worked spans rather than a single boundary. Expressed in the same units as its input, so
 * percentage spans give percentage gaps.
 *
 * Spans are assumed merged and sorted (mergeSpans does both). Unmerged input would emit
 * negative-width gaps between overlapping spans, which paint as nothing and hide the mistake.
 */
export function complementSpans(spans, from = 0, to = 100) {
  const out = [];
  let cursor = from;
  for (const [a, b] of spans || []) {
    const s = Math.max(from, a), e = Math.min(to, b);
    if (e <= s) continue;
    if (s > cursor) out.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

/**
 * Productive hours actually available between two instants.
 *
 * Wall-clock elapsed is not the number the schedule runs on: an op left untouched from Friday
 * lunchtime to Monday morning has lost a couple of productive hours, not seventy. Nights,
 * weekends, holidays and the lunch/break windows are all skipped, so this is the measure that
 * says how far a bar's remainder has to move when the cursor passes work nobody did.
 *
 * cfg matches buildDayWindows: { workStartH, workEndH, deadWindows: [{ start, dur }], workDays,
 * holidays }. Days are stepped in LOCAL time, the same basis as hourTs — the schedule places
 * every block with `new Date(ds + "T00:00:00")`, and measuring in UTC here would disagree with
 * the geometry by the offset for half the year.
 */
export function productiveHoursBetween(startMs, endMs, cfg) {
  const { workStartH = 0, workEndH = 24, deadWindows = [], workDays = [1, 2, 3, 4, 5], holidays = [] } = cfg || {};
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  const dayLen = workEndH - workStartH;
  if (!(dayLen > 0)) return 0;
  const holidaySet = new Set(holidays || []);
  const workDaySet = new Set(workDays || []);
  const HOUR = 3600000;

  let total = 0;
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  // Bounded rather than while(true): a bad endMs should cost one wrong number, not a frozen
  // render. A year of business days is far past any span the schedule reasons about.
  for (let guard = 0; guard < 400 && day.getTime() <= endMs; guard++, day.setDate(day.getDate() + 1)) {
    const midnight = day.getTime();
    const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (!workDaySet.has(day.getDay()) || holidaySet.has(ds)) continue;
    const a = Math.max(startMs, midnight + workStartH * HOUR);
    const b = Math.min(endMs, midnight + workEndH * HOUR);
    if (b <= a) continue;
    let hours = (b - a) / HOUR;
    // Only the part of a dead window the span actually reaches is deducted. Subtracting whole
    // lunches for a span that ended before lunch is how an idle gap gets undercounted.
    for (const w of deadWindows) {
      const dS = midnight + (w.start ?? 0) * HOUR;
      const dE = dS + (w.dur ?? 0) * HOUR;
      const oa = Math.max(a, dS), ob = Math.min(b, dE);
      if (ob > oa) hours -= (ob - oa) / HOUR;
    }
    total += Math.max(0, hours);
  }
  return total;
}

/**
 * Worked spans for ONE person, keyed by op — the cross-row case (§3a).
 *
 * workedSpansByOp merges every worker's sessions together, which is right for an op's own bar:
 * the op was worked, and by whom does not change its shape. It is wrong for a row, because a
 * row belongs to a person. When someone clocks into an op they are not on the team of, the work
 * shows on THEIR row as the span they personally worked, while the op's scheduled bar stays
 * where it was scheduled.
 */
export function workedSpansForPerson(sessions, personId, extraSpansByOp) {
  const byOp = new Map();
  if (personId == null) return byOp;
  const want = String(personId);
  for (const s of sessions || []) {
    if (!s || s.deletedAt || s.opId == null || s.opId === "") continue;
    if (String(s.personId) !== want) continue;
    const a = Date.parse(s.clockIn), b = Date.parse(s.clockOut);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const k = String(s.opId);
    byOp.set(k, [...(byOp.get(k) || []), [a, b]]);
  }
  // An open clock is not a session row yet, so the caller passes it in rather than this
  // function reaching for "now" — a pure function that reads the clock cannot be table-tested.
  for (const [opId, spans] of extraSpansByOp || []) {
    const k = String(opId);
    byOp.set(k, [...(byOp.get(k) || []), ...spans]);
  }
  for (const [k, list] of byOp) byOp.set(k, mergeSpans(list));
  return byOp;
}

/**
 * Splitting a partially-worked op on an admin drag (§3c).
 *
 * The worked part is history and does not move: it stays on the row and at the hours it was
 * worked, locked. The unworked remainder is what the admin is actually dragging, and it becomes
 * its own record, free to land on any day or person. Both halves are returned as plain field
 * sets so the caller owns how they are written.
 *
 * §6b is enforced here rather than at the write: a remainder of zero or less is returned as
 * NULL, never as a record with zero width. A zero-width block inverts on the next write, and
 * that is the corruption that destroyed tzf8ivwbh. The caller deletes rather than writes.
 *
 * Symmetrically, an op with NO worked time has nothing to keep — `keep` is null and the whole
 * op moves, which is the ordinary drag and not a split at all.
 */
export function splitWorkedOp({ hpd, workedMs, teamSize = 1 }) {
  const size = Math.max(1, teamSize || 1);
  const planned = Math.max(0, hpd || 0);
  // Worked hours are the TEAM's total, like hpd, so they compare directly.
  const worked = Math.max(0, Math.min(planned, (workedMs || 0) / 3600000));
  const remaining = planned - worked;
  // A hair of float noise either side should not mint a record or strand one. A minute of
  // team time is far below anything schedulable and comfortably above rounding.
  const EPS = 1 / 60;
  return {
    keep: worked > EPS ? { hpd: worked, locked: true } : null,
    remainder: remaining > EPS ? { hpd: remaining } : null,
    perPersonKeepH: worked / size,
    perPersonRemainderH: remaining / size,
  };
}

/**
 * The instant a working day closes, for the day an open clock started on (Q7b).
 *
 * A clock nobody stopped would otherwise accrue all night and all weekend, and the bar would
 * grow with it — by Monday a forgotten Friday punch reads as sixty hours of work. Freezing at
 * the end of the working day bounds both the hours and the geometry, and the fact that it had
 * to be frozen is the signal that the session needs resolving.
 *
 * Deliberately the end of the day the clock STARTED on, not of the current day: a session left
 * open for three days is one unclosed session from Tuesday, not a daily one that keeps renewing.
 */
export function endOfWorkingDayMs(startMs, cfg) {
  const { workEndH = 24 } = cfg || {};
  if (!Number.isFinite(startMs)) return null;
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + workEndH * 3600000;
}

/**
 * An open clock's end, bounded by Q7b. Returns the instant AND whether the bound was applied,
 * because the caller needs both: one draws the bar, the other says the session is unclosed.
 */
export function openSessionEnd({ clockInMs, pausedAt, frozenAtMs, nowMs, cfg }) {
  // HELD first: somebody asked for that one, and an explicit decision outranks a lunch that
  // happens to be open at the same moment.
  if (Number.isFinite(frozenAtMs)) return { endMs: Math.min(nowMs, frozenAtMs), frozen: true, unclosed: false };
  // LUNCH. An open pause stops the hatch where the work stopped while the cursor carries on,
  // which is what opens the flat idle gap behind it and is the whole visual meaning of being
  // on a break. Without it the span ran to now, the hatch grew straight through lunch, and a
  // bar on lunch was indistinguishable from one being worked.
  const pausedMs = typeof pausedAt === "string" ? Date.parse(pausedAt) : pausedAt;
  if (Number.isFinite(pausedMs) && pausedMs > clockInMs) {
    return { endMs: Math.min(nowMs, pausedMs), frozen: true, unclosed: false, paused: true };
  }
  const dayEnd = endOfWorkingDayMs(clockInMs, cfg);
  if (Number.isFinite(dayEnd) && nowMs > dayEnd) return { endMs: dayEnd, frozen: true, unclosed: true };
  return { endMs: nowMs, frozen: false, unclosed: false };
}

/**
 * Every person's worked spans, grouped in ONE pass: Map<personId, Map<opId, spans>>.
 *
 * workedSpansForPerson scans the whole session log per person, which is fine for one lookup and
 * quadratic when the schedule asks for every row on every render. The schedule does exactly
 * that, so it gets the grouped form and the single-person one stays for callers that want it.
 */
export function workedSpansByPersonOp(sessions) {
  const byPerson = new Map();
  for (const s of sessions || []) {
    if (!s || s.deletedAt || s.opId == null || s.opId === "" || s.personId == null) continue;
    const a = Date.parse(s.clockIn), b = Date.parse(s.clockOut);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const pk = String(s.personId), ok = String(s.opId);
    let ops = byPerson.get(pk);
    if (!ops) { ops = new Map(); byPerson.set(pk, ops); }
    ops.set(ok, [...(ops.get(ok) || []), [a, b]]);
  }
  for (const ops of byPerson.values()) for (const [k, list] of ops) ops.set(k, mergeSpans(list));
  return byPerson;
}

// ─── Row push ──────────────────────────────────────────────────────────────
//
// Where every op on one person's row sits once the ones before it have run long, and once
// the clock has moved past work nobody started. Returns Map<opId, pushHours>.
//
// Ops are placed on a productive-hours line measured from the row's first op, and each is
// pushed by however much the previous one actually reaches INTO it — idle time in between
// absorbs the push first, so slack produces no movement. Each op's end is computed after its
// own push, so a genuine collision cascades down the row.
//
// TWO CAUSES, one line. An op that ran long occupies more of the line than its estimate. An
// op nobody started cannot begin in the past, so the cursor drags its start forward. Both are
// the same arithmetic — something is in the way — and keeping them in one pass is what makes
// them compose instead of fighting.
//
// THE INPUT MUST BE EVERY OP ON THE ROW, not the ones currently on screen. A previous version
// read the viewport-filtered list and the push became a function of scroll position: pan one
// day, an overrunning op leaves the list, and everything after it jumps. The test asserts the
// result is identical across three windows for exactly this reason.
//
// `diffBD` is injected rather than reimplemented — business days, work days and holidays have
// one definition in this codebase and a second one here would drift from it silently.
// HOW LONG A BAR IS. Two parts, and they are measured differently.
//
// AHEAD of the cursor is the work still owed: the estimate less what has been logged. This
// is the shrink. A 97.5-hour job with 20 hours on it has 77.5 hours left, and 77.5 hours is
// what it should reserve -- reserving the whole 97.5 plans everything behind it around work
// that is already finished.
//
// BEHIND the cursor is a record, and records do not shrink. Its size is geometry: from where
// the bar starts to now. The hatch lives there, and it has to be as wide as the stretch of
// time it represents.
//
// With no cursor supplied there is no ahead and behind, so it falls back to the block this
// replaced -- the estimate, or the hours actually sunk into it if those ran longer. That
// fallback is load-bearing: the cascade uses it to decide what the row's PAST looks like,
// and an op that consumed twenty-two hours occupied twenty-two hours of that person whether
// or not its estimate said so. Shrinking there would let the next op start inside them.
//
// Past the estimate the remainder is zero and the future part is the OVERRUN, so a job
// running long keeps growing instead of collapsing to nothing. The 0.25 floor is the
// zero-width ban: a bar with no extent cannot be clicked, dragged, or seen.
//
// Three places computed this independently -- the push cascade, the schedule's slack
// calculation, and the bar render -- with the same operands and slightly different
// expressions. They are one function now, because a length that disagrees between the
// packing and the paint IS an overlap.
// WHERE A CORNER BADGE SITS on a bar, as pixels from the bar's own LEFT edge.
//
// Badges hang off the right edge, `inset` pixels in, which silently assumes the bar is wider
// than the inset. A bar can be one pixel wide -- a live session three minutes old is three
// minutes of record -- and then the naive barPx - inset is NEGATIVE and the badge renders to
// the LEFT of the bar it belongs to, floating clear of it. That is the detached green dot.
//
// Clamped at zero: on a bar too narrow to hang from, the badge sits at its left edge and
// overhangs to the right, which still reads as attached.
export function badgeOffsetPx(barPx, inset) {
  return Math.max(0, (Number(barPx) || 0) - (Number(inset) || 0));
}
// HOW FAR TO INSET A BAR'S LABEL so it stays on screen.
//
// A bar's title sits at its left edge. A bar that began before the visible window has that
// edge off the left of the canvas, so a job drawn right across the screen shows no name at
// all -- which is worst for exactly the longest-running jobs, the ones hardest to identify
// from position alone.
//
// `clipPx` is how much of the bar is off the left. The label slides in by that much, capped
// so at least `minContentPx` of the bar is left to draw the text in; without the cap a bar
// clipped to its last few pixels would push its own label off the RIGHT edge instead.
export function labelInsetPx(clipPx, barPx, minContentPx = 160) {
  const clip = Math.max(0, Number(clipPx) || 0);
  const room = Math.max(0, (Number(barPx) || 0) - minContentPx);
  return Math.min(clip, room);
}
// WHICH SEGMENT OF A BAR CARRIES ITS NAME.
//
// A bar crossing weekends is drawn as several elements, and the name went on the first one
// always. That is fine while the first one is the widest, which it is for a bar starting at
// the cursor -- and stops being true the moment the bar starts earlier. A job running since
// January has a one-day sliver for its head and five-day blocks after it, so the name was
// squeezed into 80 pixels of grey while 300 pixels of colour sat there blank. Clocking into
// an op did exactly this: it exempts the op from the cursor push, the bar falls back to its
// real start, and the name vanishes from the part of it anyone is looking at.
//
// First segment with room, else the widest one. Earliest wins a tie, so a bar whose segments
// are all the same size still labels its head and nothing appears to move.
export function labelSegmentIndex(widthsPx, minPx = 88) {
  const w = Array.isArray(widthsPx) ? widthsPx.map((v) => Number(v) || 0) : [];
  if (!w.length) return 0;
  const fits = w.findIndex((v) => v >= minPx);
  if (fits >= 0) return fits;
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
  return best;
}
// THE IDLE-LEFT INVARIANT, as a number so it can be asserted instead of argued about.
//
// RULE: left of the cursor a bar shows WORKED TIME AND NOTHING ELSE. Time that has passed
// with no hours logged against it is not drawn -- an unstarted job slides to the cursor
// rather than sitting behind it in muted grey, and a job worked in a later stretch than it
// was scheduled begins where the work begins.
//
// Returns the hours of this bar that lie left of the cursor and are NOT covered by a worked
// span. Anything above zero is a violation. All four arguments are on one axis -- productive
// hours from whatever origin the caller picked -- because mixing axes here would make the
// check agree with neither the packing nor the paint.
export function idleLeftOfCursorH(startH, lenH, nowH, workedSpans = []) {
  const a = Number(startH) || 0;
  const b = Math.min(a + (Number(lenH) || 0), Number(nowH) || 0);
  if (!(b > a)) return 0;
  let covered = 0;
  for (const [s, e] of mergeSpans(workedSpans || [])) {
    const lo = Math.max(a, s), hi = Math.min(b, e);
    if (hi > lo) covered += hi - lo;
  }
  return Math.max(0, (b - a) - covered);
}
// A LIVE RECORD'S RIGHT EDGE IS THE CURSOR, so it is measured from the cursor rather than
// derived and hoped to land there.
//
// An open session runs from clock-in to now, so the bar depicting it ends exactly at now.
// Its width was coming from an hours budget walked through the working day while the cursor
// is placed on the day/hour grid -- two mappings that agree only by coincidence, which left
// a two-pixel gap between the bar and the line it is supposed to touch. Same shape as the
// grey/colour divider sitting a sliver off the line, and the same fix: one axis, measured.
//
// All three arguments are percentages of the visible window, the units `left` and `width`
// are already set in.
export function flushRightWidthPct(leftPct, cursorPct, minPct = 0) {
  const w = (Number(cursorPct) || 0) - (Number(leftPct) || 0);
  return Math.max(Number(minPct) || 0, w);
}
// ACTUAL HOURS for a job, a panel or an op: what the crew has really put into it, as against
// the estimate stored on it.
//
// Summed from the LEAVES. Hours are recorded against the op somebody clocked into, so only a
// leaf has any of its own -- a panel's actual hours are its ops', and a job's are its panels'.
// Recursive rather than one level deep, because a panel can hold sub-ops and stopping at the
// first level silently reports a deep job as having done no work at all.
//
// `leafHours` is passed in rather than read here: the caller owns what counts as worked, and
// there is exactly one answer for that in this app (deriveWorkedState's workedHoursShown,
// which is max(logged, produced) plus any running session). A second definition living here
// would drift from the one the schedule bars are drawn from.
export function rollupLeafHours(node, leafHours) {
  if (!node || typeof leafHours !== "function") return 0;
  const subs = Array.isArray(node.subs) ? node.subs : [];
  if (!subs.length) return Math.max(0, Number(leafHours(node)) || 0);
  let total = 0;
  for (const child of subs) total += rollupLeafHours(child, leafHours);
  return total;
}
// NOTHING UNWORKED IS SCHEDULED BEHIND THE CURSOR. Shifts a date range forward so it starts
// no earlier than `floorDS`, carrying its end with it so the duration is preserved exactly.
//
// The render already refuses to DRAW unworked time in the past -- an untouched op slides to
// the cursor. This is the same rule at WRITE time, which is a different thing: a bar drawn at
// the cursor whose stored start is a year back still sorts, groups, filters and exports as a
// year-old job, and every consumer that reads the dates rather than the bars disagrees with
// what is on screen.
//
// Calendar days, not working days: the shift is applied to both ends equally, so a range that
// spanned three working weeks still spans three working weeks wherever it lands. Snapping the
// start onto a working day is the caller's business -- it owns the org's calendar.
//
// A range already at or after the floor is returned untouched, so this is safe to apply to
// everything and only moves what breaks the rule.
export function shiftRangeForward(startDS, endDS, floorDS) {
  const DAY = 86400000;
  const parse = (ds) => {
    if (typeof ds !== "string" || ds.length !== 10 || ds[4] !== "-" || ds[7] !== "-") return null;
    const t = new Date(ds + "T12:00:00").getTime();
    return Number.isFinite(t) ? t : null;
  };
  // Formatted from LOCAL parts. toISOString() would re-project through UTC and can land a
  // day either side of the one just computed.
  const fmt = (t) => {
    const d = new Date(t);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
      + "-" + String(d.getDate()).padStart(2, "0");
  };
  const s = parse(startDS), f = parse(floorDS);
  if (s == null || f == null || s >= f) return { start: startDS, end: endDS, shiftedDays: 0 };
  const shiftedDays = Math.round((f - s) / DAY);
  const e = parse(endDS);
  return {
    start: floorDS,
    end: e == null ? endDS : fmt(e + shiftedDays * DAY),
    shiftedDays,
  };
}
export function barLengthHours({ hpd, workedHoursShown = 0, isFullyWorked = false, teamSize = 1, fallbackH = 7.5, elapsedToCursorH = null }) {
  const size = Math.max(1, teamSize || 1);
  const est = (hpd || 0) > 0 ? hpd : fallbackH * size;
  const worked = Math.max(0, workedHoursShown || 0);
  const remaining = Math.max(0, est - worked) / size;
  const overrun = isFullyWorked ? 0 : Math.max(0, worked - est) / size;
  const ahead = remaining > 0 ? remaining : overrun;
  const behind = elapsedToCursorH == null
    ? Math.max(0, Math.max(est, worked) / size - ahead)
    : Math.max(0, elapsedToCursorH);
  return Math.max(0.25, behind + ahead);
}
export function rowPushHours({ ops, nowDay, nowHour, cfg }) {
  // Ops whose push comes from the CURSOR rather than from a collision. Their left edge is not
  // a quantity of hours to add back onto a clock -- it is a known instant, and the caller
  // places them at it directly. Reconstructing it from `push` cannot be exact: the push is in
  // PRODUCTIVE hours and a start hour is a CLOCK hour, so converting between them drifts by
  // however much lunch falls inside the span.
  const atCursor = new Set();
  const out = new Map();
  const list = ops || [];
  if (!list.length) return { pushes: out, atCursor };
  const { workStartH = 0, totalWorkH = 1, productiveHoursPerDay = 1, diffBD } = cfg || {};
  if (typeof diffBD !== "function") return { pushes: out, atCursor };

  const anchor = list[0].start;
  const dayFraction = (h) => Math.max(0, (((h ?? workStartH) - workStartH) / Math.max(0.0001, totalWorkH)) * productiveHoursPerDay);
  const startProd = (op) => diffBD(anchor, op.start) * productiveHoursPerDay + dayFraction(op.startHour);
  // Now on the same line. Deliberately the SAME formula as startProd rather than a true
  // productive-hours elapsed: two axes that disagree by a lunch break would put the cursor in
  // a different place from the bars it is being compared against.
  const nowProd = nowDay == null ? null : diffBD(anchor, nowDay) * productiveHoursPerDay + dayFraction(nowHour);

  let prevEnd = null;
  for (const op of list) {
    // THE ACTIVE HORIZON, and history takes no part in push mechanics of any kind. An op whose
    // window closed before today is not pushed, is not cursor-anchored, and -- the part that
    // matters most -- does not OCCUPY the line, so it cannot displace live work either.
    //
    // Occupying was the older and larger half of the bars-disappearing report. Measured on real
    // data: one row carried 64 unfinished ops going back to November 2025, each overlapping the
    // previous one's pushed end, compounding to 2,543 hours -- 339 working days -- with the
    // cursor push switched off entirely. Two other rows were three and five months out on the
    // same mechanism. Those bars were painted past the window's right edge while the
    // visibility filter, which tests STORED dates, happily kept them in the list.
    //
    // A November op nobody has worked should not be displacing next week. It stays where it is,
    // greys, and reports what it owes with a badge.
    if (nowDay != null && op.end != null && op.end < nowDay) continue;
    // A RECORD TAKES NO PART IN PUSH MECHANICS AT ALL -- the same standing this pass already
    // gives history, for the same reason. A cross-row bar depicts work that has already
    // happened; it is not competing for a slot, so it neither receives a push nor blocks
    // anything behind it.
    //
    // Exempting it from the CURSOR push alone was not enough. A collision push moves it just
    // the same, and shifting a record forward by even half an hour puts its LEFT edge on the
    // cursor instead of its right -- work already done drawn as though it were still to come.
    // A record's right edge is the moment the work stopped, and for an open session that
    // moment is now, so it sits flush against the cursor by construction once nothing moves it.
    if (op.isRecord) continue;
    const sp = startProd(op);
    const worked = Math.max(0, op.workedHoursShown || 0);
    const size = Math.max(1, op.teamSize || 1);

    // Collision with whatever is already reaching into this slot.
    let push = prevEnd == null ? 0 : Math.max(0, prevEnd - sp);
    // And the cursor, for work nobody has started. Untouched only: once someone has worked an
    // op, where it sits is a record rather than a plan, and dragging it forward would move the
    // hatch away from the hours it represents.
    // THE ACTIVE HORIZON. Only work that is still live slides. An op whose window closed
    // before today is history: it does not move, it greys, and its owed hours are reported by
    // the badge instead.
    //
    // Without this the cursor push applies to the entire backlog. Measured on real data: 504
    // untouched past-due ops totalling 9,176 hours, which cursor-anchor onto today and then
    // cascade off each other -- one row alone ran about 150 working days into the future, and
    // every bar past the first was painted beyond the window's right edge. It reads as jobs
    // disappearing, because the visibility filter tests STORED dates and keeps them while the
    // paint uses pushed ones.
    // AN ACTIVE SESSION MAKES AN OP NON-UNTOUCHED, as a fact rather than as a measurement.
    //
    // `worked <= 0` was doing this job alone and it is a race: at the instant of clock-in the
    // live hours are seconds, so the quantity is still zero, the op still reads as untouched,
    // and the cursor drags it forward out from under the person working it. A session HELD at
    // clock-in has the same shape. Somebody being on the clock is a boolean and cannot race.
    //
    // Cross-row counts. The clock names an opId whoever owns the row, so an op is being worked
    // whether or not the worker is on its team -- which is the case this was reported for.
    // WHOSE work decides whether this slides. `worked` is the op's total across everybody;
    // `ownWorked` is what the person whose row this is has done. A row shows only its own
    // person's work, so an op somebody ELSE worked is, from this row's point of view, still
    // entirely ahead of it -- and its remainder cannot sit behind the cursor.
    //
    // Using the op total here is what left those bars where they were scheduled, which then
    // needed a separate draw-time clamp to drag them to the cursor -- and that clamp did not
    // participate in packing, so every clamped bar on a row landed on the same point and they
    // drew on top of each other. One mechanism, which cascades, rather than two.
    const ownWorked = op.ownWorkedHours == null ? worked : Math.max(0, op.ownWorkedHours);
    // A RECORD IS NOT A RESERVATION. A cross-row bar depicts work somebody already did on an
    // op they are not on the team of. Where it sits is WHEN THAT HAPPENED -- dragging it to
    // the cursor would move a fact, and its extent is the span the work covered, so it never
    // takes the elapsed term below either.
    //
    // THE IDLE-LEFT RULE. Left of the cursor a bar shows WORKED TIME AND NOTHING ELSE, so a
    // bar's left edge is exactly this person's worked hours behind the cursor -- no more, and
    // never any elapsed-but-unworked stretch in front of it.
    //
    // This generalises the cursor push rather than sitting beside it: an untouched op has
    // zero worked hours, so its target IS the cursor, which is the old behaviour unchanged.
    // An op worked for six hours starts six hours back. What it replaces is a rule that left
    // a worked op wherever it was scheduled and let barLengthHours stretch it forward to the
    // cursor -- which drew every unworked hour since its start date as muted grey.
    //
    // Only ever forward (`> push`): this moves a bar OFF idle time, it never drags one
    // backwards into the past to manufacture room.
    //
    // hasActiveSession is no longer a term. It existed to stop an op being dragged out from
    // under the person working it while their hours were still zero -- but the target now IS
    // where they are, and the bar grows leftward as their hours land, so there is nothing to
    // protect it from.
    const idleTarget = nowProd == null ? null : nowProd - ownWorked;
    if (idleTarget != null && !op.isRecord && !op.isFullyWorked && idleTarget - sp > push) {
      push = idleTarget - sp;
      // Anchored only when it lands ON the cursor. A worked op lands short of it, and the
      // render places that from the push like any other rather than snapping it to now.
      if (ownWorked <= 0) atCursor.add(String(op.id));
    }
    // A locked op does not move, whatever is behind it. It still OCCUPIES its slot, so the ops
    // after it are pushed by it as usual — the lock pins this bar, it does not exempt the row.
    if (op.locked) { push = 0; atCursor.delete(String(op.id)); }

    if (push > 0) out.set(String(op.id), push);
    // What it occupies. See barLengthHours: the packing and the paint must agree about this
    // number, because a length that disagrees between them IS an overlap. The elapsed term is
    // measured from where the op ACTUALLY lands, push included -- an op shoved forward to the
    // cursor has nothing behind it, so it is purely the hours it still owes.
    const own = barLengthHours({ hpd: op.hpd, workedHoursShown: worked,
      isFullyWorked: op.isFullyWorked, teamSize: size, fallbackH: productiveHoursPerDay,
      // Null for a record, matching the render, which has always passed null for a cross-row
      // bar. Two answers for one bar's length IS an overlap: a Monday session measured here
      // as its span PLUS two days of elapsed time swelled from four hours to nineteen and
      // shoved the op behind it -- a live clock-in -- nearly three days into the future.
      // CAPPED AT THE HOURS WORKED. For a bar the push was free to move, the two are already
      // equal -- it was placed so that exactly the worked hours sit behind the cursor. The cap
      // is for the bars it could not move: a LOCKED op keeps its pinned start, and without
      // this the elapsed term grew it forward from there to the cursor, drawing every unworked
      // hour of the wait as muted grey. The rule was being broken by length rather than by
      // position, which is why moving bars alone did not settle it.
      elapsedToCursorH: (nowProd == null || op.isRecord) ? null
        : Math.min(Math.max(0, nowProd - (sp + push)), ownWorked) });
    const end = sp + push + own;
    // max(), not assignment: ops can be ordered so an earlier-ending one follows a
    // later-ending one, and the blocker is whichever reaches furthest.
    prevEnd = prevEnd == null ? end : Math.max(prevEnd, end);
  }
  return { pushes: out, atCursor };
}

// ─── No overlap ────────────────────────────────────────────────────────────
//
// A hard invariant: two ops on one row may never occupy the same time. Not for a minute.
// Every path that places an op — creation, import, dependency cascade, push, split, drag —
// asks THESE functions, so the definition of "overlap" cannot drift between them. That is the
// whole reason they live here rather than at each call site.
//
// Hour precision throughout. Comparing dates alone counts 08:00-12:00 and 13:00-16:00 on one
// day as a clash, which it is not, and the real data has plenty of both shapes.

const HOUR_MS = 3600000;
/** Local midnight for a YYYY-MM-DD, plus h hours. Mirrors the schedule's own hourTs. */
export function dayHourMs(ds, h) {
  return new Date(ds + "T00:00:00").getTime() + (h || 0) * HOUR_MS;
}

/**
 * The time an op actually occupies, as [s, e) in ms.
 *
 * A single-day op ends at its endHour, or at its start plus its duration when no endHour is
 * recorded. A multi-day op runs to the end of the working day on its last day. This mirrors
 * `opHourRange` in the render — if the two ever disagree, the guard and the geometry are
 * arguing about different rectangles.
 */
export function opInterval(op, cfg) {
  const { workStartH = 8, workEndH = 16 } = cfg || {};
  if (!op || !op.start || !op.end) return null;
  const sH = op.startHour ?? workStartH;
  const eH = op.start === op.end
    ? (op.endHour ?? Math.min(sH + Math.max(0, op.durationH || 0), workEndH))
    : (op.endHour ?? workEndH);
  const s = dayHourMs(op.start, sH), e = dayHourMs(op.end, eH);
  return e > s ? { s, e } : { s, e: s };
}

/** Do two intervals share any time? Touching end-to-start is adjacency, not overlap. */
export function intervalsOverlap(a, b) {
  if (!a || !b) return false;
  return a.s < b.e && b.s < a.e;
}

/**
 * Every clashing pair on a row, as { a, b } of the ops passed in. Empty means the invariant
 * holds. Zero-width ops cannot clash with anything and are skipped rather than reported.
 */
export function rowOverlaps(ops, cfg) {
  const iv = (ops || []).map((op) => ({ op, i: opInterval(op, cfg) })).filter((x) => x.i && x.i.e > x.i.s);
  const out = [];
  for (let i = 0; i < iv.length; i++) {
    for (let j = i + 1; j < iv.length; j++) {
      if (intervalsOverlap(iv[i].i, iv[j].i)) out.push({ a: iv[i].op, b: iv[j].op });
    }
  }
  return out;
}

/**
 * The earliest instant at or after `desiredStart` where something of `durationMs` fits without
 * touching any occupied interval.
 *
 * Returns the desired start unchanged when it already fits — placing work later than it needs
 * to be is its own kind of wrong, so the slot finder never moves anything it does not have to.
 * Occupied intervals are sorted and walked once; a candidate that collides jumps to the end of
 * whatever it hit and re-tests, because the next interval along may start immediately after.
 */
export function firstFreeStart(desiredStart, durationMs, occupied) {
  if (!Number.isFinite(desiredStart) || !(durationMs > 0)) return desiredStart;
  const busy = (occupied || []).filter((x) => x && x.e > x.s).sort((x, y) => x.s - y.s);
  let at = desiredStart;
  // Bounded: each pass either finishes or moves `at` past one more interval, so the worst case
  // is one pass per occupied block. A while(true) here would hang on malformed input.
  for (let guard = 0; guard <= busy.length; guard++) {
    const hit = busy.find((x) => at < x.e && x.s < at + durationMs);
    if (!hit) return at;
    at = hit.e;
  }
  return at;
}

/**
 * Roll an instant onto real working time: forward to the next working day's start if it lands
 * on a weekend, a holiday, or outside the working window. Packing produces raw instants and
 * the schedule can only place work when the shop is open.
 */
export function normalizeToWorkTime(ms, cfg) {
  const { workStartH = 8, workEndH = 16, workDays = [1, 2, 3, 4, 5], holidays = [] } = cfg || {};
  if (!Number.isFinite(ms)) return ms;
  const holidaySet = new Set(holidays || []);
  const workDaySet = new Set(workDays || []);
  const d = new Date(ms);
  for (let guard = 0; guard < 400; guard++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const midnight = new Date(d); midnight.setHours(0, 0, 0, 0);
    const hour = (d.getTime() - midnight.getTime()) / 3600000;
    const open = workDaySet.has(d.getDay()) && !holidaySet.has(ds);
    if (open && hour >= workStartH && hour < workEndH) return d.getTime();
    if (open && hour < workStartH) { d.setHours(workStartH, 0, 0, 0); return d.getTime(); }
    // Past the close, or a day the shop is shut: try the next day at opening.
    d.setDate(d.getDate() + 1);
    d.setHours(workStartH, 0, 0, 0);
  }
  return ms;
}

/**
 * Pack one row so nothing overlaps, and say what moved.
 *
 * PRIORITY, which is how the shop reasons about it rather than a convenience:
 *   1. An op with worked hours is PINNED. Its position is a record of when the work happened,
 *      and moving it would separate the hatch from the hours it stands for. Locked ops pin for
 *      the same reason.
 *   2. Among unworked ops, the earliest planned start takes the position it asked for.
 *   3. A later unworked op that would clash slides to the first free slot after it.
 *
 * Only ops inside the active horizon are touched. History sits where it is, may clash with
 * other history, and is exempt — a year of unfinished backlog packing forward would push a row
 * months into the future and describe nothing real.
 *
 * Returns [{ id, fromStart, toStart, fromMs, toMs }] for the ops that moved, so a caller can
 * log it and a human can review it before anything is written.
 */
export function packActiveRow(ops, { nowDay, cfg, durationMsOf }) {
  const moves = [];
  const list = (ops || []).filter((o) => o && o.start && o.end);
  const active = list.filter((o) => nowDay == null || o.end >= nowDay);
  if (active.length < 2) return moves;

  const durOf = durationMsOf || ((o) => { const i = opInterval(o, cfg); return i ? Math.max(0, i.e - i.s) : 0; });
  const pinned = active.filter((o) => o.locked || (o.workedHoursShown || 0) > 0);
  const movable = active.filter((o) => !(o.locked || (o.workedHoursShown || 0) > 0))
    .sort((a, b) => a.start.localeCompare(b.start)
      || ((a.startHour ?? 0) - (b.startHour ?? 0)));

  // Pinned work occupies its ground first; everything else has to fit around it.
  const occupied = pinned.map((o) => opInterval(o, cfg)).filter(Boolean);
  for (const o of movable) {
    const want = opInterval(o, cfg);
    const dur = durOf(o);
    if (!want || dur <= 0) continue;
    let at = firstFreeStart(want.s, dur, occupied);
    const rolled = normalizeToWorkTime(at, cfg);
    // Rolling onto working time can land inside something that was free at the raw instant, so
    // re-test once the roll has happened rather than trusting the first answer.
    if (rolled !== at) at = firstFreeStart(rolled, dur, occupied);
    occupied.push({ s: at, e: at + dur });
    if (at !== want.s) moves.push({ id: o.id, fromMs: want.s, toMs: at, fromStart: o.start, dur });
  }
  return moves;
}

/**
 * How many WHOLE business days an op must shift to stop overlapping anything on its row.
 *
 * Whole days, deliberately. An arbitrary instant is not always expressible as an op record:
 * a multi-day op has a start date, an end date and hours, and "start 3.2 hours later" has no
 * honest representation in that shape without recomputing its whole span. Shifting by whole
 * business days preserves the op exactly as it is and only moves it, which is always writable
 * and can never mangle the record.
 *
 * Returns 0 when it already fits — nothing is moved that does not have to be. Returns null if
 * no clear slot is found inside `maxDays`, so a caller can refuse the write rather than place
 * the op somewhere arbitrary and call it done.
 *
 * `shiftDays` is injected because business days, work days and holidays have one definition in
 * this codebase and a second one here would drift from it.
 */
export function dayShiftToClear(op, others, { cfg, shiftDays, maxDays = 260 }) {
  if (!op || typeof shiftDays !== "function") return 0;
  const occupied = (others || []).map((o) => opInterval(o, cfg)).filter((i) => i && i.e > i.s);
  if (!occupied.length) return 0;
  for (let n = 0; n <= maxDays; n++) {
    const moved = n === 0 ? op : { ...op, start: shiftDays(op.start, n), end: shiftDays(op.end, n) };
    const iv = opInterval(moved, cfg);
    if (!iv || iv.e <= iv.s) return 0;
    if (!occupied.some((o) => intervalsOverlap(iv, o))) return n;
  }
  return null;
}

/**
 * How far back a row's visibility window must reach so a displaced bar is never filtered out
 * of a viewport it is actually painted in.
 *
 * The filter tests an op's STORED dates; the paint uses its PUSHED position. Those diverge by
 * the push, so a bar can be drawn inside the window while its record sits outside it — the
 * filter drops it and the bar disappears, then reappears when the window scrolls back over its
 * stored dates. That is a viewport-dependent render, and it is the shape of bug this function
 * exists to prevent.
 *
 * Both causes of displacement count. The version this replaces summed only OVERRUN, which was
 * the only push that existed when it was written; the cursor push moves work much further, and
 * an op nobody has started contributes no overrun at all — so the newer and larger displacement
 * was invisible to the slack that was supposed to cover it.
 *
 * Over-estimating is safe and under-estimating is not: too much slack considers a few extra
 * bars that the row then clips, while too little makes work vanish. Hence a sum rather than a
 * maximum.
 */
export function rowSlackHours({ ops, nowMs, productiveBetween }) {
  let total = 0;
  for (const op of ops || []) {
    if (!op || op.isFullyWorked) continue;
    const size = Math.max(1, op.teamSize || 1);
    const worked = Math.max(0, op.workedHoursShown || 0);
    // Overrun: the bar is longer than planned, so everything after it shifts.
    total += Math.max(0, worked - (op.hpd || 0)) / size;
    // Cursor: untouched work inside the horizon slides to now, which is usually the bigger of
    // the two and was the one entirely missing.
    if (worked <= 0 && !op.locked && Number.isFinite(op.plannedStartMs) && Number.isFinite(nowMs)
        && nowMs > op.plannedStartMs && typeof productiveBetween === "function") {
      total += Math.max(0, productiveBetween(op.plannedStartMs, nowMs));
    }
  }
  return total;
}
