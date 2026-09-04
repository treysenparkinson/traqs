# macOS Schedule page — parity map and worklog

**Source of truth:** `src/TRAQS.jsx`, `renderTeam()` @ **13902–16314** — 2,412
lines, the largest single view in the app and roughly three times the Jobs list.
Reached from the sidebar's second entry and from the Jobs row menu's "Take me to
schedule", which currently lands on a placeholder.

**Target:** `TRAQS MacBook Native/TRAQS MacBook Native/Schedule*.swift` (none yet).
Pure rules go in `TRAQS Scheduling/TRAQS Scheduling/Services`, which compiles into
BOTH targets — a change there hits iOS too.

Verifying without building, the typecheck command, and the four things that will
bite you are all in `MAC-JOBS-PARITY.md`. They apply unchanged.

---

## Start here

### What this page is

A resource timeline: one ROW PER PERSON, one COLUMN PER DAY, and a bar for every
operation assigned to that person. Plus a separate hourly day view, PTO bars, a
live "on job" pill, drag-to-move and drag-to-resize, dependency-group snapping,
month zoom, and a tray of unplaced work.

### Three modes

`tMode` — `day` | `week` | `month`.

* **day** — an HOURLY grid (:14410 in file terms, "Hourly day view"). Different
  layout code from the other two, not a zoom level of them.
* **week / month** — the resource timeline (:14564, "Resource timeline grid").
  Month adds `monthZoom`, which stretches the grid to `monthZoom * 100%` and
  scrolls horizontally.

### The layout core

`getPersonBars(pid, winS, winE)` @ **13976** returns every bar on one person's
row: PTO bars from `person.timeOff`, then one per assigned operation.

Two things make it subtle, and both are documented at length in the source
because both caused visible bugs:

1. **A bar's visual end is not `op.end`.** `_visualEnd` recomputes it from
   `hpd / teamSize` plus any OVERRUN (an op keeps growing past its estimate until
   somebody finishes it). The visibility filter must use the same figure the
   render draws with, or bars vanish mid-pan while still on screen.
2. **Overrun pushes everything after it.** A row's later bars shift right by the
   overrun ahead of them. `overrunSlackDays` is an UPPER BOUND used only to widen
   the visibility window; the real push is computed per row.

### What it needs that Swift does not have yet

| web | what it does | Swift |
|---|---|---|
| `walkProductiveHours` | spends N productive hours across days, stepping OVER lunch and breaks only when work reaches them; returns `{days, endHour, columns}` | **missing** |
| `deriveWorkedState` | worked-hours-shown and `isFullyWorked` for an op | **missing** |
| `liveOpHours` | hours from a job clock running right now | partly — `HoursCalculator.liveElapsedHours` |
| `dayWindowCfg` | `{workStartH, workEndH, deadWindows}` from org settings | **missing** |
| `personStatus` | offline / online / lunch / break / on-job | **exists as `GatePresence`** (GateTeamStep.swift) — needs the on-job case |
| `getPersonBars` | the row layout above | **missing** |

Already ported and reusable: `SchedulePacker` (roll-forward day packing, lifted
out of the iOS Gantt), `HoursCalculator`, `JobsScheduler` (business days, work
calendar, who-is-free), `JobPalette`, `JobsDisplayStatus`.

`walkProductiveHours` replaced a flat pro-rate that "smeared the whole day's
unproductive time across every op in proportion to its size", which made a 1-hour
task inherit ~7 minutes of a lunch it never touches — enough to make it not fit a
day it fits exactly, clipping the bar and spilling a zero-width dashed tail onto
the next working day, across the weekend for anything late on a Friday. Port it
faithfully; the naive version is a trap that already sprang once.

### Pick up in this order

Sliced so each lands something usable rather than half a page.

1. ~~**The hour walk**~~ — done, see the worklog.
2. **`getPersonBars`** — pure, taking the walk above. Tests over a fixture roster.
3. **The week/month grid, read-only** — day columns, the dual header (week groups
   over day numbers), person rows, bars, the today line. No interaction.
4. **The left column** — avatar, name, department, the live "on job" pill.
5. **Pan, Today, and month zoom.**
6. **Drag to move** a bar, then **drag to resize**, then the confirm-push dialog
   (`confirmPush` — "this move affects N other jobs").
7. **The hourly day view** — its own layout, so it is its own slice.
8. **Dependency-group ghosting and snapping** while dragging.
9. **The unplaced-work tray** and dropping from it onto a person/day.
10. **Select mode / bulk delete**, the filter dropdown, and search — the same
    controls the Jobs toolbar has, and `JobsFilter` is already the shape for it.

---

## Worklog

What has been done and why, newest concern last.

### Landed — the work-day clock (slice 1)

`Services/WorkDayClock.swift` — `buildDayWindows` and `walkProductiveHours`,
pure, in the shared directory so iOS can draw the same bars.

`DayWindow` is a working day with its unproductive time PLACED in it;
`WorkDayClock.walk` spends productive hours through one, stepping over a break
only when the work reaches it, and returns `{days, endHour, columns}` — days
spanned, wall-clock end on the last day, and width in day-column units.

Three things about it are easy to get wrong and are now pinned by tests:

* **Hours are not columns.** Three and a half productive days is 3 + 4/9 columns
  in a 9-hour day with a break in the last stretch. A column is wall-clock width.
  Conflating the two is exactly the bug the flat pro-rate had.
* **A missing lunch is an hour at noon.** `lunch?.durationMinutes ?? 60`. An org
  that never configured one still loses an hour a day.
* **Overlapping breaks merge, but their total is preserved.** The time lost to the
  overlap is re-banked at the START of the day — not forgiven, and not put at the
  end, because the end would stop a full-day op short of quitting time and reopen
  the gap the whole file exists to close.

Twelve cases in `WorkDayClockTests`. Four of them failed on the first run and all
four were the TEST being wrong, not the code — worth saying, because each wrong
expectation was a plausible-sounding assumption (half the hours is half the
width; a nil lunch means no lunch; merged windows mean less dead time).

**Next:** `getPersonBars` (slice 2), which is the thing that turns this into
bars — `_visualEnd` and the overrun push are the two subtleties, both documented
in the map above.
