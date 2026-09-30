# DRAG_A — week/month move (root cause 7, chunk A)

Read-only comparison, 2026-09-30, against `master` at add2932.
- `J:` = src/TRAQS.jsx. SCHEDULE_MAP's line numbers are stale, so current ones are given.
- The move handler is `handleTeamDrag`, J:18003–18841.
- Matrix (MTX2026TRAQS) is Business tier and opens on Month view.

---

## 1. #25 verified (executed)

Executed with the real `rowPushHours`, plus the ghost's push transform and the `beforeNow` line sliced verbatim from TRAQS.jsx (scratchpad `verify25.mjs`).

- **Setup:** an unworked op stored Tue 08:00 for 15 h. It's Wed 10:00, so the schedule paints the op at the cursor: pushed 1 working day and +2 h.
- **Grab:** it's grabbed and dragged one column right.
  - The stored candidate is Wed 08:00.
  - The ghost is painted at **Thu 10:00**.
  - `beforeNow` is **true**.
- **Result:** the ghost shows a future slot, turns red, and the drop is refused with "Can't schedule in the past".
- **The other direction:** a drop far enough right to pass the check lands at the stored candidate, which is 1 day and 2 h earlier than the ghost showed.

**Cause:**
- The ghost adds the grabbed bar's *current* push (`pushBD`, `pushHourDelta`; J:17557, from J:17866).
- The past check, the overlap check and the commit all use the unpushed stored position.
- The push belongs to where the bar sits now. It doesn't travel with the drop.

## 2. #2: what the early return was for

The early return (now J:18684) is the last line of `if ((tMode === "month" || tMode === "week") && bar.task && !isPto)`.

**The code below it (J:18686–18836) can't run:**
- The only grid that calls `handleTeamDrag` renders when `tMode !== "day"` (J:17210).
- The only modes are day, week and month (J:16867).
- PTO and bar-less drags return earlier.

**History:**
- **2026-04-23 (777f62a):** added hour-precise drag as a *month-only* branch that commits and returns. The block below stayed as the **week** view's commit.
  - It was day-precision.
  - It called `previewPush`, and offered the push-confirm dialog.
  - It wrote `moveLog` ("Moved in schedule").
  - It used the §3c `applyWorkedSplitGuarded`, and handled reassigning.
- **2026-09-24 (5b3089f):** "give Week the same hour-precision drag as Month" widened the branch condition to week as well. That left nothing to reach the week path. So the early return wasn't guarding anything; the lower block was orphaned six days ago.

**If the lower block started running as it is,** it would bring back what 5b3089f fixed and more:
- **Hours:** it writes `start`/`end` only. The dragged bar keeps its old `startHour`, so a drop at 14:00 lands at whatever hour it had before.
- **The end:** it's the flat pro-rate `_finalVWD` (#22), not the walk the ghost and the bar render use.
- **Dep-group members:** they move by the *calendar* column delta (`nextBD(addD(origStart, finalDx))`) with `countWorkingDays`. The branch above moves them by working days and hours, so the same drag would land members in different places.
- **Pushes:** they'd come back with the confirm dialog, while the branch above refuses any overlapping drop. There would be two answers to "what does a drop onto occupied time do".
- **Splitting:** it uses a different split rule (`applyWorkedSplitGuarded`) from the branch's inline split.
- **Multi-select reassign:** switched off (`effectiveReassign` requires no members).
- **Saving:** it doesn't call `doSave` itself; it relies on `setTasks` alone.

**Conclusion:** the block can't simply be switched back on. The branch above is the live behaviour. What the block had and the branch lacks is `moveLog` and a check of the result. Those move into the branch, and the dead block is deleted.

**Matrix:** it has never had a drag go through the lower block's pushes or log.
- There are 0 "Moved in schedule" entries in the whole moveLog history.
- Only 1 "Pushed by schedule conflict" entry, on 2026-09-08.
- 62 "Manual resize" entries.

## 3. The other defects, against current code

- **#3 (confirmed):** `_moveNode` / `_memberMove` (J:18649–18663) write dates, hours and team, but no `moveLog`. Matrix has 0 drag log entries ever.
- **#4 (confirmed):**
  - `barLocked` (J:19042, `op.locked`) hides the resize handles.
  - The move `onMouseDown` (J:19282, 19360) checks only `_dragBlocked = overrunning || crossRow` (J:19058).
  - Nothing in the commit checks `locked`, for the grabbed bar or for members.
  - The server's lock rule is in log mode.
- **#18 (confirmed):** for the grabbed bar only, the drop checks:
  - PTO (J:18494);
  - the ghost's overlap (J:18404);
  - past (J:18445);
  - the result's overlap (J:18535).

  Dep-group and multi-select members are moved by `_computeMonthMove` with no check at all: no overlap, PTO, past, lock or live-clock check.
- **#19 (confirmed):** `_moveNode` reassigns the grabbed bar. `_memberMove` never touches `team`, so a multi-drag onto another row moves every member's dates but leaves them on their old people.
- **#20 (confirmed):** building `multiDragMembers` (J:18150) drops a selected op running over its estimate with `found = true; break;`. There's no message: the ghost shows it staying behind, and the user isn't told why.
- **#22 / #23 (confirmed):** three different end dates for one drop:
  - **PTO check:** `newEnd = addBD(newStart, _finalVWD − 1)`, a flat pro-rate of the drop hour plus `_dragBarHpd` (J:18468–18470).
  - **Result overlap check:** a walk of `personShareHours(hpd, dropTeam)` (J:18537).
  - **Commit:** a walk of `hpd / current team` (J:18619).

  They disagree whenever lunch falls inside the span, or the team changes on reassign. For a partly worked bar that doesn't cross an off day, the ghost shows the *remaining* share (`_dragBarHpd`), while the commit and the re-check use the *full* estimate, so the bar that lands is longer than the ghost.

## 4. Matrix today (read-only)

Of 109 active ops (not finished, ending today or later):
- **Locked (#4):** 0. All 13 locked ops are history, and history can still be grabbed.
- **Dependencies (#18):** 0 active ops have deps (8 in all history). `depsMode` is unset on every panel, so a group drag would count as "unlocked".
- **Two-person teams:** 0 active (2 in all).
- **Over estimate (#20):** 1.
- **Stale and unworked, painted at the cursor (#25):** 6. Right now every one of these shows a ghost and a past-check that disagree.
- **Panel- or job-level bars:** 0 active.

So today the reachable defects are:
- #25, on those 6 bars;
- #22/#23, on any drop that crosses lunch;
- #3, on every drag;
- #4, on history.

The member defects (#18, #19, #20) need a multi-select or a dep group, and Matrix has almost none.

## 5. Proposal

**A. One landing.** A pure `dragLanding(...)` gives the landed unit (start, startHour, end, endHour, team) for the grabbed bar and for each member.
- It's computed once per mouse move and reused on release.
- The ghost, PTO, overlap, past, lock and live-clock checks and the commit all read it. That fixes #22, #23 and the ghost-vs-commit length difference.
- Length is the share the bar actually renders with, so what lands is what was shown.

**B. Drag from where the bar is painted (#25).**
- The drag starts from the painted position (layout start and hour) rather than the stored one.
- The ghost stops adding the old push.
- The candidate, the ghost, the past check and the commit are then one position.

**C. Check every mover (#18, #4).** Each landed unit, grabbed bar and members alike, is checked for:
- overlap, using the one rule and excluding the other movers;
- PTO on its landed person;
- past;
- `locked`;
- someone clocked in.

Any failure refuses the whole drop and names the unit. Locked bars can't be grabbed at all (added to `_dragBlocked`).

**D. Log every move (#3).** Each moved unit gets a `moveLog` entry: from/to start, end and hours, plus reason "Moved in schedule". A reassign adds from/to person.

**E. Delete the dead block (#2).**
- It goes.
- The branch's commit runs the result through `enforceNoOverlap` as a backstop. Anything it would have to move refuses the drop, so a drop is never silently rearranged.

**F. Multi-select (#19, #20):** rulings needed, below.

**Rulings needed**
1. **A drop onto occupied time:**
   - (a) refuse (today's live behaviour, and C/E above); or
   - (b) push the other ops with the confirm dialog (the dead block's behaviour).

   Recommend (a): it's what the shop has used since April, and the one overlap rule already refuses.
2. **Multi-select dropped on another row (#19):**
   - (a) members on the grabbed bar's person follow it to the new row, and members on other rows move dates only; or
   - (b) every member goes to the drop row; or
   - (c) refuse a cross-row multi-drag.

   Recommend (a).
3. **A selected op running over its estimate (#20):**
   - (a) refuse the whole drag and name it; or
   - (b) move the rest and say which stayed.

   Recommend (a): one gesture, one outcome.

**Tests (red first):**
- A harness that slices `handleTeamDrag`'s landing and commit.
- Checks: the #25 scenario above, a drop across lunch, a partly worked drop, a locked grab, a multi-drag with one member onto PTO, a multi-drag across rows, and a moveLog on every mover.
