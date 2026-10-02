# Step 0: `settings.timeZone` becomes required

**Scope document, 2026-10-02. Nothing built.** Requested before any roster work begins, because
the rostering design calls generation without it wrong by hours rather than minutes.

This is the rostering design's step 0 (§4.1). It **ships alone and is valuable alone** — every
existing day-bucketing path gets more correct — and nothing in the roster can be trusted before
it lands.

---

## Why it is a prerequisite, not a cleanup

Today's two fallbacks are **deliberately asymmetric**, and both are documented as such:

| Side | No org zone → | Source |
|---|---|---|
| Client | the **device** timezone | `src/localDay.js:70`, `resolveTimeZone` |
| Server | the **UTC** slice | `netlify/functions/timeclock.js:59`, `orgLocalDay` |

`localDay.js` explains the asymmetry in its own words: the device guess is *"strictly better than
UTC for every shop that is not on UTC. The SERVER cannot make that guess — it has no device —
which is why the stored `date` falls back to UTC instead."*

**That is safe for what it does today and unsafe for what the roster needs.** Bucketing runs
instant → day: an instant that already exists is filed under a calendar date, and a wrong zone
mis-files it by one day at the edges. Generation runs the other direction, **wall clock →
instant**: a `07:00` pattern generated server-side for an org with no `timeZone` becomes 07:00
**UTC**, which is **midnight local at UTC-7**. Not an edge case and not a rounding error — a
seven-hour error that would drive missed-shift alerts in the middle of the night.

The same bug class already bit this codebase once, in the other direction. `localDay.js`'s header
records it: reading the day off a UTC timestamp *"was the shop's day only for a shop on UTC. At
UTC-6, an 18:23–21:53 shift was filed on the following day"* — "yesterday" reported 8.7h of a
12.2h day, and the missing 3.5h appeared on a day the worker had not started. Generation is that
bug with a larger blast radius, because it invents instants rather than mis-labelling existing
ones.

---

## Current state — measured, not assumed

**The backfill is effectively nil.** Every org holding data already has a zone:

| Org | `settings.timeZone` | timeclock rows |
|---|---|---|
| `MTX2026TRAQS` — Matrix Systems | `America/Denver` | **177** |
| `MAT.CEPE.3A96` | `America/Denver` | 0 |
| `MAT.JD3Y.FBQN` | `America/Denver` | 0 |
| `TES.4865.54VU` | `America/Denver` | 0 |
| `TRAQSBASIC` | `America/Denver` | 0 |
| `MATRIX` | **absent** | 0 |
| `MTX2025TRAQS` | **absent** | 0 |

**5 of 7 set; the two without are empty stubs with no settings worth preserving and no rows to
re-file.** The design's "backfill" dimension is a one-line script or two manual writes.

**The UI already exists on both ends**, which also cuts the estimate:

- **Signup collects it** — `SignupSteps.jsx:222` renders a "Country / time zone" field, defaulted
  from the device at `:18`, and shows it back on the review step (`:316`).
- **Settings can edit it** — `TRAQS.jsx:26326` drafts it, `:26395` saves it, and `:26855–26857`
  builds the picker from a US shortlist plus `Intl.supportedValuesOf("timeZone")`.

**So what is actually missing is enforcement, not capability.** `org.js:163` writes the zone only
*"when the wizard supplied something"* — `if (s.timeZone) seedSettings.timeZone = …` — so an org
created by any path that omits it is created without one, silently, and the server then falls back
to UTC forever.

---

## What step 0 is, in three parts

### 1. Require it at creation — the actual fix
`org.js` validates name / domain / adminEmail server-side already (`:59–65`); the zone check goes
beside them. **A missing zone at creation becomes a hard 400, not a default.** The design makes
the same argument about the `tier` field and it applies identically here: a silently-defaulted
value is how the wrong one gets written and never noticed.

Both creation paths need it — the signup wizard and any direct `POST /org`. Validate against
`Intl.supportedValuesOf("timeZone")` rather than a shape check, or `"Mountain"` is accepted and
fails at the first generation.

### 2. Backfill — two stub orgs
`MATRIX` and `MTX2025TRAQS`. No timeclock rows, so nothing re-files and no history changes. The
only real decision is whether to write a zone or delete the stubs.

### 3. Remove the silent server fallback — the risky part
`orgLocalDay` (`timeclock.js:59`) currently cannot fail. Once the zone is guaranteed, the UTC
fallback should become an explicit error rather than a quiet wrong answer.

**This is the part to be careful with.** `timeZone` is read in 66 places across 13 files —
`timeclock.js`, `tasks.js`, `timeoff.js`, `forgot-clockout.js`, `_utils/after-hours.js`,
`org.js`, and six client modules. Turning a silent fallback into a throw changes behaviour on
every one of those paths. Recommended shape: **log-first**, the same rollout every other
enforcement in this codebase has had — record when the fallback fires, confirm the log is empty
against real traffic, then make it throw.

---

## Size

| Part | Days |
|---|---|
| Require + validate at creation, both paths | 1 |
| Backfill two stub orgs | ~0 |
| Fallback: log mode, then enforce after a quiet period | 1–2 |
| **Total** | **2–3 days** |

Lower than the design's framing implies, for a reason it could not have known: both UI surfaces
already exist and the data is already 5/7 populated. The design treated step 0 as "backfill,
settings UI, drop the fallback" — two of those three are already done.

---

## Open questions

1. **Delete the two stub orgs or backfill them?** `MATRIX` and `MTX2025TRAQS` have no name, no
   data and no timeclock rows. Deleting is cleaner than carrying them through every future
   migration.
2. **Does `tier` get the same treatment in the same pass?** The design says a missing `tier` at
   creation "should be a hard 400 rather than a default, since a defaulted tier is how Business
   gets given away silently" (§7.1) — the identical argument, in the identical function, about
   the identical kind of field. Doing both at once is one change to `org.js`'s validation block
   instead of two.
3. **How long does the fallback run in log mode** before it throws? There is no traffic signal
   here yet; a week of real use is the obvious answer but it depends on when the roster work
   starts.

---

## What this does NOT cover

DST handling (§4.3 — clamp forward in spring, take the first in fall, compute expected hours in
elapsed UTC) is **step 1's** problem, not step 0's. It belongs to the resolver and only bites
overnight shifts. Step 0 only guarantees that a zone exists to resolve against.
