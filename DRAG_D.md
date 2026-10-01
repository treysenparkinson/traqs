# DRAG_D — split, the remainder, and what the schedule hides (root cause 7, chunk D)

Read-only comparison, 2026-09-30, against `master` at a1037be. `J:` = src/TRAQS.jsx.

---

## 1. #48 verified (executed)

The server's real `diffTaskEvents` (netlify/functions/_utils/task-events.js) was run on a split: the original op kept, its remainder a new id with the same team.

- **Result:** `teamAdded = [wes, sam]`.
- A unit id that wasn't in the previous save counts as having had an empty team. So every person on a split's new op gets **"You've been assigned to <job>"** for work they already had. The writer is excluded.
- **Affected splits:** the week/month drag split, the Gantt drag split and the manual "Split Job" modal all copy the team onto a new id, so all three fire it.

## 2. The splits (#47)

There are four implementations, and one of them is dead.

**(1) `applyWorkedSplit` / `applyWorkedSplitGuarded` (J:9585–9650) is dead.**
- Its only caller was the week path deleted in chunk A.
- It was the most careful of the four: `splitWorkedOp` with team division, an overlap guard, and an `op_<ts>` id.

**(2) Week/month drag split (J:18378, rebuilt in chunk A).**
- **Id:** `uid()`.
- **The remainder** lands through the shared plan and checks, with the landing's team and length, and gets a moveLog entry.
- **The worked part's end** is walked from the team's *total* worked hours, not one person's share. That makes it too long for a team of more than one: this is what's left of #46.

**(3) Gantt drag split (J:12506).**
- **Id:** `uid()`.
- **Hours:** its own `_calcEnd`, a flat pro-rate of the clock day, with no team division for either part (#46).
- **Checks:** "before today" is the only one. There's no overlap, time-off, lock or live check (#45).
- **moveLog:** `[]`.

**(4) Manual "Split Job" modal, `doSplit` (J:31685).** This is a different operation: it splits the *estimate* at a chosen hour, not by worked hours.
- **Id:** `uid()`, and it titles the new op "… (2)".
- **Placement:** part 2 goes on the next working day after part 1, using `getNextStartHour`.
- **Hours:** part 1's length is `ceil(hours / ppd)` days, with no team division.
- **Checks and log:** no checks, no moveLog.

**Permission (#44):**
- Both drag splits write `locked`, a new op, `loggedHours` and `status`. Those are edits (`editJobs`), but the gesture is gated by `moveJobs` only.
- The manual split is gated by its menu. It's the same kind of write.

## 3. #63 — "Move Just This Job": what it's for and who uses it

**Where it lives:** after chunks A and C, the push dialog ("Scheduling Conflict": *Move All Jobs / Move Just This Job / Cancel*) has exactly one caller left. That's the **Reschedule modal's "Apply Schedule"** (J:34160), opened from the op's context menu. It picks whole start and end dates for one op.

**What "Move Just This Job" is for:** placing this op on the chosen dates *without* moving anyone else's work, knowingly double-booking the person.

**What the code actually does:** the move is committed *before* the dialog opens (`setTasks` returns `moved`). So:
- "Move Just This Job" re-commits the same state.
- **"Cancel" also leaves the overlapping move in place.** Only "Move All Jobs" differs: it applies the pushes.

**Who uses it at Matrix:** nobody, as far as the data shows.
- The modal writes a "Manual reschedule" moveLog entry, and Matrix has **0**.
- Its "Move All" writes "Pushed by schedule conflict" on the pushed ops. There's **1** of those in all history (2026-09-08), from a drag or resize before chunks A and C.

**On Basic:** `previewPush` returns nothing, so the dialog never appears.

## 4. #87 — how much of Matrix is invisible

**The rule** (J:16443, and the same test at panel and job level): an op whose **end is before today** is not drawn on the schedule unless someone is clocked into it. That's whatever its status or work: "HISTORY IS NOT ON THE SCHEDULE".
- It was added so a year of stale backlog stopped displacing live work. 268 of 271 overlaps at the time were history.
- The code comment says the data still reaches Analytics, pay history and the moveLog.

**Matrix now: 290 unfinished units are hidden** (not finished, dated, assigned, not live, end before today). There are 108 active units visible.

| | |
|---|---|
| never touched (no hours logged) | 280 |
| partly worked | 10 |
| remaining estimated hours | 5,477 |
| jobs they belong to | 36 (28 not finished) |
| people they're assigned to | 15 |
| ended ≤ 7 days ago | 10 |
| 8–30 days ago | 14 |
| 31–90 days ago | 25 |
| over 90 days ago | 241 |
| level | 284 ops, 5 panels, 1 job |

So 24 units that went past due in the last month, the ones most likely to still be real work, disappeared from the schedule the day after their end date. Nothing on the schedule says so.

## 5. The rest

- **#16: fixed in chunk B.** The day view's past check now goes through `refuseDragMove`, which tests past only on Business, the same as week/month.
- **#88 (executed):** the row sort returns 0 whenever either bar is PTO, so it isn't a consistent order.
  - `[B(Oct 6), PTO, A(Oct 5)]` sorts to `B, PTO, A`, so A and B stay out of date order.
  - The week/month push and same-day stacking re-sort on their own, so the order only matters for DOM stacking and for the **day view's pack order**, whose tie-break is the row index.
  - Matrix has no future time off, so it's rarely reached today.
- **#89 (confirmed):** `handleTeamPan` ignores clicks in the first 260 px (120 on mobile), but the label column is `min(510, max(250, 158 + pill width))`.
  - With a wide pill, clicks on the label column's right part start a pan.
  - With a 250 px column, the first 10 px of the timeline don't pan.

## 6. Proposal

**S. One split (#47, #46, #45, #44, #48).** One pure split in `dragMove.js`, used by the week/month drag, the Gantt drag and the manual modal. It takes the op, the part that stays, and the part that goes (hours plus landing).
- **Hours:** it writes totals for `hpd` and walks per-person shares for geometry, so both parts are divided by team size.
- **Id:** one scheme, `uid()`. The new op carries `splitFrom: <original id>`.
- **Landing and checks:** the part that goes lands through `planDragMove` and is checked by `refuseDragMove` (overlap, time off, past, locked, live, department), plus the no-overlap backstop. The Gantt and manual splits gain all of these.
- **moveLog:** the part that goes gets an entry, "Split from <original>", with from/to dates, hours and hpd.
- **Split parameters:**
  - worked split: the worked part stays locked where it was;
  - estimate split (manual modal): the chosen hours stay, unlocked, and the rest goes on the next free working time.
- **Permission:** a split needs `editJobs` as well as `moveJobs`. Without it, it's refused and says so. (Ruling 3.)
- **Notifications:** the server's `diffTaskEvents` skips "assigned" for a person on a new unit whose `splitFrom` unit already had that person. That removes #48 for all three splits, and for old clients too, once they send `splitFrom`.
- **Dead code:** `applyWorkedSplit` / `applyWorkedSplitGuarded` are deleted.

**O. #88:** the sort gets a total order: PTO first, then task bars by the sort key, then id.

**P. #89:** the pan reads the grid's actual label width. It's set in a ref where `lW` is computed.

**Rulings needed**
1. **#63, "Move Just This Job":**
   - (a) remove it: Reschedule refuses an overlapping date like every drag and resize does, naming the op; or
   - (b) keep a deliberate double-book, but make Cancel really cancel, and log it.

   Recommend (a): nobody at Matrix has used it, it's the last way to commit an overlap on purpose, and its Cancel is already broken.
2. **#87, hidden past-due work.**
   - (a) An **Overdue tray.** Every unfinished past-due unit is listed per person with its hours, in a tray built like the existing "Place New Tasks" tray (the one newly created tasks are dragged onto the schedule from). It's draggable back onto the schedule through the shared landing, and nothing moves by itself. Each row also shows an "N overdue" badge.
   - (b) Draw recent past-due work (for example, the last 30 days) at the cursor as bars, like cursor-anchored ops, and put older work in the tray.
   - (c) Leave as is.

   Recommend (a): it makes all 290 findable without the 241 older-than-90-days items flooding rows, which is why the rule exists.
3. **#44, split permission:**
   - (a) refuse a split without `editJobs`, with a message; or
   - (b) without `editJobs`, move the whole record instead of splitting.

   Recommend (a): (b) silently does something different from what the same gesture does for an admin.
