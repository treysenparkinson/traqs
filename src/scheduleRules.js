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

  // lock
  for (const [id, before] of prev) {
    if (!before.live || before.node.locked !== true) continue;
    const after = next.get(id);
    if (!after || !after.live) { add("lock", id, before, "a locked unit was removed"); continue; }
    if (after.node.locked !== true) continue;   // unlocked in this same write
    if (scheduleChanged(before.node, after.node) || teamChanged(before.node, after.node)) {
      add("lock", id, after, "a locked unit's schedule or team changed");
    }
  }

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
