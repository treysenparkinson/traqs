# Moving a pill never changes its length unless you meant it to

**Status:** Done (browser check is Treysen's, see How you'll test it)
**Source:** [PRD](2026-10-16-pill-resize-PRD.md) (Treysen, 2026-10-16), then D2 in chat the same day
**Where:** `traqs-func` on `master` · **Platforms:** web only. iOS and Android don't drag-resize pills and aren't touched. · **Size:** S
**Last updated:** 2026-10-16 18:40, D2: confirm modal replaces the notice and Undo

## In one breath
Grabbing a pill anywhere but a thin strip at its very end always moves it. Letting go of a
resize no longer saves: a confirm modal shows start, end and hours before and after, with the
new edge editable as a date and time, and only Confirm writes. Esc cancels a resize mid-drag.
The thing most likely to go wrong: short pills lose resize entirely (see D1).

## Done means
- [x] A drag that starts in the body of a pill changes dates only. Hours and `hpd` stay the same **(said)**
- [x] The grip is a fixed thin strip, not a share of the pill's width. Short pills have no grip **(inferred)**
- [x] Every resize, in both the week/month and day views, asks first: op, person, start / end / hours before and after **(said, D2)**
- [x] The changed edge can be edited (date and time) in that modal, and what's confirmed is what gets written **(said, D2)**
- [x] A landing the rules refuse (overlap, time off, a live clock, the past) shows why and can't be confirmed **(inferred)**
- [x] Cancel, Esc or clicking outside writes nothing **(inferred)**
- [x] The pill shows its new hours while you resize **(inferred)**. Already true: the bar's hours label reads the preview, and the bar behind the modal previews the landing as you edit.
- [x] Esc mid-drag: nothing saved, no undo step **(assumed)**

## How it works today (before this work)
- Each week/month pill had a left and a right grip, each `max(3, min(10, width / 3))` px wide. Pills under 12px got none. So a 30px pill was two-thirds grip, and the grip was invisible until the mouse was on it. The overrun "tail" had its own right grip, also a third of its width.
- Pressing a grip runs `handleTeamResize` ([TRAQS.jsx](src/TRAQS.jsx)). That opens a `resizeSession` ([dragMove.js](src/dragMove.js)): mouse moves only preview, and release ran the refusal checks and committed once through `applyDragMove`, which writes new dates **and a new `hpd`** plus a "Resized in schedule" moveLog entry, then saves. No confirm, no notice.
- The day view has its own fixed 12px grips and its own commit in `handleTeamDayBarDrag`. Same silent save.
- Undo is one global stack of whole-schedule snapshots, so undoing an old resize also undoes everything after it.

## The approach
Pull the grip-width rule into a pure `resizeGripPx` that all three week/month grips read. Give `resizeSession` a cancel and wire Esc in both views. Pull the session's landing math into a pure `planResize` so a typed edge lands exactly as a drag to that spot would. On release, both handlers open `ResizeConfirm` with a `replan(day, hour)` built from `planResize` plus the resize's own refusals, a `preview` for the bar, and `apply(plan)`, which is the old commit body (no-overlap backstop, one write, one save).

**Other ways considered:**
- The generic confirm modal (`confirmMove`): it only takes a title and a message, so it can't show before/after rows or edit the edge.
- Typed edits computed separately from the drag: two landings that could disagree. `planResize` is the one the drag already uses.
- (Built first, replaced by D2) a notice with Undo after the save. See Log 18:40.

## Decisions

**Needs you**
- **D1.** Grips are a fixed 6px, and only pills at least 36px wide get them, so the move area is always at least two-thirds of the pill. Narrower pills are move-only. (Treysen, 2026-10-16)
- **D2.** A resize goes to a confirmation modal instead of the notice and Undo. It shows the changed times, and the user can edit them before confirming. Grip sizes stay as D1. (Treysen, 2026-10-16)

**Calls I made** (veto any)
- **C1.** Grips show when hovering anywhere on the pill, not only on the grip. *Why:* you can see where the edge is before pressing.
- **C5.** Day-view grips keep their fixed 12px. Day-view resizes get the confirm and Esc too. *Why:* day-view pills are hour-scaled and wide.
- **C6.** The finding is [SCHEDULE_MAP.md](SCHEDULE_MAP.md) #550, per its rule R1.
- **C7.** Only the dragged edge is editable; the other edge stays where the bar is drawn. *Why:* that's what "the changed time" is, and it keeps one landing rule (`planResize`).
- **C8.** The time editor accepts any time in the work window, not only the week view's whole-day snap. *Why:* editing a time is the point of the modal.
- **C9.** Confirm re-runs the no-overlap backstop against the latest tasks (`latestTasksRef`), not the tasks from when the drag started. *Why:* the modal can stay open while realtime updates land.
- (C2–C4 were about the notice and Undo, retired by D2.)

## Steps
- [x] **1. Grips are a thin fixed strip, and the middle always moves**: [dragMove.js](src/dragMove.js), [TRAQS.jsx](src/TRAQS.jsx), [SCHEDULE_MAP.md](SCHEDULE_MAP.md)
  *Proof:* [resize-grip-test.mjs](scripts/resize-grip-test.mjs) (16, red first); mutant on the cutoff fails 3.
- [x] **2. Esc cancels a resize with nothing written**: [dragMove.js](src/dragMove.js), both handlers in [TRAQS.jsx](src/TRAQS.jsx)
  *Proof:* [resize-test.mjs](scripts/resize-test.mjs) drives both real handlers through Esc: zero writes, undo frames and saves.
- [x] **3–4. (Replaced by step 6.)** A notice after every resize, with an Undo. Built, reviewed, then removed on D2.
- [x] **6. A resize asks first, with the changed edge editable**: [dragMove.js](src/dragMove.js) (`planResize`), [TRAQS.jsx](src/TRAQS.jsx) (`ResizeConfirm`, both handlers)
  *Why:* D2. Nothing is saved until you've seen the new times.
  *Proof:* resize-test (59): release opens one confirm with the right before / edge / after; Cancel writes nothing; an edited end (10:30, another day) is exactly what's written; an edit into someone's work shows the refusal and writes nothing; an edge at or before the start is an error; a day-view move still writes with no confirm. Mutants caught: a day resize that skips the confirm (3 fail), `planResize` without its crossing guard (1 fail). `npm run build` passes.
- [ ] **5. Seen working in the browser**: Treysen, on localhost:8888 (it's running).

## Won't touch / must keep working
- From the PRD: no removing resize. Moving is unchanged: snapping, reassigning by dropping on another row, multi-select and group moves, all with no confirm. No changes to undo in general. (The PRD's "no confirm dialog before a resize" was overruled by D2.)
- Every refusal still runs on resize. One confirmed resize = one save and one undo step (#31 #32). PTO bar resizing (its own path) works as today, with no confirm. Pills with worked hours keep their hidden left grip.
- Technical: no change to stored data shape. iOS and Android untouched.

## Risks and how I'll catch them
| Risk | How I'll catch it |
|---|---|
| A grip change makes pills harder to move | `drag-move-test`, `person-row-drag-test`, `overrun-drag-test` in the build, plus the browser check |
| The modal confirms a landing that differs from what the bar previewed | both read one `replan` result; resize-test checks the preview during the modal |
| A realtime edit lands while the modal is open | Confirm runs the backstop against `latestTasksRef`; refusals are re-checked on every edit |
| Esc inside the modal also hits something underneath | the modal's Esc listener runs in the capture phase and stops the event |

## How you'll test it
1. localhost:8888 as admin, Schedule, week view. Drag a short pill sideways from near its end: it moves and keeps its length, with no modal.
2. On a wide pill, drag the right grip out a day and let go. "Confirm resize" shows Starts / Ends / Hours, before and after, and the bar behind it shows the new length.
3. In the Ends row, change the date or time. The After hours update and the bar follows. Pick a weekend, or a time inside someone else's work: a red message shows and Confirm is greyed out.
4. Click Confirm resize: the pill keeps the new length, and the job's history shows "Resized in schedule".
5. Resize again and press Cancel (or Esc, or click outside): nothing changes.

## Log
- **2026-10-16 16:05 · step 1 · Found:** `npm run build` was red on this Windows checkout before any change here. Four suites only worked on LF/POSIX: `clock-access-test`, `lunch-default-test` (CRLF, #376's trap), `status-meaning-test` and `clock-shift-test` through it (`URL.pathname` gives `C:\C:\`). Test-only fixes, committed on their own. `eol-safety-test` didn't catch the CRLF ones (gap not fixed here).
- **2026-10-16 16:05 · step 1 · Decided:** the overrun tail on a PTO bar keeps its old grip rule too.
- **2026-10-16 16:30 · step 2 · Found:** nothing tested the day view's resize through its real handler; resize-test now drives `handleTeamDayBarDrag`. Esc applies to resizes only.
- **2026-10-16 16:55 · step 3 · Changed:** the notice moved to the bottom center (no "Changes saved" toast fires on drags, so C2's premise was wrong).
- **2026-10-16 17:15 · step 4 · Found:** `department-follow-test` pins `applyDragMove`'s call sites; Undo made it 7.
- **2026-10-16 17:30 · step 5 · Changed:** browser check left to Treysen. Resizing on the dev server saves to the real org.
- **2026-10-16 17:45 · review · Changed:** `/code-review` found Undo skipped the resize's refusals and backstop, and the reverse plan carried the wrong share. Both fixed, along with soft-deleted ops, a toast race, a no-estimate message and an unmemoized check.
- **2026-10-16 17:45 · review · Found, not fixed:** (1) on a pill split across days, the right grip lives on the last segment, and D1's 36px rule applies to that segment alone; (2) a panel-level resize never offered Undo. (2) is moot now that D2 removed Undo. (1) still stands.
- **2026-10-16 18:40 · D2 · Changed:** Treysen, after trying it: "pill resizing should go to a confirmation modal ... instead of the undo popup", and "present the changed time and make it so the user can edit the changed times". The notice, `resizeNotice`, the Undo and `undoResizePlan` are gone (none of it was pushed), along with resize-notice-test. The `applyDragMove` call-site pin is back to 6. New: `planResize` (the session now lands through it too) and `ResizeConfirm`. The #75 render-clock suite flagged `Date.now()` in the modal key, so the key is a counter.

## Outcome
Shipped on local `master`, not pushed: thin fixed grips (6px, 36px+), Esc cancel in both views, and a confirm modal on every resize showing before and after, with the dragged edge editable and checked by the same rules as the drag. Changes from plan: D2 replaced steps 3–4 (notice and Undo) with the confirm (step 6); the browser check is Treysen's. Left out on purpose: the multi-day right-grip gap (Log 17:45), and the `eol-safety-test` gap (Log 16:05).
