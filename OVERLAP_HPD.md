# OVERLAP_HPD — one overlap rule and one meaning of hpd (root cause 5)

Read-only comparison, 2026-09-30, against `master` at 78162b1.
- `J:` = src/TRAQS.jsx, `S:` = src/statsMath.js; iOS paths are under `TRAQS Scheduling/TRAQS Scheduling/`.
- "executed" means the real code was run: statsMath imports, or functions sliced from TRAQS.jsx and run with `new Function`. "read" means inferred from the source.

Fixture org, unless stated:
- 08:00–17:00 with a 60-minute lunch at 12:00, so 8 productive hours a day, Mon–Fri.
- Today is Wed 2026-09-30.
- Y is the op already on a person's row; X is the op being placed.

---

## Part 1 — Overlap

There are six rules, not five. Only one live path both blocks a move and works in hours: the drag ghost.

### (a) Drag ghost `_opVisual` — J:18591–18659

**Where:** a week/month drag on the Schedule, Business tier only. Live.

**What it computes:** a (date, hour) comparison between the ghost and every op on the target row.
- The ghost's end is walked from its hpd.
- Each other op's end comes from `_opVisual`: hpd ÷ team size, plus overrun, walked through the work windows.

**How it treats the edge cases:**
- Adjacency: allowed.
- Ids: normalised.
- Weekends: date-range, so a Fri→Mon op hits a Saturday op.
- Skips Finished ops only. Past/history, locked and tombstoned ops still block.
- Uses stored positions, not the repacked paint.
- Checks the grabbed bar only; group-drag members aren't checked.

**On overlap:** the ghost goes red and the drop is refused.

The week/month drop commit (J:18754–18904) then writes dates with no other check.

### (b) `previewPush` — J:9672

**Where:**
- Live at J:19236, resize from a bar's edge grip, **on every tier including Basic**.
- Dead at J:18927/18932 (unreachable drop branch) and J:34925 (nothing opens that modal).

**What it computes:** whole days inclusive, ignoring hours.
- Ids are compared strictly.
- Only `team[0]` is checked.
- Skips Finished ops; counts past and tombstoned ones.
- A locked op anywhere in the cascade refuses the whole move.

**On overlap:** it cascades the overlapped ops to the next business day, asks for confirmation, then calls `applyPushes`.

### (c) `enforceNoOverlap` → `dayShiftToClear` / `opInterval` — J:9826, S:1140, S:998

**Where:** live only after a resize that pushed something, and only on the pushed ops (`applyPushes`). The other call sites are dead.

**What it computes:** half-open millisecond intervals.
- **A multi-day op's interval covers the weekend in its span.** Executed: Fri→Mon overlaps a Saturday 08–12 op.
- **A single-day op with no endHour has NaN width, so it overlaps nothing.** It reads `durationH`, which no code anywhere writes. Executed.
- Lunch is ignored.
- Participation is dated, unfinished, end ≥ today. Locked and tombstoned ops are counted.
- Adjacency: allowed. Ids: normalised. Every team member is checked.

**On overlap:** it shifts the touched op by whole business days. It gives up after 260 days, with only a `console.warn`.

**#53, executed:** two touched ops are both computed against the pre-shift list, both land on the same Tuesday, and `rowOverlaps` then reports them overlapping.

### (d) `checkOverlapsPure` — J:9556

**Where:**
- Live in `saveTask` (J:11229), on every tier.
- It blanks the job being edited first, so **conflicts inside the edited job are never checked**.
- The Gantt `handleDrag` caller and `checkOverlaps` are dead.

**What it computes:** a **daily capacity** sum, not an overlap.
- Every calendar day in the span is included, **weekends too**.
- Load per day = hpd ÷ span days ÷ team.
- A day is flagged when load > `person.cap || productiveHoursPerDay`.
- Ids are strict: a `"7"` vs `7` mismatch silently skips the check.
- Panels with no ops count as bookings.
- Also reports time-off clashes.

**On overlap:** refuses the save.

### (e) `reflowPhaseOps` — J:3469, via `reflowJob` J:3520

**Where:** `updTask`, on every change to start, end or team. That includes each mousemove of a resize.

**What it computes:** within one phase only, "the same person is never on the same day".
- Whole days; hours ignored.
- **Moves locked ops.**
- Filters tombstones.
- `diffBD` is called without the org's work days.

**On overlap:** silently moves the later op to the next business day.

### (f) Others, read only

- Auto-scheduler free checks, J:26701, J:26833, J:27511: date-inclusive, strict ids.
- iOS:
  - `JobsScheduler.isFree` has no app caller.
  - `AvailabilityCheckView.isFree` checks a single day.
  - `SchedulePacker` is a render packer.
  - **`rescheduleUnit` writes dates with no overlap check.**
- Display-only repacks: `rowPushHours` (Business, J:17601) and `basicOverlapLanes` (Basic).
- Day-view drag (`handleTeamDayBarDrag`, J:16914) has **no overlap check**.
- Server: none. `scheduleRules.js` deliberately left overlap out.

### Verdicts on one fixture set, executed

| Fixture | (a) ghost | (b) resize | (c) guard | (d) save | (e) reflow |
|---|---|---|---|---|---|
| Adjacent 08–10 / 10–12 | ok | push | ok | ok | move |
| Overlap 08–11 / 10–12 | red | push | shift | ok | move |
| Same day, gap 08–10 / 13–15 | ok | push | ok | ok | move |
| Same day, no hours, 6 h + 6 h | red | push | ok (NaN) | conflict | move |
| Fri→Mon vs Saturday 08–12 | red | push | shift | conflict | move |
| Y past and unfinished | red | push | ok | ok | move |
| Ids 7 vs "7" | red | ok | shift | ok (skipped) | move |
| Y locked | red | blocked | shift X | ok | move |
| Y tombstoned | red | push | shift | ok | ignore |

A single fixture gets five different answers.

### What the product should do

A person can't be doing two things at once. That makes overlap an **interval rule on the time the person actually works**:

- **Time model:** half-open wall-clock intervals `[start, end)`, clipped to that person's working windows on working days.
  - A Fri→Mon op doesn't occupy the weekend.
  - An op an admin puts on Saturday does occupy Saturday.
  - A multi-day op runs from startHour on its first day to endHour on its last, with full working windows in between.
- **No end hour:** its extent is walked from startHour (or workStart) through productive time for hpd ÷ team size. This is what the bar already draws; zero-width is wrong.
- **Adjacency:** an op ending at 12:00 and one starting at 12:00 don't overlap.
- **Participation:**
  - Counted: unfinished, dated, live ops (no `deletedAt` on the op or any ancestor) whose extent reaches today. **Locked ops count**: a lock pins an op, it doesn't free its time.
  - Not counted: Finished ops and history.
- **Ids:** normalised. Every team member's row is checked.
- **Capacity is a different rule, and it should stay.** Over-booking a day can happen with no interval overlap, for example several long ops each at a low daily rate. It becomes its own check:
  - the sum of each op's per-person share per working day (hpd ÷ team ÷ working days) against `cap`;
  - weekends excluded unless an op sits on them;
  - ids normalised;
  - the edited job no longer blanked.

**Closest implementation today:** statsMath's `opInterval` + `intervalsOverlap` + `rowOverlaps`. They're pure, half-open and already tested. They need:
1. The walked extent for ops with no end hour, replacing `durationH`.
2. Per-working-day segments instead of one continuous span.
3. hpd ÷ team via the shared bar-length maths.
4. The participation filter, including tombstones.
5. Normalised ids.
6. Sequential shifts in `enforceNoOverlap` (fixes #53).

The ghost has the right semantics inline; it should call the shared function.

### What each live site does differently with the one rule

- **Ghost:**
  - Stops going red for the Fri→Mon vs Saturday case, hidden past ops and tombstones.
  - No-hours ops collide only when their walked extents meet.
- **Resize:**
  - Stops pushing same-day neighbours that don't touch.
  - Matches `"7"` against `7`.
  - Checks the whole team.
- **Push guard:**
  - Catches no-hours ops it misses today.
  - Stops shifting across weekends.
  - Fixes #53.
- **Edit Job save:**
  - Refuses a real interval overlap, which it misses today.
  - Capacity becomes a separate check that ignores unworked weekends.
- **Reflow:**
  - Stops bumping same-day ops that don't touch.
  - Stops moving locked ops.
- **Week/month drop and day-view drag:** get the same check. Today, a week/month drop is never re-checked after the ghost, and a day-view drag has no check at all.

### Can overlap move server-side?

**Yes, once it's one rule.**
- The server already reads tasks, people and settings for `scheduleRuleViolations`: workDays, holidays, workStart, workEnd, lunch, breaks and timezone.
- The rule fits there: check only the ops a write changes, against the stored tree.
- Legacy overlaps never block unrelated saves.

Constraints:
- The server should use stored hpd and positions only. Live overrun comes from sessions, and render repacking is display-only; both stay client-side warnings.
- Overlap depends on hpd ÷ team, so **hpd has to mean one thing first**.
- Basic tier's "double-booking is a normal shift" (commit 5bc3fa6) isn't a blocker. The server can read the tier and skip it. But the policy has to be decided once: today resize and Edit Job save apply it on Basic, and the ghost doesn't.
- It would ship behind `SCHEDULE_RULES_MODE` in log first, like the other rules.
- iOS `rescheduleUnit` has no pre-check, so iOS would only learn at save time. #294 now shows the server's message.

---

## Part 2 — hpd and cap

### What stored `op.hpd` means today

Mostly **the op's total estimated productive hours for the whole team**.

Read that way by:
- progress and overrun: `deriveWorkedState`, iOS `opHoursPair`;
- bar length, which divides by team size (`barLengthHours` S:816, confirmed);
- split: `splitWorkedOp`, "the TEAM's total, like hpd";
- booked capacity: `perDayShare`/`bookedIntervals`, "a total despite the name";
- job-grid totals;
- the Mac New Job sheet.

Written that way by:
- FAST TRAQS commit;
- the New Job wizard;
- the split paths;
- the Mac sheet.

Exceptions:
- **Read as a per-day rate:**
  - the AI schema and prompt ("hpd is ALWAYS a daily rate");
  - the iOS gantt: hpd × span, not divided by team;
  - the client profile total: × calendar days;
  - Analytics Team Workload;
  - the Overloaded filter;
  - "Hrs/Day" labels, including the Edit Job input, titled "Hours per day".
- **Read as clock hours:**
  - web day view: startHour + hpd, or floor(hpd ÷ 7.5) full days;
  - Basic lanes;
  - iOS JobShifts.
- **Written as the wrong thing:**
  - gantt resize writes one person's hours, so a 2-person bar snaps back to half;
  - day-view resizes write clock hours;
  - `finishedOpFields` can write a clock span;
  - iOS SimpleJob writes a flat 7.5 per day for multi-day shifts;
  - iOS decode turns an absent hpd into 7.5 and saves it back;
  - the Edit form stores whatever the user thought "per day" meant.

### One op through every consumer

hpd 16, 2 people, Mon–Wed, org 07:00–15:00 with 30 min lunch.
- Productive day: 7.5 h. Org hpd: 8.

| Consumer | Result | How found |
|---|---|---|
| Web gantt bar | 8 h per person → ends Tue 07:30 (~1 day) | executed |
| Web progress, 4 h logged | 25%, 12 h remaining | executed |
| Web day view | Mon 7–15, Tue 7–15, Wed 7–8 (~2.1 days) | replicated formula |
| Same op, single day, day view | 7:00–21:00 (16 clock hours) | replicated formula |
| Booked capacity | 2.67 h per person per day | replicated formula |
| Analytics Team Workload | 16 h vs cap 8 → 100%, red | replicated formula |
| Duration: `opDurBD` | 2 days | replicated formula |
| Duration: tray drop | 3 days | replicated formula |
| Gantt resize to Mon–Wed | writes hpd 22.5, then redraws ~1.5 days | executed + formula |
| iOS gantt | 48 h per person over ~6.4 days | ported to JS and run |

One op is drawn as about 1, 2.1 or 6.4 days, and scheduled as 2 or 3.

### Fallbacks (#211, #216)

Unestimated hpd (absent or 0):
- `?? 7.5`, which lets 0 through;
- `|| orgSettings.hpd`, giving 8;
- `|| productiveHoursPerDay`, giving 7.25 with default breaks;
- `|| 8`;
- `|| 0`.

So one unestimated op shows 0% progress on one path and uses 8 on another. iOS invents 7.5 and saves it back.

Cap:
- `|| 8`, `|| productiveHoursPerDay`, `|| orgSettings.hpd || 8`.
- Some sites have no fallback, which gives 0% or NaN.
- All of them fire on 0 as well as absent, and clearing the field stores 0.

### #212 — org hpd

- Every load sets `hpd = workEnd − workStart`, a gross figure with no lunch or breaks.
- The next org-settings save of any kind writes it back.
- **There is no input for org hpd**, so a different value can never persist.
- iOS reads the same field and labels it "productive".
- The AI prompt tells the model a day is 8 h, and `opDurBD` divides by 8. Meanwhile bars walk at 7.25–7.5.

### What each quantity should mean

- **`op.hpd` = the op's total estimated productive hours, for the whole team.** That's the product's reason, not the majority:
  - It's the number work is logged against. Progress, overrun, split and finish all compare worked team hours to it.
  - A per-day rate can't express a half-hour task, a 40-hour op or an overrun without also knowing the span.
  - Multiplying a rate by span is what caused the 750 h booking bug that `bookedIntervals` fixed.
  - The storage key stays; the UI says "Est. hours".
- **Day length for scheduling = `productiveHoursPerDay`:** the work window minus the breaks and lunch actually reached (`buildDayWindows`). Bar walks, days needed and AI duration maths all use it.
- **Org `hpd`:** stop deriving and saving it, and read `productiveHoursPerDay` wherever it's used today. It's gross, the wrong number everywhere it's read. `paidHoursPerDay` stays only for pay-clock denominators.
- **Person `cap` = that person's productive hours per day.** One fallback everywhere: `cap > 0 ? cap : productiveHoursPerDay`.
- **Unestimated hpd (absent or 0):**
  - Progress shows 0%.
  - The bar is drawn at `productiveHoursPerDay` per person, as `barLengthHours` already does.
  - Nothing invents or saves 7.5.

### What breaks or shifts visibly when the minority is changed

- **iOS gantt:** bars get much shorter. The sample goes from about 6.4 days to about 1 day per person, matching web.
- **Web day view, iOS JobShifts, day-view resize:** blocks shrink by the team factor and stop running through lunch. Single-person Basic shifts barely change.
- **Gantt resize:** writes × team, so a resized bar keeps the length it was dragged to.
- **`finishedOpFields`:** stops overwriting hpd with a clock span.
- **Overloaded filter, Analytics workload, client profile:** load numbers drop sharply. The sample goes from 100% to 33%.
- **Durations** (`opDurBD`, iOS `durationDays`, availability) switch to productive hours and team. Some ops gain a day (16 h: 2 → 3); 2-person ops lose days.
- **AI import:**
  - It asks for total hours.
  - Ops don't change, because the commit already discards the AI's number.
  - Hours edited in the preview grid would start committing, which is a behaviour change.
  - The job-level hpd stops seeding new ops, which currently get 7.5–8.
- **iOS decode:** keeps "unestimated" instead of saving 7.5.
- **Wizard:** `|| 7.5` fixed.
- **Labels:** "Hours per day" / "Hrs/Day" become "Est. hours".

**Migration:** stored values can't be reliably told apart; there's no record of who wrote them. Heuristics exist but are guesses:
- a resize leaves `hpd == span × productive` with team > 1;
- iOS multi-day general jobs have hpd 7.5.

Recommended: no bulk rewrite. Fix every writer, and optionally give admins a report of suspect ops to check by hand.
