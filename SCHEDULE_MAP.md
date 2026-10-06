# SCHEDULE_MAP — the schedule and gantt as they exist today

Survey only. Nothing was changed and nothing is proposed.

- **Snapshot:** `master` @ `0fbc639` (2026-09-29).
- **Line numbers:** `J:` is `src/TRAQS.jsx`, `S:` is `src/statsMath.js`, and `fn/` is `netlify/functions/`. iOS paths are relative to `TRAQS Scheduling/TRAQS Scheduling/`.
- **How the survey was done:** six read-only passes over the code (data, geometry, render, interaction, invariants/tests, native). Where passes disagreed, I checked the code myself (§G.1).
- **Legend:**
  - Everything is **read** in code unless marked **[inferred]**.
  - **✔** means I checked the claim directly against the code.
  - **The code wins over `DYNAMIC_SCHEDULE_HANDOFF.md`** wherever they disagree (§G.2).

---

## RULES FOR USING THIS FILE

These are not lessons. A lesson is something to have learned; these are things to DO,
and they are at the top because they govern every entry below.

### R1. THE ENTRY IS WRITTEN WHEN THE FINDING IS MADE — in the same turn, before the fix
is proposed, and before anyone asks for one.

Not when the fix lands. Not when the commit is written. A finding that lives only in a chat
transcript is a finding that will be re-found, and the survey's entire value is that the next
pass starts from it instead of from nothing.

**THIS HAS NOW COST THIS CAMPAIGN TWICE.**

  - **#348–#357 were lost** because they were added on a machine that never pushed. Ten
    entries, gone, re-derived later at full cost.
  - **#396, #397, #399, #400 and #401 were never written at all** (#406). The Jobs-surface
    sweep REPORTED nine findings in chat and LOGGED FOUR. It was caught only because
    `grep -c "^400\. "` returned 0 while trying to correct #400's title — LESSONS #3 (a zero
    result is when to check the sweep) applied to the log rather than to the code.

A SURVEY THAT REPORTS NINE AND LOGS FOUR HAS DONE LESS THAN HALF ITS JOB. The four that
were written were the four that got fixed, which is exactly backwards: the ones worth
writing down hardest are the ones NOT being fixed today, because those are the ones nobody
will remember.

In practice:

  - number findings as they are made, from the current highest, and write them before
    proposing anything;
  - write the ones marked `[inferred]`, `[latent]` and `[not investigated]` TOO — those are
    the ones a later pass most needs, and several have been struck after measurement,
    which is itself the record working;
  - carry the measurement INTO the entry. "Zero ops with a crew of 2+" is what makes #396
    latent rather than live, and without it the next reader re-measures;
  - and after writing, CHECK THE FILE — `grep -c "^<n>\. "` for each number reported. The
    write is not the record; the file is.

### R2. AN ENTRY THAT TURNS OUT TO BE WRONG IS CORRECTED IN PLACE, SAYING SO PLAINLY.

Not rewritten to look like it always said the right thing, and not quietly deleted. #377,
#378, #379, #389 and #70 all carry their own retractions, and the retraction is usually the
more useful half — it records the measurement that disproved the claim, which is what stops
the next reader making it again.

---
---

## 0. Surfaces: what is live and what is dead

| Surface | Function | Status |
|---|---|---|
| **Schedule, week/month** | `renderTeam` J:16379–19576, grid branch `tMode !== "day"` J:17302–19503 | **Live.** The main schedule. |
| **Schedule, day view** | same function, `tMode === "day"` J:17064–17300 | **Live, admins only.** The view picker is `isAdmin`-gated (J:16920–17006). It is a second, independent renderer with its own geometry. |
| **Job gantt** | `renderGantt` J:12451–13166 | **Dead ✔.** It mounts only on `taskSubView === "gantt"` (J:15087). The only values ever set are `"list"` (J:4765, J:5381). Its drag, resize, split, reassign and day-mode code is all unreachable. |
| **Split gantt** | `renderSplitGantt` J:13167–~13335 | **Live, read-only, Business only.** Jobs page, `showGanttSplit && !isMobile` (J:15065, toggle J:9109). It supports only expand, mode and zoom. |
| **Schedule "subtask" rows** | J:17342–17400 | **Dead ✔.** `rowList` only ever holds `group` and `person` rows (J:16757–16775). |
| **Mobile web** | `renderMobileApp` J:24105 | No schedule grid. `renderMobileTeam` (J:24295) is unreachable (J:24502). No touch handlers anywhere. |
| **iOS schedule** | `Views/GanttView.swift` | Live, **Business only** (MainTabView.swift:146–150, 237–241). This is a different product: one person's own hour lane, Day or Week, read-only, with its own packer. |
| **macOS schedule** | `NativeShell.swift:250–264` | **Not implemented ✔.** It shows a "Not ported yet" placeholder; only the Jobs page is native. The Mac user's schedule is the web app inside `WebViewHost`. |

Everything below describes the web week/month schedule unless it names another surface.

---

## D. DATA

### D.1 Where the data lives

| S3 `orgs/{code}/…` | Read / write | Also written by | Sync |
|---|---|---|---|
| `tasks.json` (job → panel → op tree) | GET/POST `fn/tasks.js:22,39`. POST replaces the **whole array**. | `fn/timeclock.js`: jobClockIn status :1072–1094, jobClockOut loggedHours :1177–1197, pay clock-out credits :548–560 / :1623–1635 / :1784–1797, finishRequest :1886–1914, creditPanel :409–417 | `/sync` yes. Ably channel `tasks`. |
| `people.json` | `fn/people.js` GET/POST/PATCH/DELETE | every timeclock action, `fn/timeoff.js:429–432` (plain `writeJson`), `fn/forgot-clockout.js:98` | `/sync` yes (PIN stripped). Ably `people`. |
| `productionhours.json` (`js_` job-clock sessions) | GET `timeclock?dataset=productionhours` (`fn/timeclock.js:435`; legacy alias `jobsessions`) | jobClockOut :1140–1164, adminJobHours :1313–1428 | Yes. **Non-admins receive only their own rows** (`fn/sync.js:91–93`, timeclock :446). |
| `payhours.json` (`tc_` punches, `tce_` events) | GET `/timeclock` | every pay, kiosk and admin punch | Yes (non-admins: own rows only). |
| `settings.json` | `fn/settings.js`. POST needs `orgSettings` (:38). | — | Yes. Rehydrated as `{...prev, ...s}` (J:8768). |
| `billing.json` | GET `/billing`, default `{tier:"basic"}`. Tier is provisioned by hand. | — | No. Read once on mount, cached in `localStorage tq_tier_<org>` (J:4372–4394). |
| `timeoff.json` | `fn/timeoff.js`. Approve copies into `person.timeOff` (:413–428). | — | Ably `timeoff`. |
| legacy `timeclock.json` / `jobsessions.json` | read only by the manual migration `_utils/migrate-timeclock.js` (`?confirm=1`) | — | — |

Client caches that act as persisted state:
- IndexedDB slices (`src/db/sync.js`)
- `localStorage tq_org_settings` (J:5881, 6012)
- `tq_tier_<org>`

### D.2 How data is written

- **doSave** (J:8538–8604)
  - Fires on any tasks/people/clients change it classes as a user edit (identity check against `pollAppliedRef`, J:8813–8847).
  - POSTs **all three whole arrays** (J:8569–8573).
  - Failure sets status `"unsaved"` and **nothing is rolled back**.
- **Direct `saveTasks` calls that bypass doSave** all end in `.catch(console.warn)`, so they fail silently:
  - freeze effect J:6274
  - finish request J:11617
  - chat approve J:11695
  - kiosk clock-in J:21533
  - approve/reject J:21664, 21678
  - start job J:22584
  - end job J:22652
  - deps J:33957, 34046
  - also J:11871, 32353, 32447
- **30 s poll** (J:8364–8448)
  - Runs `deltaSync()` then full GETs.
  - Skipped while status is `saving` or `unsaved` (J:8374, 8385).
  - Installs data through the **history-tracking** `setTasks` (J:8401).
- **Ably** (`src/realtime/ably.js`, subscribe J:8790–8792)
  - Every channel just calls `deltaSync()`.
  - `applySlice` (J:8699–8775) skips tasks/people/clients while busy.
  - The orgConfig slice is subscribed but never applied (J:8770).
- **Server stamping** (`_utils/timestamps.js`): tombstones via `deletedAt`, `lastModifiedAt` on change. **There is no optimistic concurrency anywhere.** `fn/timeclock.js:238–242` says so.
- **tasks.json guard** `classifyTaskChanges` (`_utils/task-perms.js:100–170`) ✔

  | What changed | Permission required |
  |---|---|
  | `start/end/startHour/endHour/hpd` (`SCHEDULE_FIELDS`, :30) | `moveJobs` |
  | `team` | `reassign` |
  | `signOffs` | canApprove |
  | `engineering` | canEngineer |
  | resolving an existing `finishRequests` entry | `approveCompletions` |
  | `apprLog` (the only log field, :35) | free |
  | `lastModifiedAt/updatedAt/createdAt/subs` | ignored |
  | **every other field** (`moveLog`, `locked`, `status`, `loggedHours`, `deps`, `depsMode`, `finishRequest`, `pendingSession`, …), plus any create or delete | `editJobs` |

  `can()` returns false for any non-admin (`_utils/can.js:52–58`) ✔.
- **people.json guard** (`fn/people.js`)
  - POST pins `activeClockIn/activeJobClock/activeBreak/pushToken` to their stored values (:48–55, 164–166).
  - A caller without `manageTeam` is pinned on `PROTECTED_PERSON_FIELDS` (:15–19, 174–184), has other people's records restored, and has new people dropped (:209). These are silent drops, not 403s.
  - `department` is filled from `role` only when absent (:188).
  - **PATCH pins none of the clock fields** (:239–265).

### D.3 Task fields the schedule and gantt read

| Field | Level | Read at | Written by | Server perm |
|---|---|---|---|---|
| `id` | all | everywhere, compared with a mix of `sameId` and strict `===` | `uid()` → `"t"+rand` J:803; `applyWorkedSplit` `op_…` J:9716 | editJobs to create |
| `title` | all | bar text J:16606; the eng chip locates the op titled `"Wire"` J:16648 | editors | editJobs |
| `start`, `end` (YYYY-MM-DD) | all | visibility and segments J:16571–16574. **Not used for bar length** (J:17964). | updTask J:10508–10599, team drag J:18774–18937 / 19100–19130, applyPushes J:9791, enforceNoOverlap J:9774 (silent), reflowJob J:3461–3525 (silent), recalcBounds J:10291, finishedOpFields J:9996, revertSession J:10111, placeTaskAt / handlePendingItemDrop J:10630–10673 | moveJobs |
| `startHour`, `endHour` | op/panel | `shrunkStartH` J:9890, day view J:17110–17183, `singleDayStacking` J:17428 | drags J:16874–16887; **persistShrink at clock-out** J:9914–9941; finishedOpFields J:9997; revertSession | moveJobs |
| `hpd` | all | bar length (`barLengthHours` S:816), `_visualEnd` J:16477, day view J:17124, progress J:6390 | editors, drags, finishedOpFields J:9998, splits J:9720 / 12604 | moveJobs. Meaning is contested (§G.3). |
| `team` (mixed string/number ids) | all | `onTeam` J:16557, rows, `previewPush` (strict `.includes`, J:9601) | reassignTask J:10679, updTask, placeTaskAt J:10632, pending drop J:10664, delPerson J:10485 | reassign |
| `status` | all | Show-Completed filter, `isFullyWorked`, split-gantt status fill J:13079 | client clock-in J:21521, 22560 (also sets **panel** status); server jobClockIn (job + op only); approve J:9963 / 11666; split J:9731 | editJobs |
| `loggedHours` | all | `deriveWorkedState` = max(counter, rows) J:310–330 | server jobClockOut (job+op), `creditPanelHours` (panel), pay clock-outs via `jobRefs` (**pay hours**), adminJobHours (panel only); client end-job re-add J:22640; worked-hours modal J:32353 / 32446; split resets it | editJobs |
| `locked` | op | `isOpLocked` J:257, handle gating J:19392, rowPush | split paths only J:9720, 12616, 18696. `toggleLock` J:10316 is dead. | editJobs |
| `deps`, `depsMode` | panel/op | chain icon J:16768, dep-group drag J:18176–18241 | toggleDep J:10718, deps modal J:34046, mode cycle J:33957, delTask cleanup J:10709 | editJobs |
| `moveLog[]` | all | persistShrink / revertSession ownership J:9985, 10106; drain rebaseline J:10025–10048 | gantt move (dead), resize J:19111–19123, applyPushes, persistShrink, finishedOpFields, revertSession. Splits reset it to `[]` (J:12631, 18711), but `applyWorkedSplit` copies it (J:9725). Unbounded. | editJobs |
| `color` | all | bar paint via `elColor` J:6074 / `barPaint` J:2895 | normalizeTasks **persists derived defaults** J:7563–7590 | editJobs |
| `requiredDepartment` | op | assignee filtering (not rendered) | normalizeOp **derives it from `requiredRole` and persists it** J:7553 | editJobs |
| `engineering{designed,verified,sentToPerforex}` | panel | eng chips J:16606–16664 | sign-off J:11959, 11992 | canEngineer |
| `pendingFinish` | op/panel/job | freeze trigger J:6260, Requests tab J:21613 | server PIN `finishRequest` (`fn/timeclock.js:1896`); iOS. **Never set true by the web.** | editJobs |
| `finishRequest` (singular) / `finishRequests[]` | any | chat bubble, J:13408 | web J:11606–11611, server :1897–1898, chat approve/decline J:11651 | singular: editJobs. Array: free to raise, approveCompletions to resolve. |
| `pendingSession{sessionId,clockIn,frozenAtMs,reservoirOpId,sessionSnapshot}` | op | finishedOpFields / revertSession | freeze effect J:6258–6275 | editJobs |
| `finishedAt` | op | DONE-bar end J:17810–17816 | finishedOpFields J:9968 | editJobs |
| `actualHours/actualStart/actualEnd/planned*` | op | **never read** | finishedOpFields J:9969–9998 | editJobs |
| `jobNumber, dueDate, clientId, poNumber, createdAt, jobType` | job | metadata, filters, sort, the NEW dot (`createdAt` < 24 h) | editors | editJobs |
| `scheduledLater` | job | the TRAQS Cloud tray (not bars) | editor J:27648 | editJobs |

### D.4 People fields the schedule reads

| Field | Read at | Written by | Guard |
|---|---|---|---|
| `id, name, color, image, email` | rows. `loggedInUser` is matched by email and **falls back to `people[0]`** (J:7641, 7676–7686). | profile, addPerson `uid()` J:10483 | — |
| `department` | row grouping J:16459 | editors. normalizePeople persists `department ?? role` (J:7548). | PROTECTED |
| `role` | not read by the schedule | **row drag writes it** (J:10441, 10451) | PROTECTED |
| `cap` | row label `{cap}h`; `checkOverlapsPure` | person modal J:34332 | PROTECTED |
| `teamNumber` | avatar label (first character in day view J:17221, full number in week/month J:17607) | modal | PROTECTED |
| `isEngineer` | eng chips J:16641 | permissions | PROTECTED |
| `userRole, adminPerms` | `can()` J:5215–5216 | settings sections post a roster snapshot (J:28579, 28594) | manageTeam |
| `timeOff[]{start,end,reason,type,reqId?}` | PTO bars keyed by **array index** J:16540; `isOff` J:9282; `getOffReason` J:9283; drag blocks J:18618 | updTimeOff/delTimeOff by index J:10464; `syncTimeOffEntry` J:10470; server `timeoff.js` approve/edit/cancel | PROTECTED |
| `noAutoSchedule` | auto-schedulers J:26578, 26725 | settings | PROTECTED |
| `activeClockIn{clockIn,jobRefs,events,source}` | `personStatus` J:539, clock pills | timeclock only; client optimistic write J:21476 (no `events`) | pinned on POST, **not on PATCH** |
| `activeBreak` | `personStatus` | breakBegin/Clear | pinned on POST |
| **`activeJobClock`** | live bars, badges, pills, freeze | server jobClockIn plus `updateJobSession` | pinned on POST, **not on PATCH** |

`activeJobClock` sub-fields:

| Sub-field | Set by | Notes |
|---|---|---|
| `clockIn` | server time | — |
| `jobId/panelId/opId` | raw ids from the client | — |
| `*Title` | — | — |
| `sessionId` | client J:22551 / 21484, or server-derived :331–356 | — |
| `reservoirOpId` | client `onTeam` or server derive | null means "no" |
| `sessionSnapshot[]` | client `buildSessionSnapshot` J:10084, no bdOpts; or server derive (Mon–Fri, no holidays) | — |
| `drainCheckpoint` | jobClockIn, `updateJobSession`, the rebaseline effect | — |
| `pausedMsAtCheckpoint` | — | — |
| `frozenAtMs` | `updateJobSession` ← freeze effect J:6280 | epoch ms, while the other fields are ISO |
| `unclosedAt` | `updateJobSession` ← effect J:7324–7343 | **never read by the web** |
| `pausedAt/totalPausedMs` | jobPause/Resume, auto lunch/break pause | — |
| `pausedByLunch/pausedReason` | — | server only |

### D.5 Org settings and tier inputs

| Input | Detail |
|---|---|
| `workStart/workEnd` | → `workStartH/workEndH` via `parseWorkHour`, fallback **"08:00"/"17:00"** (J:5896–5903). The state default is **07:00/15:00** (J:5881). The day view uses `\|\|"07:00"/"15:00"` (J:17119). |
| `workDays[]`, `holidays[]` | YYYY-MM-DD strings |
| `breaks[]`, `lunch` | → `buildDayWindows` J:674. Lunch defaults to **60** min there and **30** min in the state default and the day view (J:17146). |
| Derived day values | `dayWindowCfg`, `productiveHoursPerDay = totalWorkH − deadH` (J:5916–5917) |
| `hpd` (org) | Re-derived from gross work hours on every load (J:5881, 7741–7745) and saved back (J:8611–8620). |
| `timeZone` | Used server-side for day stamps and after-hours alerts. **Schedule geometry never uses it**; all geometry runs in browser-local time. |
| Hour window `DHS/DHE = 5/21` | **Hard-coded** (J:12822, 12973, 16807, 17065) |
| `billingTier` | Gates row push and cursor anchoring (J:17503), day stacking (J:17161), overlap lanes (J:17199, 17455), drag overlap and before-now (J:18514, 18567). **Client-only; the server does not enforce it.** |

### D.6 Derived client-side, never persisted

| Value | Where |
|---|---|
| `deriveWorkedState` | J:310 |
| `liveOpHours` | J:6357 |
| `producedFor` | J:7350 |
| `_liveOpIds` | J:6327 |
| `_activeJobClocksByOp` | J:6302 |
| `overrunSlackDays` | J:16398 |
| `rowPushHours` result | J:17546 |
| `shrunkStartH` | J:9890 |
| cross-row bars | J:16674 |
| `personStatus` | J:539 |
| `openSessionEnd` | S:563 |
| `workedSpansByOp` / `workedSpansByPersonOp` | S:300, S:586 |
| `producedHoursByScope` | S:166 |

### D.7 Native data (iOS)

- **Reads:**
  - GET `tasks`, `sync?since=`, `timeclock`, and `timeclock?dataset=productionhours` (APIService.swift:108–614).
  - Fields: job/panel/op `status, start, end, team, hpd, title, id, loggedHours`, job `color/jobType/clientId`.
  - Org `workStartHour/workEndHour/lunch/workDays/paidHoursPerDay`.
  - Punches for overlays.
- **Not read**, though the web uses them:
  - `startHour`/`endHour` (they survive only in `extras`)
  - `locked`, `moveLog`, `panel.color`
  - `person.timeOff`, `holidays`, `breaks`, `engineering`, `deps` (in the gantt)
- **Writes:**
  - Reschedule: POST `tasks` with the whole array, via `rescheduleUnit` → `updateJob` → 1 s debounced `persistJobs` (AppState.swift:2079–2121, 2226–2260), with rollback on failure.
  - Clock actions from `ScheduleJobSheet`.
- **Cache:** SwiftData blob models (Models/SyncModels.swift:21–110). Nothing in it is schedule-specific.

---

## GE. GEOMETRY

### GE.1 Shared primitives (module scope)

| Concept | Owner | Notes |
|---|---|---|
| "Today" | `const NOW = new Date(); const TD = toDS(NOW)` J:474 ✔ | **Frozen at module load.** |
| Calendar dates | `toDS` J:473, `addD` J:475, `diffD` J:628 | Device-local, `T12:00:00`. |
| Business days (holiday-aware with opts) | `addBD` J:625, `nextBD` J:626, `diffBD` J:627 | **Without opts: Mon–Fri, no holidays.** The loops are unbounded. |
| Working days (never holiday-aware) | `addWorkingDays` J:578, `isWorkDay` J:579, `weekdaySegments` J:580, `getWorkingDayDuration` J:595, `countWorkingDays` J:618 | take `workDays` only |
| Off-day test | `spansOffDay` J:606 | workDays and holidays |
| Org shorthand | `schedOpts/sAddBD/sNextBD/sDiffBD` J:6099–6102 | used at only some call sites |
| Day windows | `buildDayWindows` J:674 | Clips and merges breaks and lunch; leftover break time goes to the start of the day. |
| Productive hours → wall clock | `walkProductiveHours(startH, prodH, cfg)` J:718 → `{days, endHour, columns}` | Clamps startH into the work window. Assumes sorted dead windows without sorting them (J:776). |
| Backward walk | `walkProductiveHoursBack` J:766 | Positions a DONE bar. |
| Productive time between instants | `productiveHoursBetween` S:442 | Local midnight + H·3600000 |
| Open clock end | `openSessionEnd` S:563 | frozen → paused → end of the start day |
| Live hours for bars | `liveOpHours` J:6357 | Uses `openSessionEnd` + `productiveHoursBetween`. **Ignores `totalPausedMs`.** |
| Live hours for the timer | `liveElapsedHours` S:45 | Wall clock minus pauses; honours `frozenAtMs`. |
| Worked state | `deriveWorkedState` J:310 | `shown = max(loggedHours, produced) + live`. Fully worked only when status is Finished. |

### GE.2 Frame (week/month)

- **Window:** `tStart/tEnd/tMode` (J:15398–15400). The default mode is month; Basic switches to week once (J:15406–15413).
  - Pan: `handleTeamPan` J:12395 (hard-coded 260 px gutter)
  - Wheel: `handleTeamWheel` J:12436
  - Scrollbar: J:19505–19536
  - Drag autoscroll: J:18287
  - Jump: `goToScheduleJob` J:15418
- **Days:** `days[]` J:16433.
- **Label column `lW`:** 250–510 px, from the longest on-clock title × 6.2 (J:16445).
- **Column width:** `cW = (teamWidth·monthZoom − lW)/days` (J:16452–16455; zoom 1–6, J:16335, 17047).
- **Row heights:** `rH` 42, `grpH` 36, `subH` 34. The header is 56 px (48 px in day view).

### GE.3 Row assignment: `getPersonBars(pid, winS, winE)` J:16472–16725

- **Op bars**
  - Condition: `onTeam(op.team,pid) && isTimelinePlaced(op)`, i.e. dated and assigned (J:3527).
  - Finished ops only when `showCompleted`.
  - **Hidden:** `op.end < today` with nobody clocked in (J:16548).
  - Window test: `_visualEnd(op) < winS || op.start > winE`.
- **Panel bars:** only a leaf (`!hasLiveChildren`) on its own team (J:16571–16582).
- **General-job subtasks:** J:16587–16603.
- **PTO bars:** J:16532.
- **Eng chips:** only for `person.isEngineer` (J:16606–16634).
- **Cross-row records** (J:16655–16723): work a person did on an op they are not on the team of.
  - span = merged closed sessions + an open clock bounded by `openSessionEnd`
  - `hpd = productiveHoursBetween` (floor 0.25)
  - `team=[pid]`, `crossRow`, `endsNow`
- **`_visualEnd`** (J:16477–16499) = walk(barLengthHours, no cursor), then `addBD`. **It ignores the push.**
- **Window slack:** `overrunSlackDays` (J:16402–16425, uses `rowSlackHours` S:513) widens winS. The push window `pushWinS/E` spans every dated node (J:16427–16432).
- **Sort** (J:16637–16642): returns 0 whenever either side is not a task.
- **Row list** (J:16757–16775): group headers by `person.department`, then person rows filtered by `passesScheduleBarFilter` (J:16733). The filter applies to task bars only.

### GE.4 Lanes and stacking

| Case | Rule |
|---|---|
| Business, week/month | No lanes. `singleDayStacking` J:17425–17444 packs ≤ 1-day ops from a per-day cursor (a stored `startHour > workStartH` is honoured), then the row push (GE.7) runs. |
| Basic, week/month | `basicOverlapLanes` J:17455–17480: a greedy sweep per `task.start` day, only over bars with a stored `startHour` and hpd > 0. Range = `startHour + hpd` (clock hours, not divided by team size). Lane height `(rH−8)/lanesTotal` (J:19381). **Applied to the head segment only.** `singleDayStacking` is **not tier-gated**, so it runs here too. |
| Day view, Business | `rawS = max(startHour ?? cumH, cumH)`, `rawE = rawS + hpd` (clock hours, no lunch skip, no team division, capped at 21) J:17162–17166. Multi-day bars use their own lunch walk (J:17136–17160: 30-min default lunch, no breaks, `diffBD` without opts). Then `shrunkStartH` (J:17183). |
| Day view, Basic | `rawS = startHour ?? wsH`, no packing, lanes from `barLanes` J:17199–17217 |

### GE.5 Bar length (week/month), J:17760–18030

- **`_barHpd`** (J:17847):
  - **DONE:** `productiveHoursBetween(start, min(finishedAt, now))/teamSize`, floor 0.25 (J:17814–17823).
  - **Otherwise** `barLengthHours` (S:816):
    - ahead = `max(0, est − worked)/size`, or the overrun `(worked − est)/size`;
    - behind = `elapsedToCursorH` (J:17834; capped at this row's own worked spans, J:17843);
    - floor 0.25;
    - fallback est = `productiveHoursPerDay`.
- **Walk:** `walkProductiveHours(_barStartH, _barHpd, dayWindowCfg)` (J:17961).
  - Visual end: `addBD(_layoutStart, days−1, org opts)` (J:17973).
  - Segments: `weekdaySegments(...)` (J:17974), **no holidays**.
- **Width:**
  - Budget `_wBudget = walk.columns/nDays·100%` (J:18000).
  - Head `_wFirst = min(_wWanted, segRight − x)` (J:18026). For `endsNow`, `_wWanted = flushRightWidthPct(x, cursor)` (J:18023).
  - Last tail = `(calDays−1) + (endHour−workStartH)/totalWorkH`; middle tails get the remainder, capped at their own days (J:19426–19478).
- **`op.end` is not used for length** (J:17964).

### GE.6 X position

- `_baseStartH = shrunkStartH(jc, task, startHour ?? singleDayStacking slot ?? workStartH)` (J:17873).
- The push hours are spent with `walkProductiveHours(_baseStartH, _pushH)`, giving `_pushDays` plus a landing hour (J:17881). Then `_layoutStart = addBD(start, _pushDays)` (J:17890).
- **Cursor-anchored bars** (`cursorAnchored[id]`, J:17932–17938): `_layoutStart = today`, `_barStartH = now.getHours()`. No clamp to work hours or work days.
- **x** = `diffD(tStart, seg.start)/nDays + ((barStartH−workStartH)/totalWorkH)/nDays` (J:18005–18010). The hour term is dropped when the first segment rolled off a non-work day.
- **Label placement:** `labelInsetPx` S:671, `labelSegmentIndex` S:688, `badgeOffsetPx` S:658. Narrow thresholds are 8/12/16/44 px (J:18056–18073).

### GE.7 The now cursor

There are **three independent formulas**:

1. **Bar-divider cursor** `_nowGridPct` (J:17771–17778): `(days.indexOf(toDS(new Date())) + clamp01((h−workStartH)/totalWorkH))/nDays`. Head and tail divider percentages derive from it (J:19296, 19446).
2. **Drawn now line** (J:19490–19500): uses **module `TD`**. 2 px, hour-precise, clamped to work hours.
3. **Op-window cursor** `_barCursorPct` (J:19231): `(now − plannedS)/(plannedE − plannedS)` via `opHourRange` (J:10069). Drives `_leftIsGrey` and `data-op-divider-pct`.

Other cursors:
- **Day view:** `(nowH − 5)/16`, shown only when `tStart === TD` (J:17298).
- **Split gantt:** the centre of the TD column (J:13327).
- `Date.now()` is read about 8 times per bar (J:17772, 17816, 17836, 17927, 17939, 19231, 19249, 19333).

### GE.8 Push

- **Render-time row push:** `rowPushHours({ops, nowDay, nowHour, cfg})` S:828–955, called at J:17546–17591. **Business only** (J:17503). Nothing is persisted.
  - **Axis:** `sp = diffBD(anchor,start)·ppd + dayFraction·ppd` (S:183). Clock-linear, not lunch-aware. `dayFraction` is not capped at ppd.
  - **Skipped:** past ops (`end < nowDay`, S:864) and records (S:875).
  - **Push** = max(collision `prevEnd − sp`, `nowProd − ownWorked − sp` when the op is not fully worked). Forward only.
  - **Locked ops** get push 0 but keep their slot (S:945).
  - **atCursor** (→ `cursorAnchored`) is set only when `ownWorked ≤ 0` (S:913–918).
  - `hasActiveSession` is still passed (J:17577) but no longer read (S:932–935).
  - A second, older push, `overrunPushH`, sits alongside it (J:17497 vs 17552).
- **Stored push:** `previewPush(taskList, movedOpId, personId, newStart, newEnd, exclude)` J:9596.
  - Day-granular.
  - Candidates: every unfinished op with `team.includes(personId)` whose dates overlap by day.
  - Refuses if any candidate is locked.
  - Serially re-dates candidates with `addBD(prev, 1)` **without org opts**, keeping the business-day length. Transitive.
  - `applyPushes` J:9791 writes start/end and a moveLog entry, then `recalcBounds`, then `enforceNoOverlap` J:9750.
  - **Reachable callers:** the week/month resize `onU` (J:19126–19130) only. The team-move caller (J:18796–18946) is unreachable ✔, and the Reschedule modal (J:34741–34838) is never opened.
- **Imports:** `shiftRangeForward` S:769 at import time (J:4941).

### GE.9 Cascade and dependencies

- `cascadeDeps` J:10717 has **no callers**.
- **`reflowJob`** J:3513 = `reflowPhaseOps` J:3461 + `rollUpJobDates` J:3491.
  - Runs through `updTask` whenever start/end/team change (J:10531–10536), including on **every mousemove** of a resize.
  - Per phase, same person: start is floored at `addBD(prevEnd, 1, schedOpts)`. Dates only.
  - Ignores `locked`, `Finished` and `startHour`. Writes no moveLog.
- **Two parent rollups:** `rollUpJobDates` J:3491 (skips deleted and undated nodes) and `recalcBounds` J:10291 (does not).
- **Drag dependency groups:** `getDepGroup` J:9629.
  - locked mode: members move by the same delta (`_computeMonthMove` J:18735, `addBD`/`diffBD` **without opts**, J:18733–18739).
  - unlocked mode: magnetic snap `_phi/_phiInv` J:18398 on a clock-hours-per-business-day axis, 2 h threshold.

### GE.10 Clamps

| Clamp | Where | Rule |
|---|---|---|
| Team move drop | J:18349–18377 | `snapS = nextBD(addD(base, dx), org)`; `dropHour = round(workStartH + colFrac·totalWorkH)` to ½ h; end-of-day magnet ≤ 0.5 h |
| Before-now | J:18567, 18638 | Business only: `snapS < today \|\| (== today && dropHour < nowH)` |
| Month resize | J:19018–19055 | Hour in [workStartH, workEndH − 0.5] on the left handle; ½ h snap |
| Day view | J:16807–16884 | Move in [5, 21 − hpd]; resize in ¼ h steps, min 0.25 |
| `clampUnlocked` | J:18217 | Only call site is in the unreachable block |
| `shrunkStartH` / `persistShrink` | J:9890 / J:9914 | `min(storedSH + worked, plannedEnd − 5 min)` (`SHRINK_MIN_REMAINDER_H` J:9855) |
| Floors | — | 0.25 h length, 2 px render, `0.03/nDays %` width budget |

### GE.11 Freeze

- **Freezes:** effect J:6257–6286.
  - When `findOp(op).pendingFinish` is set for an active clock without `frozenAtMs`, it stamps `op.pendingSession{…frozenAtMs:now}`, calls `saveTasks`, then `updateJobSessionAction(frozenAtMs)`, then sets the value locally.
  - `frozenAtMs` stops `shrunkStartH` (J:9895), `liveElapsedHours` and `openSessionEnd`, so the bar reads "held" (J:19336).
  - A lunch pause (`pausedAt`) and the end-of-day bound (unclosed) stop the hatch the same way.
- **Drain checkpoint:**
  - set at clock-in (J:21507, 22560);
  - rebased on any foreign moveLog entry (J:10025–10048);
  - `persistShrink` (J:9914, called at J:22639) writes `startHour`;
  - `sessionElapsedMs` J:9838.
- **Unfreezes:**
  - `approveFinish` J:21654 → `finishedOpFields` J:9950: the DONE bar is placed with `walkProductiveHoursBack` and `activeJobClock` is cleared locally.
  - `rejectFinish` J:21673 clears `pendingFinish/pendingSession` and runs `revertSession` J:10096.
  - **No client path sends `frozenAtMs: null`**, although the server accepts it (`fn/timeclock.js:1226`).

### GE.12 Drag ghosts

- **Main ghost** (J:17625–17684): stored drop + `pushBD/pushHourDelta`. Width is the flat pro-rate `(barHpd/ppd)/nDays`, capped per segment.
- **Group and multi ghosts** (J:17690–17745): same pro-rate, **last segment uncapped**, no `pushBD`.
- **Tooltip** (J:19553–19570): walk + `addBD` without opts.

### GE.13 Split gantt geometry (live) and job gantt (dead)

- **Split gantt:**
  - `cW = max(14, paneW/days·gZoom)`, calendar days, rows 40/34/28, bars 24/20/16.
  - Segments via `weekdaySegments`.
  - Stored dates only: no hours, hpd, push or cursor.
  - `bL/bR/bW` and `_workedPctOfSeg` are computed and unused (J:13262, 13278–13294).
- **Job gantt (dead):** `dToX = diffD·cW`, calendar days, status-guess progress fill, a mid-day today line, a live `updTask` on every drag step, and calendar-day child shifts (J:12675–12704).

### GE.14 Native geometry (iOS `GanttView.swift`)

Rewritten in iOS chunk A (2026-10-04) onto the web's rules, through `Services/GanttLayout.swift`:
- **Items** (`GanttLayout.units`): `getPersonBars`' task rules for the current user — an op on my team, or a panel on my team with no live ops (`isAssignedHere`); unfinished, dated, not deleted; history hidden unless clocked into. PTO, eng chips and the overrun extension are not ported (#249, #252).
- **Placement** (`GanttLayout.dayBlocks`): `statsMath.dayViewBlocks`, the web day view's Business rule — multi-day units by `OverlapRule.blocks` (the `opDaySegments` port), everything else on one shared cursor from workStart honouring `startHour`, walked by `WorkDayClock`. No packer, no capacity, nothing rolls forward.
- **Parity:** `fixtures/schedule-parity.json`, computed by the real JS (`scripts/schedule-parity-test.mjs`, in the build) and asserted by `ScheduleParityTests` on iOS.
- **Live hours** (since iOS chunk C): `SessionHours.live`, the web's `sessionWorkedHours` in shop time (Services/ShopTime.swift).
- **Worked fill:** poured front to back and capped at the chunk. **Overrun is invisible.**
- **macOS:** no geometry. The Mac only calls `JobsScheduler` from the New Job wizard.

---

## R. RENDER

### R.1 Paint helpers (module scope)

| Helper | Line | Behaviour |
|---|---|---|
| `wantsLightText(hex)` | J:2340 | The one black/white rule: `hexLum < 0.1791` |
| `accentText(c)` | J:2472 | Tests `blendHex(c,−0.22)`; returns `#fff` or `#0f172a` |
| `DONE_MUTE` | J:2894 | `#8c8c94` |
| `barPaint` | J:2895 | Finished → `mixHex(color, DONE_MUTE, .34)` |
| `barFade` | J:2903 | Finished → opacity 0.7 |
| `spentBarFill` | J:2514 | `mixHex(bc, DONE_MUTE, .8)` |
| `idleBarFill` | J:2540 | — |
| `workedHatchLayer` | J:2567 | 45° stripes, 4/8 px, stepped colour at 0.30 alpha |
| `workedFlatFill` | J:2576 | Used under 16 px (`HATCH_MIN_PX`) |
| `activeBarFill(T, bc, spans, dividerPct, state, renderPx)` | J:2606 | `pto` = 135° white stripes; `done` = spent fill. Otherwise layers, top to bottom: bc right of the cursor, idle over gaps, hatch, idle base. **No branch for held/paused/running/worked/scheduled.** |
| `barLabelColor` | J:2672 | `accentText(idleBarFill(bc))` |
| `liveBarTextColor` | J:2680 | — |
| `elColor` | J:6074 | `T.jobBarMode`: system = own colour, adaptive = accent, custom = `T.jobBarColor` |
| Dead | — | `liveBarStyle` J:2725, `drainMaskStyle` J:2690, `LIVE_BAR_LABEL_MIN_PX` J:2743 |

### R.2 Bar states: week/month schedule

Bar colour for task bars is `bc = barPaint(x, elColor(panel.color || "#94a3b8"))` (J:16556–16604).

| State | Trigger | Fill | Border / opacity | Text / badge |
|---|---|---|---|---|
| Scheduled, cursor not reached | `_barState="scheduled"` J:19344, head cursor ≤ 0 | plain `bc` | 1.5 px `bc`; 1 px under 16 px; none under 8 px | title `accentText(bc)` |
| Cursor inside, row has spans | `_fillSpans=[[0,100]]`, `_fillCursorPct=_headCursorPct` J:19324 | head fully hatched left of the cursor, `bc` to its right | as above | title `barLabelColor` + 3 px halo J:19374 |
| Cursor past start, no spans on this row | `_ownerOnTheClock` J:19311 (the name means the opposite) | spans `[]`, cursor 0 → plain `bc` | as above | still `barLabelColor` + halo, because `_leftIsGrey` J:19356 tests only `_barCursorPct > 0` |
| Tail segments | J:19426–19478 | **real** per-segment spans and cursor (J:19461) | dashed 2 px `bc2cc` | title or hours only when chosen by `labelSegmentIndex` |
| Cross-row record | `bar.crossRow` | spans `[[0,100]]`, cursor 100 → fully hatched | drag blocked J:19164 | `panel · op`; `endsNow` makes it flush to the cursor |
| Running | anyone's `activeJobClock.opId` matches J:19203 | same fill | — | green pulsing dot `#10b981` 9 px, z9 J:19417; no "LIVE" text |
| Held | any live clock with `frozenAtMs` J:19336 | same fill | — | "HELD", hidden under 44 px J:19403 |
| Paused (lunch) | `pausedAt` J:19337 | same fill (the head ignores spans) | — | "LUNCH" J:19403 |
| Worked | `_barWorkedPct > 0` J:19343 | same fill | — | — |
| Done | `status==="Finished"` J:19335; shown only when `showCompleted` | `spentBarFill(bc)` over an already-`barPaint`ed bc | × 0.7 (`barFade`); length clamped at `finishedAt` | "DONE"; title and hours use `accentText(bc)` |
| Overrun | `_overrunPerPerson > 0` J:17795 | the bar grows through `barLengthHours`; the extension is plain `bc` | cursor not-allowed; drag blocked | none; the hours tooltip says "h left" but shows total length J:19406 |
| Locked | `!!task.locked` J:298, 19148 | unchanged | `2px rgba(255,255,255,.7)` + glow; handles removed | 11 px padlock z3 J:19396. **Still draggable** ✔ |
| Dep group | `depGroupTaskIds` J:16777 | — | — | padlock (locked mode) or open padlock, 10 px, 0.7, z3 J:19395; the same glyph as an op lock |
| Selected | `barSelectMode && selBars.has(id)` J:19185 | — | 2 px `#fff`; `0 0 0 2px bc88, 0 0 14px bc55` | white check disc |
| Hover / sibling dim | `hoveredBarPid` = hovered `task.pid` J:19391 | hovered bar `brightness(1.15)` | others `0.2 × barFade`; PTO and select mode exempt; person column 0.35 J:17604 | — |
| Highlighted | `scheduleHighlightId` J:19170 | — | z10, 4 s `scheduleGlow` J:1043 | — |
| Dragging | `teamDragInfo.barId` J:19171 | — | opacity 0 past 4 px; z40/z39 | — |
| Ghosts | J:17623–17741 | dashed 2 px, radius 26; `gc` = red if overlap or before-now, else bar colour | main z35, group z34, multi z35; snap connector z38 | tooltip fixed z9999 |
| Just dropped | `droppedBarId` J:18586 | — | `barDropIn` 0.25 s J:1039 | — |
| New job | `jobCreatedAt` < 24 h J:19196 | — | — | blue dot `#0a84ff` z8, shifted 23 px when live |
| Narrow | `_renderPx` < 8 / 12 / 16 / 44 J:18066–18073 | flat worked fill under 16 px | no border under 8 px; min 2 px | no label or badges under 44 px; live bars get an external label z8 |
| PTO | `type==="pto"`; `#f59e0b` UTO / `#10b981` PTO; not `elColor` | stripes | 1.5 px, radius `radiusXs`, z3; never dimmed | calendar icon + `type · reason` |
| Eng chip | `isEngineer`, `panel.engineering` defined J:16609; placed on the Wire op, else the panel start | `#10b981` all done / `#3b82f6` J:18079 | radius 26, 80–160 px, z4; never dimmed or filtered | `#fff` title `· step` or ✓ |

**Not rendered anywhere on schedule bars:**
- pending finish / finish requested
- job status other than Finished
- overdue vs `dueDate`
- the unclosed clock (only `data-unclosed`, J:19387)
- a distinct overrun extension
- holidays

### R.3 Non-bar layers (week/month)

| Layer | Detail |
|---|---|
| Header | Month row and day row (today in accent, weekends `schedDisabled`, J:17332); sticky corner z15 |
| Grid lines | `T.scheduleGrid` toggles them; `_schedDk = hexLum(surf) < 0.5` J:16753 |
| Day cells | J:17617, in priority order: PTO (`offColor12` + stripes), today (`accent08`), weekend (`schedDisabled`). **Holidays are never shaded.** Placing mode adds z6 and an accent ring on hover. |
| Group row | Sticky label z10 + `groupClockPill` J:16367; the timeline part is empty |
| Person header | Sticky z10: ⠿ handle, 28 px `PersonAvatar` (team number), first name, `dept · cap h`, `personClockPill` J:16350. The `.sched-person-glow` hover is **dead** (it needs a `.sched-person` ancestor that doesn't exist, J:1313). |
| Row drag | Opacity 0.35; 2 px accent insertion lines z20 J:17595 |
| Today line | J:19490: 2 px `accent99` z12, 6 px dot z13, spans the header |
| Capacity | None; utilization was removed J:16467 |

### R.4 Day view (a separate renderer)

- **Grid:** fixed hours 5–21. Off-hours shading is hard-coded to `h<7||h>=18` (J:17079, 17093, 17231).
- **Bar:**
  - Fill: Finished → `spentBarFill`, otherwise flat `bar.color`. No hatch, regions, border, lock, dep icon, live dot, NEW dot, select state or eng chips.
  - Title: `"{hpd}h · title"` in `accentText(bar.color)` for every state (J:17256).
  - Badges: `liveBadgeFor` J:9867, keyed on the row person's `reservoirOpId`; returns held or paused only.
  - Resize grips always visible (J:17251, 17257).
- **Overlays:**
  - Break/lunch overlay `rgba(0,0,0,.25)` with "B"/"L" letters, only when `hpd ≥ orgSettings.hpd` (J:17260–17276).
  - PTO day: every bar is hidden and a label is centred (J:17235, 17279).
- **Ghost:** a fixed solid block with `#fff` text, z9999 (J:30518). Red when before now, **on every tier**.

### R.5 Split gantt (live)

- **Bars:**
  - Colour: jobs `#94a3b8`, panels **status colour** (`staColorOf`), ops the panel colour. Always drawn as `color+"dd"`. No `elColor`, `barPaint` or `barFade` (J:13257).
  - Text is always `#fff` (J:13306).
  - **Avatars on bars:** up to 3 `PersonAvatar` + `+N` (J:13309–13317). This is the only surface with them.
- **Layers:** level stripes z2, weekend split edges dashed, today line 1 px `accent33` at mid-day z4 (above bars).

### R.6 Z-order (week/month)

auto cells (z6 while placing) < 3 PTO bar and in-bar icons < 4 task bars and eng chips < 5 grips / title / hours < 8 NEW dot and external live label < 9 live dot < 10 highlighted bar = sticky column = group label < 12 today line < 13 today dot < 15 header corner < 20 insertion line < 34 group ghost < 35 ghosts < 38 snap connector < 39 multi-dragged < 40 dragged < 400 filter panel < 9999 tooltips.

Person rows use `overflow:hidden`. **[inferred] conflicts:**
- the highlighted bar ties the sticky column and wins on DOM order;
- the today line crosses the sticky column during a horizontal month-zoom scroll;
- the external live label overlaps neighbouring bars.

### R.7 Tier differences in render

| | Business | Basic |
|---|---|---|
| Week/month overlap | none (push prevents it) | `basicOverlapLanes`, head only |
| Push / cursor anchoring | yes | no; bars sit at stored dates |
| Red drag ghost (overlap, past) | yes | no |
| Day-view packing | shared cursor | stored hour + lanes |
| Day-view before-now | red / refused | red / refused (same) |
| Jobs page and split gantt | yes | no (J:11270) |

### R.8 Native render (iOS)

- **Day view:**
  - Vertical hour lane, 56 pt/h.
  - `ScheduleBlockView` (:970–1073): white card, 5 pt department-gradient rail, `WorkedStripe` hatch from the top.
  - Punched break/lunch bands, lunch ghost, sky NOW line.
- **Week view:** grid of work days only, `WeekBlockTile` in solid department colour, ink NOW line, legend.
- **Colour** (since iOS chunk C): the panel's `panel.color` through `legibleBarColor` (Services/BarPaint.swift); finished bars get the web day view's DONE fill and tag.
- **Web states with no native equivalent:** finished, history, overrun, idle-left, cursor-anchored, locked, cross-row, PTO, eng chips, dep icon, drag ghost, lanes.

---

## I. INTERACTION

### I.1 Gates and plumbing

- **Client gates:**
  - `isAdmin = userRole==="admin"` (J:5215).
  - `can(p) = isAdmin && permGranted(adminPerms, p)` (J:5216; `approveCompletions`/`approveTimeOff` count as granted when absent). This matches the server's `can()`.
- **Undo:**
  - `setTasks` pushes a full deep clone on every change, capped at 50 (J:5433–5444).
  - `undo`/`redo` require `can("undoHistory")` (J:5457–5473), client-only.
  - Keys: Ctrl/Cmd+Z / Shift+Z / Y (J:5475–5483 ✔, `preventDefault` unconditional).
  - `setPeople` has no history.
  - Poll merges land on the undo stack.
- **Notifications:**
  - No schedule action calls `callNotify`. Engineering steps only (J:11972, 11975).
  - The server `tasks.js notifyTaskChanges` (:131–212) pushes on team add/remove, status change and finish resolve.
  - **Date moves notify nobody.**
- **moveLog** is written only by: week/month resize (J:19111–19123), `applyPushes`, persistShrink, finishedOpFields, revertSession, and the dead gantt, push and modal paths. **The live week/month move writes none.**

### I.2 Drags: schedule

| Interaction | Handler | Client gate | Preview | Writes on drop | Push / cascade | Undo | Server needs |
|---|---|---|---|---|---|---|---|
| **Week/month move** (including a drop onto another row) | `handleTeamDrag` J:18092 via J:19388 / 19466 | `can("moveJobs")` (else open detail, J:18093); refused if `_someoneOnIt` (J:18094) or `_dragBlocked` = overrun or crossRow (J:19164). **`locked` does not block** ✔. Reassign needs `can("reassign")` (J:18602). | Ghost, red on overlap or past (Business, J:18497–18567), dep snap, autoscroll | Refuses on PTO (J:18617), overlap (J:18626), past (Business, J:18636). Split-on-drag for a partly worked op landing on an off day: new op, original `locked:true` (J:18673–18731). Otherwise `_moveNode` sets `start/end/startHour/endHour` and swaps `team`; group and multi members go through `_computeMonthMove` (J:18735–18794) → `recalcBounds` → `doSave`. | **None.** J:18642 always returns ✔. The push / `applyPushes` / `enforceNoOverlap` / confirm block J:18796–18946 is unreachable (PTO returns earlier at ~J:18115). | 1 | moveJobs (+ reassign; split: editJobs) |
| Week/month resize | `handleTeamResize` J:18952 via handles J:19392 / 19393 / 19476 | `can("moveJobs")`; handles hidden when locked, drag-blocked, narrow, or (left handle) worked | live `updTask` every mousemove + tooltip | revert → lock check (J:19108) → `applyResize` + moveLog "Manual resize". Month writes `hpd/startHour/endHour`; week writes start/end only (J:19111–19123). | `previewPush` → confirm modal (J:19126–19140); `reflowJob` on every updTask | N (one per mousemove) | moveJobs **+ editJobs** (moveLog) |
| PTO move / resize | `handleTeamDrag` / `handleTeamResize` isPto branches J:18095–18115, J:18955–18975 | **`can("moveJobs")`** (the menu uses manageTeam) | live `updTimeOff` | `timeOff` via `setPeople` + `syncTimeOffEntry` → timeoff edit | — | none | people: manageTeam (silent drop); timeoff edit: isAdmin |
| Multi-select drag | Select toggle isAdmin (J:16921) → `isMultiDrag` J:18224 | moveJobs | ghosts | members shifted; **only the grabbed bar is reassigned**; overdue members skipped silently (J:18233) | none | 1 | moveJobs |
| Day-view move (including reassign) | `handleTeamDayBarDrag` J:16820 via J:17247 | **None** (the view itself is admin-only) | floating ghost, red before now | past check (J:16892) → `updTask({startHour})` + `reassignTask` (J:16895–16897) | — | 1 | moveJobs + reassign |
| Day-view resize | same handler, J:17251 / 17257 | **None** | ghost | `updTask({startHour,hpd})` / `updTask({hpd})` (J:16900–16905); no past check on the right edge | — | 1 | moveJobs |
| Row reorder / move to group | ⠿ → `startRowDrag` J:10411 | **None** | insertion line | reorders `people`, sets `role` (J:10436–10452); `Number(rid)` ✔ | — | none | role pinned for non-manageTeam; order persisted **[inferred]** |
| Pending-tray drop | tray J:35055 → cell onDrop J:17621 → `handlePendingItemDrop` J:10652 | none | HTML5 ghost | `start/end`; **adds** to `team`; status Not Started → Pending (J:10664) | — | 1 | moveJobs + reassign + editJobs |
| "Drop in schedule" placing | armed from plan-assign (J:32044, `can("moveJobs")`) → cell click J:17618 → `placeTaskAt` J:10624; Esc cancels (J:10646) | moveJobs | cell ring | `updTask({team:[pid], start, end})` **overwrites** team (J:10639) | reflowJob | 1 | moveJobs + reassign |
| Pan / wheel / zoom | J:12394, 12437, 17048, 17021 | none | — | view state | — | — | — |

### I.3 Clicks, hovers, keys, header

| Target | Action | Gate |
|---|---|---|
| Bar click | `openJobDetailOrEdit` J:10907: Business opens detail; **Basic opens the simple edit modal for everyone** (J:10766, 26250) | none |
| Bar in select mode | toggle selection | isAdmin |
| Eng chip | `openDetail` J:18078 | none |
| Group header | collapse department J:17350 | none |
| Person card | no handler (dead glow) | — |
| Person name in select mode | `setSelectedSchedulePerson` J:17609 | isAdmin |
| Bar hover | brightness + sibling dim | none |
| Header: Select / All / Delete | multi-select, bulk delete J:34882 | **isAdmin** (server: editJobs) |
| Header: filter / view / search / Today | UI state J:16936–17006 | **isAdmin**; non-admins cannot change view |
| Header: TRAQS Cloud | opens the edit wizard for `scheduledLater` jobs J:17050, 30470–30490 | **none** |
| Header: + New Job | `openNew` J:17051 | editJobs |
| Grid corner: Time Off | TimeOffModal → updPerson J:17315 | manageTeam |
| Empty state: + Add Member | personModal J:17061 | isAdmin (server: manageTeam, silent drop) |
| Keys | undo/redo; Esc closes menus (J:9114) and cancels placing. No bar or row shortcuts. | undoHistory |

### I.4 Context menu (`handleCtx` J:11273, ungated; menu J:33872)

Opened from schedule bars (J:19389, 19467) and day-view bars (J:17248). On mobile it is a bottom sheet (J:33890).

| Item | Client gate | Writes | Server needs |
|---|---|---|---|
| ✎ Edit | business && editJobs | wizard | editJobs |
| Open Chat | none | — | — |
| Send Reminder J:11876 | business && editJobs | message | messages.js |
| Dependency-mode cycle | **none** | `deps/depsMode` + `saveTasks` **inside the updater** (J:33958) | editJobs |
| View Details | business | — | — |
| Take me to schedule | none | — | — |
| Add/Edit Dependencies | **none** | `deps/depsMode` + `saveTasks` (J:34030–34046) | editJobs |
| Reschedule / Edit | editJobs | wizard (Business) or simple modal (Basic) | editJobs / moveJobs |
| Split Job J:32323 | editJobs, op, hpd > 1, not Finished | new op + `saveTasks` | editJobs |
| Set Worked Hours J:32392 | editJobs, op | `loggedHours` + `adminJobHoursAction` | tasks: editJobs; `adminJobHours`: **isAdmin only** (`fn/timeclock.js:1316`) |
| Request Completion J:11582 | business, leaf | `finishRequest` (singular) + `finishRequests[]`, `saveTasks`, message | **editJobs** (because of the singular field) |
| Complete Now J:11824 | business && editJobs && approveCompletions (J:11820) | `status:"Finished"` cascade | editJobs only |
| Delete J:34012–34018 | editJobs | from a schedule bar this deletes the **whole parent job** | editJobs |
| PTO bar: Edit / Delete (J:34176) | manageTeam | by index + timeoff cancel | manageTeam / isAdmin |

### I.5 Admin actions reachable from the schedule

- **Present:** time off (corner button, PTO menu), bulk delete, Set Worked Hours, Complete Now, Request Completion, Split, dependencies, Reschedule wizard, placing mode, the TRAQS Cloud tray.
- **Absent:** clock actions (the clock pills are tooltip-only, J:16350–16378), lock/unlock (no UI), copy/paste (dead: `copyItem` J:11323, `doPaste` J:11338).
- **Approve/reject a finish:** from the Requests tab (J:21654, 21673) and chat (J:11651–11740), not from the schedule.

### I.6 Tier and mobile

- **Basic:**
  - Week default, no Jobs page or gantt.
  - No overlap or past check on week/month drags.
  - The day view's past check still applies; resize still runs `previewPush`.
  - Simple edit (J:26267–26282) collapses the whole team into `subs[0]` and sets `start=end=date`, with no checks.
- **Mobile web:** no schedule. `renderMobileApp` calls `useState` behind the `isMobile` ternary (J:24107, 30374).
- **Department lock** (project rule) is applied only in the wizard and quick-add schedulers (J:26583, 26766, 27489, 34134). **It is not applied in:** drag reassign, day-view reassign, `placeTaskAt`, the pending tray (ignores `requiredDepartment`, J:35129), simple edit, the op editor picker (J:35461), or planAssign (J:31984).

### I.7 Native interaction

- **iOS gantt:**
  - Day/Week segment, Day ◂ ▸ and TODAY; week view has **no** prev/next.
  - Tap a block → `ScheduleJobSheet` (clock in/out, break, end photo).
  - No drag, resize, reassign or context menu.
- **iOS reschedule:** long-press in `JobDetailView` (:365–376, 530–541), gated by `can(.moveJobs)` → `RescheduleSheet` → `AppState.rescheduleUnit` (:2079–2121).
  - Shifts by calendar days; dependents follow op → op links only.
  - No moveLog, no lock, clock, past or overlap checks.
  - A panel move leaves its ops and the envelope stale.
- **macOS:** the schedule placeholder. The row menu's "Take me to schedule" leads there (JobsPage.swift:633–637); "Reschedule" is disabled (JobsRowMenu.swift:265–269).

---

## INV. INVARIANTS

**No schedule invariant is enforced on the server.** `fn/tasks.js` only checks permissions (task-perms). Every rule below is client-side and can be bypassed by any other writer (iOS, Mac, API, a stale tab).

| # | Rule | Enforced at | Test | Bypassed by |
|---|---|---|---|---|
| 1 | No two ops share time on one person's row | Five different definitions: (a) drag ghost `_opVisual` J:18481–18532, hour-precise, Business, grabbed bar only; (b) `previewPush` J:9608, date-inclusive; (c) `enforceNoOverlap` → `dayShiftToClear`/`opInterval` J:9750 / S:1140; (d) `checkOverlapsPure` J:9480, daily capacity sum (saveTask J:11135, gantt); (e) `reflowPhaseOps` J:3461, same person never on the same day. Render-only repack: `rowPushHours`. | `no-overlap-test` mostly tests app-dead helpers; only `dayShiftToClear` (:165–195) is live. `row-push-test` :418 covers render packing only. | Group and multi members; Basic (by design); "move only this one"; day view; pending tray; saveEditJob J:35093; import J:4941; iOS; server. `opInterval` treats a single-day op with no `endHour` as zero-width (`durationH` is never written). |
| 2 | A locked op doesn't move | `previewPush` refuses locked neighbours (J:9610, 9621); resize at release (J:19109); `rowPushHours` pins (S:945) | row-push-test :51 / 53 / 99 / 253; no-overlap-test :103 (dead helper) | **The week/month move itself** ✔; day view; `reflowPhaseOps`; iOS; server |
| 3 | No move or edit of an op someone is clocked into | `_someoneOnIt` week/month drag and resize (J:18091–18094, 18954); `blockedByActiveClock` on drop J:18585 and in saveTask J:11109 | untested | day view; resize drop; saveEditJob; bulk delete; iOS; server |
| 4 | A held session stops growing | `frozenAtMs` via the freeze effect J:6254–6285; read by `shrunkStartH`, `openSessionEnd` | live-hours-test, job-live-hours-test (freeze cases) | runs only while some web client is open [inferred]; `jobClockOut` credits wall time minus pauses and ignores `frozenAtMs` (`fn/timeclock.js:1114–1121`); iOS ignores it; `updateJobSession` does no validation |
| 5 | One live job clock per person | `jobClockIn` 409 (`fn/timeclock.js:1025`) | **untested** | non-atomic read-then-write (:1015–1070) [inferred]; people PATCH doesn't pin `activeJobClock` |
| 6 | On the pay clock before a job clock | `fn/timeclock.js:1024` | untested | **disabled**: `ENFORCE_CLOCK_JOB_DEPENDENCY = false` (:14) |
| 7 | Department restricts assignees (project rule) | `personDeptMatch`/`deptOfUnit` J:9422–9434 in the auto-schedulers | JobsSchedulerTests (Swift, which asserts the **fallback to everyone** as intended) | auto-schedulers fall back to all crew (J:26585–26588); every manual path (I.6); server |
| 8 | Business days only (workDays + holidays) | `addBD/nextBD/diffBD` with `barBDOpts` / `schedOpts` | row-push-test (injected calendar); JobsSchedulerTests (Swift) | every opts-less call (GE list); `weekdaySegments`/`countWorkingDays`/`addWorkingDays`; iOS gantt |
| 9 | Hours stay inside the work window | drag drop clamp + rollover J:18369, 18449; resize J:19024 | untested (WorkDayClockTests covers the Swift port) | day view (5–21); cursor anchoring; updTask; iOS; server |
| 10 | Nothing scheduled before now | week/month drag (Business, J:18567 / 18638); day-view move and left resize, all tiers (J:16884, 16892) | untested | right resize; Basic week/month; placing / tray; saveEditJob; iOS; server |
| 11 | The left edge only moves forward | `shrunkStartH` `max(storedSH, …)` + 5-min floor J:9890–9899; `rowPushHours` forward only | row-push-test (forward cases) | — |
| 12 | Only the lowest level gets a bar | `onTeam && !hasLiveChildren` J:16577 | row-push-test (`isAssignedHere`, an app-dead equivalent) | AI suggest / capacity use `!(subs).length`, which ignores `deletedAt` (J:9497, 27603); iOS panel fallback |
| 13 | History and records take no part in pushes | S:864, S:875 | row-push-test :137–155, :460, :469 | — |
| 14 | A partly worked op splits when dragged | week/month inline split J:18673–18722; `applyWorkedSplitGuarded` J:9783 (dead path) | untested | — |
| 15 | Person ids compared as strings | `sameId`/`onTeam` J:3424–3425; doctrine J:3411–3422 | untested | strict `===`/`includes` in about 20 scheduling sites (defect list) |
| 16 | Permission to move / reassign / edit / approve | client `can()`; server `classifyTaskChanges` | **untested** (no script imports task-perms) | — (the only schedule rule the server enforces) |

### INV.1 Test inventory

All node scripts pass at `0fbc639`.

| Script | Result | What it really exercises |
|---|---|---|
| `row-push-test.mjs` | 133/0 | Real `statsMath` exports: `rowPushHours`, `barLengthHours`, `rowSlackHours`, `badgeOffsetPx`, `labelInsetPx`, `labelSegmentIndex`, `flushRightWidthPct`, `shiftRangeForward`, `hasLiveChildren`. Also app-dead `idleLeftOfCursorH` and `isAssignedHere`. The "pan stability" checks feed identical inputs, so they cannot catch the J:17541 call site. |
| `no-overlap-test.mjs` | 44/0 | Mostly app-dead helpers (`intervalsOverlap`, `rowOverlaps`, `firstFreeStart`, `packActiveRow`, `normalizeToWorkTime`). Fixtures use `durationH`, which the app never sets. |
| `worked-spans-test.mjs` | 94/0 | Real functions, including the app-dead `pushedBarRange` and `workedSpansForPerson`. |
| `live-hours-test.mjs` | pass | Real `liveElapsedHours`, plus frozen copies of old code as a baseline. |
| `job-live-hours-test.mjs` | 20/0 | Regex over a 900-character source slice, plus a **local copy** `live()`. No multi-clock coverage. |
| `check-live-hours.mjs` | clean | A lint over js/jsx/mjs/kt. **Skips Swift.** |
| `live-hours-native-grid.mjs` | no assertions | Reports 8 behaviour changes across 5 native variants; always exits 0. |
| `render-perf-test.mjs` | 35/0 | Source regexes + benchmarks of hand-written copies. |
| `assignee-col-test.mjs` | 77/0 | Jobs grid, not the schedule. |
| `timeclock-itest.mjs` | 47/0 | Real handler with stubs: jobClockOut, adminJobHours, clockOut. No jobClockIn, no updateJobSession. |

- **`npm run build`** runs `check-live-hours` plus assignee-col, org-options, render-perf and job-live-hours. It does **not** run row-push, no-overlap, worked-spans or live-hours.
- **Untested web schedule code:**
  - `walkProductiveHours`, `walkProductiveHoursBack`, `buildDayWindows` (module-private, so not importable)
  - `weekdaySegments`, `addBD`/`diffBD`/`nextBD`
  - `reflowJob`/`reflowPhaseOps`/`rollUpJobDates`, `recalcBounds`
  - `previewPush`, `applyPushes`, `enforceNoOverlap`, `checkOverlapsPure`
  - `shrunkStartH`, `persistShrink`, `finishedOpFields`, `applyWorkedSplit`
  - `personDeptMatch`, `blockedByActiveClock`, task-perms
  - all render x/width/cursor math, and all drag and resize math
- **iOS tests (read, not run):**
  - SchedulePacker, WorkDayClock (a line-for-line port of J:651–716), JobShifts, JobsScheduler, ProgressHours, ClockOverlays, JobHealth (drifted from web `getHealth` J:817).
  - Not tested: `GanttView` item selection and geometry, `rescheduleUnit`, `hasDependents`, `liveHours(forOp:on:)`.

---

## G. GAPS

### G.1 Survey disagreements, resolved against the code

| Claim | Resolution |
|---|---|
| The geometry and interaction passes treated `renderGantt` as the live Jobs gantt | **Dead** ✔ (J:15087 vs J:4765 / 5381). Its move, resize, split, reassign and confirm-modal logic, and its moveLog writes, never run. The live gantt is the read-only split gantt. |
| "The push block after J:18642 is reachable for PTO drags" (my first read) | **Wrong.** PTO drags return in their own branch (~J:18115) ✔, so J:18796–18946 is unreachable for every bar. |
| "`moveLog` is a free log field" | **No.** The free field is `apprLog` (task-perms.js:35) ✔. `moveLog` needs editJobs. |
| "Worker task writes 403" | **Confirmed** ✔: `status`/`loggedHours`/`pendingSession` need editJobs, and `can()` is false for non-admins. The data pass also executed it. |
| "The Mac has a schedule" (implied by `docs/MAC-SCHEDULE-PARITY.md`) | **No** ✔: `NativeShell.swift:257–263` is a placeholder. |

### G.2 Where `DYNAMIC_SCHEDULE_HANDOFF.md` disagrees with the code (the code wins)

1. **Branch state.** The doc says the work lives on `feature/dynamic-schedule`, is "NOT PUSHED" and "nothing merged". The code: everything is on `master`, and the feature branch is 0 ahead and 17 behind.
2. **Date.** The header says last updated 2026-09-18; the body contains 09-21 and 09-22 sections that overrule earlier ones.
3. **Deleted functions.** `computeCascadePushes`, `runClockCascade`, teleport and the 5-second cascade tick are all deleted (J:10077–10080). The tick only bumps a counter (J:6225–6239).
4. **Live bar.** The live sliver, drain mask and "LIVE" badge are gone (J:19480). Their helpers are dead, and `liveBadgeFor` returns only held/paused.
5. **Shrink.** The doc says remove `shrunkStartH`; it is live (J:9890, used at 17183 and 17880), and `persistShrink` runs at J:22639.
6. **Approved bars.** The doc says "no reposition, ever" and that `walkProductiveHoursBack` was reverted. `finishedOpFields` rewrites start/end/hours from a backward walk (J:9985).
7. **Push.** The doc says it "can only lengthen a bar" via `_pushIdleH`. `rowPushHours` translates bars, and `_pushIdleH` has no matches.
8. **Clocked-in exemption** (§3a). `hasActiveSession` is passed but ignored (S:932–935).
9. **Idle region from spans.** Head `_fillSpans` is always `[[0,100]]` or `[]` (J:19324).
10. **`data-divider-pct`.** It is the segment cursor; the op value moved to `data-op-divider-pct`. `data-unclosed` is undocumented.
11. **`activeBarFill`.** The doc gives a scalar signature; the actual one is `(T, bc, spans, dividerPct, state, renderPx)`.
12. **Tails.** The doc says tails are plain blocks; they are filled per segment (J:19468).
13. **"Someone is on this job" refusal.** Week/month grid only; the day view doesn't check.
14. **`updateJobSession`.** It also merges `pausedMsAtCheckpoint` and `unclosedAt`. The comment at `fn/timeclock.js:1196` is also wrong.
15. **Counts.** "84 assertions" is now 94; the 17-site live-hours census is now 7 files.
16. **Stale line numbers.** Throughout; e.g. J:15269 → 16890, J:11604 → 12838, AppState.swift:2335 → 3252.
17. **Environment.** `.git/info/exclude` here does not list `tools/verify/`.

Still open, as the doc says, and still present in the code:
- a drag writing only `startHour` can invert start/end (J:16890; updTask is a shallow merge J:10543);
- null-`startHour` semantics are undecided (J:10070);
- the iOS live-hours helper is unfixed and carries a false comment (HoursCalculator.swift:43–49);
- iOS progress creeps during lunch;
- raw id comparisons remain;
- the split has never been dragged or tested;
- two pushes coexist;
- there is no "hours complete, awaiting approval" signal;
- style and geometry share one JSX attribute.

The teleport gap is moot, because teleport was deleted.

`docs/MAC-SCHEDULE-PARITY.md`:
- stale line numbers (`renderTeam` 13902 → 16379, `getPersonBars` 13976 → 16472);
- wrong `personStatus` values (actual: lunch/break/job/idle/offline, J:539);
- Swift names are `WorkDayClock.day/walk`;
- it lists `walkProductiveHours`/`dayWindowCfg` as missing in Swift, but `WorkDayClock` has them.

Comments in the code that are now false:
- S:974–979 and J:9738–9749: "every path that places an op asks THESE functions";
- S:994–996: "`opInterval` mirrors `opHourRange`";
- S:854 and S:203: past work "reports what it owes with a badge" (the badge is gone, and past work is hidden);
- J:19289: unclosed is "emitted, not persisted" (it is persisted, J:7318–7342);
- J:19241: "the fill takes the scalar";
- J:16750: holidays are shaded;
- J:6254: "never from code in this file";
- `forgot-clockout.js:108–112`;
- `statsMath.js:195` (payhours date is now org-local);
- `db/sync.js:204–208` (mergeFullSlice does delete);
- GanttView.swift:201 ("schema doesn't carry time-of-day").

### G.3 Concepts with more than one definition

| Concept | Definitions |
|---|---|
| **`hpd`** | AI schema "per day, NOT total" (J:355, 375, 4833, 4896); schedule "total ÷ team size" (J:16480, 17847); day view "clock hours, not divided" (J:17124); J:15197 × calendar days; iOS gantt per-day rate × span; iOS progress/scheduler total; iOS JobShifts daily window. Fallbacks `?? 7.5` (J:6127), `\|\| orgSettings.hpd` (J:6391), `productiveHoursPerDay` (S:816). |
| **Overlap** | Five definitions (INV #1). |
| **Now cursor** | Three formulas on the schedule (GE.7), plus day view, split gantt, and `TD` frozen at load. |
| **Worked time** | Bar length uses the op total from `deriveWorkedState`; placement uses the row's own spans (J:17566, 17843); the split gantt uses a status guess (J:13079). |
| **Live hours** | `liveOpHours` (no manual pauses), `liveElapsedHours` (wall minus pauses), the shrink (minus pauses), server credit (minus pauses, ignores freeze), iOS (wall minus pauses, start day only). |
| **Work hours default** | 07:00/15:00 (state), 08:00/17:00 (`parseWorkHour`), 8/16 (`opInterval`), 5–21 grid, 7–18 shading, server `DEFAULT_WORK_END "15:00"`, iOS 8.0/17.0 fallback vs `default` 07:00–15:00. |
| **Lunch default** | 60 min (`buildDayWindows`, WorkDayClock) vs 30 min (state, day view, iOS `OrgBreak`). |
| **Day capacity** | `productiveHoursPerDay` (minus breaks and lunch) vs iOS `paidHoursPerDay` (minus lunch only) vs `checkOverlapsPure` `person.cap`. |
| **Split** | `applyWorkedSplit` (divides by team, copies moveLog, dead path), team inline split (walk, no divide, resets moveLog), gantt `_calcEnd` (flat pro-rate, dead). |
| **Parent date rollup** | `rollUpJobDates` vs `recalcBounds`. |
| **Finish request** | `pendingFinish` (server/iOS), `finishRequest` (singular, web + server), `finishRequests[]`. |
| **Finish audience** | web `userRole==="admin"` (J:11611, 11621) vs server `personCan(approveCompletions)` (`fn/timeclock.js:1937`) vs group approveCompletions (J:11550). |
| **Panel bar rule** | web `!hasLiveChildren`; iOS GanttView "on panel team, on none of its ops"; iOS JobsScheduler leaf rule. |

### G.4 Dead code in the schedule and gantt

- **Whole components:**
  - `renderGantt` (all of it, J:12451–13166)
  - the schedule subtask-row branch (J:17342–17400)
  - `renderMobileTeam` (J:24295)
  - the Reschedule-op modal (J:34741–34838)
- **Code paths:**
  - the week/month push block (J:18796–18946), including `applyWorkedSplitGuarded`, confirm-push and `clampUnlocked`'s only call site
  - copy/paste (J:11323, 11338, clipboard chip J:12944 / 17007)
  - `isExp=false` branch (J:18087)
- **Functions and variables:**
  - `cascadeDeps` J:10717, `toggleLock` J:10316, `runOptimize` J:10345, `previewPullBack` J:10249, `linkingFrom`
  - gantt `arrows` J:12485
  - `liveBarStyle`, `drainMaskStyle`, `LIVE_BAR_LABEL_MIN_PX`
  - `_workedCellsTotal`/`_workedRemainingBudget` J:19167
  - gantt and split-gantt `ws`/`_workedPctOfSeg`/`bL`/`bR`/`bW`
  - renderTeam `tW`/`totalH` J:16795
- **CSS and parameters:**
  - `.sched-person-glow` (J:1313)
  - the `hasActiveSession` argument
- **statsMath exports** tested but unused by the app: `pushedBarRange`, `packActiveRow`, `idleLeftOfCursorH`, `intervalsOverlap`, `rowOverlaps`, `firstFreeStart`, `normalizeToWorkTime`, `isAssignedHere`.
- **Data never read:** `unclosedAt`, `actualHours/actualStart/actualEnd/planned*`, Ably orgConfig slice, `person.autoSchedule`.
- **iOS:** `DatePickerSheet`, `ScheduleFocus`, `AppState.opLoggedDays`, `OrgSettings.productiveHoursPerDay`, the finished branch in `workedHours`.

### G.5 What was inferred rather than read

These are marked **[inferred]** above and in the defect list:
- the tasks and people sync stalling after a 403;
- lost updates between the server and a client autosave;
- the end-job double count of `loggedHours`;
- non-atomic one-clock check;
- `reflowJob` sibling moves surviving a rejected drag;
- week-mode resize having no visible effect;
- the push axis landing at a different clock time than the painted blocker;
- cursor-anchored bars vanishing after hours;
- the `TD` midnight skew;
- DST offset;
- z-order conflicts;
- holiday column misalignment;
- eng chip `NaN%` left;
- the "past check vs pushed bar" false refusal;
- spurious "assigned" pushes on a split;
- passive `onWheel` making `preventDefault` a no-op;
- the unmigrated payhours read path (S3 was not checked).

Everything else was read at the cited line. Nothing was run against live data.

---

## LESSONS

1. A test that passes on a path nothing executes is worse than no test. No test is a known
   gap; a green assertion over dead code is a gap that reports itself as covered, and it is
   found only by accident. Four of these turned up in a single day:

   - `web-gates-test`'s multi-line patterns could not match a CRLF working copy, so four
     `not:` clauses could never fire. Four permission gates read green while asserting
     nothing (#314).
   - Two assertions read a permission gate inside `reassignTask`, which had no callers. The
     gate they should have been watching — the week/month drag onto another row, added
     specifically to close a hole where "the reassign toggle gated nothing" — had no
     coverage at all until root cause 9 chunk 2.
   - `resize-test` passed `showLockedError` into a fixture for a parameter `resizeSession`
     does not read, for a function the app never called.
   - `css-dead-test`'s own check that no wired tab carries an inline `transition` matched
     tags with `className="..." [^>]*? style={{...}}`, which cannot cross the `=>` inside
     `onClick={() => ...}`. It found zero tags, ran its loop zero times, asserted nothing,
     and contributed nothing to the pass count — so there was not even a green line to
     notice. Written in the same sitting as this lesson, by the author of this lesson.

   The common shape is that all four looked like coverage in the file and in the pass
   count — and the last one did not even manage that, which is worse: a loop over an empty
   match set leaves no trace at all. Any assertion inside a loop needs a companion assertion
   on the loop's own count. What distinguishes a real assertion is that it can be made to FAIL: prove it by
   mutating the source and watching it go red, the way the reassign gates and the CRLF fix
   were proven. An assertion that has only ever been green has not been tested either.

2. A by-name search is only as good as its list of names. #137 reported copy/paste as gone
   because four chosen names had disappeared, while `copyItem` and `doPaste` sat in the file
   under names nobody had thought to search. A reachability fixpoint does not need the list.

3. A sweep that returns zero is when to check the sweep, not when to conclude the code is
   clean. Root cause 9 produced four false zeros, each from a different mistake, and every
   one of them looked exactly like a clean result:

   - The chunk 1 unreachability pass returned zero because a setter's own declaration was
     counted as an escaping reference, which silently disqualified every `useState` in the
     codebase — including `taskSubView`, the one case already known to be true (#319).
   - The chunk 3 custom-property sweep reported "0 declared, 0 unread" beside a live
     `var(--tq-surface-edge)`. Every one of the 32 properties is written through
     `setProperty` and none is declared in CSS text, so a `--x:` pattern matched nothing
     at all and reported that as nothing wrong. Three write-only properties were hiding
     behind that zero.
   - The first chunk 3 CSS parser sliced its chunks with a `<style>...</style>` regex over
     JSX, which swallowed `{SCREEN_CSS}` and let JS braces into the brace counter. It
     returned JS comments as selectors and double-counted rules.
   - The same parser folded a comment sitting above a rule into that rule's selector, so
     `.tq-lglass-noedge` was never evaluated as a class rule. It surfaced only when the
     parser was fixed for an unrelated reason — and it turned out to be a rule kept on
     purpose, with the reason written above it.

   Two shapes recur: a filter that is wrong about the data's actual form (properties are set
   from JS, not declared in CSS), and a parser that silently mis-slices (comments, braces).
   The cheap defence is a canary — search for something you know is there, and for something
   you know is not, before trusting the count in between.

4. A log nobody can read is not evidence. "Ship every refusal in log mode first, then
   look at what live clients trip" is only a strategy if the log can be read back, and
   `logRule` was a `console.warn` into the Netlify function log — which streams live and is
   gone afterwards, with no API to query it. Four flags sat in `log` for weeks waiting on
   data that was never being collected, and nobody noticed because the code that was
   supposed to collect it ran correctly every time. The tell was available the whole time
   and nobody asked it: where does this go, and who reads it? A recording mechanism needs a
   reader built at the same time, or it is a comment with a performance cost. The same trap
   twice over in the same system — a vacuous assertion is a test nothing executes, and this
   is a log nothing retrieves.

5. A verification harness you wrote yourself is not the project's. `npm run build` runs
   `npm run lint` first and then every suite in turn. I was running `npx vite build` — the
   bundler alone — plus my own glob over `scripts/*-test.mjs`, and calling that verified. So
   when a hoist put a reference above its declaration, eslint's `no-undef` reported it exactly
   as designed and nobody saw it, because the step that runs eslint was never invoked. The
   user found it by opening the page.

   The substitution hid the worse thing. The build listed 32 of 43 suites. Eleven were
   missing, six of them written during this campaign — basic-lanes, clock-atomicity,
   conflict-log, css-dead, finish-requests, session-hours — each proved by mutation and then
   never wired into the build meant to run it. My glob ran all 43, so they stayed green and
   their orphaning was invisible: a broader ad-hoc check concealed a narrower official one.

   Third surface of the same shape, after the vacuous assertion (1) and the unreadable log
   (4): something that reports as coverage and is not. An assertion nothing executes, a log
   nothing retrieves, a suite nothing runs. `check-suites-wired.mjs` is the guard — it fails
   the build when a suite in `scripts/` is unreferenced, and when the chain stops starting
   with lint. Run the project's command, not one that resembles it.

6. ABSENCE IS A CLAIM ABOUT THE WHOLE REPOSITORY, SO IT NEEDS REPOSITORY-WIDE EVIDENCE.
   Presence needs one hit; absence needs the search space exhausted. Treating them as the
   same kind of claim produced four retractions in two days, all with the same shape — search
   the first place the thing should be, fail to find it, report absence as a finding:

   - "`ai-schedule` has no source in this repository" (#336). It is
     `netlify/edge-functions/ai-schedule.ts`, tracked and on master. I searched
     `netlify/functions/` and stopped. Worse: `docs/.../2026-09-22-feature-inventory.md:42`
     already documented it as an Edge Function, in this repo.
   - "Neither native client has any concept of billing tier", with an iOS inventory of 70
     files / 32,190 lines. Measured in a checkout sitting on `fix/code-audit-2026-09-10`,
     never checked. Master is 130 files / 45,721 lines and iOS has 13 tier gate sites.
   - "`JobsScheduler.swift` and `JobShifts.swift` do not exist" (#239, #242). Both on
     master, with test files beside them. Same wrong branch.
   - BASIC_TIER.md written as greenfield scoping, while a 1,235-line rostering design with 23
     locked decisions sat on `origin/docs/rostering-design`. I searched `src/` and
     `netlify/`, never `docs/`, never another branch.

   THE CHECK — before writing "X does not exist", run all four. Any one would have caught
   every failure above:

   1. `git ls-files | grep -i <name>` and `git log --all --oneline -- '*<name>*'` — by the
      thing's NAME, across all branches, not by the directory it should live in.
   2. `git rev-parse --abbrev-ref HEAD` in any checkout before measuring it. A worktree and
      its parent are never on the same branch, and this repo has several of each.
   3. `grep -ril <name> .` from the repo root, not from the subdirectory I expect.
   4. `git branch -a` and look in `docs/` before writing any design or scoping document.
      Prior art on an unmerged branch is invisible to every other check.

   If only one directory has been looked at, the honest sentence is "it is not in
   `netlify/functions/`" — true, useful, and it would have produced none of the four.

7. A MECHANISM THAT HAS NEVER EXECUTED IS THE FOURTH MEMBER OF A FAMILY, and the family is
   now large enough to search for deliberately. Each one reports as present and does nothing:

   - a test that passes on a path nothing executes (LESSONS #1)
   - a log written where nobody can read it (#327 — Netlify function logs)
   - a suite the build never references (check-suites-wired)
   - **a guard that is declared, read, and never assigned** (#218 — `skipHistory`)

   `skipHistory` was declared at TRAQS.jsx:4872, read in the undo-capture condition at :4876,
   reset to false at :4881, and assigned `true` ZERO times in 33,000 lines. It existed to stop
   the undo stack capturing server writes, and it had never once run — so Ctrl+Z could revert
   another person's write for the whole life of the feature. Nothing failed, nothing warned,
   and the code reads as though the protection is there.

   THE CHECK: for any flag, mode or guard, grep its WRITE as well as its read. `grep -c
   'thing.current = true'` beside `grep -c 'thing.current'`. A zero on the write side with a
   non-zero on the read side is the signature. It generalises: an env flag never set, a
   capability never granted, a branch whose condition is never satisfied.

   Why the family keeps recurring: all four are the SAFE-LOOKING half of a pair. The dangerous
   half (delete the guard, drop the log) gets review; the safe half (add a guard, add a log)
   does not, so nobody checks it ever fires. When adding one, write the assertion that proves
   it fires before writing the thing itself.

8. GREPPING A NAME RETURNS THE THINGS NAMED AFTER IT, NOT THE USES OF IT. Three passes
   over #228 disagreed about whether `actualHours` was read, because every search for the field
   returned:

   - `actualHoursFor`, a ROLLUP FUNCTION that computes the same quantity from leaves and never
     touches the field;
   - `FINISH_RESOLUTION_FIELDS`, a permission CLASSIFIER listing the name without reading a value;
   - a comment at the write site asserting "It is read, at :12995 and :23864" — both of which are
     calls to `actualHoursFor`. The comment is itself an instance of the trap, and it was
     persuasive enough to have the entry marked wrong once already.

   THE CHECK: to prove a FIELD is read, search for the access, not the name — `\.field\b`,
   `{ field`, `field:` as a destructure — and exclude the identifiers that merely contain it.
   `actualHours` resolves to exactly two occurrences that way: the write, and a destructure in
   dragMove.js that DISCARDS it.

   The same trap bit this campaign's own test suite the same day, in the other direction: five
   assertions in `undo-scope-test.mjs` failed on their first run because the comment explaining
   each fixed bug QUOTES the buggy code, so "the bug is gone" matched the explanation of the bug.
   Slice function bodies from the code, not from the comment above it.

9. GREP THE RENDERED VALUE BEFORE THE MECHANISM, AND WHEN A HYPOTHESIS DIES, RE-SEARCH FROM THE
   SYMPTOM RATHER THAN EXTENDING THE CORPSE. Treysen reported the Edit Job wizard rendering
   dimmed and named a likely cause: the schedule's hover-dim, moved in root cause 8 from React
   state to a swapped rule in `<style id="tq-hover-dim">`. That was a reasonable hypothesis and
   it was wrong, and the whole investigation went into it.

   The hypothesis WAS disproved correctly: `renderModal` spans ~3,400 lines and contains zero
   `data-bar-dim` / `data-row-pids`, and the rule is attribute-scoped, so it cannot match the
   modal or anything inside it. The failure was what came next. Having killed the idea that an
   ANCESTOR dims the modal, the search kept walking UP the tree — `.anim-modal-box`, then
   `.traqs-glass .anim-modal-overlay > div`, then the `--tq-frost-bg` fallback — because
   "something above it is dimming it" had been accepted as the frame even after the specific
   mechanism was ruled out. Three more candidates were raised and killed. The modal was declared
   un-diagnosed.

   The answer was `opacity: 0.4` written inline on the rows themselves, inside the range already
   scoped and searched. Grepping `opacity:[^,}]*0\.[0-5]` over those same lines returns it as the
   SECOND hit. The symptom was a rendered value; the search was for a mechanism.

   Two checks, and the second is the one that costs most when skipped:
     - When a symptom IS a value on screen — an opacity, a colour, a width, a zero — grep that
       value first. It is a literal in the source far more often than it is computed.
     - When a hypothesis dies, go back to the symptom and search again from there. Do not
       generalise the dead hypothesis into a family and work through its relatives; that is how
       four candidates get raised and killed while the answer sits in lines already read.

   A third thing, cheaper than all of it: the report said "screenshot attached" and no image
   arrived. It should have been said immediately and the investigation held, instead of reasoning
   on without the one artifact that showed WHICH elements were dim. The screenshot named the rows;
   every wrong turn above came from guessing it was the container.

10. A GATE THAT FAILS WHILE ITS OWN EXPLANATION FINDS NO DIFFERENCE IS COMPARING THE WRONG THING.
    Treysen's rule, from #376, and it is a diagnostic rule rather than a fact about that bug.

    `schedule-parity-test` gated on a whole-file string compare and failed. The line directly
    below the gate parsed both sides and printed what differed, section by section:

        schedule-parity: FAIL — the web rules no longer produce the committed fixture.
          sections that changed:

    Empty. Every time, across two separate `git pull` sessions, on a build that stayed red for
    days. The suite was simultaneously asserting "these documents differ" and "no part of these
    documents differs", and both were true: they differed as BYTES (49,474 \r) and were identical
    as DATA. The empty list was the answer and it was read as the message being unhelpful.

    The check: when a failure reports a difference, make the failure NAME it. If the detail comes
    back empty, null, zero-length or "unknown", do not treat that as a gap in the diagnostics —
    treat it as evidence that the comparison and the explanation are looking at different things,
    and go find which one is wrong. Usually the gate is coarser than the explanation: bytes vs
    parsed values, reference vs structural equality, a whole file vs its fields.

    The same shape in the other direction is already LESSONS #1 and #7: an assertion that cannot
    fail, and a guard that guards nothing. This is the third face of it — an assertion that fails
    for a reason it cannot articulate. All three are found by asking the same question, which is
    not "is it green?" but "what exactly did it compare?"

11. I MEASURED THE STORE AND CALLED IT THE SCREEN. Treysen's framing, from #377, and it is the
    most expensive measuring mistake in this campaign because the number was not approximately
    right — it was confidently wrong.

    Asked whether the schedule draws bars from deleted jobs, I read `getPersonBars`, found it had
    no `deletedAt` guard anywhere in its 150 lines, counted the deleted-job ops in
    `tasks.json`, and reported that 531 of 551 bars — 96% of the board — were work that does not
    exist. I produced a per-person table of what would vanish. All of it was wrong.
    `GET /tasks` returns `filterLive(data)`: tombstoned jobs are stripped SERVER-SIDE and never
    reach the browser. The true count of phantom bars at Matrix is ZERO.

    The reader really does lack the guard. It cannot matter, because the data is gone three
    layers earlier.

    THE CHECK: before any measurement about what the USER SEES, establish what the CLIENT
    ACTUALLY RECEIVES. There are at least three filters between the store and the screen —
    the server filters on read (`filterLive`), the client filters on load (`normalizeTasks`,
    the view lists), and the renderer filters again (`takesPart`, `showCompleted`,
    `isTimelinePlaced`). A count taken at the wrong layer does not come out slightly high; it
    comes out describing a different system.

    THE RETRACTION CHAIN, because this is the fourth time a measurement sent the work the wrong
    way, and THREE OF THE FOUR ARE THE SAME DELETED-DATA MISTAKE IN MY OWN SCRIPTS:

      #347  "Tyler at 205%, the crew at 172%" — struck. Deleted jobs counted as live load. The
            real figures are ~21% and ~14%, and there was no staffing finding at all.
      #357  `measure-plan-gaps.mjs` shipped carrying the same bug, so the tool built to measure
            the schedule was itself counting deleted work.
      441   The "441 multi-day ops on the schedule" that framed the drag report was my own
            earlier count including deleted jobs. It made a drag question look like it was about
            most of the board. The live figure is 75, or 20 by the schedule's own predicate.
      #377  This one. The same data, now mistaken for what the browser holds.

    The common root is not carelessness about `deletedAt` specifically. It is reading the STORE
    because the store is easy to read — one GET, no app, no browser — and then describing the
    SCREEN. S3 is the easiest layer to measure and the furthest from what anybody looks at.

12. BEFORE REPORTING A FIELD MISSING, PRINT THE ROW. Treysen's rule, 2026-10-06, and it
    cost a recommendation rather than a measurement — which is the cheaper end of this
    family, and only because he asked for the evidence instead of the conclusion.

    Asked who was causing the enforce-mode refusals, I read
    `orgs/MTX2026TRAQS/rule-events.json` for a `caller` field, found none, and reported that
    the durable conflict record does not identify the client — and proposed adding it. The
    field is there. It is called `by`, written at `netlify/functions/_utils/rule-log.js:63`
    as `by: who.personId ?? null`, and every one of the fourteen records carried `by: 99`.
    My reader asked for a key that was never the key. Printing one whole record would have
    shown it in the first second; instead I was about to add a second field meaning exactly
    what the first one already meant, and the `caller`/`by` pair would then have drifted.

    THE CHECK, and it is one line: when a field is not where you expected it, DUMP THE WHOLE
    OBJECT before concluding anything about it. `JSON.stringify(rows[0], null, 2)`. Absence
    of a NAME is not absence of the DATA, and the same mistake aimed at a measurement rather
    than a recommendation is how #347 and #377 happened.

    This is the schema-shaped sibling of LESSONS #8 (grepping a name returns the things named
    after it) and #6 (absence is a claim about the whole repository). #8 is about searching
    CODE for a name; this is about searching DATA for one. Both fail the same way: the search
    was well-formed, ran cleanly, returned nothing, and the nothing was believed.

13. A WIRING ASSERTION MUST MATCH THE GUARD CONDITION, NEVER THE CALL TEXT ALONE — AND THE
    MUTATION SET FOR ONE MUST INCLUDE `if (false)`. Treysen's ruling, 2026-10-06, after the
    same mutant walked past three separate wiring checks: #389's clamp, #392's guard, and
    #398's date-cell routing. THREE TIMES IS NOT THREE MISTAKES, IT IS A MISSING CONVENTION.

    The shape every time:

        ok("the drag clamps the drop hour", /dropHour = clampStartHour\(/.test(CODE), true);

    and the mutant that satisfies it:

        if (false) dropHour = clampStartHour(dropHour, dayWindowCfg);

    The line is present, reads correctly, and never executes. This is LESSONS #1 — a green
    assertion over code nothing runs — reached by a different road: not a test on a dead
    path, but a test that cannot tell a live path from a dead one. The repair is to assert
    the WHOLE STATEMENT including its condition:

        ok("...", /if \(dropHour !== null\) dropHour = clampStartHour\(dropHour, dayWindowCfg\);/.test(CODE), true);

    A SECOND FORM OF THE SAME ERROR: an assertion that matches the NAME rather than the CALL.
    `/segmentsForBar/` is satisfied by the import line on its own, so a mutant that deleted
    the call and kept the import passed (#69/#70). Match the call site, with its arguments.

    THE RULE, for any assertion whose subject is "this code is wired up":
      - match the statement and its guard, not the callee;
      - match a call with its arguments, not a bare name that an import satisfies;
      - and run `if (false)` against it before believing it. A wiring check that has not
        been mutated has not been tested, and this is the one mutant it exists to survive.

14. A COUNT ASSERTION IS ONLY AS GOOD AS ITS PATTERN, AND A PATTERN SCOPED TO A SHAPE CANNOT
    SEE THE SAME THING WITH MORE KEYS IN IT. From the same day, #394. The consolidation's
    central claim was "there is now exactly ONE writer of `team`", asserted as a count:

        const writes = (CODE.match(/\{ team: [A-Za-z_]+ \}/g) || []);
        ok("no `{ team: … }` patch object remains", writes, []);

    It returned `[]` and was green while a FIFTH WRITER sat in the file:

        updTask(it.id, { team: [personId], start, end }, it.pid || null);

    `[A-Za-z_]+` matches a bare identifier. It does not match an array literal, and it does
    not match an object that carries other keys beside the one being counted. The write that
    mattered most — one patch setting WHO and WHEN together, with no refusal chain behind
    either — was the one shape the pattern could not express. It was found by reading a grep
    of `updTask(... { team:` while fixing something else, not by the assertion built to find it.

    THE CHECK: when counting occurrences of a WRITE, anchor on the CALL and the KEY
    (`/updTask\([^)]*\{\s*team:/`), never on a full object literal whose shape you have
    guessed. The thing you are looking for is "this field is written here", and every extra
    character of assumed shape is a way for the answer to be zero for the wrong reason.
    Sibling of LESSONS #3 (a sweep that returns zero is when to check the sweep) — this is
    the case where the sweep returns zero and the zero looks like success.

15. TO EXPLAIN A PAST WRITE, READ THE BUILD THAT MADE IT. One command, not run until three
    hypotheses had died:

        git log --format="%h %ad %s" --until=<the write's timestamp> -1

    #402's overlapping pair was written at 2026-09-29T20:59:32Z. HEAD at that moment was
    `e0e480d`, 46 minutes old. The reschedule run was then REWRITTEN three days later by
    `77efb7d` (#344). The line that set the hour — `startHour: _autoStartH` — exists in the
    build that made the write and does NOT exist in the working tree.

    So three separate readings exonerated three separate functions, and all three readings
    were CORRECT. `buildExpanded` really does not touch hours. `pickTeam` really returns no
    hour. `nextFreeStart` really returns h8 and h12. They were correct about today and
    irrelevant to the question, which was about a Tuesday nine days earlier.

    THIS IS LESSONS #11 ALONG THE OTHER AXIS. #11 is "I measured the store and called it
    the screen" — the wrong LAYER. This is the wrong MOMENT: reading the current source to
    explain a historical event, in a repository that commits several times a day and had
    eighteen commits between the write and the investigation.

    THE CHECK, before any archaeology:
      - date the event first, from the data (an S3 version timestamp, a rule-event `at`, a
        moveLog entry);
      - resolve the build with `git log --until`, and SAY which commit you are reading;
      - read that revision — `git show <sha>:path` — not the working tree;
      - and when the two differ, that difference is itself a finding: here it meant the
        cause had already been removed by an unrelated rewrite, which changed what needed
        fixing.

    The tell that should have triggered it: a value with NO LITERAL ANYWHERE in the current
    source. A grep for `15.5` across `src/` and `netlify/` returned nothing, and that was
    read as "it must be derived" when it also meant "it may not be here at all".

## DEFECT LIST

1. The server enforces no schedule rule (overlap, lock, department, business days, past, active clock); `fn/tasks.js` checks permissions only.
2. Week/month move never pushes, reflows or runs `enforceNoOverlap`; J:18796–18946 is unreachable (J:18642 always returns).
3. The live week/month move writes no `moveLog`.
4. Locked ops can be dragged in week/month; `_dragBlocked` omits `locked` (J:19164, 19388).
5. Day-view move and resize have no permission, lock, active-clock, overlap, PTO or department check (J:16820–16905).
6. Day-view reassign uses strict `target.id !== fromPersonId` (J:16890).
7. FIXED (day-view chunk B). The day view drew a hard-coded 05:00–21:00 grid with 07:00–18:00 shading while every other view moved onto the org calendar in root cause 6. Measured on Matrix (08:00–17:00, 60-min lunch, two 15-min breaks): 7 of 16 columns — 44% of the grid — were hours nobody works, and the shading lit 07:00–08:00 and 17:00–18:00 on top of that. FOUR hard-coded copies, not the three listed: the render's `HS = 5, HE = 21`, the group-row background, the person-row background, and `DHS = 5, DHE = 21, DNH = 16` in the drag handler — the last being the one that converted a cursor position into an hour, so a drag computed against a 16-column day while the columns on screen were something else. One `dayGrid` memo derives all of it from workStart/workEnd, and the SHADING is now the dead windows inside the day rather than an invented outside-hours band: on an 08:00–17:00 grid the old test `h < 7 || h >= 18` shades nothing at all, so every column read as work, lunch included. The org hours were already in scope — the packing two lines below the grid reads them. Includes #305.
8. Day-view drag assumes it shows today; pan, wheel and `goToScheduleJob` can move it (J:16849, 12418, 12445, 15430).
9. Day-view right resize overwrites a multi-day op's total `hpd` with ≤ 16 clock hours (J:16904).
10. Day-view handles anchor on `startHour ?? 8`, not the rendered position (J:17251, 17257, 16811).
11. CLOSED — already fixed, verified rather than re-fixed. The day view DOES divide by the team (`personShareHours`) and DOES walk the dead windows (`walkProductiveHours`), with a comment recording the exact bug this entry describes: "This read hpd as clock hours: a single-day op ran start + hpd straight through lunch, and a multi-day op with a start hour ran to 21:00 every day." What remained was the `Math.min(..., HE)` clamp against the hard-coded 21:00, which on any real org sat hours past the end of the day and never bound. HE is the org work end now, so a bar whose walk spills past the day stops at the edge of the grid. Folded into #7.
12. FIXED (day-view chunk B), and the entry was wrong about the disagreement. There is no 30-vs-60 split: `orgDefaults.js` sets `lunch.durationMinutes: 30` and `buildDayWindows` falls back to that same constant. The real defect is that the break/lunch overlay carried its OWN literal `{ time: "12:00", durationMinutes: 30 }` — two defaults that agree today and drift the moment either is edited. Now reads `DEFAULT_ORG_SETTINGS.lunch`, and the break-duration fallback with it. Never applied to Matrix, which sets lunch explicitly. See #331 for the same literal in five other places.
13. FIXED (day-view chunk B). The lunch/break overlay is positioned INSIDE the bar, so its percentages have to be measured from the bar's own left edge — they were measured from the org work start. Every overlay was shifted left by (rawS − wsH): on a bar starting at 10:00 in an 08:00 day the lunch marker painted two hours early, and the further into the day a bar began the further out it drifted. A bar starting exactly at the work start was correct, which is why it survived. Also drops a marker falling entirely BEFORE the bar, not just after it.
14. FIXED (day-view chunk B). The day view rendered `{!pOff && barPositions.map(...)}` — no bars at all on a PTO day — while week and month draw work over the PTO tint by z-order. A half-day PTO with work on it showed an empty row. RULING: match week/month. The day view was telling someone they had no work on a day they did; an overlap is readable where an empty row is a lie. Two views disagreeing about what a PTO day means was the defect, and week/month has the better answer.
15. FIXED (day-view chunk B). `liveBadgeFor` keyed on `jc.reservoirOpId` — the op a session is DRAINING — while the week/month bar and the row push key on `jc.opId`, the op actually clocked into (J:15953, J:17095). Two fields, two answers, so a HELD or PAUSED badge showed in one view and not the other for the same session. `opId` is right: the badge is about the clock. `shrunkStartH` still keys on `reservoirOpId` and is correct to — the shrinking bar IS the reservoir op — which the suite asserts, so a later sweep does not "fix" it.
16. Day-view before-now refusal applies on every tier; week/month only on Business (J:16858, 16887 vs 18567).
17. Cross-row record bars are draggable in the day view and write worked hours into `hpd` (J:16637–16648).
18. Week/month move checks overlap, PTO and past for the grabbed bar only; group and multi members are unchecked (J:18759–18776).
19. Multi-select drag reassigns only the grabbed bar (J:18759–18776).
20. Multi-select drag silently skips members with overdue hours (J:18233).
21. `_computeMonthMove` uses `addBD`/`diffBD` without org opts (J:18733–18739).
22. `_finalVWD` uses the flat pro-rate with opts-less `addBD` for the PTO check, a different end from the committed walk (J:18591–18595 vs J:18729).
23. The PTO check on drop uses a different end than the commit (J:18616 vs J:18729).
24. Drag overlap test `_opVisual` uses stored positions and counts hidden past ops (J:18481–18530).
25. The past check uses the stored start while the ghost shows the pushed position (J:18567 vs J:17646) [inferred].
26. The main drag ghost width is a flat pro-rate, not `walk.columns` (J:17664).
27. Group and multi ghosts leave the last segment uncapped (J:17710, 17735).
28. Group and multi ghosts ignore `pushBD` (J:17645).
29. Ghost radius 26 differs from bar radius `radiusXs`.
30. `_visualWD` is `ceil(hpd/ppd)` and ignores the start hour (J:18154).
31. Week/month resize calls `updTask` → `reflowJob` on every mousemove; the revert restores only the resized op (J:19058–19107, 10536) [inferred].
32. Week/month resize pushes one undo snapshot per mousemove (J:19078).
33. Week-mode resize writes only start/end, but length comes from `hpd` (J:19064–19080) [inferred].
34. Month resize `_computeHpd` stores a per-person span as the op's total `hpd` (J:18996).
35. Resize has no past check (J:19018–19130).
36. Resize has no PTO check (J:19018–19130).
37. Resize has no `blockedByActiveClock` check on drop (J:19108–19130).
38. Resize ignores holidays via opts-less `nextBD` (J:19097).
39. Resize of a panel or general-job bar skips revert, lock check, moveLog and push (J:19100–19123).
40. Resize checks only `team[0]` (J:19094).
41. Resize runs `previewPush`/`applyPushes` on Basic (J:19126).
42. A moveJobs-only admin gets 403 on every resize because `moveLog` needs editJobs (task-perms.js:35, 159).
43. `applyPushes` writes `moveLog`, so a moveJobs-only admin's pushes 403.
44. Split-on-drag writes `locked`, a new op and `loggedHours`, which need editJobs under a moveJobs gate (J:18673–18731).
45. Split-on-drag has no overlap, PTO or lock guard (J:18673–18722).
46. The team inline split doesn't divide `hpd` by team size (J:18665–18720).
47. Three split implementations disagree on moveLog, id scheme, team division and guard (J:9709, 18665, 12589).
48. Splits copy `team` to a new op, likely firing a spurious "assigned" push [inferred].
49. RESOLVED 2026-10-02 BY REMOVING THE CONCEPT, not by adding the button. The entry reads "there is no UI to unlock an op; `toggleLock` is dead" — and `toggleLock` was dead because the function had been deleted long before, leaving only its comment ("// Toggle lock on an operation") stranded in the file, which is what made it look like a missing button. Asked what `op.locked` was actually for before changing anything: applying the grep-the-write-as-well-as-the-read check from LESSONS #7, it had ~30 reads and EXACTLY FOUR WRITES, all four in the split path (`statsMath.splitWorkedOp`, dragMove's keep half twice, the Split Job modal). It meant one thing: THE ALREADY-WORKED REMNANT OF A SPLIT. There was no UI to set it and none to clear it, and `statsMath` already treated `locked || workedHoursShown > 0` as one category — so it was derivable from worked hours in the only case that produced it. RULED: the only real lock is an ACTIVE CLOCK; a clocked-out op moves freely, including one already worked on. So `op.locked` pinned precisely the ops that should move. RETIRED: the split no longer stamps it, `clearOverlaps` and `planPushes` no longer check it, the server's `lock` rule is deleted (the `activeClock` rule, which reads the PERSON's activeJobClock, is the real lock and is untouched), and the client's reads are gone. Nine test assertions across six suites were re-pointed rather than deleted, so a stray `locked` on older stored data cannot quietly become load-bearing again.
50. `reflowPhaseOps` moves locked and Finished ops (J:3461–3487).
51. `reflowPhaseOps` forbids two same-person ops on one day even when their hours don't overlap (J:3461–3487).
52. `reflowJob` and `enforceNoOverlap` move ops without a `moveLog` entry (J:3513, 9774).
53. `enforceNoOverlap` computes every shift against the pre-shift list (J:9786–9807).
54. Ops `enforceNoOverlap` refuses stay overlapping with only a `console.warn` (J:9786–9807).
55. `opInterval` reads `durationH`, which the app never writes, so single-day ops without `endHour` are zero-width (S:1003).
56. `opInterval` ignores length, overrun and push on multi-day ops (S:994–1010).
57. `opHourRange` and `opInterval` disagree though documented as mirrors (J:10069, S:994).
58. `previewPush` is day-granular and ignores `startHour` (J:9596–9630).
59. `previewPush` uses opts-less `addBD`/`diffBD` (J:9613–9619).
60. `previewPush` compares team with strict `.includes` (J:9601).
61. `checkOverlapsPure` is a daily capacity model, counts weekends and uses strict ids (J:9480–9508).
62. There are five inconsistent definitions of overlap (J:18512, 9608, 9750, 9480, 3461).
63. "Move only this one" deliberately commits an overlap (J:18941, 19136, 34826).
64. The row push axis is clock-linear while the render spends it lunch-aware, so collisions land off the blocker's end (S:183 vs J:17881) [inferred].
65. `rowPushHours` `dayFraction` isn't capped at ppd after hours (S:183).
66. `rowPushHours` needs sorted input, enforced only by the caller (S:182, J:17531).
67. `hasActiveSession` is passed to `rowPushHours` and ignored (J:17577, S:932).
68. Two row-push mechanisms coexist (`overrunPushH` and `rowPushHours`) (J:17497, 17552).
69. FIXED 2026-10-06, AND MEASURED FIRST — the entry was `[inferred]`, read from code and never observed. A cursor-anchored bar DOES paint on a non-working day, but not for the reason this entry implied. `weekdaySegments` is correct: for a Saturday-to-Saturday range it returns NOTHING. The render's fallback put the raw Saturday back — `const firstBarSeg = barSegs[0] || { start: _layoutStart, end: _layoutEnd }` and `segs: barSegs.length ? barSegs : [firstBarSeg]`. Reproduced headlessly on Matrix's calendar with a Mon..Sun window: left edge **71.429%**, squarely in Saturday's column, at every hour tried.

    THE GUARD BESIDE IT WAS NEVER WRONG. "Anchor on the first segment's start, not `_layoutStart`" works whenever segments EXIST, which is why this never showed in the ordinary weekend case — Trey's own observation, that anchored bars flow around weekends correctly, is accurate. It simply had nothing to work with when the list was empty.

    `segmentsForBar(segs, layoutStart, layoutEnd, nextWorkDay)` in `statsMath.js` now rolls an empty list forward to the next working day, which is what `nextBD` does for a non-working date everywhere else in the schedule. The bar then begins at the start of that day, with no hour offset, because the roll has already placed it — the rule the render already stated for a start landing on a weekend.

    REACHABILITY, since this is why it went unseen for so long: it needs the board OPEN ON A NON-WORKING DAY with an anchored op. Matrix works Mon–Fri. Same root as #70 — see there.
70. **CORRECTED AND FIXED 2026-10-06. THE STATED SYMPTOM WAS FALSE.** This entry read "After close, a cursor-anchored head collapses to zero width [inferred]". IT DOES NOT COLLAPSE, at any hour: measured width is 5.1587% from 06:00 to 23:59 on Matrix's calendar. The trigger ("after close") is right; the symptom is not.

    HOW THE FALSE SYMPTOM NEARLY GOT CONFIRMED, recorded because it is the shape of several entries struck this week. Reading `barSegmentsPct` in isolation, `w0 = Math.max(0, Math.min(budget, right0 - left0))` with an unbounded `left0` obviously collapses to zero once the offset exceeds a column — I predicted exactly that before measuring. It never happens, because `walkProductiveHours` CLAMPS the start into the day UPSTREAM (`clock = Math.min(Math.max(startH, workStartH), workEndH)`), so a late start still produces a multi-day walk, the first segment spans two days, and `right0` stays ahead of `left0`. A clamp in one function preventing the consequence a neighbouring function's arithmetic predicts is exactly why reading is not measuring.

    THE REAL SYMPTOM IS HORIZONTAL DISPLACEMENT. `startHour` reaches `barSegmentsPct` raw, and for an anchored bar it is `shopHour(Date.now())` — the wall clock, 0..24, never clamped (`shopTime.js:108`). The offset `((startHour − workStartH) / totalWorkH)` is therefore unbounded while the segment list it is measured against is clamped to working days, so past quitting time the left edge walks into the NEXT column. Measured, Wednesday's column being 28.571%..42.857%:

        12:00 -> 34.921  (Wed)        18:00 -> 44.444  (THU)
        17:00 -> 42.857  (Wed edge)   22:00 -> 50.794  (THU)

    The offset is now bounded to ONE column. 17:00 lands exactly on the boundary and that is NOT corrected — the right edge of Wednesday and the left edge of Thursday are the same instant, and an assertion demanding "Wednesday" there would have been fitting the test to the code. What was wrong was going past it: 1.11 columns at 18:00, 1.56 at 22:00.

    ONE DEFECT, TWO FACES, with #69: an unbounded hour offset against a clamped segment list. #69 is the segment list losing its clamp (the empty-list fallback); #70 is the offset losing its bound. **#70's after-5pm displacement is reachable any evening**, unlike #69, which needs a weekend.

    TESTED red-first, `scripts/bar-geometry-test.mjs`, 33 assertions, wired (75 suites). Six mutants, six caught, each by an assertion rather than a crash. THREE RESULTS FROM THE MUTATION RUN CHANGED THE CODE OR THE SUITE: a second clamp on the fraction was REDUNDANT (hourIn already bounds the quotient) and removing it changed no assertion, so the arithmetic now says it once; a fixture using placeholder strings made one mutant CRASH inside the calendar instead of failing, and a crash says the code broke rather than that the property is false, so it uses real dates; and the wiring assertion matched `/segmentsForBar/`, which the import line satisfies alone, so a mutant that deleted the CALL and kept the import sailed through — the same shape as the `if (false)` mutant that survived #389's wiring assertion.

    AND THE PROBE'S OWN LABEL HELPER INVENTED A FINDING BEFORE THE SUITE EXISTED. A bare `Math.floor(pct / one)` reported a bar sitting EXACTLY on Wednesday's left edge as being in Tuesday, because `28.571 / 14.2857` evaluates to `1.9999999999999998`. It was caught by reading the table rather than by anything structural; `columnOf` in the suite carries the epsilon and says why, because a measurement helper that rounds the wrong way at a boundary invents findings at exactly the boundaries under test.
71. `_visualEnd` ignores the push (J:16477–16499).
72. `TD`/`NOW` are frozen at module load (J:474).
73. The drawn now line uses `TD` while bar dividers use `new Date()` (J:19490 vs J:17772).
74. The schedule has three separate now-cursor formulas (J:17776, 19493, 19231).
75. `Date.now()` is read about 8 times per bar within one render (J:17772–19333).
76. The org timezone is ignored by all schedule geometry; everything is browser-local.
77. `productiveHoursBetween` is off by one hour on DST days relative to `getHours()` (S:442) [inferred].
78. `weekdaySegments`, `countWorkingDays` and `addWorkingDays` never skip holidays (J:578–620).
79. CORRECTED 2026-10-04: holidays ARE shaded. The grid header and the person rows shade every day where `!isWorkDay(day)` (J:15569 and J:15822 at f0490ce; J:16319/16576 on the snapshot this was found on), and since root cause 6 a bare `isWorkDay(day)` reads the org calendar, holidays included. WAS: Holidays are never shaded in the grid or headers (J:17332, 17617).
80. Bars likely paint across a holiday column and come up one column short [inferred].
81. Opts-less `addBD`/`diffBD` appear in `buildSessionSnapshot`, `placeTaskAt`, the pending drop, `findNextSlot`, `reflowPhaseOps` length, the tooltip and `clampUnlocked` (J:10083, 10638, 10657, 10325, 3467, 19561, 18219).
82. The `addBD`/`nextBD` loops have no bound and hang on an empty work week (J:625–626).
83. `walkProductiveHours` relies on sorted dead windows without sorting them (J:776).
84. `recalcBounds` doesn't skip undated or deleted nodes, unlike `rollUpJobDates` (J:10291 vs J:3491).
85. `updTask` panel moves shift by calendar `addD` (J:10562).
86. Import `shiftRangeForward` uses calendar days (S:769).
87. Unfinished past-due untouched work disappears from the schedule entirely (J:16548, 16574, 16597).
88. The bar sort comparator returns 0 for non-task pairs, so the order is unstable (J:16637–16642).
89. `handleTeamPan` hard-codes a 260 px gutter while `lW` is 250–510 (J:12397 vs J:16445).
90. Head and tail segments of one bar use different fill models (J:19324 vs J:19461).
91. The lunch gap is never painted on the head segment (J:19324, S:574–582).
92. RESOLVED BY DESIGN (root cause 8, chunk B). `activeBarFill` has no distinct paint for running, held, paused, worked or scheduled, and must not acquire one. The bar has one fill and more states than it has channels, so the fill was given a single job: PROGRESS -- how far the work has got, as plain colour / idle grey / hatch / spent. Clock state is the badge channel (LIVE, HELD, LUNCH, DONE, now including LIVE as text rather than a bare dot), constraint is the glyph slot, and "has run past its end" is the alert cap. Muting the fill while a clock is held or paused -- the obvious reading of this defect -- would spend the one channel that answers the progress question on a question the badge already answers, and progress is the only thing the fill can say that nothing else can. scripts/contrast-test.mjs asserts activeBarFill keeps no clock-state branch, so this cannot be quietly undone.
93. Title and icon contrast is computed against idle grey on plain-colour heads (`_leftIsGrey`, J:19356).
94. `_ownerOnTheClock` is named the opposite of what it means (J:19311).
95. DONE bars are muted twice (`barPaint` then `spentBarFill`) and faded to 0.7 (J:2895, 2514, 2903).
96. DONE title and hours text contrast against `bc`, not the spent fill (J:19405–19406, 17256).
97. The hours label contrasts against `bc` even over hatch, idle or spent fill (J:19406).
98. The hours tooltip says "h left" but shows total length (J:19406).
99. When the label moves to a tail, the head still shows DONE/HELD/hours and the tail repeats the hours (J:19404–19406, 19470–19474).
100. Tails never show lock, dep, DONE or HELD marks (J:19426–19478).
101. The overrun extension has no distinct paint and no badge (J:17795).
102. Overrun bars can't be dragged at all (J:19164).
103. There is no visual state for pending finish, finish requested, overdue vs `dueDate`, non-Finished job status, or the unclosed clock.
104. The dep-group "locked" glyph is the same padlock as an op lock (J:19395–19396).
105. Hover dimming keys on `task.pid`, so panel and op bars never dim as siblings (J:19184, 19391).
106. Eng chips are never dimmed, filtered or tier-gated (J:18079).
107. Eng chips with no Wire op and no panel start get `left: NaN%` (J:16618) [inferred].
108. All-done eng chips never leave the schedule.
109. Eng chips are positioned by an op titled "Wire", coupling data to display text (J:16648).
110. Eng-chip text is hard-coded `#fff` on green/blue (J:18081).
111. The lock border and grips are white, which disappears on light themes (J:19390, 19392, 17252).
112. The select border and check are hard-coded `#fff` (J:19390, 19394).
113. `_schedDk` uses `hexLum < 0.5` instead of `wantsLightText` (J:16753).
114. The highlighted bar ties the sticky column at z10 and paints over names on scroll [inferred].
115. The today line crosses the sticky name column in month zoom (J:19498, 17602) [inferred].
116. The external live label overlaps neighbouring bars (z8 over z4) [inferred].
117. `barDropIn` and `scheduleGlow` animations override dim, fade, hover, selected and locked styles (J:1039, 1043).
118. The row-header team-number label differs between day and week/month (J:17221 vs 17607).
119. FIXED (chunk A). Lanes were one lookup by op id, applied to the head segment. A multi-day bar overlaps different things on different days, so its tail, ghost and dot kept full height and painted over whatever shared their day. Lanes are keyed by (op, day) now and read per segment through `_laneGeom`, which is the same arithmetic the head uses so a tail cannot drift from it. PARKED 2026-10-02 pending the shift type — see BASIC_TIER.md. The fix as committed stands and is not being reverted; what is parked is the DEFECT, because a Basic bar does not have its real shape yet. Basic has no job layer, so a Basic bar is a SHIFT (start, end, notes, location, who's on it) and not a flat job carrying hpd, a team share and worked hours. Fixing lane behaviour for a Basic bar before deciding what a Basic bar is would repeat the mistake that produced 6257ee3. SPECIFIC TO THIS ENTRY: RULED 2026-10-02 — a shift CAN cross midnight (22:00-06:00 is normal in manufacturing), so a shift is a two-day object and this entry SURVIVES the shift type. It was the one parked lane defect whose fate turned on that question. A night shift is the normal case, not an edge case: it needs a head on the start day and a tail on the next, which is exactly the per-segment `(op, day)` lane keying this fix introduced. Expect the approach to carry over to shift bars rather than be rewritten — of the five, this is the one whose MACHINERY is reusable even though its subject changes.
120. FIXED (chunk A). Two filters dropped bars from laning entirely: `b.task?.startHour != null` excluded any bar with no stored start hour, and `(b.task?.hpd || 0) > 0` excluded any with no estimate. Both are still DRAWN — the first from the start of the working day, the second at barLengthHours' full-day fallback — so both overlapped freely. `basicLanes` lanes them where they paint. PARKED 2026-10-02 pending the shift type — see BASIC_TIER.md. The fix as committed stands and is not being reverted; what is parked is the DEFECT, because a Basic bar does not have its real shape yet. Basic has no job layer, so a Basic bar is a SHIFT (start, end, notes, location, who's on it) and not a flat job carrying hpd, a team share and worked hours. Fixing lane behaviour for a Basic bar before deciding what a Basic bar is would repeat the mistake that produced 6257ee3. SPECIFIC TO THIS ENTRY: this one is REAL and gets BIGGER, not smaller. An all-day shift has no start hour, so the `startHour != null` filter is directly on point rather than an edge case; and a shift carries no hpd at all, so the `hpd > 0` filter would have excluded EVERY Basic bar. Expect this to survive the shift type intact.
121. FIXED (chunk A), with #123 — one defect seen from two sides. Lanes measured `walkProductiveHours(startHour, personShareHours(hpd))`, the STORED estimate, while the bar is PAINTED by barLengthHours (J:16100, not tier-gated), which adds `max(0, worked - est) / teamSize`. The lane range now comes from the painted length. PARKED 2026-10-02 pending the shift type — see BASIC_TIER.md. The fix as committed stands and is not being reverted; what is parked is the DEFECT, because a Basic bar does not have its real shape yet. Basic has no job layer, so a Basic bar is a SHIFT (start, end, notes, location, who's on it) and not a flat job carrying hpd, a team share and worked hours. Fixing lane behaviour for a Basic bar before deciding what a Basic bar is would repeat the mistake that produced 6257ee3. SPECIFIC TO THIS ENTRY: this asserts a configuration that CANNOT EXIST under the tier definition. The defect is overrun — barLengthHours adding `max(0, worked - est) / teamSize`. A shift has no estimate and no time logged against work, so a Basic bar can never overrun. The fix is harmless (painted length of a shift is just start-to-end) but the defect is unreachable. Expect this entry to be CLOSED rather than re-fixed once shifts land.
122. FIXED (chunk A). `singleDayStacking` was not tier-gated, so a Basic row got BOTH: the packing moved a bar's start hour to sit after the one before it, and then the lanes split the row for an overlap the packing had just removed — two different answers to the same question, applied one after the other. Packing is a Business behaviour (it is the schedule deciding where work goes); Basic shows a bar at the hour it was given and splits the row when two genuinely collide. PARKED 2026-10-02 pending the shift type — see BASIC_TIER.md. The fix as committed stands and is not being reverted; what is parked is the DEFECT, because a Basic bar does not have its real shape yet. Basic has no job layer, so a Basic bar is a SHIFT (start, end, notes, location, who's on it) and not a flat job carrying hpd, a team share and worked hours. Fixing lane behaviour for a Basic bar before deciding what a Basic bar is would repeat the mistake that produced 6257ee3. SPECIFIC TO THIS ENTRY: REAL, and strengthened by the definition. `singleDayStacking` was not tier-gated, so packing moved a Basic bar's start hour. Basic is explicitly ALL MANUAL — nothing should ever move a Basic bar. The strongest survivor of the five.
123. FIXED (chunk A), and the entry had the mechanism wrong. "Basic overrun growth runs without push" — the push does not run on Basic at all: the whole cursor-push/overrun-cascade block is wrapped in `if (billingTier === "business")` and says so. What runs is the GROWTH: barLengthHours is not tier-gated, so a Basic bar past its estimate is drawn longer while the lanes measured the estimate, and two bars that only collide once one has grown were handed the same lane and painted on top of each other. Same fix as #121. The comment above the old lane block asserted the opposite — "computed straight from each bar's own stored start/hpd, which is exactly where a Basic bar paints since nothing pushes or re-anchors it". Nothing pushes it; the conclusion still did not follow, because growth is not a push. Corrected in place rather than deleted, so the next reader sees the claim AND why it was wrong. PARKED 2026-10-02 pending the shift type — see BASIC_TIER.md. The fix as committed stands and is not being reverted; what is parked is the DEFECT, because a Basic bar does not have its real shape yet. Basic has no job layer, so a Basic bar is a SHIFT (start, end, notes, location, who's on it) and not a flat job carrying hpd, a team share and worked hours. Fixing lane behaviour for a Basic bar before deciding what a Basic bar is would repeat the mistake that produced 6257ee3. SPECIFIC TO THIS ENTRY: same as #121 — overrun growth cannot occur on a bar with no estimate and no worked time. Expect it CLOSED rather than re-fixed. The correction recorded in this entry about growth-not-push remains accurate for BUSINESS bars and is worth keeping for that reason.
124. RESOLVED as a product decision 2026-10-02 — see TIERS.md. `reflowJob` is passed `overlap: null` for Basic but is not itself tier-gated, so a Basic org still gets its ops serialised despite the "visual only" rule. It is one of four write paths (#2 landing refusals, #3 this, #5 group drag, #6 conflict blocking) that are internally consistent and unenforced, and together say one thing: Basic does not rearrange your schedule for you. That is now STATED in `src/tiers.js` as "Automatic scheduling — overlap clearing, reflow, dependency cascade, conflict blocking" rather than being left to inference, which is the real fix here: the table's SILENCE on this line is what let a later reader (me) treat nine deliberate gates as drift, because with nothing written down every gate looked as arbitrary as every other. It stays unenforced, and that is correct rather than deferred — see #125: there is no payload a server could refuse, because a person can produce the same arrangement by hand.
125. OPEN, and BIGGER after the 2026-10-02 correction — see TIERS.md. Billing tier is enforced in exactly TWO places server-side: `org.js:276` (the email-domain allowlist) and `tasks.js:68` (the overlap rule). `clients.js`, `settings.js`, `user-settings.js`, `timeclock.js` and `_utils/can.js` contain no reference to billing tier at all. Everywhere else the tier exists only in the browser, and `billingTier` is seeded from localStorage before the real value is fetched — so a Basic org sending Business-shaped data is simply accepted, by an old client, an edited cache, or curl with a valid token. This was briefly considered RESOLVED by commit 6257ee3, on the reasoning that if nine of the eleven gates became Basic there was nothing left to enforce. That commit is reverted, so the opposite holds: nine deliberate, PAID-FOR distinctions are enforced in the browser and nowhere else. Split by whether a server could actually refuse the payload — ENFORCEABLE: the panel/op structure (a job with `jobType: "panel"` and nested `subs[].subs[]` is a shape Basic's own client cannot produce, so `tasks.js` could refuse it outright — the strongest candidate and the most valuable, since the panel/op tree is the headline Business feature); the job clock (the four actions carry no tier check and the action name alone identifies the feature); approval templates and Clients if their writes are to be tiered. NOT ENFORCEABLE, and this part stands independently of the correction: automatic scheduling (#2/#3/#5/#6) — overlap clearing, reflow serialisation, dependency cascade and conflict blocking are things the CLIENT does on your behalf, so no payload says "this was reflowed" and a person can drag ops into exactly the arrangement reflow would produce; Business there is the tier that gets more HELP, not more PERMISSION. Also not enforceable: the view guard, which is navigation over data the org already owns. `TIER_RULES_MODE` is still NOT built — defaulting to `log`, tier read server-side from billing.json and never from the client, recording to rule-events.json under a `tier-rule` tag, per `org.js:264`. Deciding to enforce a tier against live customer data is a product call, not a defect fix.
126. The split gantt colours panels by status and jobs fixed grey, ignoring `elColor`, `barPaint` and `barFade` (J:13178, 13257).
127. The split gantt progress fill is a status-label guess, not hours (J:13079).
128. Split gantt text is hard-coded `#fff` (J:13306, 13316).
129. The split gantt today line sits at mid-day, not the current hour (J:13327).
130. The split gantt is day-granular without push, overrun or cursor, so ops sit elsewhere than on the schedule.
131. Split-gantt `ws`, `_workedPctOfSeg`, `bL`, `bR` and `bW` are computed and unused (J:13262, 13278–13294). DELETED (root cause 9).
132. `renderGantt` is unreachable: `taskSubView` is never set to "gantt" (J:15087, 4765, 5381). DELETED (root cause 9): 674 lines, plus the state only it used — ganttContainerRef, ganttWidth/setGanttWidth and exp/setExp. The split gantt stays and does the same job; a second gantt meant every schedule fix had to land twice, and this copy had been missing them for months.
133. The schedule "subtask" row branch is unreachable (J:17342–17400). DELETED (root cause 9): 58 lines. Nothing ever assigned a row type of "subtask".
134. `cascadeDeps` has no callers (J:10717). DELETED (root cause 9).
135. The Reschedule-op modal is never opened (J:34741–34838). WIRED (root cause 9): a "Reschedule operation…" item on the bar context menu, gated on moveJobs, opening the modal with the op and its panel. It is the only way to move a bar that is off-screen. The auto-slot button went with computeJobOptimize (#279); the modal keeps typed dates, the shared checks and the commit.
136. The Reschedule-op modal commits before confirm, so Cancel wouldn't revert (J:34829). RESOLVED by root cause 7 D, which rewrote the modal to refuse through refuseLanding before committing on Apply — in a modal nothing could open. Root cause 9 gave it the door (#135).
137. Copy/paste is unreachable (J:11323, 11338, 12944, 17007). PARTLY RESOLVED, and the earlier note on this line was wrong. It read "the symbols no longer exist", which was true only of the names I happened to search for — `copiedTask`, `pasteTask`, `handleCopy`, `handlePaste`. The HANDLERS survived under other names: `copyItem` (13 lines) and `doPaste` (23 lines) are still in the file, orphaned, and were found by the chunk 2 reachability fixpoint rather than by the name search that produced the original claim. A by-name search is only as good as the list of names, which is the argument for the fixpoint. The clipboard STATE is genuinely gone; the two handlers go with the chunk 2 deletions.
138. `clampUnlocked`'s only call site is unreachable (J:18217). RESOLVED: clampUnlocked no longer exists.
139. `runOptimize`, `previewPullBack` and `linkingFrom` are dead (J:10345, 10249). DELETED (root cause 9): runOptimize 63 lines, previewPullBack 40, the linkingFrom state and its Escape clear.
140. `liveBarStyle`, `drainMaskStyle` and `LIVE_BAR_LABEL_MIN_PX` are dead (J:2690–2743). DELETED (root cause 9): 59 lines including the comments.
141. `_workedCellsTotal`/`_workedRemainingBudget`, `isExp`, `tW`/`totalH` and gantt `arrows` are dead (J:19167, 18087, 16795, 12485). DELETED (root cause 9). Note the trap: there are TWO `tW` variables and only the gantt's was dead — renderTeam's is live — so this had to be cut by position, not by name.
142. The `.sched-person-glow` hover never renders; no `.sched-person` element exists (J:1313, 17603). DELETED (root cause 9): the element and both CSS rules.
143. The person card has no click handler; `canEditPerson` only colours the dead glow (J:17592–17603). WIRED (root cause 9): the card opens the person modal when canEditPerson, which is what that permission was being computed for — it had been spent entirely on colouring a glow that never rendered (#142).
144. Row reorder uses `Number(rid)`, so it no-ops for string `uid()` ids (J:10424).
145. Row drag to a group writes `role`, but rows group by `department` (J:10441, 10451 vs 16459).
146. Row reorder is ungated and persists array order for any user (J:10411) [inferred].
147. PTO drag and resize are gated by moveJobs while the PTO menu uses manageTeam (J:18093, 18953 vs 34176).
148. A PTO drag by a non-manageTeam admin is silently reverted in people.json but still edits the timeoff request (J:10470, `fn/people.js`, `fn/timeoff.js:325`).
149. `timeOff` entries have no id and are addressed by array index (J:10464, 16540).
150. Stale roster snapshots from settings overwrite concurrent `timeOff` approvals (J:28519–28597).
151. `timeoff.js` writes people.json without a fresh re-read (`fn/timeoff.js:429–432`) [inferred].
152. `placeTaskAt` is gated by moveJobs but overwrites `team`, which needs reassign (J:10639).
153. `placeTaskAt` and `handlePendingItemDrop` skip overlap, PTO, past, lock and department checks (J:10624–10673).
154. The pending-tray drop changes `status`, which needs editJobs (J:10664).
155. The pending tray ignores the item's `requiredDepartment` (J:35129).
156. The department rule isn't enforced on drag reassign, day-view reassign, placing, the tray, simple edit, the op editor picker or planAssign (J:18596, 10679, 10639, 10664, 26267, 35461, 31984).
157. RE-READ AND FIXED 2026-10-02 under the ruling that DEPARTMENT ABSENCE MEANS OPEN TO ANYONE. This entry assumed the auto-schedulers' fall back to all crew was a defect and that the server would refuse what they produced. BOTH HALVES WERE BACKWARDS. The server was already correct — `personDeptMatch` returns "primary" when no department is required, and `unitDepartment` has no title heuristic — so THE CLIENT WAS STRICTER THAN THE SERVER, not looser. And the thing actually creating constraints was `deptOfUnit`'s TITLE FALLBACK: an op NAMED like a department was treated as REQUIRING it. Measured on Matrix's live tasks.json before removal, of 484 live ops: 142 (29.3%) had a department stated, 231 (47.7%) had one INFERRED FROM THE TITLE, 111 (22.9%) had none. Matrix's departments are named exactly what its ops are titled — Wire, Cut, Layout — so against 18 live people an op titled "Layout" was assignable to ONE of them, "Cut" to one, "Wire" to five, and 71 ops titled "Layout" funnelled onto a single person. The fall-back-to-all-crew these entries called a bug only fires when ZERO people hold the department, which never happened here, so it never rescued anything. FIXED by deleting the title heuristic; `deptOfUnit` is now `unitDepartment(...) || ""`. WHAT SURVIVES OF THE ORIGINAL CONCERN: for an op with a department ACTUALLY STATED, falling back to all crew is still wrong and should fail loudly — the ruling's second half is that a stated department still excludes. That case is untouched here and remains open. (This entry named the fallback; see #289 for the same thing with the server claim attached.)
158. RE-READ 2026-10-02 — see #157. The Swift test asserts the department fallback as intended behaviour, and for an op with NO department stated that assertion is CORRECT: absence means open to anyone, so there is no constraint to fall back from. It is only wrong for an op with a department STATED, where falling back should fail loudly instead. No native work done; the test needs re-reading on the Mac against that split, not simply inverting.
159. FIXED (chunk A). The Basic simple edit wrote `subs.map((s, i) => i === 0 ? {...} : s)` — it rewrote subs[0] and left the rest, forcing that one sub to a single day and a single startHour and writing the team it had gathered from EVERY sub and op onto subs[0] alone, while the others kept their own. People ended up assigned twice and the dialog gave no hint any of it had happened. RULING: refuse, naming why — "this job has 3 panels, use the full editor". Warn-and-proceed still destroys the job for anyone who clicks through, and editing every sub invents a behaviour nobody asked for. `simpleEditable()` allows exactly the shape the simple CREATE makes: one flat sub with no ops.
160. FIXED (day-view/tier chunk A), and the entry's framing was too strong. `openJobDetailOrEdit` (J:9989) opened the Basic edit modal on ANY bar click with no `can("editJobs")` check — the one edit entry point in the app that had none; the context-menu Edit at J:31674 has always been wrapped in it. It is NOT the people-delete class, because root cause 4 put real gates on `/tasks`: the save needs editJobs for the title, moveJobs for the dates and reassign for the team, the legacy classifier decides even in `log` mode, and the client rolls back to the server copy on a 4xx (J:7992). So nothing was ever written. What a worker could do was open the dialog, make an edit, watch it appear and watch it vanish behind an error banner. Gated now; a viewer gets nothing rather than a read-only Job Details, because Basic deliberately has no details page and inventing one to fill the gap would be a bigger change than the bug.
161. The TRAQS Cloud tray opens the edit wizard with no gate (J:30485).
162. Add Dependencies and the dependency-mode toggle are ungated (J:33958, 34001).
163. The dep-mode toggle calls `saveTasks` inside a state updater with a stale closure (J:33958).
164. Bulk bar delete is gated by `isAdmin`, not editJobs (J:16921, 34882).
165. Bulk bar delete skips `blockedByActiveClock` (J:34882 vs 10703).
166. Bulk bar delete says "cannot be undone" but is undoable (J:34882).
167. Context-menu Delete on a schedule bar deletes the whole parent job (J:34012–34018).
168. "+ Add Member" is gated by `isAdmin` while the server needs manageTeam and drops silently (J:17061).
169. Complete Now requires editJobs + approveCompletions on the client but only editJobs on the server (J:11820).
170. `adminApproveJobFinish` writes `status`, so an approver without editJobs gets 403 (J:11647).
171. Set Worked Hours uses editJobs on the client and isAdmin on the server (J:32392, `fn/timeclock.js:1316`).
172. Web Request Completion writes `finishRequest` (singular), so a worker's request 403s (J:11593).
173. FIXED (chunk B). The web's `requestFinishApproval` wrote `finishRequest` and `finishRequests[]` and never `pendingFinish`, while the freeze effect (J:5691) and the Requests tab (J:19480) both key on that flag — so a request raised from the web never froze the session and no admin ever saw it. 9 of the 11 open-request moments in Matrix's sampled history are this exact state, each one an op still open with a pending entry nobody could act on. Fixed by construction rather than by adding the missing line: `openRequest` is the single writer of all three (#174), so the call site has nothing left to forget.
174. FIXED (chunk B). Three representations of one fact — `pendingFinish`, `finishRequest`, `finishRequests[]`. Measured across the sampled history of Matrix's tasks.json (251 of 42,760 versions), at every moment a request was open on ANY of them: 11 moments, 1 agreed across all three — 9%. `finishRequests[]` is now authoritative: it is the only form holding history (40 resolved entries), the only one that can express more than one request over an op's life, and the only one recording who asked and when. `pendingFinish` survives as a MIRROR written by `openRequest`/`resolveRequest` and nothing else, because iOS reads it and iOS cannot be changed here; no web code treats it as truth. The singular `finishRequest` is no longer written, only tolerated on read. `src/finishRequests.js` holds the lot, so a call site cannot set two of three. RECONCILIATION, for when the mirror and the list disagree: a pending entry is OPEN whatever the mirror says (absence of the mirror is not evidence of resolution — two paths fail to set it); `pendingFinish` true over an EMPTY list is OPEN and the entry is synthesised, because the flag is the only witness to an old iOS request and discarding it loses a real one; `pendingFinish` true over a fully resolved list is CLOSED, because the list names who resolved it and when, and a bit with no record behind it does not outvote a record that has one. The tie-break is not which source but which side carries evidence, and where the evidence runs out it errs OPEN: a false open costs one duplicated decision, visible and itself recorded, while a false closed silently destroys a worker's request and leaves their session held. `scripts/normalize-finish-requests.mjs` applies exactly that rule to stored data (dry-run default, idempotent). A no-op on Matrix today — 0 open, 0 dangling pointers, 0 mirrors to flip — which is precisely why it was run today: the only moment a three-way migration is free is while all three are empty.
175. FIXED (chunk B). `approveFinish` and `rejectFinish` on the schedule cleared `pendingFinish` and left the list entry PENDING and the singular pointer set — `finishedOpFields` deliberately does not touch them, because it is shared with the chat path which does its own bookkeeping, and the schedule path never did its own. The residue made an approved op read as still-requested to anything using the list. 1 of the 11 historical moments is this, on an op already marked Finished. Both now call `resolveRequest`, which closes the entry and the mirror together.
176. FIXED (chunk B). `const finishRequests = tasks.filter(t => t.finishRequest)` (J:11735) was a fourth reader with a fifth meaning: it read the deprecated singular pointer, at JOB level only, so it saw neither panels nor ops — which is every request anyone actually raises. Now `tasks.filter(t => pendingFinishOf(t))`, the same rule every other reader uses.
177. FIXED (chunk B). A finish request freezes the session — the effect at J:5691 stamps `frozenAtMs` so the bar stops where the work stopped while the decision is pending — and nothing ever sent `frozenAtMs: null` when the request was DECLINED. The worker was told to carry on and their bar never moved again. There was no way to fix it client-side: the comment at J:19532 is explicit that clearing `activeJobClock` locally is undone by the next /people poll, `updateJobSession` merges only two fields, and `savePeople` cannot touch a server-owned one. New narrow action `releaseJobSession` (same shape as `setOpWorkedHours`): `outcome: "resume"` lifts the freeze and leaves the worker on the job, `"clear"` ends the session. Gated on approveCompletions, admin, or the session's own person. A session that already ended answers `released: false` and 200, because a worker clocking out between the bubble opening and the button being pressed must not turn a completed decision into a failure.
178. FIXED (chunk B). The chat deny closed the request but skipped `revertSession`, so an op declined from a bubble kept the position the session had worked it down to — the bar stayed where the work had pushed it while the status said the work was not accepted. The Requests-tab decline has always reverted; the two surfaces simply disagreed about what declining means. The chat path now reverts and releases the hold (#177) the same way.
179. FIXED (chunk B). The chat approve never ended the session at all, not even optimistically — the schedule approve at least cleared `activeJobClock` in local state — so a worker approved from a bubble stayed clocked into finished work until somebody noticed. Both surfaces now call `releaseJobSession` with `outcome: "clear"`, which is the only thing that ends it on the server.
180. FIXED (chunk B), and the entry was WRONG about the premise in a way that changed how it was prioritised. It read "the server finishRequest path writes tasks.json from an unauthenticated PIN/kiosk request with a caller-supplied id". It is not unauthenticated: the action sits below the PIN gate at `fn/timeclock.js:2032`, which requires both a `pin` and a `personId` and verifies the PIN against that person — confirmed against the live endpoint, which answers 400 Missing pin, then 400 Missing personId, then 401 Invalid PIN. The `by` on the request was already the verified id. Three things WERE true and are now fixed: (1) no scope check, so any of the 6 PIN holders could raise a completion request against anyone else's work — now refused with 403 unless the caller is on `op.team` or is an admin; (2) no idempotency, so `finishRequests` grew by one entry per call with no dedupe and no cap, on a 509 KB file read and written on every save — now one open request per op, and a second ask returns 200 `{alreadyOpen:true}` rather than a 409, because asking twice is what a worker does when the first tap looked like it did nothing; (3) `personName` came from the body and was shown on the request and in chat, so the id was right and the name was whatever the caller sent — now always the roster name. The unreachable `(op.team || [])[0]` fallback went with them; `personId` is mandatory, so it could never run. Also removed a second S3 read of people.json that shadowed the one the PIN gate had already done. Severity in context: op ids are random strings and the PIN path cannot enumerate them (`/tasks` GET needs a bearer token), so this was a worker acting outside their scope, not a stranger with an org code.
181. Every worker (non-admin) task write — clock-in status, pendingSession, finish request, end-job loggedHours, persistShrink — gets 403 (J:22560–22652, 21521, 6258, 11607).
182. After one rejected save the client stays "unsaved" and the poll and slices stop refreshing tasks and people (J:8374, 8385, 8716) [inferred].
183. A failed save is never rolled back; every later whole-array POST resends the rejected change (J:8564–8575).
184. Direct `saveTasks` calls swallow failures with `.catch(console.warn)` (J:6274, 11617, 21533, 22584, 22652, …).
185. PARTLY ADDRESSED. The per-job stale-copy check in `fn/tasks.js` compares each POSTed job`s `lastModifiedAt` against the stored one and, in `enforce`, keeps the stored job and reports the id back. It WOULD have caught the #323 clobber: the clobbering write carried a different stamp from the stored one, which is exactly what it tests for. It did not, because `ruleMode` returns `log` for an unset env var and `TASK_CONFLICT_MODE` is set nowhere in the repo — so for months it recorded the conflict in the function log and let the write through. The detection is not the gap; leaving the switch in its off position is. That is why #323`s protection is unconditional and has no mode of its own. Note also that `enforce` is blunt where #323 is precise: it discards the client`s whole job, including legitimate concurrent edits, whereas restoring just the server-owned field keeps both. They are complementary, and turning `TASK_CONFLICT_MODE=enforce` on is still worth doing for `status`, `pendingFinish` and the finish-request list, which #323 does not cover and which concurrency-test still shows being clobbered in log mode. REVERSED 2026-10-02 — DO NOT FLIP TASK_CONFLICT_MODE TO ENFORCE. This entry's recommendation ("turning `TASK_CONFLICT_MODE=enforce` on is still worth doing") was written before the rule log could be read. The first real read shows why it would break the app: the client never advances its `lastModifiedAt` after a successful save, so from its FIRST write onward every subsequent save in the session is stale against the save before it. Five sequential drags produced five task-conflict records with an IDENTICAL incomingStamp. In enforce, four of the five would have been refused and rolled back, and that is normal editing rather than an edge case. The detection was never the problem — this is correct detection against a broken client. See #337. THE ORDER IS: fix the stamp (done, #337), let it run, confirm the log goes quiet, THEN flip. Flipping first would produce a guard that fires constantly and gets switched off rather than believed, which is LESSONS #1 in a different costume. COUPLING 2026-10-02 — there are now TWO preconditions on flipping TASK_CONFLICT_MODE, not one. The first is #337 (the client must adopt the stamp the server wrote; done). The SECOND is undo: `undo()` restores a deep copy of a previous state including its `lastModifiedAt`, so every undo posts stale stamps and trips the conflict check. In log mode that is noise in rule-events.json; in ENFORCE IT MEANS UNDO SILENTLY STOPS WORKING, because every undo is refused as a stale write. #218's fix does not address this — it stops undo CAPTURING server writes, it does not stop an undo REPLAYING old stamps. So the order is: #337 (done), then undo stops posting stale stamps (open, no entry yet), then read the log, then flip. BOTH PRECONDITIONS NOW MET 2026-10-02: #337 (the client adopts the server's stamp) and #338 (undo no longer replays stale stamps). The remaining step before flipping TASK_CONFLICT_MODE is EVIDENCE, not code: let it run in log mode, then read `orgs/{org}/rule-events.json` again. A quiet log is the result that permits the flip. Note what a NON-quiet log would now mean — with both the save path and the undo path fixed, a task-conflict record is much more likely to be a genuine two-editor race, which is exactly what the rule exists to catch.
186. RESOLVED — already fixed before this pass, both halves. The client no longer adds `res.hours` to anything: `handleEndJob` applies only the shrink edge and lets the tasks delta carry the hours, and there is no `res.hours` arithmetic left anywhere in `src/`. Removed in 1345f75. The panel half closed in b3eaf86 (2026-08-04), which added `creditPanelHours` — `jobClockOut` now credits job, panel and op. Verified by reading all three `jobClockOut` call sites; none credits locally. Closed by the chunk A verification, no code change needed.
187. FIXED (chunk A). Every pay clock-out added `hours` — the WHOLE shift — to `job.loggedHours` once per job in `jobRefs`, at three sites (`adminClockOut`, iOS `payClockOut`, kiosk `clockOut`). A worker who picked three jobs at clock-in and worked eight hours added twenty-four. `jobRefs` records what somebody expected to work on, not an allocation of their time, and there is nothing in it to divide a shift by; the job clock is what knows how long was spent on what. All three credits removed — the refs stay on the entry as the audit trail the timesheet UI reads, only the arithmetic is gone. Exposure in Matrix was small: 7 pay entries carry `jobRefs` at all (41.29h) and none references more than one job, so the multiplication never fired here.
188. FIXED (chunk A). The entry said `actualHours` is computed and never read. It IS read — `actualHoursFor` at J:6789, used at J:12995 and J:23864. The real defect is two definitions under one name: `finishedOpFields` WROTE it from payroll (`timeclock` rows whose `jobRefs` mention the op, summing whole shifts) while `actualHoursFor` READS production time, so an op worked 2h inside an 8h shift was recorded as having taken 8. `finishedOpFields` now calls `actualHoursFor`, so the value stored and the value read are the same function.
189. FIXED (chunk C). The freeze and drain-rebaseline effects ran in EVERY open browser, for EVERY clocked-in person, each with its own `Date.now()` — so the stored `frozenAtMs`/`drainCheckpoint` was whichever browser's clock landed last. Ownership by browser was considered and rejected: the freeze reacts to a finish request that usually comes from a phone or the kiosk, so gating it on the session's own browser would trade a write storm for a silent no-op whenever that machine is closed, and one user with two tabs is still two writers. Both reactions moved to the write that CAUSES them — the freeze into the `finishRequest` handler and into `/tasks` via `applySessionReactions` for a request raised from the web, the rebaseline into `/tasks` where the moveLog entry it was watching for is appended. One run, one clock, and it already knows which ops changed. The two useEffects are deleted.
190. FIXED (chunk C), as a consequence of #189. `updateJobSession` refuses a non-admin acting for anyone but themselves, and the two effects called it for every clocked-in person from every browser — so a worker's browser fired a 403 per other person per tick and swallowed it in `.catch(console.warn)`. With the effects server-side there is no cross-person client call left to refuse.
191. The `unclosedAt` effect gates on manageTeam while the server checks isAdmin (J:7334).
192. FIXED (chunk C), by removing the second writer rather than the second copy. `frozenAtMs` and `sessionSnapshot` live in both people.json (`activeJobClock`) and tasks.json (`op.pendingSession`); the problem was never the duplication but that different clients wrote each copy at different instants. Both are now written server-side from one place, and `frozenAtMs` is write-once in `updateJobSession`, so the two copies cannot drift. Measured before the change: 0 people with an `activeJobClock` and 0 ops with `pendingSession`, so there was nothing stored to reconcile — the fix is structural, not a repair.
193. FIXED (chunk C). Verified by reading, NOT by evidence: across 302 sampled versions of Matrix's tasks.json, 0 op-moments carried a `pendingSession` at all, so the double-stamp has no observed instances. The mechanism is real — the freeze effect's re-entry guard was a LOCAL `frozenAtMs` set by `setPeople`, which the next `/people` poll overwrote whenever the `updateJobSession` POST was slow or failed, and the failure was swallowed, so the effect re-fired and stamped a later instant. Closed twice over: the effect is gone (#189), and `frozenAtMs` is write-once in the merge, so a second stamp is a no-op whoever sends it.
194. FIXED (chunk A, with #199/#200). `jobClockOut` computed `clockOut - clockIn - totalPausedMs` — raw wall clock, consulting neither the org calendar nor `frozenAtMs` nor `unclosedAt`, both of which `updateJobSession` maintains and both of which pin the bar the admin is looking at. Credit and display were two definitions of a worked hour that disagreed by up to 14x. Both now call `sessionWorkedHours` in statsMath.js: `productiveHoursBetween` over the window `openSessionEnd` bounds, honouring the explicit hold and the end-of-working-day cap on a session nobody closed. 401944 Thacker II / CUT credited 67.84h for a Friday-afternoon session closed on Monday; the same session now credits 1.32h, which is what the bar had been showing all along.
195. `updateJobSession` does no validation of the fields it merges (`fn/timeclock.js:1221–1237`).
196. FIXED (chunk C). Confirmed in the data: six `(person, clockIn)` pairs in payhours appear more than once, the clearest being three rows sharing a clock-in instant to the millisecond with two of them written 2.1 seconds apart — two people do not press a button in the same millisecond. The other five are a day apart and fit a reopen-then-reclose cycle better than a race, so the race is real and rare. A THIRD site the entry did not name was also firing: `jobClockOut` appended to productionhours.json with `readJson` → push → plain PUT, and Matrix holds two `(person, clockIn, op)` triples recorded twice over, hours 4.13/4.15 and 0.62/0.62. If-Match applies and was already here — `updateStampedArray` → `updateJson` → `writeJsonIfMatch`, used by `jobClockIn` since root cause 3. The remaining paths moved onto it: `mutatePersonFresh` now goes through `updateJson` (which fixes `payClockIn`, `payClockOut` and `payLunch` at once), the kiosk `clockIn` uses it, and the productionhours append dedupes on `(personId, clockIn, opId)` INSIDE the conditional write. The guard must sit inside the mutate or the retry re-runs the write without re-running the check — asserted structurally in scripts/clock-atomicity-test.mjs rather than left as a convention.
197. LEFT OFF, deliberately, as a decision rather than a defect. `ENFORCE_CLOCK_JOB_DEPENDENCY` gates "must be clocked in for pay before working a job" and "cannot clock out while on a job" on all three surfaces. Disabled 2026-07-08 in 9b2e21c; the commit records WHAT and how to re-enable and gives no reason, and there is none at any of the five call sites or in the surrounding commits. Measured cost of turning it on: of 248 clocked job sessions, 39 (15.7%, 125.91h) began with no pay punch covering them — Caleb 24, Treysen 9, Quincy 6, no salaried exemptions. So it would refuse about one job clock-in in six as the shop actually works. RULING (2026-10-01): leave it off. The rule may be right in principle, but switching it on would block one in six with no warning and no recorded reason for why it was turned off. If it comes back it comes back as its own decision with the shop told in advance, not as a line in a defect pass.
198. People PATCH doesn't pin `activeJobClock`/`activeClockIn`/`activeBreak`, so a worker can forge their own session (`fn/people.js:239–265`).
199. FIXED (chunk A, with #194/#200). `liveOpHours` skipped `totalPausedMs` on the reasoning that pauses are lunch and breaks and therefore already outside the productive total. True of lunch, false of a deliberate `jobPause`, which sits inside a working window — so the live figure ran on through a hold and then dropped at clock-out. The blocker was that both kinds accrued to ONE cumulative field and could not be told apart; auto pauses now accrue to `autoPausedMs` as well, and `sessionWorkedHours` subtracts only the manual share. A session stored before the split carries everything in `totalPausedMs` and is treated as manual, which can double-subtract one lunch on a session in flight across the deploy — bounded, once, and never upward.
200. FIXED (chunk A) — the same defect as #199 seen from the three places it showed: the live bar, the shrink and the server credit. One definition now (`sessionWorkedHours`), so there is no longer anything for the three to disagree about.
201. FIXED (chunk A). A negative admin adjustment that found no manual credit to consume wrote a compensating row with `clockIn === clockOut` — "zero span, a correction not a shift". Every hours figure is a plain addition so the number dropped correctly, but the hatch is built from SPANS and a zero-length span moves nothing: erase 2h and the card said 2h less while the bar stayed exactly as grey. `workedSpansByOp` and `workedSpansByPersonOp` now subtract erased time from the spans, newest first — the same order the walk-back consumes manual rows in, and the only defensible one, since the most recent work is what an admin is correcting. Zero adjustment rows exist in Matrix, so nothing in production is restated by this.
202. FIXED (chunk C). `/sync` and the `?dataset=productionhours` GET both confined a non-admin to their OWN production rows, so every other person's progress on their schedule fell back to `op.loggedHours` — the counter #323 showed drifting. Measured: Max received 3 of 258 rows, so 255 ops' worth of other people's work was drawn from the counter rather than the sessions behind it; Quincy 35 of 258, Caleb 106, Treysen 114. Split by FIELD instead of by row: hours recorded against an op are schedule data — the same fact the bar draws — while what makes payhours PII is the pay-shaped half. A non-admin now receives `{id, personId, jobId, panelId, opId, clockIn, clockOut, hours, date}` for everyone and the full row only for themselves. PAYHOURS keeps its row-level scope: a shift is about a person, not about a job. Both readers changed, because fixing only `/sync` would leave a client that hydrates from the GET exactly where it was.
203. FIXED (chunk A), and the entry was wrong about the mechanism. It read "adds wall hours to a clock startHour, ignores lunch". The reverse: `persistShrink`/`shrunkStartH` add WORKED hours (`sessionElapsedMs` already subtracts pauses, and lunch pauses the job clock) to a WALL-CLOCK axis that still contains lunch — so an 08:00 start worked through to 13:00 across a noon lunch is 4 productive hours, and 8 + 4 put the edge at 12:00 while the worker stood at 13:00. The measurement was never the problem; the axis was. Both now convert through `walkProductiveHours`, the same function the bar geometry uses, and the server's over-cap guard with them. The start-day/end-day half was real: `storedSH` is the clock hour on the op's FIRST day and `op.endHour` on its LAST, compared directly, so a multi-day op could shrink only one day's worth before parking at the 5-minute sliver that is supposed to mean overrun — 441 of 890 scheduled ops are multi-day. A multi-day op now caps at the end of the working day instead; a day-1 coordinate cannot express day-3 progress and pretending otherwise produced the false overruns. Exposure was near zero: 3 shrink entries exist in the whole moveLog, all single-day, the largest 0.68h.
204. FIXED (chunk C). `finishedOpFields` placed the DONE bar by walking BACKWARD from the APPROVAL instant, so the historical record recorded when somebody pressed the button rather than when the work happened — approve on Friday something that finished on Monday and the bar lands on Friday. The session already knew: `frozenAtMs` is stamped the moment the finish request freezes it, and `actualEnd` has been writing it down all along without anything using it to place the bar. The walk is now anchored to the end of the WORK, falling back to the approval instant only when there is no frozen session. The length rule is untouched — still one person's share of the estimate, walked back through the day windows. `apprDS`/`apprH` became unused and were deleted.
205. FIXED (chunk C, with #206 and #324). Strict id comparisons on the clock path: 19 replaced with `String(a) === String(b)` across `jobClockOut`'s job/panel/op credit, `jobClockIn`'s status stamp, and the payhours entry/event lookups. Ids are mixed Int/String by the web's own admission — `stampArray` compares them as strings for exactly this reason — and on the credit path a type miss is SILENT: the hours are simply not credited and nothing reports it. Every fixture in the repo used string ids, so reverting any of this broke no test; clock-atomicity-test now stores NUMERIC ids and references them as strings, which is the shape that actually occurs, and that mutation is caught.
206. FIXED (chunk C) — see #205, same sweep.
207. Strict id comparisons in scheduling paths violate the `sameId` rule (J:5908, 9283, 9485, 9497, 9505, 9564–9572, 9601, 9795, 10329, 10485, 10680, 12726, 13258, 16890, 21515, 22563, 22567, 26491, 26603, 26733, 27411, 27603).
208. The op editor writes team ids as strings, which triggers those mismatches (J:35461).
209. AI suggest and capacity treat any `subs` as children, ignoring `deletedAt` (J:9497, 27603).
210. `hpd` has contradictory meanings across AI schema, schedule, day view, J:15197 and iOS.
211. `hpd` fallbacks disagree (`?? 7.5`, `|| orgSettings.hpd`, `productiveHoursPerDay`) (J:6127, 6391, S:816).
212. Org `hpd` is re-derived from gross work hours on every load and saved back, overriding the saved value (J:5881, 7741–7745, 8611).
213. Work-hour defaults disagree (07:00/15:00, 08:00/17:00, 8/16, 5–21, 7–18, server 15:00, iOS 8/17 vs 07–15) (J:5881, 5896–5903, 17119).
214. The lunch default is 60 min in `buildDayWindows` and 30 min elsewhere (J:676 vs 5881, 17146; iOS `Models.swift:1207`).
215. There are three end-of-day rules (client `openSessionEnd`, server after-hours with org tz, live hours in browser tz).
216. `cap` fallbacks disagree (`|| 8`, `|| productiveHoursPerDay`, `|| orgSettings.hpd`) (J:9234, 9486, 10931).
217. `loggedInUser` falls back to `people[0]` when no email matches (J:7641, 7682–7686).
218. FIXED 2026-10-02. Undo captured server writes, so Ctrl+Z could revert another person's write or a server-written field. ROOT CAUSE, and it is worse than the entry said: `skipHistory` — the one mechanism built to suppress capture on non-user writes — was declared, read in the capture condition, reset to false after it, and ASSIGNED `true` EXACTLY ZERO TIMES in 33,000 lines. It has never run, for the entire life of the undo feature, so every caller of the wrapped `setTasks` pushed a frame: the 30s poll, the Ably/IndexedDB rehydrate, the rollback after a refused save, and (briefly, a regression in d9cfb8d, fixed in 71b9408) stamp adoption. The poll guards on content equality, which is what makes this a data-loss path rather than noise: it only pushes a frame when the server genuinely has something the client does not. FIX: `setTasksFromServer`, a separate uncapturing setter, used by all four server paths. NOT a revived flag — reviving `skipHistory` would have rebuilt the precise pattern this file already post-mortems for `pollUpdateRef` a few lines below it: one boolean, several setters called back-to-back, React batching them into one commit, and whichever ran last deciding the flag for all of them. That bug cost 4,000+ byte-identical writes in six days. A separate setter cannot be got wrong by ordering. `scripts/undo-scope-test.mjs` pins it, including that a re-introduced unassigned `skipHistory` fails.
219. Undo is client-only; the server can't tell an undo from an edit. RULED 2026-10-02: LEAVE IT, and the reasoning is recorded so this is not re-raised as a defect. Undo being client-only is a real limitation — the server cannot distinguish an undo from an ordinary edit, so an undo is just another write and the usual rules apply to it. Making the server undo-aware is a PROTOCOL CHANGE (an intent flag on the write, or a dedicated endpoint, plus a matching concept in both native clients) for a feature nobody has complained about. The practical consequences are already handled elsewhere: #218 stopped undo reaching server writes, and #338 stopped it replaying stale stamps, which together remove the two ways a client-only undo could actually destroy data. What remains is only that the server cannot LABEL it, which costs nothing today.
220. FIXED 2026-10-02 — and it was THREE defects in one statement, not two. (1) `e.preventDefault()` ran BEFORE any permission check, and `undo()` early-returns on `!can("undoHistory")`, so a user without the right lost the browser's native text undo and got nothing in exchange. (2) No target check, so Ctrl+Z inside any input or textarea was dead for EVERY user regardless of rights. (3) NEWLY FOUND: `e.key === "z" && e.shiftKey` is unreachable — with Shift held `KeyboardEvent.key` is `"Z"`, so CTRL+SHIFT+Z HAS NEVER ONCE FIRED REDO and only Ctrl+Y ever worked. All three have the same shape, which is why they take one fix: decide whether the handler OWNS the event before consuming it, and compare the key case-insensitively. THE FIX ALREADY EXISTED IN THE FILE — the export designer's own Ctrl+Z handler lowercases the key and returns early on input/textarea/contentEditable; the main handler, 1,600 lines away, never got the same treatment. The effect now also depends on `_mayUndo` so it re-subscribes when permissions change.
221. `setPeople` has no undo history, so PTO and row moves can't be undone (J:5445). NOTE 2026-10-02: this is a DESIGN CHOICE, not a bug. `origin/docs/rostering-design` decision 18 states that `setTasks` is the only state setter wrapped by the history stack and `setPeople` "deliberately is not", and defers extending history to roster writes because overrides persist server-side rather than living in client state the way `tasks` does — so it needs a different mechanism, not a wider wrapper. The known consequence is recorded there too: a Basic admin who mis-drags a shift re-drags it. Leave as is; reopening it means overturning decision 18.
222. No schedule move notifies the affected worker (only team, status and finish changes do). RULED 2026-10-02, not built: NOTIFY ON A SCHEDULE MOVE, BUT ONLY WHEN THE MOVE CROSSES A DAY. A worker whose job shifted from Tuesday to Thursday needs to know; one nudged by an hour within the same day does not, and notifying on every drag would train people to ignore the notifications. So the trigger is a change in the op's `start` DATE for a person on its team, not a change in `startHour` and not a change in duration. TWO THINGS TO KNOW BEFORE BUILDING. (1) THE TIER SEAM. `notify.js` holds all six existing types and every one is a job event, which is what makes "Basic is everything except notify.js" enforceable at the function boundary (rostering-design §12.2, and its standing instruction not to add a Basic notification there for convenience). A JOB move is a job event, so it belongs in `notify.js` and is correctly Business-only — but the same need will exist for SHIFTS once the roster lands, and a shift move is a Basic event that must NOT go in `notify.js`. Decide the shift case when the roster is built; do not let the job case accidentally set the precedent. (2) THE SOURCE OF TRUTH IS ALREADY THERE: `moveLog` records `fromStart`/`toStart` per op, so the day-crossing test is a comparison the data already supports — this is a notification over an existing record, not new bookkeeping. BUILT 2026-10-02. Detection lives in `_utils/task-events.js` beside the other job diffs (`diffTaskEvents` now returns `dayMoves`) and the push is sent from `notifyTaskChanges` in `tasks.js`. NOT added to `notify.js`, and the distinction matters: `notify.js` is the CLIENT-CALLED endpoint where the caller declares a type, while a move is SERVER-DERIVABLE from the write that caused it — on the derived path it cannot be forgotten by a caller, and it is where the prev/next trees already are. The trigger is the `start` DATE compared as the stored YYYY-MM-DD string; deliberately NOT startHour/endHour (the within-day nudge the ruling excludes), not `end` alone (a duration change — the day the person turns up has not moved), and not a brand-new unit (that is an assignment, already notified). No Date is constructed, because a round-trip would reintroduce the UTC-day bug `localDay.js` documents. The move loop runs LAST and skips anyone already notified this write: a move is the LEAST specific thing that can happen to a unit, so someone newly assigned hears they were assigned and someone whose unit just finished hears the status, rather than two pushes landing on one person for one write. THE SEAM WARNING IS NOW IN THE CODE, at the top of `notify.js` rather than only here: that file is the job-notification boundary, every type in it is a job event, and that is what makes "Basic is everything except notify.js" enforceable at the FUNCTION boundary. It names the three functions a Basic notification belongs in instead (`messages.js`, `timeoff.js`, `forgot-clockout.js`) and calls out the trap that is coming — when the roster lands, a SHIFT moving is the same idea for a Basic org and must NOT be added there or beside the job version. Same words, opposite side of the seam. A suite assertion pins that comment so the warning cannot be deleted quietly. `scripts/day-move-notify-test.mjs`, 28 assertions against the REAL `diffTaskEvents` because the exclusions ARE the ruling; the red proof is that a naive any-schedule-change rule fires on the within-day nudge and the real one does not.
223. `normalizeTasks` persists derived `color` and `requiredDepartment` defaults (J:7553–7590).
224. `normalizePeople` persists derived `department` (J:7548).
225. The settings rehydrate merge can't remove keys, and a stale localStorage copy can be re-saved (J:8768, 5881).
226. Non-admin setting changes POST and 403 silently (`fn/settings.js:38`).
227. MEASURED 2026-10-02, and the entry's two halves turn out to be very different sizes — the proposal is against the whole-tree POST, not the moveLog bound. LIVE: Matrix's tasks.json is 112 jobs / 1,019 ops / 510.9 KB. moveLog is 69 ops (6.8%), 155 entries, 26.4 KB — 5.2% of every POST, biggest single log 16 entries. GROWTH Aug 28 → Oct 2: moveLog 15.4 → 26.4 KB (+71%) while the FILE went 146.2 → 510.9 KB (+250%), so moveLog is SHRINKING as a share. Root cause 7's effect is real but modest: entries were flat at 101 through Sep 2, 116 by Sep 18, 155 by Oct 2 (~0/day → ~2.8/day). RULED: a bound on moveLog is not worth a schema change for 5%. THE REAL FINDING is on the other half. Over the 40 most recent consecutive writes: 112 jobs sent every time, **0.97 jobs changed on average, median 1**, and **19 of 40 writes changed NOTHING AT ALL**. 508.3 KB POSTed per write against 17.3 KB actually different — 3.4%. The moveLog alone is LARGER than the average write's entire change. PROPOSAL, in ratio order. (1) DO NOT POST WHEN NOTHING CHANGED. Half the writes are pure no-ops: 508 KB uploaded, an S3 version stored, a publishChange, a silent push and a notify scan, to change nothing. The cause is that the autosave effect fires on OBJECT IDENTITY (`tasks !== seen.tasks`), so any code that rebuilds the array without changing content schedules a save. `stampArray` already does exactly this comparison server-side and preserves stamps — the client should refuse the POST on the same basis. No protocol change, no deletion-semantics problem, roughly half the traffic and half the stored versions. DO THIS FIRST. (2) SEND ONLY CHANGED JOBS — the other 96.6%. Blocked on deletion semantics: `reconcileDeletions(incoming, existing)` infers deletions from ids ABSENT in the POSTed array, so a partial POST reads as a mass delete. Needs an explicit envelope (`{ upsert: [...], delete: [ids] }`) and touches the empty-array overwrite guard, the conflict check and `changedIds`. Worth doing, bigger, and should follow (1) rather than be bundled with it. Note the asymmetry it removes: the READ path has been delta-synced since `sync.js` shipped (`arrDelta`, `changedSince`), while the write path still sends the whole org every time. (3) BOUND moveLog — 5.2%, shrinking, lowest value. Only worth doing if (2) happens and the per-job payload becomes the unit that matters. Not proposed now. ITEM 1 BUILT 2026-10-02. `doSave` now computes a content key per slice — `JSON.stringify` with a replacer that drops `lastModifiedAt` — against `lastSavedRef`, the key of what was last successfully saved, and skips any slice that has not changed. EXCLUDING THE STAMP IS THE WHOLE TRICK: since #337 the client adopts the server's stamps after every save, so a content-identical tree differs from the one it sent by its stamps alone; compare with them in and the skip never fires. The failure direction is deliberate — a plain stringify rather than a key-sorted canonical form, so reordered keys read as CHANGED, because a needless POST costs bandwidth and a skipped one costs the user's edit. The baseline starts null (first save of a session always goes), advances only for slices actually sent, and is CLEARED on rollback so the next save always goes. The three endpoints skip independently. ITEM 2 SCOPED, NOT BUILT — see #339. ITEM 3 RULED: do not bound moveLog. Measured at 5.2% and shrinking as a share (+71% against the file's +250%); not worth a schema change. `scripts/save-skip-test.mjs` covers item 1 and #338 together, 27 assertions.
228. CORRECTED AND HELD 2026-10-02 — half this entry was wrong, and the rest is a DELIBERATE HOLD rather than dead code. Measured field by field for READS OF THE VALUE rather than occurrences of the name: `unclosedAt` IS READ (`TRAQS.jsx:6753` gates a sweep on it; `timeclock.js` writes it through `updateJobSession` and strips it on resume at :1882). The `orgConfig` slice IS READ (`db/sync.js:72` stores it, :229 routes it, `sync.js:61` serves it) — a live sync entity. Both come off this entry. WRITTEN AND NEVER READ, confirmed: `actualHours`/`actualStart`/`actualEnd` and `planned{Start,End,StartHour,EndHour}`. Searched for the ACCESS (`\.field`, `{ field`, `field:`) rather than the name, across web, functions and iOS, each resolves to its write site in `finishedOpFields` alone — the only other occurrence anywhere is `dragMove.js:301`, a destructure that DISCARDS `actualHours`. RULED 2026-10-02: KEEP THEM. They are the skeleton of a planned-vs-actual report, which is wanted. This entry is a hold, not a deletion candidate, and anyone sweeping dead code should skip these seven fields. THE TRAP, recorded because it made this entry wrong once and would again: grepping a field name returns the things NAMED AFTER IT, not the reads of it. `actualHoursFor` is a rollup that computes the same quantity from leaves via `deriveWorkedState` and never touches the field; `taskActions.js:43` lists all seven in `FINISH_RESOLUTION_FIELDS`, a permission CLASSIFIER rather than a consumer. A comment at the write site asserted "It is read, at :12995 and :23864" — both are calls to `actualHoursFor`. That comment has been corrected in place with the evidence and a do-not-sweep note. See LESSONS #8.
229. `person.autoSchedule` exists only in the server PROTECTED list (`fn/people.js:15–19`).
230. The payhours/productionhours migration never auto-runs; unmigrated orgs read empty datasets (`_utils/migrate-timeclock.js:15–16`) [inferred].
231. React `onWheel` `preventDefault` calls are likely no-ops, since the listeners are passive (J:12428, 12439) [inferred].
232. `renderMobileApp` calls `useState` behind a ternary, so the hook order changes across 768 px (J:24107, 30374).
233. There are no touch handlers; every schedule interaction is mouse-only.
234. `renderMobileTeam` is unreachable (J:24295, 24502). DELETED (root cause 9): 69 lines. `mobileView` is `view === "schedule" ? "home" : view`, so it could never hold "schedule". If mobile scheduling returns it is a real feature with a real design — there are no touch handlers anywhere in the schedule (#233).
235. macOS has no native schedule, only a "Not ported yet" placeholder (NativeShell.swift:257–263).
236. The macOS "Take me to schedule" lands on the placeholder (JobsPage.swift:633–637).
237. macOS "Reschedule" is permanently disabled (JobsRowMenu.swift:265–269).
238. FIXED by 88e1ce6 (root cause 5) before chunk A reached it: the budget became the person's share, `businessDaySpan` was deleted. Chunk A then replaced the whole walk (see #247). Measured on the real Swift against Matrix's live jobs: drawn budget 6,817 h before 88e1ce6 → 903 h after (the 6,488 → 885 of the JS port, on today's data). WAS: The iOS gantt reads `hpd` as a per-day rate × business-day span (GanttView.swift:376–386).
239. FIXED (iOS chunk A). One meaning since 88e1ce6; now one Swift implementation of the share too — `OverlapRule.shareHours` (personShareHours); JobShifts delegates to it and SchedulePacker.personalBudget is deleted — held to the JS by fixtures/schedule-parity.json. `JobsScheduler.durationDays` stays separate on purpose: it is opDurBD (days, unestimated → 1), a different quantity. WAS: Native code reads `hpd` three ways: gantt, progress/scheduler and JobShifts (GanttView.swift:385, HoursCalculator.swift:80, JobsScheduler.swift:96, JobShifts.swift:40). (An older correction note about a missing file was wrong — wrong branch — and is dropped.)
240. FIXED by 88e1ce6 (root cause 5) before chunk A. WAS: The iOS gantt doesn't divide by team size (GanttView.swift:340).
241. FIXED (iOS chunk A). GanttLayout.units ports isAssignedHere: a panel is a bar only when it has no live ops. On Matrix: 19 panel bars, 143 h, that were other people's ops, gone. The 75-hour figure itself was an OP (Brigham BOP Wire, hpd 75, one person), not a panel. WAS: The iOS gantt draws panels whose ops belong to others (the 75-hour-bar bug) (GanttView.swift:342–360).
242. FIXED (iOS chunk C): JobsScheduler.units now treats a panel as a unit only when it has no LIVE ops, the isAssignedHere rule; untitled live ops are skipped without turning their panel back into a unit. STANDS, CHANGED (re-read 2026-10-04; iOS chunk A). The gantt now uses isAssignedHere, which agrees with OverlapRule.occupyingUnits (a panel counts when it has no non-deleted ops). One rule still differs: JobsScheduler.units treats a panel as a unit when it has no NAMED ops. WAS: iOS has two panel-bar rules (GanttView vs JobsScheduler leaf rule) (JobsScheduler.swift:318–323).
243. FIXED (iOS chunk A). The gantt places a unit at its stored startHour (packed against the shared cursor, the web's Business rule). On Matrix every one of the 20 units now drawn carries a startHour. WAS: The iOS gantt ignores stored `startHour`; its comment says the schema lacks it (GanttView.swift:201).
244. FIXED (iOS chunk A). The hand-rolled lunch step is deleted; blocks come from WorkDayClock.walk / OverlapRule.blocks, which step over breaks and lunch. WAS: The iOS gantt uses a hand-rolled lunch-only step instead of `WorkDayClock`, and ignores breaks (GanttView.swift:391–430).
245. FIXED (iOS chunk A). There is no day capacity any more — a day holds what the productive walk gives it (7.5 h at Matrix, not paidHoursPerDay's 8). WAS: iOS day capacity uses `paidHoursPerDay`, which removes lunch but not breaks (GanttView.swift:221, Models.swift:1385–1394).
246. FIXED (iOS chunk A), and the entry overstated it. The flat formula equals buildDayWindows' figure for every well-formed org — buildDayWindows banks unplaced break time at the start of the day, so the total removed is the same — so it was a second implementation, not a wrong number. It was also not dead (availability, More, the Mac jobs pages read it). It now reads WorkDayClock.day(from:).productiveHours, which also changes its malformed-time fallback from 08:00 to the org defaults (#306, productive half). WAS: `OrgSettings.productiveHoursPerDay` on iOS is dead and uses the abandoned flat formula (Models.swift:1364–1375).
247. FIXED (iOS chunk A). SchedulePacker is deleted: nothing rolls forward, untouched past work no longer eats today's capacity, overdue work stays on its own dates as on the web. WAS: The iOS gantt has no cursor: untouched past work is placed on past days and backlog eats capacity (GanttView.swift:227, 257–293). TIER SETTLED 2026-10-04: the gantt is Business-only (MainTabView pins jobsMode to .list on Basic and shows the toggle only on Business), so this is a Business defect, not a tier difference.
248. FIXED (iOS chunk A). History (end before today) is hidden unless someone is clocked into it, as getPersonBars does. On Matrix: 35 history units, 263 h, no longer drawn. WAS: The iOS gantt rolls history forward instead of hiding it (GanttView.swift:319–332). TIER SETTLED 2026-10-04: the gantt is Business-only (MainTabView pins jobsMode to .list on Basic and shows the toggle only on Business), so this is a Business defect, not a tier difference.
249. CLOSED (iOS chunk C), no change: the web's DAY VIEW has no overrun extension either — `dayViewBlocks` sizes a bar from the share alone and only the week/month render grows bars past their estimate. iOS ports the day view, so it is at parity; it draws more than the web there (a worked-fill stripe). STANDS (re-read 2026-10-04). The worked fill is capped at the block and the bar never grows for overrun; GanttLayout deliberately leaves the overrun extension unported. WAS: Overrun is invisible on iOS; the worked fill caps and the bar never grows (GanttView.swift:457). TIER SETTLED 2026-10-04: the gantt is Business-only (MainTabView pins jobsMode to .list on Basic and shows the toggle only on Business), so this is a Business defect, not a tier difference.
250. FIXED (iOS chunk C). Live hours are the web's `sessionWorkedHours` (Services/ShopTime.swift, SessionHours), in shop time: inside the working day, lunch and breaks off, stopped at a hold, an open pause or the end of the working day, closed manual pauses subtracted — the definition the server credits at clock-out. THE HEADLINE, replayed over Matrix's 266 recorded production sessions: the old iOS rule (wall clock minus pauses, start day only) shows 1,136 h against the rule's 667 h, and **171 sessions are off by more than 15 minutes**. The worst is a session left open Friday afternoon into Monday (clocked in 2026-08-14 15:17): **95.5 h shown for 6.2 h of work**. That is why this is not cosmetic. Held to the JS by the fixture's `sessions` (72 cases, both 2026 DST changes, three zones). The per-day limit went too: since chunk A the gantt pours a unit's worked hours across its whole run. WAS: STANDS (re-read 2026-10-04). Same-day only, no freeze, no lunch or break deduction (AppState.liveHours). WAS: iOS `liveHours(forOp:on:)` has no freeze, no lunch or break deduction, and only counts on the start day (AppState.swift:3292–3303). TIER SETTLED 2026-10-04: the gantt is Business-only (MainTabView pins jobsMode to .list on Basic and shows the toggle only on Business), so this is a Business defect, not a tier difference.
251. FIXED by 13e8365 (root cause 6) before chunk A: isWorkDay goes through WorkCalendar with holidays. WAS: The iOS gantt ignores holidays (GanttView.swift:180–183, 485–499).
252. FIXED IN PART (iOS chunk C). FINISHED: ruled 2026-10-04 that finished work SHOWS, as on the web — GanttLayout no longer drops it, and a finished bar gets the web day view's fill (`doneBarFill` over `barPaint`) and a DONE tag; its history is still hidden like any other. PTO: deferred until #349, since approved PTO never reaches `timeOff` on either side. ENG CHIPS: moot — `dayViewBlocks` drops them. LOCKED: moot — op.locked was retired. CROSS-ROW: logged as #365. STANDS (re-read 2026-10-04). WAS: iOS has no PTO, eng-chip, cross-row, locked or finished states. TIER SETTLED 2026-10-04: the gantt is Business-only (MainTabView pins jobsMode to .list on Basic and shows the toggle only on Business), so this is a Business defect, not a tier difference.
253. FIXED (iOS chunk C). A bar is its panel's colour (`panel.color`, else #94a3b8) through `legibleBarColor` — Services/BarPaint.swift, in the fixture's `paint` — and the week legend names panels. The title-keyword palette is deleted. STANDS (re-read 2026-10-04). panel.color lives in extras and is never read. WAS: iOS bar colour comes from title keywords instead of `panel.color` (GanttView.swift:501–529).
254. FIXED (iOS chunk C): ‹ › a week at a time on the week header. STANDS (re-read 2026-10-04). WeekHeaderBar has only the range label and TODAY. WAS: iOS week mode has no previous/next-week navigation (GanttView.swift:1077–1102).
255. FIXED (iOS chunk C): DatePickerSheet, ScheduleFocus and opLoggedDays deleted. The finished branch of workedHours KEPT — #252 makes it live. STANDS (re-read 2026-10-04). DatePickerSheet, ScheduleFocus and opLoggedDays have zero callers in iOS or Mac; the finished branch of workedHours is unreachable. WAS: iOS `DatePickerSheet`, `ScheduleFocus`, `opLoggedDays` and the finished `workedHours` branch are dead (GanttView.swift:1399–1431, 586–590, 437; AppState.swift:3276). TIER SETTLED 2026-10-04: the gantt is Business-only (MainTabView pins jobsMode to .list on Basic and shows the toggle only on Business), so this is a Business defect, not a tier difference.
256. FIXED (iOS chunk C): title "MMM d", subtitle Today/Tomorrow/Yesterday or the full weekday. STANDS (re-read 2026-10-04). Both formatters are "EEE · MMM d". WAS: iOS `dayShort` and `dayFull` share one format, so the subtitle duplicates the title (GanttView.swift:1436–1441).
257. FIXED (iOS chunk C): both grids use `dayGridHours` (floor of the start, ceiling of the end, lifted out of the web's dayGrid into statsMath and the fixture's `grids`), so labels and counts are whole hours. STANDS (re-read 2026-10-04). WAS: iOS hour labels truncate fractional start hours, and the week `hourCount` truncates (GanttView.swift:717, 1141, 1176).
258. MOOT (iOS chunk A). The sort lived in scheduleItems, which is deleted; pack order is now the web's — startHour, then row order. WAS: The iOS sort tie-break concatenates `jobNumber + panel.id` as strings (GanttView.swift:371).
259. DELETED (iOS chunk B, 2026-10-04): RescheduleSheet, its two Reschedule buttons in JobDetailView and AppState.rescheduleUnit / hasDependents / dependentOpIds / shift are gone — an independent move algorithm nothing could reach; reviving it would mean porting the web's whole move path into unreachable code. Was MOOT, LATENT: rescheduleUnit's only caller is RescheduleSheet, opened only from JobDetailView, which nothing creates any more (replaced by the read-only JobDetailPopup). The code is unchanged — calendar-day shift — and applies as written if the sheet is reconnected. WAS: iOS `rescheduleUnit` shifts by calendar days, so dependents can land on weekends (AppState.swift:2040–2043, 2094).
260. DELETED (iOS chunk B, 2026-10-04): RescheduleSheet, its two Reschedule buttons in JobDetailView and AppState.rescheduleUnit / hasDependents / dependentOpIds / shift are gone — an independent move algorithm nothing could reach; reviving it would mean porting the web's whole move path into unreachable code. Was MOOT, LATENT: Unreachable (see #259); still writes no moveLog. WAS: iOS `rescheduleUnit` writes no `moveLog` (AppState.swift:2079–2121).
261. DELETED (iOS chunk B, 2026-10-04): RescheduleSheet, its two Reschedule buttons in JobDetailView and AppState.rescheduleUnit / hasDependents / dependentOpIds / shift are gone — an independent move algorithm nothing could reach; reviving it would mean porting the web's whole move path into unreachable code. Was MOOT, LATENT: Unreachable (see #259); the only guard is can(.moveJobs), no OverlapRule call. WAS: iOS `rescheduleUnit` has no lock, active-clock, before-now or overlap check (AppState.swift:2079–2121).
262. DELETED (iOS chunk B, 2026-10-04): RescheduleSheet, its two Reschedule buttons in JobDetailView and AppState.rescheduleUnit / hasDependents / dependentOpIds / shift are gone — an independent move algorithm nothing could reach; reviving it would mean porting the web's whole move path into unreachable code. Was MOOT, LATENT: Unreachable (see #259); a panel move still leaves ops and envelope stale. WAS: An iOS panel reschedule leaves its ops and the job/panel envelope stale (AppState.swift:2079–2121).
263. DELETED (iOS chunk B, 2026-10-04): RescheduleSheet, its two Reschedule buttons in JobDetailView and AppState.rescheduleUnit / hasDependents / dependentOpIds / shift are gone — an independent move algorithm nothing could reach; reviving it would mean porting the web's whole move path into unreachable code. Was MOOT, LATENT: Unreachable (see #259); still ignores Panel.deps. WAS: iOS `hasDependents`/`dependentOpIds` ignore panel-level `deps` (AppState.swift:2047–2067).
264. FIXED (iOS chunk C), with #307: a BREAK with no length decodes as 0 and drops out, as buildDayWindows drops it; a LUNCH with no length is 30, as withOrgDefaults fills it. The fixture now runs every org through withOrgDefaults and has a missing-lengths org. STANDS, CHANGED (re-read 2026-10-04). The 30-minute decode fallback is still there; the claim that the web uses 60 is stale (lunch 30, break 15 since root cause 6). Same item as #307. WAS: iOS `OrgBreak` decodes a missing duration as 30 min while `WorkDayClock` and the web use 60 (Models.swift:1207–1210).
265. FIXED by 13e8365 (root cause 6): the fallbacks are 7/15. WAS: iOS `workStartHour`/`workEndHour` fall back to 8/17 while `OrgSettings.default` is 07:00–15:00 (Models.swift:1397–1407 vs 1253–1256).
266. DELETED (iOS chunk C): JobHealth had no production caller on iOS or Mac; it and its tests are gone rather than ported. STANDS, LATENT (re-read 2026-10-04). JobHealth.of has no production caller, so nothing shows the drift yet. WAS: iOS JobHealth has drifted from web `getHealth` (missing the `loggedHours`/`pctDoneOverride` rule) (J:817–832). TIER SETTLED 2026-10-04: the gantt is Business-only (MainTabView pins jobsMode to .list on Basic and shows the toggle only on Business), so this is a Business defect, not a tier difference.
267. `no-overlap-test` mostly exercises app-dead helpers with a field (`durationH`) the app never writes.
268. `job-live-hours-test` and `render-perf-test` test source slices and copies, not the real code.
269. `live-hours-native-grid` always exits 0 while reporting 8 native divergences.
270. `check-live-hours` skips Swift.
271. `timeclock-itest` has no jobClockIn or updateJobSession coverage.
272. `row-push-test` "pan stability" feeds identical inputs and can't catch the call site (J:17541).
273. `npm run build` doesn't run the row-push, no-overlap, worked-spans or live-hours suites (package.json:8).
274. No test covers task-perms, `previewPush`, `applyPushes`, `enforceNoOverlap`, `reflowJob`, `recalcBounds`, `walkProductiveHours`, `buildDayWindows`, `weekdaySegments`, `addBD`, `shrunkStartH`, `finishedOpFields` or any render/drag math.
275. No iOS test covers `GanttView`, `rescheduleUnit`, `hasDependents` or `liveHours(forOp:on:)`.
276. `DYNAMIC_SCHEDULE_HANDOFF.md` is stale on branch state, deleted functions, the live-bar model and the "lengthen-only" push.
277. `docs/MAC-SCHEDULE-PARITY.md` has stale line numbers, wrong `personStatus` values and wrong Swift names.
278. Code comments describe behaviour the code no longer has (§G.2 list).
279. `computeJobOptimize` is a further independent placement algorithm with its own business-day math, unreviewed (J:10119). DELETED (root cause 9): 134 lines with optimizeJobOps, plus the "Optimize Entire Job Schedule" button inside the Reschedule modal, which was its only other door. Root cause 5 collapsed seven placement definitions into one; keeping three unreviewed ones beside it would undo that.
280. `live-hours-native-grid` transcribes Android from before 0f50559; its three Android variants no longer match source (HoursCalculator.kt:35–47), so 3 of its 8 reported divergences are phantom.
281. `live-hours-native-grid` cites stale iOS lines: op-progress is AppState.swift:3298–3300, not :3273; TasksView is :1344–1346, not :1335.
282. iOS AppState.swift:3255 and AppState+JobsProgress.swift:51 also call `HoursCalculator.liveElapsedHours` without `pausedAt`; the grid doesn't cover them.
283. Android `HoursCalculator.liveElapsedHours` ignores `frozenAtMs` (HoursCalculator.kt:29–34); a held session keeps accruing. The grid has no freeze case.
284. Duplicate `cursor` key in the Drop-in-schedule button style (J:32053 and J:32058); the first is dead.
285. Local `node_modules` was missing `eslint` despite the lockfile, so `npm run build` failed at lint before any suite ran.
286. End-job's client POST (J:22641–22652) carries a stale `panel.loggedHours` after jobClockOut has credited the panel (timeclock.js:1186); for a caller with editJobs it succeeds and rolls the panel credit back.
287. [root cause 3] `persistShrink` trusts the client's `startHour` value: jobClockOut bounds it (raise-only, ≤ endHour − 5 min) but does not recompute it (timeclock.js `applyShrinkStartHour`).
288. Web and iOS raise finish requests through different paths: iOS calls timeclock `finishRequest` (sets `pendingFinish`, posts the chat bubble server-side); web writes `finishRequest`/`finishRequests` through /tasks and posts its own message (J:11650–11700).
289. RE-READ AND FIXED 2026-10-02 under the ruling that DEPARTMENT ABSENCE MEANS OPEN TO ANYONE. This entry assumed the auto-schedulers' fall back to all crew was a defect and that the server would refuse what they produced. BOTH HALVES WERE BACKWARDS. The server was already correct — `personDeptMatch` returns "primary" when no department is required, and `unitDepartment` has no title heuristic — so THE CLIENT WAS STRICTER THAN THE SERVER, not looser. And the thing actually creating constraints was `deptOfUnit`'s TITLE FALLBACK: an op NAMED like a department was treated as REQUIRING it. Measured on Matrix's live tasks.json before removal, of 484 live ops: 142 (29.3%) had a department stated, 231 (47.7%) had one INFERRED FROM THE TITLE, 111 (22.9%) had none. Matrix's departments are named exactly what its ops are titled — Wire, Cut, Layout — so against 18 live people an op titled "Layout" was assignable to ONE of them, "Cut" to one, "Wire" to five, and 71 ops titled "Layout" funnelled onto a single person. The fall-back-to-all-crew these entries called a bug only fires when ZERO people hold the department, which never happened here, so it never rescued anything. FIXED by deleting the title heuristic; `deptOfUnit` is now `unitDepartment(...) || ""`. WHAT SURVIVES OF THE ORIGINAL CONCERN: for an op with a department ACTUALLY STATED, falling back to all crew is still wrong and should fail loudly — the ruling's second half is that a stated department still excludes. That case is untouched here and remains open.
290. RE-READ 2026-10-02 — see #157/#289. Same correction as #158: the Swift test is right for the no-department case and wrong only for the stated-department case. It does not need to change with #289 as written, because #289 as written was wrong about the direction of the mismatch. No native work done.
340. FIXED 2026-10-02. The auto-scheduler reassigned people the admin had deliberately put on an op. RULED: MANUAL ASSIGNMENT IS A STATE THE SCHEDULER RESPECTS, not a lock — auto-schedule, then put specific people on specific ops, and the scheduler does not undo it; the op still moves in time. The gap was narrower than it looked: the RESCHEDULE path already honoured an existing team (`ed.isReschedule && (op.team||[]).length>0`), and the auto-schedule path never did, so the same write that placed the work reassigned it. Fixed by dropping the `ed.isReschedule` condition — one predicate, both paths — and by adding the same check to `crewForOp` on the wizard's scheduler, ahead of any department filtering. ALSO FIXED IN PASSING, and it would have made the fix look broken: the reschedule path tested membership with `(op.team||[]).includes(pp.id)`. Person ids are mixed string/number across web and iOS, so a raw `.includes` silently matches nothing and the op falls through to the department pool — indistinguishable from the scheduler ignoring the assignment, which is the bug being fixed. Both paths now use `onTeam`.
341. NOTE 2026-10-04: this entry is the optimizer deletion. The department title heuristic is a different change — the web removed it in 4ee9598 ("departments become sets"); see #364. FIXED 2026-10-02 (deletion). The full schedule optimizer was UNREACHABLE. `setOptimizePreview` was called three times and every one passed `null` — the overlay click, Cancel, and Apply — so `optimizePreview` could never be truthy and its 87-line modal could never render. The optimizer function that would have populated it had been deleted long before, leaving four orphaned comments behind: "Swap-first optimizer", "Full schedule optimizer: packs each person's ops tightly", "Find next available slot for an op across all team members' schedules", and "Toggle lock on an operation" — that last one being why #49 read as a missing button rather than a deleted function. Another member of the LESSONS #7 family: present, documented, never executes. Deleted the state, the modal and the four comments, leaving a note saying what was removed and that a schedule optimizer would be a new feature rather than a revival.
342. REVIEWED 2026-10-02, no defect — `netlify/edge-functions/ai-schedule.ts`, which had never been read. IT IS A PURE STREAMING PROXY AND WRITES NOTHING: zero occurrences of s3, readJson, writeJson, tasks or orgs/ in the file. It verifies the Auth0 JWT against the tenant JWKS, rate-limits per token subject (30/hr), caps input at 1 MB and output at 64K tokens, forwards {system, messages, tools, tool_choice} to Anthropic and pipes the SSE stream back. CONSEQUENCE FOR THE OVERLAP RULE (root cause 5): it cannot respect or violate it, because it has no concept of a task — the model's proposal returns as text and the CLIENT applies it through the same client-side paths as every other edit, inheriting whatever those do. CORRECTION TO AN EARLIER CLAIM OF MINE, recorded in TIERS.md and #336: I called this "the one piece of automatic scheduling that IS a server endpoint, and therefore the one place a tier gate could actually be enforced". It is a server endpoint but it does not schedule, so a gate here would gate ACCESS TO AI, not scheduling output. The code itself is in good order, including an error-class mapping added after the retired-model outage so a server misconfiguration is no longer indistinguishable from a rate limit.
291. A stale whole-array POST tombstones jobs created after the client loaded: `reconcileDeletions` treats every stored id absent from the POST as a deletion (`_utils/timestamps.js:134`), and the per-job conflict check cannot see a job the POST doesn't contain. Needs a client-supplied base (or explicit deletions) to fix.
292. people.json read-modify-writes are still unconditional everywhere except jobClockIn and updateJobSession (≈30 sites in timeclock.js, plus people.js, timeoff.js, invite.js, org-config.js, forgot-clockout.js); a concurrent write between read and write is lost.
293. The business-day and past rules can't fire through /tasks today: only admins hold moveJobs, and admins are exempt from both (scheduleRules.js). They take effect only if non-admins are ever given schedule-changing permissions.
294. iOS/Mac `AppState.persistJobs` shows "Couldn't save — check your connection" for every failure and never reads the server's message; it must surface 422/409 messages before SCHEDULE_RULES_MODE or TASK_CONFLICT_MODE is set to enforce. It also ignores the `conflicts` list (a stale edit is dropped silently until delta sync catches up).
295. Timeclock admin actions (adminClockIn/Out, adminEdit*/Add*/Delete*/Reopen*, confirm/unconfirmTimesheet, adminLunch/Break*) and adminJobHours check bare isAdmin; no granular permission key exists, so a restricted admin keeps full timeclock power (timeclock.js:579, 745, 1014, 1049, 1533). Deferred: needs a new key on both sides.
296. A worker raising their first web finish request is never added to the "Completion Requests" group: groups.js drops edits to groups the poster isn't in, so `ensureCompletionGroup` (J:11613) can't add them and their request message can't be posted to the thread.
297. Clearing a job/panel/op thread's chat is still open to any participant (messages.js DELETE); only group threads are restricted to creator-or-admin.
298. Web gates not split in root cause 4: the Time Clock Settings modal (opened on isAdmin) mixes org settings (need orgSettings) and team pay/PIN rows (need manageTeam); Settings → Organization → Permissions/Time Clock team rows are under orgSettings but write people (need manageTeam); the User Permissions modal toasts "PIN saved" when the server dropped the PIN; the person modal's timeOff edits drift from the time-off request record (people write needs manageTeam, timeoff edit needs isAdmin).
299. A week/Gantt drag that splits a partly worked op adds a node and writes status/locked/loggedHours, so it needs editJobs as well as moveJobs; the drag checks only moveJobs.
300. Mac New Job sheet pre-fills 7.5 h for every new op and panel (`OperationDraft.hours` / `PanelDraft.hours`, JobsNewJobSheet.swift ~884, ~899; "7.5" placeholders ~1040, ~1237), saved as-is and kept in templates. Under the total-estimate meaning that is a guess, not an estimate. UX decision deferred.
301. Old iOS builds (before 88e1ce6) decode an absent/null hpd as 7.5 and write it back on every whole-array save, so each old-build save converts every unestimated node in the org to 7.5. The server can't tell old builds apart: every iOS build sends CURRENT_PROJECT_VERSION = 1 in its User-Agent and no version header.
302. [feature] Crew scheduling: the iOS auto-scheduler (JobsScheduler.place) assigns one person per unit and sizes for one, overwriting a multi-person team from the form. Scheduling a unit across the form's crew (N free, department-matched people, sized hpd ÷ N) would be a new feature, not a fix.
303. The auto-schedulers are the sixth overlap definition and the source of all 9 live overlapping pairs at Matrix (2026-09-30): web isPersonFree / isPersonFreeLocal / isPersonFreeGlobal and iOS JobsScheduler.isFree check whole days, compare ids strictly and ignore each person's other work, so they place units onto occupied time. Moving them onto the shared overlap rule (src/overlapRules.js) is the last piece of root cause 5.
304. FIXED (iOS chunk D, 2026-10-05). Every SHOP question on iOS reads the shop's zone: `ShopTime.current` (setShopZone — AppState sets it whenever orgSettings change; tests pin it with the task-local `ShopTime.$override`), and each site is a one-line swap to `ShopTime.current.calendar` / `.formatter(_:)` / `.date(ofDay:)` / `.ymd(_:)`. A stored schedule day (`String.asDate`) is the shop's midnight, so every view that compares or prints one moved with it: Jobs list (TasksView) and gantt (GanttView) whole; Home date card (ruling 1) and Basic today (#370); Jobs-header date badge; Stats week/pay-period windows, per-day buckets and headings (MoreView, GlassHeader); Hours bars, period and its label (TimeClockView, rulings 3–4); `hoursToday`, `payPeriodHours`, `todayTasks` and the overdue-reopen shift (AppState); the availability engine and its labels; photo filenames in chat and on panels (ruling 5); and the pickers that make shop days — New Job (dates AND times: its 08:00 is the schedule's 08:00), Edit Job, Time Off (ruling 6), Check Availability — via `.environment(\.timeZone, shop)`, plus the signup's first pay day in the zone being picked (ruling 6). JobEditView HAD to move: once `asDate` is the shop's midnight, a device-zone picker shows a viewer west of the shop the day before and saves it. Pay periods: the web's getPayPeriodFromDates/AtOffset lifted to src/payPeriod.js and frozen into the fixture (`payPeriods`, 490 cases); iOS ports it once as `PayPeriod` and AppState's second copy is deleted. VIEWER by ruling, unchanged: chat timestamps and day separators, punch times (ruling 2; see #371), the admin board's "now" heading (ruling 7). ZONE-FREE, unchanged: JobShifts labels and JobsScheduler day maths (parse and print in one zone), ISO timestamps. Ruling 5's CSV footer has no iOS site — the only CSV export is the Mac's JobsExportSheet, which prints no date (#366 covers the Mac). Red first: ShopTimeMigrationTests under `TEST_RUNNER_TZ=America/New_York` with a Denver shop failed 8 ways (schedule day 2 h early, Sep 20–Oct 4 read as Oct 5–19, hours today 9 not 4, availability floored a day late), then passed. A view built before the org's settings load would have seeded its selected day with the DEVICE's midnight — yesterday in a shop west of the phone — so those seeds are instants now. WAS: IN PROGRESS. The primitive landed in iOS chunk C: Services/ShopTime.swift, a port of src/shopTime.js held to it by the fixture's `shop` cases (five zones, both 2026 DST changes), with `OrgSettings.timeZone`. Live hours (#250) use it. The migration — 63 Calendar.current uses in 12 files and 55 of 62 DateFormatters on the device zone, each needing a schedule-time vs display-time ruling — is chunk D. WAS: iOS schedule geometry ignores the org timezone: OrgSettings has no timeZone field and the app uses Calendar.current in ~66 places (GanttView, TasksView, ScheduleDate parsing…). Deferred from root cause 6 to its own pass.
305. The web day view's hour grid (5–21) and its off-hours shading (7–18) are hard-coded and never read the org's workStart/workEnd. Found in root cause 6; not fixed.
306. FIXED (iOS chunk C). The productive half went in chunk A (WorkDayClock). paidHoursPerDay now uses the same 07:00–15:00 defaults for a malformed time — 7.5 paid hours, not a flat 8. iOS `OrgSettings.productiveHoursPerDay` (Models.swift ~1404) parses a malformed workStart/workEnd as 08:00 (both malformed → 0-hour block, floored to 1), and `paidHoursPerDay` falls back to 8; neither uses the 07:00–15:00 defaults. Found in root cause 6; not fixed.
307. FIXED (iOS chunk C) — see #264. iOS `OrgBreak` decoding falls back to 30 minutes when durationMinutes is missing; the break default is 15. Found in root cause 6; not fixed.
308. The web admin break timer's fallback (`breakStartTs`, J:~13501) takes "today" as the UTC date (`toISOString().slice(0, 10)`) and matches it against the server's org-local `date`, so after 18:00 Denver it looks in tomorrow's events and misses an open break. Found in root cause 6; not fixed.
309. Week/month drag members (locked dep group, multi-select) move from their STORED positions by the grabbed bar's painted→drop delta; a member that is itself painted pushed (at the cursor, or behind an overrunning neighbour) has no painted position available to the handler, so its ghost and landing ignore its own push. The landing is still checked (past etc.), so it can be refused, not misplaced silently. Found in root cause 7 chunk A; not fixed.
310. FIXED (day-view chunk C). The day view had no drop target, so re-planning an overdue item worked only in week and month — the one view that can say WHEN during the day was the one that could not accept the drop. Each hour cell is a target now, and the half of the column the cursor lands in picks the half hour, so a drop reads as the place it was aimed at. `handleOverdueDrop` gained an optional `atHour`: week and month pass nothing and derive it exactly as before (now rounded up for today, the start of the day otherwise), the day view passes the hour under the cursor, and it is clamped into the working day rather than trusted — the drop can land on a dead column or past the end. Everything else is reused rather than reimplemented: the same moveJobs and reassign checks, the same `planDragMove`, the same `refuseLanding`, and the same no-overlap backstop through `commitLanding`.
311. The "N overdue" badge's fit in the schedule's label column at real widths (250–510 px, beside the clock pill) is unmeasured. Goes with root cause 8. Logged in root cause 7 D; not fixed.
312. The gantt and split-gantt width observers (`TRAQS.jsx:8735` and `8744`) have NO dependency array, so each one tears down its ResizeObserver and builds a new one after every render of the component, then writes `setGanttWidth(el.clientWidth)` / `setSplitGanttPaneWidth(el.clientWidth || 600)` on the way. They early-return when their ref is null, which is why they are not the schedule's problem — on the schedule neither element is mounted. On the Jobs page, where both are, the integer `clientWidth` written by the effect and the fractional `contentRect.width` written by the observer are two different values for the same box, which is the shape of a render loop. Found while measuring root cause 8's 5fps; deliberately not touched in that pass. Not fixed. HALF RESOLVED by root cause 9: the gantt observer at 8774 went with ganttContainerRef when renderGantt was deleted. What remains is the split-gantt pane observer, which still has no dependency array and still rebuilds its ResizeObserver on every render.
313. `placedSubs` is persisted on 188 nodes of Matrix's `tasks.json` — 73 KB, 15% of the payload — although it is scratch state from the AI-schedule modal that `TRAQS.jsx:26661` strips on the way out. It is the only field that grew out of proportion to the tree between 28 Sep and 1 Oct (21 KB → 73 KB, +252% against +52% nodes). `_rescheduleStartDate` is on 5 nodes for the same reason. Payload only; it costs a bigger POST, not frames. Found while measuring root cause 8's 5fps. Not fixed.
314. FIXED (2609224). `scripts/web-gates-test.mjs` compared multi-line patterns written LF against a working copy git checks out CRLF (core.autocrlf=true, index LF), so none of them could match. Three `has:` checks failed loudly; the other four are `not:` clauses, and a `not:` that can never match reports its gate as correct without reading it — Schedule bulk Select, the panel approval-step menu, mobile client add/edit and the PTO drag gate all read green for a week while asserting nothing. The suite now normalises what it reads; the source is untouched. All four gates turn out to be correct. Proven by mutation: injecting the old `isAdmin` gate and pointing WEB_GATES_SRC at it now fails, where before the fix the same mutant passed. A canary fails loudly if the normalisation is removed. Swept the other seven suites that compare literals against file contents — this was the only one with a multi-line pattern.
315. Nine team ids in `tasks.json` resolve to nobody in `people.json`, across 207 of 1,148 assigned nodes (`tpi9loya1` 32, `th45typcc` 64, `tir7gjhzd` 26, `t2c27wd69` 55, `tnm1ne1vn` 9, `t8gvuawtq` 4, `tpq9lmtlv` 10, `tnz13rojb` 2, `tk2u8yz49` 5). They are an IMPORT, not deleted people: deletion here is soft and leaves a row (6 of the 24 roster rows carry `deletedAt`, none of them these), none of the nine is mentioned anywhere in productionhours.json or payhours.json, and all nine first appear in a single write — version #3 of tasks.json, 2026-06-03T21:20:34, which took the file from 0 KB to 79 KB, i.e. the restore after the empty-tasks incident. 15 of the 21 jobs carrying them have no real assignee at all. Rows for these ids never render, so their schedule slack was computed and discarded until d9c747d. Not fixed.
316. Job #401945 exists twice. `ty8ddl31b` "401945 - Joule" is the live one: In Progress, 11 nodes, 10.14 logged hours, one production row (2026-09-22), assignees Tyler/Jason/Treysen, first seen 2026-09-15. `tjyildheg` "Joule" is from the 2026-06-03 seed and has had nothing done to it since: Not Started, 17 nodes, zero logged hours, zero production rows, zero payhours rows, zero moveLog entries, and all three of its assignees are ghost ids from #315. It carries the estimates that make it conspicuous — 2,340h, 4,672.5h and 9,345h against a 7.5h median leaf — and an end date of 2030-10-17. Seven of the eight leaves org-wide with an hpd over 500h are in it. Not fixed.
317. Job status is stored with inconsistent casing: Matrix carries both `Finished` and `finished` on drawn bars, so any === comparison on job status silently splits one status into two. Found while censusing bar states for root cause 8 chunk B (8 distinct job statuses across 195 drawn bars). Not fixed.
318. Hover sibling-dimming keys on `task.pid`, which is the PARENT id, so it means a different thing at each level: an op bar keys on its panel, a panel bar on its job. Hovering an op therefore highlights its sibling ops but never its own panel, and two ops of the same job in different panels never highlight together. The right key is the JOB id (the thing a person thinks of as "this job") for every level, which for an op is `task.grandPid`, for a panel `task.pid`, and for a general sub `task.pid`. Since root cause 8 chunk B this is one attribute -- `data-pid` on the bar and `data-row-pids` on the row label -- rather than render logic. Not fixed.
319. The Jobs page has three sub-views and two of them cannot be reached. `taskSubView` is `useState("list")` and the only setter call in the file is `setTaskSubView("list")`, so neither `taskSubView === "cards"` (234 lines) nor `taskSubView === "gantt"` (#132) can ever render. The gantt went in root cause 9; the cards sub-view is held deliberately, pending a look at what it was meant to be — it is a different feature, not a duplicate of something live. Not fixed, not deleted.
320. Sorting the Jobs list and the gantt by project or by client is unreachable, but the PREFERENCE that selects it is still persisted. `jobSort` (J:5016) and `gSort` (J:5214) are `usePersistedUI` values with no setter call anywhere in the file — the controls that set them are gone, while the two sort arms each reads (J:12022-12023 and J:15289-15290) remain. For a new account the arms can never run; for anyone whose browser still holds `tq_ui_<org>_jobSort` = "project" from an older build they run today, which is why this is not safe to treat as dead code. Both were already orphaned before root cause 9 — each had exactly one occurrence before and after that commit. The fix is to restore the controls, not to cut the arms: deleting would confirm the loss for the people who used it most, and would leave the stored key behind. Found by the chunk 1 unreachability sweep (root cause 9). Not fixed.
321. Stylesheets are duplicated across the global sheet and the per-view inline `<style>` blocks. The `.subtle-all-btn` sheet (564 chars) is pasted verbatim three times (J:12293, 13452, 15283), and eight keyframe names are declared more than once: `spin` ×3, `toolDrop` ×3, `tqFadeOnly` ×3, `menuIn` ×2, `gridRowIn` ×2, `gridRowOut` ×2, `tqWipe` ×2, `tqPadIn` ×2. The browser uses the last declaration, so every copy but one can never change behaviour. NOT a dead-code job and deliberately not touched in root cause 9 chunk 3: the comment at J:991 records why these copies exist — `toolDrop` was once declared only inside the Jobs view's `<style>`, so the dropdown row cascade silently did nothing on every other page, and `menuIn` was never declared at all despite ~20 call sites. That was fixed by hoisting both into the global sheet; the local copies were left behind. Consolidating them risks reintroducing exactly the scoping bug the hoist fixed, which is a change that needs its own verification pass rather than a deletion. Found by the chunk 3 CSS sweep. Not fixed.
322. FIXED (root cause 9 chunk 3). 27 unreachable declarations in the stylesheets, 65 lines. Seven entrance classes nothing ever applied (`.anim-header`, `.anim-filter`, `.anim-badge`, `.anim-gantt-bar`, `.anim-spring`, `.anim-stagger`, `.anim-row`) — a vocabulary only half adopted, while their siblings `.anim-btn` (~94 call sites), `.anim-card`, `.anim-drop`, `.anim-ctx` and `.anim-modal-*` are live across 174. A rename leftover, `.ts-legend`, orphaned when the export legend moved to `class="ts-key"`. Sixteen keyframes, five of which were dead only BECAUSE the seven class rules were: each had exactly one reference and all five lived inside one of them, so a by-name list would have kept them and only a fixpoint finds them. Three custom properties written on every theme change and read by nobody (`--tq-bg-image`, `--tq-glow`, `--tq-lglass-shadow-hover`); `--tq-glow` is the trap, since `--tq-glow-ring` and `--tq-glow-ring-soft` ARE read and two comments called the dead one load-bearing. `.anim-tab` was dead the opposite way round — written, reviewed, never put on an element — so tabs had no press feedback at all, which reads as a dead control rather than a quiet one; it is now wired to all four tab components (MobileNav, both Time Stamp admin rows, the settings tabs), the two inline `transition: "color 0.15s"` declarations that would have outranked it are gone, and `overflow: hidden` was dropped from the rule because a `.tq-noanim` tab has no `::after` to clip and the clip could only crop MobileNav unread badge. `.tq-lglass-noedge` is unreachable and KEPT — the comment above it says why. scripts/css-dead-test.mjs holds the record: 48 assertions, all seven mutations caught, including invariants that every keyframe is referenced, every class rule reachable and every custom property read back.
323. FIXED (chunk A). The client's whole-tree autosave destroyed server-written `loggedHours`. `/tasks` takes a full copy of the task tree, so a client that read before a clock-out credit landed put the pre-credit value straight back — and because a client that has never seen the field omits the KEY, the write DELETED the counter rather than lowering it. Proven on S3 object versions: the 401944 Thacker II credit landed at 2026-09-28T17:30:52 (job, panel and op all 67.84) and at 17:30:54 all three were gone, the only other change being `lastModifiedAt` on the job. The signature across the org is a counter holding exactly the most recent session instead of the sum — `fluence/402050-04` stored 8.68 against 14.39h of rows, `Golden Chest` 1.32 against 12.65h, `Brigham GCC #3/401992-02` 20.37 against 38.29h. Measured before the fix: 30 of 434 panels short by 789.52h, 18 of 1,019 ops short by 251.45h, 14 of 112 jobs short by 376.47h, and still live — 13 of the 21 panels touched in the last 30 days of data stored less than their recent sessions alone. `/tasks` now restores the stored value for every server-owned field on every node that already exists; a NEW node keeps what it arrived with, so a split can still write `loggedHours: 0`. The one legitimate client write, "Set Worked Hours", moved to a narrow `setOpWorkedHours` action gated on editJobs — the same permission the field needed when it travelled with the tree. Deliberately NOT behind a ruleMode: see the note on #185.
324. FIXED (chunk C) — see #205. `job.id !== jcoJobId` and its panel/op siblings in `jobClockOut` now compare as strings. This was the one on the money path.
325. DECISION PENDING — restating historic session hours. The chunk A fix changes what a session is worth going forward, but the 266 rows already in `productionhours.json` keep the wall-clock figures they were written with. 9 sessions over twelve hours hold 320.55h of the org's 1,083.6h — 29.6% of every production hour recorded — and seven of the nine subtracted nothing at all (95.47h, 67.84h, 44.54h, 24.62h, 20.37h, 17.36h and 13.03h of raw span). Recomputing them at productive hours would cut that to a fraction. Explicitly NOT done: production hours feed efficiency (production ÷ pay) and people have been paid against them, so a quiet restatement of 320h of past work is not a side effect of a bug fix. The per-session deltas are in scripts/backfill-logged-hours.mjs --sessions. Separate decision, separate commit. MEASURED: recomputing the 248 clocked sessions at productive hours changes 200 of them, for a net -418.48h against 1,083.6h recorded — a 38.6% reduction. The shape matters as much as the total: the nine long sessions give back 278h of it, but most of the remaining 191 rows move by about -1.5h each, which is one lunch and two breaks coming off an ORDINARY full day. So this is not a tidy-up of nine outliers; it would restate almost every day anyone has ever worked. Run `node scripts/backfill-logged-hours.mjs --sessions` for the per-row list.
326. ANSWERED 2026-10-02 by the rule log, on its first read — see #337. The entry asked whether schedule fields were being clobbered the way `loggedHours` was, and recorded precisely why S3 could not settle it: "What S3 cannot show is the lastModifiedAt the client POSTED, which is the only thing that decides whether enforce refuses a write — so the measurement cannot tell a clobber from a legitimate edit that happens to land on a changed job." The log shows exactly that field, and the answer is that THE INCOMING STAMP NEVER MOVES: five writes to one job inside eight seconds, one caller, all carrying 2026-10-01T19:39:52.595Z, each one landing on the stamp its OWN previous write had just stored. So the 106 changes reverted within six writes are not two editors racing — they are one client whose stamp is frozen, writing sequentially, with the conflict check correctly flagging each write against its predecessor. The machine-paced 1-second median that looked wrong for a human dragging a bar is explained: it is one drag session, not two people. THE LOG PAID FOR ITSELF ON ITS FIRST READ — #327 built it because function logs are not retrievable after the fact, and this is the question it was built to answer. Root cause and fix in #337.
327. PARTLY FIXED. Everything the server records about what it WOULD have refused was written to nowhere readable. `logRule` is a `console.warn` into the Netlify function log, and that log cannot be read back after the fact: `netlify logs:function` only streams live, and `netlify api --list` exposes no method for function logs at all. The rollout strategy in `_utils/rule-mode.js` is explicit that every refusal ships in `log` first so that "the logs show what live clients actually trip before anything is turned on" — that evidence was never being collected, for any of them. FOUR env flags are in this position, not one: SCHEDULE_RULES_MODE (4 call sites), TASK_CONFLICT_MODE (1), OVERLAP_RULE_MODE (1) and PERMISSION_GATES_MODE (2), all defaulting to `log`. SEVEN log tags: task-conflict, schedule-rule (tasks.js twice — the schedule rules and the overlap rule share the tag), permission-gate (tasks.js and clients.js), session-guard (timeclock.js twice, people.js once), hpd-default-write, plus server-owned-field and session-capped added during timeclock chunk A. So "collect data then flip" has meant "wait indefinitely" for every one of them. FIXED for TASK_CONFLICT_MODE only: `_utils/rule-log.js` appends records to `orgs/{org}/conflicts.json` through `updateJson` (append-only, bounded at 5,000 with a dropped count, never able to fail the write it describes), carrying the job id, both lastModifiedAt values, the signed staleness gap, the caller, and the FIELD LIST with values on both sides — without which the record is no better than the count that could not be retrieved. `scripts/read-conflicts.mjs` summarises it. The other six tags still only console.warn; extending them is one call per site using the same helper, and is not done because each needs a judgement about what its record should carry. No behaviour change: nothing here decides anything, so it is safe to run while every flag stays in log. FIXED for six of the seven tags. `_utils/rule-log.js` appends to `orgs/{org}/rule-events.json` — ONE file, so the reader does a single GET and groups by tag rather than reconciling seven files that disagree about their window. The cap is PER TAG (1,500 each, with a per-tag dropped count), because a global cap would let the noisy tags starve the valuable ones: hpd-default-write fires on every save from an old iOS build and server-owned-field on every clock-out that races an autosave, while task-conflict fired eighteen times in two days. Losing the rare events under the noisy ones is the same failure as logging where nobody can read — the data looks collected and the part you needed is missing. Every record carries the same base (tag, at, mode, refused, by, isAdmin, email) plus what its own decision turned on: task-conflict the field list with values and a signed staleness gap; schedule-rule the rule, op and detail; overlap-rule the two ops, person and day — split out of the shared `schedule-rule` tag, since it has its own flag and its own tier gate and a reader counting the old tag was adding two different decisions together; permission-gate which way each classifier went and the permission at stake; session-guard the field, the value rejected, the bound it violated and how far past it; hpd-default-write the node and the User-Agent, which is the only thing that names the offending build. NOT recorded: clients.js `clientsNoop`, where every field is fixed and the decision never varies, so the record says nothing the outcome changed — and buying a bare count would put an S3 read-modify-write on the path every worker client-list autosave takes. `scripts/read-rule-events.mjs` summarises the file per tag and names the flag each one decides.
329. The `finishRequest` chat bubble posts to groups.json and messages.json on every request, and that write is NOT idempotent even though the tasks write now is (#180). A second request for the same op is answered `{alreadyOpen:true}` and writes no task entry, but the bubble is skipped only because the handler returns before reaching it — the ordering is load-bearing and nothing asserts it. Worth a test rather than a fix. Found while building chunk B. Not fixed.
330. VERIFYING BASIC-TIER BEHAVIOUR — do NOT flip Matrix. Matrix is on Business, so none of #119-#123 had live data behind it. The tier changes what the schedule WRITES, not only what it draws — `enforceNoOverlap` (J:9050) and `reflowJob` (#124) both branch on it — so a few minutes on Basic with anyone editing could leave real data reshaped, and that cost is not recoverable by flipping back. Verify two ways instead, both of which exist now: (1) `scripts/basic-lanes-test.mjs`, 35 assertions against `src/basicLanes.js`, which was lifted out of an IIFE inside the team render precisely because nothing could call it there — five defects in one small block is what that cost; (2) `scripts/seed-basic-org.mjs`, which seeds org TRAQSBASIC with one row per fixture case so the render can be LOOKED at, since lanes are a visual judgement no assertion settles. The seed refuses to touch an org holding jobs it did not create, and refuses point-blank to write to a Business org. billing.json is deliberately absent — billing.js defaults to basic and provisioning to Business is manual, so nothing in the script can grant it.
331. The lunch default `{ time: "12:00", durationMinutes: 30 }` is written as a literal in five places beyond the day-view overlay #12 fixed: the orgSettings bootstrap (J:5319, J:5320, J:7162) and the Time Settings inputs (J:30391, J:30392). They agree with `DEFAULT_ORG_SETTINGS.lunch` today and drift the moment any one is edited — the same shape as #12, which is how it was found. Deliberately NOT swept in: the ruling was the overlay, and widening a day-view paint commit into a change of what every org's settings default to is a different decision. The bootstrap copies may also be redundant, since they are merged through `withOrgDefaults` immediately after. Found while building day-view chunk B. Not fixed.
332. NOT A DEFECT — ruling reverted 2026-10-02. The Job Clock card is hidden from Basic (J:21132, `isClockedIn && billingTier === "business"`) and that is deliberate. It was called a defect on the strength of the old `src/tiers.js` row "Mobile clock in/out", which read as covering it. It does not: clocking IN FOR THE DAY from the phone is Basic, and attributing that time TO A JOB is Business. They are two features and the table now lists them separately, so the gate no longer contradicts anything. What remains true and is folded into #125: `jobClockIn`, `jobClockOut`, `updateJobSession` and `releaseJobSession` carry no tier check at all, so the card is hidden in the UI and fully reachable through the API — that is an enforcement gap, not a missing feature.
333. CLOSED 2026-10-02 against the rostering design's decision 16 — see TIERS.md and BASIC_RECONCILIATION.md. Granular admin permissions were listed under Business in `src/tiers.js` while `_utils/can.js` enforced `adminPerms` for every org with no tier check, so the table sold what the code gives away. The entry framed the fix as a choice between gating `adminPerms` on tier — a takeaway from every existing Basic org — and giving them away deliberately, and both were bad. `origin/docs/rostering-design` had already answered it on 2026-09-22 in a third way neither option carried: ALL NINE KEYS STAY ENFORCED FOR EVERY ORG, and Basic is SHOWN only the four that mean anything in a product with no jobs — `manageTeam`, `orgSettings`, `approveTimeOff` and `undoHistory`, the last of which decision 18 then removes too, leaving three. The five job/client toggles (`editJobs`, `moveJobs`, `reassign`, `manageClients`, `approveCompletions`) are OMITTED FROM THE SETTINGS PAGE, not disabled and not revoked. Nothing is taken from anyone, because the five hidden toggles govern features Basic does not have; `can.js` is untouched, so no server behaviour changes and no org loses a capability it was using. The table never claimed granular permissions, so no row is needed either way and `tiers-test` keeps asserting the claim appears under neither tier. Worth recording HOW this closed: the ruling removes the dilemma rather than picking a side of it, and it had been sitting unread on an unmerged branch for ten days while this campaign treated the question as open.
334. NOT A DEFECT — ruling reverted 2026-10-02. `TRAQS.jsx:4206` gates the Jobs page, Analytics and Clients for every non-Business org, and that is the product design. This was logged because `src/tiers.js` argued in writing that Analytics must NOT be gated — "Gating it would be taking something away, not adding something" — and the code gated it anyway, which looked like the sharpest case of code and sold definition disagreeing. The disagreement was real; the resolution was backwards. The COMMENT was the wrong half: it was reasoning about a tier line nobody had written down, in a file whose job was to write it down. All three are Business, the table now says so explicitly, and that comment is gone. See TIERS.md.
335. MOOT — never a live defect. Logged against commit 6257ee3, which unhid the panel/op wizard for Basic and so orphaned the Basic simple-edit path (`openSimpleEditForJob`, `renderSimpleJobModal` and its `modal.type === "simpleEdit"` dispatch, `simpleEditable`, `refuseSimpleEdit`, `jobForBarTask` — roughly 150 lines and a whole modal). That commit is reverted, so the path is live again and is Basic's only edit surface. Nothing to delete. The #159 and #160 fixes made on it one chunk ago are back in force and still correct — which is the thing worth noting, since deleting it would have taken those with it.
336. RESOLVED 2026-10-02 — NOT A DEFECT, and the original entry was my error. `ai-schedule` is a Netlify EDGE function, `netlify/edge-functions/ai-schedule.ts`, 219 lines, tracked in git and present on master. The entry claimed it had "no source in this repository" on the strength of searching `netlify/functions/` alone and stopping there — edge functions live in a different directory and deploy by a different mechanism, which is also why the live endpoint answered 401 rather than 404. It was moved there deliberately: commit 18fc18f, "migrate ai-schedule to Netlify Edge Function for reliable streaming", after 628af98 tried SSE streaming to defeat a 504 inactivity timeout. It is reviewable, it authenticates properly (jwtVerify against the Auth0 JWKS, with 401s for a missing, malformed or unverifiable bearer token), and nobody is locked out of fixing it. ONE REAL FINDING SURVIVES, and it belongs to #125: the function contains ZERO references to tier or billing, so AI scheduling — the one piece of automatic scheduling that IS a server endpoint, and therefore the one place a tier gate could genuinely be enforced — has no tier gate. TIERS.md said that could not be determined from here; it can, and the answer is no.
337. FIXED 2026-10-02. The client never adopted the `lastModifiedAt` the server wrote, so every save after the first in a session carried the stamp the client had LOADED with. `POST /tasks` returned `{ ok: true }` and `doSave` read the body only for `conflicts`, discarding the rest; `stampArray` advances each record's stamp on write, so from the first save onward the client's copy was behind the stored one and the per-job conflict check at `tasks.js` saw each write as stale against the write before it. Found by reading `orgs/MTX2026TRAQS/rule-events.json` for the first time: five task-conflict records, one job (t4r7tg0x9), one caller, inside eight seconds, with an identical incomingStamp on all five and each storedStamp equal to the previous record's own write. The -20.9h "staleness" was never a stale tab clobbering a colleague — it is just how long since that session last did a GET. FIX: `/tasks`, `/people` and `/clients` now return `{ stamps: { id: lastModifiedAt } }` alongside `ok`, and `doSave` merges them into state via `adoptStamps`. STAMP ONLY — the content stays whatever is in state, which may already hold edits made while the save was in flight, and overwriting those is the adjacent bug rather than the fix. The merged array is registered in `pollAppliedRef` exactly as the poll does, or the autosave effect reads a stamp refresh as a user edit and loops one save per refresh. People and clients are fixed for symmetry and have no conflict check today, so a stale stamp there costs nothing YET — which is exactly why it would be missed when one is added. STILL OPEN, logged not fixed: six direct `savePeople` call sites (J:8513, :19228, :26401, :26429, :26440, :31007) discard the response the same way. Zero cost today for the same reason, and they want the same treatment before any conflict rule reaches people. `scripts/save-stamp-test.mjs` pins the property nothing was checking — after a successful save the stamp the client holds equals the stamp now stored — with a red proof that replays the old sequence and reproduces the production trace, and a section proving the un-adopted second write is REFUSED in enforce while the adopting one is accepted in the same mode. That section is the evidence behind the reversal recorded on #185.
338. OPEN, not built — undo replays stale stamps, and it is the SECOND precondition on flipping TASK_CONFLICT_MODE (see #185). `undo()` restores `undoStack.current.pop()`, which is a `JSON.parse(JSON.stringify(prev))` deep copy taken when the frame was pushed — so it carries the `lastModifiedAt` every job had AT THAT MOMENT. After #337 the client adopts the server's stamp on every successful save, which means the stamps in any undo frame are by definition older than what is stored. Pressing Ctrl+Z therefore posts a tree of stale stamps, and `tasks.js`'s per-job conflict check flags every job the undo touched. IN LOG MODE that is noise in rule-events.json and the write goes through, so undo works and the log is dirty. IN ENFORCE EVERY UNDO IS REFUSED AS A STALE WRITE AND SILENTLY ROLLS BACK — undo stops working, with a conflict banner, for a user who did nothing wrong. #218's fix does NOT address this: it stops undo CAPTURING server writes, it does not stop an undo REPLAYING old stamps, and the two are independent. FIX SHAPE, two candidates, neither built: (A) STRIP STAMPS FROM THE SNAPSHOT — `undoStack` stores the tree with `lastModifiedAt` removed, and `undo()` re-attaches the CURRENT stamp per job id as it restores. Cheap, local to the two push sites and the two pop sites, and it makes an undo frame what it should always have been: a record of CONTENT, not of sync bookkeeping. Risk: a job deleted since the frame was pushed has no current stamp to re-attach, so restoring it is a resurrection and needs the same treatment as any other create. (B) RE-READ ON RESTORE — undo restores content, then takes stamps from `latestTasksRef.current` at restore time. Same effect, less storage change, but it reads live state inside a setState updater, which this file has been bitten by before. (A) is preferred: it puts the rule in the data rather than in the restore path, so a future third consumer of `undoStack` cannot get it wrong. NOTE the interaction with #218: now that server writes no longer enter the stack, every frame is a user action, which is exactly what makes stripping stamps safe — the frame no longer needs to carry sync state because it no longer represents a sync event. FIXED 2026-10-02, shape A. `undoStack`/`redoStack` now hold `snapshotForHistory(prev)` — a deep copy with top-level `lastModifiedAt` removed — and `undo()`/`redo()` restore through `restoreWithLiveStamps(frame, prev)`, which re-attaches each job's CURRENT stamp from live state on the way back in. Top level only, deliberately: the conflict check reads `job.lastModifiedAt` and `stampArray` stamps array-root records, so nested stamps on panels and ops are vestigial. A job deleted since the frame was pushed has no live stamp and goes back without one — the server stamps it on write, which is the create path, and a resurrection IS a create. #218 is what made this safe and is worth keeping in view: once server writes stopped entering the stack, every frame became a USER ACTION, so a frame no longer needs to carry sync state at all. THIS CLEARS THE SECOND PRECONDITION ON #185.
339. SCOPED, not built — #227 item 2, sending only the jobs that changed. THE PRIZE: measured over the 40 most recent writes, 508.3 KB POSTed per write against 17.3 KB actually different (3.4%), 112 jobs sent with a median of 1 changed. Item 1 (built) removes the ~48% of writes that change nothing; this removes most of what the remaining writes carry. THE BLOCKER: `reconcileDeletions(incoming, existing)` infers deletions from ids ABSENT in the POSTed array, so a partial POST reads as a mass delete. Deletion must become EXPLICIT before the payload can become partial. SHAPE: an envelope, `{ upsert: [...jobs], delete: [...ids] }`, with the bare-array body still accepted so old clients and the native apps keep working — the endpoint decides by shape, not by a version flag. WHAT IT TOUCHES, each needing its own thought rather than a mechanical port: (a) `reconcileDeletions` — tombstone exactly the listed ids instead of diffing; (b) THE EMPTY-ARRAY OVERWRITE GUARD, which is the data-protection measure from the 2026-06-03 incident and currently keys on an empty incoming array — under an envelope, `{ upsert: [], delete: [] }` is a legitimate no-op while `{ delete: [everything] }` is the dangerous case, so the guard moves from shape to intent; (c) the per-job conflict check, which is already per-job and should need no change but must be confirmed against a partial array; (d) `stampArray(reconciled, existing)`, which preserves stamps for records it does not see — with a partial POST the unsent records are simply absent, which is the behaviour already wanted, but it must be verified rather than assumed; (e) `changedIds` and the `publishChange`/silent-push recipients; (f) the client, which must track which jobs are dirty rather than sending everything — the content key added for item 1 is per SLICE and would need to become per JOB. NOTE THE ASYMMETRY THIS CLOSES: the READ path has been delta-synced since `sync.js` shipped (`arrDelta`, `changedSince`, a cursor per entity) while the WRITE path still sends the whole org on every keystroke's worth of change. SIZE: this is a protocol change to the most safety-critical endpoint in the product, the one that lost `loggedHours` in #323 and overwrote tasks.json in the 2026-06-03 incident. Estimate 4-6 focused days with the suite work, and it wants its own pass rather than riding along with anything. HELD 2026-10-02 after the scoping, and the reason is the guard. Moving the empty-array overwrite protection from SHAPE to INTENT is where the real risk sits — that guard is one of the three measures put in after the 2026-06-03 incident, and it is what stands between the product and another one. This wants its own pass with full attention rather than riding along with anything.


343. FIXED 2026-10-02, found at runtime by Treysen on the dev server, NOT introduced by this campaign — `git log -S` puts it in `9e86f12 feat: redesign New Job modal as 3-step wizard`, so it has been reachable since the wizard landed. `TypeError: Cannot read properties of undefined (reading 'length')` took the whole New Job modal down. THE SHAPE: the overlap-error path at :25993 did `setAiSuggestion(prev => ({ ...(prev||{}), overlapError }))`. On a plain edit-and-save the scheduler has never run, so `prev` is NULL, and spreading `{}` produces an object with an `overlapError` and NO `slots` — which the panel below reads as `aiSuggestion.slots.length`. A truthy object that is missing the field every reader assumes is there. FIXED AT BOTH ENDS deliberately: the setter seeds `{ slots: [], ...(prev||{}) }` so the unrenderable shape is never produced, AND both renderer reads take `(aiSuggestion.slots||[])` so a partial shape degrades instead of crashing. One guard alone leaves the next partial shape to find the same cliff — and the next one will not be `slots`. Spread ORDER matters and is asserted: `{slots: [], ...prev}` keeps a real suggestion's slots; reversed, it would silently empty a scheduled suggestion, trading a loud crash for lost work. The `noSlots` branch also now excludes the overlap-error case, which was the condition that put the two states on screen together. Covered in `replan-preview-test.mjs` section 7 plus four red-proof cases that REPRODUCE the throw rather than describe it; all three fix sites mutation-proved.

    THE CLASS, which is the part worth keeping: this is the same family as #337 and the empty-tasks overwrite — a value that is present-but-wrong rather than absent. `aiSuggestion` guards exist and all of them test the OBJECT for truthiness; none tested the field. A null check on the container says nothing about the shape inside it, and every reader here had assumed a shape only one of the three writers actually produced.

    AND A TEST-HYGIENE NOTE, the fifth time this campaign: the first version of the "no unguarded read remains" assertion failed against the fix, because the COMMENT explaining the fix names `aiSuggestion.slots.length` in order to explain it. The scan matched its own prose. The suite now builds a `CODE` view with line-comments stripped, and asserts against that. An assertion about code must not be satisfiable — or violable — by a comment; see LESSONS #5.

344. FIXED 2026-10-02, reported by Treysen from the New Job wizard: "Assignment aborted. Conflict detected: Quincy: Layout overlaps 2055-02 Layout in 402055". One collision and the run did `return p` — the ORIGINAL job, unchanged — so a thirty-op job produced nothing because one op clashed. TWO INDEPENDENT FAULTS, STACKED, and the second one manufactured the input to the first.

    FAULT A — THE RUN INVENTED THE CONFLICT IT THEN ABORTED ON. `pickTeam` searched 300 business days for a window and, when it found none, returned `team: eligible.slice(0,1)` at a fallback date WITHOUT calling `isAvail`. A deliberate double-book, in both the one-person and the team branch. This is precisely the naive "place it anyway" that `replan-preview-test` already red-proofs against, surviving in the one scheduler the preview does not drive. Both fallbacks now report `OUTCOME.noWindow` and place nobody. The empty-candidate case likewise reports `OUTCOME.noCandidates` instead of returning a zero-width dateless stub.

    FAULT B — THE VERIFIER WAS A SIXTH OVERLAP IMPLEMENTATION. Four nested loops comparing raw date intervals: `ePnl.start <= sub.end && ePnl.end >= sub.start`. No hours, no work days, no time off, no capacity. The oracle that MADE the placement (`schedulerAvailability` → `overlapsWith` → `unitBlocks`) has all four, so the two disagreed in both directions. It aborted legal plans — two ops on one day at different hours read as a clash — and it caught Fault A's self-inflicted double-books. Replaced with a per-op backstop that asks the SAME oracle, re-booking as it verifies so sequential placements still see each other. A fresh verifier, not `_applyAvail`, which already holds this run's own bookings and would report our own work as the conflict.

    THE ABORT IS GONE, not softened. The run places what it can and reports the rest per op. A refused op keeps its ORIGINAL record — the same promise the preview already prints ("these stay exactly where they are") — because writing it back with fresh dates and nobody on it is worse than the abort it replaced. The old `: (sub.team||[])` fallback did exactly that: it handed the existing team brand-new dates in the one case where the search had just failed to find any.

    ONE SURFACE, NOT TWO. The wizard and Reschedule are the SAME run — `p.isReschedule` branches inside it — so this was one bug wearing two faces, and reschedule would have aborted identically. The other three retired call sites were checked and do not abort: the gantt auto-slot skips per op and toasts when nothing is placeable; `_autoAssign` returns an empty team. Neither discards a run.

    REPORTED THROUGH THE PREVIEW'S PANEL, not a second one. `OutcomePanel` is now shared by the re-plan preview (what WOULD happen) and the wizard's step 3 (what DID), both fed by one shape from `placement.js` — `previewOutcomes` and the new `foldRunOutcomes` return it from a single `summarize`. Load is derived from the placed rows rather than passed in, which makes "a blocked op carries no hours" true by construction instead of by remembering. `_outcome`/`_placed` are stripped before commit; a scratch field that reaches S3 is indistinguishable from real data the next time something reads it. Job bounds now come from what was committed, not from the run's working copy, which since this change are different lists.

    `run-outcome-test.mjs`, 31 assertions, wired into the build (54 suites). Mutation-proved: seven mutants, seven caught. TWO OF THEM EXPOSED REAL HOLES rather than confirming the fix — every blocked row in the first draft had `person: null`, so half the "blocked ops carry no hours" guard was never exercised and could be deleted with the suite green (OUTCOME.clocked is exactly that shape); and `/OutcomePanel/` matched `OutcomePanelX`, so forking the panel went undetected until `\b` was added on both ends. The definition-rename mutant is caught by lint, not by the suite, and that was verified rather than assumed.

    TEST HYGIENE: the comment-vs-code trap (#343) recurred immediately — the JSX comment left where the abort banner stood, `{/* … */}`, is not a line comment, so the line-comment filter missed it and the removal read as incomplete. `scripts/_code-view.mjs` now strips block AND line comments and is imported by both suites. One copy, because two copies of a scanner drift and a drifted scanner is the quietest kind of broken test: it keeps passing.

345. FIXED 2026-10-02, ruled by Treysen: "even load" must sum HOURS, not count bars. The objective was `loadOf: (id) => jobCount(id)` — unfinished panel and op ROWS a person appeared on — in TWO identical copies (the wizard's and the gantt scheduler's). Balancing the count of things is not balancing the work. `previewOutcomes` had been summing `op.hpd` all along, so the preview Treysen reads before committing and the run that committed already disagreed about what "even" meant; nothing reconciled them because nothing compared them.

    THREE DEFECTS IN ONE FUNCTION, and the last two came free by routing through the shared traversal: (1) bars instead of hours; (2) `.includes(pid)`, which misses number-typed ids — 12 of 1197 live Matrix memberships — and misses them SILENTLY, so the person merely looks lighter and the balancer hands them more; (3) no `deletedAt` and no date filter, so an undated or long-past unfinished bar made somebody look busy forever and quietly steered work away from them for good. `hoursLoadOf` in placement.js takes units from `occupyingUnits()` rather than walking the task tree a third time, and shares an op's hours across its team — a 2-person 8h op is 4h each, not 8h each, or teamed work looks twice as expensive as it is and the balancer avoids teams.

    A CORRECTION TO MY OWN EVIDENCE, which matters more than the fix. I reported that the objective was responsible for a 370h/179h split on TORUS between Tyler and Jason. IT WAS NOT. S3 object versions either side of the run (2026-10-02T22:21:45 vs 22:22:09) show all 60 TORUS ops already carrying the same five people BEFORE the run — manual assignment, which the scheduler RESPECTS (ruling 2), so the objective was never consulted for a single op on that job. TORUS's own hour split is 84h/60h (1.4:1) and is manual. The 2:1 total came from OTHER jobs' pre-existing load. The ruling stands on its own merits and the code was genuinely wrong; the measurement I offered in support of it did not show what I said it showed.

    WHAT THE CHANGE ACTUALLY DOES, measured on the real candidate pool (the 7 people TORUS's Layout+Wire departments allow): preference order BEFORE `Danny < Caleb < Quincy < Jason < Howie < Tyler < Draven`, AFTER `Danny < Caleb < Jason < Quincy < Howie < Tyler < Draven`. Two of seven positions change; the first pick does not. The number that justifies the fix is HOURS PER BAR across the pool: 4.6 to 9.1, a 2.0x spread that counting bars could not see at all. On a job whose ops are all manually assigned the change does nothing, which is correct and is the first thing `measure-objective-split.mjs` now reports.

    THE MEASUREMENT TRAP, recorded because the obvious comparison is wrong and looks right: stripping teams off a job's ops and re-picking under each metric produces a dramatic before/after (332h/28h becoming 360h/0h) that is pure fiction, because the scheduler would never reach that branch for an op that has somebody on it. The first version of the script did exactly that. Manual assignment has to be checked BEFORE any objective comparison is believed.

    `even-load-test.mjs`, 16 assertions, wired into the build (55 suites). Six mutants, six caught, including both app call sites reverting to a bar counter.

346. REOPENED 2026-10-04. The verdict may still hold, but its argument rested on the crew being at 92% of capacity, a figure that counted 49 deleted jobs as live work (#356, #357). Re-measure before re-settling. WAS: SETTLED 2026-10-02, measured, not to be re-raised. "The plan leaves gaps — bars on one row with empty days between them while work continues later." It is the even-load objective plus genuine prior commitments, NOT the greedy search failing to backfill. On TORUS (60 ops, 5 people, 24 business days): 12 idle person-days inside the job, of which BACKFILLABLE = 0. For every hole, the test was whether an op placed later could have been pulled into it — panel predecessor already finished, person free — and the answer was no, 12 times out of 12. All 12 were the person working another job that day. TRULY EMPTY days on the drawn row across all jobs: 0. Idle days inside panel chains: 0 across 30 multi-op panels.

    MAKESPAN WOULD HAVE MADE IT LONGER, NOT SHORTER, because there was nothing to pack into: the crew was at 92% of capacity in that window BEFORE TORUS landed. Packing TORUS's 360h into the slack that remained — other jobs frozen, precedence ignored, so a lower bound rather than an achievable plan — needs 27 business days against the plan's 24. The scheduler is already tighter than that bound because it will go over capacity where a slack-only packing will not.

    A MODEL I BUILT AND THREW AWAY, recorded so it is not rebuilt: a day-granularity makespan simulation gave 3 days, then 44 days after being made resource-constrained. Both were wrong, because the real scheduler works in hours and several ops share a day; a day-granularity model cannot represent that and errs in both directions. No number from it was reported. `measure-plan-gaps.mjs` re-runs the whole measurement against any job.

347. STRUCK 2026-10-04. Tyler at 205% was the 49 deleted jobs counted as live work (#356); the real figure is ~21%, the crew ~14%. Not a staffing defect. WAS: OPEN, NOT A SCHEDULING DEFECT — A STAFFING ONE. Tyler is booked at 172% of capacity over 2026-10-13 → 11-13 BEFORE TORUS was added, and 205% after: 370h against 180h of capacity, over capacity on 21 of 24 business days. This predates TORUS and predates this campaign; it was found while answering the gap question and is logged so it is not lost. The rest of the pool over the same window, before TORUS: Howie 95%, Draven 73%, Jason 62%, Quincy 60% — crew total 92%. So the load is not merely high, it is concentrated: one person is carrying nearly double his capacity while three others sit near 60%.

    WHAT THIS IS NOT: it is not the overlap rule failing. The rule is hour-aware and 62% of dated ops carry a startHour, so same-day work legitimately shares a day. Whether 21 days over capacity reflects real commitments, stale unfinished bars that should have been closed, or estimates that are too high is a question for Treysen, not for the scheduler. The fix for #345 will push NEW work away from him, but it cannot unwind what is already booked.

    Figures from `measure-plan-gaps.mjs`. They rest on `hpd` being an op's TOTAL estimated hours divided across its team, which is how pickTeam reads it (`ceil(hpd / productiveHoursPerDay)`); if some ops mean something else by `hpd` the percentages move, though the gap attribution in #346 does not, being date-based.
348. `planPushes` is imported and never called; two suites exercise it, so it reads as live and covered.
349. Approved PTO never reaches `person.timeOff`, so every schedule guard is blind to it; all three checks also ignore the request's status.
350. Emoji in the UI against the standing rule — 12 sites, 2 of them in the schedule.
351. D1 — two placement engines remain. The gantt fails silently on zero-width dates; #344's reporting fix landed on the wizard only.
352. D2 — three op-duration formulas. Latent: 0 of 1,073 ops diverge.
353. D3 — two working-day calendars: timeclock.js hardcodes Mon–Fri and ignores holidays. Plus three identical private `nextDay` helpers.
354. D4 — five sites compute the working-day length, with three different guards.
355. D5 — three membership idioms and 9 raw `.includes(pid)`; 12 of 1,197 live memberships are number-typed.
356. D6 — 130 traversals of tasks, 2 of which guard `deletedAt`; 49 deleted jobs hold 536 dated, teamed, unfinished ops that are read as live.
357. `measure-plan-gaps.mjs` was committed with the D6 bug; two runs over the same window disagree by 60 h.
358. [found in iOS chunk A, not investigated] OverlapRuleTests.finishedWorkDoesNotTakePart fails on unmodified master (30f792b) — the only red test in the iOS unit suite.
359. [found in iOS chunk A] JS `productiveClockHours(a, b)` does not clip to the working day; Swift `WorkDayClock.productiveHours` does. They agree inside the day, which is the only way opDaySegments calls them, so the parity fixture covers only that domain. A caller passing hours outside the day would get different answers on each side.
360. [found in iOS chunk A] Business day view (web and now iOS): multi-day units are placed by their own walk, OUTSIDE the shared-cursor pack, so two overlapping multi-day units draw on top of each other — the comment "its packing pass already guarantees no same-person overlap" is not true for them. Matrix, week of 2026-10-05: Quincy, 3 person-days (tvi2a06na and tst5cu0x3 both 8–17 on Oct 6). Data overlap of the #303 kind; the render hides one card under the other.
361. [found in iOS chunk A] `startHour` is read from extras in two places, JobShifts.startHour and OverlapRule.startHour.
362. FIXED 2026-10-04 (f0490ce; production deployed again, first since 1ac3a98). hpd-test: "Estimates to check" really was dropped by the redesign — restored in the new Schedule settings. appearance-test: NOT a missing feature — the controls survived with re-cased labels; the check now asserts the controls (jobBarMode, jobBarColor, cellColorMode, scheduleGrid), not label text. css-dead-test: staggerUp deleted; .rv-tog is LIVE (every Settings switch, sTog) and the sweep was misreading it — fixed the sweep, kept the rules. WAS: [found in iOS chunk A, not investigated] `npm run build` is red on master (30f792b) before vite runs: hpd-test ("admins get a list of estimates to check"), css-dead-test (.rv-tog rules and @keyframes staggerUp unreachable) and appearance-test ("job-card, list-cell and grid controls stayed"). Same three failures with and without chunk A. ORIGIN: all three pass at 1ac3a98 and fail from c28e01b (Settings redesign, 2026-10-04), which removed the Settings → Schedule "Estimates to check" list (suspectHpdOps, root cause 5), re-cased the appearance control labels, and left staggerUp orphaned. Netlify runs `npm run build`, so every production deploy since c28e01b has failed; production is still 1ac3a98.
363. iOS `JobEditView` rewrites a job's start/end without moving its panels and ops, so the job's envelope and its children disagree after any date edit. Same class as #262 (and the web's #85 before root cause 6). Reachable only from JobDetailView, which is itself unreachable today; logged, not fixed.
364. FIXED (iOS chunk C, 2026-10-04). The Mac New Job sheet's scheduler (JobsScheduler, shared Services/) still ran the department rules the web dropped in 4ee9598: a department inferred from the unit's TITLE, one department rather than a set, primary-before-secondary ranking, an existing team overwritten, and a FALLBACK TO ALL CREW when a department had nobody — the funnel that put 71 ops on one person. Matrix's live data: 59 of 185 units (44 unfinished) took a department from the title alone, and 7 of 11 departments have no schedulable crew. CORRECTION TO THE BRIEF: it is the Mac's New Job sheet, not iOS — iOS never calls JobsScheduler's placement; and the heuristic's removal is 4ee9598, not #341. Ported `unitDepartments`, `personDepartments`, `personDeptMatch` and `candidatesFor` (Services/Departments.swift, fixture `candidates`); an unstaffable unit fails its windows and the sheet names it. The rest of the web engine (ordering, even load) is #351.
365. Cross-row bars are not drawn on iOS: hours someone clocked on an op whose team they are not on, which the web draws on their own row spanning the worked sessions. Needs per-person job-clock session spans that iOS does not model. Logged from #252, not fixed.
366. [found in iOS chunk D survey, not fixed] The Mac app keeps its own device-zone "today": `JobsDate.todayKey` (JobsGrid.swift:1593, deliberately not AppState.ymd) and a `Calendar.current` day-of-month in WebIcons.swift:411. Outside #304, which covers the iOS target; the Mac shares none of the S functions #304 moves.
367. FIXED (2026-10-05). The helper takes `status:` as a parameter, so the key is written once; the case passes `status: "Finished"`. Suite 14/14, full iOS suite 407/407 under a New York test host — green on master for the first time since this was logged. Still catches what it was written for: with `!unit.finished` deleted from `OverlapRule.takesPart`, it fails, and so does `JobsSchedulerTests.finishedWorkBooksNobody` — finished work is guarded from two sides. Swept for the same shape elsewhere: every test JSON helper that splices caller fields after fixed keys (GanttLayoutTests op/panel/jobs, this one) and every multi-line fixture; no other repeats a key. WAS: DIAGNOSED (2026-10-05), not fixed: a TEST defect, not a rule defect. The test's `op()` helper hard-codes `"status":"Not Started"` and then appends the case's fields, so Y carried `status` TWICE. Foundation's JSON decoder on this OS keeps the FIRST duplicate key (checked directly: `{"status":"Not Started","status":"Finished"}` decodes as Not Started, both JSONDecoder and JSONSerialization), so Y was unfinished and rightly overlapped; the suite must have passed when written under a decoder that kept the last. Proved by executing: with the duplicate removed the suite is 14/14. OverlapRule itself excludes finished units. No other test fixture repeats a key. Fix: one line in the helper — emit its default status only when the fields don't carry one. WAS: [found running the suite for iOS chunk D, not fixed] `OverlapRuleTests.finishedWorkDoesNotTakePart` fails on clean master (23840af): a Finished op on 2026-10-05 still registers a hit at OverlapRuleTests.swift:82. Not investigated — either the overlap rule counts finished work again or the test predates #252 ruling that finished work shows.
368. FIXED (iOS chunk D, 8d170c0, 2026-10-05). LIVE AT MATRIX. The chat time-off card (`TimeOffRequestBubble.rangeLabel`, MessagesView.swift) read a stored "yyyy-MM-dd" day at UTC midnight and printed it in the device's zone, so every viewer west of UTC — all of Matrix — saw a request for Oct 5–7 as "Oct 4 – Oct 6". People read those cards to know when someone is off. TimeOffView's two copies of the same formatter had already been fixed in place; the chat copy never was. All three now call one helper, `ShopTime.label`/`rangeLabel`, which reads and prints a stored day in a single fixed zone so the device's never enters. Held by LiveDateBugsTests.
369. FIXED (iOS chunk D, 8d170c0, 2026-10-05). `AppState.ymd` formatted in UTC. Its picker callers (AddJobSheet start/end) hand it the device's midnight, which east of UTC is the previous UTC day — a job picked for Oct 5 in Berlin saved as Oct 4. It now reads the date in the device's calendar, the one the DatePicker showed. Not a "today": the shop's day is `ShopTime.day`. Held by LiveDateBugsTests (Berlin, Tokyo, New York, Auckland).
370. FIXED (iOS chunk D, 8d170c0, 2026-10-05). LIVE AT MATRIX. The Basic Home "Today" card (`BasicShiftsCard`, HomeView.swift) took today from `AppState.ymd(Date())` — the UTC day — so at 18:00 Denver (17:00 under MST) it rolled over and showed tomorrow's shifts as today's all evening. It is the shop's day now (`ShopTime(org:).day`), per chunk D ruling 1. Held by LiveDateBugsTests, both sides of DST.
371. [ruled in iOS chunk D, not fixed] Punch times are VIEWER time (ruling 2, matching the web) but the day they are grouped under is the SHOP's, so a late-evening punch can sit under the wrong-looking heading: a New York viewer of a Denver shop sees a 23:30 Denver punch printed as 01:30 under the previous day's heading (iOS Stats › Past Jobs, MoreView `jobSessionGroups` heading vs `EntryRow.timeRange`). The web has the same quirk. Logged by ruling, not to be fixed in chunk D.
372. [found in iOS chunk D, not fixed] iOS `PayPeriod.window` keeps legacy weekly / biweekly / semimonthly branches the web no longer has (the web's only pay-period function is getPayPeriodFromDates, root cause 9 chunk 2). They run only when `payMode` is not "setdate" AND `payDates` is explicitly empty — a missing payDates decodes to [5, 20] — so they are probably unreachable, and if reached they disagree with the web, which would use [5, 20]. Moved to shop time with everything else; not deleted.


373. OPEN, logged not fixed 2026-10-05, reported by Treysen from the console. `PersonAvatar` sets the `background` SHORTHAND alongside `backgroundImage`, `backgroundSize` and `backgroundPosition` on one inline style object — `src/TRAQS.jsx:3155-3157`:

        background: img ? T.surface : fill,
        backgroundImage: img ? `url(${img})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",

    React warns on every render that mixes the two, and the warning is not pedantry about style: `background` is a shorthand that RESETS `background-image`, `background-size` and `background-position` to their initial values. React diffs inline styles key by key, so on a render where `background` changes but `backgroundImage` does not — a theme switch, an accent change, or the person's colour being edited — React writes `background` and does not rewrite `backgroundImage`, and the avatar's photo is wiped to a plain surface fill until something unrelated re-renders it. The object's key ORDER is what hides this most of the time, which is exactly why it is intermittent rather than constant.

    REACHABILITY, measured against live Matrix data: 2 of 24 people carry an `avatar`/`image`, so only those two render with both properties set and can lose the photo. The other 22 take the `fill` branch where `backgroundImage` is `undefined` and no collision exists. Low blast radius, but the console warning fires for every avatar on every render regardless, which is noise over a real signal — the same cost as an unreadable log.

    The fix is to drop the shorthand and write `backgroundColor` instead, which collides with nothing. Not done: logged on Treysen's instruction.

374. FIXED 2026-10-05. RESCHEDULE HAD BEEN DOING NOTHING AT ALL SINCE db3a87e, and the dimmed rows (#375 below) were its only visible symptom. `rescheduleSelection` is declared "OP ids selected to be re-planned". The context-menu entry that opens Reschedule seeded it with `(job.subs || []).map(p => p.id)` — PANEL ids. Every reader wants op ids: `panelSelState` (which compares against `selectableOpIdsOf`), `computeReplanPreflight`, the per-op checkboxes, `excludeOpIds` at both oracle sites, the scheduling filter, and the commit merge. No op id was ever in the list.

    WHAT THAT DID, in order: every panel read "none", so every row dimmed and every checkbox showed unchecked; the preview computed over an empty op set; `excludeOpIds` excluded panel ids, so the ops being re-planned stayed in their OWN obstacle set and blocked themselves; the scheduling filter matched no panel, so `expandedOps` was empty and the run placed nothing; and the commit merge matched no op, so it wrote nothing back. A full, apparently-working modal that could not change a single date.

    WHY NOBODY REPORTED IT: a modal that silently does nothing looks like a modal that worked. There is no error, no refusal, no empty state — the wizard runs to the end and closes. It took Treysen noticing that the rows looked *dim* to find a bug that had nothing to do with dimming.

    MINE, AND SIGNED OFF. db3a87e is the commit that moved selection from panel ids to op ids on Treysen's ruling ("selection as op ids with tri-state panel checkboxes"). Every READER was converted; the single WRITER was not. That is LESSONS #7 — grep the write as well as the read — failed inside the commit that was applying it elsewhere.

    THE GUARD IS ON THE CLASS, NOT THE INSTANCE: `replan-selection-test` asserts that EVERY `setRescheduleSelection` call either derives its ids from `selectableOpIdsOf` — the same helper `panelSelState` and the checkboxes read — or transforms `prev`, which cannot introduce a new kind of id. Mutation-proved against the original panel-id seed AND against a different wrong source (`opIdsOf`, which would have re-admitted clocked ops), because a guard that only catches the exact bug it was written for is a guard against history.

375. FIXED 2026-10-05, the symptom of #374 and a real defect in its own right. Unselected panel rows in the re-plan wizard dimmed with GROUP OPACITY at 0.4. Measured against the panel ground the way root cause 8 settled — composite, then compare — primary text at 0.4 is 2.59, BELOW the 3:1 non-text floor, let alone AA's 4.5. Every control on the row read as disabled when it was not; Treysen's words were "I thought the modal was broken", and it was, though not for that reason.

    NO MULTIPLIER WOULD HAVE WORKED, and this is the part worth keeping. `T.textDim` measures 2.78 against this ground at FULL opacity — it already fails AA before any dimming. So every candidate multiplier starts below the line and only falls: 0.75 gives primary 7.99 and secondary 3.07 but leaves dim text at 2.09. Tuning the number was never going to produce a readable row, which is why the fix is structural rather than a better constant.

    GROUP OPACITY IS THE SCHEDULE'S TOOL, NOT A FORM'S. It dims an entire subtree — borders, focus rings and all — which is correct for a bar you are not looking at and wrong for a department picker, an hours field and a date range you are about to click. The ground now carries the state (`T.bg` selected, `T.card` not), content stays at opacity 1, and the contrast does not move: primary 16.26, secondary 4.54, both AA. The card fill is deliberately quiet — 1.09 against the page — because the unchecked checkbox is the primary signal and this is the supporting one. The suite asserts the measurement, not the colour, so a future theme cannot quietly drop it below AA.

376. FIXED 2026-10-05. `npm run build` had been RED since the redesign landed, and the failure was not in the code. `schedule-parity-test` gates on `committed !== text` — a WHOLE-FILE string compare between the fixture on disk and the text it generates in memory. git checks this repo out with `core.autocrlf=true`: the index holds LF, the working copy holds CRLF, and the generated text is LF. The two differed by one `\r` per line — 49,474 of them — and the suite reported that the web schedule rules had drifted from the iOS ports when nothing had changed at all. 2,098 cases now match; they always did.

    THE TELL WAS IN ITS OWN OUTPUT. The line directly below the gate parses both sides and prints `sections that changed:` — and it printed NOTHING, every time. A gate that fails while its own explanation finds no difference is comparing the wrong thing. That empty list was read as unhelpful rather than as the answer, across two separate `git pull` sessions.

    WHY THIS MATTERS MORE THAN ONE SUITE: a permanently red build is the same as no build. Nobody reads the 64th line of output to work out whether today's failure is yesterday's failure, so every real regression after this one would have landed behind a red that everyone had learned to ignore. The cost was already being paid — #374 and #375 shipped with the build red, and `npm run build` could not have told anyone.

    FIXED THE WAY #314 FIXED IT, which is the precedent this repo already set in `web-gates-test` (2609224): NORMALISE WHAT THE TEST READS, LEAVE THE SOURCE ALONE, AND ADD A CANARY. The fixture is untouched — regenerating it with `--write` would have committed CRLF into the blob, broken it for every other machine, and, per the suite's own message, put iOS out of parity until `ScheduleParityTests` was re-run. It would also have destroyed the evidence that nothing had drifted. The canary exits 2 with a named reason if a `\r` ever survives normalisation again.

    THE SWEEP, and it is a SUITE rather than a one-off because this is the second occurrence: `eol-safety-test.mjs` scans every suite for the pattern — a variable read from a file without normalisation, then matched against something that spans a newline, or compared whole. Wired into the build.

    WHAT THE SWEEP TAUGHT, which is why the first draft of it was useless: NOT EVERY `\n` IS A HAZARD. A CRLF document CONTAINS `\n` — the sequence is `\r` then `\n` — so a pattern anchored on the newline alone still matches. `"\n    if (x)"` matches `"\r\n    if (x)"`; `/\s*\n\s*const/` matches, because `\s*` absorbs the `\r`; `/[^\n]*\n/` matches, because `[^\n]` absorbs it. The hazard is a LITERAL CHARACTER sitting immediately before the newline, which then has to touch `\n` with a `\r` in the way — `"=> {\n"` against `"=> {\r\n"`, which is exactly #314's bug. A first pass that flagged any `\n` returned 27 suites, 26 of them fine; a list that size is ignored for the same reason a red build is. Re-scoped to the real hazard it returns exactly one: schedule-parity.

    MUTATION-PROVED, three mutants, each checked for the RIGHT failure rather than just a non-zero exit: removing the normalisation fires the canary by name (not a phantom rule change); removing the canary is caught by the sweep; removing the normalisation is independently caught by the sweep. The second of those exposed a hole in this suite's own first draft — it asserted the canary's MESSAGE, so replacing the guard with `if (false)` left the wording in place and passed. It now requires the condition to be real and to inspect what was read. A guard that guards nothing is the family this whole suite exists to catch, and it was in the catcher.


377. STRUCK 2026-10-05, the same day it was raised. IT WAS WRONG, and the correction matters more than the entry did. I reported that the schedule draws bars from deleted jobs — 531 of 551, 96% of the board — with a per-person table of what would vanish and a claim that the month-view drag refusals were therefore correct refusals against phantoms. None of that is true.

    WHAT DISPROVES IT, in one line of the server: `GET /tasks` returns `filterLive(data)` (`netlify/functions/tasks.js:37`), and `filterLive` drops every record with a `deletedAt`. Tombstoned jobs are stripped BEFORE the response leaves the server and never reach the browser. Measured against what the client is actually served: 114 jobs in S3, 64 served, 50 stripped; of the bars `getPersonBars` would then draw, 20 are real, 0 come from a deleted panel, 0 from a deleted op. THE TRUE PHANTOM COUNT IS ZERO.

    WHAT REMAINS TRUE: `getPersonBars` (`src/TRAQS.jsx:14829-14975`) really does contain no `deletedAt` check — its guards are `jobType`, `onTeam`, `showCompleted`/Finished, and `isTimelinePlaced` (= `start && end` plus `team.length`), none of which look at deletion. The gap it leaves is a deleted PANEL or OP inside a LIVE job, because `filterLive` only tests the top level of the array. At Matrix there are currently 0 of those, so the gap is latent, not live. That is a #356 entry, not a defect of its own.

    WHAT IT COST: two turns of work built on it, a withdrawn conclusion that the month-view drag was "not a drag bug", and a per-person impact table that described a system nobody runs. The drag is an open question again — see #378 and the fork recorded there.

    THE LESSON IS LESSONS #11, "I measured the store and called it the screen". Before any measurement about what the user sees, establish what the client actually receives: the server filters on read, the client filters on load, and the renderer filters again. This is the fourth measurement in this campaign to send the work the wrong way and the third of those to be the same deleted-data mistake in my own scripts (#347, #357, the "441").

    A SECOND QUESTION ANSWERED WHILE DISPROVING THE FIRST — how 33 jobs came to hold 531 dated, teamed, unfinished ops. BY DESIGN, and correctly. `delTask` (`src/TRAQS.jsx:10188`) HARD-REMOVES the node from the client tree and posts the tree without it; the server's `reconcileDeletions` sees it in `previous` and absent from `next` and calls `softDelete(rec)`, which is `{ ...record, deletedAt, lastModifiedAt }` — the subtree is spread UNCHANGED. It has to be, or a restore would have nothing to restore. The ops keeping their dates and teams is the tombstone working, not a second defect upstream.

    AND WHO DELETED THE SEVEN TORUS DUPLICATES (450 ops, all deleted 2026-09-29 to 10-02): A PERSON, testing. The S3 version history at the deletion timestamps shows the signature of interactive use, not a script — 22:31:25 a +39-byte write (one job gaining `deletedAt` and `lastModifiedAt`), 22:31:54 a +40,703-byte write (a fresh 60-op job created), then eighteen writes of 240-290 bytes each between 1 and 6 seconds apart (field edits autosaving), then 22:33:26 another +39-byte tombstone. Median gap between writes: 3 seconds. A script writes once and large; a person writes small and often. It matches Treysen's own stated intent to run a real re-plan on Matrix. NOTHING IN THIS CAMPAIGN'S WORK DELETED THEM: every measurement script written for it uses `GetObjectCommand` only, and the five scripts in `scripts/` that can write to S3 are pre-existing backfills, none of which were run.


378. RE-SCOPED 2026-10-05, same day. I logged `src/TRAQS.jsx:16687` (`if (snapS === null) return;`) as "a bare return sitting before the refusal handling in the drop" — a path that could refuse a move and tell the user nothing. Treysen ruled on it as the silent-refusal path. THAT WAS WRONG, and the error was not checking which handler the line is in.

    Both handlers are registered together at `:16356`, and the file is deep enough that the boundary is easy to miss: `onM` (mousemove) runs `:16580-16731`, `onU` (mouseup) runs `:16732-16825`. Line 16687 is inside **onM**. It is the GHOST-DRAWING path. All it does is skip updating the ghost for one frame when the projected start cannot be computed; it never reaches a commit, never refuses anything, and cannot produce a snap-back.

    WHAT IT ACTUALLY LEAVES: when that early return fires, `teamDragLiveRef.current` is not updated for that frame either — the assignment is at `:16724`, after the return. The drop reads its landing from that same ref (`:16739-16740`, `teamDragLiveRef.current?.snapStart ?? _dragBaseStart`), so a drag whose LAST mousemove took the early return would commit the landing from the previous frame. That is a real sharp edge and worth keeping, but it is a one-frame staleness, not a silent refusal, and it is not what Trey hit.

    NOT A DEFECT ON ITS OWN. Left open as a note on the ref's lifetime rather than as a bug with a user-visible symptom. The symptom it was logged for belongs to #379.

379. OPEN, DIAGNOSED 2026-10-05 from Trey's screen recording. A COMMITTED, SAVED DRAG RENDERS AT ITS OLD POSITION. The move succeeds, the server stores it, and the bar springs back on screen — so the work has been done and the board says it has not. Trey has been re-dragging work that already moved.

    THE RECORDING, frame by frame at 30fps: ghost on Draven's own row reading "Wed, Oct 14 · 11:00 AM → Fri, Oct 16 · 11:00 AM"; release; and TWO FRAMES LATER (67 ms) the bar is back at Oct 6-8. No dialog, ever. 67 ms is far too fast for a server round trip, so nothing was refused and nothing was rejected.

    THE DATA SAYS THE MOVE WORKED. `"2057-02 Wire"` is stored at `2026-10-14 -> 2026-10-16, startHour 11` — exactly the ghost's reading — inside job `402057`, whose `lastModifiedAt` was `2026-10-05T21:50:36.976Z`, 15:50 Mountain, the minute of the recording. (CORRECTED: I first wrote that stamp as the OP's. OPS CARRY NO `lastModifiedAt` AT ALL — only top-level JOBS do; my script read `o.lastModifiedAt || j.lastModifiedAt` and I reported the fallback as the op's own.) Its moveLog carries three successive entries from that afternoon (`10-08 -> 10-13`, `10-13 -> 10-12`, `10-12 -> 10-14`), which is Trey dragging the same bar three times because the screen kept telling him it had not moved. Draven has exactly three ops in the whole dataset and NONE of them is at Oct 6-8: the bar the recording shows there at the end corresponds to no record on the server.

    THE MECHANISM, traced statically end to end:

      1. `commitLanding` applies the move with `setTasks` and schedules `doSave`. In-memory: Oct 14.
      2. `doSave` writes it. Server: Oct 14. This is the part that works.
      3. `doSave` DOES NOT REFRESH THE INDEXEDDB CACHE on success. The only `cacheFullSlices` call inside it (`:8227`) sits in the ROLLBACK-AFTER-REJECTED-SAVE branch — its own catch reads "Rollback after rejected save failed". A successful save leaves the cache holding the PRE-DRAG tree.
      4. The next delta sync dispatches `tasks-changed` (`src/db/sync.js:80`), which runs `applySlice("tasks")` (`:8338`).
      5. `applySlice` reads the stale slice and folds it over live state with `mergeInOrder` (`:8330`) — and `mergeInOrder` takes the CACHE's row for every id present in both: `for (const r of prev) { if (byId.has(id)) out.push(byId.get(id)); }`. No `lastModifiedAt` comparison, no recency test. THE CACHE WINS UNCONDITIONALLY.
      6. `setTasksFromServer(merged)` installs the pre-drag tree. Screen: Oct 6-8. Server: still Oct 14.

    ANSWERING THE QUESTION THAT NARROWS THE FIX — is the old bar a React element that never re-keyed, or does some state hold the pre-drag tree? IT IS STATE. `getPersonBars` is called during plain render, not inside a `useMemo`, so the bars recompute on every render and no stale element can survive. The pre-drag tree is genuinely in `tasks`, put back there by `applySlice`. The bar is not an orphan element; it is a faithful drawing of stale state.

    WHY IT IS INTERMITTENT: `applySlice` bails early if `busy()` (a save in flight). A sync event landing DURING the save does nothing; one landing after the save completes — while the cache is still stale — reverts the screen. That is the "sometimes" in the report.

    THIS IS THE SHAPE ALREADY ON FILE as "cache beats server on rehydrate": `applySlice` letting the IndexedDB copy overwrite in-memory state, with the note that authoritative writes must be folded back through `mergeFullSlice`. A save is an authoritative write and is not folded back.

    WHAT IT MAY HAVE DONE TO THE SCHEDULE, which Trey should be told separately from the fix. HE RE-DRAGGED THE SAME OPERATION THREE TIMES IN ONE AFTERNOON BECAUSE THE SCREEN TOLD HIM IT HAD NOT MOVED, and EVERY ONE OF THOSE DRAGS SAVED. The moveLog on `"2057-02 Wire"` records `10-08 -> 10-13`, `10-13 -> 10-12`, `10-12 -> 10-14` within the same afternoon. Only the last is where he meant it to end up; the first two were corrections of a move he could not see had already happened. The same pattern will have applied to any other bar he dragged while this was live, and nothing on screen would have shown it. HIS SCHEDULE MAY THEREFORE HOLD WORK IN PLACES HE DID NOT INTEND — not corrupted, and every write is in the moveLog, but moved by a hand that was told the first attempt failed. Worth a pass over the moveLogs for the affected window before trusting the board.",
  "",
  "    FIXED 2026-10-05, both halves, because either alone leaves the defect reachable:",
  "",
  "      (1) THE DIRECT CAUSE. `doSave` now refreshes the IndexedDB cache on SUCCESS, not only in the rollback branch. Placed AFTER `adoptStamps`, deliberately: those rows have just taken the server's `lastModifiedAt`, and caching them before adoption would store unstamped rows that lose every future merge under (2), leaving the cache permanently unable to win.",
  "",
  "      (2) THE CLASS. `mergeInOrder` moved out of TRAQS.jsx into `src/db/sync.js`, beside the cache it merges, and now compares `lastModifiedAt` instead of taking the cache's row unconditionally. Every record carries that stamp since #337, so "which of these is current" has an answer and does not need guessing. Fixing only (1) would leave any OTHER path that lets the cache go stale free to do this again, and this campaign's evidence is that "some other path" eventually comes true.",
  "",
  "      Missing stamps are decided in the direction that protects live state: an unstamped CACHE row cannot claim to be newer and loses; an unstamped LIVE row has no provenance and loses to a stamped cache row; with neither stamped, live is kept. Membership and order are unchanged — live order leads, cache-only rows are appended, and a row present only in live is still dropped, because the cache remains the authority on what EXISTS and this only decides which VERSION wins.",
  "",
  "      `cache-merge-test.mjs`, 15 assertions, wired into the build (64 suites). Five mutants, five caught, including the original rule restored verbatim and a `>=` tie-break that would quietly reintroduce it.",
  "",
  "    CONFIRMED IN PART, 2026-10-05, by two instrumented drags:

        [#379] 1. drop committed — 2026-10-08->2026-10-12 h12
        [doSave] POST 64 tasks ...
        [#379] 3. save ok, cache refreshed — 2026-10-08->2026-10-12 h12

    FIX (1) IS PROVEN: the cache now carries the just-saved dates, where before it kept the pre-drag tree. FIX (2) IS UNEXERCISED — `applySlice` fired once at load and never again during either drag, so the merge rule has not been watched doing its job in the wild. It is correct by test and by construction, and it stays, but it is defensive rather than demonstrated.

    AND THAT RAISES A PROBLEM WITH THE MECHANISM AS WRITTEN ABOVE. A sync does NOT normally fire after your own save: the server's push following a POST excludes the saving client (`netlify/functions/tasks.js:466`, `silentIds`), so the only thing that would run `applySlice` for the person who dragged is the 30-SECOND POLL (`src/TRAQS.jsx:7740`). The revert in the recording landed 67 MILLISECONDS after release. That is far too fast for a poll or an Ably round trip, so `applySlice` is UNLIKELY TO BE WHAT REVERTED THE BAR THAT DAY.

    SO THE ORIGINAL SYMPTOM IS NOT EXPLAINED. Both fixes are right and both address real defects — a cache left stale by every successful save, and a merge that let any stale cache win — but neither has been shown to be the cause of what Trey filmed. The honest state is: the chain was traced from code and corroborated by stored data, the instrumented run confirmed half of it, and the timing of the recording contradicts the half that would have produced the visible revert. A candidate worth checking next is the 30s poll's FULL refetch (`refetch` at :7822): it re-checks `saveStatusRef` after the fetch resolves, but a response already in flight when the drop lands can still arrive in the window before the save marks itself dirty.

    THE TRACER HAS BEEN REMOVED, as planned — it existed to prove a fix, not to ship.

    (Originally logged as: INSTRUMENTED, NOT YET OBSERVED.) The chain above is traced from the code and the stored data; nobody has watched it happen. A tracer behind `localStorage.tq_trace_379 = "1"` logs three points — the commit applying, a rehydrate firing with what it holds in memory vs the cache vs the merge result, and the save completing — so ONE drag confirms or refutes it. It is off by default, changes no behaviour, and is to be REMOVED once confirmed. The console capture Treysen asked for could not be run here — what `tasks` holds immediately after the drop, what the next poll applies, and whether the rehydrate fires in between — COULD NOT BE RUN: there is no browser automation in this repo (no Playwright, no Puppeteer) and the app is behind Auth0, so the drag cannot be driven headlessly. The chain above is established by reading the code and the stored data rather than by observing it live, and the one assumption it rests on is that a `tasks-changed` event fired between the save and the revert. Instrumenting the three points and having Trey perform one drag would confirm it in a single attempt.

380. FOUND 2026-10-05, and it is the cause of #379's visible symptom. A SECOND CLIENT POSTS A STALE WHOLE TREE AND THE SERVER ACCEPTS IT, silently reverting other people's drags. `orgs/MTX2026TRAQS/rule-events.json` holds 15 `task-conflict` records for the day, every one of them in `log` mode, 0 refused, and the summary line is the whole story: **15 OF 15 WROTE OVER A NEWER STORED VERSION**. Staleness min −65,335 s (over EIGHTEEN HOURS), median −171 s.

    WHOSE: caller `100` = **Max**, 14 of the 15. Caller `99` = Treysen, 1. A client left open holds a tree from whenever it last loaded and keeps posting it.

    WHAT IT CLOBBERS, from the recorded field list: `op.startHour` (15/15), `op.endHour` (15/15), `op.moveLog` (15/15), `op.start` (11), `op.end` (11), `panel.end` (11), `job.end` (6), `panel.start` (4), `op.team` (3). THAT IS EXACTLY THE OUTPUT OF A DRAG. Trey moves a bar, the commit is correct, the save returns ok, and then a stale tree from another browser puts the old dates back — which is why a refresh showed the bar at the grab point and why #379's render investigation found nothing: the render was faithful, the DATA had been reverted underneath it.

    FLIPPED TO ENFORCE, same day. `TASK_CONFLICT_MODE=enforce`. This is precisely the evidence the flag was held for: #325/#327 kept it in `log` pending proof that real conflicts were being accepted rather than theorised, and both preconditions — #337 (every record carries a server stamp) and #338 (undo no longer replays stale stamps) — have held for days. Fifteen accepted clobbers in one day, with a named client and the drag's own fields, is that proof. Set in `.env` for local; MUST ALSO BE SET IN THE NETLIFY DASHBOARD or production stays in log mode.

    THE LOOSE END, CHECKED AND CLEARED. The op was still being rewritten after the conflict window closed — four writes in twelve minutes, dates moving backwards — with no conflict logged, which raised the question of a writer the check cannot see. There are exactly two other writers of `tasks.json`: `org.js:225`, which writes `[]` at org creation, and `timeclock.js` (three sites, via `creditPanelHours` and the job clock-in/out paths). The timeclock ones go through `updateStampedArray`, which is `updateJson(key, stored => …)` — a SERVER-SIDE READ-MODIFY-WRITE on the stored copy. It cannot carry a stale client tree and therefore cannot clobber, and it legitimately produces no conflict record because there is no incoming client version to compare. The unlogged writes were Trey's own drags: each carried a fresh stamp, so no conflict, and `moveLog` grew 38 → 42 across them, which only client-side drag code does. ENFORCE IS NOT BEING ASKED TO STOP A WRITER IT CANNOT SEE.

    STILL TO CONFIRM: with Max's client closed, one drag and a refresh should stick. Until that is observed, the chain is evidenced but not demonstrated — and #379's two fixes (cache refreshed on save; cache cannot beat newer live state) remain correct and separate from this, since they address the client's own copy rather than another client's write.

    REAL-TIME CONFIRMED WORKING, 2026-10-05 — A 30 s POLL RACE IS NOT THE EXPLANATION. The dev console's "ABLY_ROOT_KEY not set, real-time disabled" is local only. In Netlify, `ABLY_ROOT_KEY` has been set since 2026-07-02 in the `all` context (functions + runtime scopes), and Ably accepts it. At 21:00 MDT Ably showed 4 live connections subscribed to all 11 `org-MTX2026TRAQS:*` channels, `tasks` included — a subscription needs a token from production `ably-token`, which 503s without the key — and `tasks.js:303` publishes on every save. So Max's client was receiving change signals and wrote stale anyway. That narrows the cause to (a) a client that receives the signal but fails to apply the delta, or (b) a board loaded before a reconnect whose catch-up `onReconnect` → delta sync did not land. NOT DIRECTLY OBSERVED: a publish arriving (Ably keeps no history here and its stats endpoint returns nothing), or Max's client specifically being connected at the time of the 15 writes — the 4 connections are a snapshot. If enforce does not hold, (a) and (b) are where to look.
381. `teamDragLiveRef` is never reset at drag start or end, so a drag whose moves miss the assignment commits the previous drag's landing.

382. FIXED in 0b00402. overlap-test was green only before 18:00 MDT — a fixture dated 2026-10-05 fell into the past (the server takes "today" from the real clock, UTC when no timeZone is set, and ignores past days) and the server stopped seeing the overlap. Guarded since by `scripts/clock-shift-test.mjs` (6669a9d), which reruns every build suite with the clock moved forward; must-be-future fixtures use 2099.

383. **CLOSED 2026-10-06 BY #392, AND IT WAS THE LIVE ONE THE WHOLE TIME.** A SECOND bar moves to the cursor when a drag is dropped. Trey: "almost like there HAS to be a job at the cursor at all times." Related: #69 (cursor-anchored bars not clamped), #70 (cursor-anchored head collapses to zero width), the row-push and slack machinery.

    HIS SENTENCE WAS A DESCRIPTION OF `atCursor`, from the outside. `rowPushHours` pins an idle, unworked op to the cursor (`statsMath.js:1041`) and the render then paints it at `TD` and `shopHour(now)` regardless of its stored dates. See #392 for the mechanism, the measurement and the fix.

    HOW IT WAS HANDLED, recorded because the handling is the lesson. This entry sat marked `[not investigated]` through FOUR other defects — #387, #388, #389, #390 — every one of them real, every one of them fixed, and none of them the thing Trey was hitting. When #389's work asked whether it explained #383 I tested one bridge (`opDaySegments` segment counts), found it did not discriminate, and filed #383 as "likely separate, not proven separate". That was correct about #389 and it was the wrong conclusion to stop on: the entry named the cursor, the symptom named the cursor, and I did not read `cursorAnchored` until a trace printed `shopHour(Date.now())` as a bar's start hour. A standing `[not investigated]` entry whose words match the live symptom should be read BEFORE the next hypothesis, not after four of them.

384. [found in #349, not investigated] The people.json write at 2026-08-12T21:26:28Z (the iOS-shaped roster write that stripped `reqId` from Treysen's PTO) also took the stored PIN count from 6 to 4. The POST preserves a stored PIN when the incoming record has none, so a drop means two records arrived carrying a different PIN state, or matched no stored record by id (the write also changed `id` on Treysen's record). Not checked whether those two people's PINs were cleared deliberately.

385. FIXED 2026-10-06. The public people projection (GET without a token — the kiosk's team-select roster) returned far more than the kiosk needs. Measured on MTX2026TRAQS, 18 live people: it drops only `pin`, `pushToken` and `timeOff`, and hands anyone who knows the org code `email` (18), `phone` (5), `payType` (10), `adminPerms` (4), `cap`, `userRole`, `canClockInOut`/`canSignOff`, and live `activeClockIn`/`activeJobClock`/`activeBreak`. The comment in people.js says the kiosk "only needs name/color/role/department/status/email". Not checked: which of these the kiosk screens actually read.

    THE DEFECT IS THE SHAPE, NOT ANY ONE FIELD. The projection was a DENY-LIST — drop `pin`, `pushToken`, `timeOff`, return everything else — which FAILS OPEN. **TO ANYONE HOLDING THE ORG CODE IT RETURNED `email` FOR ALL 18 PEOPLE, `payType` FOR 10, `adminPerms` FOR 4, `phone` FOR 3, AND LIVE CLOCK STATE** — and the kiosk PRINTS THE ORG CODE ON ITS OWN FOOTER (`App.jsx:1408`, "Org code: {orgCode} · Secured by Auth0"), on a screen that by design faces the shop floor.

    MEASURED on MTX2026TRAQS with nothing but the org code, 18 live people, 21 populated fields: `email` 18, `cap` 18, `role` 18, `color` 18, `userRole` 18, `department` 18, `canClockInOut` 17, `isEngineer` 16, `noAutoSchedule` 10, `payType` 10, `canSignOff` 9, `adminPerms` 4, `phone` 3, `image` 2, `activeClockIn` 2.

    THE FIX is an explicit pick in `_utils/public-person.js`: `id, name, color, department, userRole`, plus a server-computed `clockStatus`. A field added to a person record is now private until someone adds it to that list on purpose.

    HOW LONG, AND IT IS NOT THE USUAL STORY ABOUT A DENY-LIST GOING STALE. These were not fields that arrived after the list was written: `adminPerms`, `canSignOff`, `isEngineer` and `noAutoSchedule` date from the INITIAL COMMIT (2026-02-26) and `payType` from 2026-03-20, while the deny-list is `adef704`, 2026-06-15 — titled "Clean up dead code and harden security". Every one of those fields was already in the records when it was written; it denied three and let the rest through. **AND BEFORE THAT COMMIT THE GET WAS OPEN WITH NO PROJECTION AT ALL BEYOND `pin`** (`git show adef704^` — a bare `readJson` with the pin stripped), so `pushToken` and everyone's `timeOff` were public too. `TeamSelectStep` is in the initial commit, so THE ROSTER HAS BEEN READABLE WITH NOTHING BUT THE ORG CODE SINCE THE KIOSK SHIPPED: roughly seven and a half months, 2026-02-26 to 2026-10-06. That is the better argument for the allow-list shape than any claim about drift — the author of the deny-list had `adminPerms` in front of them and shipped it anyway, because a deny-list asks "what must I hide?" when the only safe question is "what may I show?"

    `status` WAS IN THE FIRST DRAFT OF THE PICK AND IS OUT. No live record carries one — all 18 have it undefined — so it contributed a single undefined key and nothing else, and `clockStatus` is the real answer to the question it was standing in for. If a person-level status is ever wanted it gets added then, on purpose, which is exactly what the allow-list makes safe.

    TRACED BEFORE CUTTING, which was the instruction and turned out to matter twice. **THE PIN-PAD CLOCK-IN FLOW READS NOTHING FROM THIS ENDPOINT.** `handlePinConfirm` POSTs `{ action: "identify", pin }` to `/timeclock` and receives `{ name, personId, activeClockIn }`; `handleClockYes` POSTs `{ action, personId, pin }`. The PIN is verified server-side and never travels in a roster, so nothing on that path depended on what was cut. The roster SCREEN reads `id, name, color, department, userRole` and derives a status pill from `activeClockIn` — and that pill is the only thing that needed the clock record, so `clockStatusOf` computes the same four values (`offline/online/lunch/break`, same precedence) on the server instead of shipping the session's start time, its event log, and through `activeJobClock` which job someone is on.

    TWO CLIENT READS WOULD HAVE BROKEN, REPORTED RATHER THAN QUIETLY RE-ADDED:

      1. `login_hint: person.email` (App.jsx:1892) pre-filled Auth0 when you tapped your name. It is now undefined and the user types their own address. THIS IS THE RULING, not a regression — a harvestable list of 18 addresses is worse than one keystroke each.

      2. **`inRoster` SCANNED THE ROSTER FOR YOUR OWN EMAIL** (App.jsx:1830) to decide whether to show "not-in-team". With email gone it returns false for EVERYBODY, and every worker would have been bounced out at sign-in. Fixed properly rather than by restoring the field: membership now comes from `orgConfig.isMember`, which `/org-config` already derives behind `requireOrgMember`. `undefined` is treated as "not yet answered" so a slow response does not flash the screen. The client no longer decides membership from PII it should not hold.

    RATE LIMITED, both endpoints: `/people` at 30/min per org+IP on the UNAUTHENTICATED path only (a signed-in client polls and must never be refused on the kiosk's budget), `/org?code=` at 20/min per IP — keyed on the caller, since walking the code space is one caller trying many codes, which that endpoint's own comment already names as the risk. HONEST ABOUT WHAT IT IS: Netlify Functions are serverless, so the counter lives in one warm instance and a burst across instances gets a budget each. It is a speed bump, not a guarantee, chosen over adding a datastore for a kiosk endpoint, and `_utils/rate-limit.js` says so in its header so nobody later reads its presence as a solved problem.

    TESTED red-first, `scripts/public-projection-test.mjs`, 54 assertions, wired (74 suites), driving the REAL handler. The central assertion is `Object.keys(row)` EXACTLY equal to the allow-list — not "these fields are absent", which is the deny-list shape in a test and fails open the same way. Section 3 adds `homeAddress` and `ssnLast4` to a record and asserts they do not appear. Section 4 pins that the MEMBER projection is unchanged, since breaking the app is the other way this goes wrong. Eight mutants, eight caught, including the deny-list restored verbatim, `email` slipped back into the pick, the clock record shipped instead of the word, the limiter applied to members, and both client reads reverted.

    A FIXTURE ERROR WORTH RECORDING: `seed(null)` did not simulate an anonymous caller. The test loader's `requireOrgMember` does `return { ...globalThis.__AUTH }`, and `{...null}` is `{}` — TRUTHY — so every "public" assertion ran against the MEMBER projection and failed. `__AUTH_FAIL` is what makes auth throw, which is what `people.js` swallows when no token was sent. A security test that cannot express "no credentials" is testing nothing.

386. [found in #349] timeoff.js writes BOTH its files without compare-and-swap: `timeoff.json` (two admins deciding at once — the second write carries the first's stale request list) and people.json. For people.json: it is a plain `writeJson` of the roster it read at the top of the handler (approve, deny-undo, cancel, edit). Since #349 the people POST is a conditional read-modify-write, so an approval can no longer be erased by a roster save — but the reverse still holds: a roster save landing inside an approval's window is overwritten by the approval's stale copy of everyone else's records.


387. FIXED 2026-10-06, both halves. THE FIRST DAY OF `TASK_CONFLICT_MODE=enforce` PUT TREYSEN IN A PERMANENT REFUSAL LOOP: "Save failed. saveTasks returned 409", repeatedly, on his own drags, with Max's client closed. Fourteen `task-conflict` records in one afternoon, ALL on one job (`t3wr00dw3` / 402057) and ALL with `by: 99` — his own browser conflicting with itself, which is #185's and #337's original signature wearing the conflict path as a disguise. The tell is in the stamps: `incoming` sat frozen at `14:18:11.418Z` across saves at 14:18:17, :18 and :20, while `stored` advanced `14:18:14.690` → `14:18:17.733`. A client that cannot advance its own stamp cannot ever get a save through.

    THE PARTIAL-SAVE MESSAGE WAS ACCURATE, checked first because a wrong message would have been a different bug. The banner says the named job's change was not saved and everything else was; the enforce substitution at `tasks.js:161` does exactly that (the stale job is replaced with the stored copy, the rest of the array is written), and the stored op still read `h12.5` afterwards, as the conflict record said. So the refusal was correct and the user was told the truth. The defect is that the client could never get out of it.

    FIX 1 — THE DOUBLE-POST. Every one of doSave's ~22 explicit callers is a `setTimeout(() => doSaveRef.current(), 0)` fired straight after a `setTasks`, and that same `setTasks` arms the 1-second debounce in the autosave effect (`TRAQS.jsx:8484`). Nothing cancelled it, so ONE DRAG POSTED TWICE: at ~0ms, and again at ~1000ms carrying the stamps from before the first save adopted them. The second is stale against the first by construction; in `log` it was noise, in `enforce` it is a refusal. The log shows the pairs plainly — duplicate POSTs 70ms, 88ms and 1.03s apart with identical `incoming` and `stored`. One `clearTimeout(saveTimerRef.current)` inside doSave covers all 22 call sites; adding it at each one is twenty-two chances to forget, and the next call site added would reintroduce it silently. Placed AFTER the `dataLoadedRef` gate, so a save that bails before the initial load leaves the pending timer armed rather than dropping the user's edit.

    FIX 2 — THE CONFLICT PATH COULD NOT ADOPT, AND THIS IS THE ONE THAT MATTERS. #337 made the server return the stamp it wrote and the client adopt it — ON THE SUCCESS PATH ONLY. `adoptStamps` was DEFINED at `TRAQS.jsx:8143`, BELOW the conflict branch's `return` at :8126, so the one response that most needs its stamps read was the one response that never reached the reader. The server was already returning `stamps` alongside `conflicts` in enforce (`tasks.js:353`); the client simply never looked.

    WHY THE EXISTING RECOVERY DID NOT COVER IT. The conflict branch calls `rollbackToServer`, which refetches everything and would have supplied fresh stamps — except that it opens with `if (saveStatusRef.current === "unsaved") return;`. It bails whenever the user has edited again since the save began, WHICH IS EXACTLY WHEN A CONFLICT HAPPENS. Bail, and the client is still holding the stamp it was just refused for: save, refused, bail, save, refused. That is the fourteen records.

    The three `adoptStamps` calls are now an `adoptAll()` wrapper defined above the branch, called on both paths. ORDER AND TRADE-OFF, recorded because the fix is not free: the rollback replaces content AND stamps with the server's copy whenever it actually runs, so this adoption is only load-bearing on the path where the rollback BAILS — the path where the client is going to write again regardless. There it chooses a write that SUCCEEDS over one refused forever, which does mean the refused job's content can go up on the next save. The banner has already told the user what was kept; a client stuck in a refusal loop can tell them nothing at all.

    ENFORCE STAYS ON. The refusals were real, the detection was right, and the message was true — the client's inability to recover was the defect, and it is fixed. Turning the flag back off would restore the silent clobbering of #380 (15 of 15 accepted writes over a newer stored version) in exchange for hiding a banner.

    TESTED, red-first, in `scripts/save-stamp-test.mjs` (sections 6 and 7, 36 assertions total). Section 6 states THE PROPERTY NOTHING WAS CHECKING — after a REFUSED save, the client's next save must carry the adopted stamp and succeed — and proves it against the REAL handler by running a model of doSave's conflict branch twice, with adoption and without: without, every one of three rounds is refused (`[true, true, true]`), Trey's loop reproduced headlessly; with, only the first is (`[true, false, false]`) and the edit lands. `rollbackToServer` is deliberately NOT modelled, because the whole point is that the client recovers without it. Section 7 pins the client lines by POSITION rather than presence — both `adoptStamps` and the branch existed throughout the bug, in the wrong order, so a `/adoptStamps/.test()` would have been green the entire time. Three mutants, three caught (drop the `clearTimeout`; drop the branch's `adoptAll()`; gut `adoptAll` to two slices).

    ALSO RE-POINTED, NOT RELAXED: `cache-merge-test.mjs` section 6 asserted "the cache is written after the stamps are adopted" through a 400-character proximity window anchored on `adoptStamps(results[2]`. Moving the definition above the 409 branch put thirty lines of conflict handling inside that window and the suite went red for a reason that had nothing to do with it. The invariant is now stated directly — an adoption runs before the cache write, and what it adopts covers all three slices — which is what the window was approximating.

    AND THE BUILD WAS RED ON WINDOWS THE WHOLE TIME, found by running it rather than a substitute (LESSONS #5). `clock-shift-test.mjs` passed its shim to `--import` as a filesystem path; `--import` goes through the ESM loader, which rejects `C:\…` with `ERR_UNSUPPORTED_ESM_URL_SCHEME` ("Received protocol 'c:'"). Every child process died at startup, so the suite failed on every Windows run and `npm run build` could not be read at all. One line — pass the `file://` URL. It now reruns ALL 69 BUILD SUITES at now + 2 days, now + 400 days and 2098-06-15, and all three pass. Same family as #376 and #382: a harness detail, not a product defect, making the whole build unreadable. `npm run build` is green, exit 0.

388. FIXED 2026-10-06. NOTHING SERIALISED `doSave`, so a client racing itself was the single largest source of conflicts on the board. The measurement is unambiguous: of the twenty `task-conflict` records written on 2026-10-06, **ALL TWENTY WERE CALLER 99** — one browser, conflicting with itself. And the staleness says which kind of race it was: −455ms, −500ms, −657ms, −664ms, not the hours a genuinely stale tab shows (#380's median was −171s and its minimum −65,335s). Row 2's `incomingStamp` is literally row 1's `storedStamp`:

        14:44:04.571  incoming …03.496  stored …03.996   −500ms
        14:44:05.317  incoming …03.996  stored …04.451   −455ms
        14:44:06.302  incoming …05.128  stored …05.785   −657ms
        14:44:08.173  incoming …06.954  stored …07.618   −664ms

    WHY IT IS STRUCTURAL, not bad luck. Since #337 the client adopts the server's `lastModifiedAt` WHEN THE RESPONSE ARRIVES. So any save STARTED before the previous one's response lands carries the stamp from before it, and the per-job check correctly calls it stale. doSave's ~22 explicit call sites each fire `setTimeout(() => doSaveRef.current(), 0)` immediately after a `setTasks`, so two drags inside one round trip overlap BY CONSTRUCTION. Treysen's own diagnosis was the right one: "I think it does it because I'm dragging it too quickly" — the round trip measured ~600ms and the drags were 0.5–0.75s apart. #387 made the client RECOVER from the refusal; this removes the cause, and the two are complementary rather than alternatives.

    THE FIX IS A SHARED MODULE, `src/saveQueue.js`, not an inline pair of refs — so the contract is testable as behaviour rather than as a grep over JSX. `serializeRuns(fn)` holds one boolean each for `running` and `dirty`: a call made mid-flight sets `dirty` and returns, and the runner loops once more when the current run finishes. `doSave` is now `useMemo(() => serializeRuns(doSaveOnce), [doSaveOnce])` and the save body is `doSaveOnce`; everything (including `doSaveRef`, which is how all 22 call sites reach it) holds the wrapper.

    THREE DECISIONS, each of which is a property in the suite. (1) EXACTLY ONE follow-up, not one per call — a boolean, not a counter, because each run sends the whole tree as it stands when it STARTS, so two queued saves would send the same thing twice. A burst of five drags during one slow round trip is two POSTs, not six. (2) `dirty` is cleared BEFORE the run, never after: a call arriving while `fn` is in flight must set it again and earn its own follow-up, and clearing afterwards would swallow precisely the edits this exists to catch. (3) A FAILED run still drains the queue — the error is caught, the follow-up runs, and only the LAST run's verdict is rethrown. Without that, an edit made during a failed round trip is dropped with nothing left to re-arm it, because the debounce that would have re-armed it was cancelled when that save began (#387 fix 1). `failure` is reset each iteration for the same reason in the other direction: a first attempt that failed and a retry that worked is a success, and reporting the stale error would raise `saveError` over saved data.

    NOT A LOCK AND NOT A WORK QUEUE. It never defers DATA, only a RUN. There is no list of pending saves because the work is always "send the current state".

    TESTED red-first, `scripts/save-serialize-test.mjs`, 19 assertions, wired (70 suites). The suite drives a gated stand-in for doSave so the round trip is the thing under test, and asserts the start/end ORDER rather than a call count — overlap is the defect, and a count alone cannot see it. Section 7 is the red proof: the same stand-in called twice without the wrapper gives `["start1", "start2"]` with no `end1` between them, which is the −500ms self-conflict reproduced in a hundred milliseconds. Section 8 pins the wiring, because a correct helper nothing calls is LESSONS #1. Four mutants, four caught: drop the in-flight guard (7 assertions red), rethrow instead of catching (4), drop the per-iteration `failure` reset (2), and `while (false)` for the follow-up loop (8).

    RE-POINTED, NOT RELAXED: `save-rollback-test.mjs` and `save-stamp-test.mjs` both anchor on the save body by its declaration, which the rename moved. Both now anchor on `const doSaveOnce = useCallback(async () => {`; everything they assert lives in the body, which is still one function. The build caught this itself (`anchor not found in TRAQS.jsx`) — exit code 2, not a silent green, which is what #376's work was for.

    `npm run build` green, exit 0, 70 suites, and the clock-shift harness reruns all 70 at now + 2 days, now + 400 days and 2098-06-15.

389. FIXED 2026-10-06 — THE 5PM HALF ONLY. **CORRECTED 2026-10-06: "both ends of that are ONE event seen from each side" WAS WRONG.** This entry originally read Trey's "ONLY when you drag it to 8am for the start and 5pm for the end" as one defect observed from two directions. It was two defects. The 5pm half is this entry and is fixed and confirmed; the 8am half is a DIFFERENT bug with a different cause, and it survived this fix — Trey, after deploying it: "it still snaps back when dropping it at 8am for the start." It is logged as #390. Saying it plainly rather than rewriting the entry to look like it always said two: the unification was a guess that fitted the symptom, it was not measured, and the measurement that would have disproved it (sweeping pixel offsets at _origColOffset 0) was not run until #390.

    THE 5PM DEFECT. The drag could place an op on quitting time, and quitting time has no hours in it. He confirmed the prediction before the fix was built: "it lands on a day starting at 8am."

    THE MECHANISM. `onM` derived the intra-day hour as `_colFrac = Math.min(0.9999, …)` and then `dropHour = Math.round((workStartH + _colFrac * totalWorkH) * 2) / 2`. THE CLAMP IS APPLIED TO THE FRACTION AND THE ROUNDING HAPPENS AFTER IT, so the rounding defeats the clamp. Measured across one column on Matrix's 08:00–17:00 day:

        colFrac   raw hour   dropHour   walk(days, endHour)
        0.0000     8.000       8.0      days 1, end 11.25
        0.5000    12.500      12.5      days 1, end 16.25
        0.9444    16.500      16.5      days 2, end 10.75
        0.9900    16.910      17.0      days 2, end 11.25   <-- quitting time
        0.9999    16.999      17.0      days 2, end 11.25   <-- quitting time

    Anything from `_colFrac ≈ 0.972` up — raw hour ≥ 16.75 — rounds UP to 17.0. `walkProductiveHours` clamps the clock to `workEndH`, finds `tail === 0`, and rolls the WHOLE op to the next working day at 08:00. The ghost drew it where the cursor was, because the ghost reads the same `dropHour`; only the commit walks it. That is why it read as a snap rather than as a refusal, and why no error appeared: nothing was refused, the op was placed exactly where the arithmetic said.

    THE FIX IS A CHOKE POINT, NOT FOUR PATCHES. `clampStartHour(hour, cfg, step)` in `statsMath.js` returns the latest `step` slot at or before `hour` that still has work time in it, and the drag calls it ONCE — after every way `dropHour` is derived (the column fraction, the weekend shift, the end-of-day magnet, the dependency snap) and before the plan is built from it. `_phiInv` in the dependency snap carries its own `Math.round(… * 2) / 2` and could reach 17.0 by the same route, so a clamp at any one derivation site would have been the 0.9999 bug again in a new place.

    STEPPED, NOT `workEndH - step`, because the DEAD WINDOWS decide where the day really ends: with lunch at 16:00–17:00 there is no work time at 16:30 either and the last legal start is 15:30. Its helper `productiveHoursLeftInDay` SORTS the windows before walking them — the forward walk's own comment records that order-sensitivity gives 14.75 ascending and 14.50 descending for the same question and warns that it is unprotected, and a function whose entire job is to decide whether a drop is legal must not inherit that.

    THE SECOND BOUNDARY, fixed in the same pass. `CLOCK_EPS` is a full MINUTE, and `left <= tail + CLOCK_EPS` let the clock settle PAST `workEndH` while still reporting `days: 1`: 7.5166h from 08:00 gave `endHour 17.0166`, and since `columns` is `(clock − firstStart) / dayLen` the bar drew 1.0011 columns instead of 1.0. Now `clock = Math.min(clock + left, workEndH)`. The tolerance is unchanged and was never the bug — a sub-minute overrun must still not spill a sliver onto tomorrow; letting it move the clock outside the day was.

    TESTED red-first, `scripts/day-boundary-test.mjs`, 34 assertions, wired (71 suites). Section 1 is THE PROPERTY, swept rather than sampled: all 1000 cursor positions across a column must produce a start hour that leaves work time in the day, and the latest reachable start must still be 16:30 — a clamp that parked everything at 08:00 would satisfy the first half and be useless. Section 2 is the red proof, the table above. Four mutants, four caught: clamp written as `workEndH − 0.5` (2 red), the `endHour` clamp reverted (2), the sort dropped from `productiveHoursLeftInDay` (1), and `if (false)` on the wiring (1).

    AND THE WIRING ASSERTION CAUGHT ITSELF FIRST. Its initial form matched `dropHour = clampStartHour(…)` alone, and the mutant `if (false) dropHour = clampStartHour(…)` SAILED THROUGH IT — a line present, correct-reading, and never executed. The guard is part of the assertion now. LESSONS #1 in the suite written to apply it; the only reason it did not ship that way is that the mutant was run.

    IS THIS #383? PROBABLY NOT, AND THE BRIDGE WAS TESTED RATHER THAN ARGUED. #383 is "a SECOND bar moves to the cursor when a drag is dropped". The candidate unification was that a rolled-over op renders a degenerate piece on the original day plus the real bar on the next one, which would read as two bars — #70 is literally "cursor-anchored head collapses to zero width". Ran `opDaySegments` for a 17:00 start and for a LEGAL 16:30 start: both produce two segments. The segment count does not discriminate, because any two-day op renders as two segments and that is ordinary. The directions also disagree: #389 moves the DRAGGED bar AWAY from the cursor, while #383 reports a bar ARRIVING at it. Recorded as likely separate, not proven separate; #383 remains uninvestigated.

    `npm run build` green, exit 0, 71 suites, all three shifted clocks.

390. FIXED 2026-10-06. ONE ROUNDING, NOT TWO. A bar whose start hour IS the work-day start had a THREE-PIXEL landing zone with a one-day cliff on its left. Trey, after #389 shipped: "it still snaps back when dropping it at 8am for the start."

    THE PATTERN, and it is the same lesson as #389 one layer in. The drag derived a DAY and an HOUR from ONE quantity using TWO DIFFERENT ROUNDINGS — `Math.floor(contVal)` for the day, `Math.round((workStartH + _colFrac * totalWorkH) * 2) / 2` for the hour. Two roundings of one value disagree at a boundary. `_origColOffset` is `max(0, startHour − workStartH) / totalWorkH`, which is **EXACTLY ZERO** for a bar that starts at the work-day start: its left edge sits on a column boundary with no cushion at all. Measured on a 120px column:

        pxDx  -1  ->  day -1, 16:30      <-- PREVIOUS DAY
        pxDx   0  ->  day  0, 08:00
        pxDx   3  ->  day  0, 08:00

    The band yielding "08:00, same day" was `pxDx 0 .. 3.25` — 2.7% of the column, and ONE-SIDED: it began at exactly 0. A leftward tremor on mouse-up, which is routine, relocated the op a full day backwards. A bar starting at 12:30 had no cliff at all (−6px → 12:00, +6px → 13:00, smooth and symmetric), which is why the symptom looked time-specific rather than geometry-specific and why it read as "only at 8am".

    THE CODE HAD ALREADY FIXED HALF OF THIS AND SAID SO. Its comment: "Derive the intra-day hour offset from the SAME delta-based column value the day snap (dx) uses — NOT a separate absolute-cursor measurement. Using two different coordinate bases made the day and hour disagree by a sliver near column edges." The COORDINATE BASIS was unified; the two ROUNDINGS of that one value were left. The same defect, one layer down, under a comment describing the previous round of it.

    THE FIX. `snapWorkHourPosition(hoursFromStart, cfg, step)` in `statsMath.js`: round the continuous position ONCE, then derive both the day offset and the hour from the result, with the hour put through `clampStartHour` so #389's dead-window rule still holds. 17:00 is now unreachable by construction, because `within` is already reduced modulo the day — #389's clamp is retained for configurations where a dead window covers the day's end (lunch at 16:00–17:00 makes 16:30 illegal too), not as the primary guard.

    THE SWEEP, WHICH FOUND TWO MORE SITES. `_phiInv` in the dependency magnet carried the identical pair — `Math.floor(clock / totalWorkH)` for the day and `Math.round((workStartH + hrOff) * 2) / 2` for the hour — so a dependency boundary a hair below a day's start snapped to the PREVIOUS day at 17:00. That is exactly why #389 needed a choke point in front of the plan rather than a patch at one derivation site. The auto-scroll recompute (`dx2`) floored for the day while taking the hour from the live ref, a value snapped from a DIFFERENT `pxDx`, so during a scroll the two could describe different places. All three now go through the one helper, and the suite asserts the ABSENCE of the old pattern at each.

    TESTED red-first, `scripts/column-snap-test.mjs`, 41 assertions, wired (72 suites). Four mutants, four caught: the helper flooring the raw position for the day while rounding for the hour (13 red), the half-hour snap removed (13), the drag flooring again (1), `_phiInv` restored to its own pair (2).

    AND THE FIRST DRAFT OF THE SUITE MEASURED THE WRONG QUANTITY — worth recording, because it is LESSONS #11 in miniature and it happened inside the work that was applying it. The property was written as "monotonic, no day-sized jumps on the working-hours axis", and the RED PROOF CAME BACK GREEN: `(day −1, 17:00)` and `(day 0, 08:00)` are the SAME POINT on that axis. The axis was never discontinuous. What differs is the DATE — which is what gets stored and what Trey sees — and it only becomes visible once #389's clamp pulls 17:00 back to 16:30: the hour moves half an hour, the day cannot follow, and the landing settles a day early. The property is now CONSISTENCY — the day and the hour must both equal the one rounded position — with monotonicity asserted as a consequence rather than as the definition. The red proof also had to include #389's clamp to reproduce what was actually shipped when he retested.

    `npm run build` green, exit 0, 72 suites, all three shifted clocks.

392. FIXED 2026-10-06. THE SCREEN CONTRADICTED THE DATA, AND THAT IS WHY FOUR LAYERS OF THIS INVESTIGATION ALL READ AS CORRECT. Found by tracing one drag end to end (#391) after #387, #388, #389 and #390 — all real, all fixed, none of them Trey's bug.

    THE MEASUREMENT, from point 1 of the trace:

        start            "2026-10-07", startHour 8     what the op HOLDS
        paintedDay       "2026-10-06"                  = TD, today
        paintedHour      10.833245555555555            = shopHour(Date.now()), the WALL CLOCK
        paintedVsStoredH 9                             a full working day apart
        isPartiallyWorked false                        so the split path is not involved

    `paintedHour` is not a round number because it is literally the time of day. The bar was CURSOR-ANCHORED: `TRAQS.jsx:16299-16310` set `_layoutStart = TD` and `_barStartH = shopHour(now)` unconditionally for any op in `cursorAnchored`, which `rowPushHours` fills at `statsMath.js:1041` for an op that is idle with no worked hours. That is #383, which had been sitting marked `[not investigated]` the whole week.

    WHY NO DROP COULD MOVE IT. The drag anchors on the PAINTED origin — #25, deliberately, "grabbed where the user sees it". Painted was 6.17 working hours behind stored. The cursor moved +36px = +0.71 columns = +6.17 working hours, so the landing computed to exactly `2026-10-07 08:00` — THE VALUE ALREADY STORED. The commit wrote what was already there (`moveLog` 102 → 103 and nothing else), the save succeeded, the server accepted it, and the next render pinned the bar back to the cursor. Every layer was doing precisely what it was told; the paint was the only thing lying, and it lied consistently, which is why it survived four rounds of fixes aimed at the save path and the arithmetic.

    THE RULE, which `rowPushHours` already states for the PUSH and did not hold for the PIN: *"Only ever forward: this moves a bar OFF idle time, it never drags one backwards into the past."* Painting an op scheduled for TOMORROW at TODAY's clock is dragging it backwards.

    THE FIX. `cursorAnchorStart({ scheduledStart, scheduledHour, cursorDay, cursorHour, cfg })` in `statsMath.js` returns the LATER of the cursor and the op's own scheduled position, and the paint takes both its day and its hour from that one call rather than from two conditions that can drift apart — which is how the paint and the push came to disagree in the first place. Measured from the scheduled POSITION, hour included: without the `scheduledHour` term a cursor at 09:00 reads as "ahead of" a bar scheduled for 13:00 the same day and drags it four hours back, the same bug in miniature. Ties keep the schedule, so the paint agrees with the data whenever it can.

    WHAT "CLEARS THE PIN" MEANS, because a pin that clears on drag and re-applies on the next idle pass would put him back here tomorrow: THERE IS NO FLAG, DELIBERATELY. The anchor is DERIVED from the data every render, so the only thing that clears it is the op's own position being at or after the cursor — which a drag that actually places it there achieves permanently, and which a reload, a poll or another client cannot undo. An op that genuinely falls behind the cursor is anchored again, which is the behaviour the anchor exists for and is untouched (suite section 2). A stored flag would need clearing, would drift against the data, and would be a second source of truth for a thing the data already answers.

    TESTED red-first, `scripts/cursor-anchor-test.mjs`, 25 assertions, wired (74 suites). Section 2 pins the behaviour that must SURVIVE — an op left behind by the cursor is still anchored and still pushed forward — because a fix that simply removed the anchor would be a different bug. Five mutants, four caught. TWO FIXTURE ERRORS OF MY OWN WERE CAUGHT BY THE FIRST RUN: ops ending before `nowDay` trip the active-horizon `continue` and assert nothing about anchoring, and the guard's first version compared from the scheduled DAY rather than the scheduled POSITION.

    THE MUTANT THAT SURVIVED, AND IT IS WORTH MORE THAN THE ONES THAT DID NOT. Reverting the explicit `sp < nowProd` term in `rowPushHours` changes no assertion, because that term is REDUNDANT under the code as written — it follows from `idleTarget - sp > push` with `push >= 0`. By that arithmetic Trey's bar, scheduled a day AHEAD of the cursor, could not have been anchored at all. IT WAS. The fixtures cannot reproduce however that happened, so the term is kept as a statement of intent rather than as a working guard, the suite says so in a comment, and THE LOAD-BEARING FIX IS THE PAINT GUARD, which holds whatever set the anchor. The open question — which branch anchored a future-dated op — is logged below.

    THE QUESTION UNDERNEATH, logged on Treysen's instruction rather than acted on: SHOULD AN IDLE, UNWORKED OP BE PINNED TO THE CURSOR AT ALL? It paints a bar somewhere its data does not say it is. That is the root of this entire week: a rendering that contradicts the stored value made the save path, the conflict log, the drag arithmetic and the renderer each read as correct in isolation, and cost four fixes and a day of Trey's time before anyone looked at the paint. The anchor has a real purpose — showing what is idle NOW rather than where it was once scheduled — but the current form expresses it by MOVING THE BAR, which is indistinguishable on screen from the data having changed. A treatment that marks an op as overdue without relocating it (a tint, a marker at the cursor, a leader line) would keep the information and remove the contradiction. Not changed now; see also #69 and #70, which are the same anchor misbehaving in two other ways.

    The #391 trace stays in until Trey confirms the bar moves.

393. FIXED 2026-10-06 (consolidation). THE JOBS-LIST ASSIGN CELL HAD NO ACTIVE-CLOCK GUARD, AND FOUR LAYERS PASSED IT THROUGH. The cell gated on `can("reassign") && _leaf` only; `commitAssign` called `commitLanding` directly and so skipped `refuseLanding`, which is where `isLive` lives; the server's `activeClock` rule DOES detect a team change on a clocked-into op (`scheduleRules.js:334`) but `SCHEDULE_RULES_MODE` is unset, which means `log`; and the stranded-clock sweep's fingerprint is `start|end|startHour|hpd|panelId`, with no `team` in it, so it does not notice either. The drag path refuses this at its first layer.

    THE GUARD IS NOW IN THE COMMIT, NOT ON THE CELL, which is what makes this one fix instead of one per surface: the Job Details popover routes through `commitAssign` now too, and a fifth caller inherits it. `isReplannable` is the existing owner of the question rather than a second copy of it.

    MEASURED BEFORE BUILDING: `activeJobClock` is absent on ALL 18 live people at Matrix, so this is currently UNREACHABLE there, and zero `schedule-rule` records exist in the log (the tag is written durably at `tasks.js:289`, so the sweep is sound — the rule genuinely has not fired). It is insurance and is written as insurance. The end-to-end outcome remains INFERRED; what would confirm it is reassigning an op somebody is clocked into and reading the log.

394. FIXED 2026-10-06. THE JOB DETAILS ASSIGN POPOVER WAS A SECOND IMPLEMENTATION: `updTask(planAssign.id, { team: next }, …)`, a plain field patch with no moveLog, no overlap backstop and no shared oracle. The Jobs-list cell's own comment says assignment "must not be a quieter path than dragging the bar there by hand" — and this was quieter than the cell. It now calls `commitAssign`, keeping its multi-select unchanged, because **`commitAssign` already took a full team array**: the single-select is in the LIST CELL, not in the commit, so routing the popover through it does NOT make #396 live. (Treysen's premise when approving this was that it would; it does not, and #396 stays a Jobs-list UI question.)

    AND A FIFTH WRITER TURNED UP DURING THE BUILD, which the survey had not found: `placeTaskAt` — the Job Details "Place" button — set WHO and WHEN in one gesture with one plain patch, `updTask(it.id, { team: [personId], start, end }, …)`. It goes through the shared commit now. `commitDates` marks a crew change as a reassignment, derived from comparing the teams rather than trusted from the caller, because `applyDragMove` writes `team` ONLY when the mover says so — a placement that changed the crew and did not say would have moved the dates and silently dropped the team change.

    THE ASSERTION THAT WALKED PAST IT. The suite's "no `{ team: … }` patch remains" check was written as `/\{ team: [A-Za-z_]+ \}/`, which matches a bare identifier and MISSES `{ team: [personId], start, end }`. A count assertion is only as good as its pattern, and this one was narrower than the thing it was counting.

395. FIXED 2026-10-06. TWO AVAILABILITY ORACLES ANSWERING DIFFERENT QUESTIONS THROUGH ONE CONTROL. `schedulerAvailability` asks about OVERLAP — does this person's work occupy the hours this op occupies. `planAvailability` asked about CAPACITY over a date range — is every working day off or booked to the cap — and the Job Details popover STRUCK PEOPLE OUT on its verdict.

    MEASURED on Matrix across 109 dated ops × 18 people = 1962 pairs: **they disagreed on 244, or 12.4%** — 203 struck out in Job Details that the list called free (Quincy on "Labels" 2026-06-29..07-02, for one), and 41 the other way (Heston on "Wire (2)" 2026-07-29..08-14).

    THE OVERLAP ORACLE WINS: it is what the drag, the scheduler and the server's own `activeClock` rule already use, and a fifth definition of "free" is how this codebase came by four schedulers. `planAvailability` is deleted; `schedulerAvailability` now has SEVEN callers and `overlap-test` counts them with the reason attached.

    THE CAPACITY NUMBER SURVIVES AS A NON-BLOCKING HINT. Treysen's ruling: "a strike that means 'busy week' reads as 'can't do this', and 203 people being wrongly struck is worse than 41 being wrongly offered." `dayLoadHint` returns `"3 of 5 days full"` or `null` — a string or null, with no `ok` field, so no caller can mistake it for permission.

398. FIXED 2026-10-06. THE INLINE start/end CELLS BYPASSED THE REFUSAL CHAIN ENTIRELY — `commitCellEdit` → `updTask`, a plain patch, while dragging the same bar to the same dates ran every check. `commitDates` builds a mover and goes through `refuseLanding` + `commitLanding`, so typing a date now does what dragging to it does, with a moveLog. `dueDate` deliberately still does not: it is not a placement, and routing it there would start refusing a due date for an overlap it has nothing to do with.

    ACCEPTED CONSEQUENCE, ruled 2026-10-06: typing a date that overlaps is now REFUSED where it used to succeed silently. "A quieter path is the defect." Trey is being told before he meets it.

402. **BISECTED 2026-10-06 — THE WRITE IS IDENTIFIED, THE CAUSE IS NOT YET.** Two ops at overlapping hours on the live board with no moveLog between them: `2057-01 Layout` and `2057-03 Layout`, both `2026-10-05..2026-10-07`, startHour 12.5 and 15.5, same person (`txkw0ci0l`).

    THE WRITE, found by binary search over 40,000 S3 versions of `tasks.json` (16 probes): **`2026-09-29T20:59:32Z`**. One write, **TWELVE OPERATIONS ACROSS FOUR JOBS** — 401944 Thacker II, 402055, 402056, 402057 — every one of the four stamped the same millisecond, `20:59:31.410Z`. Every op was pulled EARLIER and every one landed at **`startHour 15.5`**; one (`toa75e5oe`) was also reassigned `t8420ukl7` → `t1fvxhe9e`.

        BEFORE  2057-01 Layout  2026-10-05..10-07 h12.5  txkw0ci0l
                2057-03 Layout  2026-10-15..10-16 h8     txkw0ci0l
        AFTER   2057-01 Layout  2026-10-05..10-07 h12.5  txkw0ci0l   (unchanged)
                2057-03 Layout  2026-10-05..10-07 h15.5  txkw0ci0l   <- placed on top

    RULED OUT BY MEASUREMENT: a DRAG (neither op has a moveLog entry, and `applyDragMove` always writes one), the AI TOOL HANDLERS (they write one op per call; this is twelve across four jobs in one write), an IMPORT (the job count is unchanged, 110 → 110, and these are existing ops repositioned), and HISTORY — the code paths below are the ones running today, so this is not a pre-guard artefact.

    WHAT IS ESTABLISHED. The two scheduler call sites ask the shared availability oracle WITHOUT A START HOUR — `_localAvail.free(pid, s, eDate)` at `TRAQS.jsx:23566` and `_applyAvail.free(pid, s, eDate)` at `:24320` — while the drag and the Jobs-list assign cell both pass `op.startHour ?? null` as the fourth argument. `free(pid, s, e, startH = null)` builds its probe as `startHour: startH ?? undefined`, so the scheduler decides WHICH DAYS with one question and WHICH HOURS with another, and nothing reconciles them. Neither run goes through `commitLanding` or `enforceNoOverlap`; after the 2026-10-06 consolidation the scheduler is the one writer of placements still outside the backstop. The post-hoc verifier at `:24531` DOES pass the hour (`_verify.free(pid, node.start, node.end, node.startHour ?? null)`), which is why this is narrow rather than constant.

    **THE 15.5 IS STILL UNEXPLAINED, AND TWO HYPOTHESES DIED MEASURING IT.** Twelve ops, four jobs, four different people, one half-hour is a value being applied, not twelve placements, and it has to be understood before a fix — a fix that leaves it in place keeps stacking work on one hour. Replayed against the board as it stood at `2026-09-29T20:58:41Z`:

      - `nextFreeStart` (saveTask's seeding, the only place an hour is COMPUTED in that path) returns **h8 or h12 for all twelve** — never 15.5.
      - `getNextStartHour` (`:5637`, the phase planner's `slotH` source, which looked right because one running value reused across a plan would explain twelve identical hours) returns only **8 or 17** across every person-and-day probe — never 15.5.

    So the hour is set somewhere neither of those reaches, and the source is not yet found. NO FIX HAS BEEN BUILT: the two defects above are real and independently justified, but they were ruled to be fixed together with the cause of the 15.5 or not at all, and the precondition is unmet.


    **THE 15.5 IS EXPLAINED, AND THE REASON IT TOOK THREE DISPROVED HYPOTHESES IS THAT I WAS READING CODE THAT DID NOT EXIST YET.** The write is 2026-09-29T20:59:32Z. `git log --until` puts HEAD at `e0e480d` (2026-09-29 14:13 local), 46 minutes earlier. **The reschedule run was rewritten three days later by `77efb7d` (2026-10-02, "The run never aborts: per-op outcomes instead (#344)").** Every exoneration above — `buildExpanded`, `pickTeam`, the apply step — was read from the CURRENT source against a write made by a different build.

    IN `e0e480d` THE AUTO-SCHEDULE WROTE THE HOUR, at what was then line 10160:

        const _autoStartH = Math.max(
          (op.team || []).length > 0 ? getNextStartHour((op.team || [])[0], slotStart) : workStartH,
          _selfDayMaxH);
        …
        newSubs[pi].subs[oi] = { ...newSubs[pi].subs[oi], start: slotStart, end: finalEnd, startHour: _autoStartH };
        selfBusy[pid].push({ start: slotStart, end: finalEnd, startHour: _autoStartH, endHour: _autoEndH });

    THAT LINE NO LONGER EXISTS. Today's apply step writes `{ ...sub, start: ss, end: se, team }` and sets no hour at all.

    AND THE VALUE IS CHAINED, WHICH IS WHY NO LITERAL `15.5` EXISTS ANYWHERE. `_selfDayMaxH` is the greatest `endHour` among THIS RUN'S own earlier same-day placements, `_autoEndH` is computed from the op's hours and pushed into `selfBusy`, and the next op takes `Math.max(getNextStartHour(…), _selfDayMaxH)`. One op's computed end becomes the next op's start, so a single run lands a batch on one hour — twelve ops, four jobs, four people, 15.5. Derived, not a default, exactly as predicted; the prediction was right and the place to look for it was wrong.

    WHAT THAT CHANGES. The 15.5 generator was removed incidentally by #344 on 2026-10-02, so **the cause of the stacking is already gone** and the ruling that the two remaining defects must be fixed "together with the cause or not at all" is satisfied without further work. Those two — the scheduler asking `free()` without a start hour, and its placement sitting outside `commitLanding`/`enforceNoOverlap` — are STILL LIVE in today's code and still unfixed.

    RULED OUT ALONG THE WAY, each by reading rather than assuming: `buildExpanded` (resolves deps and expands quantities; never touches dates or hours), `pickTeam` (returns `{team, start, end}`, no hour), `saveTask`'s `nextFreeStart` seeding (only runs when `startHour == null`; returns h8 ×11 and h12 ×1 for these twelve, with their real spans), today's `getNextStartHour` (8 or 17 on that board, never 15.5), `timeclock.js:304` (writes a moveLog entry; all twelve have none), and iOS — `startHour` is not a modelled property there but rides in `JSONExtras`, captured on decode and re-emitted on encode, and its ONLY writer is `SimpleJob.makeJob`, which fires when a new simple job is created and never rewrites an existing op. A board scan found `endHour: 15.5` on three ops, none belonging to the four people involved, so the neighbour-endHour route is out too.

    LESSON, AND IT IS A NEW ONE: **TO EXPLAIN A PAST WRITE, READ THE BUILD THAT MADE IT.** `git log --format=%h --until=<the write's timestamp> -1` is one command and it was not run until three hypotheses had died. Every one of those three was a correct reading of the wrong file. See LESSONS #15.
    ONE MEASUREMENT WORTH KEEPING for #403's sibling question (`saveTask` excluding the job being saved from its own obstacle set, `tasks.filter(j => j.id !== ed.id)`): across the twelve, `tst5cu0x3` is the **ONLY** op where excluding its own job changes `nextFreeStart`'s answer — job-EXCLUDED gives `2026-10-05 h8` (colliding with its sibling), job-INCLUDED gives `2026-10-07 h12` (clean). That is exactly the op that ended up overlapping. **But it is not established that this path ran**: the seeding only computes an hour when `startHour == null`, and these ops arrived at saveTask already carrying 15.5 from the planner, in which case `nextFreeStart` never executed. The exclusion is a real defect and is logged separately; its contribution HERE is unproven.

400. **THE TITLE THIS WAS REPORTED UNDER WAS WRONG, AND IT IS WRITTEN DOWN CORRECTED.** Reported as "FAST TRAQS is a third and fourth assignment path". It is TWO SURFACES AND ONLY ONE WRITES. FAST TRAQS is the button labelled that (`bcModalState`) and it opens a panel titled TRAQS Cloud which writes nothing — see #405. The tool-calling surface is **Ask TRAQS** (`askOpen` / `executeConfirmedActions`). The XLSX and FileReader code feeds file CONTENTS into the Ask conversation; the writes still come back as tool calls.

    AND IT IS NINE WRITERS, NOT TWO. `update_job` (start/end), `create_job`, `delete_job`, `assign_person_to_job`, `remove_person_from_job`, `update_operation` (team AND start/end), plus five LEGACY handlers — `update_task_status`, `reschedule_task`, `assign_person`, `remove_person`, `create_task`. **FOUR BYPASS `updTask` ENTIRELY** with a raw `setTasks`, so they skip even the engineering sign-off gate inside it. The five legacy ones are NOT in `AI_TOOLS`, so the model is never offered them and they cannot be reached from the declared schema — LESSONS #7 shape, dead rather than dangerous, and queued for deletion.

    AUTHORISATION IS NOT A HOLE, AND THIS IS WORTH STATING PLAINLY SO NOBODY READS IT AS ONE. The client-side handlers carry no `can()` check — `updTask` does not gate, its callers do, and these do not. **That gap is UX, not escalation.** The write still leaves through `POST /tasks`, which classifies the change and demands the matching permission, and which REFUSES REGARDLESS OF `PERMISSION_GATES_MODE` — the mode only selects which classifier decides, not whether a decision is enforced. A worker asking Ask to reassign an operation is refused at the server. The edge function (`netlify/edge-functions/ai-schedule.ts` — it exists; it is an EDGE function, which is why it is not in `netlify/functions/`, and a repo-wide grep found it after a directory listing did not) verifies a Bearer JWT against a remote JWKS and rate-limits per `sub`. It does not check org membership, because it is a credit-spending boundary rather than a data one.

    USAGE IS NOT MEASURABLE FROM S3, and that is the honest answer rather than a proxy. There is no durable record of AI tool execution: `rule-events.json` carries only `task-conflict` and `session-guard`, the edge function's rate limiter is in memory, and AI writes reach `/tasks` indistinguishable from any other save — `update_job` and `update_operation` do not even write a moveLog. An `ai-action` tag at `executeConfirmedActions` is two lines, is queued, and decides whether routing these onto the shared commits is tidying or urgent.

396. [MEASURED — LATENT, NOT LIVE] THE JOBS-LIST ASSIGNEE CELL IS SINGLE-SELECT AND REPLACES THE CREW. `commitAssign(item, [v])` writes a one-element team and `assignPickerOptions` has no notion of current membership, so picking a name on an op with two people silently drops the other. MEASURED on Matrix: 112 live ops, crew sizes 0 (63 ops) and 1 (49 ops), **ZERO with a crew of 2+** — there is nothing to overwrite today. Reported as a live defect before measuring; it is not one. It is a UI question (should that cell offer multi-select, and should picking replace a crew silently) and it is NOT affected by #394 routing Job Details through the same commit, because `commitAssign` already takes a full team array — the single-select is in the cell.

397. [INFERRED — LATENT] AN ASSIGNED OP WITH NO DATES CANNOT BE REOPENED OR CLEARED. The explanatory cell ("Can't assign until dates are set") renders only when `canReassign && !hasDates && !who.length`; with a team AND no dates, `canQuickAssign` is false and the cell falls through to plain text with no picker. MEASURED: the 3 live undated ops all have empty teams, so unreachable today. Reachable if anything assigns before dates exist.

399. [MEASURED — LATENT] NINE `.includes()` COMPARISONS ON `team`, the exact pattern the comment at `TRAQS.jsx:2991` warns about ("Every strict comparison then fails: `(op.team||[]).includes(99)` is false"). Sites: `:5633, :9090, :10541, :17915, :18082, :23071, :23166, :29858, :31309` — scoped to exclude 2991 itself, which is the warning. MEASURED on Matrix: all 18 person ids are STRINGS, all 49 `op.team` entries are STRINGS, and **0 team entries fail a strict match against a person id**. A real hazard — iOS writes and legacy numeric ids are how it bites — that bites nothing today. See the person-id drift note in project memory for the wider count.

401. [INFERRED — NOT MEASURED] `commitAssign` WRITES `endHour: op.endHour ?? null`, turning an ABSENT key into an explicit `null`. `dragMove.js:144` sets `endHour: undefined` deliberately elsewhere, so the two may not be interchangeable in the geometry. Flagged only; nothing was measured and no consequence has been observed.

403. FIXED 2026-10-06. **THE ASSISTANT REPORTED REFUSED WRITES AS APPLIED.** `executeConfirmedActions` ended every run with a CONSTANT STRING — `content: "Action applied successfully."` — for every tool, unconditionally, built BEFORE the save had been awaited (`setTimeout(() => doSave(), 300)`). It could not have known the answer even in principle.

    Treysen, ruling it to the front of the queue ahead of four other items: *"Trey asks TRAQS to move something, it's refused at the server, and the assistant tells him it worked. He has no reason to check."*

    TWO WAYS TO BE WRONG, both reported identically. (1) THE HANDLER CHANGED NOTHING: `prev.map(t => t.id === input.job_id ? … : t)` matches nothing for an unknown id and returns the list untouched. (2) THE SERVER REFUSED THE WRITE: `/tasks` classifies the change and demands the matching permission, so a worker asking Ask to reassign is refused THERE — after the chat has already said it worked.

    AND IT MISLEADS THE MODEL, NOT ONLY THE PERSON. `tool_result` is fed straight back into the conversation, so the assistant reasons from "applied successfully" and will confirm the change again when asked about it.

    `src/aiActions.js` holds the mapping as a pure function so it is testable as behaviour rather than as a grep over JSX. A no-match reports that nothing matched and NOT that the save lost it — the save has nothing to do with a change that never existed, and saying so would send the model looking for one. A failed save carries the server's own message and its STATUS, because 403 is a verdict the user must act on and 409 is a stale copy they can retry. `doSaveOnce` now records its verdict on every exit path for a caller that awaits it.

    The verdict travels by REF rather than a return value, because `serializeRuns` (#388) coalesces: `doSave` resolves without having run when a save was already in flight. The ref is cleared before the await so a previous save's verdict cannot be reported as this one's, and a MISSING verdict is read the generous way — the write is on its way, and claiming failure would be its own false report.

    TESTED red-first, `scripts/ai-action-result-test.mjs`, 34 assertions, wired (77 suites). Nine mutants, nine caught — after two repairs:

      - **THE `a < b` WITH −1 BUG, FOR THE SECOND TIME IN ONE SESSION.** `body.indexOf(clear) < body.indexOf(await)` is TRUE when the clear is absent, so the assertion was green on exactly the bug it existed to catch. The identical shape slipped through `assign-consolidation-test` section 1 the same morning. It is why LESSONS #13 names the mutation rather than the mistake.
      - the behavioural sections pass outcomes IN, so none of them could see a HANDLER that stopped computing them. A mutant replacing `changed ? APPLIED : NOCHANGE` with a bare `APPLIED` survived until the wiring section asserted the handlers too.

    RE-POINTED, NOT RELAXED: `save-skip-test`'s "still reports saved" assertion matched `setSaveStatus("saved"); return;` as ADJACENT lines, and the save verdict now sits between them. A no-op save IS a successful save and the chat path needs telling so; the assertion states the intent and gained a second one for the verdict itself.

404. [LOGGED, NOT BUILT] A SIXTH WAY OF SETTLING THE SCHEDULE. `updTask` runs its own `settle` → `reflowJob(t, { overlap: business ? overlapCtx : null })` whenever dates move, which is a DIFFERENT mechanism from the `recalcBounds` + `enforceNoOverlap` the consolidated commits use (#394/#398). So a date written through `updTask` settles the board by one rule and a date written through `commitDates` settles it by another. This is the four-schedulers shape one layer down — not a defect anyone has reported, and it wants its own pass with its own measurement rather than being folded into a consolidation.

405. [LOGGED] THE FAST TRAQS BUTTON IS A STRANDED CONTROL. Its tooltip, in two places, promises "FAST TRAQS — import or update jobs from a file". It opens a full-screen panel titled **TRAQS Cloud** that contains no write of any kind — no `setTasks`, no `updTask`, no `commitLanding` across its whole render block. Either the importer was removed and the button left behind, or it was never built and the tooltip describes an intention. Same family as #49 (a comment for a deleted function that read as a missing button) and #341 (a modal that could never render): a labelled affordance promising something the code does not do. The question to answer first is which of the two it is.

406. [PROCESS — LOGGED AGAINST MYSELF] FIVE SURVEY FINDINGS EXISTED ONLY IN A CHAT TRANSCRIPT. The Jobs-surface sweep reported #393–#401; the consolidation commit wrote #393, #394, #395, #398 and #402 to this file and **#396, #397, #399, #400 and #401 were never written down at all**. They were found by `grep -c "^400\. "` returning 0 while trying to correct #400's title — the same "a zero result is when to check the sweep" rule (LESSONS #3) applied to the log rather than to the code. A finding that is reported but not logged is a finding that will be re-found: the survey's whole value is that the next pass starts from it. Entries are written when the finding is made, not when the fix is.

407. DONE 2026-10-06 (#400 item 1). **A DURABLE RECORD OF WHICH AI TOOLS ACTUALLY FIRED.** The Jobs sweep could not answer "does anyone use Ask to write?" and said so rather than offering a proxy — and that question decides whether #400 item 2 is tidying or urgent. A confirmed AI run now tags the save it triggers with `X-Action-Source: ai:<tool>,<tool>`, and `tasks.js` records an `ai-action` row beside every other rule event.

    THE CARRIER IS A HEADER ON THE SAVE, not a new endpoint and not a client write to the log. The durable log has one writer for a reason, and the client has already been shown not to be trustworthy about its own outcomes — #403 was exactly that.

    CLIENT INPUT, TREATED AS SUCH. The value lands in a file the whole org reads, so it is capped at 200 characters and stripped of line breaks: unbounded, a client fills S3 one save at a time; with a newline, one row stops being one row. **IT RECORDS AND NEVER REFUSES** — telemetry that can fail a save is worse than no telemetry, which is the whole reason this ships before item 2 rather than with it.

    THE REF IS CLEARED IMMEDIATELY AFTER THE SAVE. Left set, every later save in the session would be attributed to the assistant — a worse lie than the missing record this exists to fix.

    TO READ IT: `node scripts/read-rule-events.mjs --org MTX2026TRAQS --tag ai-action`. Zero rows after a week means item 2 is tidying.

408. DONE 2026-10-06 (#400 item 3). **THE FIVE LEGACY AI HANDLERS ARE DELETED** — `update_task_status`, `reschedule_task`, `assign_person`, `remove_person`, `create_task`, in both the preview-label switch and the executor switch. They were never in `AI_TOOLS`, so the model was never offered them and could not emit them: unreachable from the declared schema, and five more writers for the next survey to find, four of them bypassing `updTask` with a raw `setTasks`.

    AND THE TWO LISTS ARE NOW PINNED TO EACH OTHER. The suite asserts that every executable `case` is a tool the model is actually offered, and that every declared tool has an executor — so a handler for a tool nobody can request cannot be added back without the build saying so, and a declared tool with no executor (which would fail silently at run time) cannot either. Reachability is a property of the PAIR, and it was previously asserted on neither half.