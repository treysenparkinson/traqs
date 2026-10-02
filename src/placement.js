// THE PLACEMENT ENGINE. One implementation, for auto-scheduling and for
// re-planning a selection.
//
// ── Why this file exists ──────────────────────────────────────────────────
//
// There were four separate placement implementations in TRAQS.jsx, and they
// disagreed:
//
//   crewForOp + window search  the job wizard's availability check
//   eligible                   the wizard's assignment picker
//   eligible + scheduleTeamMode  the schedule / reschedule step
//   _autoAssign                FAST TRAQS import — picked purely by load and
//                              ignored departments entirely
//
// The evidence that this is a problem rather than an untidiness: the rule
// "respect an assignment the admin already made" had to be written TWICE, into
// two of the four, in one sitting. A fifth implementation for re-planning would
// mean the sixth rule gets written five times.
//
// Auto-scheduling and re-planning are the same problem. "Place a set of ops
// against people's availability, respecting departments, assignments and
// precedence" describes both. The difference is WHICH OPS ARE IN THE SET and
// WHAT COUNTS AS AN OBSTACLE — two parameters, not two algorithms.
//
// ── What this is NOT ──────────────────────────────────────────────────────
//
// Not a solver. With precedence between ops this is a resource-constrained
// project scheduling problem, which is NP-hard in general. The practical answer
// is a priority rule, and that is what `orderOps` is. It does not need to be
// optimal; it needs to beat what a person does by hand in thirty passes, which
// is a low bar that first-fit currently fails.
//
// Not an availability oracle either. `schedulerAvailability` in overlapRules.js
// is that, it is correct, and this calls it. The bug it fixed — a run
// double-booking one person because nothing recorded placements as they were
// made — is exactly why `book` must keep being called here after every
// placement.
//
// Pure: no React, no browser globals. The server does not import it today, but
// it is written so it could.

import { personDeptMatch, unitDepartments } from "./scheduleRules.js";

/** Ids as strings, always: person ids are mixed string/number across clients. */
const sid = (v) => (v == null ? "" : String(v));

/**
 * The people who may take this op, most-constrained rule first.
 *
 *   1. AN EXISTING TEAM WINS OUTRIGHT. Manual assignment is a state the
 *      scheduler respects, not a lock: the op still moves in time, it just
 *      keeps the people already on it. Checked before departments, because a
 *      person deliberately put on an op is a stronger statement than the
 *      department the op happens to name.
 *   2. Otherwise the op's departments, as a SET. [] means anyone.
 *   3. No fallback to all crew when a stated department has nobody free.
 *      That fallback is what produced the department funnel — it looked like a
 *      kindness and quietly scheduled 71 ops onto one person. An op that cannot
 *      be staffed is reported, not reassigned.
 */
export function candidatesFor(op, crew, { panel = null, job = null } = {}) {
  const roster = (crew || []).filter(Boolean);
  const team = Array.isArray(op?.team) ? op.team.map(sid).filter(Boolean) : [];
  if (team.length > 0) {
    const kept = roster.filter(p => team.includes(sid(p.id)));
    if (kept.length > 0) return kept;
    // The named people are not on the roster at all (left the org, filtered
    // out). Fall through to departments rather than returning nobody — the
    // assignment is stale, not a constraint to honour.
  }
  const depts = unitDepartments(op, panel, job);
  if (depts.length === 0) return roster;
  return roster.filter(p => personDeptMatch(p, depts));
}

/**
 * How constrained an op is: lower sorts first.
 *
 * THIS IS THE WHOLE DIFFERENCE between a usable answer and a bad one. Thirty
 * ops is not thirty placements in sequence — first-fit in arbitrary order lets
 * an early, unconstrained op take the only person a later, constrained one
 * could have used. An op whose team is already set has exactly ONE candidate,
 * so if a greedy pass books that person onto something else first, the op has
 * nowhere to go and the run reports it unplaceable for no real reason.
 */
export function constraintRank(op, crew, ctx = {}) {
  const cands = candidatesFor(op, crew, ctx).length;
  const hasTeam = Array.isArray(op?.team) && op.team.length > 0 ? 0 : 1;
  const hasDepts = unitDepartments(op, ctx.panel || null, ctx.job || null).length > 0 ? 0 : 1;
  const hasDependents = Array.isArray(op?.deps) && op.deps.length > 0 ? 0 : 1;
  return [cands, hasTeam, hasDepts, hasDependents];
}

/**
 * Most-constrained-first, with a deterministic tail.
 *
 * The last key is the op's CURRENT start, so a re-run over an unchanged
 * selection produces the same order and therefore the same plan. A scheduler
 * that reshuffles on every press is one nobody trusts.
 */
export function orderOps(ops, crew, ctxOf = () => ({})) {
  return [...(ops || [])].map((op, i) => ({ op, i, r: constraintRank(op, crew, ctxOf(op)) }))
    .sort((a, b) => {
      for (let k = 0; k < a.r.length; k++) if (a.r[k] !== b.r[k]) return a.r[k] - b.r[k];
      const d = (Number(b.op?.hpd) || 0) - (Number(a.op?.hpd) || 0);   // longest first
      if (d !== 0) return d;
      const s = String(a.op?.start || "").localeCompare(String(b.op?.start || ""));
      if (s !== 0) return s;
      return a.i - b.i;                                                // stable
    })
    .map(x => x.op);
}

/**
 * Pick one of several candidates under the chosen objective.
 *
 * RULED 2026-10-02: EVEN LOAD is the default, "Finish soonest" the alternative,
 * and the choice is exposed rather than hard-coded — it is a judgement about
 * the shop, not a property of the schedule.
 *
 * The trade, recorded because it is real and was measured before the choice:
 * equalising means giving Thursday work to someone when somebody else could
 * have done it Tuesday. A single job finishes later than it needs to, and on a
 * Gantt that looks like slack. The compensation is invisible on that same
 * Gantt — it is the next job starting sooner because nobody is saturated.
 *
 * @param objective "even" | "soonest"
 * @param loadOf    (personId) -> hours already assigned this run
 * @param earliestFor (person) -> the first day that person could start, or null
 */
export function pickCandidate(candidates, { objective = "even", loadOf = () => 0, earliestFor = () => null } = {}) {
  const list = (candidates || []).filter(Boolean);
  if (list.length === 0) return null;
  const scored = list.map(p => ({ p, load: Number(loadOf(p.id)) || 0, when: earliestFor(p) }));
  // Someone who cannot start at all never wins, whatever the objective.
  const able = scored.filter(x => x.when !== null);
  const pool = able.length > 0 ? able : [];
  if (pool.length === 0) return null;
  pool.sort((a, b) => {
    if (objective === "soonest") {
      const w = String(a.when).localeCompare(String(b.when));
      if (w !== 0) return w;
      if (a.load !== b.load) return a.load - b.load;        // tie: lighter person
    } else {
      if (a.load !== b.load) return a.load - b.load;        // even load first
      const w = String(a.when).localeCompare(String(b.when));
      if (w !== 0) return w;                                 // tie: sooner start
    }
    return String(a.p.name || "").localeCompare(String(b.p.name || ""));
  });
  return pool[0].p;
}

/**
 * The same choice as `pickCandidate`, applied to a whole list.
 *
 * Call sites that walk candidates trying successive start dates need them in
 * order rather than one at a time, and they must order by the SAME rule or the
 * objective means two things. `earliestFor` is optional: without it, "soonest"
 * has nothing to sort by and falls back to load, which is the honest answer
 * rather than a silent reordering.
 */
export function orderByObjective(candidates, { objective = "even", loadOf = () => 0, earliestFor = null } = {}) {
  return [...(candidates || [])].filter(Boolean).sort((a, b) => {
    const la = Number(loadOf(a.id)) || 0, lb = Number(loadOf(b.id)) || 0;
    if (objective === "soonest" && typeof earliestFor === "function") {
      const wa = earliestFor(a), wb = earliestFor(b);
      if (wa !== wb) {
        if (wa == null) return 1;
        if (wb == null) return -1;
        const w = String(wa).localeCompare(String(wb));
        if (w !== 0) return w;
      }
    }
    if (la !== lb) return la - lb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/**
 * What a run reports per op. An op that cannot be staffed or cannot be placed is
 * LEFT WHERE IT IS and flagged — never placed anyway at the earliest date.
 *
 * Ruled 2026-10-02, and the reason is in this repository's history: placing it
 * anyway is the silent fallback wearing a better face, and the silent fallback
 * is what produced the department funnel.
 */
export const OUTCOME = {
  placed: "placed",
  noCandidates: "no-candidates",   // a stated department nobody on the roster holds
  noWindow: "no-window",           // candidates exist, none free inside the horizon
  clocked: "clocked",              // someone is clocked into it — the one real lock
};

/**
 * A pre-flight for a re-plan: what would happen to each selected op, and who
 * would carry what.
 *
 * BUILT FROM THE SAME PRIMITIVES THE RUN USES — candidatesFor, the availability
 * oracle, pickCandidate — rather than simulating a second scheduler. A preview
 * that models the run separately is a fifth implementation wearing a different
 * name, and it drifts: this whole consolidation exists because four of those
 * disagreed.
 *
 * Every op comes back with an outcome. NOTHING IS SILENTLY PLACED and nothing is
 * silently dropped: an op that cannot be staffed is named with the reason, which
 * is the rule that the all-crew fallback used to break.
 *
 * @param ops      the selected ops, in any order (they are ordered here)
 * @param crew     the assignable roster
 * @param avail    { free(pid, start, end, startH), book(pid, start, end, startH) }
 * @param people   for the active-clock check
 * @param windowOf (op) -> { start, end, startH } — where the caller wants it
 */
export function previewOutcomes(ops, crew, { avail, people = [], windowOf, objective = "even", ctxOf = () => ({}) } = {}) {
  const rows = [];
  const load = new Map();                       // personId -> hours this plan
  const loadOf = (id) => load.get(sid(id)) || 0;

  for (const op of orderOps(ops || [], crew, ctxOf)) {
    const lock = isReplannable(op, people);
    if (!lock.ok) { rows.push({ op, outcome: lock.reason, person: null }); continue; }

    const cands = candidatesFor(op, crew, ctxOf(op));
    if (cands.length === 0) {
      // NOBODY CAN DO IT — a stated department with no holder on the roster.
      // Distinct from no-window below, and they want different answers: this one
      // is fixed by widening the department or hiring, not by waiting.
      rows.push({ op, outcome: OUTCOME.noCandidates, person: null });
      continue;
    }

    const w = windowOf ? windowOf(op) : null;
    const earliestFor = (p) => {
      if (!w || !avail) return w ? w.start : null;
      return avail.free(p.id, w.start, w.end, w.startH ?? null) ? w.start : null;
    };
    const pick = pickCandidate(cands, { objective, loadOf, earliestFor });
    if (!pick) {
      // NOBODY IS FREE — the people exist, the time does not. Fixed by moving
      // the window, not by changing who may do it.
      rows.push({ op, outcome: OUTCOME.noWindow, person: null, candidates: cands.length });
      continue;
    }

    if (avail && w) avail.book(pick.id, w.start, w.end, w.startH ?? null);
    load.set(sid(pick.id), loadOf(pick.id) + (Number(op.hpd) || 0));
    rows.push({ op, outcome: OUTCOME.placed, person: pick, window: w });
  }

  // Per-person load, reported even though the objective IS even load. An
  // even-load plan can still produce something worth overriding by hand, and
  // manual assignment is respected now — so the number has to be visible for
  // that override to be an informed one rather than a hunch.
  const byPerson = [...load.entries()]
    .map(([id, hours]) => ({ id, hours, name: (crew || []).find(p => sid(p.id) === id)?.name || id }))
    .sort((a, b) => b.hours - a.hours || String(a.name).localeCompare(String(b.name)));

  return {
    rows,
    byPerson,
    placed: rows.filter(r => r.outcome === OUTCOME.placed).length,
    blocked: rows.filter(r => r.outcome !== OUTCOME.placed),
  };
}

/** Whether an op may be re-planned at all. The only real lock is an active clock. */
export function isReplannable(op, people) {
  const id = sid(op?.id);
  const clockedInto = (people || []).some(p => {
    const jc = p?.activeJobClock;
    return jc && jc.clockIn && sid(jc.opId) === id;
  });
  return clockedInto ? { ok: false, reason: OUTCOME.clocked } : { ok: true };
}
