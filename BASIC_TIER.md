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

## PRIOR ART — this document was written without it, and they conflict

`origin/docs/rostering-design` carries **`docs/superpowers/specs/2026-09-21-rostering-design.md`,
1,235 lines**, plus a 420-line feature inventory. It is dated 2026-09-21/22, covers much of the
same ground, and contains **locked decisions** — numbered 1–23 — that this document contradicts.
I did not find it before writing, and it should be reconciled before any of this is built.

Where it AGREES (independently, which is worth something):

- **Overnight shifts belong to their start date** (§4.2) — the same ruling, with a precedent this
  document missed: `timeclock.js:518` already stamps `date: localDayOf(clockIn)`.
- **Tier gating is removal, not disablement** (decision 10) — the nine gates.
- **Time Clock splits at the job clock** (decision 15); **Approval Templates are Business**
  (16); **the Admin board loses the job bucket in Basic** (17).
- **Rostering is Basic; Business adds jobs/Gantt on top** (decision 8).

Where it CONFLICTS, and each needs your ruling:

| This document | The rostering design |
|---|---|
| `shifts.json`, concrete dated rows | **`roster.json`**, `kind: "template" \| "exception"` — **rule-based**, shifts generated and never persisted (§3.2, §5) |
| Recurring is **not v1**, post-launch | **Recurring IS the model.** A weekly template is the primitive; one-offs are exceptions |
| Analytics is **Business**; Basic has Employees in that slot | **Basic Analytics = Hours Logged + Pay Hours + Export Hours** (decision 14) |
| Not considered | **Basic gains a month shift calendar** in Business's month-timeline slot (decision 20) |
| Not considered | **Tier chosen at signup** (decision 9); `PERM_KEYS` trimmed to four in Basic (16) |
| Not considered | **DST handling** (§4.3) — clamp forward in spring, take the first in fall, compute hours in elapsed UTC. Bites overnight shifts only |
| Not considered | **Notifications are the clean seam**: every `notify.js` type is a job event, so Basic is "everything except `notify.js`", enforceable at the function boundary |

**The storage conflict is the one that matters most**, because it is the root decision and the two
answers are genuinely different products: a rule-based roster ("what is this person's normal
week?") versus a calendar of concrete shifts. The rostering design argues the rule-based model
from a real constraint — `people.json` is read by `requireOrgMember` on *every* authenticated
request, so versioned templates could not live there — and it is the more considered of the two.

**`PERM_KEYS` trimmed to four (decision 16) is also a prior ruling on #333**, which this campaign
has been treating as unresolved.

**Recommendation: read that spec before building, and treat its locked decisions as the default**
unless you overturn them deliberately. This document's value is the sizing, the measured
current-state and the native picture; its data-model decisions are the newer and less examined of
the two.

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

## The native picture — RETRACTED AND RE-MEASURED

**The first version of this section was measured against the wrong branch and almost all of its
numbers were wrong.** Recorded rather than quietly fixed, because the cause matters: the `traqs`
checkout is on `fix/code-audit-2026-09-10`, not `master`. I inventoried it without checking, and
reported the result as the state of the product.

| Claim made | Actually, on master |
|---|---|
| 70 Swift files, 32,190 lines | **130 Swift files, 45,721 lines** |
| **"Neither client has any concept of billing tier"** | **iOS is tier-aware** — `billingTier` appears 9 times across `APIService`, `AppState`, `OrgSignup`, `ThreadRoster`, `EmployeesView`, `GanttView`, `HomeView`, `MainTabView`, `MessagesView`, `JobDetailPopup`, `OrgSignupView`, `Icons` |
| `JobsScheduler.swift`/`JobShifts.swift` "do not exist" | **Both exist on master**, with test files beside them |
| "a Basic-shaped native client has to be built" | **iOS already has one, partly** |

`e8bd343 feat(ios): Basic tier jobs are shifts, not tracked work` is **on master**. It added
`JobShifts.swift` (+ tests) and touched `SimpleJob`, `AddJobSheet`, `HomeView`,
`JobDetailPopup` and `TasksView` — 540 insertions. iOS also carries `EmployeesView.swift` and
`OrgSignup.swift`, matching two things this document and the rostering design each proposed as
unbuilt (an Employees page; tier selection at signup).

**What this does NOT change:** Path A is still the recommendation, and the ~5–9 week figure is
unaffected, because Path A does not depend on the native apps at all. What changes is the
*fallback*: Path B and Path C were costed against an app with no tier concept, and that premise
was false. If Path A fails on device, the native fallback is **cheaper than stated** — iOS has
tier plumbing and a shift projection already.

**Everything native in this document now needs re-reading on master before it is relied on**, and
nothing native should be sized off this file until that is done on the Mac.

### The vocabulary problem is now THREE-way, not two

Settling it was already the right call; the real picture makes it more urgent.

| Term in use | Where | What it means |
|---|---|---|
| `JobShifts.Shift` | iOS `Services/JobShifts.swift` | a shift **derived from a job** — "Basic doesn't clock time against jobs; a job there is a shift" |
| "pay shift" | iOS `Models/Models.swift:501` | an **open clock session** |
| shift | web UI, this document, your definition | the **stored thing an admin creates** |
| roster template / exception | `docs/.../2026-09-21-rostering-design.md` | a **weekly rule**, from which shifts are generated |

Four meanings, three codebases. **Settled vocabulary, to be used everywhere from now on:**

| Concept | Schema | UI (customer-facing) | Native |
|---|---|---|---|
| The stored weekly rule | `roster.json`, `kind: "template"` | "Normal week" | `RosterTemplate` |
| A dated override | `roster.json`, `kind: "exception"` | "Exception" | `RosterException` |
| A generated occurrence | **not persisted** | **"Shift"** | `RosterShift` |
| A clock session | `payhours.json` row | "Time stamp" | `PayPunch` |

Rules that follow:

1. **"Shift" is the customer-facing word and is not negotiable** — it is what you said and what
   the product says ("shift scheduling", "New shift").
2. **Bare `shift` as an identifier in code is banned.** It is ambiguous in all three codebases
   today. Always `RosterShift` or `PayPunch`.
3. **Rename iOS's "pay shift" to `PayPunch` BEFORE any roster code is written.** The web already
   half-uses this vocabulary — `payhours.json`, and the table's "Pay-period hours export from pay
   punches". Doing it first is a small rename; doing it after is a rename across two codebases
   with live roster code on top, which is exactly the trap you called out.
4. **`JobShifts.Shift` is a job projection, not a roster shift.** Rename to
   `JobShifts.DerivedShift` or retire it with the job layer — do not let it become the Basic
   shift type by proximity.

### Path A — chosen. Its open items are LAUNCH GATES, not reasons to reconsider

> **GATE A1 — app identity.** One `appId` (`com.matrixsystems.traqs`). Either a second store
> listing, or one shell that routes by tier at launch. Precedent exists: the Mac app's
> `WebViewHost.swift` already hosts a web view in a native shell.
>
> **GATE A2 — store review** for a new or changed listing.
>
> **GATE A3 — push, background and kiosk** behaviours differ between a Capacitor wrap and the
> native clients. Note `forgot-clockout` pushes and OneSignal are live today.
>
> **GATE A4 — the upgrade path.** What happens when a Basic org upgrades to Business: which app
> its people then install, and whether anything migrates on the device.

**Path B stays rejected** — tier-gating the existing native apps was already the wrong shape, and
that judgement does not depend on the retracted numbers: it is two languages, forever, with every
future Business change risking Basic.

### Still needs the Mac

1. Whether either app builds today, and against which toolchain.
2. **Whether the Capacitor iOS target still builds and runs** — configured, but nothing shows when
   it was last exercised.
3. **How the wrap feels for clock-in on a real device.** The one thing that decides Path A and
   cannot be judged from source.
4. App Store state — what is listed, under which ID.
5. **How much of Basic iOS already works**, given `e8bd343`. This is now a real question rather
   than an assumption, and it could reduce Path A's scope further.

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
