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

- **Items** (`scheduleItems` :297–374):
  - The current user only.
  - Finished work is dropped.
  - Items within `[today−60d, lastVisible]`.
  - A panel item whenever I'm on the panel team and on none of its ops. **No `hasLiveChildren` rule.**
- **Length** (`makeItem` :376–386): `hpd × businessDaySpan`. **hpd is read as a per-day rate** with no team division; `businessDaySpan` skips no holidays.
- **Packing:** `SchedulePacker.allocate` (Services/SchedulePacker.swift:47–86) rolls work forward day by day. Capacity is `paidHoursPerDay` (work window minus lunch, not breaks). **No cursor:** untouched past work is placed on past days.
- **In-day position** (`blocks(on:)` :391–430): a hand-rolled lunch-only step. It ignores breaks, `startHour` and team size. `WorkDayClock` (a faithful port of `buildDayWindows`/`walkProductiveHours`) is **not used** here.
- **Live hours** (`AppState.liveHours(forOp:on:)` :3292–3303): raw wall clock minus paused. No freeze, no lunch or break deduction, and counted only on the session's start day.
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
- **Colour** is inferred from **title keywords** and `jobType` (:501–529), not `panel.color`.
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
49. There is no UI to unlock an op; `toggleLock` is dead (J:10316).
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
69. Cursor-anchored bars aren't clamped to work hours or work days (J:17932–17940).
70. After close, a cursor-anchored head collapses to zero width [inferred].
71. `_visualEnd` ignores the push (J:16477–16499).
72. `TD`/`NOW` are frozen at module load (J:474).
73. The drawn now line uses `TD` while bar dividers use `new Date()` (J:19490 vs J:17772).
74. The schedule has three separate now-cursor formulas (J:17776, 19493, 19231).
75. `Date.now()` is read about 8 times per bar within one render (J:17772–19333).
76. The org timezone is ignored by all schedule geometry; everything is browser-local.
77. `productiveHoursBetween` is off by one hour on DST days relative to `getHours()` (S:442) [inferred].
78. `weekdaySegments`, `countWorkingDays` and `addWorkingDays` never skip holidays (J:578–620).
79. Holidays are never shaded in the grid or headers (J:17332, 17617).
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
157. Auto-schedulers fall back to all crew when a department has nobody (J:26585–26588; JobsScheduler.swift:191–197).
158. JobsSchedulerTests asserts the department fallback as intended behaviour (:136–138).
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
185. PARTLY ADDRESSED. The per-job stale-copy check in `fn/tasks.js` compares each POSTed job`s `lastModifiedAt` against the stored one and, in `enforce`, keeps the stored job and reports the id back. It WOULD have caught the #323 clobber: the clobbering write carried a different stamp from the stored one, which is exactly what it tests for. It did not, because `ruleMode` returns `log` for an unset env var and `TASK_CONFLICT_MODE` is set nowhere in the repo — so for months it recorded the conflict in the function log and let the write through. The detection is not the gap; leaving the switch in its off position is. That is why #323`s protection is unconditional and has no mode of its own. Note also that `enforce` is blunt where #323 is precise: it discards the client`s whole job, including legitimate concurrent edits, whereas restoring just the server-owned field keeps both. They are complementary, and turning `TASK_CONFLICT_MODE=enforce` on is still worth doing for `status`, `pendingFinish` and the finish-request list, which #323 does not cover and which concurrency-test still shows being clobbered in log mode. REVERSED 2026-10-02 — DO NOT FLIP TASK_CONFLICT_MODE TO ENFORCE. This entry's recommendation ("turning `TASK_CONFLICT_MODE=enforce` on is still worth doing") was written before the rule log could be read. The first real read shows why it would break the app: the client never advances its `lastModifiedAt` after a successful save, so from its FIRST write onward every subsequent save in the session is stale against the save before it. Five sequential drags produced five task-conflict records with an IDENTICAL incomingStamp. In enforce, four of the five would have been refused and rolled back, and that is normal editing rather than an edge case. The detection was never the problem — this is correct detection against a broken client. See #337. THE ORDER IS: fix the stamp (done, #337), let it run, confirm the log goes quiet, THEN flip. Flipping first would produce a guard that fires constantly and gets switched off rather than believed, which is LESSONS #1 in a different costume. COUPLING 2026-10-02 — there are now TWO preconditions on flipping TASK_CONFLICT_MODE, not one. The first is #337 (the client must adopt the stamp the server wrote; done). The SECOND is undo: `undo()` restores a deep copy of a previous state including its `lastModifiedAt`, so every undo posts stale stamps and trips the conflict check. In log mode that is noise in rule-events.json; in ENFORCE IT MEANS UNDO SILENTLY STOPS WORKING, because every undo is refused as a stale write. #218's fix does not address this — it stops undo CAPTURING server writes, it does not stop an undo REPLAYING old stamps. So the order is: #337 (done), then undo stops posting stale stamps (open, no entry yet), then read the log, then flip.
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
219. Undo is client-only; the server can't tell an undo from an edit.
220. FIXED 2026-10-02 — and it was THREE defects in one statement, not two. (1) `e.preventDefault()` ran BEFORE any permission check, and `undo()` early-returns on `!can("undoHistory")`, so a user without the right lost the browser's native text undo and got nothing in exchange. (2) No target check, so Ctrl+Z inside any input or textarea was dead for EVERY user regardless of rights. (3) NEWLY FOUND: `e.key === "z" && e.shiftKey` is unreachable — with Shift held `KeyboardEvent.key` is `"Z"`, so CTRL+SHIFT+Z HAS NEVER ONCE FIRED REDO and only Ctrl+Y ever worked. All three have the same shape, which is why they take one fix: decide whether the handler OWNS the event before consuming it, and compare the key case-insensitively. THE FIX ALREADY EXISTED IN THE FILE — the export designer's own Ctrl+Z handler lowercases the key and returns early on input/textarea/contentEditable; the main handler, 1,600 lines away, never got the same treatment. The effect now also depends on `_mayUndo` so it re-subscribes when permissions change.
221. `setPeople` has no undo history, so PTO and row moves can't be undone (J:5445). NOTE 2026-10-02: this is a DESIGN CHOICE, not a bug. `origin/docs/rostering-design` decision 18 states that `setTasks` is the only state setter wrapped by the history stack and `setPeople` "deliberately is not", and defers extending history to roster writes because overrides persist server-side rather than living in client state the way `tasks` does — so it needs a different mechanism, not a wider wrapper. The known consequence is recorded there too: a Basic admin who mis-drags a shift re-drags it. Leave as is; reopening it means overturning decision 18.
222. No schedule move notifies the affected worker (only team, status and finish changes do).
223. `normalizeTasks` persists derived `color` and `requiredDepartment` defaults (J:7553–7590).
224. `normalizePeople` persists derived `department` (J:7548).
225. The settings rehydrate merge can't remove keys, and a stale localStorage copy can be re-saved (J:8768, 5881).
226. Non-admin setting changes POST and 403 silently (`fn/settings.js:38`).
227. `moveLog` is unbounded and every autosave POSTs the whole tree (J:8561–8568).
228. CORRECTED 2026-10-02 — half of this entry was wrong, and the error is instructive. Measured field by field, for READS of the value rather than occurrences of the name: `unclosedAt` IS READ (`TRAQS.jsx:6753` gates a sweep on it, and `timeclock.js` writes it through `updateJobSession` and strips it on resume at :1882) — remove it from this entry. The `orgConfig` slice IS READ (`db/sync.js:72` stores it, :229 routes it, `sync.js:61` serves it) — it is a live sync entity, not a dead write. CONFIRMED DEAD, exactly two groups: `actualHours`/`actualStart`/`actualEnd` and `plannedStart`/`plannedEnd`/`plannedStartHour`/`plannedEndHour`. Every one appears ONLY at its write site in `finishedOpFields` (J:9426, 9464, 9465, 9470); the single other occurrence anywhere is `dragMove.js:301`, a destructure that DISCARDS `actualHours`. Zero reads in web, functions or iOS. THE TRAP, which is why this took three passes: grepping a field name returns the functions NAMED AFTER IT, not the reads of it. `actualHoursFor` is a rollup that computes the same quantity from leaves via `deriveWorkedState` and never touches the field, and `taskActions.js:43` lists all seven in `FINISH_RESOLUTION_FIELDS`, a permission CLASSIFIER rather than a consumer. A comment at the write site asserts "It is read, at :12995 and :23864" — both of those are calls to `actualHoursFor`, so the comment is itself an instance of the trap and should be corrected when the fields go. NOT DELETED YET, and that is a change of premise rather than a deferral: the instruction was to delete three confirmed-dead groups and there are two, with the other two live. The remaining two are also the deliberate skeleton of a planned-vs-actual report, so removing them is a product call rather than a cleanup — nothing reads them today, and nothing will if they are deleted.
229. `person.autoSchedule` exists only in the server PROTECTED list (`fn/people.js:15–19`).
230. The payhours/productionhours migration never auto-runs; unmigrated orgs read empty datasets (`_utils/migrate-timeclock.js:15–16`) [inferred].
231. React `onWheel` `preventDefault` calls are likely no-ops, since the listeners are passive (J:12428, 12439) [inferred].
232. `renderMobileApp` calls `useState` behind a ternary, so the hook order changes across 768 px (J:24107, 30374).
233. There are no touch handlers; every schedule interaction is mouse-only.
234. `renderMobileTeam` is unreachable (J:24295, 24502). DELETED (root cause 9): 69 lines. `mobileView` is `view === "schedule" ? "home" : view`, so it could never hold "schedule". If mobile scheduling returns it is a real feature with a real design — there are no touch handlers anywhere in the schedule (#233).
235. macOS has no native schedule, only a "Not ported yet" placeholder (NativeShell.swift:257–263).
236. The macOS "Take me to schedule" lands on the placeholder (JobsPage.swift:633–637).
237. macOS "Reschedule" is permanently disabled (JobsRowMenu.swift:265–269).
238. The iOS gantt reads `hpd` as a per-day rate × business-day span (GanttView.swift:376–386).
239. Native code reads `hpd` three ways: gantt, progress/scheduler and JobShifts (GanttView.swift:385, HoursCalculator.swift:80, JobsScheduler.swift:96, JobShifts.swift:40). CORRECTION 2026-10-02: an earlier note on this entry claimed the cited Swift file does not exist. THAT WAS WRONG and came from reading the wrong branch — the `traqs` checkout sits on `fix/code-audit-2026-09-10`, not master. On MASTER the file exists, with a test file beside it, and master's iOS tree is 130 Swift files / 45,721 lines rather than the 70 / 32,190 reported. The entry stands as written. Related and more important: `e8bd343 feat(ios): Basic tier jobs are shifts, not tracked work` IS on master, iOS is tier-aware (`billingTier` in 9 places), and `JobShifts.swift` already projects a Basic job into a shift — so any claim in this map about iOS "not having" something must be checked against master before it is believed.
240. The iOS gantt doesn't divide by team size (GanttView.swift:340).
241. The iOS gantt draws panels whose ops belong to others (the 75-hour-bar bug) (GanttView.swift:342–360).
242. iOS has two panel-bar rules (GanttView vs JobsScheduler leaf rule) (JobsScheduler.swift:318–323). CORRECTION 2026-10-02: an earlier note on this entry claimed the cited Swift file does not exist. THAT WAS WRONG and came from reading the wrong branch — the `traqs` checkout sits on `fix/code-audit-2026-09-10`, not master. On MASTER the file exists, with a test file beside it, and master's iOS tree is 130 Swift files / 45,721 lines rather than the 70 / 32,190 reported. The entry stands as written. Related and more important: `e8bd343 feat(ios): Basic tier jobs are shifts, not tracked work` IS on master, iOS is tier-aware (`billingTier` in 9 places), and `JobShifts.swift` already projects a Basic job into a shift — so any claim in this map about iOS "not having" something must be checked against master before it is believed.
243. The iOS gantt ignores stored `startHour`; its comment says the schema lacks it (GanttView.swift:201).
244. The iOS gantt uses a hand-rolled lunch-only step instead of `WorkDayClock`, and ignores breaks (GanttView.swift:391–430).
245. iOS day capacity uses `paidHoursPerDay`, which removes lunch but not breaks (GanttView.swift:221, Models.swift:1385–1394).
246. `OrgSettings.productiveHoursPerDay` on iOS is dead and uses the abandoned flat formula (Models.swift:1364–1375).
247. The iOS gantt has no cursor: untouched past work is placed on past days and backlog eats capacity (GanttView.swift:227, 257–293). TIER UNCERTAINTY 2026-10-02: this describes iOS missing something the web has, and the missing thing is a JOB-TIME concept that the Basic tier definition explicitly excludes (no hatching, no overdue tray, no cursor, no time logged against work). So it could be an intentional tier difference rather than a defect. COUNTER-EVIDENCE, and it is strong: timeclock.js:439 records the native clients posting jobClockIn by name (iOS APIService.swift, Android ApiService.kt), so iOS implements the job layer today and is a Business or mixed client. On that basis this stays a DEFECT and a partial implementation, not a deliberate omission. Which tier iOS targets is unsettled and will be decided on the Mac; revisit if that answer is Basic.
248. The iOS gantt rolls history forward instead of hiding it (GanttView.swift:319–332). TIER UNCERTAINTY 2026-10-02: this describes iOS missing something the web has, and the missing thing is a JOB-TIME concept that the Basic tier definition explicitly excludes (no hatching, no overdue tray, no cursor, no time logged against work). So it could be an intentional tier difference rather than a defect. COUNTER-EVIDENCE, and it is strong: timeclock.js:439 records the native clients posting jobClockIn by name (iOS APIService.swift, Android ApiService.kt), so iOS implements the job layer today and is a Business or mixed client. On that basis this stays a DEFECT and a partial implementation, not a deliberate omission. Which tier iOS targets is unsettled and will be decided on the Mac; revisit if that answer is Basic.
249. Overrun is invisible on iOS; the worked fill caps and the bar never grows (GanttView.swift:457). TIER UNCERTAINTY 2026-10-02: this describes iOS missing something the web has, and the missing thing is a JOB-TIME concept that the Basic tier definition explicitly excludes (no hatching, no overdue tray, no cursor, no time logged against work). So it could be an intentional tier difference rather than a defect. COUNTER-EVIDENCE, and it is strong: timeclock.js:439 records the native clients posting jobClockIn by name (iOS APIService.swift, Android ApiService.kt), so iOS implements the job layer today and is a Business or mixed client. On that basis this stays a DEFECT and a partial implementation, not a deliberate omission. Which tier iOS targets is unsettled and will be decided on the Mac; revisit if that answer is Basic.
250. iOS `liveHours(forOp:on:)` has no freeze, no lunch or break deduction, and only counts on the start day (AppState.swift:3292–3303). TIER UNCERTAINTY 2026-10-02: this describes iOS missing something the web has, and the missing thing is a JOB-TIME concept that the Basic tier definition explicitly excludes (no hatching, no overdue tray, no cursor, no time logged against work). So it could be an intentional tier difference rather than a defect. COUNTER-EVIDENCE, and it is strong: timeclock.js:439 records the native clients posting jobClockIn by name (iOS APIService.swift, Android ApiService.kt), so iOS implements the job layer today and is a Business or mixed client. On that basis this stays a DEFECT and a partial implementation, not a deliberate omission. Which tier iOS targets is unsettled and will be decided on the Mac; revisit if that answer is Basic.
251. The iOS gantt ignores holidays (GanttView.swift:180–183, 485–499).
252. iOS has no PTO, eng-chip, cross-row, locked or finished states. TIER UNCERTAINTY 2026-10-02: this describes iOS missing something the web has, and the missing thing is a JOB-TIME concept that the Basic tier definition explicitly excludes (no hatching, no overdue tray, no cursor, no time logged against work). So it could be an intentional tier difference rather than a defect. COUNTER-EVIDENCE, and it is strong: timeclock.js:439 records the native clients posting jobClockIn by name (iOS APIService.swift, Android ApiService.kt), so iOS implements the job layer today and is a Business or mixed client. On that basis this stays a DEFECT and a partial implementation, not a deliberate omission. Which tier iOS targets is unsettled and will be decided on the Mac; revisit if that answer is Basic.
253. iOS bar colour comes from title keywords instead of `panel.color` (GanttView.swift:501–529).
254. iOS week mode has no previous/next-week navigation (GanttView.swift:1077–1102).
255. iOS `DatePickerSheet`, `ScheduleFocus`, `opLoggedDays` and the finished `workedHours` branch are dead (GanttView.swift:1399–1431, 586–590, 437; AppState.swift:3276). TIER UNCERTAINTY 2026-10-02: this describes iOS missing something the web has, and the missing thing is a JOB-TIME concept that the Basic tier definition explicitly excludes (no hatching, no overdue tray, no cursor, no time logged against work). So it could be an intentional tier difference rather than a defect. COUNTER-EVIDENCE, and it is strong: timeclock.js:439 records the native clients posting jobClockIn by name (iOS APIService.swift, Android ApiService.kt), so iOS implements the job layer today and is a Business or mixed client. On that basis this stays a DEFECT and a partial implementation, not a deliberate omission. Which tier iOS targets is unsettled and will be decided on the Mac; revisit if that answer is Basic.
256. iOS `dayShort` and `dayFull` share one format, so the subtitle duplicates the title (GanttView.swift:1436–1441).
257. iOS hour labels truncate fractional start hours, and the week `hourCount` truncates (GanttView.swift:717, 1141, 1176).
258. The iOS sort tie-break concatenates `jobNumber + panel.id` as strings (GanttView.swift:371).
259. iOS `rescheduleUnit` shifts by calendar days, so dependents can land on weekends (AppState.swift:2040–2043, 2094).
260. iOS `rescheduleUnit` writes no `moveLog` (AppState.swift:2079–2121).
261. iOS `rescheduleUnit` has no lock, active-clock, before-now or overlap check (AppState.swift:2079–2121).
262. An iOS panel reschedule leaves its ops and the job/panel envelope stale (AppState.swift:2079–2121).
263. iOS `hasDependents`/`dependentOpIds` ignore panel-level `deps` (AppState.swift:2047–2067).
264. iOS `OrgBreak` decodes a missing duration as 30 min while `WorkDayClock` and the web use 60 (Models.swift:1207–1210).
265. iOS `workStartHour`/`workEndHour` fall back to 8/17 while `OrgSettings.default` is 07:00–15:00 (Models.swift:1397–1407 vs 1253–1256).
266. iOS JobHealth has drifted from web `getHealth` (missing the `loggedHours`/`pctDoneOverride` rule) (J:817–832). TIER UNCERTAINTY 2026-10-02: this describes iOS missing something the web has, and the missing thing is a JOB-TIME concept that the Basic tier definition explicitly excludes (no hatching, no overdue tray, no cursor, no time logged against work). So it could be an intentional tier difference rather than a defect. COUNTER-EVIDENCE, and it is strong: timeclock.js:439 records the native clients posting jobClockIn by name (iOS APIService.swift, Android ApiService.kt), so iOS implements the job layer today and is a Business or mixed client. On that basis this stays a DEFECT and a partial implementation, not a deliberate omission. Which tier iOS targets is unsettled and will be decided on the Mac; revisit if that answer is Basic.
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
289. The auto-schedulers fall back to the whole crew when no one in an op's department is free (J:26585–26588); they should fail loudly instead. The server now refuses the out-of-department assignment they produce.
290. `JobsSchedulerTests` (Swift) asserts the department fallback to everyone as intended behaviour; it must change with #289.
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
304. iOS schedule geometry ignores the org timezone: OrgSettings has no timeZone field and the app uses Calendar.current in ~66 places (GanttView, TasksView, ScheduleDate parsing…). Deferred from root cause 6 to its own pass.
305. The web day view's hour grid (5–21) and its off-hours shading (7–18) are hard-coded and never read the org's workStart/workEnd. Found in root cause 6; not fixed.
306. iOS `OrgSettings.productiveHoursPerDay` (Models.swift ~1404) parses a malformed workStart/workEnd as 08:00 (both malformed → 0-hour block, floored to 1), and `paidHoursPerDay` falls back to 8; neither uses the 07:00–15:00 defaults. Found in root cause 6; not fixed.
307. iOS `OrgBreak` decoding falls back to 30 minutes when durationMinutes is missing; the break default is 15. Found in root cause 6; not fixed.
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
