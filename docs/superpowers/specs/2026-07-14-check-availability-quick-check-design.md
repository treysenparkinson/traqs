# Check Availability — Quick-Check (Jobs page)

**Date:** 2026-07-14
**Status:** Implemented in the **native SwiftUI iOS app** (not committed; user tests in the simulator)

> Note: an initial pass was built in the React web app (`src/TRAQS.jsx`) but the
> mobile app the user runs in the Xcode simulator is a **separate native SwiftUI
> app** (`TRAQS Scheduling/`) with no WebView. The web changes were reverted and
> the feature reimplemented natively. This spec reflects the native version.

## Goal

A read-only gut-check for admins: "how soon could a ~N-hour job get done between
these two dates?" It creates nothing and persists nothing.

## Where AI fits

The soonest-slot math is exact deterministic Swift; AI is used only to phrase the
already-computed result in one friendly sentence, with a templated fallback.

## Files

- **`Views/AvailabilityCheckView.swift`** (new) — result model, engine, expanding
  Liquid-Glass button, and the sheet. (Auto-included via the project's
  `PBXFileSystemSynchronizedRootGroup`.)
- **`Services/APIService.swift`** — `aiScheduleText(system:userJSON:maxTokens:)`
  POSTs to the `ai-schedule` edge function and parses the SSE `text_delta` stream.
- **`Services/AppState.swift`** — `availabilitySummary(system:userJSON:)` wrapper
  (returns nil when the proxy is unreachable so the caller uses the fallback).
- **`Views/JobsHubView.swift`** — mounts `AvailabilityCheckButton` bottom-left of
  the content area, admin-only, list mode only.

## 1. Button

`AvailabilityCheckButton(isPresented:)` — a floating pill using the app's native
Liquid Glass (`.glassEffect(.regular.interactive(), in: Capsule())`). Sits as a
circular `clock.arrow.circlepath` icon by default; **pressing** spring-expands it
to reveal the "Check for availability" label, then (after a ~0.26s beat so the
reveal is visible) sets the parent's `isPresented` binding to open the sheet. It
collapses back to the icon when the sheet dismisses. Gated by
`appState.currentPerson?.isAdmin == true` and `jobsMode == .list`.

The `.sheet` is attached in **JobsHubView** on a stable container (next to the
approval-queue `.fullScreenCover`), NOT on the FAB — presenting from the
opacity/animation-modified FAB layer was unreliable.

## 2. Sheet (`AvailabilityCheckSheet`)

- Inputs: **From** / **To** `DatePicker`s (default today → +14 days) and a
  **Total hours** decimal field, plus a **Find soonest** CTA (disabled until
  hours > 0). `.presentationDetents([.medium, .large])`.
- On submit: computes the result synchronously, then fires the AI summary async.

## 3. Engine (`AvailabilityEngine.compute`)

- **Eligible pool** = `userRole in {user, admin}` and `autoSchedule ?? true`
  (native flag; inverse of the web's `noAutoSchedule`).
- Walks business days from `max(From, today)` through the scan horizon:
  - Per day, count eligible crew free that day (`isFree`) — no time-off and no
    non-finished panel/op overlapping that day; string dates compare
    lexicographically. Weekday mapping mirrors GanttView (`weekday - 1` vs
    `workDays`, holidays excluded).
  - **Pooled/parallel capacity** = `freeCount * productiveHoursPerDay`, accumulated
    until the requested hours are covered. First day with capacity → `start`; the
    day the total is reached → `doneBy`; contributors tracked in encounter order.
  - `capacityInWindow` accumulates only From…To (for the shortfall note). Scan
    caps at 400 business days.
- `feasibleInWindow` = `doneBy <= To`. If it runs past To, the result still gives
  the realistic earliest finish and flags the shortfall.

## 4. AI summary

The computed facts (hours, pretty dates, window, people-open, fits-window) are
serialized to JSON and sent to `availabilitySummary`. A loading state shows while
it streams; `availabilityTemplate(_:)` provides the fallback sentence on any
failure or empty response, and covers the invalid / no-crew / fully-booked cases.

## 5. Result card

Big soonest date range, the AI sentence (or fallback), an amber shortfall warning
when past the cutoff, and a wrapping row of "who's open" avatar chips. **Check
again** returns to the inputs. Nothing is saved.

## Settled defaults

- No department filter (shop-wide gut-check).
- Admin-only.
