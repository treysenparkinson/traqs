# Reschedule as re-planning: a design

**Written 2026-10-02. Nothing built.** Five questions settled on paper before anything is
written. Four were asked; the fifth is the one that decides the shape of the other four.

The ruling it serves:

> Reschedule means **REPLANNING a selection**, not shifting dates. Today it's one op at a time, so
> a 30-op job is 30 passes. Select ops and re-plan them together, spread efficiently to finish the
> job fastest. Selection is how he separates ops that should be treated differently. Unselected
> ops stay put.

---

## Ruled 2026-10-02

| # | Question | Ruling |
|---|---|---|
| 1 | Objective | **Even load**, with "Finish soonest" as a visible alternative. Overrides the recommendation below. |
| 2 | Does a re-plan re-decide people? | **Yes**, said in the UI. Date-only is a second checkbox. |
| 3 | Consolidate or build a fifth? | **Consolidate.** 13–21 days accepted. |
| 4 | Infeasible op | **Leave it and flag, per op.** Never place it anyway. |
| 5 | NEW — multi-department ops | Scoped in §6 below. Not built. |

**On the objective, the reasoning and the trade are both recorded, because the trade is real and
was measured before the choice was made.** The ruling is even load: *an evenly loaded shop
completes more jobs overall, even if any single job finishes later.* What that costs, stated
plainly so it is not discovered later: **equalising means giving Thursday work to someone when
somebody else could have done it Tuesday.** A single job will finish later than it needs to, and
on a Gantt that looks like slack. The compensation is invisible on that same Gantt — it is the
next job starting sooner because nobody is saturated.

Not hard-coded. Even load is the DEFAULT and "Finish soonest" is offered beside it, because the
objective is a judgement about the shop rather than a property of the schedule.

**On infeasibility:** never place it anyway at the earliest date. That is the silent fallback
wearing a better face, and the silent fallback is exactly what produced the department funnel —
`matched.length > 0 ? matched : allCrew` looked like a kindness and quietly scheduled 71 ops
onto one person.

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

## 2. The objective — RULED: even load. The analysis is kept below

Trey's words were *"dividing the work out making it the most efficient and quickest way to
complete the whole job."* That sentence contains two objectives and they conflict.

| Objective | Means | What it costs |
|---|---|---|
| **Earliest completion** (makespan) | the last op of the job finishes as early as possible | Loads whoever is most available hardest. One person can end up with four ops in a week while another has none. It will look unfair on the schedule. |
| **Evenest load** | per-person hours as equal as possible across the selection | Finishes **later**, often materially. Equalising means giving work to someone who is free on Thursday when someone else could have done it Tuesday. |
| **Fewest handoffs** | as few distinct people per panel as possible | Finishes later again, and is the most sensitive to one person's absence. Its benefit is real but invisible on a Gantt: less coordination, less context lost between Cut and Wire. |

**This section's recommendation was makespan primary, and it was overruled.** It is kept
unedited, because the reason for the ruling only makes sense beside the case against it — and
because the trade it describes is what the build has to live with either way.

**RULED: even load, as the default, with "Finish soonest" offered beside it.** The argument that
carried it is one this analysis did not have: an evenly loaded SHOP completes more jobs overall,
even when any single job finishes later. That is a claim about the business, not about the
schedule, and it is not visible in anything measured here.

The original recommendation follows.

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

**The knob is a single weight** and it is exposed as a choice in the preview rather than
hard-coded — "Spread evenly" (default) / "Finish soonest". That part of the recommendation stood.

One thing the ruling does NOT change: even load still has to be **shown** per person in the
preview, because an even-load objective can still produce a result an admin wants to override by
hand, and manual assignment is now respected (#340).

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

## 6. Multi-department ops — scoped, not built

**The ruling:** an op should name a FLAT SET of departments, not one. "Either, pick whoever's
free." Not a preference order.

This is the real fix for what the title heuristic was faking. An op that Wire *or* Cut could do is
a true statement about the work, and today you can say one or neither — so the only way to express
"either" was to say nothing, which is also how you say "anyone". Two different facts, one
encoding.

### What the live data says

| | |
|---|---|
| Ops with `requiredDepartment` set on the op itself | **141** |
| …where **title === department** (indistinguishable from a heuristic stamp) | **87 (62%)** |
| …where the title differs, so it can only have been set deliberately | **54** |
| Panels with one set | 3 |
| Jobs with one set | 0 |
| **People holding a SECONDARY department** | **0 of 18** |

Two findings matter more than the rest.

**The heuristic did not only read — it WROTE.** `:24672` and `:25508` persisted the inferred
department into the saved tree, so 87 of the 141 stated departments may never have been chosen by
anybody. Under ruling 1 a stated department is binding, which means those 87 ops stay funnelled
by a constraint that may be an artefact. **They should not be auto-cleared** — clearing is
irreversible guessing at intent, and some of the 87 are certainly deliberate (an admin setting
Wire on an op titled Wire is redundant, not wrong). **Recommended: no migration. Surface them
instead** — a filter for "ops whose department equals their title", which multi-department makes
actionable: widen to "Wire or Cut" rather than clear to nothing.

**Nobody holds a secondary department.** `personDeptMatch`'s entire `"secondary"` branch, and
the six sort comparators that rank primary above secondary, are unexercised at Matrix. That is
worth knowing before adding a second multi-valued concept beside an unused one: the person side
already has a two-slot preference order nobody uses, and the op side is being asked for a flat
set. Do not let them become three concepts.

The widening is real where it is needed: Wire has 5 holders, Cut 1, Layout 1. An op that could
say "Wire or Cut" goes from 1 candidate to 6.

### What changes

| Surface | Change |
|---|---|
| Schema | `requiredDepartment: string` → `requiredDepartments: string[]`. Read as `requiredDepartments ?? [requiredDepartment].filter(Boolean)` so old rows work untouched. |
| `unitDepartment` (scheduleRules) | returns an array; same own → panel → job precedence. Shared with the server. |
| `personDeptMatch(p, reqDept)` | takes a set. "primary" if the person's primary is in it, "secondary" if their secondary is, false otherwise. **Return contract unchanged**, so the six primary/secondary sort comparators keep working untouched. |
| Call sites | ~12 in `TRAQS.jsx`, plus `dragMove.requiredDepartmentOf` and the server's department rule (`scheduleRules.js:231`). |
| UI | the single-select `CustomDrop` (`:33354`) and the two role-pick lists (`:25105`, `:25156`) become multi-select chips. **This is the bulk of the work.** |
| FAST TRAQS import | writes the field at `:24672`/`:25508`; now writes a set (usually empty, since the heuristic is gone). |

### The native constraint, which decides the write format

`JobsScheduler.swift` reads `extras.text("requiredDepartment")` at job, panel and op level. An
array written to that key decodes as nil, so **iOS would silently treat every op as having no
department** — which widens rather than breaks, and is the safe direction under ruling 1, but it
means web and iOS would be scheduling to different rules without anything failing.

**So dual-write: keep `requiredDepartment` populated with the first element** alongside the new
array. Costs almost nothing, keeps iOS correct-ish until it is updated on the Mac, and makes the
rollout reversible. iOS also still carries its OWN copy of the title heuristic
(`JobsScheduler.swift:90`), so that parity gap exists already and is now wider — logged, not
touched, no native work done.

### Where it lands: INSIDE the consolidation, as its first step

Your reasoning decides it and it is right — it is the field the engine reads, so doing it after
means touching the engine twice. But "before" is worse than "after":

- **Before**: change four implementations now, then collapse them. Four times the work, thrown away.
- **After**: write one engine against a single-value field, then change it. Twice.
- **First step of the consolidation**: define the shape, write the one engine against it, retire
  the four onto it. **Once.**

### Size

**4–6 days**, inside the 13–21 for the consolidation rather than on top of it — the call-site
changes are largely the same edits the consolidation is already making, so the marginal cost is
the schema, the matcher and the UI. The multi-select UI is roughly half of it.

## Open questions

1. **Those 87 ops.** No migration is recommended; confirm, or say to clear them.
2. **The person side.** `secondaryDepartment` exists, is unused by all 18 people, and is a
   two-slot preference order rather than a set. Leave it, or make it a set too so there is one
   concept instead of two? Leaving it is cheaper and nothing currently depends on it.
3. **Does an empty set still mean "anyone"?** It must, to stay consistent with ruling 1 — but it
   should be stated, because "no departments listed" and "all departments listed" would otherwise
   be two ways to write the same thing.
