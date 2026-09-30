# TIME_CALENDAR — working days, holidays, timezone and defaults (root cause 6)

Read-only comparison, 2026-09-30, against `master` at cee5baf.
- `J:` = src/TRAQS.jsx, `S:` = src/statsMath.js.
- "Executed" means the real code was run: functions sliced from TRAQS.jsx and statsMath, or statsMath imported directly, with TZ set where it matters.
- Matrix (MTX2026TRAQS): America/Denver, Mon–Fri, **no holidays**, 08:00–17:00, lunch 12:00 for 60 min, breaks at 10:00 and 14:00 for 15 min each. That's 7.5 productive hours a day.

---

## 1. The two inferred defects, verified

- **#80 is real (executed).** A bar paints across a holiday and comes up one column short.
  - `addBD` skips the holiday when it computes the end, but the bar's segments come from `weekdaySegments` (J:17882), which doesn't.
  - Mon–Wed with Tuesday a holiday and 15 h: painted Mon plus the Tuesday holiday, with Wednesday blank.
  - 22.5 h: painted Mon–Wed including the holiday, with Thursday missing.
  - Thu→Mon with Friday a holiday: painted Thu and the Friday holiday, and Monday's piece is never drawn.
- **#77 is real, but narrow (executed, TZ=America/Denver).** `productiveHoursBetween` places each working window at midnight + hours in milliseconds.
  - On a DST day that puts every window 1 h off the wall clock: 8–17 becomes 9–18 on Mar 8 and 7–16 on Nov 1.
  - US DST always switches on a Sunday, so only an org that works Sundays sees it. An 8–17 Mon–Sun shop gets 6.5 h instead of 7.5 h on those two days.
  - Matrix is unaffected. `hourTs` and `endOfWorkingDayMs` have the same shift.

## 2. Working days and holidays: where org config should be read and isn't

**Helpers that never consider holidays (#78, executed):**
- `addWorkingDays`, `isWorkDay`, `weekdaySegments`, `getWorkingDayDuration` and `countWorkingDays` (J:588–628) take `workDays` only.
- With Tuesday a holiday: `countWorkingDays(Mon, 2)` returns Tue; `getWorkingDayDuration(Mon, Wed)` returns 3 instead of 2.
- They feed:
  - import durations (J:4814, 4869) and the import floor (J:4782);
  - Gantt and Schedule drag durations (J:12393–12463, 18034–18147, 18688);
  - analytics capacity (J:17019, 19554, 20501, 20592, 20724, 33233).

**Holidays are never shaded (#79):** every grid header and cell shades by `workDays` alone (J:17235, 17267, 17523, 12939, 12960, 13168). Only the day view (J:17047) checks holidays.

**Calls with no org options (#21, #81):** `addBD`/`nextBD`/`diffBD` fall back to Mon–Fri and no holidays when org options aren't passed. Calls that don't pass them:
- `buildSessionSnapshot` J:9943
- `computeJobOptimize` J:10014–10090
- `previewPullBack` J:10127–10140
- `findNextSlot` J:10184–10188
- `runOptimize` J:10230–10253
- `placeTaskAt` J:10499
- the pending-tray drop J:10525 (neither of those two snaps its start to a working day)
- `clampUnlocked` J:18125
- the team-drag fallback J:18461–18468
- **`_computeMonthMove`** J:18617–18624 (#21)
  - It builds its move from one calendar and its end from another.
  - Executed: dropping Mon→Wed across a Tuesday holiday moves a Thursday member to Mon 10-12 instead of Fri 10-09.
- `_memberMove` J:18682–18692
- the week-mode resize drop J:18984
- the drag tooltip J:19451
- new-job phase layout J:26345
- `doSplit` J:32190
- `addPanel` J:35030–35051

**Already fixed:**
- **#59:** `previewPush` now calls the shared overlap rule, whose calendar includes holidays.
- **`reflowPhaseOps` (listed in #81):** it already receives the org options.

**#85 (executed):** moving a panel or job in `updTask` shifts its children by calendar days (J:10411–10455). A Thu–Fri op moved by 2 lands on Sat–Sun.

**#86 (executed):** the import's `shiftRangeForward` (S:769) snaps the start and keeps the calendar offset for the end.
- A Mon–Fri range moved to a Wednesday ends on Sunday, with 3 working days instead of 5.
- iOS reopening a past job shifts it the same way (AppState.swift:1647–1662).

**iOS ignores holidays in:**
- `GanttView.isWorkDay` (GanttView.swift:180), which the packer uses, so hours land on holidays;
- `TasksView.isWorkDay` (TasksView.swift:709);
- `StatsMath.workDayCount` (StatsMath.swift:130), used for capacity;
- the reopen shift.

`AddJobSheet` and `AvailabilityCheckView` do read holidays.

**#82 hang (executed):** `addBD(n > 0)`, `nextBD`, `addWorkingDays` and `countWorkingDays` loop forever when `workDays` is `[]`. The shared `shiftWorkingDays` and `isWorkingDay` are bounded, and treat `[]` as Mon–Fri.

**Is an empty work week reachable?**
- Not from the web UI: both settings screens refuse to untick the last day (J:28950, J:32475).
- The server accepts one: `settings.js` stores any object that isn't empty, including `workDays: []`. That can come from an API call, or from iOS sending back an `[]` it decoded.
- On reload the web repairs it: an empty list becomes Mon–Fri (J:5720, J:7605).
- **The live-update handler (J:8692) doesn't.** It merges the new settings without that guard, so every open web session freezes on its next render until it's reloaded.

**Which calendar should be canonical:** there are four today:
- `addBD`/`nextBD`/`diffBD` with optional org options (TRAQS.jsx only);
- `overlapRules.shiftWorkingDays`/`ctx.isWorkDay`;
- `scheduleRules.isWorkingDay`;
- statsMath's own copies.

The optional options are the root cause of #21, #81 and #82: leaving them out silently gives Mon–Fri with no holidays.
- **Canonical:** `workCalendar(settings)` in `src/scheduleRules.js`, grown from `isWorkingDay`, which already has strict parsing, a UTC-noon weekday and `[]` treated as Mon–Fri.
- **What it provides:** isWorkDay, add, next, diff, span and segments, all bounded.
- **Who uses it:**
  - the web builds it once per render, and the old helpers are deleted so no call can leave out the org rule;
  - overlapRules and statsMath build their day test from it;
  - the server shares it.
- **iOS:** `WorkCalendar`, with holidays, is used everywhere.

## 3. Timezone (#76)

Every piece of schedule geometry uses the **viewer's** browser time, while the server already uses the org's (tasks.js and timeclock.js).

What uses browser time:
- `TD`, "today", is frozen when the page loads, so a tab open past midnight shows yesterday.
- `overlapCtx.today`, `getHours()` for the now-cursor and day-view hour, the before-now checks, `rowPushHours`' now, and `hourTs`.
- `productiveHoursBetween`, `endOfWorkingDayMs`/`openSessionEnd`, the approval's end hour, the late-arrivals tile and the day-view punch lanes.
- statsMath `normalizeToWorkTime` and `dayHourMs`.

The `"T12:00:00"` date arithmetic (84 sites) works in one zone throughout, so it's unaffected.

For a viewer outside the shop's zone:
- the cursor is off by the zone difference;
- drops are refused as "in the past", or allowed into time that's already gone;
- worked hours are counted against the wrong hours of the day;
- live bars freeze early.
- **Data is written wrong too:**
  - the browser stamps `unclosedAt` at the viewer's end of day (J:7204);
  - approval writes the DONE bar's end hour in viewer time (J:9827–9860).

iOS has no `timeZone` field and uses `Calendar.current` in 66 places.

**What should be in org time:** everything about the schedule, meaning today, day columns, hour of day, the now-cursor, before-now, end-of-day, span placement and live hours. Absolute timestamps in chat, notifications and audit trails stay in the viewer's zone.

**The pieces a fix needs already exist:** `localDay` (src/localDay.js) and `zonedTimeToUtcMs`/`zonedDay` (netlify/functions/_utils/after-hours.js) would move into `src/` as `shopDay`/`shopHour`/`shopMs`. When the org has no timezone they fall back to the viewer's zone, so a viewer in the shop's zone sees no change. This also fixes #77.

## 4. Defaults (#213, #214) and end of day (#215)

**What each place defaults to when the org has nothing set:**

| Place | Hours | Lunch | Breaks |
|---|---|---|---|
| Web state, settings UI, iOS `OrgSettings.default`, Android | 07:00–15:00 | 30 min | 10:00 for 15 min |
| Web `parseWorkHour` (only when the stored value is null) | 08:00–17:00 | | |
| Day-view pack | 07:00–15:00 | | |
| statsMath `opInterval`/`normalizeToWorkTime` | 8–16 | | |
| Server `overlapContext` | 07:00–15:00 | | none |
| timeclock shrink | 08:00–17:00 | | |
| after-hours end of day | ends 15:00 | | |
| `buildDayWindows` | | 60 min | none |
| iOS `WorkDayClock` | | 60 min when lunch is nil | |

The day-view grid (5–21) and shading (7–18) are fixed and never read settings.

**Executed, for a new org with only a timezone saved:**
- web: 7.25 productive h/day;
- server: 7.5;
- with `lunch: null`: web 6.75, server 7.25.

Matrix sets everything, so Matrix gets 7.5 on both.

**Correct default:** 07:00–15:00, lunch 12:00 for 30 min, one 10:00 15-minute break.
- **Why:** it's exactly what a new org sees on first run. org.js seeds only the timezone and pay period, so the web, the settings UI, iOS and Android all show these values.
- **Where it lives:** in one `src/orgDefaults.js` used by the web, server and statsMath, and mirrored on iOS.
- **A stored null** counts as missing.

**End of day (#215).** There are three rules today:
- `endOfWorkingDayMs`: the viewer's midnight + workEnd, with no grace and 1 h off on DST days. A clock-in after workEnd is instantly "unclosed".
- after-hours: org timezone, workEnd + 30 min, rolling to the next day for a late clock-in, with a 12 h backstop.
- forgot-clockout pay shifts: a flat 12 h.

**Correct rule:** workEnd in the org's timezone, on the clock-in's org day, rolling to the next working day's end when the clock-in is at or after it.
- The 30-minute grace and the 12 h backstop stay for notifications only.
- Freezing, live hours and `unclosedAt` all use the one rule.

## 5. Matrix today (read-only)

- **Holidays:** none configured, so #78, #79 and #80 show nothing today. The first holiday added makes bars paint across it and come up a column short.
- **Calls with no org options:** they fall back to Mon–Fri with no holidays, which is exactly Matrix's week, so nothing is wrong today.
- **#85 and #86 are already in the data:** 5 past units start and 17 end on a weekend, across 12 jobs. There are none in current or future work.
- **Timezone:**
  - A Denver viewer sees no change.
  - A viewer in another zone is wrong today:
    - Hours are off on every record.
    - A New York viewer sees 310 of 316 clock-ins as late, against 237 for Denver.
    - Live bars freeze at 15:00 Denver time.
  - I can't tell from the data whether Matrix has anyone viewing from another zone.
- **DST:** doesn't affect Matrix; Sundays aren't workdays.
- **Defaults:** don't affect Matrix; every value is set. They do affect new orgs.
