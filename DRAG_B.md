# DRAG_B — day view drag and resize (root cause 7, chunk B)

Read-only comparison, 2026-09-30, against `master` at 503cb28.
- `J:` = src/TRAQS.jsx.
- The handler is `handleTeamDayBarDrag`, J:16711–16834, called from the bar (J:17156) and its two handles (J:17160, 17166).

---

## 1. #8 verified: the day view can show a date other than today (executed)

`goToScheduleJob` was sliced from TRAQS.jsx and run with the day view showing today, 2026-09-30.

**Jump to a job (executed):**
- Jumping to a job dated Oct 12–14 leaves `tMode` as "day" and sets `tStart = tEnd = 2026-10-13`. The day view then shows Oct 13.
- The jump is reachable from the job detail's jump link (J:25083) and the schedule context menu (J:33470).

**A tab left open past midnight:** `TD` moves on to the new day (root cause 6), but `tStart` stays on yesterday.

**Not reachable:**
- Pan and wheel: `handleTeamPan` and `handleTeamWheel` are only attached to the week/month grid, which renders when `tMode !== "day"` (J:17210–17212).
- The "Day" and "Today" buttons always set `TD`.

**What the handler does wrong on a non-today date:**
- **Past check:** it compares the drop hour with the current hour and ignores the date (J:16767, 16807, 16818).
  - On a future date, a drop at 08:00 is refused when it's 10:00 now.
  - On a past date, any hour after now is accepted.
- **The write:** it's `startHour` alone. The op's own `start` is kept, so the date shown and the date written can differ (see #10).

## 2. The defects, against current code

**#5, the headline: checks the day view makes**

| Check | Day view | Week/month (chunk A) |
|---|---|---|
| Permission (moveJobs) | **none**: `updTask` has no gate, and the handles always show | refused at grab, handles hidden |
| Reassign permission | inside `reassignTask` only | at the drop |
| Locked | **none** | refused, named |
| Someone clocked in | **none** | refused, named |
| Time off on the landing | **none**. Bars aren't drawn on an off day, but a drop onto that row is accepted | refused, named |
| Department on reassign | **none** | **none**, in either view |
| Overlap (Business) | yes, `dayOverlapBlocked`, on the unit at its new hour | yes, every mover |
| Past (Business) | the hour only, with the date ignored (#8); none on right resize | landing date and hour |
| moveLog | **none** | every mover |
| No-overlap backstop | **none** | yes |

The overlap check and the hour-only past check were added in root cause 5. Everything else is missing.

**#6 (confirmed):** `target.id !== fromPersonId` (J:16770, 16811) compares strictly.
- Both sides come from `people`, so the types always match today. The strict compare is only a hazard.
- `reassignTask` itself uses `sameId`.

**#9 (confirmed):**
- The right handle is called with no rendered bounds (J:17166). So `origHour = startHour ?? 8` and `origHpd = hpd`, the *team's total*.
- On release it writes `hpd = productiveClockHours(origHour, cursor) × team` (J:16781).
- **Result:** a multi-day op resized on any one day has its whole estimate replaced by at most one day's hours, and a two-person op's clock span is doubled.

**#10 (confirmed):**
- Both handles get no `rawS`/`rawE` (J:17160, 17166). They anchor on `startHour ?? 8`, not on the rendered position.
- The rendered position can differ:
  - Business packing pushes a bar past earlier ones (J:17072).
  - The reservoir shrink moves the left edge (J:17092).
  - A multi-day op's segment on this day starts at workStart (J:17065).
- **Result:** the handle is grabbed at one hour and computes from another.
- **Also:** the handles are drawn on every day's segment of a multi-day op, including days where the op neither starts nor ends.

**#17 (confirmed):**
- A cross-row record bar's `task` is the real op with overrides (J:16594): the same `id`, `hpd` set to the worked span, and `team` set to the row's person.
- In the day view it's draggable and resizable like any bar.
  - **Resize** writes the worked span into the real op's `hpd`.
  - **Move** writes the real op's `startHour`.
  - **Reassign:** a drop on another row calls `reassignTask` with a person who isn't on the op's team.
- Week/month blocks record bars at the grab (`_dragBlocked`).

## 3. Matrix today (read-only)

**Active work: 109 ops** (not finished, ending today or later).
- **#9:** 67 are multi-day, and 45 of those are larger than one person-day. A day-view right resize on any of these 45 would overwrite the estimate with one day's hours or less.
- **#10:** 1 has no stored start hour. On the rest, the handles still anchor on the stored hour, not on the packed or shrunk rendered one.
- **Department check:** 108 of the 109 active ops carry a `requiredDepartment` (3 distinct departments, set on the op, panel or job). 1 already has an assignee from outside its department. So a department check reaches almost every Matrix drag that changes the person.
- **#6:** team ids and people ids are all strings, so no mismatch is reachable.
- **Time off:** there are no future entries, so the missing check has nothing to hit today.
- **Locked:** 0 active (13 in history).

**#17:** 8 production rows are by someone not on the op's team, 5 of them in the last 30 days. Each draws a record bar in the day view that can be dragged into the real op today.

**Usage:** how often the day view is used isn't recorded anywhere. Its drags write no moveLog, and all 62 "Manual resize" entries come from the week/month resize.

## 4. Proposal: the shared landing and the shared checks, no second set

**A. Move = a mover on the day shown (#8, #5).**
- The day view builds the same grabbed input as week/month:
  - from = the rendered position;
  - drop = the dragged start;
  - the date = the op's own first day, shifted by the hour change, with rollover.
- For a single-day op that is the shown day.
- For a multi-day op grabbed on a later day, the whole op shifts by the hour change. That's what writing `startHour` does today, now stated.
- `planDragMove`, `refuseDragMove` and `applyDragMove` do the rest. The past check therefore tests date plus hour.

**B. Resize = a mover with a new length (#9, #10).**
- The handles are drawn only where the op actually starts (left) and ends (right).
- They anchor on the rendered start and end (`rawS`/`rawE`), passed to the handler.
- The new total is `productiveHoursBetween(rendered start → new end) × team` (or rendered new start → rendered end). That's the op's real total across all its days, not one day's clock hours.
- It goes through the same plan, check and apply: `planDragMove` gains an optional new `hpd`, and the moveLog records from/to hpd with reason "Resized in schedule".

**C. Checks: one list for both views.** `refuseDragMove` gains two kinds, so both views get them:
- **record:** a cross-row bar is a record of work done and can't be moved or resized (#17). It's refused and named, like locked.
- **department:** a reassign onto someone outside the unit's department is refused and named. It uses the existing `unitDepartment` / `personDeptMatch`.

Everything else already exists: live, locked, over estimate, time off, past, and overlap against other work and other movers.

**D. Permissions (#5).**
- `moveJobs` at the grab, as week/month does: without it a click still opens the job, and the handles are hidden.
- `reassign` at the drop.

**E. #6:** `sameId` for the target row.

**F.** The commit goes through the same no-overlap backstop, and writes a moveLog.

**Ruling needed**
- **The department check** is new for week/month too, since it's one shared list.
- It reaches Matrix: 108 of the 109 active ops have a required department. Any drop that hands one of them to someone outside that department (primary or secondary) would be refused in both views.
- It checks only the person the drop **adds**. The 1 op that already has an out-of-department assignee can still be moved along its own row.
- **Recommend yes:** it's the project rule that a unit with a department only takes that department's people. No drag checks it today.

**Tests (red first):** the #8 date case, a multi-day right resize, the handle anchors, a record bar, a department reassign, a locked op, time off, and permission.
- The shared parts run against `dragMove.js`.
- The handler's wiring is checked in `TRAQS.jsx`.
