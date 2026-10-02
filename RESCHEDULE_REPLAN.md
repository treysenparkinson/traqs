# Reschedule as re-planning: a design

**Written 2026-10-02. Nothing built.** Five questions settled on paper before anything is
written. Four were asked; the fifth is the one that decides the shape of the other four.

The ruling it serves:

> Reschedule means **REPLANNING a selection**, not shifting dates. Today it's one op at a time, so
> a 30-op job is 30 passes. Select ops and re-plan them together, spread efficiently to finish the
> job fastest. Selection is how he separates ops that should be treated differently. Unselected
> ops stay put.

---

## 5. Same engine, and that is the headline

**It is the same problem, and it should be one implementation.** "Place a set of ops against
people's availability, respecting departments, assignments and precedence" describes both.
Auto-scheduling places ops that have never been placed; re-planning places ops that have. That is
a difference in **which ops are in the set and what counts as an obstacle** — two parameters, not
two algorithms.

The reason this matters more than it sounds: **there are four separate placement implementations
in `TRAQS.jsx` today.**

| Where | What it is |
|---|---|
| `crewForOp` + window search, `:24685`/`:24733` | the job wizard's availability check |
| `eligible`, `:24843` | the wizard's assignment picker |
| `eligible` + `scheduleTeamMode`, `:25570` | the schedule / reschedule step |
| `_autoAssign`, `:31446` | FAST TRAQS import, picks purely by load |

They do not agree. `_autoAssign` ignores departments entirely. The department fallback existed in
two of them and not the others. **The #340 fix had to be applied twice, to two of the four, and
that is the evidence**: the same one-line rule had two homes because the engine has four.

Building re-planning as a fifth is the mistake to avoid. Building it as *the* engine, and
retiring the others onto it, is the version worth doing — and it is why the sizing below is not
small.

---

## 1. Selection granularity

**Change the store to op ids. Keep panel selection as a convenience that expands.**

`rescheduleSelection` holds **panel** ids today and is read in four places (`:25054`, `:25060`,
`:25492`, `:25494`) plus the merge-back at `:25714`. The UI renders one checkbox per panel.

What changes:

- **The store** becomes a set of op ids. A panel checkbox selects or clears all of its ops and
  renders **tri-state** when only some are selected — the standard shape, and it preserves the
  existing one-click-a-panel workflow rather than making a 30-op job thirty clicks.
- **`:25492`** currently rebuilds selected panels with `team: []` and clears their ops. That
  becomes per-op: a selected op is cleared, an unselected op in the same panel is untouched.
- **The merge-back at `:25714`** tests `rescheduleSelection.length < (p.subs||[]).length` — panel
  counts. It becomes "merge per op by id", which is simpler than what is there now.

**One interaction to be deliberate about.** Clearing `team` on a selected op is what makes a
re-plan re-decide *who*, and after #340 that matters: a selected op with its team cleared is
freely assignable, while an unselected op keeps its people because the scheduler now respects
them. **That is the right behaviour and it should be stated in the UI** — selecting an op means
"re-plan this, including who does it". If re-planning dates while keeping people is also wanted,
it is a second checkbox, not a default.

---

## 2. The objective — this one is yours to pick

Trey's words were *"dividing the work out making it the most efficient and quickest way to
complete the whole job."* That sentence contains two objectives and they conflict.

| Objective | Means | What it costs |
|---|---|---|
| **Earliest completion** (makespan) | the last op of the job finishes as early as possible | Loads whoever is most available hardest. One person can end up with four ops in a week while another has none. It will look unfair on the schedule. |
| **Evenest load** | per-person hours as equal as possible across the selection | Finishes **later**, often materially. Equalising means giving work to someone who is free on Thursday when someone else could have done it Tuesday. |
| **Fewest handoffs** | as few distinct people per panel as possible | Finishes later again, and is the most sensitive to one person's absence. Its benefit is real but invisible on a Gantt: less coordination, less context lost between Cut and Wire. |

**Recommendation: makespan primary, fewest handoffs as the tie-break, even load reported but not
optimised.**

The reasoning. "Quickest way to complete the whole job" is makespan, stated explicitly — it is the
thing a customer sees. "Dividing the work out" is the *means* by which that happens, not a second
goal: work is divided because one person cannot finish it fastest alone. Making evenness a hard
objective produces schedules that finish later for a benefit nobody asked for.

Handoffs as a tie-break costs nothing: among placements that finish on the same day, prefer the
one that uses fewer people. That is free and it is almost always the better schedule.

**Even load should still be SHOWN.** The preview should say "Wes 32h, Draven 6h" so an unfair
result is visible and can be overridden by hand — which is exactly what manual assignment is for
now that the scheduler respects it (#340). That is better than encoding fairness as a constraint,
because fairness over one job is the wrong unit anyway; fairness over a week is what actually
matters and the scheduler cannot see it.

**If you disagree, the knob is a single weight** and it should be exposed as a choice in the
preview ("Finish soonest" / "Spread evenly") rather than hard-coded. Say which is the default.

---

## 3. Unselected ops are immovable — and this needs a real change

**Confirmed: immovable, including ops on other jobs and other people's rows.** Nothing outside the
selection moves. That is what makes the feature safe to use on a live schedule.

But the machinery does not express it today. `schedulerAvailability(tasks, ctx, { excludeJobId })`
removes **the whole job being scheduled** from the obstacle set, because today's reschedule
re-plans a whole job. For a selection, that is wrong in both directions:

- the job's **unselected** ops would vanish from the obstacle set and get overlapped;
- ops of **other** jobs are already obstacles, correctly, and stay so.

**The change is `excludeJobId` → `excludeOpIds`**: exclude exactly the ops being re-planned, and
nothing else. That is a smaller change than it sounds — `excludeJobId` is used to filter
`occupyingUnits` at one place — and it makes the function honest about what it does.

Two consequences worth stating:

- A selection can be **infeasible**. If the only Layout person is solid for three weeks and you
  re-plan a Layout op, the answer may be "no earlier than X" or "nobody is free". The preview must
  be able to say that per op rather than silently placing the work badly, which is what the
  current fallback does.
- **An op someone is clocked into must be refused from the selection**, not just skipped. That is
  the one real lock (ruling 3), and the refusal belongs at selection time with a reason, not as a
  silent no-op at placement time.

---

## 4. `schedulerAvailability` stays; the search above it has to change

**Reuse it. It is the right layer and it is correct.** `free(pid, start, end, startH)` and
`book(...)` are a feasibility oracle over stored units plus everything placed so far this run —
`book` is specifically the fix that stopped a run double-booking a person. All of that is needed
unchanged.

**What it is not is a search.** It answers "can this person take this window?". The search — which
op to place next, which candidate to pick, which start date to try — is the caller's loop, and
every one of the four implementations does its own, first-fit, in whatever order the ops happen
to be in.

**Thirty ops is not thirty placements in sequence, and first-fit is where it breaks.** The failure
mode is specific: an early, unconstrained op takes the only person who could have done a later,
constrained one. With Matrix's real shape this is not hypothetical — before the #157 fix, 71 ops
could only go to one person. Even with departments fixed, an op whose team is already set (#340)
has exactly one candidate, and if a greedy pass books that person first on something else, the
constrained op has nowhere to go.

There are also **dependencies**: `deps` appears 117 times and panels carry a `depsMode`. Cut
before Wire before Layout is precedence, so a set placement has to respect order, not just
capacity. That makes this a resource-constrained project scheduling problem, which is NP-hard in
general — which is the reason **not** to reach for a solver, and the reason the standard practical
answer is a priority rule.

**Proposed: keep greedy, fix the order.** Place ops **most-constrained-first**:

1. ops with an existing team (one candidate) before free ones;
2. ops with a stated department before ops open to anyone;
3. ops with dependents before leaves (a late predecessor delays everything behind it);
4. longest duration before shortest;
5. ties by existing start date, so the result is stable and a re-run does not reshuffle.

This is one comparator and it is the difference between a usable answer and a bad one. It is not
optimal and does not need to be — it needs to beat what a person does by hand in thirty passes,
which is a low bar that first-fit currently fails.

**If that proves insufficient, the next step is a repair pass, not a solver**: after the greedy
placement, try swapping pairs of assignments that reduce makespan, stop when nothing improves.
Bounded, explainable, and it reuses the same oracle. Hold it until the greedy version has been
used in anger.

---

## What this costs

| Piece | Days |
|---|---|
| `excludeJobId` → `excludeOpIds`, with the infeasibility result | 1–2 |
| Selection as op ids, tri-state panel checkboxes, per-op merge-back | 2–3 |
| The priority comparator + set placement over the existing oracle | 3–5 |
| Preview: per-op result, per-person load, infeasible reasons | 2–3 |
| **Re-planning on the existing engine** | **8–13** |
| Collapsing the four placement implementations onto it | 5–8 |
| **With the consolidation** | **13–21** |

**The consolidation is the part worth arguing about.** Doing it makes this the engine and retires
three competing ones; skipping it makes a fifth. Given that the #340 fix already had to be written
twice, a fifth implementation will need the sixth fix written five times.

## Open questions

1. **The objective** (§2) — makespan, even load, or a user-visible choice, and which default.
2. **Does a re-plan keep people or re-decide them?** §1 proposes re-decide, with keeping as a
   second checkbox. It is the one behaviour a user could reasonably expect either way.
3. **Consolidate the four schedulers, or build the fifth?** The honest recommendation is
   consolidate, and the honest caveat is that it roughly doubles the estimate.
4. **What should an infeasible op do** — leave it where it is and flag it, or place it at the
   earliest possible date and flag that? The current code silently falls back, which is the one
   option that should not survive.
