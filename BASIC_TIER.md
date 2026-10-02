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
which is a risk rather than a leak.

The surprise, found while sizing: **the Basic shell already exists.** Someone already built
Basic-aware layouts across the dashboard, the time clock and the nav. What is missing is not the
surface. It is the substance — there is no shift.

---

## Decisions taken

**Shifts live in their own file** — `orgs/{org}/shifts.json`. Ruled 2026-10-02. One server rule
("a Basic org may not write `tasks.json`") beats payload-shape inspection on every write forever,
and keeping shifts inside `tasks.json` is the same shortcut that produced flat-job Basic one layer
up.

**A shift can cross midnight.** Ruled 2026-10-02: 22:00–06:00 is normal in manufacturing, so **a
shift is a two-day object** and the schema, the render and the lane rule all have to carry that.
Consequences, because this one is not free:

- The schema stores a start instant and an end instant, not a day plus two clock times. A shift
  that begins Friday 22:00 belongs to Friday but paints on Friday *and* Saturday.
- The renderer needs **segments** from day one — a head on the start day and a tail on the next.
  This is not an edge case to add later; it is the normal case for a night shift.
- **#119 becomes real, and its machinery is the right shape.** Its lanes are keyed by
  `(op, day)` and read per segment, which is exactly what a midnight-crossing shift needs. That
  was the one parked lane defect whose fate turned on this question; it survives, and its
  approach carries over.
- Pay-period boundaries, "today", and the day grid all need a rule for which day a crossing shift
  counts to.

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
migration joins every item below.**

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
| 2 | **Shift bars on the schedule** | **5–10d** | **No** | The whole product. All the variance lives here. |
| 3 | **Job-time rendering off** | **3–5d** | **No** | Hatching and an overdue tray on a shift bar are incoherent. |
| 4 | **Lane arithmetic** | **1d** | **No** | Mostly deletion; #119's segment keying is kept. |
| 10a | **`DASH_STAT_KEYS` tier-aware** | **0.5d** | **No** | Three of six rotating stats read 0 on the first screen. |
| | **Minimum honest Basic** | **12–21d** | | **~3–4 weeks** |
| 5 | Departments off | 1–2d | Yes | Basic gets row grouping free. A leak, not a break. |
| 6 | Employees / Analytics slot | 1d | **Yes, entirely** | Basic is already correct. Only Business having *both* pages remains. |
| 7 | Time clock pay-only (UI) | 1d | Yes | Already has a Basic layout; the job-clock zone is already gated. |
| 8 | Export designer blocks | 1–2d | Yes | A Basic user picking "Operations" gets empty columns. Cosmetic. |
| 9 | **Server enforcement (#125)** | 3–5d | Yes, with a named risk | See below. Not a leak — a risk. |
| 10b | Admin job log | 1–2d | Yes | Admin already shows clocked in/out. |
| 11 | **Native** | **unsized** | **Unknown** | See below. Most likely to decide now-or-later. |
| | **Everything** | **~20–33d** | | **~4–7 weeks**, plus native |

### Where the variance is: item 2

The honest range is 5–10 days and the spread is a real fork, not padding:

- **Branch the existing renderer by tier.** Cheaper to start, and every future change to the
  schedule has to be made twice in a file that is already 33k lines.
- **Write a separate, simple Basic schedule view.** A shift schedule is person rows × a day grid
  with absolutely-positioned bars and no estimate arithmetic, no packing, no cursor, no overrun —
  a fraction of the complexity. **Plausibly faster to write than to branch**, and far safer,
  because it cannot regress Matrix's schedule. The cost is two renderers to maintain.

**Recommendation: the separate view**, for the same reason shifts got their own file. It is also
the only option where "no hatching, no overdue tray, no cursor" is true by construction rather
than by remembering to add a tier check.

### Why the nine can wait

Items 5, 6, 7, 8, 10b all have the same shape: **Basic currently gets something Business is sold.**
Deferring them means a Basic customer receives more than they paid for. That is a pricing leak and
a tidy-up, not a broken product, and none of them is visible as a *defect* to the customer.

**Item 9 is the one that is different.** It is not a leak; it is the absence of a lock. Today the
four job-clock endpoints have no tier check, and `tasks.json` is writable by a Basic org. With no
Basic customers that risk is theoretical. With one Basic customer and an open API it is real, and
the UI gates are suggestions. **Ship Basic without it only while the customer count is zero or
trusted; put it in before a Basic customer you do not know.**

---

## What is already built (and was mis-sized before this pass)

Checking rather than assuming cut three items roughly in half:

- **Dashboard** — `renderDashboard` already branches on tier at 12 sites: drops the Analytics
  panel, renames "On a job now" → "On the clock now" and "Due within 7 days" → "Schedule for the
  next 7 days", and regrids. **The one real gap is `DASH_STAT_KEYS` (line 580), a module-level
  constant that is not tier-aware**, so Basic rotates through "Active jobs", "Jobs on time" and
  "Average completion". On a shift-only org all three read 0. Half a day, and it is the first
  screen a customer sees — which is why it is in the minimum.
- **Time clock** — already has a Basic variant (`tq-tcsession-basic`, a 2-column grid against
  Business's 3-column), and the job-clock zone is already behind a tier check.
- **Nav** — Basic already gets Employees and not Analytics. **The Basic side of the slot swap is
  done.** Only Business also having Employees remains, which no Basic customer can see.

---

## Suggested order

1. **Open questions below.** No code.
2. **Shift type + `shifts.json`** (1), then **shift bars** (2). The root; nothing else is safe
   first, and these two cannot be reordered.
3. **Turn job time off** (3, 4) and **the dashboard stats** (10a). Mostly deletion and tier
   branches once a shift bar exists. **Ship here.**
4. The rest of the surface (5, 6, 7, 8, 10b) — independent of each other, parallelisable, any
   order.
5. **Server enforcement** (9) in log mode, running while the above lands; flip once quiet.
6. **Native** (11), sized separately.

---

## Open questions

Answered: shifts cross midnight (yes), shifts live in their own file.

Still blocking step 2:

1. **One person per shift, or several?** "Who's on it" is ambiguous. One person makes a shift a
   row-local object and removes team-share arithmetic entirely — a meaningful simplification to
   items 1, 2 and 4.
2. **Are shifts recurring?** Nothing in the definition says so and "all manual" suggests not, but
   a shift scheduler without repeat is unusual enough to state explicitly. If yes, item 1 grows.
3. **Which day does a crossing shift count to** for the pay period, for "today", and for the day
   grid? Falls directly out of the midnight ruling and has to be answered before the schema.
4. **Does Basic keep the Time Stamp view?** Neither named in the definition nor obviously
   job-layer.

### Native (item 11) — what the decision depends on

Unsized until the Mac, by your call. It resolves to one question: **does Basic include a phone
clock?** The definition says "time clock for pay only" without naming a device.

- **If no** — Basic is web-only at launch, item 11 leaves the critical path entirely, and the
  month estimate stands.
- **If yes** — a Basic-shaped native client is required. iOS and Android both implement the job
  layer today (`timeclock.js:439` records both posting `jobClockIn` by name), so this is not a
  matter of hiding a tab; it is the same shell-versus-substance problem again, on two platforms,
  and it would likely exceed everything above combined.

Worth settling early even though it is sized last, because it is the only item that can change
the answer from "a month" to "a quarter".

---

## Explicitly not in scope

- **Granular permissions (#333)** — unrelated to the job layer; its own decision.
- **Automatic scheduling** — already Business, already correct, not server-enforceable.
- **`ai-schedule` (#336)** — needs its source located first.
- **The nine existing gates** — correct as they stand, restored in `b93db18`.
- **Lane defects #119–#123** — parked in `SCHEDULE_MAP.md` pending the shift type. #119 survives
  the midnight ruling; #121 and #123 are expected to close rather than be re-fixed.
