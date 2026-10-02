# Building Basic: what it actually requires

**Scope document, written 2026-10-02. Nothing here is built, and nothing here should be built
until the size is accepted.**

The tier definition is in `TIERS.md` and `src/tiers.js`. This document answers a different
question: *the code does not implement Basic at all — what would it take?*

That framing matters. These are not defects. Nothing regressed, nothing drifted. Basic was
defined after the product was built, and the implementation is simply behind the definition.
Treating this as a defect list is how the last two rounds went wrong.

---

## The short answer

**~5–9 weeks, not a quarter — and the reason is Capacitor.**

The phone clock is in Basic, which looked like it forced rebuilding two native apps. It does not.
**Capacitor 7 is already wired in this repository** (`webDir: "dist"`, both platforms, `cap:ios`
and `cap:android` scripts), so the Basic web view *is* the Basic phone app. The native SwiftUI and
Compose apps are the **Business** clients and can stay exactly as they are.

- **Minimum honest Basic (web): 12–21 days**
- **Phone clock via Capacitor: 5–10 days**
- **The deferrable remainder: 8–13 days**
- **Total: ~25–44 focused days ≈ 5–9 weeks**

A quarter is only forced if the Basic phone client is **rebuilt natively**, which would add 6–10
weeks and is not recommended. See the native section.

---

## Decisions taken

### Shifts live in their own file
`orgs/{org}/shifts.json`, not a `jobType` inside `tasks.json`. One server rule ("a Basic org may
not write `tasks.json`") beats payload-shape inspection on every write forever, and keeping shifts
in `tasks.json` is the same shortcut that produced flat-job Basic one layer up.

### A shift can cross midnight
22:00–06:00 is normal in manufacturing, so **a shift is a two-day object**. The schema stores a
start instant and an end instant, not a day plus two clock times, and the renderer needs
**segments** from day one — a head on the start day, a tail on the next. A night shift is the
normal case, not an edge case.

**#119 survives the shift type, and its machinery is reusable.** Its lanes are keyed by
`(op, day)` and read per segment, which is exactly what a crossing shift needs.

### A shift counts to the day it STARTS
22:00 Friday → 06:00 Saturday is **Friday's shift** — for the pay period, for "today", and for the
day grid. That is how payroll and shift naming work in every shop.

One rule in three places, so it wants a single helper rather than three copies: *the owning day of
a shift is the calendar day of its start instant.* The tail paints on Saturday but belongs to
Friday everywhere a total is computed. The tempting bug is a Saturday pay-period query picking up
the tail.

### A separate Basic schedule view, not a branched renderer
Person rows × a day grid, absolutely-positioned bars, no estimate arithmetic, no packing, no
cursor, no overrun. **"No hatching, no overdue tray, no cursor" true by construction beats true by
remembering a tier check** — and it cannot regress Matrix's schedule. Accepted cost: two
renderers.

### A shift carries a CREW, not one person
A morning crew is one shift with four names, not four shifts. **The one-person simplification is
lost**, and it was the cheapest one available — it would have made a shift row-local and removed
cross-row reasoning entirely. Consequences:

- A shift paints on every crew member's row, so one shift is N segments × M days.
- `(person, day)` becomes the lane key, not `(shift, day)`.
- Editing a shift touches several rows at once, so the crew picker is part of item 1, not a later
  addition.
- **No hours arithmetic follows from this.** A shift has no estimate to divide, so crews cost
  rendering and editing complexity but not the team-share maths that makes jobs hard.

### Basic includes a phone clock
A shift worker clocks in from their phone on site, not at a desk. Web-only shift scheduling is not
a product. **The table now names the device** ("Mobile clock in/out — from the phone, on site")
and `tiers-test` pins it, because silence on exactly this kind of load-bearing point is what
caused the last two rounds. The three un-gated "Mobile Clock-In" settings sections
(`TRAQS.jsx:19245`, `:20957`, `:27096`) stay.

### Basic keeps the Time Stamp view
It is the pay clock, which is half of what Basic is. **No work** — it is already un-gated and
already Basic-reachable. Named in the table so nobody gates it later.

### Recurring shifts are NOT v1 — and are the top post-launch item
Manual entry is survivable if the rest works. **But the schema must not make this hard to add**,
which is a constraint on item 1 rather than a deferral with no cost:

- Give a shift a nullable `seriesId` and `seriesRule` from day one, even though nothing writes
  them. Retrofitting a series onto rows that have no identity for it means a migration.
- Decide now whether an edited occurrence detaches from its series. Writing that down costs
  nothing today and is a redesign later.
- Do not key shifts by `(person, date)` anywhere — a recurring shift needs stable per-occurrence
  identity.

### Server enforcement (#125) is a LAUNCH GATE, not a defect
> **GATE: before the first Basic org that is not ours, `TIER_RULES_MODE` must be enforcing.**
> Today the four job-clock endpoints have no tier check and `tasks.json` is writable by a Basic
> org. The UI gates are suggestions; a token and a curl go around them.

Not required to build, not required to launch, required before a stranger.

---

## There is no migration — and it expires

| Org | Tier | Live data |
|---|---|---|
| `MTX2026TRAQS` — Matrix Systems | **business** | 66 jobs, 65 panel-structured |
| `MAT.JD3Y.FBQN` — Matrix Auto Group | basic | 3 live jobs, admin `treysenparkinson@gmail.com` |
| `TES.4865.54VU` — Testing | basic | 1 job, 5 pay punches, same gmail admin |
| `TRAQSBASIC` | basic | 12 jobs — seeded by `scripts/seed-basic-org.mjs` |
| `MAT.CEPE.3A96`, `MATRIX`, `MTX2025TRAQS` | basic | empty stubs |

**Every Basic org is a test org you own.** No customer is on Basic, so the shift type can land
clean. **The moment one customer is on Basic, a data migration joins every item below** — and the
enforcement gate fires.

`MAT.JD3Y.FBQN` holds a **panel-structured job on a Basic org**, a shape Basic's own client cannot
create — #125 visible in live data. Its jobs are titled *"Morning shift"*, *"Afternoon
delivery"*: the shift model was already being hand-rolled.

---

## Sizing

Focused days for one person who knows this codebase. Counts are measured from `src/TRAQS.jsx`.

| # | Item | Effort | Ship without? | If deferred |
|---|---|---|---|---|
| 1 | **Shift type + `shifts.json`** (crew, series fields) | **4–6d** | **No** | Nothing else is buildable. +1d for crews over one person. |
| 2 | **Separate Basic schedule view** | **5–10d** | **No** | The whole product. All the variance lives here. |
| 3 | **Job-time rendering off** | **3–5d** | **No** | Largely free under the separate view — see below. |
| 4 | **Lane arithmetic** (crew-aware) | **1–2d** | **No** | `(person, day)` keying; #119's segments kept. |
| 10a | **`DASH_STAT_KEYS` tier-aware** | **0.5d** | **No** | Three of six stats read 0 on the first screen. |
| | **Minimum honest Basic (web)** | **13.5–23.5d** | | **~3–5 weeks** |
| 11 | **Phone clock — Capacitor wrap** | **5–10d** | **No** | Basic is not a product without it. See native. |
| | **Minimum shippable Basic** | **~19–34d** | | **~4–7 weeks** |
| 5 | Departments off | 1–2d | Yes | Basic gets row grouping free. A leak, not a break. |
| 6 | Employees / Analytics slot | 1d | **Yes, entirely** | Basic already correct; only Business having both. |
| 7 | Time clock pay-only (UI) | 1d | Yes | Already has a Basic layout; job-clock zone gated. |
| 8 | Export designer blocks | 1–2d | Yes | Empty columns if a Basic user picks "Operations". |
| 9 | **Server enforcement (#125)** | 3–5d | Yes — **launch gate** | Not a leak, a missing lock. |
| 10b | Admin job log | 1–2d | Yes | Admin already shows clocked in/out. |
| | **Everything** | **~27–47d** | | **~5–9 weeks** |

**Item 3 shrinks under the separate-view ruling.** Hatching (17 sites), the overdue tray (41),
`cursorHour` (5) and `singleDayStacking` (5) need no switching off if the Basic view never calls
them. The estimate is held rather than cut until confirmed in code, because the shared surfaces a
shift still passes through — totals, exports, dashboard — do not disappear.

### Why the six can wait

Items 5, 6, 7, 8 and 10b share one shape: **Basic currently gets something Business is sold.**
Deferring means a Basic customer receives more than they paid for — a pricing leak and a tidy-up,
not a broken product. Item 9 is different in kind, which is why it is a gate.

---

## The native picture

**Determined from source, which is readable from this machine.** The iOS app is at
`traqs/TRAQS Scheduling/`, the Android app at `traqs/traqs-android/`. No native file was edited
and nothing was built.

### What the native apps are

| | iOS | Android |
|---|---|---|
| Stack | SwiftUI | Compose |
| Files / lines | 70 Swift, **32,190** | 44 Kotlin, **15,381** |
| Tier awareness | **none** | **none** |

**Neither client has any concept of billing tier** — zero matches for `billingTier`, `isBasic` or
a tier field in either codebase. Both are unconditionally **Business** clients. This is the
single most important native fact: there is nothing to switch, only something to build.

Job-layer coupling, measured:

- **Wholly job-layer iOS files: ~7,780 lines (24%)** — `TasksView` 2204, `GanttView` 1303,
  `AvailabilityCheckView` 864, `JobDetailView` 637, `JobDetailPopup` 509, `PanelPhotoSheet` 453,
  `ClientsView` 365, `JobsQuery` 360, `AnalyticsView` 343, `ApprovalQueueView` 315,
  `JobsHubView` 308.
- **Job-layer references inside SHARED iOS files: ~955 sites** — `AppState.swift` alone has 481
  in 3,341 lines, `MoreView` 166, `Models` 143, `APIService` 38, `AdminView` 34, `TeamView` 27,
  `TimeClockView` 25, `MainTabView` 24, `HomeView` 17.
- **Android, same shape at half the size: ~456 sites** in the five main files.

Also found: **`"shift" already means something else in iOS.** `Models.swift:501` — *"where this
open pay shift was started"* — a shift is a time-clock session. The Basic shift object would
collide with it by name throughout.

### Three paths

**Path A — Capacitor-wrap the Basic web view. RECOMMENDED. 5–10 days.**
Capacitor 7 is already configured here: `appId com.matrixsystems.traqs`, `webDir: "dist"`,
`@capacitor/ios` and `@capacitor/android` 7.x, with `cap:ios` and `cap:android` scripts. The web
app already has `isMobile`, a mobile tab bar and a More sheet. Once the Basic web view exists it
is already most of a phone app, and clocking in on site is a simple surface. The native apps stay
the Business clients, untouched.

**Path B — tier-gate the existing native apps. NOT recommended. 6–10 weeks.**
~1,400 job-layer reference sites across two languages, in apps with no tier concept to build on,
plus a shift model and shift screen in each. This is the shell-versus-substance problem twice
over, and every future Business change would risk Basic. **This is the path that makes Basic a
quarter.**

**Path C — a new small Basic native client per platform. 3–5 weeks each.**
A shift worker needs: my shifts, clock in/out, messages, team contact — six to eight screens, not
70 files. Cheaper than B and better than B, but it is two more codebases to keep forever, for a
tier whose whole point is being simple.

### What Path A still has to resolve

- **App identity.** One `appId`. If the native Business app ships under
  `com.matrixsystems.traqs`, a Capacitor Basic app needs a second listing, or one shell routes by
  tier at launch. **Precedent exists in this codebase**: the Mac app has `WebViewHost.swift`, a
  native shell hosting a web view, so a native shell that loads the Basic web view on a Basic org
  is not novel here.
- **Store review** for a new or changed listing.
- **Push, background and kiosk behaviours**, which differ between a Capacitor wrap and the native
  clients.
- **Upgrade path.** A Basic→Business org changes which app its people install, unless the
  routing-shell option is taken.

### What has to wait for the Mac

Everything above is static reading. These need the Mac:

1. **Whether either app builds today**, and against which Xcode / Gradle toolchain.
2. **Whether the Capacitor iOS target still builds and runs** — it is configured in `package.json`
   but there is no evidence here of when it was last exercised.
3. **How the Capacitor wrap actually feels** for clock-in on a real device — the one thing that
   decides whether Path A is acceptable, and it cannot be judged from source.
4. **App Store state** — what is listed, under which ID, and whether a second listing is viable.
5. **Two files cited by defects #239 and #242 do not exist in the tree**: `JobsScheduler.swift`
   and `JobShifts.swift`. Either renamed or the entries are stale. Same class of problem as #336,
   and it means those two entries cannot be trusted until checked.

---

## Suggested order

1. **Shift type + `shifts.json`** (1), then the **separate Basic schedule view** (2). The root;
   these two cannot be reordered.
2. **Job time off** (3, 4) and **the dashboard stats** (10a).
3. **Capacitor phone clock** (11). **Ship here.**
4. The remainder (5, 6, 7, 8, 10b) — independent, parallelisable, any order.
5. **Server enforcement** (9) in log mode, then enforcing. **Must be enforcing before the first
   outside Basic customer.**
6. **Recurring shifts** — first thing after launch.

---

## Explicitly not in scope

- **Granular permissions (#333)** — unrelated to the job layer; its own decision.
- **Automatic scheduling** — already Business, already correct, not server-enforceable.
- **`ai-schedule` (#336)** — needs its source located first.
- **The nine existing gates** — correct as they stand, restored in `b93db18`.
- **Lane defects #119–#123** — parked in `SCHEDULE_MAP.md`. #119 survives the midnight ruling;
  #121 and #123 are expected to close rather than be re-fixed.
