// The week/month schedule move (root cause 7, chunk A: #2 #3 #4 #18 #19 #20 #22 #23 #25).
//
// ONE landing, computed once and read by everything: the ghost, every check, and the commit.
// There used to be three ends for one drop (a flat pro-rate for PTO, one walk for the overlap
// re-check, another for the commit), checks that looked at the grabbed bar only, and a ghost
// that previewed a spot the drop was never tested against.
//
// Pure: no React, no clock reads. The caller passes the calendar, the day windows, "now" and
// the predicates that need app state (locked / live / overdue / time off).

import { walkProductiveHours, personShareHours, productiveHoursBetween, splitWorkedOp } from "./statsMath.js";
import { overlapsWith, occupyingUnits } from "./overlapRules.js";
import { unitDepartments, personDeptMatch, personDepartments, normalizeDepartments } from "./scheduleRules.js";
import { shopMs } from "./shopTime.js";
import { leaveOn } from "./timeOff.js";

const sid = (x) => String(x);
const same = (a, b) => a != null && b != null && sid(a) === sid(b);

/** Where a unit of `shareH` productive hours lands if it starts at (day, hour). */
export function landUnit({ day, hour, shareH, cfg, cal }) {
  const w = walkProductiveHours(hour, shareH, cfg);
  return { start: day, startHour: hour, end: cal.add(day, Math.max(1, w.days) - 1), endHour: w.endHour };
}

/**
 * The grabbed bar's move as the user SAW it: from where it is painted to where it was dropped,
 * in working days plus a clock-hour shift. Members apply the same move to their own positions.
 */
export function moveDelta({ fromDay, fromHour, toDay, toHour, cal }) {
  return { bdDelta: cal.diffSigned(fromDay, toDay), hourDelta: toHour - fromHour };
}

/** A member's new start: the grabbed bar's move applied to it, rolled over the working day. */
export function shiftStart({ day, hour }, { bdDelta, hourDelta }, { workStartH, workEndH, cal }) {
  const span = workEndH - workStartH;
  let d = cal.add(day, bdDelta), h = hour + hourDelta;
  for (let g = 0; g < 400 && span > 0 && h >= workEndH; g++) { h -= span; d = cal.add(d, 1); }
  for (let g = 0; g < 400 && span > 0 && h < workStartH; g++) { h += span; d = cal.add(d, -1); }
  return { day: d, hour: Math.round(h * 2) / 2 };
}

/**
 * Every mover's landing.
 *
 * grabbed: { id, node, fromDay, fromHour, shareH, hpd?, isRecord? }
 *   from = where the bar is PAINTED (#25). hpd: a RESIZE's new total (the team's), written
 *   with the landing. isRecord: a cross-row bar, a record of work done — never movable.
 * members: [{ id, node, day, hour, shareH }]          — dep-group (locked) and multi-select
 * drop:    { day, hour }                              — the grabbed bar's landing start
 * origPerson / dropPerson: the grabbed bar's row, and the row it was dropped on.
 *
 * Reassign (#19): the grabbed bar, and every member on the grabbed bar's person, move from
 * origPerson to dropPerson. Members on other people's rows move dates only.
 */
export function planDragMove({ grabbed, members = [], drop, origPerson, dropPerson, cfg, cal, workStartH, workEndH }) {
  const reassign = dropPerson != null && !same(dropPerson, origPerson);
  const newTeam = (team) => {
    const t = team || [];
    if (!reassign || !t.some(x => same(x, origPerson))) return null;
    const out = [];
    for (const x of t) { const y = same(x, origPerson) ? dropPerson : x; if (!out.some(z => same(z, y))) out.push(y); }
    return out;
  };
  const delta = moveDelta({ fromDay: grabbed.fromDay, fromHour: grabbed.fromHour, toDay: drop.day, toHour: drop.hour, cal });
  const mover = (m, at) => {
    const team = newTeam(m.node.team);
    const n = m.node;
    const resized = m.hpd != null;
    return {
      id: sid(m.id), node: n, shareH: m.shareH, isRecord: !!m.isRecord,
      from: { start: n.start, end: n.end, startHour: n.startHour ?? null, endHour: n.endHour ?? null, team: n.team || [], ...(resized ? { hpd: n.hpd ?? null } : {}) },
      to: { ...landUnit({ day: at.day, hour: at.hour, shareH: m.shareH, cfg, cal }), team: team || (n.team || []), ...(resized ? { hpd: m.hpd } : {}) },
      reassigned: !!team,
    };
  };
  return [
    mover(grabbed, drop),
    ...members.map(m => mover(m, shiftStart({ day: m.day, hour: m.hour }, delta, { workStartH, workEndH, cal }))),
  ];
}

/**
 * The first reason this drop must be refused, or null. Every mover is checked, not just the
 * one under the cursor (#18); the first failure refuses the WHOLE drop and names the unit.
 *
 * ctx: {
 *   isLocked(node), isLive(node), isOverdue(node),   — app-state predicates
 *   people,                                           — for the department rule
 *   timeOff(personId) → [{ start, end, reason? }],
 *   nowDay, nowHour, business,                        — past + overlap are Business-only
 *   tasks, overlapCtx                                 — for the one overlap rule
 * }
 */
/**
 * Whether this mover actually changes WHEN the work sits, as opposed to only who
 * is on it. A mover with no `from` cannot be shown to be standing still, so it
 * counts as moving — the safe direction, because the date-shaped rules then run.
 */
function datesMoved(m) {
  const f = m.from;
  if (!f) return true;
  // END HOUR AND hpd COUNT. A RESIZE does not move the start and may not even
  // change the day, but it changes how much time the work occupies — which is
  // exactly how it can be extended over somebody's leave. `resize-test` caught
  // this: a release that grew an op across its assignee's day off stopped being
  // refused when the comparison was start/end/startHour alone.
  return f.start !== m.to.start
    || f.end !== m.to.end
    || (f.startHour ?? null) !== (m.to.startHour ?? null)
    || (f.endHour ?? null) !== (m.to.endHour ?? null)
    || (f.hpd ?? null) !== (m.to.hpd ?? null);
}

export function refuseDragMove(movers, ctx) {
  const title = (m) => m.node?.title || "";
  for (const m of movers) {
    if (m.isRecord) return { kind: "record", id: m.id, title: title(m) };
    if (ctx.isLive?.(m.node)) return { kind: "live", id: m.id, title: title(m) };
    if (ctx.isLocked?.(m.node)) return { kind: "locked", id: m.id, title: title(m) };
    if (ctx.isOverdue?.(m.node)) return { kind: "overdue", id: m.id, title: title(m) };
  }
  // THE DEPARTMENT RULE IS NO LONGER A REFUSAL (#427, reversing root cause 7 B).
  // A drop onto someone outside the unit's department SUCCEEDS and the department
  // FOLLOWS the work — see departmentFollow below, applied in applyDragMove.
  // Nothing is checked here because nothing can fail here any more.
  // TIME OFF. Checked for anyone the edit ADDS, and for everyone when the DATES
  // move — those are the two ways a person can newly collide with their own leave
  // (#424). A crew change that leaves somebody where they already were, on dates
  // that are not changing, must not be refused on their behalf: that would block
  // an edit which does not touch them.
  for (const m of movers) {
    const moved = datesMoved(m);
    for (const pid of m.to.team || []) {
      if (!moved && (m.from?.team || []).some(x => same(x, pid))) continue;
      const hit = leaveOn(ctx.timeOff?.(pid), m.to.start, m.to.end);
      if (hit) return { kind: "pto", id: m.id, title: title(m), personId: pid, timeOff: hit };
    }
  }
  if (!ctx.business) return null;
  // THE PAST RULE IS ABOUT THE LANDING, so a mover that is not moving in time is
  // not landing anywhere (#424). An assignment carries the SAME dates on both
  // sides and only changes the crew; judging it by `to.start < nowDay` would
  // refuse every reassignment of every op that has already started — including
  // correcting who actually did last week's work, which is the opposite of what
  // this rule is for. Derived from the mover rather than passed as a flag, so no
  // caller can get it wrong, and so the same mistake is not available anywhere else.
  for (const m of movers) {
    if (!datesMoved(m)) continue;
    if (m.to.start < ctx.nowDay || (m.to.start === ctx.nowDay && m.to.startHour < ctx.nowHour)) {
      return { kind: "past", id: m.id, title: title(m) };
    }
  }
  // The one overlap rule. Each mover's hours are its own landing share; the other movers are
  // not obstacles where they USED to be, but they are where they LAND — two members reassigned
  // onto one row must not end up on top of each other.
  const shares = new Map(movers.map(m => [sid(m.id), m.shareH]));
  const baseShare = ctx.overlapCtx.shareHours
    || ((u) => personShareHours(u.hpd, (u.team || []).length, ctx.overlapCtx.productiveHoursPerDay));
  const octx = { ...ctx.overlapCtx, shareHours: (u) => (shares.has(sid(u.id)) ? shares.get(sid(u.id)) : baseShare(u)) };
  const moverIds = new Set(movers.map(m => sid(m.id)));
  const standing = occupyingUnits(ctx.tasks, octx);
  const landed = [];
  for (const m of movers) {
    const unit = { ...m.node, id: m.id, start: m.to.start, end: m.to.end, startHour: m.to.startHour, endHour: undefined, team: m.to.team };
    const hit = overlapsWith(unit, standing, octx, { excludeIds: moverIds })[0] || overlapsWith(unit, landed, octx)[0];
    if (hit) return { kind: "overlap", id: m.id, title: title(m), other: hit.other, personId: hit.personId, at: hit.at };
    landed.push({ unit, job: null, panel: null });
  }
  return null;
}

/**
 * The departments a unit may be done by, read from the tree: its own, else its
 * panel's, else its job's. A SET now (ruled 2026-10-02); [] means anyone.
 */
export function requiredDepartmentsOf(tasks, id) {
  for (const job of tasks || []) {
    if (same(job.id, id)) return unitDepartments(job, null, null);
    for (const panel of job.subs || []) {
      if (same(panel.id, id)) return unitDepartments(panel, null, job);
      for (const op of panel.subs || []) if (same(op.id, id)) return unitDepartments(op, panel, job);
    }
  }
  return [];
}

/**
 * A resize's new per-person share, measured across every day it spans (#9): productive hours
 * from the fixed edge to the dragged one, both where the bar is PAINTED (#10).
 *   side "left":  new start (day, hour) → painted end
 *   side "right": painted start → new end (day, hour)
 * cfg is the day windows plus workDays/holidays (productiveHoursBetween's cfg).
 */
export function resizeShare({ side, paintedStart, paintedEnd, day, hour, cfg, min = 0.25 }) {
  const a = side === "left" ? shopMs(day, hour) : shopMs(paintedStart.day, paintedStart.hour);
  const b = side === "left" ? shopMs(paintedEnd.day, paintedEnd.hour) : shopMs(day, hour);
  return Math.max(min, productiveHoursBetween(a, b, cfg));
}

/** A moveLog entry for one mover (#3). */
export function moveLogEntry(m, { date, movedBy, reason = "Moved in schedule", departments = null }) {
  return {
    fromStart: m.from.start, fromEnd: m.from.end, toStart: m.to.start, toEnd: m.to.end,
    fromStartHour: m.from.startHour, toStartHour: m.to.startHour,
    fromEndHour: m.from.endHour, toEndHour: m.to.endHour,
    ...(m.reassigned ? { fromTeam: m.from.team, toTeam: m.to.team } : {}),
    ...(m.to.hpd != null ? { fromHpd: m.from.hpd ?? null, toHpd: m.to.hpd } : {}),
    // THE REPLACED SET, and this is the whole difference from #341 (#427). That
    // one wrote a guess into the data and left nowhere to look afterwards; a
    // department rewritten by a gesture is recoverable because the gesture said
    // what it replaced. Absent when nothing changed, so the log does not fill
    // with entries that read like a change.
    ...(departments ? { fromDepartments: departments.from, toDepartments: departments.to } : {}),
    date, movedBy, reason,
  };
}

/**
 * The department a reassignment moves the work INTO, or null when nothing changes.
 *
 * Fires on exactly the condition that used to REFUSE the drop (#427): the unit
 * states (or inherits) a department, and somebody the edit ADDS is outside it.
 * An op that said "anyone" is left alone — narrowing a stated department in the
 * direction the work went is editing a fact, while creating one on an
 * unconstrained op is inventing a constraint from a gesture, and 89 of Matrix's
 * 112 ops say nothing at all.
 *
 * REPLACE, NOT UNION. The new set is the added people's departments: a union
 * would produce "Wire or Cut or Layout", which nobody can read as intent — it is
 * indistinguishable from someone having ticked three boxes.
 *
 * Returns `{ from, to }`, both arrays. `to` may be EMPTY: dropping on somebody
 * with no department widens the unit to "anyone", which is the one case that
 * removes a constraint rather than narrowing. Coherent — the work went to someone
 * unrestricted — and unreachable at Matrix, where all 18 people hold exactly one.
 */
export function departmentFollow(node, panel, job, m, people) {
  if (!m?.reassigned || !Array.isArray(people) || people.length === 0) return null;
  // NO `depts.length === 0` EARLY RETURN, and no "did the set actually change"
  // guard. Both were here and MUTATION PROVED THEM DEAD:
  //
  //   `[] means anyone` is already what personDeptMatch says — it returns true for
  //   every person when the requirement is empty, so nobody is ever "outside" an
  //   unconstrained unit and `outside` is empty on its own.
  //
  //   `to === depts` cannot happen: `outside` is exactly the people with NO
  //   overlap with `depts`, so the union of their departments is disjoint from it.
  //
  // Two mechanisms for one decision is a place for them to drift apart (#70), so
  // the condition is stated once, by personDeptMatch.
  const depts = unitDepartments(node, panel, job);
  const added = (m.to.team || []).filter(pid => !(m.from?.team || []).some(x => same(x, pid)));
  const outside = added
    .map(pid => people.find(p => same(p.id, pid)))
    .filter(p => p && !personDeptMatch(p, depts));
  if (outside.length === 0) return null;
  return { from: depts, to: normalizeDepartments(outside.flatMap(personDepartments)) };
}

/** The tasks with every mover written at its landing, each with its moveLog entry. */
export function applyDragMove(tasks, movers, { date, movedBy, reason, people = null }) {
  const byId = new Map(movers.map(m => [sid(m.id), m]));
  // `people` is what lets the department follow the work (#427). WITHOUT IT THE
  // REWRITE SILENTLY DOES NOT HAPPEN — and since the refusal is gone, a caller
  // that forgets it accepts the drop AND leaves the department stale, which is a
  // third behaviour worse than either of the two this replaced. Every call site
  // is asserted to pass it (`department-follow-test`).
  const put = (node, panel = null, job = null) => {
    const m = byId.get(sid(node.id));
    if (!m) return node;
    const dept = departmentFollow(node, panel, job, m, people);
    return {
      ...node,
      start: m.to.start, end: m.to.end, startHour: m.to.startHour, endHour: m.to.endHour,
      ...(m.reassigned ? { team: m.to.team } : {}),
      ...(m.to.hpd != null ? { hpd: m.to.hpd } : {}),
      // NO STATUS. A passthrough lived here for one release (#414) so the
      // pending tray could promote "Not Started" to "Pending" inside the plan.
      // #437 ruled the promotion away, which left this reachable by nothing —
      // and a parameter no caller can set is #419's stranded control wearing a
      // different hat. MOVING WORK IS NOT A STATUS CHANGE, in any caller.
      // THE UNIT THAT MOVED, and only it. Its panel and job keep what they said,
      // which is right for the gesture and is also how a panel and its ops begin
      // to disagree — see #426, where the picker is the thing that should change.
      ...(dept ? { requiredDepartments: dept.to, requiredDepartment: dept.to[0] || "" } : {}),
      moveLog: [...(node.moveLog || []), moveLogEntry(m, { date, movedBy, ...(reason ? { reason } : {}), departments: dept })],
    };
  };
  return (tasks || []).map(job => {
    const j = put(job);
    return { ...j, subs: (j.subs || []).map(panel => {
      const p = put(panel, null, j);
      return { ...p, subs: (p.subs || []).map(op => put(op, p, j)) };
    }) };
  });
}

/** The message a refusal shows. One wording per kind, naming the unit. */
export function refusalMessage(r) {
  const name = r.title ? `"${r.title}"` : "An operation";
  switch (r.kind) {
    case "splitPermission": return `${name} is partly worked, so moving it here splits it: the worked part stays and the rest becomes a new operation. Splitting needs the Edit jobs permission.`;
    case "record": return `${name} here is a record of work already done, so it can't be moved or resized. Move the operation from its own row.`;
    case "live": return `${name} can't be moved: someone is clocked into it.`;
    case "locked": return `${name} is locked and can't be moved.`;
    case "overdue": return `${name} is running over its estimate, so it can't be moved with the others. Deselect it, or wait until it is finished.`;
    case "pto": return `${name} would land on time off (${r.timeOff?.start}${r.timeOff?.end !== r.timeOff?.start ? ` – ${r.timeOff?.end}` : ""}).`;
    case "past": return `${name} would be placed before the current time. Jobs can't be scheduled in the past.`;
    case "overlap": return `${name} would overlap "${r.other?.unit?.title || "another operation"}" for the same person.`;
    default: return `${name} can't be moved there.`;
  }
}

/**
 * A week/month RESIZE as a session (root cause 7 C: #31 #32 #33).
 *
 * move() only PREVIEWS — it plans the landing and hands it to onPreview; nothing is written,
 * nothing reflows, nothing is snapshotted. release() commits ONCE through commit(plan), or
 * returns the refusal. A drag of N steps is one write and one undo step, not N + 1.
 *
 *   side        "left" | "right"
 *   precision   "halfHour" (month) | "day" (week: the edge snaps to workStart / workEnd)
 *   node        the unit being resized; teamSize its team's size (the estimate is the team's)
 *   paintedStart / paintedEnd  { day, hour } where the bar is drawn, the fixed edges (#10)
 *   cfg         day windows; fullCfg = cfg + workDays/holidays (productiveHoursBetween's)
 *   refuse(plan) → refusal | null      onPreview(preview | null)      commit(plan)
 */
export function resizeSession({ side, precision = "halfHour", node, teamSize = 1, paintedStart, paintedEnd, cfg, fullCfg, cal, workStartH, workEndH, origPerson, refuse, onPreview, commit }) {
  let last = null, lastKey = null;
  const move = ({ day, hour }) => {
    const h = precision === "day" ? (side === "left" ? workStartH : workEndH) : hour;
    if (side === "left") {
      if (day > paintedEnd.day || (day === paintedEnd.day && h >= paintedEnd.hour - 0.25)) return last?.preview ?? null;
    } else if (day < paintedStart.day || (day === paintedStart.day && h <= paintedStart.hour + 0.25)) return last?.preview ?? null;
    const key = day + "|" + h;
    if (key === lastKey) return last?.preview ?? null;
    lastKey = key;
    const share = resizeShare({ side, paintedStart, paintedEnd, day, hour: h, cfg: fullCfg });
    const from = side === "left" ? { day, hour: h } : paintedStart;
    const plan = planDragMove({
      grabbed: { id: node.id, node, fromDay: from.day, fromHour: from.hour, shareH: share, hpd: Math.round(share * Math.max(1, teamSize) * 100) / 100 },
      drop: from, origPerson, dropPerson: origPerson, cfg, cal, workStartH, workEndH,
    });
    const refusal = refuse(plan);
    const t = plan[0].to;
    const preview = { start: t.start, startHour: t.startHour, end: t.end, endHour: t.endHour, share, hpd: t.hpd, edge: { day, hour: h }, refused: !!refusal };
    last = { plan, preview };
    onPreview?.(preview);
    return preview;
  };
  const release = () => {
    onPreview?.(null);
    if (!last) return { kind: "none" };
    const refusal = refuse(last.plan);
    if (refusal) return { kind: "refused", refusal };
    commit(last.plan);
    return { kind: "committed", plan: last.plan };
  };
  return { move, release };
}

/**
 * THE split (root cause 7 D: #44 #45 #46 #47 #48). One op becomes two: the part that STAYS
 * keeps the original id (its sessions, attachments, chat and history point at it) and the
 * part that GOES is a new op carrying `splitFrom`, so the server knows its people were
 * already on the work and does not announce a new assignment.
 *
 * Used by every split there is: the week/month drag, the Gantt drag (both: worked part stays,
 * locked) and the manual "Split Job" modal (the chosen hours stay, unlocked).
 *
 *   node       the op being split (as stored)
 *   keep       { hpd, start, startHour, end, endHour, locked } — the part that stays, its hpd
 *              the team's total and its geometry walked from one person's share
 *   go         a mover from planDragMove (its landing, team and share) + { hpd, status? }
 *   newId      the new op's id
 *   reasons    { keep, go } — moveLog wording for each part
 */
export function applySplit(tasks, { node, keep, go, newId, date, movedBy, reasons = {} }) {
  const id = sid(node.id);
  const keepLog = {
    fromStart: node.start, fromEnd: node.end, toStart: keep.start, toEnd: keep.end,
    fromStartHour: node.startHour ?? null, toStartHour: keep.startHour, fromEndHour: node.endHour ?? null, toEndHour: keep.endHour,
    fromHpd: node.hpd ?? null, toHpd: keep.hpd, date, movedBy, reason: reasons.keep || "Split: this part stays",
  };
  const goLog = { ...moveLogEntry(go, { date, movedBy, reason: reasons.go || `Split from "${node.title || id}"` }), fromHpd: node.hpd ?? null, toHpd: go.hpd };
  return (tasks || []).map(job => ({ ...job, subs: (job.subs || []).map(panel => {
    const idx = (panel.subs || []).findIndex(o => same(o.id, id));
    if (idx < 0) return panel;
    const orig = panel.subs[idx];
    const { actualHours: _a, pendingFinish: _p, pendingSession: _s, finishRequest: _f, ...base } = orig;
    const kept = { ...orig, hpd: keep.hpd, start: keep.start, end: keep.end, startHour: keep.startHour, endHour: keep.endHour,
      moveLog: [...(orig.moveLog || []), keepLog] };
    const gone = { ...base, id: newId, splitFrom: orig.id, hpd: go.hpd, loggedHours: 0, deps: [],
      ...(go.title ? { title: go.title } : {}),
      status: go.status || (orig.status === "Finished" ? "Not Started" : (orig.status === "In Progress" ? "Not Started" : orig.status || "Not Started")),
      start: go.to.start, end: go.to.end, startHour: go.to.startHour, endHour: go.to.endHour, team: go.to.team,
      moveLog: [goLog] };
    const subs = [...panel.subs];
    subs.splice(idx, 1, kept, gone);
    return { ...panel, subs };
  }) }));
}

/**
 * The worked split's two parts: the worked part stays where it was, locked, walked from one
 * person's share of the worked hours (#46 — the team's total walked as one person's span was
 * team-size times too long); the rest is `remainderHpd`, which the caller lands.
 */
export function workedSplitParts({ node, workedHours, cfg, cal, workStartH }) {
  const size = Math.max(1, (node.team || []).length);
  const parts = splitWorkedOp({ hpd: node.hpd || 0, workedMs: Math.max(0, workedHours) * 3600000, teamSize: size });
  if (!parts.keep || !parts.remainder) return null;
  const sh = node.startHour ?? workStartH;
  const k = landUnit({ day: node.start, hour: sh, shareH: parts.perPersonKeepH, cfg, cal });
  return {
    keep: { hpd: parts.keep.hpd, start: node.start, startHour: sh, end: k.end, endHour: k.endHour },   // no locked: ruling 3
    remainderHpd: parts.remainder.hpd, remainderShare: parts.perPersonRemainderH,
  };
}

