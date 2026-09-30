# DRAG_C — ghosts and week/month resize (root cause 7, chunk C)

Read-only comparison, 2026-09-30, against `master` at d9d2386.
- `J:` = src/TRAQS.jsx.
- Ghosts are drawn at J:17547–17649.
- The resize handler is `handleTeamResize`, J:18477–18675.

---

## 1. #31 and #33 verified (executed)

**#31 is real** (scratchpad `verify31.mjs`: the real `reflowJob` / `reflowPhaseOps` / `rollUpJobDates` sliced from TRAQS.jsx, driven one `updTask` per snapped step as the resize does).

- **Setup:** A (Mon, 8 h) and B (Tue, 8 h) for one person, in one phase.
- **The drag:**
  - A's right edge is dragged to Tue 10:00. The mid-drag reflow pushes B to **Wed**.
  - The edge is dragged back to Mon 17:00. B **stays on Wed**, because `reflowPhaseOps` only ever moves an op later.
- **The release:** it reverts A alone (the `reverted` map touches only `bar.task.id`) and writes A's final size.
- **Result:** B ends a day late for no reason, with **no moveLog**. This only happens on Business, the only tier where the reflow checks overlap.

**#33 is real** (scratchpad `verify33.mjs`: the bar's painted-end lines sliced verbatim).

- A week-mode resize writes only `start`/`end`: the day-level `onM` calls `updTask({end})`, and the release writes `{ ...op, start, end, moveLog }`.
- The bar's length comes from `hpd`: `_segsEnd = addBD(_layoutStart, walk.days − 1)`.
- **Executed:** a Mon–Tue 15 h op resized to Thursday stores `end = Thu`, but is still painted ending **Tue**. The bar snaps back, and the stored end no longer matches the bar.
- **Left edge:** a week-mode left resize moves the start and keeps the length, so it acts as a move.

## 2. How many writes one resize drag produces

**The step:**
- **Month:** each half-hour boundary crossed. That's 18 steps per day at Matrix's 9-hour day.
- **Week:** each day column crossed.
- A move that doesn't cross a boundary does nothing.

**Per step:**
- 1 `updTask`, which does all of this:
  - 1 `setTasks`;
  - **1 full deep-clone undo snapshot** of every job;
  - 1 `reflowJob` of the job (dates changed). On Business this can push siblings (#31).

**At release:**
- +1 `setTasks` and +1 snapshot for the revert-and-write.
- +1 more of each if the push dialog is answered.

**Server writes:**
- The task save is debounced by one second from the last change.
- A continuous drag produces 1 save after the release.
- **Each pause of a second or more mid-drag adds a save of the intermediate state.** That state includes any sibling the mid-drag reflow pushed.

**Example:** a month resize dragged across one day and back is about 36 steps. That's about 37 undo snapshots, and the undo stack holds only 50, so one gesture evicts most of the undo history. Undoing it takes 37 presses.

Executed: 5 steps gave 6 `setTasks` calls and 6 snapshots.

## 3. The other defects, against current code

**Ghosts**

- **#26 (confirmed):** the main ghost is `barHpd / productiveHoursPerDay` columns wide, a flat pro-rate (J:17572). The bar is `walk.columns` wide (J:17894), and it counts the lunch and breaks the span actually crosses. The ghost is short wherever a dead window falls inside the span.
- **#27 (confirmed):** in group and multi ghosts, the last segment takes the whole remaining budget with no cap (J:17616, 17643). The main ghost already caps it (J:17589–17590).
- **#28: gone in chunk A.** `pushBD` no longer exists. Member ghosts are drawn at their planned landings.
- **#29 (confirmed):** the ghosts use `borderRadius: 26` (J:17595, 17618, 17645). The bar uses `Math.min(T.radiusXs, px / 2)`.
- **#30: gone in chunk A.** `_visualWD` was deleted with the dead path.

**Resize**

- **#34: fixed as written by the hpd pass.** The write is `_computeHpd(…) × _resizeTeamSize`, which is the team's total.
  - **What's left:** `_computeHpd` converts a clock span to productive hours by flat ratio, so it ignores where lunch falls.
  - The day view now uses `resizeShare` (productive hours across every day), and week/month doesn't.
- **#35:** there's no past check.
- **#36:** there's no time-off check.
- **#37:** there's no live-clock check on release (`_someoneOnIt` is checked only at the grab).
- **#38: fixed by root cause 6.** `nextBD` with no options now uses the org's calendar, holidays included.
- **#39 (confirmed):** the revert and the final write look for the op inside the panel named by `bar.task.pid`.
  - For a panel bar (pid is the job) or a job bar (pid is null), neither finds anything.
  - So the resize writes only the mid-drag `updTask` states: no lock check, no moveLog, no push check.
- **#40: partly fixed.** `previewPush` now checks every assignee (root cause 5). But `personId = team[0]; if (!personId) return` means an unassigned op's release does nothing; the mid-drag writes stand, with no log.
- **#41: fixed by root cause 5.** `previewPush` returns nothing on Basic.
- **Push dialog:** a resize that grows into someone's work still offers the push-confirm dialog. The drag drop refuses since chunk A (ruling 1).

## 4. Matrix today (read-only)

**Ghost width (#26):**
- On 60 of 109 active ops, the ghost is more than 15 minutes of width different from the bar it previews.
- The mean difference is 0.31 h and the largest is 0.9 h.
- Every group and multi ghost has the same error, since they use the same flat formula.

**Resize history:**
- 62 "Manual resize" entries across 21 ops.
- **13 op-days have more than one resize.** That's the same op resized again the same day, consistent with a resize that snapped back (#33) or needed another go.

**Can't tell from the data:**
- Siblings displaced mid-drag (#31) leave no trace, since the reflow writes no log.
- There's no record of how many intermediate saves reached the server.

**Panel- and job-level bars (#39):** 0 active.

## 5. Proposal: the same shared calculation

**G. One bar geometry for the bar and every ghost (#26, #27, #29).**
- A pure `barSegmentsPct(...)` does the bar's existing layout rules:
  - the `walk.columns` budget;
  - the hour offset only on the day the bar starts;
  - every piece capped at its own columns;
  - the in-view last piece sized by its end hour.
- The bar render and all three ghosts call it. The ghosts differ from the bar only in styling (dashed, faded, red when refused).
- The ghost radius becomes the bar's.

**R1. Nothing is written during a resize (#31, #32).**
- The mouse move updates a preview that the bar reads while it's being resized. There's no `updTask`, no reflow and no snapshot.
- The release writes once:
  - 1 `setTasks`;
  - 1 undo snapshot (so one undo reverts it);
  - 1 save, at the end;
  - nothing left over from mid-drag.

**R2. Resize changes the hours, in both views (#33).** A resize sets the new length, `hpd`, and the landing's end follows from it.
- Month keeps half-hour precision.
- Week is day precision:
  - the right edge ends at workEnd of the day it's dropped on;
  - the left edge starts at workStart.

**R3. The new estimate uses the shared `resizeShare` × team** (#34's residual), the same as the day view.

**R4. The release goes through `planDragMove` / `refuseDragMove` / `applyDragMove` and the no-overlap backstop.**
- That covers past, time off, live, locked and every assignee (#35, #36, #37, #40).
- It works at any level: op, panel, general job (#39).
- It writes a moveLog "Resized in schedule", the day view's wording, with from/to hpd.

**Rulings needed**
1. **A resize that grows into someone's work:**
   - (a) refuse and name it (ruling 1, applied to resize); or
   - (b) keep the push dialog.

   Recommend (a): same principle, same checks.
2. **Week-view resize granularity:** whole days, as in R2, with `hpd` recomputed. The alternative is half-hour precision in week view too.
   Recommend whole days: the week view's columns are too narrow to aim a half hour.
3. **moveLog wording:** the 62 existing entries say "Manual resize", and the day view (chunk B) writes "Resized in schedule".
   Recommend one wording, "Resized in schedule", for new entries. Old entries are left alone.

**Tests (red first):**
- `barSegmentsPct` against the bar's current output (lunch inside, holiday gap, clipped window, last-piece cap), with the ghosts reading the same function.
- A resize harness that counts `setTasks` and snapshots per drag (1), and shows no sibling displaced.
- A week resize that changes the painted length.
- A panel-bar resize, and refusals for past, time off, live, locked, and overlap.
