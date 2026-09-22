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
| 12 | Roster view granularity | **Basic: week (default) + day. No month timeline.** Business keeps month. Refined by decision 20 — Basic's third slot is the shift Calendar, not the month timeline (§12.4) |
| 13–20 | Product-wide tier split | Recorded in **§12.1**, decided 2026-09-22: roster stays on Schedule; Basic Analytics cut to three elements; Time Clock splits at the job clock; Approval Templates to Business and `PERM_KEYS` trimmed to four; Admin board loses the job bucket; `undoHistory` filtered out; global search keeps people only; Basic gains a shift calendar |

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
  `tStart`/`tEnd`). Basic filters the month
  *timeline* out of that array, leaving day + week with **week as the default**;
  Business keeps all three. Decision 20 then puts a shift **Calendar** in that
  third slot for Basic — a month grid rather than a month timeline, which is
  legible at month scale for the reason the timeline is not. See §12.4.
- The other two toggles
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
   schedule panels re-sourced from the roster. §11.3 inventories the affected
   panels. Same applies to the month option
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
| **4b** | Web shift calendar — extract the shared month grid from the two existing copies (`:14080`, `:17777`), then build the shift cell body: org-wide avatars, per-person shift times, click-to-drill day detail | Decision 20, §12.4. Reads the same resolver as step 4, so it is cell rendering rather than new logic. Slots into `renderTeam`'s toggle as Basic's third view. |
| **5** | Timeclock comparison — late / missed / unscheduled flags, variance column in `exportCSV` | Pure read-side on the resolver. Most of the payroll payoff. |
| **6** | Server detection pass — hourly, filtered per org-local time; `forgot-clockout` gets real shift ends instead of `STALE_MS` | Last of the core work: only piece needing UTC materialization, and the only one that can push wrong alerts to everyone at 6am. |
| **7** | iOS read-only roster | Small, given admin-only. Watch the payload-decode-per-cell trap. |
| **8** | macOS read-only roster | Third port of the same views. |
| **9** | *(Business only)* job-assignment × shift conflict detection, folded into `showOverlapIfAny` | Natural once shifts are a bar type. The only step that touches the tier boundary. |

Shape: **correctness infrastructure → storage → authoring → viewing → derived
insight → automation → ports → tier-specific polish.** Steps 0–1 are unglamorous
and non-negotiable; 5 is where it starts paying; 6 is the one not to rush; 9 is
the only step that cares about tiers.

§11 audits what already exists for Basic — read it before starting, since
three of Basic's five scoped capabilities need no build at all. §12 sets the
product-wide tier split; 4b and 9 are the steps it adds or constrains.

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

## 11. Current state — Basic tier audit

Audited 2026-09-21 against Basic as scoped: manual shift entry, clock in/out,
PTO/UTO, employee stats page (on-time metrics + basic schedule info), HR payroll
export. **Business was not audited** — it is the current app as-is.

The headline: **most of Basic already exists.** The work is concentrated in
rostering plus four smaller items, two of which do not depend on rostering at
all.

### 11.1 Already covered — nothing to build

**Manual shift entry — complete.** `netlify/functions/timeclock.js` exposes a
full admin timesheet surface: `adminClockIn`, `adminClockOut`, `adminEditEntry`,
`adminEditActiveClockIn`, `adminAddEvent`, `adminEditEvent`, `adminDeleteEvent`,
`adminDeleteEntry`, `adminReopenEntry`, `adminLunchStart/End`,
`adminBreakStart/End`, plus `confirmTimesheet` / `unconfirmTimesheet`. An admin
can create, edit, delete, reopen and confirm shifts and their lunch/break events.

**Clock in/out — complete.** Employee punches with lunch/break tracking,
`source:"kiosk"`, `activeClockIn` on the person record, the `canClockIn` gate in
`_utils/can.js` (with its deliberate never-block-clock-out rule), iOS
`TimeClockView.swift`, the `forgot-clockout.js` daily sweep, and an org-wide live
table (Name / Punches / Hours / Status, `src/TRAQS.jsx:~20980`).
`jobClockIn` / `jobClockOut` are separate job-clock actions — correctly
Business-only.

**PTO/UTO workflow — complete.** Both types, full request lifecycle in
`timeoff.js` (`approve` / `deny` / `cancel` / `reopen` / `edit`; statuses
pending / approved / denied / cancelled), the `approveTimeOff` permission with
audience selection via `personCan`, `person.timeOff[]`, calendar hatching
(UTO amber / PTO green), overlap warnings (`src/TRAQS.jsx:8496` →
`showOverlapIfAny`), `timeoff-cleanup.js` pruning, and an "Upcoming PTO" panel.

**Pay-period reporting — substantially complete.** `buildHoursReport` /
`openHoursExport` (`src/TRAQS.jsx:6255`) already produces a pay-period report
including **lunch, break, PTO, UTO and OT**. Supporting machinery exists too:
`payDates`, `payPeriodHourCap`, `person.payType` (`"hourly"|"salary"`) with
hourly-only payroll filtering (`isHourly`, `:6156`), and timesheet confirmation.

### 11.2 Gap — on-time metrics do not exist, and are blocked on rostering

`ontime` appears 16 times in `src/TRAQS.jsx` but is **entirely job-delivery
health**: `getHealth()` (`:701`), `HEALTH_DOT` / `HEALTH_COLOR` (`:715`–`717`),
"Jobs on time %" (`:14063`, `:17339`, `:17671`). There is no clock-in-versus-
scheduled-start comparison anywhere, for the simple reason that **there is no
scheduled start**.

Basic's headline metric therefore requires this plan. It is step 5 of §9, and
steps 0–4 gate it. The word exists in the codebase; the metric does not.

### 11.3 Gap — the employee page exists, but half its panels are job-fed

`renderEmployees` (`:17936`) is real and well-built — "one person's complete
picture" — with Status, Performance, Schedule, This week, Available, Assigned
Queue, Time History, PTO / Attendance, Upcoming PTO, Reviews / Notes.

Its own header comment states the sourcing:

> *"Everything here is derived from data the app already holds: `tasks` for the
> schedule/queue, `timeclock` for payroll punches, `productionHours` for
> job-clock sessions… Anything the data model has no field for (reviews,
> certifications, sick balance) renders an explicit empty state rather than a
> fabricated number."*

So in a Basic org: **Schedule**, **This week**, **Assigned Queue**,
**Current Job**, **Current Task** and **Current Work** all render empty — an
employee page reading *"None scheduled"*. **Performance** is efficiency +
utilization, both job-derived, so also empty.

Under decision 10 (§7.2) empty is not acceptable output: the job-fed panels must
be **omitted** in Basic, and the schedule panels **re-sourced** from the roster.
The page does not need building; roughly half of it needs re-wiring.

### 11.4 Gap — the payroll export is PDF-only

The complete data — lunch, break, PTO, UTO, OT — exists in `buildHoursReport`,
but renders to **PDF**. The CSV path (`exportCSV`, `:19172`) is thin:
`Date, Person, Clock In, Clock Out, Hours`, and it filters out event rows
(`!e.eventType`), so no lunch, PTO, UTO or OT.

Payroll systems ingest CSV. This is a **CSV renderer over an existing report**,
not a new report — considerably smaller than it first appears, and it ships
independently of rostering.

### 11.5 Gap — no PTO balances or accrual

Verified absent: no accrual, allowance, entitlement or balance fields anywhere.
(`ALLOWANCE` at `:570` is break policy; the `accru` hits at `:5622` / `:17356`
are lunch banking and job-clock time.) The `renderEmployees` comment names
"sick balance" among the things *the data model has no field for*.

You can request and approve time off but cannot answer "how many days does Maria
have left" — usually table stakes for an HR-facing product. Also independent of
rostering.

### 11.6 Scoping question — HR data-model fields

| Field | Present |
|---|---|
| `payType` (hourly / salary) | yes |
| Pay **rate** / amount | no — exports are hours-only, no gross pay |
| Employee / payroll ID | no — nothing to map into a payroll system |
| Hire date | no |
| Certifications, sick balance, reviews | no — already explicit empty states by design |

Whether these matter turns on what "HR payroll export" means: an **hours
handoff** (the payroll provider holds rates — the current design works) or a
**payroll document with dollars** (needs rate + employee ID). This is the
difference between a small CSV task and a data-model addition, and it is
unresolved.

### 11.7 Summary

| Work | Size | Blocked by |
|---|---|---|
| Rostering | Large | — (this document) |
| Re-source / omit employee-page panels | Medium | rostering |
| On-time metrics | Small | rostering |
| CSV renderer for the existing hours report | Small | — |
| PTO balances / accrual | Medium | — (if in scope) |

Clock in/out, manual shift administration and the PTO/UTO workflow need nothing.
Two items ship today without rostering: the CSV renderer and PTO balances.
Everything else waits on the roster — which confirms §9's ordering from a
different direction.

---

## 12. Product-wide tier split

§7 settled how the `tier` field works and what it gates around *rostering*. This
section takes the whole product, audited feature by feature against
`2026-09-22-feature-inventory.md`. The first pass found six mis-sorts; all six
were resolved on 2026-09-22 and are recorded here as decisions rather than
questions.

### 12.1 Decisions

| # | Decision | Date |
|---|---|---|
| 13 | The roster lives on Schedule / `renderTeam` in Basic. Only `renderGantt`, `renderSplitGantt` and `task` bars are Business. | 2026-09-22 |
| 14 | Basic Analytics is Hours Logged + Pay Hours + Export Hours. Efficiency and production math are cut, not adapted. Attendance/PTO analytics deferred until launch feedback. | 2026-09-22 |
| 15 | Time Clock splits at the job clock: personal clock/lunch/break is Basic; job clock, Working On, start-job picker, Requests tab, `adminJobHours` and the `productionHours` entity are Business. | 2026-09-22 |
| 16 | Approval Queue Templates is Business. `PERM_KEYS` is trimmed to the four that apply in Basic. | 2026-09-22 |
| 17 | The Admin live board shows clock-in status only in Basic — no `job` bucket, no End Job action. | 2026-09-22 |
| 18 | `undoHistory` is filtered out of Basic. Extending the history stack to roster writes is deferred. | 2026-09-22 |
| 19 | Global search stays in Basic with job routing disabled. | 2026-09-22 |
| 20 | Basic gains a **shift calendar** — a month grid of shifts across the org, filterable by person. See §12.4. | 2026-09-22 |

### 12.2 Settled without change

| Item | Why it holds |
|---|---|
| **Jobs → Business** | Whole page, whole entity tree (job → panel → op), plus the export designer, job templates, engineering sign-off and approval chains. Nothing in Basic reads it. |
| **Clients → Business** | Nothing Basic-side consumes `clients`. One loose end in §12.6. |
| **Gantt → Business** | `renderGantt` (`:11063`) and `renderSplitGantt` (`:11764`) are job-only and disappear wholesale, exactly as §6.2 assumed. |
| **Auth / Sync / Kiosk → both** | Org code, Auth0, domain gate, roster gate, PIN, delta sync, Ably, IndexedDB rehydrate, tombstones. No job coupling anywhere. |

**Notifications are the cleanest seam in the product.** All six types in
`notify.js` — `new_job`, `assigned`, `step`, `ready`, `finish_request`,
`completion_resolved` — are job events. The Basic channels each live in a
*different function*: `messages.js:329`, `timeoff.js:44`, and
`forgot-clockout.js` via `sendVisiblePush`. So Basic is "everything except
`notify.js`," enforceable at the function boundary with no per-call filtering and
no decomposition. Worth protecting — do not let a PTO or clock notification get
added to `notify.js` for convenience.

### 12.3 The six corrections, resolved

#### A. Schedule is not Business. It is the roster. → decision 13

The first pass proposed moving Schedule wholesale to Business, which contradicted
§6.2 and §7.5: `renderTeam` (`:14744`) **is** the roster week view, with `shift`
joining `pto` and `task` as a third bar type in the same pipeline. Resolved in
favour of the existing design.

| Surface | Tier |
|---|---|
| `renderTeam` people × days grid | **Both** — Basic's is the roster |
| `renderTeam` `pto` + `shift` bars | Both |
| `renderTeam` `task` bars, drag-to-move, cascade push, pull-back, clock cascade, optimize, overlap check, availability check, dependency arrows | Business |
| `renderGantt`, `renderSplitGantt` | Business |

#### B. Basic Analytics: cut the math, do not adapt it. → decision 14

`efficiencyPct({ prod, working })` (`src/statsMath.js:220`) divides production
hours by working hours, and `prod` comes from `productionHours` — job-clock
sessions. With no jobs, `prod` is always 0, so efficiency renders **0%**: a false
statement rather than a missing one. The same module feeds the Employees page
Performance panel via `payProdByDay` (`:148`), so the defect appears twice.

Decided: **cut it in Basic rather than adapt it.** No zero, no "not applicable"
placeholder, no reworked denominator — the card and the panel are absent, per
§7.2. That keeps `statsMath.js` a Business-only module and avoids inventing a
Basic efficiency metric nobody has asked for.

Basic Analytics is therefore three elements: **Hours Logged, Pay Hours, Export
Hours.** Attendance and PTO analytics are **deferred until launch feedback** —
they are a new build (none of it exists today) and the on-time metric they would
most want is itself blocked on rostering per §11.2. Shipping a thin, correct
Analytics page beats shipping a speculative one.

#### C. Time Clock splits at the job clock. → decision 15

The page is the largest mixed surface in the product. Business-side pieces:

- Job clock: `jobClockIn` / `jobClockOut` / `jobPause` / `jobResume`
- The searchable start-job picker (`renderStartJobPicker`, `:20220`) and its
  Your Jobs / Upcoming Jobs / Other Jobs sections
- "Working On" and the job-clock elapsed display
- The **Requests / Finish Requests tab**, declared twice — `:20704` and `:21331`
- `adminJobHoursAction`, `adminEndJobClock`
- The `productionHours` entity in its entirety
- The clock-out guard ("Log out of your job before clocking out"), which becomes
  unreachable and should be removed in Basic rather than left as dead code

Basic keeps punches, lunch, break, the full admin timesheet suite, confirmation,
Past Logs, pay periods, PIN and pay type — all of which per §11.1 need nothing
built.

#### D. Settings: two sections move. → decision 16

- **Approval Queue Templates → Business entirely.** Approval chains only attach
  to panels.
- **Worker Permissions → trimmed to four.** Basic shows `manageTeam`,
  `orgSettings`, `approveTimeOff` and — pending F — nothing else. The five
  job/client toggles (`editJobs`, `moveJobs`, `reassign`, `manageClients`,
  `approveCompletions`) are omitted, not disabled.

The other six sections (General, Org General, Departments, Schedule Preferences,
Time Clock, Customization) are Basic-safe as they stand. Schedule Preferences is a
**rostering prerequisite**, not a job setting: working days, work hours and
holidays all feed the resolver.

#### E. Admin live board: clock-in status only. → decision 17

There is no admin *settings* page — `renderAdmin` (`:12163`) is the live status
board. Its job coupling is two things: the `job` bucket in `PERSON_STATUS_META`,
which `personStatus` (`:484`) only ever returns when `activeJobClock` is set, and
the **End job** force-action.

Basic shows four buckets — Clocked in / Lunch / Break / Off — and keeps End break.
Grouping (Live / By dept / Today) is unaffected.

#### F. Undo: filter the toggle. → decision 18

`setTasks` is the only state setter wrapped by the history stack (`:4822`);
`setPeople` (`:4835`) deliberately is not. In a Basic org the stack never receives
a frame, so Ctrl+Z does nothing and `undoHistory` gates nothing.

Decided: **filter `undoHistory` out of Basic**, leaving three toggles (D above).
Extending history to roster writes is **deferred** — it is more work than it
looks, because roster overrides persist server-side per §3 rather than living in
client state the way `tasks` does, so it needs a different mechanism rather than a
wider wrapper. Recorded as a known absence: a Basic admin who mis-drags a shift
re-drags it.

Consequence worth naming: the Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y key handler
(`:4863`) must also be inert in Basic, not merely unbound from a button.

### 12.4 New in Basic: the shift calendar → decision 20

A month grid of shifts across the org, filterable to one person. It complements
the week roster rather than duplicating it: the week view answers "what is this
person's pattern," the calendar answers "what does the month look like."

**This is not the Business month view.** `renderGantt`'s month mode is a job
timeline. This is shift-focused, reads from the roster resolver, and is a much
simpler component.

#### It resolves a conflict with decision 12

§6.2 has Basic filtering `month` out of `renderTeam`'s day/week/month toggle
(`:15149`), on the grounds that 30 columns of 15-minute-granularity shift data is
unreadable. **That reasoning still holds for the timeline**, and the calendar does
not challenge it — a calendar cell is a box with text in it, not a proportional
bar, which is exactly why it works at month scale where the timeline does not.

So decision 12 stands, refined: Basic's toggle is **Day / Week / Calendar** with
week as the default, not Day / Week. Same array-filter mechanic §7.2 asks for —
one entry swapped, not a nav item added.

**Open question:** whether Business gets the calendar as a fourth toggle entry.
Recommendation is yes — "Business is a superset of Basic" is a rule worth not
breaking on its first test, and a shift calendar is no less useful to an org that
also runs jobs. That makes Business's toggle Day / Week / Month / Calendar.

#### Interaction model — recommendation

Not read-only, and not inline-edit either:

- **Unfiltered**, a day cell shows *who is on* — a count plus avatars or initials.
  Shift times do not fit and should not be attempted.
- **Filtered to one person**, a day cell shows that person's shift time, which is
  one short string and fits comfortably. This is the mode that makes the calendar
  worth building.
- **Clicking a day drills into it** — a day detail listing each person and their
  hours, from which an override can be applied. Editing therefore stays where the
  time label already fits, consistent with §6.2's "label, not draw-to-scale" and
  with the week view's click-a-cell-to-override interaction.
- PTO renders as it does elsewhere and visibly wins, per §6.2.
- Per §6.4 mobile is a viewer: the drill-down renders, the override does not.

#### Build it in-house, and extract while doing it

**No calendar library.** The dependency list carries no calendar today, and a
month grid is about fifteen lines of date arithmetic — `leadBlanks`,
`daysInMonth`, a 7-column grid. A library would also have to be fought into the
`T.*` theme tokens, the custom-theme system and the liquid background, which is
more work than the grid it replaces.

That arithmetic is **already written twice**: the Dashboard month calendar
(`:14080`) and `renderMobileCal` (`:17777`). Both are single-dot-per-day
densities, so neither cell body is reusable, but the geometry is identical and a
third copy is the point at which it should be extracted into one shared grid
component. `renderMobileCal` is also the closest structural match to what is
wanted here — grid, month nav, selected-day detail list below — so it is the one
to model on.

Both existing copies are job-fed (`activeJobs`, `allItems`) and so are Business;
the extraction is shared geometry with three different cell bodies, not shared
data.

### 12.5 Components needing decomposition

The §7.2 sharp edge: a Business-only element nested inside a Basic-visible
surface must be *omitted*, not left to render empty. Updated for decisions 13–20.

| # | Component | Decomposition | Decision |
|---|---|---|---|
| 1 | `renderTeam` bars (`:14744`) | Basic contributes `pto` + `shift`; Business adds `task`. Drag/cascade/optimize/availability behaviours are Business. | 13, §7.5 |
| 2 | `renderTeam` view toggle (`:15149`) | Basic: Day / Week / **Calendar**, week default. Business: Day / Week / Month / Calendar. | 12, 20 |
| 3 | Month grid geometry (`:14080`, `:17777`) | Extract the shared grid from the two existing copies; three cell bodies (dashboard dots, mobile job dots, shift calendar). | 20 |
| 4 | `renderEmployees` (`:17936`) | Six job-fed panels omitted; schedule panels re-sourced from the roster. | §11.3 |
| 5 | `statsMath.js` (`:148`, `:220`) | **Becomes Business-only.** Not adapted for Basic — the Analytics card and the Employees Performance panel are both absent. | 14 |
| 6 | `DASH_STAT_KEYS` (module scope) | Filter to `hours` + `clocked`. Leaves a six-slot rotation showing two; roster-fed refills are deferred with the rest of §12.8. | 14 |
| 7 | `PERSON_STATUS_META` / `personStatus` (`:484`) | Drop the `job` bucket in Basic. Three call sites — Dashboard "Team right now", the Admin board, schedule clock pills — one definition. | 17 |
| 8 | Admin board actions (`:12163`) | Omit End job; keep End break. | 17 |
| 9 | Time Clock tab arrays (`:20703`, `:21331`) | Two independent declarations, both carrying `finishRequests`. Filter both or they drift. | 15 |
| 10 | Time Clock job surfaces | Job clock controls, Working On, start-job picker, `productionHours`. Remove the clock-out guard rather than leaving it unreachable. | 15 |
| 11 | Messages thread derivation (`:22235`) | DM and group are Basic; job/panel/op threads must not appear in the list. | — |
| 12 | In-thread approval cards | On **web** already two separate blocks — Completion Request (`:22590`, Business) and Time Off Request (`:22710`, Basic) — so a straight omission. On **iOS** they share `DecisionActions.swift`, which does need splitting. The ports disagree; the web shape is the right one. | — |
| 13 | `ensureCompletionGroup` (`:10163`) | Must not run in Basic, or every Basic org grows a permanent empty group. | — |
| 14 | Permissions settings page | Tier-aware `PERM_KEYS`: four in Basic, nine in Business. | 16, 18 |
| 15 | Undo stack (`:4822`) and key handler (`:4863`) | Both inert in Basic; `undoHistory` omitted from the permissions list. | 18 |
| 16 | Mobile global search (`:21982`) | Person and client hits kept, job hits omitted, person routing repointed. See §12.6. | 19 |

### 12.6 Search → decision 19

Global search stays in Basic with job routing disabled. Three things to know
before building it:

1. **It is mobile-only.** It lives inside `renderMobileApp` at `:21982`. Desktop
   has per-page search boxes (jobs, clients, schedule, the start-job picker) and
   no global one. "Search in Basic" therefore means the mobile control.
2. **It searches people, clients and jobs.** Job results are omitted in Basic.
   Client results are a loose end — clients are Business (§12.2), so those results
   go too, leaving Basic with people only.
3. **A person result navigates to `switchView("schedule")`.** Under decision 13
   that destination exists in Basic and is the roster, so the routing happens to
   remain correct — but it now means something different, and the calendar
   (decision 20) may be the better landing place.

No PTO search exists anywhere; that half is deferred with §12.8.

### 12.7 Time Off is not a surface

It has no nav entry on any web view. The functionality is distributed across the
Time Clock page (requests, approvals), `renderTeam` (PTO/UTO hatching),
`renderEmployees` (PTO / Attendance, Upcoming PTO) and Messages (Time Off Request
cards). iOS is the exception — it has a dedicated `TimeOffView.swift`.

Not a mis-sort, but a naming hazard: treating it as a page to gate will produce a
ticket nobody can close. There are four host surfaces, three of which appear
elsewhere in the split.

### 12.8 Deferred and new-build work

Nothing here ships by filtering.

| Work | Status | Blocked by |
|---|---|---|
| Shift calendar | **In scope** (decision 20) | rostering |
| On-time metrics | In scope, §11.2 | rostering |
| CSV payroll renderer | In scope, §11.4 | — |
| Employee-page re-sourcing | In scope, §11.3 | rostering |
| Attendance / PTO analytics | **Deferred** to launch feedback (decision 14) | on-time metric |
| PTO search | **Deferred** (§12.6) | — |
| Roster-fed dashboard stats | **Deferred** (§12.5 #6) | rostering |
| Undo for roster writes | **Deferred** (decision 18) | server-side override model, §3 |
| PTO balances / accrual | Unresolved scope, §11.5 | — |

### 12.9 The split, in full

**Basic**
- Dashboard — 2 of 6 rotating stats (`hours`, `clocked`), Team right now (4 buckets), My clock, Today strip, month calendar without job spans, Messages panel
- **Schedule — the people × days grid as the roster week view**, Day / Week / Calendar with week default, `pto` + `shift` bars
- **Shift calendar** — month grid, org-wide or filtered to one person, click-to-drill
- Employees — job-fed panels omitted, schedule panels roster-sourced, no Performance panel
- Time Clock — punches, lunch, break, admin timesheet suite, confirmation, Past Logs, pay periods, PIN, pay type
- Time off — request, approve, deny, cancel, reopen, edit, calendar hatching, overlap warnings
- Analytics — Hours Logged, Pay Hours, Export Hours
- Messages — DMs and groups, Time Off Request cards
- Admin board — 4 clock-in status buckets, End break, no End job
- Settings — 6 of 8 sections; Worker Permissions filtered to `manageTeam`, `orgSettings`, `approveTimeOff`
- Notifications — `messages.js`, `timeoff.js`, `forgot-clockout.js`
- Auth, Sync, Push, Kiosk — unchanged
- Search — people only, mobile only
- **Rostering** — new, and per §7.4 present in both tiers

**Business** — all of the above, plus Jobs, `renderGantt` and `renderSplitGantt`,
`task` bars and every scheduling behaviour acting on them, Clients, the job clock
and its Time Clock surfaces, `productionHours`, `statsMath.js` and job-side
Analytics, `notify.js`, job and client search, Approval Queue Templates, the five
job/client permission toggles, `undoHistory`, and the Month timeline view.

### 12.10 One consequence worth recording

§7.2 says gating is removal, not disablement, and §12.5 lists sixteen components
that have to be decomposed to honour that. That is the real cost of decision 10,
and it is concentrated in four files: `src/TRAQS.jsx`, `src/statsMath.js`, and the
two native ports that duplicate the same views. A `disabled`-prop approach would
be perhaps a tenth of the work and would produce the greyed-out-shell product
decision 10 exists to prevent. The trade is still worth making; it should just be
made with the sixteen in view rather than discovered one panel at a time.

---

## 13. File reference

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
