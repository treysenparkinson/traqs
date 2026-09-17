# Dynamic Schedule — Handoff / Status

Last updated: 2026-09-17

## What this feature does

Clocking into a job makes a live-updating bar grow in real time on the
Schedule page. It drains a "reservoir" (the op's originally scheduled
block, wherever that is), cascades/pushes other ops on the same
person's row out of the way as needed, and commits or reverts cleanly
when an admin approves/denies a finish request.

Built as **Phases 1-4**, additive-only to the existing Schedule page in
`src/TRAQS.jsx` — no renamed fields, no changed shape of existing UI.

## Where the code lives

- Branch: `feature/dynamic-schedule`
- Worktree: `C:/Users/treysen/traqs-func` on the treysen machine.
  (The paths this doc gave previously — `C:\Users\parki\traqs\.claude\worktrees\schedule-dynamic`
  and a `visual-agent-gantt` sibling — were on a DIFFERENT machine and do
  not exist here. The functionality/visuals split survived the move; see
  "Parallel work — NOT in this branch" below for the current layout.)
- Main files touched:
  - `src/TRAQS.jsx` — all client-side logic (day-mode and week/month-mode
    live bar blocks, reservoir drain mask, cascade/push math, session
    lifecycle handlers)
  - `src/api.js` — added `updateJobSessionAction`
  - `netlify/functions/timeclock.js` — extended `jobClockIn`, added new
    `updateJobSession` action
  - `netlify/functions/people.js` — read only, not modified (already
    passthrough-protects `activeJobClock` via `serverOwnedPersonFields`)

## Session data model

On `person.activeJobClock`:
- `sessionId` — `sess_<personId>_<clockInISO>`
- `reservoirOpId` — the op whose scheduled block is being drained
- `drainCheckpoint` — last persisted point the reservoir has drained to
- `sessionSnapshot` — pre-clock-in state, used to revert on deny
- `frozenAtMs` — set when a finish request is pending; freezes the live
  bar/drain from advancing further until approved/denied

## Key functions (in TRAQS.jsx)

- `findOp(taskList, opId)` — string-coerced op lookup
- `findOpAsBarTask(taskList, opId)` — looks up an op as a renderable bar
  **independent of the clocked-in person's team membership** (needed so
  the live bar is clickable even when admin-testing an unassigned op)
- `opHourRange`, `computeCascadePushes`, `runClockCascade`,
  `buildSessionSnapshot`, `revertSession` — Phase 3/4 core logic
- `applyPushes(taskList, pushes, movedBy, sessionId)` — shared
  application/moveLog-append layer, extended to accept `sessionId` and
  `newStartHour`/`newEndHour`, backward compatible

## Server persistence (why it was needed)

`serverOwnedPersonFields` in `people.js` does a full passthrough of
`activeJobClock`, which silently defeated any client-side `savePeople`
call trying to write session fields. Fixed by extending the **existing
authorized write paths** rather than weakening that protection:
- `jobClockIn` now accepts `sessionId`, `reservoirOpId`,
  `sessionSnapshot` in the request body and persists them (plus a
  server-derived `drainCheckpoint`).
- New `updateJobSession` action validates `personId` + `sessionId`
  against the stored session (409 on mismatch) and merges only
  `drainCheckpoint`/`frozenAtMs`.

This fix landed on `master` as commit `fbdd205` (server is already
deployed) and is also present on `feature/dynamic-schedule` via
`da0c714` (client-side rewire to actually send/use those fields).

## Bugfix history (chronological)

1. **Round 1**: cursor not moving, live bar rendering full-size, reservoir
   not draining, cascade not pushing. Root cause included `.includes()`
   id-type mismatches (missing `String()` coercion).
2. **Round 2**: live bar still rendered as a full-day block instead of a
   growing sliver. Root cause: one teleport formula applied to two
   different cases (covering-now vs. later-today) — fixed by branching
   on whether clock-in hour falls inside the op's current scheduled
   range. Also changed the render tick to a flat 5s interval.
3. **Round 3**: live bar had a hardcoded green gradient/glow. Changed to
   a solid fill matching the real op's color, with a "LIVE" text badge
   as the only differentiator.
4. **Round 4**: reported bug ("live bar renders at reservoir's full
   duration on clock-in") could **not be reproduced** after tracing both
   render blocks — confirmed via live empirical retest. Root cause of
   the report was later found to be a stale build: commit `e868171`
   (see below) existed locally but had never been pushed, so the branch
   the user was testing against was missing fixes.
5. **Clickable live bar** (mid-stream request, commit `e868171`): the
   live bar wasn't clickable/didn't show the real op's color for
   unassigned-team test cases. Fixed with `findOpAsBarTask`, a
   team-independent lookup, used for both color and click/right-click
   targeting.
6. **Round 5 / most recent (commit `4718b7d`)**: live bar was positioned
   at the actual clock-in wall-clock hour, so it rendered floating
   mid-column instead of at the column's left edge (visible in week
   view — reported via screenshot showing the "LIVE" pill sitting
   mid-day-16-column instead of flush left). **User explicitly decided**
   (via clarifying question) that the bar should always render flush to
   the **left edge of today's column**, with width driven by actual
   elapsed session duration (same value that drives the reservoir's
   drain rate), so the two stay in sync. Applied to both the day-mode
   block (~line 15410) and the week/month-mode block (~line 17158).
   **This fix has been pushed but not yet re-tested/confirmed by the
   user.**

## STATE AS OF END OF DAY 2026-09-17 — READ THIS FIRST

Branch tip: **`a78e91d`** on `feature/dynamic-schedule`, working tree clean,
build verified (`check-function-imports` exit 0, `vite build` exit 0).

**Pushed through `25aa00b` only.** `a78e91d` is LOCAL — `origin` is behind by
that one commit. Nothing merged to master. PR #2 is open and does **not**
contain tonight's work.

Tonight's commit, on top of the pushed tip:

| SHA | Commit |
|---|---|
| `a78e91d` | schedule: collapse the live bar into its reservoir when the block is today |

It carries four things: the collapse behaviour (A/C), the continuous left-edge
glide (D), the clock-in teleport guard against inverted blocks, and the DONE
state (planned-position restore on approve + hatched fill + badge).

`tzf8ivwbh` was repaired in S3 the same evening — its block had been destroyed
by the teleport bug (`startHour === endHour === 15.5333`) and was rebuilt from
its own `hpd` to **10:08 → 17:00**. See "Known bugs" for what caused it.

> **The repair is LIVE DATA that no commit records.** It exists only in
> `orgs/MTX2026TRAQS/tasks.json`. S3 versioning is enabled on the bucket, so
> restoring that object from an earlier version — for any reason — silently
> undoes the repair and puts the op back to zero width, where the next clock-in
> will start shoving it right again. `tools/repair-op-hours.mjs <opId> --apply`
> re-applies it; run it without `--apply` first for a dry run.

### Known bugs — OPEN, both diagnosed, neither fixed

1. **Kiosk/iOS job clock-in creates no session.** NOT a regression, and not
   caused by any commit. A job clock-in made from the kiosk path stores an
   `activeJobClock` with only seven keys (`clockIn`, `jobId`, `panelId`,
   `opId`, and the three titles) — no `sessionId`, no `reservoirOpId`, no
   `drainCheckpoint`, no `sessionSnapshot`. The whole dynamic-schedule feature
   then silently does nothing for that worker: no live bar, no drain, no
   cascade.

   The tell is `drainCheckpoint` being **absent** rather than null — the server
   writes it unconditionally whenever `sessionId` arrives
   (`timeclock.js`, `jobClockIn`), so its absence proves no `sessionId` was
   sent. Both web paths (`doClockIn` ~19422 and `handleStartJob` ~20507) DO
   send all three session fields, and the server destructure and whitelist are
   intact, so the call came from neither. `activeClockIn.source` read `"kiosk"`
   on the affected record.

   Distinguishing absent from null is the whole diagnosis — do not collapse the
   two. `tools/diag-session.mjs` currently reports both as "REAL BUG" and needs
   correcting.

   Decision still needed: teach the kiosk/iOS paths to build a session, or
   surface "no session — drain unavailable" instead of failing quietly.

2. **DONE badge renders glued to the bar label** ("DONEDevelopement",
   "DONEPhase 1"). Cause NOT yet established. Both badges carry
   `marginRight: 6` and both parent bars are `display: "flex"` with no `gap`,
   so the source says a 6px gap should exist and the rendered DOM disagrees.
   Needs a DOM inspection before any change — three rounds were lost earlier in
   this feature to theorising about geometry that the DOM settled in one step.

   Suspects, cheapest first:
   - **A stale build in the inspected session.** Promote this above the others:
     `netlify dev` will serve a populated `dist/` instead of proxying to vite
     (`publish = "dist"`, and `npm run dev` exists to `rimraf dist` first). This
     project has already lost time to that twice tonight in a different
     disguise, and it is the one suspect under which the source genuinely CAN
     disagree with the DOM — which is exactly the symptom. Clear `dist`, rebuild
     clean, re-inspect. If the gap appears, the other two are moot.
   - The badge landing inside a nested non-flex wrapper.
   - The label span's `flex: 1` plus the bar's `overflow: hidden` swallowing the
     margin at narrow widths.

   **Ownership note:** styling is the Visuals session's lane, but this element
   is NOT its code — the DONE badge landed after it was stood down, and it has
   never seen the element. `marginRight: 6` on a flex child is not a pattern it
   introduced. Whoever assigns this should expect it to be read cold; "in your
   lane" and "your code" are different claims and only the first is true here.

### Deferred, by explicit decision

- **Move-handler inversion source.** `updTask({ startHour })` at `:15269`
  (day-mode move) and `:11604` (gantt move) write `startHour` WITHOUT
  `endHour`, and `updTask` is a shallow merge that never recomputes it — so
  dragging a bar right past its own stored `endHour` inverts the block. This is
  what corrupted `tzf8ivwbh`. The teleport guard in `a78e91d` stops the
  *propagation*, but the inversion can still be created. Fix needs: a clamp
  against the opposite edge at both call sites (the left/right RESIZE handlers
  already do this correctly), and a decision on whether to add
  "if `endHour < startHour`, recompute from `hpd`" as defensive normalisation
  at the write site.
- **Partial completion.** Rejected as a hack into the finish-approval flow. A
  worker who does 3h of an 8h op clocks out normally; the next session picks up
  the remainder; the finish request happens only when the whole op is done.
  A real partial-completion model needs its own design pass.
- **Fix D on the shared scheduled-bar render** was originally deferred, then
  adopted — it is in `a78e91d`.

## Git / deployment state (updated 2026-09-17, treysen machine)

- **`master` is at `0574621`** ("fix: make approveCompletions and
  approveTimeOff actually mean something"). The doc previously said
  `fbdd205`; master moved 17 commits past that.
- **All three sessions' work is now committed and merged.** `origin/master`
  was merged in at `f689465`; everything sits on that merge. The branch is
  **0 behind** master.

  `feature/dynamic-schedule` (branch tip `54ee0c4`):

  | SHA | Commit |
  |---|---|
  | `f31ccd2` | id: fix numeric/string coercion in dynamic-schedule paths |
  | `cb03271` | schedule: lunch/pause session accounting |
  | `6c8adb3` | schedule: live bar geometry + sliver visibility |
  | `25d5d11` | docs: refresh dynamic-schedule handoff |
  | `54ee0c4` | **Merge** branch 'feature/dynamic-schedule-visuals' |

  `feature/dynamic-schedule-visuals` (branch tip `456da1e`):

  | SHA | Commit |
  |---|---|
  | `456da1e` | schedule: live bar and reservoir share one visual grammar |

  Commit `f31ccd2` is foundational — the reservoirOpId id comparisons it
  fixes gate the whole feature, so the rest is meaningless without it.
- **NOT PUSHED.** Everything above is local only.
  `origin/feature/dynamic-schedule` is still at `fa41485` and does not
  contain any of this. `feature/dynamic-schedule-visuals` has no remote.
- **PR #1 is stale** and deliberately left so:
  https://github.com/treysenparkinson/traqs/pull/1 — it predates the master
  merge and every commit above. A fresh PR gets raised from `54ee0c4`. The
  Netlify deploy preview attached to it
  (https://deploy-preview-1--traqs.netlify.app) is equally stale; do not
  test against it.

### How the merge went

Three sessions worked this feature in parallel worktrees on this machine:

| Worktree | Branch | Owns |
|---|---|---|
| `C:/Users/treysen/traqs-func` | `feature/dynamic-schedule` | geometry, session logic, `timeclock.js` |
| `C:/Users/treysen/traqs-visual` | `feature/dynamic-schedule-visuals` | live bar + drain mask appearance, the three session states |
| `C:/Users/treysen/traqs-verify` | `feature/dynamic-schedule-verify` | integration + QA; serves the merged build on **8888** |

Visuals extracted the style objects into helpers (`liveBarStyle`,
`drainMaskStyle`, `spentBarFill`, `spentMixRatio`) and added running /
**HELD** (`frozenAtMs`) / **LUNCH** (`pausedAt`) states.

`git merge` produced **three** conflicts, not one — the two branches edit
the same physical JSX attributes at every live-bar and mask site, one side
owning `left`/`width` and the other owning the style object. All three
resolved the same way: the visual half from the visuals branch, the
geometry and its rationale comments from this one.

| Site | Resolution |
|---|---|
| day live bar | flush, `-4px` (matches THIS view's bar), `minWidth: 2` |
| week/month live bar | flush, `-1px` (matches THIS view's bar), `minWidth: 2` |
| week/month drain mask | flush, `-1px` |

The visuals branch still carried `+ 2px` on the week/month bar and mask.
That inset was sound while the bar was anchored to the COLUMN; the geometry
revert in `6c8adb3` made it positioned by clock-in TIME, so a fixed nudge
draws it later than the moment it represents — about half an hour of
apparent offset at month zoom. The visuals author identified their side as
the stale one and asked for the flush version to win.

Day mode keeps `-4px` and week/month `-1px` **deliberately**: each mask and
bar matches the scheduled bar it overlays, and those differ between views.
Do not sweep them into agreement.

**The structural cause of these conflicts is unfixed.** Style and geometry
still occupy one JSX `style` attribute at each site, so the next round of
parallel work collides identically. See "What's NOT done yet".

## What's NOT done yet

- **Round 5 (left-anchor) was re-tested and REVERSED.** Left-anchoring made
  the bar encode a magnitude while every bar beside it encodes a position in
  time, so a 2pm clock-in drew a block over the morning. `6c8adb3` anchors the
  bar at the clock-in hour again. Do not re-apply `4718b7d`; if the sliver
  reads wrong, the proposed next step is a faint track behind the bar, not
  another change to where it sits.
- **Nothing has been seen running.** The three commits build clean but no
  session has exercised the feature: not the sliver at birth, the growth, the
  drain, the cascade, the LUNCH or HELD states, dark mode, or 400px width. All
  of it needs a human clocked into a job.
- The PR has not been merged to master, and PR #1 is stale (see above).
- No merge/regression testing beyond the one scenario being walked through
  (clock into a job scheduled for a future day/elsewhere, watch the live bar +
  reservoir + cascade).
- **Structural: style and geometry share one JSX attribute.** At each live-bar
  and mask site the `style={{...}}` attribute carries both the visual helper
  spread and the `left`/`width` values, so any two sessions touching
  appearance and geometry collide on the same physical line. This produced
  the same three conflicts every round. Hoisting geometry into the helpers,
  or splitting it onto separate attributes, would remove the collision class
  entirely. Not done — it is a refactor of live render paths that nothing has
  yet been seen running, so it wants its own round with a human watching.
- **iOS parity:** `AppState.swift:2335` and `:2378` still subtract only
  `totalPausedMs`, not an in-flight `pausedAt`, so op-progress % creeps during
  lunch and self-corrects at lunch end. Cosmetic, nothing saved wrong, needs a
  build.
- **Id drift elsewhere:** only the dynamic-schedule paths were converted to
  `sameId`/`onTeam` in `f31ccd2`. Roughly 50 sites across the rest of the app
  still compare ids raw.

## Suggested next steps (when resuming)

1. Pull `feature/dynamic-schedule` on the other machine, `npm install`
   in the worktree (or wherever it's checked out) to get `node_modules`
   (gitignored), start `netlify dev`.
2. Re-test the left-anchor fix: clock into a job scheduled for a future
   day, confirm the live bar sits flush against the left edge of
   today's column in week/month view and grows rightward, while the
   reservoir shrinks at the same rate. Also re-check day view still
   looks right (sliver at "now", growing).
3. If clean, decide whether to keep testing via the Netlify deploy
   preview (https://deploy-preview-1--traqs.netlify.app) or localhost,
   then merge PR #1 to master.
4. If any issues turn up, follow the same "diagnose first, cite exact
   line numbers, confirm the diagnosis before changing code" pattern
   used throughout this feature.
