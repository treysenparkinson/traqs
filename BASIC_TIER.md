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

**Not a week. A month, and the variance is almost entirely in one item.**

The smallest honest Basic is **five items, ~12–21 focused days**. The other six can wait, and
deferring them **over-delivers rather than under-delivers** — every one is a Business feature
leaking into Basic, not a Basic feature missing. The single exception is server enforcement,
which is a risk rather than a leak, and is now a **launch gate** (see below).

The surprise, found while sizing: **the Basic shell already exists.** Someone already built
Basic-aware layouts across the dashboard, the time clock and the nav. What is missing is not the
surface. It is the substance — there is no shift.

---

## Decisions taken

### Shifts live in their own file
`orgs/{org}/shifts.json`, not a `jobType` inside `tasks.json`. One server rule ("a Basic org may
not write `tasks.json`") beats payload-shape inspection on every write forever, and keeping shifts
in `tasks.json` is the same shortcut that produced flat-job Basic one layer up.

### A shift can cross midnight
22:00–06:00 is normal in manufacturing, so **a shift is a two-day object**. Consequences, because
this one is not free:

- The schema stores a start instant and an end instant, not a day plus two clock times.
- The renderer needs **segments** from day one — a head on the start day, a tail on the next.
  This is not an edge case to add later; a night shift is the normal case.
- **#119 survives the shift type, and its machinery is reusable.** Its lanes are keyed by
  `(op, day)` and read per segment, which is exactly what a crossing shift needs. It was the one
  parked lane defect whose fate turned on this question.

### A shift counts to the day it STARTS
22:00 Friday → 06:00 Saturday is **Friday's shift** — for the pay period, for "today", and for the
day grid. That is how payroll and shift naming work in every shop.

This is a single rule applied in three places, and it is worth writing once as a helper rather
than three times: *the owning day of a shift is the calendar day of its start instant.* The tail
segment paints on Saturday but belongs to Friday everywhere a total is computed. Expect the
tempting bug to be a Saturday pay-period query picking up the tail.

### A separate Basic schedule view, not a branched renderer
Person rows × a day grid, absolutely-positioned bars, no estimate arithmetic, no packing, no
cursor, no overrun. Same reasoning as the file decision: **"no hatching, no overdue tray, no
cursor" true by construction beats true by remembering a tier check** — and it cannot regress
Matrix's schedule. The accepted cost is two renderers to maintain.

### `DASH_STAT_KEYS` is in the minimum
A first screen reading three zeroes is not shippable. Half a day, and it stays in the minimum set.

### Server enforcement (#125) is a LAUNCH GATE, not a defect
It is not required before building and not required before launch. It **is** required before a
Basic customer you do not know. Recorded as a gate so it is not re-triaged as a defect later:

> **GATE: before the first Basic org that is not ours, `TIER_RULES_MODE` must be enforcing.**
> Today the four job-clock endpoints have no tier check and `tasks.json` is writable by a Basic
> org. The UI gates are suggestions; a token and a curl go around them.

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
clean and the test orgs can be re-seeded or dropped. **The moment one customer is on Basic, a data
migration joins every item below** — and the enforcement gate above fires.

Two details from those orgs:

- `MAT.JD3Y.FBQN` holds a **panel-structured job on a Basic org** — a shape Basic's own client
  cannot create. That is #125 visible in live data, not theory.
- Its jobs are titled *"Morning shift"*, *"Afternoon delivery"*. The shift model was already being
  hand-rolled on top of flat jobs.

---

## Sizing

Effort is focused days for one person who knows this codebase. Measured counts are from
`src/TRAQS.jsx`.

| # | Item | Effort | Ship without? | If deferred |
|---|---|---|---|---|
| 1 | **Shift type + `shifts.json`** | **3–5d** | **No** | Nothing else is buildable. |
| 2 | **Separate Basic schedule view** | **5–10d** | **No** | The whole product. All the variance lives here. |
| 3 | **Job-time rendering off** | **3–5d** | **No** | Largely free under the separate view — see below. |
| 4 | **Lane arithmetic** | **1d** | **No** | Mostly deletion; #119's segment keying is kept. |
| 10a | **`DASH_STAT_KEYS` tier-aware** | **0.5d** | **No** | Ruled in. Three of six stats read 0 on the first screen. |
| | **Minimum honest Basic** | **12–21d** | | **~3–4 weeks** |
| 5 | Departments off | 1–2d | Yes | Basic gets row grouping free. A leak, not a break. |
| 6 | Employees / Analytics slot | 1d | **Yes, entirely** | Basic is already correct. Only Business having *both* pages remains. |
| 7 | Time clock pay-only (UI) | 1d | Yes | Already has a Basic layout; the job-clock zone is already gated. |
| 8 | Export designer blocks | 1–2d | Yes | A Basic user picking "Operations" gets empty columns. Cosmetic. |
| 9 | **Server enforcement (#125)** | 3–5d | Yes — **launch gate** | Not a leak, a missing lock. See the gate above. |
| 10b | Admin job log | 1–2d | Yes | Admin already shows clocked in/out. |
| 11 | **Native** | **unsized** | **Unknown** | See below. Decides a month vs a quarter. |
| | **Everything** | **~20–33d** | | **~4–7 weeks**, plus native |

**Item 3 shrinks under the separate-view ruling.** Hatching (17 sites), the overdue tray (41),
`cursorHour` (5) and `singleDayStacking` (5) do not need to be switched off one by one if the
Basic view never calls them. What remains is the shared surfaces a shift still passes
through — totals, exports, the dashboard — so the 3–5d estimate is kept rather than cut until
that is confirmed in code.

### Why the six can wait

Items 5, 6, 7, 8 and 10b share one shape: **Basic currently gets something Business is sold.**
Deferring means a Basic customer receives more than they paid for — a pricing leak and a tidy-up,
not a broken product, and none is visible to the customer as a defect.

Item 9 is different in kind, which is why it is a gate rather than a row to defer silently.

---

## What is already built (and was mis-sized before this pass)

Checking rather than assuming cut three items roughly in half:

- **Dashboard** — `renderDashboard` already branches on tier at 12 sites: drops the Analytics
  panel, renames "On a job now" → "On the clock now" and "Due within 7 days" → "Schedule for the
  next 7 days", and regrids. **The one real gap is `DASH_STAT_KEYS` (line 580), a module-level
  constant that is not tier-aware**, so Basic rotates "Active jobs", "Jobs on time" and "Average
  completion" — all three reading 0 on a shift-only org.
- **Time clock** — already has a Basic variant (`tq-tcsession-basic`, a 2-column grid against
  Business's 3-column), and the job-clock zone is already behind a tier check.
- **Nav** — Basic already gets Employees and not Analytics. **The Basic side of the slot swap is
  done.** Only Business also having Employees remains, which no Basic customer can see.

---

## Suggested order

1. **The four open questions below.** No code.
2. **Shift type + `shifts.json`** (1), then the **separate Basic schedule view** (2). The root;
   these two cannot be reordered.
3. **Job time off** (3, 4) and **the dashboard stats** (10a). **Ship here.**
4. The rest of the surface (5, 6, 7, 8, 10b) — independent, parallelisable, any order.
5. **Server enforcement** (9) in log mode, then enforcing. **Must be enforcing before the first
   outside Basic customer**, whenever that falls.
6. **Native** (11), sized separately.

---

## Open questions

Answered: shifts cross midnight; shifts own their file; a shift counts to the day it starts; a
separate Basic schedule view; `DASH_STAT_KEYS` is in the minimum; #125 is a launch gate.

### Trey to answer

1. **Does Basic include a phone clock?** — **decides a month vs a quarter.** See below.
2. **One person per shift, or several?** "Who's on it" is ambiguous. One person makes a shift a
   row-local object and removes team-share arithmetic entirely — a real simplification to items
   1, 2 and 4.
3. **Are shifts recurring?** Nothing in the definition says so and "all manual" suggests not, but
   a shift scheduler without repeat is unusual enough to state explicitly. If yes, item 1 grows.

### Still unassigned

4. **Does Basic keep the Time Stamp view?** Neither named in the definition nor obviously
   job-layer. Not in the three above; still open.

---

## `src/tiers.js` cannot be finalised until question 1 is answered

**Half a correction, and the other half is worse than raised.**

The comparison **table** does not currently sell Basic "mobile clock in/out". That row existed in
the pre-2026-10-02 table and did not survive the rewrite from the definition. The current row is
**"Time clock, for pay only"** — silent on device. The only surviving mention of the old wording
is `SCHEDULE_MAP.md:1233`, the historical #332 entry recording what the row used to say.

**But the UI does promise it, and un-gated.** Three Time Clock Settings sections are headed
**"Mobile Clock-In"** — `TRAQS.jsx:19245`, `:20957`, `:27096`, the usual three copies of the
settings block — each behind `isAdmin` and **no tier check at all**. So a Basic admin opens
settings today and configures mobile clock-in.

That is a stronger dependency than a silent table. A table that omits something is incomplete; a
settings page that offers a feature is a promise the product has already made. If Basic ships
web-only, those three sections are a dangling control, and silence on a load-bearing point is
exactly what caused the two failed tier rounds — a reader fills it in, and fills it in wrong.

**Whichever way question 1 goes, these three need the same answer as the table**, and they are not
in any item above — add them to item 7 (time clock, pay-only UI) if the answer is web-only.

Whichever way question 1 goes, the row should name the device rather than stay quiet:

- **Phone clock in Basic** → the row says so, and item 11 is on the critical path.
- **Web-only Basic** → "Time clock, for pay only" stays literally true but a buyer will assume a
  phone. The row needs to say web, or the omission becomes the next "Scheduling & job management".

`scripts/tiers-test.mjs` should grow an assertion pinning whichever answer is given, so the device
claim cannot drift the way the job-layer claim did.

### Native (item 11) — what the decision depends on

Unsized until the Mac, by your call. It resolves to question 1.

- **If no** — Basic is web-only at launch, item 11 leaves the critical path entirely, and the
  month estimate stands.
- **If yes** — a Basic-shaped native client is required. iOS and Android both implement the job
  layer today (`timeclock.js:439` records both posting `jobClockIn` by name), so this is not a
  matter of hiding a tab; it is the same shell-versus-substance problem again, on two platforms,
  and would likely exceed everything above combined.

---

## Explicitly not in scope

- **Granular permissions (#333)** — unrelated to the job layer; its own decision.
- **Automatic scheduling** — already Business, already correct, not server-enforceable.
- **`ai-schedule` (#336)** — needs its source located first.
- **The nine existing gates** — correct as they stand, restored in `b93db18`.
- **Lane defects #119–#123** — parked in `SCHEDULE_MAP.md` pending the shift type. #119 survives
  the midnight ruling; #121 and #123 are expected to close rather than be re-fixed.
