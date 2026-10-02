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

// ── DEPARTMENTS ARE SETS, ON BOTH SIDES ────────────────────────────────────
//
// Ruled 2026-10-02. An op names a FLAT SET of departments — "either, pick
// whoever is free" — and a person holds a flat set too. One concept, not two.
//
// This replaces two shapes at once:
//
//   OP SIDE   `requiredDepartment: string` could say one department or none,
//             so "Wire or Cut can do this" had to be written as "nothing",
//             which is also how you write "anyone". Two facts, one encoding —
//             and the title heuristic existed to paper over exactly that gap.
//
//   PERSON    `department` + `secondaryDepartment` was a two-slot PREFERENCE
//             ORDER, and personDeptMatch returned "primary"/"secondary" so
//             callers could rank a backup below a specialist. Measured before
//             removing it: ZERO of Matrix's 18 people held a secondary, so the
//             ordering was unexercised machinery. It is gone, with the six
//             comparators that read it.
//
// EMPTY IS CANONICAL AND MEANS ANYONE. "No departments" and "every department"
// are the same statement, so one of them has to be the stored form or they
// diverge: `normalizeDepartments` collapses a full set to []. Pick the empty
// one, because it stays correct when a new department is added to the org —
// a stored "all five" would silently stop meaning "anyone" on the day a sixth
// appears.

/** Coerce any of the stored shapes to a clean array of department names. */
function deptList(v) {
  if (Array.isArray(v)) return v.map(d => String(d || "").trim()).filter(Boolean);
  const one = String(v || "").trim();
  return one ? [one] : [];
}

/**
 * The stored form. Trims, de-duplicates, drops blanks, and collapses a set that
 * covers every known department to [] — the canonical "anyone".
 *
 * `allKnown` is the org's department list. Without it the collapse is skipped
 * rather than guessed, so a caller that cannot see org settings still gets a
 * clean array instead of a wrong one.
 */
export function normalizeDepartments(value, allKnown = null) {
  const seen = new Set();
  const out = [];
  for (const d of deptList(value)) {
    const k = d.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(d);
  }
  if (Array.isArray(allKnown) && allKnown.length > 0) {
    const known = new Set(allKnown.map(d => String(d || "").trim().toLowerCase()).filter(Boolean));
    if (known.size > 0 && out.length >= known.size && [...known].every(k => seen.has(k))) return [];
  }
  return out;
}

/** The departments a person holds. Reads the set, falling back to the old pair. */
export function personDepartments(p) {
  if (!p) return [];
  if (Array.isArray(p.departments)) return deptList(p.departments);
  return deptList([p.department, p.secondaryDepartment].filter(Boolean));
}

/**
 * The departments a unit may be done by: its own, else its panel's, else its
 * job's. [] means anyone — see the note above.
 *
 * Precedence is unchanged from the single-value version: the NEAREST level that
 * states anything wins outright. A panel saying "Wire or Cut" is not unioned
 * with a job saying "Layout"; the panel is simply more specific.
 */
export function unitDepartments(node, panel, job) {
  for (const n of [node, panel, job]) {
    if (!n) continue;
    const own = Array.isArray(n.requiredDepartments) ? deptList(n.requiredDepartments) : deptList(n.requiredDepartment);
    if (own.length) return own;
  }
  return [];
}

/**
 * Whether this person may take work requiring `reqDepts`.
 *
 * Boolean now, not "primary"/"secondary". A set has no preference order, and
 * the order that existed was never exercised.
 */
export function personDeptMatch(p, reqDepts) {
  const req = deptList(reqDepts);
  if (req.length === 0) return true;                 // anyone
  const mine = new Set(personDepartments(p).map(d => d.toLowerCase()));
  return req.some(d => mine.has(d.toLowerCase()));
}

/**
 * Back-compat for the older single-value readers, including the native clients.
 * `unitDepartment` keeps returning ONE department — the first — so a reader that
 * has not learned about sets narrows rather than breaks.
 *
 * The write side mirrors this: `requiredDepartment` is kept populated with the
 * first element beside `requiredDepartments`, so iOS's
 * `extras.text("requiredDepartment")` keeps decoding. Dropping the string
 * outright would make iOS see no department at all, which WIDENS rather than
 * breaks and is the safe direction — but it would have web and iOS scheduling
 * to different rules with nothing failing, which is worse than either.
 */
/**
 * Keep both shapes on a node that carries departments.
 *
 * `requiredDepartments` is the truth; `requiredDepartment` is kept populated
 * with the FIRST element so older readers narrow instead of breaking. That
 * matters off the web: iOS reads `extras.text("requiredDepartment")` at job,
 * panel and op level, and an array decodes there as nil — which would make iOS
 * treat every op as having no department. That WIDENS rather than breaks, and
 * widening is the safe direction under "absence means anyone" — but it would
 * leave web and iOS scheduling to different rules with nothing failing, which
 * is worse than either outcome on its own.
 *
 * Returns the node unchanged when it states no departments, so this can be run
 * over a whole tree without rewriting nodes that have nothing to say.
 */
export function withDepartmentDualWrite(node, allKnown = null) {
  if (!node || typeof node !== "object") return node;
  const has = Array.isArray(node.requiredDepartments) || node.requiredDepartment != null;
  if (!has) return node;
  const set = normalizeDepartments(
    Array.isArray(node.requiredDepartments) ? node.requiredDepartments : node.requiredDepartment,
    allKnown,
  );
  const first = set[0] || "";
  if (Array.isArray(node.requiredDepartments)
    && node.requiredDepartments.length === set.length
    && node.requiredDepartments.every((d, k) => d === set[k])
    && (node.requiredDepartment || "") === first) return node;
  return { ...node, requiredDepartments: set, requiredDepartment: first };
}

export function unitDepartment(node, panel, job) {
  return unitDepartments(node, panel, job)[0] || "";
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

    // department — a SET now. [] means anyone, so there is nothing to check.
    const depts = unitDepartments(n, after.panel, after.job);
    if (depts.length && Array.isArray(n.team) && n.team.length) {
      const prevDepts = before ? unitDepartments(before.node, before.panel, before.job) : null;
      // Compared as a joined key rather than by identity: the set is rebuilt on
      // every read, so `prev !== next` would fire on every write and re-check a
      // team nobody touched.
      const key = (a) => (a === null ? null : a.map(d => d.toLowerCase()).sort().join("\u0000"));
      if (isNew || teamChanged(before.node, n) || key(prevDepts) !== key(depts)) {
        const outside = n.team.filter(pid => { const p = byId.get(String(pid)); return p && !personDeptMatch(p, depts); });
        if (outside.length) add("department", id, after, `assigned outside ${depts.join(" or ")}: ${outside.join(", ")}`);
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
