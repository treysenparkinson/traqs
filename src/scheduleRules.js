// Schedule rules shared by the web client and the server (netlify/functions/tasks.js).
//
// Pure: no React, no browser globals, no imports. The server imports this file
// across the src/ boundary (proven on a deploy preview), so anything added here
// must stay dependency-free.
//
// SCHEDULE_MAP root cause 3: every schedule rule used to live only in clients, so
// iOS, the Mac app, the API or a stale tab could break any of them. The server now
// checks the ones every client agrees on. Overlap is now one rule too, in
// overlapRules.js (root cause 5); the work-hours window stays client-only until its
// default is unified.
//
// Only what a write CHANGES is checked. Stored data that already breaks a rule is
// left alone, so a legacy weekend op never blocks an unrelated save.

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

const SCHEDULE_FIELDS = ["start", "end", "startHour", "endHour", "hpd"];

/** A "YYYY-MM-DD" day is in the org's work week and is not a holiday. */
export function isWorkingDay(ds, { workDays = DEFAULT_WORK_DAYS, holidays = [] } = {}) {
  if (typeof ds !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(ds)) return false;
  const day = ds.slice(0, 10);
  // UTC noon: the weekday of a calendar date, the same on every machine.
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const days = Array.isArray(workDays) && workDays.length ? workDays : DEFAULT_WORK_DAYS;
  return days.includes(dow) && !(Array.isArray(holidays) && holidays.includes(day));
}

// ── The working calendar (SCHEDULE_MAP root cause 6) ─────────────────────────
// The ONE answer to "is this a working day, and how many working days apart are
// two dates" — the org's work week AND its holidays, every loop bounded. Working-day
// math used to read org config only when a caller remembered to pass it, fell back
// to Mon–Fri with no holidays when it didn't, and some helpers never took holidays
// at all: a holiday was painted over, moves landed on weekends, and an empty work
// week hung every open session. An empty or missing work week reads as Mon–Fri.
const CAL_BOUND = 5000;
const dayStep = (ds, n) => { const d = new Date(`${ds.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * @param settings { workDays?, holidays? } — org settings (or a subset)
 * @returns {{ isWorkDay, add, next, diff, diffSigned, span, countForward, segments, spansOffDay }}
 *   add(ds, n)          n working days after (or before, n < 0) ds, not counting ds
 *   next(ds)            ds when it is a working day, else the next one
 *   diff(a, b)          working days in (a, b]; 0 when b <= a
 *   diffSigned(a, b)    diff, negative when b is before a
 *   span(a, b)          working days in [a, b]
 *   countForward(s, n)  the day on which the n-th working day counting from s (inclusive) falls
 *   segments(start, end, clampStart, clampEnd, noClampStart)  runs of consecutive working days
 *   spansOffDay(a, b)   whether [a, b] contains a non-working day or holiday
 */
export function workCalendar({ workDays, holidays } = {}) {
  const days = Array.isArray(workDays) && workDays.some(d => Number.isInteger(d) && d >= 0 && d <= 6)
    ? workDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT_WORK_DAYS;
  const off = new Set(Array.isArray(holidays) ? holidays.map(h => String(h).slice(0, 10)) : []);
  const isWorkDay = (ds) => typeof ds === "string" && /^\d{4}-\d{2}-\d{2}/.test(ds)
    && days.includes(new Date(`${ds.slice(0, 10)}T12:00:00Z`).getUTCDay()) && !off.has(ds.slice(0, 10));
  const add = (ds, n) => {
    if (!ds) return ds;
    let d = ds.slice(0, 10), left = Math.abs(n);
    const dir = n >= 0 ? 1 : -1;
    for (let g = 0; left > 0 && g < CAL_BOUND; g++) { d = dayStep(d, dir); if (isWorkDay(d)) left--; }
    return d;
  };
  const next = (ds) => {
    if (!ds) return ds;
    let d = ds.slice(0, 10);
    for (let g = 0; !isWorkDay(d) && g < CAL_BOUND; g++) d = dayStep(d, 1);
    return d;
  };
  const diff = (a, b) => {
    if (!a || !b) return 0;
    let n = 0;
    for (let d = a.slice(0, 10), g = 0; d < b.slice(0, 10) && g < CAL_BOUND; g++) { d = dayStep(d, 1); if (isWorkDay(d)) n++; }
    return n;
  };
  const span = (a, b) => {
    if (!a || !b) return 0;
    let n = 0;
    for (let d = a.slice(0, 10), g = 0; d <= b.slice(0, 10) && g < CAL_BOUND; g++, d = dayStep(d, 1)) if (isWorkDay(d)) n++;
    return n;
  };
  const countForward = (start, numDays) => {
    if (!start || numDays <= 0) return start;
    let d = start.slice(0, 10), c = 0;
    for (let g = 0; g < CAL_BOUND; g++) { if (isWorkDay(d) && ++c >= numDays) break; d = dayStep(d, 1); }
    return d;
  };
  const segments = (start, end, clampStart, clampEnd, noClampStart = false) => {
    const s = (!noClampStart && start < clampStart) ? clampStart : start;
    const e = end > clampEnd ? clampEnd : end;
    if (!s || !e || s > e) return [];
    const out = []; let segStart = null;
    for (let d = s, g = 0; d <= e && g < CAL_BOUND; g++, d = dayStep(d, 1)) {
      const wd = isWorkDay(d);
      if (wd && segStart === null) segStart = d;
      else if (!wd && segStart !== null) { out.push({ start: segStart, end: dayStep(d, -1) }); segStart = null; }
    }
    if (segStart !== null) out.push({ start: segStart, end: e });
    return out;
  };
  const spansOffDay = (a, b) => {
    for (let d = a, g = 0; d <= b && g < CAL_BOUND; g++, d = dayStep(d, 1)) if (!isWorkDay(d)) return true;
    return false;
  };
  return { isWorkDay, add, next, diff, diffSigned: (a, b) => (a <= b ? diff(a, b) : -diff(b, a)), span, countForward, segments, spansOffDay };
}

/** "primary" / "secondary" when the person holds the department, false otherwise. */
export function personDeptMatch(p, reqDept) {
  if (!reqDept) return "primary";
  if ((p?.department || "") === reqDept) return "primary";
  if ((p?.secondaryDepartment || "") === reqDept) return "secondary";
  return false;
}

/**
 * The department a unit requires: its own requiredDepartment, else its panel's,
 * else its job's. An empty string counts as unset, as in the web's deptOfUnit.
 * The web additionally treats an op titled like a department as requiring it;
 * that heuristic stays client-side, so the server is never stricter than the web.
 */
export function unitDepartment(node, panel, job) {
  return (node && node.requiredDepartment)
    || (panel && panel.requiredDepartment)
    || (job && job.requiredDepartment)
    || "";
}

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const teamKey = (t) => JSON.stringify(Array.isArray(t) ? t.map(String).sort() : []);
const scheduleChanged = (a, b) => SCHEDULE_FIELDS.some(k => !eq(a?.[k], b?.[k]));
const teamChanged = (a, b) => teamKey(a?.team) !== teamKey(b?.team);

// id -> { node, panel, job, live, leaf }. `live` is false when the node or any
// ancestor is tombstoned; `leaf` when it has no live children (the level that
// carries a bar).
function index(tasks) {
  const map = new Map();
  for (const job of tasks || []) {
    if (!job || job.id == null) continue;
    const jobLive = !job.deletedAt;
    const panels = (job.subs || []).filter(Boolean);
    map.set(String(job.id), { node: job, panel: null, job: null, live: jobLive,
      leaf: !panels.some(p => !p.deletedAt) });
    for (const panel of panels) {
      if (panel.id == null) continue;
      const panelLive = jobLive && !panel.deletedAt;
      const ops = (panel.subs || []).filter(Boolean);
      map.set(String(panel.id), { node: panel, panel: null, job, live: panelLive,
        leaf: !ops.some(o => !o.deletedAt) });
      for (const op of ops) {
        if (op.id == null) continue;
        map.set(String(op.id), { node: op, panel, job, live: panelLive && !op.deletedAt, leaf: true });
      }
    }
  }
  return map;
}

/**
 * @param nextTasks  the tree being written
 * @param prevTasks  the tree stored before it
 * @param ctx        { people, workDays, holidays, today ("YYYY-MM-DD", org-local), isAdmin }
 * @returns [{ rule, id, jobId, detail }] — empty when the write breaks nothing
 *
 * Rules:
 *   lock        — a locked unit's schedule and team don't change and it isn't
 *                 removed, unless the same write unlocks it. Everyone.
 *   activeClock — no schedule, team or removal change to an op someone is clocked
 *                 into (removing its panel or job counts). Reported on the op.
 *                 Everyone.
 *   department  — every team member of a leaf with a department holds it,
 *                 checked when the team or the department changes. Everyone.
 *   businessDay — a leaf's changed start/end is a working day. Admins exempt.
 *   past        — a leaf's start is not moved, or created, before today.
 *                 Admins exempt.
 */
export function scheduleRuleViolations(nextTasks, prevTasks, ctx = {}) {
  const { people = [], workDays, holidays, today, isAdmin = false } = ctx;
  const next = index(nextTasks), prev = index(prevTasks);
  const out = [];
  const add = (rule, id, entry, detail) =>
    out.push({ rule, id: String(id), jobId: String((entry?.job ?? entry?.node)?.id ?? id), detail });

  // ── the `lock` rule is GONE. Ruled 2026-10-02 ────────────────────────────
  //
  // THE ONLY REAL LOCK IS AN ACTIVE CLOCK, which is the rule immediately below
  // and is unchanged. A clocked-out op moves freely, including one that has
  // already been worked on.
  //
  // What `op.locked` actually meant is worth recording, because the name
  // promised far more than it did: it was set in exactly four places, ALL of
  // them the split path (statsMath splitByWorked, dragMove's keep half, the
  // Split Job modal), and it marked the already-worked remnant of a split.
  // There was never any UI to set it and none to clear it — #49 found the
  // missing unlock; there was no lock either. So this rule refused writes
  // against a flag no user could create or remove, on precisely the ops the
  // ruling says should move freely.
  //
  // Nothing replaces it. `activeClock` below reads the PERSON's activeJobClock,
  // which is the thing that genuinely must not move, and it already covers
  // schedule changes, team changes and removal.

  // activeClock
  const clockedOps = new Set(people
    .filter(p => p?.activeJobClock?.clockIn && p.activeJobClock.opId != null)
    .map(p => String(p.activeJobClock.opId)));
  for (const id of clockedOps) {
    const before = prev.get(id);
    if (!before || !before.live) continue;
    const after = next.get(id);
    if (!after || !after.live) { add("activeClock", id, before, "the op someone is clocked into was removed"); continue; }
    if (scheduleChanged(before.node, after.node) || teamChanged(before.node, after.node)) {
      add("activeClock", id, after, "the op someone is clocked into was moved or reassigned");
    }
  }

  const byId = new Map(people.filter(p => p && p.id != null).map(p => [String(p.id), p]));
  for (const [id, after] of next) {
    if (!after.live || !after.leaf) continue;
    const before = prev.get(id);
    const isNew = !before || !before.live;
    const n = after.node;

    // department
    const dept = unitDepartment(n, after.panel, after.job);
    if (dept && Array.isArray(n.team) && n.team.length) {
      const prevDept = before ? unitDepartment(before.node, before.panel, before.job) : null;
      if (isNew || teamChanged(before.node, n) || prevDept !== dept) {
        const outside = n.team.filter(pid => { const p = byId.get(String(pid)); return p && !personDeptMatch(p, dept); });
        if (outside.length) add("department", id, after, `assigned outside ${dept}: ${outside.join(", ")}`);
      }
    }

    if (isAdmin) continue;   // business days and the past: admins are exempt

    // businessDay
    const opts = { workDays, holidays };
    for (const k of ["start", "end"]) {
      const v = n[k];
      if (!v || (!isNew && eq(before.node[k], v))) continue;
      if (!isWorkingDay(v, opts)) { add("businessDay", id, after, `${k} ${v} is not a working day`); break; }
    }

    // past
    if (today && n.start && (isNew || !eq(before.node.start, n.start)) && String(n.start).slice(0, 10) < today) {
      add("past", id, after, `start ${n.start} is before ${today}`);
    }
  }
  return out;
}
