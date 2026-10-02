# Basic: three sources reconciled

**Written 2026-10-02. Nothing here is resolved — the conflicts are laid out for a ruling, not
settled.** Where the three disagree, each row says which is newer, which is more considered, and
what you would be overturning.

## The three sources

| # | Source | Date | Status |
|---|---|---|---|
| **A** | `origin/docs/rostering-design` — `2026-09-21-rostering-design.md` (1,235 lines) + `2026-09-22-feature-inventory.md` (420 lines) | 2026-09-21/22 | 23 locked decisions. **Never merged to master.** Read in full for this document. |
| **B** | What is implemented on master, web + native | today | Audited below. |
| **C** | `BASIC_TIER.md` + `TIERS.md` + `src/tiers.js` | 2026-10-02 | Written **without knowledge of A**. Newest, least examined. |

**A is the most considered source by a wide margin.** It reasons from the existing code with line
references throughout, costs its own build order, audits the current state independently, and
records its own risks (§10) including the ones that look like renames and are not. C's value is
narrower: the measured current state, the sizing frame, Capacitor, and the gates.

---

## What actually exists on master

### Nothing of the roster exists. At all.

`roster.json`, `RosterTemplate`, `RosterException`, `kind: "template"` — **zero occurrences in
`src/`, `netlify/` and the iOS tree.** A's step 0 is also not done: `settings.timeZone` is still
optional (`org.js:163` writes it only "when the wizard supplied something"), which A calls a hard
prerequisite because generation without it is wrong by hours, not minutes.

### Web — the nine gates, and a shell that is further along than C credited

Restored in `b93db18`: the `switchView` guard, `views[]` filter, mobile tab bar and More sheet,
client quick-search, `openNew`, `openJobDetailOrEdit`, approval templates, the Job Clock card,
plus the context-menu ternary and four liquid sites.

A's §11.1 independently confirms C's "the shell already exists", from the other direction, and
goes further — these need **nothing built**:

- **Manual timesheet administration is complete**: `adminClockIn`, `adminClockOut`,
  `adminEditEntry`, `adminAddEvent`, `adminDeleteEntry`, `adminReopenEntry`, `adminLunchStart/End`,
  `adminBreakStart/End`, `confirmTimesheet`/`unconfirmTimesheet`.
- **Clock in/out is complete**, including the kiosk path and `forgot-clockout`.
- **PTO/UTO is complete** — full lifecycle, hatching, overlap warnings, pruning.
- **Pay-period reporting is substantially complete** — `buildHoursReport` already includes lunch,
  break, PTO, UTO and OT. It renders to **PDF only**; the CSV path is thin.

**One correction to A worth noting:** its §11.1 calls manual shift entry "complete". That is the
*timesheet* — entering time already worked. Scheduling a future shift does not exist. The two are
different, and the phrase could mislead a reader into thinking Basic's headline capability is
built.

### iOS — Basic partly exists, but built on the thing the new definition removes

`e8bd343 feat(ios): Basic tier jobs are shifts, not tracked work` **is on master.**

- Tier plumbing in `AppState.swift` (`billingTier`, `isBusinessTier`, cached per org).
- **13 real gate sites across 4 view files**: `MainTabView` (tab bar composition, labels, icons —
  6 sites), `TasksView` (3, including `let basic = !appState.isBusinessTier`), `JobDetailPopup`
  (3 — job number and PO number hidden in Basic), `HomeView` (1).
- `JobShifts.swift` + `JobShiftsTests.swift`, plus `EmployeesView.swift` and `OrgSignup.swift`.

**But `JobShifts.all(in jobs:)` reads the jobs array.** Its own header: *"a job there is a shift
— this turns the jobs array into those shifts."* So iOS's Basic is **the flat-job model presented
as shifts**, which is exactly what the 2026-10-02 definition abolishes ("no jobs, panels, ops …
in any form"). It is not a head start on the roster; it is a well-built implementation of the
Basic that the new definition replaces.

That is the single most important fact in this document for sizing.

---

## The five flagged conflicts

### 1. `roster.json` rule-based templates vs `shifts.json` concrete rows

| | A — rule-based | C — concrete rows |
|---|---|---|
| Stores | `roster.json`, `kind: "template" \| "exception"`; a weekly pattern per person, versioned by `validFrom` | `shifts.json`, one dated row per shift |
| Shifts are | **generated, never persisted** (§5.1 display, §5.2 detection) | the stored thing |
| Needs | a shared resolver, a timezone prerequisite, DST handling, an hourly server detection pass | a CRUD endpoint |

**Newer: C. More considered: A, decisively.** A argues the model from a constraint C never
considered — templates cannot live on `person.schedule` because `people.json` is read by
`requireOrgMember` on *every authenticated request* (`_utils/auth.js:253`), so a versioned chain
would put schedule history on the hot path of the whole API. It also derives append-only
versioning from a real failure mode: editing a template in place silently rewrites a past
quarter's expected hours, "a bug class only discovered during a payroll dispute".

**Overturning A means:** giving up recurring as a primitive, versioned history, on-time metrics,
missed-shift detection and accurate PTO costing — all of which fall out of the resolver. **Overturning
C means:** accepting a timezone prerequisite, a shared resolver mirrored across three codebases,
and a scheduled detection pass before Basic's schedule draws anything.

**This is the root decision and it also sets the schedule** — see the re-size.

### 2. Recurring as the primitive vs post-launch

**A makes the weekly template the primitive**; one-offs are `type: "hours"` exceptions on a day
with no `week` entry (§3.4). **C defers recurring entirely** and only asks that the schema not
foreclose it.

**Newer: C. More considered: A.** These are not two schedules for the same feature — they are two
different products. In A, "what is this person's normal week?" is the thing you author, and the
calendar is a view of it. In C you author individual shifts and a pattern is something you might
add later.

**Overturning A means** a shop with a stable weekly crew types every shift by hand until the
post-launch item lands. A's §6.1 names this directly: without copy-to-all-days and
copy-from-another-person "it is technically complete and practically hated".

### 3. Three-element Basic Analytics

**A, decision 14:** Basic Analytics = **Hours Logged, Pay Hours, Export Hours.** It cuts the
efficiency math rather than adapting it, with a reason: `efficiencyPct({prod, working})`
(`statsMath.js:220`) divides production hours by working hours, `prod` comes from
`productionHours`, and with no jobs `prod` is always 0 — so it renders **0%**, "a false statement
rather than a missing one". The same module feeds the Employees Performance panel, so the defect
appears twice. `statsMath.js` becomes a Business-only module.

**C:** Analytics is **Business**, and Basic has the Employees page in that nav slot.

**Newer: C. More considered: A.** A's position also matches your own principle better than C's
does: Basic is sold a pay clock, and "how many hours did we pay for" is the pay clock's own
report, not a job feature. C put Analytics wholly in Business because the *code* gates the whole
page, and the code gates the whole page because the page is job-fed.

**Overturning A means** a Basic customer cannot see their own hours totals anywhere except the
PDF export. **Overturning C means** the Analytics nav entry exists in Basic with three elements,
so the Employees/Analytics "slot swap" in `tiers.js` and `TIERS.md` is wrong and both need
rewriting.

### 4. `PERM_KEYS` as a prior ruling on #333

**A, decision 16:** Basic shows **four** permission toggles — `manageTeam`, `orgSettings`,
`approveTimeOff` (and `undoHistory` until decision 18 removes it, leaving three). The five
job/client toggles (`editJobs`, `moveJobs`, `reassign`, `manageClients`, `approveCompletions`)
are **omitted, not disabled**.

**This campaign has been treating #333 as unresolved.** It is not — A ruled on it 2026-09-22, and
the ruling is better than either option #333 has been carrying. #333 framed the choice as "gate
`adminPerms` on tier (a takeaway) or give it away deliberately". A's answer is neither: **the nine
keys stay enforced for everyone, and Basic is shown only the four that mean anything in a product
with no jobs.** Nothing is taken away, because the five hidden toggles govern features Basic does
not have.

**Newer: C's framing. More considered: A.** C's TIERS.md says granular permissions are "claimed
by neither tier … off the table until it is either gated or deliberately given to everyone" —
which A had already answered in a third way C did not consider.

**Overturning A means** keeping #333 open. There is little reason to.

### 5. `notify.js` as a tier seam

**A, §12.2:** all six push types in `notify.js` — `new_job`, `assigned`, `step`, `ready`,
`finish_request`, `completion_resolved` — are **job events**. Basic's three notification channels
each live in a *different function*: `messages.js:329`, `timeoff.js:44`, and `forgot-clockout.js`
via `sendVisiblePush`. So **Basic is "everything except `notify.js`"**, enforceable at the
function boundary with no per-call filtering and no decomposition.

**C never considered notifications at all.** No conflict — a gap, and a clean one.

A attaches a standing instruction worth keeping: **do not let a PTO or clock notification get
added to `notify.js` for convenience**, or the seam is lost.

---

## Other conflicts, not flagged but material

| Topic | A | C | Note |
|---|---|---|---|
| **The Basic schedule view** | `renderTeam` (`:14744`) **already** renders people × days with PTO, non-workday shading and today accent. The roster is a **third bar type** (`type:"shift"`) in the same pipeline — "no extraction, no parallel component" (§6.2, §7.5) | **A separate Basic schedule view**, ruled 2026-10-02 | **Direct conflict with a ruling you already gave.** A's version is cheaper and reuses tested rendering; C's gives "no hatching, no cursor" by construction. A did not consider the by-construction argument; C did not know `renderTeam` already did most of it. |
| **Component decomposition** | **16 components** enumerated (§12.5) | ~6 items | C's list is a subset. A's includes `PERSON_STATUS_META`, the undo key handler, `ensureCompletionGroup`, messages thread derivation, the two Time Clock tab arrays, in-thread approval cards |
| **`DASH_STAT_KEYS`** | Filter to `hours` + `clocked` (§12.5 #6) | "tier-aware", 0.5d | Same finding, independently. A reached it first |
| **`workDays`** | **~40 usages; "the sleeper cost" and "the largest unknown in the estimate"** (§10.2) | not considered | Each call site needs a judgment: org-wide week, or this person's? |
| **Timezone** | **Step 0, non-negotiable prerequisite** (§4.1) | not considered | Still optional on master |
| **Two person-edit surfaces** | `:19389` and `~:29919` — "miss one and they drift" | not considered | |
| **Month grid geometry** | Already written **twice** (`:14080`, `:17777`); extract on the third | not considered | |
| **Upgrade removes a view** | Basic-only shift calendar means upgrading **takes something away** (§10.9) | "Basic is not a subset" via the Employees page | Both found non-subsetting, by different routes |
| **Membership / invites** | Decisions 21–23, §13, costed | not considered | A calls it a separate project |

---

## Re-size

**C's ~5–9 weeks is wrong, and the reason is not that parts already exist — it is that C costed
the wrong feature.** C costed "make a shift object and turn job rendering off". A shows Basic's
headline capability is a ten-step build with a timezone prerequisite, a resolver mirrored across
three codebases, three-client sync wiring, and sixteen component decompositions.

**The two models cost very differently, so the §1 ruling sets the schedule:**

### If you overturn A and take concrete shifts (C's model)

| Work | Days |
|---|---|
| Shift entity + endpoint + 3-app sync wiring | 5–8 |
| Basic schedule view (separate, per your ruling) | 5–10 |
| Job-time rendering off + lanes | 4–7 |
| The 16 decompositions (A §12.5), minus what C already counted | 8–14 |
| `workDays` audit (A §10.2) | 3–6 |
| Timezone prerequisite | 2–4 |
| Employees page re-source + CSV renderer + `DASH_STAT_KEYS` | 6–10 |
| Capacitor phone clock | 5–10 |
| Server enforcement (#125) | 3–5 |
| **Total** | **~41–74d ≈ 8–15 weeks** |

Recurring deferred. On-time metrics not possible (A §11.2: they need a scheduled start).

### If you keep A and take the rule-based roster

Add to the above: the shared resolver + tests (3–5d), generation and DST (2–4d), the server
detection pass (3–5d), the template editor across two surfaces with copy affordances (4–6d), and
the shift calendar with grid extraction (4–6d) — and subtract the separate schedule view, since
A reuses `renderTeam` (−3 to −6d).

**Total ≈ 54–94d ≈ 11–19 weeks (3–5 months)**, and it delivers recurring, on-time metrics,
missed-shift detection and accurate PTO costing, which the other path cannot.

### What is NOT in either number

`§13` membership and invitations (A estimates medium across six items), PTO balances/accrual
(A §11.5, unresolved scope), and the HR data-model question (A §11.6 — whether "payroll export"
means an hours handoff or a document with dollars; the latter needs pay rate and employee ID,
neither of which exists).

**Confidence: lower than the numbers suggest.** A names `workDays` as the largest unknown in its
own estimate and I have not audited those ~40 sites. Treat the ranges as a decision aid, not a
plan.

---

## Lesson: three retractions, one cause

| # | Claim | Reality | What I searched |
|---|---|---|---|
| 1 | "`ai-schedule` has no source in this repository" (#336) | `netlify/edge-functions/ai-schedule.ts`, tracked, on master — **and documented as an Edge Function in `2026-09-22-feature-inventory.md:42`** | `netlify/functions/` only |
| 2 | "Neither native client has any concept of billing tier"; 70 files / 32,190 lines | iOS is tier-aware with 13 gate sites; 130 files / 45,721 lines | a checkout sitting on `fix/code-audit-2026-09-10`, never checked |
| 3 | "`JobsScheduler.swift`/`JobShifts.swift` do not exist" | Both on master, with tests | same wrong branch |
| 4 | BASIC_TIER.md written as greenfield scoping | A 1,235-line design with 23 locked decisions existed | `src/`, `netlify/` — never `docs/`, never other branches |

**The cause is the same every time: I searched the first place the thing should be, did not find
it, and reported absence as a finding.** Presence needs one hit; absence needs the search space
exhausted. I treated them as the same kind of claim.

### The check

**Before writing "X does not exist", run all four. Any one of them would have caught every
failure above.**

1. **`git ls-files | grep -i <name>`** and **`git log --all --oneline -- '*<name>*'`** — by the
   thing's *name*, across all branches, not by the directory it should live in.
2. **`git rev-parse --abbrev-ref HEAD`** in any checkout before measuring it. A worktree and its
   parent are never on the same branch, and this repo has four worktrees and ten branches.
3. **`grep -ril <name> .` from the repo root**, not from the subdirectory I expect.
4. **`git branch -a` and look in `docs/`** before writing any design or scoping document. Prior
   art on an unmerged branch is invisible to every other check.

**And the framing that makes it stick:** an absence claim is a claim about the whole repository,
so it needs repository-wide evidence. If I have only looked in one directory, the honest sentence
is *"it is not in `netlify/functions/`"* — which is true, useful, and would not have produced any
of the four retractions above.
