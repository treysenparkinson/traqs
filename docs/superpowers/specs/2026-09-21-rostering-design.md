# Recurring Weekly Shift Rostering — Design

**Date:** 2026-09-21
**Status:** Design locked. **Not built.** No code written.
**Scope:** Per-person recurring weekly shift patterns, available in both tenant tiers.

Captured from an exploration session so the decisions survive to build time. Every
decision in "Locked decisions" was made explicitly; the consequences noted under
each are recorded so they are not rediscovered as surprises.

---

## 1. The reframe

This is not greenfield. TRAQS already has a weekly shift pattern — it is just
**org-wide and singular**. The feature is "make the weekly pattern per-person,
with the org's as the default."

| Existing | Where | What it is |
|---|---|---|
| `workDays: [1,2,3,4,5]` | `orgSettings` | which weekdays the org works (0=Sun) |
| `workStart` / `workEnd` | `orgSettings` | org shift boundaries, format `"07:00"` |
| `hpd`, `lunch`, `breaks` | `orgSettings` | hours/day, unpaid deductions |
| `holidays` | `orgSettings` | dated exceptions to the pattern |
| `person.cap` | `people.json` | per-person daily hour capacity |
| `person.timeOff[]` | `people.json` | sparse per-person date-range exceptions |

Consequence: the existing working-day helpers are the extension point, not dead
weight to route around — `addWorkingDays` (`src/TRAQS.jsx:523`), `isWorkDay`
(`:524`), `weekdaySegments` (`:525`), `getWorkingDayDuration` (`:540`),
`countWorkingDays` (`:549`).

---

## 2. Locked decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | Granularity | **15 minutes**, format `"HH:MM"` |
| 2 | Override types | **Both** — `off` and `hours` |
| 3 | Who manages exceptions | **Admin only.** No swap requests, no approval flow |
| 4 | Time basis | **Org-local wall clock stored; UTC computed at generation** |
| 5 | Edit model | **Patch / versioned.** Templates carry `validFrom`; an edit creates a new version; the prior version stays authoritative for earlier dates |
| 6 | Weekend / holiday policy | **Respect org `workDays` + `holidays`. No emission on non-work days** |
| 7 | Template ownership | **Person-owned only.** Role-owned deferred |
| 8 | Tier placement | **Basic.** Both tiers get rostering; Business adds jobs/Gantt on top |
| 9 | Tier selection | **At org signup.** New orgs pick Basic or Business during setup; the choice writes `tier` on the org record |
| 10 | Gating style | **Removal, not disablement.** Basic renders no Business-only UI at all — no greyed-out items, no scattered upgrade CTAs |
| 11 | Upgrade entry point | **One button in Settings.** "Upgrade to Business" flips the tier and reveals every Business feature |
| 12 | Roster view granularity | **Basic: week (default) + day. No month.** Business keeps month |

### Deferred (decided to defer, not undecided)

- **Draft vs published rosters.** Not in v1. Noted as expensive to retrofit: it
  changes what "the schedule" means, so every read path grows a which-version
  question. Revisit before staff-visible rosters.
- **Role-owned templates.** Deferred. Forward-compatible: a role-owned template
  is the same row with `roleId` in place of `personId`, so the entity shape does
  not change — only the resolver's lookup.
- **Roster horizon.** Rolling / effectively infinite, since the model is
  rule-based. The UI still needs a defensible answer for "what does week 40 look
  like."
- **Pricing.** Out of scope. The upgrade button flips the tier with no payment
  step, which is deliberate for rollout and must be revisited before pricing
  lands — see §10.6.

---

## 3. Data model

### 3.1 Storage location — and why it is not on the person

An earlier draft put the pattern on `person.schedule`, justified by it being
bounded at 7 entries. **Decision 5 (versioning) invalidates that.** An
append-only chain of template versions grows with every schedule edit, and
`people.json` is read by `requireOrgMember` on *every authenticated request*
(`netlify/functions/_utils/auth.js:253`). A 50-person org changing schedules
quarterly would accumulate hundreds of template versions on the hot path for the
entire API.

Templates therefore live beside exceptions, off `people.json`.

### 3.2 One entity: `orgs/<code>/roster.json`

```
{ id, kind: "template",  personId, validFrom: "2026-10-01",
  week: { 1: { start: "07:00", end: "15:30", lunch: 30 }, ... },
  lastModifiedAt }

{ id, kind: "exception", personId, date: "2026-10-14",
  type: "off" | "hours", start?, end?, lunch?,
  lastModifiedAt }
```

**One entity rather than two**, because the dominant cost is sync registration —
roughly five files per entity per client across web / iOS / macOS. Both kinds are
admin-written, admin-read, behind the same `manageTeam` gate, and delta-sync as
array rows carrying `lastModifiedAt`.

The `kind` discriminator also expresses the one place their policies must differ:
**exceptions prune, templates never do** (templates *are* the history).
`netlify/functions/timeoff-cleanup.js` is the pruning precedent.

Keep it a **flat array of rows with `id`**, not an object keyed by
`personId:date` — the delta-sync machinery (`stampObject`, `changedSince`,
`arrDelta` at `netlify/functions/sync.js:47`) operates on array rows.

### 3.3 Format and validation

- Times are `"HH:MM"` strings, matching `orgSettings.workStart`/`workEnd` on both
  web and iOS (`Models.swift:1216`). Existing defaults (`07:00`/`15:00`) are
  already 15-minute-clean, so **no migration**.
- Validate `/^([01]\d|2[0-3]):(00|15|30|45)$/`; same multiple-of-15 rule for
  `lunch`.
- Minutes-from-midnight integers would be tidier in the abstract; matching the
  format already live in three codebases is worth more.

### 3.4 Two override types cover three intents

| Intent | Encoding |
|---|---|
| Cancel a patterned day | `type: "off"` |
| Change a patterned day's hours | `type: "hours"` + times |
| **Add** a shift on a normally-off day | `type: "hours"` on a day with no `week` entry |

Stated explicitly so no third type gets added.

### 3.5 Admin-only removes a field and two write paths

- No approval flow means exceptions need **no `status`** field. Do not reuse
  `approvalSteps`.
- Gate is `requirePerm(member, "manageTeam")` — already exists in
  `netlify/functions/_utils/can.js`.
- No employee-facing writes means **iOS and macOS are read-only for rostering in
  v1.** A real scope cut on two of three clients, and defensible on its own terms:
  a phone is a poor rostering editor.

### 3.6 Versioning rules

**Templates are append-only. Never mutate a template that has a successor.**
A correction to March's schedule is a new version dated to March, not an edit in
place. Otherwise a typo fix silently rewrites a past quarter's expected hours —
a bug class only discovered during a payroll dispute.

**No generated shifts are persisted.** History is reconstructible from the
version chain: a past date resolves against the template whose `validFrom` was
current then. Materialized shifts stay a disposable cache (see §5).

**No `validTo`** — implied by the next version's `validFrom`. "No longer
rostered" is a version with an empty `week` and a `validFrom` of the departure
date. No new field.

### 3.7 Resolution precedence

```
holiday → PTO → exception → template(validFrom) → org default
```

Per **decision 6**, emission is additionally gated on `orgSettings.workDays`:
a day absent from `workDays` emits no shift even if the person's `week` has it.

---

## 4. Time, timezone, DST

### 4.1 `settings.timeZone` is a hard prerequisite

`settings.timeZone` is currently **optional and frequently unset**, with
deliberately asymmetric fallbacks:

- Client with no org zone → falls back to the **device** timezone
  (`src/localDay.js:70`, `resolveTimeZone`)
- Server with no org zone → falls back to the **UTC** slice
  (`netlify/functions/timeclock.js:59`, `orgLocalDay`)

That asymmetry is safe for what it does today — bucketing an instant that
*already exists* into a day column. It is **not** safe for generation, which runs
the other direction: wall clock → instant. A `07:00` pattern generated
server-side for an org with no `timeZone` becomes 07:00 **UTC** = midnight local
at UTC-7. Not a rounding error; a 7-hour error that would drive missed-shift
alerts at midnight.

`localDay.js`'s header documents the same bug's earlier incarnation: reading the
day off a UTC timestamp *"was the shop's day only for a shop on UTC. At UTC-6, an
18:23–21:53 shift was filed on the following day."* Generation is that bug with a
larger blast radius.

The zone is read from `settings.json` → `timeZone`
(`netlify/functions/timeclock.js:335`, memoized per-request).

**Therefore: making `settings.timeZone` required is step 0, a prerequisite build,
not a rostering task.**

### 4.2 Overnight shifts

`end <= start` means the shift crosses midnight (e.g. `22:00 → 06:00`). It
belongs to its **start** date, matching how timeclock already stamps a shift:
`date: localDayOf(clockIn)` (`netlify/functions/timeclock.js:518`). Consistency
with existing behaviour beats elegance, and it means a Friday exception governs
the Friday-night shift.

### 4.3 DST edges

- **Spring forward** deletes 02:00–03:00, so a `02:15` start is an invalid instant
  on that one date. **Clamp forward** to `03:00` rather than reject, or overnight
  shifts break once a year.
- **Fall back** makes `01:30` occur twice. **Take the first.**
- Expected-hours math must use **elapsed UTC**, not wall clock, or one shift a
  year reports an hour off.

Both only bite overnight shifts.

---

## 5. Generation — two paths, one persists nothing

### 5.1 Display generation — ephemeral, client-side

Resolve `template(validFrom) + exceptions − PTO − holidays − non-workDays`
across the visible window, in org-local time, and render. Nothing stored, nothing
to invalidate, no staleness. Covers the roster view, the template summary, and
PTO costing.

### 5.2 Detection generation — server-side, scheduled

A purely ephemeral resolver cannot fire "you missed your shift," because when
nobody is looking, nothing runs. That path needs a scheduled function that
materializes *expected* shifts as UTC instants and compares them against
`timeclock.json` actuals.

Infrastructure exists. `netlify.toml` declares `backup-daily`, `forgot-clockout`
and `timeoff-cleanup`, all `schedule = "0 5 * * *"`, with the comment
*"5am UTC = midnight EST."* Two consequences:

1. That comment is a hard-coded single-timezone assumption. Fine for daily
   sweeps; **wrong for shift detection**, which needs to know whether it is
   currently past someone's 15:30. Detection should run **hourly** and filter
   per-org by that org's local time — not join the 5am UTC batch.
2. `forgot-clockout.js`'s flat `STALE_MS = 12h` (`:18`) becomes a *fallback*
   rather than the rule: with a pattern it can nudge at 16:00 for a 15:30 shift.
   Keep the 12h path for orgs with no template.

**Materialize only a narrow rolling window** — today and tomorrow, regenerated
each run. Patterns stay the source of truth; materialized rows are a disposable
cache, so nothing needs backfilling when a template version lands.

### 5.3 The resolver is one function, deliberately duplicated

This codebase has an established idiom. `src/localDay.js` says it *"mirrors
`orgLocalDay` in netlify/functions/timeclock.js"* and notes the *"same
deliberate-duplication arrangement as statsMath.js ↔ StatsMath.swift; the
functions bundle does not share modules with the app bundle."*

The shift resolver becomes the fourth member of that family, with the same mirror
comment. Do not fight the bundling; follow the documented pattern. Its bugs land
in payroll, so it is built and tested first (step 1) and ported, never
reimplemented per client.

---

## 6. UI shape

### 6.1 Template editor — "what is this person's normal week?"

Lives in the person edit modal. Seven rows, one per weekday: toggle, start, end,
lunch minutes. A summary line reading `Mon–Fri · 7:00–3:30 · 40h/wk` does most of
the communicating. `validFrom` is surfaced as "effective from," since an edit
creates a version rather than overwriting.

**Two affordances carry the feature** — without them it is technically complete
and practically hated:
- **copy-to-all-days** (nobody wants to type `07:00` five times)
- **copy-from-another-person** (rosters cluster into a handful of shapes; this is
  what makes person-owned templates tolerable per decision 7)

**Trap: person editing exists twice** in `src/TRAQS.jsx` —
`renderPersonEditModal` (`:19389`) and a second copy around `:29919`. Both need
the editor or they drift.

### 6.2 Roster week view — "who is on this week?"

**The component largely exists.** `renderTeam` (`src/TRAQS.jsx:14744`) already
renders people × days (grid at `:15708`) with PTO as a hatched overlay,
non-workdays shaded from `orgSettings.workDays`, and today accented. Its `bars`
array is assembled from `type:"pto"` plus three `type:"task"` pushes.

**The roster is a third bar type in that same pipeline** — `type:"shift"`
alongside `pto` and `task`. No extraction, no parallel component.

- **15-minute granularity means label, not draw-to-scale.** 96 slots/day needs
  ~96 units of width. In a week view, render the cell as `7:00–3:30` text and
  carry the pattern-vs-override distinction by weight or a corner marker.
  Proportional rendering belongs in a day view, if one ever exists.
- Cells must distinguish **inherited pattern** from **explicit override**, or
  nobody can tell what is actually scheduled.
- Interactions (web only): click a cell → override that date; drag across cells →
  apply to a range. PTO renders as it already does and visibly wins.
- **View granularity is tier-gated (decision 12).** `renderTeam` already has a
  day/week/month toggle at `src/TRAQS.jsx:15149` (it sets `tMode` and adjusts
  `tStart`/`tEnd`). Basic filters `month` out of that array, leaving day + week
  with **week as the default**; Business keeps all three. The other two toggles
  — `renderGantt` `:11466` (day/week/month) and `renderSplitGantt` `:11815`
  (week/month) — need no filtering, because both surfaces are Business-only and
  disappear wholesale in Basic.

### 6.3 Time input

15-minute granularity rules out free-text:
- **Web:** stepper (±15) with typed entry that snaps. Not a 96-item `<select>`.
- **iOS:** wants `UIDatePicker`'s `minuteInterval = 15`, which SwiftUI's
  `DatePicker` does not expose — so a thin `UIViewRepresentable`. Still the system
  control, which is the right instinct; do not hand-build a wheel.

### 6.4 Mobile is a viewer

Admin-only (decision 3) means the iOS/macOS roster answers "what am I on this
week" and "who is on Saturday." No cell editing, no drag. Much smaller than the
web component, and it is the whole mobile scope.

---

## 7. Tier fit

Per decision 8: **Basic** = rostering + timeclock/PTO/hours/CSV.
**Business** = adds job/project/Gantt scheduling. Both share the same rostering
feature.

### 7.1 Tier selection at signup

New orgs pick Basic or Business during setup (decision 9). The choice writes
`tier` on the org record (`orgs/<code>/config.json`, created by `POST /org`,
authored in `src/App.jsx:588`). That field gates three things:

| Gated | Basic | Business |
|---|---|---|
| **Which features render** | No job/project/Gantt UI at all | Everything |
| **Default schedule view** | Week, with day available; no month | Week, with day and month |
| **Which onboarding flow runs** | Basic setup suite | Business setup suite |

`tier` is server-authored and never client-writable. Absent on an existing
record means **`business`**, which grandfathers every org created before the
field existed; absent at *creation* should be a hard 400 rather than a default,
since a defaulted tier is how Business gets given away silently.

That grandfathering default is also what keeps §7.4 true: rostering can ship
before the tier system exists, because an org with no `tier` behaves exactly as
today.

### 7.2 Gating is removal, not disablement

Decision 10, and it is a real architectural constraint rather than a styling
preference. Basic renders **no Business-only UI at all**: no greyed-out nav
items, no disabled buttons, no upgrade CTAs scattered through the product. A
Basic org should look like an app built for it, not a Business org with pieces
crossed out.

Two consequences worth stating, because they are easy to get wrong:

1. **Gating happens at the nav/feature level, not per control.** One filter per
   nav array — desktop `views` (`src/TRAQS.jsx:~9864`) and mobile (`:22012`) —
   rather than `disabled` props sprinkled through the UI. Cheaper and much harder
   to leave half-done.
2. **A Business-only panel nested inside a Basic-visible page must be *omitted*,
   not left to render empty.** This is the sharp edge. `renderEmployees`
   (`:17936`) derives its Schedule / This week / Assigned Queue / Current Job /
   Current Task / Current Work panels from `tasks`, and `Performance` from job
   efficiency and utilization. In a Basic org those render empty today — an
   employee page reading "None scheduled". Under decision 10 that is not
   acceptable output: the job-fed panels must be absent in Basic, and the
   schedule panels re-sourced from the roster. Same applies to the month option
   in `renderTeam`'s toggle (§6.2) — filtered out of the array, not shown
   inactive.

### 7.3 The upgrade path

One button, in Settings: **"Upgrade to Business."** Pressing it flips `tier` and
reveals every Business feature (decision 11). No other upgrade surface exists
anywhere in the product.

This supersedes the earlier "option 3" shape (in-app *request* + operator flips
the field). **The difference is deliberate but load-bearing:** with pricing out
of scope (§2, Deferred), a self-serve flip means Business is free to anyone who
presses the button. That is acceptable — arguably desirable — during rollout and
trials, and unacceptable the day pricing exists. Recorded as §10.6 so it is a
scheduled decision rather than a discovered hole.

**Downgrade** keeps its earlier semantics: data is retained untouched, UI is
hidden, writes are rejected. Nothing is destroyed, and re-upgrading restores
everything — so an accidental downgrade is never a support incident about lost
job history.

### 7.4 Rostering stays tier-independent

Since both tiers get rostering, it needs no `requireFeature` call and no upgrade
prompt. The only place this plan reads `tier` is the month filter in §6.2, and
the grandfathering default in §7.1 makes that safe before the tier system
lands: with `tier` absent, month stays available and nothing changes.

The tier system itself — signup picker, onboarding suites, the Settings button,
server-side feature enforcement — is a **separate project with its own build
order**. It is described here only where it touches the roster.

### 7.5 `renderTeam`'s bar composition is the tier boundary

Today a Basic org opening the Team page gets a timeline whose three `task`
pushes contribute nothing, so it renders PTO against empty space. Rostering is
what fills it.

| Tier | `bars` contains |
|---|---|
| Basic | `pto` + **`shift`** |
| Business | `pto` + **`shift`** + `task` |

Same component, same rendering pipeline; tier changes only which bar types are
contributed. This makes the Business-only job × shift conflict check a natural
addition to the same pipeline (step 9) rather than a separate feature.

---

## 8. Fit with existing timeclock and PTO

**PTO gets more accurate as a side effect.** Today PTO means "out," costed
against org-wide `hpd`. With per-person templates, a Tuesday PTO day costs that
person's *actual* Tuesday shift — 10 hours if that is a long day, not a flat 8.
A correctness improvement to reporting that already ships, independent of
rostering.

**Conflict machinery comes free.** `src/TRAQS.jsx:8496` already pushes PTO
overlaps into `showOverlapIfAny`. Worth adding the inverse warning: approving PTO
on a day someone is the only person rostered.

**Timeclock: a comparison layer, never a gate.** A template supplies the
expectation that `timeclock.json` rows (`{personId, clockIn, clockOut, hours,
date, source, jobRefs}`) currently have nothing to compare against. That unlocks
late/early flags, missed-shift detection, unscheduled-shift detection, and a
variance column in the payroll CSV (`exportCSV`, `src/TRAQS.jsx:19172`).

**The tempting mistake to avoid:** do not let the roster constrain clock-in.
`canClockIn` in `_utils/can.js` carries a pointed comment — clock-*out* is never
blocked so nobody is stranded mid-shift. Same spirit. Someone who shows up
unrostered must still be able to clock in; the roster records that it was
unexpected, it does not stop it.

---

## 9. Sub-build order

| # | Step | Notes |
|---|---|---|
| **0** | `settings.timeZone` becomes required — backfill, settings UI, drop the silent server fallback | Prerequisite (§4.1). Generation is wrong by hours without it. Ships alone, valuable alone. |
| **1** | Shared resolver, pure + tested — `validFrom` selection, exceptions, PTO, holidays, `workDays` gating, DST edges, overnight | Its bugs land in payroll. Mirrors the `localDay.js` / `statsMath.js` duplication idiom; write the mirror comment. |
| **2** | `roster.json` entity — endpoint (mirrors `timeoff.js`), `sync.js` entry, Ably + silent-push registration, exception pruning | Verifiable by curl, no UI. One entity = one round of three-app wiring. |
| **3** | Web template editor — `validFrom`-aware, both person-edit surfaces (`:19389`, `~:29919`), copy-to-all-days + copy-from-person | First visible value; admins can author before any roster view exists. |
| **4** | Web roster — add `type:"shift"` to `renderTeam`'s `bars` pipeline; read-only, then cell overrides | Reuses the existing PTO/task rendering path. Where the `workDays` audit lands. |
| **5** | Timeclock comparison — late / missed / unscheduled flags, variance column in `exportCSV` | Pure read-side on the resolver. Most of the payroll payoff. |
| **6** | Server detection pass — hourly, filtered per org-local time; `forgot-clockout` gets real shift ends instead of `STALE_MS` | Last of the core work: only piece needing UTC materialization, and the only one that can push wrong alerts to everyone at 6am. |
| **7** | iOS read-only roster | Small, given admin-only. Watch the payload-decode-per-cell trap. |
| **8** | macOS read-only roster | Third port of the same views. |
| **9** | *(Business only)* job-assignment × shift conflict detection, folded into `showOverlapIfAny` | Natural once shifts are a bar type. The only step that touches the tier boundary. |

Shape: **correctness infrastructure → storage → authoring → viewing → derived
insight → automation → ports → tier-specific polish.** Steps 0–1 are unglamorous
and non-negotiable; 5 is where it starts paying; 6 is the one not to rush; 9 is
the only step that cares about tiers.

---

## 10. Known consequences and risks

**10.1 Decision 6 couples rostering to job scheduling.**
Gating emission on `orgSettings.workDays` means a shop that rosters Saturdays
must add Saturday to `workDays` — which also changes **job-duration math org-wide**
for Business orgs, since `workDays` drives `addWorkingDays`, `weekdaySegments`,
`getWorkingDayDuration` and `countWorkingDays` (`src/TRAQS.jsx:523–553`).
Rostering and job scheduling become coupled through that one array. Accepted
deliberately; recorded so it is not rediscovered as a bug.

**10.2 `orgSettings.workDays` has ~40 usages — the sleeper cost in step 4.**
The helpers take it as an org-wide array. Each call site needs a judgment call:
does *this* one mean "the org's week" or "this person's week"? Most stay
org-wide. Auditing which do not is the largest unknown in the estimate, and it
looks like a rename while not being one.

**10.3 Two person-edit surfaces and two nav arrays.**
Person editing: `:19389` and `~:29919`. Nav: desktop `views` (`~:9864`) and
mobile (`:22012`). Miss one of each pair and the surfaces drift — this has
happened before in this file.

**10.4 iOS payload decoding.**
A roster grid that decodes row payloads per cell is the shape that cost
808 ms/redraw on the Jobs grid. Decode once, not per cell. Also: SwiftData
generic `#Predicate` compiles and then fatals at fetch.

**10.5 `requireOrgMember` memoizes for 5 minutes** (`_utils/auth.js:67`,
`MEMBER_TTL_MS`). Not a rostering problem directly, but any permission or tier
change affecting roster writes takes up to 5 minutes to bite server-side while
the UI flips instantly.

---

**10.6 The upgrade button gives Business away until pricing exists.**
Decision 11 flips `tier` on press with no payment step. Deliberate for rollout;
it must become gated — payment, or a reversion to the request-and-operator-flip
shape — before pricing launches. Flagged here because nothing in the code will
fail when that day arrives.

**10.7 Removal-not-disablement makes empty panels a bug, not a cosmetic issue.**
Decision 10 means every Business-fed panel on a Basic-visible page must be
conditionally omitted. The known instance is `renderEmployees` (§7.2): six
panels plus `Performance` currently render empty in a Basic org. Auditing for
others is part of the tier project, not this one, but the roster work is what
makes the schedule panels fillable.

**10.8 Two nav arrays and three view toggles.**
Nav filtering must cover both desktop (`~:9864`) and mobile (`:22012`). The month
filter applies only to `renderTeam` (`:15149`); the `renderGantt` (`:11466`) and
`renderSplitGantt` (`:11815`) toggles live on Business-only surfaces and need no
change. Miss the mobile nav and Basic users reach Jobs on their phone.

---

## 11. File reference

**Backend**
- `netlify/functions/_utils/auth.js:253` — `requireOrgMember`; `:67` TTL
- `netlify/functions/_utils/can.js` — `requirePerm`, `canClockIn`, `PERM_KEYS`
- `netlify/functions/sync.js:34–43` — entity `Promise.all`; `:47` `arrDelta`;
  `:55–60` per-person filter precedent
- `netlify/functions/timeoff.js` — endpoint template to mirror
- `netlify/functions/timeoff-cleanup.js` — pruning precedent
- `netlify/functions/timeclock.js:59` `orgLocalDay`; `:335` zone read; `:518`
  `date: localDayOf(clockIn)`
- `netlify/functions/forgot-clockout.js:18` — `STALE_MS = 12h`
- `netlify.toml` — scheduled-function declarations

**Web**
- `src/localDay.js:70` — `resolveTimeZone`; header documents the UTC-day bug
- `src/TRAQS.jsx:523–553` — working-day helpers
- `src/TRAQS.jsx:8496` — PTO conflict push → `showOverlapIfAny`
- `src/TRAQS.jsx:14744` — `renderTeam`; `:15708` people × days grid
- `src/TRAQS.jsx:19172` — `exportCSV` (payroll)
- `src/TRAQS.jsx:19389`, `~:29919` — person edit surfaces
- `src/TRAQS.jsx:~9864`, `:22012` — desktop and mobile nav arrays

**iOS** (`TRAQS Scheduling/TRAQS Scheduling/`)
- `Models/Models.swift:1216–1218` — `workStart`, `workDays`
- `Models/SyncModels.swift` — synced-model shape (`id`, `lastModifiedAt`,
  `deletedAt`, `payload`)
- `Services/LocalCache.swift:14` schema array, `:210` delete-all
- `Services/SyncService.swift:92` — `applyBatch`
- `Services/RealtimeService.swift:27` — `entities` array
- `Services/APIService.swift:810`, `:858` — org config call and response

**macOS:** `TRAQS MacBook Native/` — third port of the same views.
