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

## Git / deployment state (updated 2026-09-17, treysen machine)

- **`master` is at `0574621`** ("fix: make approveCompletions and
  approveTimeOff actually mean something"). The doc previously said
  `fbdd205`; master moved 17 commits past that.
- **`feature/dynamic-schedule` carries three code commits, ending at
  `6c8adb3`**, plus this doc refresh on top of them as the branch tip. The
  branch is **0 behind** master — `origin/master` was merged in at `f689465`,
  and the three commits sit on that merge:

  | SHA | Commit |
  |---|---|
  | `f31ccd2` | id: fix numeric/string coercion in dynamic-schedule paths |
  | `cb03271` | schedule: lunch/pause session accounting |
  | `6c8adb3` | schedule: live bar geometry + sliver visibility |

  Commit 1 is foundational — the reservoirOpId id comparisons it fixes
  gate the whole feature, so the other two are meaningless without it.
- **NOT PUSHED.** All three are local only. `origin/feature/dynamic-schedule`
  is still at `fa41485` and does not contain any of this.
- **PR #1 is stale** and deliberately left so:
  https://github.com/treysenparkinson/traqs/pull/1 — it predates the master
  merge and all three commits. A fresh PR gets raised once all three agents'
  work is integrated, not before. The Netlify deploy preview attached to it
  (https://deploy-preview-1--traqs.netlify.app) is equally stale; do not
  test against it.

### Parallel work — NOT in this branch

Two other sessions are working the same feature in their own worktrees on
this machine. **Their work is not merged into `feature/dynamic-schedule`
and is not committed on their branches either** — it exists as
working-tree edits, so `git merge` of those branches brings in nothing.

| Worktree | Branch | Owns |
|---|---|---|
| `C:/Users/treysen/traqs-func` | `feature/dynamic-schedule` | geometry, session logic, `timeclock.js` (this doc) |
| `C:/Users/treysen/traqs-visual` | `feature/dynamic-schedule-visuals` | live bar + drain mask appearance, the three session states |
| `C:/Users/treysen/traqs-verify` | `feature/dynamic-schedule-verify` | integration + QA; serves the merged build on **8888** |

Visuals extracted the style objects into helpers (`liveBarStyle`,
`drainMaskStyle`, `spentBarFill`) and added running / **HELD**
(`frozenAtMs`) / **LUNCH** (`pausedAt`) states. The one recurring merge
conflict is the week/month drain mask line, which both sides rewrote;
it resolves as their helper spread with this branch's left/width values.

Verifier integrates by patching working trees rather than merging, for
the reason above. Anyone who follows a "just merge the branches" instruction
literally will build `f689465` and review pre-fix code.

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
- **Known and deliberately unfixed:** the drain mask has no `minWidth` floor,
  so it can vanish for the first minutes of a session the same way the live
  bars did — that reads as "the reservoir isn't draining". The mask is the
  Visuals session's element; flagged to them rather than fixed here.
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
