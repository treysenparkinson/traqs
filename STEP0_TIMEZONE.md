# Step 0: `settings.timeZone` becomes required

> **BUILT 2026-10-02.** Scoped at 2–3 days, accepted, implemented in the same session. What
> shipped is below under **What was built**; the scoping that follows it is kept as the record of
> why. `scripts/step0-timezone-test.mjs` guards it — 21 assertions, 5 mutation-proved.
>
> **This is the only thing built. The roster is not started, by instruction** — the scope is
> settled and written before anyone writes a resolver.

**Scope document, 2026-10-02.** Requested before any roster work begins, because the rostering
design calls generation without it wrong by hours rather than minutes.

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

## What was built

**`netlify/functions/org.js` — both fields required at creation.**
`settings.timeZone` must be present and must be a zone the **ICU database** knows — validated by
constructing an `Intl.DateTimeFormat` against it, not by shape, because a shape check accepts
`"Mountain"` and fails at the first generation. `tier` must be present and one of
`basic` | `business`. Both return 400. `settings.json` is now written unconditionally (the old
write was conditional on the object being non-empty, which it no longer can be), and
**`billing.json` is written explicitly from the requested tier** rather than left to be inferred.

**`src/orgSignup.js` — the wizard now sends the tier it collects.** It did not. There is a whole
tier step (`STEPS` id `"tier"`) with its own validation, and `buildOrgPayload` dropped the answer,
so the choice never reached the server and `billing.js`'s absent-means-basic default decided
instead. Harmless while Business is refused client-side — and exactly the silent default this
pass exists to remove.

**`netlify/functions/timeclock.js` — the fallback is visible, not removed.**
`TZ_FALLBACK_MODE` defaults to `log`. Absent and invalid zones log under **different reasons**
(`[tz-fallback] missing` / `[tz-fallback] invalid`), because they are different failures: one is
an org nobody configured, the other is a value something wrote that `org.js` now refuses. In log
mode the row is still returned — a clock write that 500s because an org never set a zone is worse
than a day-edge error. `TZ_FALLBACK_MODE=enforce` makes them throw.

**One assertion was deliberately reversed**, in `scripts/signup-test.mjs`. It asserted the payload
carries *no* tier, with sound reasoning: the tier lives in `billing.json` where absence means
Basic, so sending it would be a second home for one fact, and the only value that could reach the
POST was the one the server would assume anyway. Both halves were true; the conclusion expires the
moment Business becomes selectable. The old comment is preserved in place with why it no longer
holds.

### Not adopted, deliberately

The design (§7.1) has an **absent `tier` mean `business`**, to grandfather orgs created before the
field existed. **That is wrong for this codebase.** `billing.js` documents the opposite — *"An org
with no billing.json is Basic. Absence means never provisioned, which is exactly Basic"* — and
**six of the seven live orgs have no `billing.json`**. Adopting the design's default would hand
all six Business. Absence keeps meaning Basic for existing records; the new check only makes the
choice explicit for new ones.

## Open questions

1. ~~**Delete the two stub orgs or backfill them?**~~ **DELETED 2026-10-02.** Each held exactly one
   object — `settings.json`, 419B and 504B, last written April 2026 — and **no `config.json`**,
   which is what `org.js` resolves an org code against. They were never reachable orgs: they are
   orphaned settings files that a prefix listing makes look like orgs. Both carried `weekends:
   false`, a field the current schema replaced with `workDays`, so they predate the present model.
   No people, tasks, timeclock or index entries. Bucket versioning is on, so both are delete
   markers and remain recoverable.
2. ~~**Does `tier` get the same treatment in the same pass?**~~ **Ruled yes, 2026-10-02.** Identical
   argument, identical function, identical kind of field — one change to `org.js`'s validation
   block. Built.
3. **How long does the fallback run in log mode** before it throws?

   **A SILENT LOG HERE IS A RESULT, NOT AN ABSENCE OF ONE.** Read this before concluding that
   waiting taught nothing.

   With the two stubs deleted, **all five remaining orgs have `settings.timeZone` set**, and
   `org.js` now refuses to create one without it. So there is no longer any org that *can* reach
   the fallback. An empty `[tz-fallback]` log is therefore the **positive confirmation** that the
   population is clean and `TZ_FALLBACK_MODE=enforce` is safe to flip — not a signal that nothing
   was learned and not a reason to keep waiting indefinitely.

   What would make the log non-empty is exactly what it is there to catch: a path that creates or
   mutates an org's settings **without** going through `org.js`'s validation — a script, a manual
   S3 write, a restored backup, or a future endpoint. Those are the cases worth one real week of
   traffic before flipping.

   Concretely: a week of normal use, grep the function logs for `[tz-fallback]`, and flip to
   `enforce` on a clean result. If it fires, the line names the org's zone value and whether the
   reason was `missing` or `invalid`, which is enough to find the writer.

---

## What this does NOT cover

DST handling (§4.3 — clamp forward in spring, take the first in fall, compute expected hours in
elapsed UTC) is **step 1's** problem, not step 0's. It belongs to the resolver and only bites
overnight shifts. Step 0 only guarantees that a zone exists to resolve against.
