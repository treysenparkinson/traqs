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
  return summarize(rows, crew);
}

/**
 * Rows -> the reported shape. ONE function, so a preview and a real run cannot
 * describe the same plan differently: the panel that renders one renders the
 * other. Load is derived from the placed rows rather than passed in, which is
 * what makes "a blocked op carries no hours" true by construction instead of by
 * remembering not to add them.
 */
function summarize(rows, crew) {
  const load = new Map();
  for (const r of rows) {
    if (r.outcome !== OUTCOME.placed || !r.person) continue;
    const k = sid(r.person.id);
    load.set(k, (load.get(k) || 0) + (Number(r.op?.hpd) || 0));
  }
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

/**
 * Fold a REAL run's per-op results into the same shape previewOutcomes returns.
 *
 * #344. The run used to abort: one collision and it returned the original job,
 * so a 30-op job gave you nothing because one op clashed. Aborting is not the
 * conservative choice it looks like — it discards the 29 placements that were
 * fine in order to avoid the 1 that was not.
 *
 * Nothing here decides anything. The run has already decided, op by op; this
 * only states what happened in the shape the panel already knows how to read.
 */
export function foldRunOutcomes(results, { crew = [] } = {}) {
  const rows = (results || []).map(r => {
    const row = { op: r.op, outcome: r.outcome || OUTCOME.placed, person: r.person || null };
    if (r.candidates != null) row.candidates = r.candidates;
    return row;
  });
  return summarize(rows, crew);
}

/**
 * How much WORK each person is already carrying, in hours — the measure the
 * even-load objective balances on.
 *
 * #345. This replaced two identical copies of a `jobCount` that counted
 * unfinished panel and op ROWS. On TORUS that called a 370h / 179h split even,
 * because the two people held a similar NUMBER of bars. Balancing the count of
 * things is not balancing the work, and `previewOutcomes` had been summing
 * op.hpd all along — so the preview Treysen reads before committing and the run
 * that committed already disagreed about what "even" meant.
 *
 * Takes units from occupyingUnits() rather than walking the task tree again.
 * That is deliberate: the two counters this replaces each re-implemented the
 * traversal, and each re-implemented it incompletely — no deletedAt check, no
 * date filter, so an undated or long-past unfinished bar made somebody look
 * permanently busy and quietly steered work away from them for good.
 *
 * Ids are compared through sid(), not `.includes()`. 12 of 1197 live Matrix
 * memberships are number-typed against string person ids, and `.includes` misses
 * every one of them SILENTLY — the person just looks lighter than they are, so
 * the balancer hands them more.
 *
 * Returns a loadOf(id) function, the shape pickCandidate and orderByObjective
 * already take.
 */
export function hoursLoadOf(units, { excludeJobId = null } = {}) {
  const drop = excludeJobId != null ? sid(excludeJobId) : null;
  const load = new Map();
  for (const u of units || []) {
    const node = u?.unit || u;
    if (!node) continue;
    if (drop != null && sid(u?.job?.id) === drop) continue;
    const team = (node.team || []).map(sid).filter(Boolean);
    if (!team.length) continue;
    // One op's hours are shared by the people on it: a 2-person 8h op is 4h
    // each, not 8h each. Counting it twice would make teamed work look twice
    // as expensive as it is and push the balancer away from teams entirely.
    const share = (Number(node.hpd) || 0) / team.length;
    for (const pid of team) load.set(pid, (load.get(pid) || 0) + share);
  }
  return (id) => load.get(sid(id)) || 0;
}

/**
 * The rows for the Jobs page's quick-assign picker: who can do this op, best
 * first, with everybody else after a divider.
 *
 * RULED 2026-10-05. Department matches lead; the rest of the crew follow a
 * divider. NOBODY IS HIDDEN — a strict filter would leave an op whose
 * department no one holds with an empty dropdown and no way to assign it at
 * all, which is worse than an imperfect order.
 *
 * It asks candidatesFor rather than re-deriving eligibility, so the picker and
 * the scheduler cannot disagree about who may do an op. That is the whole point
 * of putting this here instead of in the component.
 *
 * Returns [{ id, name, dept, match }] with at most one { divider: true } between
 * the two groups, and no divider when there is nothing to divide — an op open
 * to anyone, or one nobody matches, is a single flat list either way.
 */
export function assignPickerOptions(op, crew, ctx = {}) {
  const all = (crew || []).filter(Boolean);
  // `busyWith(personId)` -> null when free, or the unit they clash with. Passed
  // in rather than computed here: the caller holds schedulerAvailability, the
  // one oracle that answers "is this person free", and this must not become a
  // second one. A busy person is MARKED, never hidden — "why isn't Caleb in the
  // list" is a worse question to be left with than "Caleb is booked Tue–Thu".
  const busyWith = typeof ctx.busyWith === "function" ? ctx.busyWith : () => null;
  // An op that already names a team would make candidatesFor return just them
  // (manual assignment wins), which is right for the scheduler and wrong for a
  // picker whose job is to OFFER a change. Ask about the op's department only.
  const { team: _drop, ...noTeam } = op || {};
  const matchIds = new Set(candidatesFor(noTeam, all, ctx).map(p => sid(p.id)));

  const row = (p) => ({
    id: p.id,
    name: p.name || sid(p.id),
    // Resolved once per person here rather than at render: the row carries both
    // the flag and WHAT the clash is, so the refusal can name it without asking
    // the oracle a second time.
    busy: !!busyWith(p.id),
    busyWith: busyWith(p.id) || null,
    // The person's own department, for the row's secondary label. Empty string
    // rather than undefined so the UI can print it without a guard.
    dept: (Array.isArray(p.departments) ? p.departments[0] : p.department) || "",
    match: matchIds.has(sid(p.id)),
  });
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));

  const rows = all.map(row);
  // Free before busy INSIDE each group, so the names that can actually be
  // picked lead — but never across the divider: a busy department match still
  // outranks a free outsider, because the department is the stronger signal and
  // being busy is a timing problem rather than a competence one.
  const order = (a, b) => (a.busy === b.busy ? byName(a, b) : (a.busy ? 1 : -1));
  const hits = rows.filter(r => r.match).sort(order);
  const rest = rows.filter(r => !r.match).sort(order);
  if (!hits.length || !rest.length) return [...hits, ...rest];
  return [...hits, { divider: true }, ...rest];
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

/**
 * A NON-BLOCKING load hint for one person over one date range: "3 of 5 days full",
 * or null when there is nothing worth saying (#395).
 *
 * WHAT THIS REPLACES. `planAvailability` in TRAQS.jsx answered a CAPACITY question
 * — is every working day in the range either time off or booked to capacity — and
 * the Job Details popover used its verdict to STRIKE PEOPLE OUT. The Jobs-list
 * picker meanwhile asked `schedulerAvailability`, which answers an OVERLAP
 * question: does this person's existing work occupy the hours this op occupies.
 * Two oracles, two questions, one control.
 *
 * Measured on Matrix across 109 dated ops x 18 people — 1962 pairs — they
 * disagreed on 244, or 12.4%: 203 struck out in Job Details that the list called
 * free, and 41 the other way. The overlap oracle wins, because it is what the
 * drag, the scheduler and the server's own activeClock rule already use, and
 * because a fifth definition of "free" is how this codebase got four schedulers.
 *
 * THE CAPACITY NUMBER IS STILL WORTH SEEING, so it is kept — as a sentence beside
 * the name, never as a verdict. Treysen's ruling: "a strike that means 'busy
 * week' reads as 'can't do this', and 203 people being wrongly struck is worse
 * than 41 being wrongly offered."
 *
 * Returns a STRING or NULL and nothing else. It has no `ok` field on purpose:
 * there is no shape of this value that a caller could mistake for permission.
 */
export function dayLoadHint(personId, start, end, ctx = {}) {
  if (!start || !end || personId == null) return null;
  const { isWorkDay, isOff, bookedHrs, capacity = 0 } = ctx;
  if (typeof isWorkDay !== "function" || typeof bookedHrs !== "function") return null;
  const off = typeof isOff === "function" ? isOff : () => false;
  let days = 0, loaded = 0;
  // Bounded the same way the calendar walks are, so a reversed or absurd range
  // cannot spin here.
  for (let d = start, g = 0; d <= end && g < 5000; g++) {
    if (isWorkDay(d)) {
      days++;
      if (off(personId, d) || bookedHrs(personId, d) >= capacity) loaded++;
    }
    const t = Date.parse(`${d}T12:00:00Z`);
    if (!Number.isFinite(t)) break;
    d = new Date(t + 86400000).toISOString().slice(0, 10);
  }
  if (days === 0 || loaded === 0) return null;
  return `${loaded} of ${days} days full`;
}
