// One overlap rule — SCHEDULE_MAP root cause 5 (#62, #24, #53, #61).
//
// Shared by the web client and the server (netlify/functions/tasks.js). Pure: it
// imports only statsMath.js, which the server already imports across the src/
// boundary.
//
// A person can't be doing two things at once. So overlap is an interval rule on the
// time a person actually works:
//   - a unit occupies, per working day, the block opDaySegments walks for it: its
//     person's share of hpd (hpd ÷ team) through productive time, from its start
//     hour on its first day — clipped to working days, so a Fri→Mon op does not
//     occupy the weekend, while an op an admin put on a Saturday does;
//   - blocks are half-open [start, end): an op ending at 12:00 and one starting at
//     12:00 do not overlap;
//   - two units overlap when they share an assignee (ids compared as strings) and
//     have blocks on the same day that intersect;
//   - taking part: unfinished, dated, live (no deletedAt on it or its parents) units
//     whose blocks reach today. Locked units take part — a lock pins a unit, it does
//     not free its time. Finished units and history do not.
//
// This replaces five rules that disagreed: the drag ghost (stored positions, hidden
// past ops), previewPush (whole days, strict ids, first team member only),
// enforceNoOverlap (weekend-spanning intervals, zero-width single-day ops, every
// shift computed against the pre-shift list — #53), checkOverlapsPure (a daily
// capacity sum, weekends counted — #61) and reflowPhaseOps (same person, same day).
//
// Over-booking a day is a different rule and it stays: capacityWarnings reports it,
// and callers WARN — a shop legitimately over-books a day and sorts it out.
//
// Basic tier allows overlap by design (a double-booked shift). Callers apply this
// rule on Business only — here, the web and the server alike.
import { opDaySegments, personShareHours, capacityOf, buildDayWindows } from "./statsMath.js";

const EPS = 1e-6;
const nextDay = (ds) => { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const prevDay = (ds) => { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const ids = (team) => (Array.isArray(team) ? team.map(String) : []);

/**
 * The context every function here takes, from org settings (the server's view).
 * The web builds the same object from its own dayWindowCfg.
 *   { cfg, productiveHoursPerDay, isWorkDay, today, shareHours? }
 * `shareHours(unit)` lets a caller replace a unit's per-person hours — the web adds
 * an overworked op's overrun, which the server can't see.
 */
export function overlapContext(settings = {}, today = null) {
  const ph = (t, d) => { const [h, m] = String(t || d).split(":").map(Number); return h + (m || 0) / 60; };
  const cfg = buildDayWindows(ph(settings.workStart, "07:00"), ph(settings.workEnd, "15:00"), settings.breaks || [], settings.lunch || { time: "12:00", durationMinutes: 30 });
  const productiveHoursPerDay = Math.max(1, (cfg.workEndH - cfg.workStartH) - cfg.deadH);
  const workDays = Array.isArray(settings.workDays) && settings.workDays.length ? settings.workDays : [1, 2, 3, 4, 5];
  const holidays = Array.isArray(settings.holidays) ? settings.holidays : [];
  const isWorkDay = (ds) => workDays.includes(new Date(ds + "T12:00:00Z").getUTCDay()) && !holidays.includes(ds);
  return { cfg, productiveHoursPerDay, isWorkDay, today };
}

/** The unit's blocks per day (for one assignee), from today on when `ctx.today` is set. */
export function unitBlocks(unit, ctx) {
  const hours = ctx.shareHours ? ctx.shareHours(unit) : personShareHours(unit.hpd, (unit.team || []).length, ctx.productiveHoursPerDay);
  const segs = opDaySegments({ ...unit, hpd: hours, team: [0] }, ctx);
  return ctx.today ? segs.filter(s => s.day >= ctx.today) : segs;
}

/** The first intersection of two units' blocks, or null. Half-open, so touching is not overlapping. */
export function blocksOverlap(a, b) {
  for (const x of a) for (const y of b) {
    if (x.day !== y.day) continue;
    const s = Math.max(x.startH, y.startH), e = Math.min(x.endH, y.endH);
    if (e - s > EPS) return { day: x.day, startH: s, endH: e };
  }
  return null;
}

/** Whether a unit takes part in overlap at all. */
export function takesPart(unit, ctx) {
  if (!unit || !unit.start || unit.deletedAt || unit.status === "Finished") return false;
  return !ctx.today || (unit.end || unit.start) >= ctx.today;
}

/** Leaf units that take part: live ops, and panels with no live ops. */
export function occupyingUnits(tasks, ctx) {
  const out = [];
  for (const job of tasks || []) {
    if (!job || job.deletedAt) continue;
    for (const panel of job.subs || []) {
      if (!panel || panel.deletedAt) continue;
      const ops = (panel.subs || []).filter(o => o && !o.deletedAt);
      for (const unit of ops.length ? ops : [panel]) if (takesPart(unit, ctx)) out.push({ unit, job, panel });
    }
  }
  return out;
}

/**
 * Every overlap between `candidate` and `others` (from occupyingUnits), per shared
 * assignee. `excludeIds` are left out (the candidate's own stored copy, siblings
 * moving with it). Returns [{ other, personId, at }].
 */
export function overlapsWith(candidate, others, ctx, { excludeIds = null } = {}) {
  if (!takesPart(candidate, ctx)) return [];
  const mine = ids(candidate.team);
  if (!mine.length) return [];
  const a = unitBlocks(candidate, ctx);
  if (!a.length) return [];
  const out = [];
  for (const o of others) {
    const id = String(o.unit.id);
    if (id === String(candidate.id) || (excludeIds && excludeIds.has(id))) continue;
    const shared = ids(o.unit.team).find(p => mine.includes(p));
    if (shared == null) continue;
    const at = blocksOverlap(a, unitBlocks(o.unit, ctx));
    if (at) out.push({ other: o, personId: shared, at });
  }
  return out;
}

/** Move a date by n working days (n may be negative). */
export function shiftWorkingDays(ds, n, ctx) {
  let d = ds, left = Math.abs(n);
  const step = n >= 0 ? nextDay : prevDay;
  for (let guard = 0; left > 0 && guard < 5000; guard++) { d = step(d); if (ctx.isWorkDay(d)) left--; }
  return d;
}
const shiftUnit = (u, n, ctx) => ({ ...u, start: shiftWorkingDays(u.start, n, ctx), end: shiftWorkingDays(u.end || u.start, n, ctx) });

/**
 * Push each touched unit later by whole working days until it overlaps nothing.
 * Sequential: each shift is applied before the next unit is checked, so two touched
 * units can never both land on the same free day (#53). Locked units are never
 * moved. A unit that can't be cleared within `maxDays` is refused and left where it
 * was. Returns { tasks, moved: [{ id, days, from }], refused: [id] }.
 */
export function clearOverlaps(tasks, touchedIds, ctx, { maxDays = 260 } = {}) {
  let current = tasks;
  const moved = [], refused = [];
  for (const raw of touchedIds || []) {
    const id = String(raw);
    const units = occupyingUnits(current, ctx);
    const me = units.find(u => String(u.unit.id) === id);
    if (!me || me.unit.locked === true) continue;
    let n = 0, probe = me.unit;
    while (n <= maxDays && overlapsWith(probe, units, ctx).length) { n++; probe = shiftUnit(me.unit, n, ctx); }
    if (n > maxDays) { refused.push(id); continue; }
    if (n > 0) {
      moved.push({ id, days: n, from: me.unit.start });
      current = replaceUnit(current, id, probe);
    }
  }
  return { tasks: current, moved, refused };
}

/**
 * Where a move pushes the units it lands on. `candidate` is the moved unit at its
 * new position. Each unit it overlaps goes to the first working day where it
 * clears everything already placed; that can land on the next, which cascades.
 * A locked unit in the way blocks the move. Returns { pushes, blocked, lockedOps }.
 */
export function planPushes(tasks, candidate, ctx, { excludeIds = null, maxDays = 260 } = {}) {
  const exclude = new Set([...(excludeIds || [])].map(String));
  exclude.add(String(candidate.id));
  let units = occupyingUnits(tasks, ctx).filter(u => !exclude.has(String(u.unit.id)));
  const placed = [{ unit: candidate }];
  const queue = overlapsWith(candidate, units, ctx).map(x => x.other);
  const pushes = [];
  const seen = new Set();
  while (queue.length) {
    const o = queue.shift();
    const id = String(o.unit.id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (o.unit.locked === true) return { pushes: [], blocked: true, lockedOps: [{ opTitle: o.unit.title || "", panelTitle: o.panel?.title || "" }] };
    let n = 1, probe = shiftUnit(o.unit, 1, ctx);
    while (n <= maxDays && overlapsWith(probe, placed, ctx).length) { n++; probe = shiftUnit(o.unit, n, ctx); }
    if (n > maxDays) return { pushes: [], blocked: true, lockedOps: [] };
    pushes.push({ opId: o.unit.id, opTitle: o.unit.title || "", panelTitle: o.panel?.title || "", jobTitle: o.job?.title || "",
      oldStart: o.unit.start, oldEnd: o.unit.end, newStart: probe.start, newEnd: probe.end, daysPushed: n, personId: ids(o.unit.team)[0] ?? null });
    placed.push({ unit: probe });
    units = units.filter(u => String(u.unit.id) !== id);
    for (const hit of overlapsWith(probe, units, ctx)) if (!seen.has(String(hit.other.unit.id))) queue.push(hit.other);
  }
  return { pushes, blocked: false, lockedOps: [] };
}

function replaceUnit(tasks, id, next) {
  return tasks.map(job => ({ ...job, subs: (job.subs || []).map(panel => {
    if (String(panel.id) === id) return { ...panel, start: next.start, end: next.end };
    return { ...panel, subs: (panel.subs || []).map(op => (String(op.id) === id ? { ...op, start: next.start, end: next.end } : op)) };
  }) }));
}

const SCHEDULE_KEYS = ["start", "end", "startHour", "endHour", "hpd", "team", "status", "deletedAt"];
const changedUnit = (a, b) => !a || SCHEDULE_KEYS.some(k => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));

/**
 * The server's check: units this write CHANGED (new, or moved, resized, re-hpd'd,
 * reassigned, reopened) that overlap another unit. Stored overlaps that the write
 * doesn't touch are left alone, so they never block an unrelated save.
 * Returns [{ rule: "overlap", id, jobId, withId, personId, day, detail }].
 */
export function overlapViolations(nextTasks, prevTasks, ctx) {
  const prevById = new Map();
  for (const { unit } of occupyingUnits(prevTasks, { ...ctx, today: null })) prevById.set(String(unit.id), unit);
  const units = occupyingUnits(nextTasks, ctx);
  const out = [], pairs = new Set();
  for (const u of units) {
    if (!changedUnit(prevById.get(String(u.unit.id)), u.unit)) continue;
    for (const hit of overlapsWith(u.unit, units, ctx)) {
      const key = [String(u.unit.id), String(hit.other.unit.id)].sort().join("|");
      if (pairs.has(key)) continue;
      pairs.add(key);
      out.push({ rule: "overlap", id: String(u.unit.id), jobId: String(u.job.id), withId: String(hit.other.unit.id),
        personId: hit.personId, day: hit.at.day,
        detail: `"${u.unit.title || u.unit.id}" overlaps "${hit.other.unit.title || hit.other.unit.id}" for person ${hit.personId} on ${hit.at.day}` });
    }
  }
  return out;
}

/**
 * Over-booked days: for each person, the working days on which the sum of their
 * shares (each unit's per-person hours spread over its working days) exceeds their
 * capacity. A warning, never a refusal. Returns [{ personId, day, load, cap }].
 */
export function capacityWarnings(tasks, people, ctx, { personIds = null, days = null } = {}) {
  const want = personIds ? new Set([...personIds].map(String)) : null;
  const load = new Map();
  for (const { unit } of occupyingUnits(tasks, ctx)) {
    const team = ids(unit.team);
    const share = ctx.shareHours ? ctx.shareHours(unit) : personShareHours(unit.hpd, team.length, ctx.productiveHoursPerDay);
    const wd = [];
    for (let d = unit.start, i = 0; d <= (unit.end || unit.start) && i < 400; d = nextDay(d), i++) if (ctx.isWorkDay(d) || d === unit.start) wd.push(d);
    const perDay = share / Math.max(1, wd.length);
    for (const pid of team) {
      if (want && !want.has(pid)) continue;
      for (const d of wd) {
        if (days && !days.has(d)) continue;
        const k = pid + "|" + d;
        load.set(k, (load.get(k) || 0) + perDay);
      }
    }
  }
  const byId = new Map((people || []).map(p => [String(p.id), p]));
  const out = [];
  for (const [k, h] of load) {
    const [pid, day] = k.split("|");
    const cap = capacityOf(byId.get(pid), ctx.productiveHoursPerDay);
    if (h - cap > EPS) out.push({ personId: pid, day, load: Math.round(h * 100) / 100, cap });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.personId.localeCompare(b.personId)));
}
