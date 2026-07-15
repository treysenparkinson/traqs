# Request Completion + Overdue Job Lifecycle

**Date:** 2026-07-15
**Status:** Approved (design). Spans the native SwiftUI iOS app (`TRAQS Scheduling/`),
the React web app (`src/TRAQS.jsx`), and Netlify functions. Not committed unless asked.

## Goal

1. On the iOS Jobs list, replace each card's date+arrow with a 3-dot Liquid-Glass
   menu → **Information** (open detail) and **Request Completion**.
2. **Request Completion** fully finishes a job, but only via admin approval: it posts
   a request into a group thread of all admins (in Messages); admins Accept/Deny;
   on approval the whole job is marked Finished (disappears on iOS, Finished on web).
3. Jobs **never auto-finish**. A past-due unfinished job stays visible, labeled
   **Overdue**, and on the web schedule its bar keeps extending to today and pushes
   downstream jobs back — **derived/visual only, no stored-date rewrites**.
4. Rename the web right-click **"Request Finish Approval" → "Request Completion"** so
   both apps match (two places to complete a job).

## Key existing mechanisms (verified)

**Web (`src/TRAQS.jsx`):**
- Context-menu item "Request Finish Approval" at `20635`; opens confirm modal (`19244`);
  `requestFinishApproval` (`5829`) writes `finishRequest` + `finishRequests[]` onto the
  item and posts a `type:"finish_request"` message to the `job:` thread (`5880`).
- `adminApproveJobFinish` (`5893`) is the ONLY code that programmatically sets
  `status:"Finished"` (`5905`); `adminDeclineJobFinish` (`5929`). Finish-request message
  card with Approve/Decline (admin-gated) at `14602`/`14699`/`14721`.
- No auto-finish. "Disappears next day" = the time-period filter at `4532`:
  `isFinished = status==="Finished" || (end && end < TD)` → past-end jobs are treated as
  finished and hidden when the "finished" period toggle is off. Also the gantt renders a
  forward window. Jobs-list split is status-based (`finishedTasks`/`activeTasks` `7357`).
- Overdue already exists: `getHealth` (`388`) → "critical"; overdue group (`11667`);
  OVERDUE badge (`8141`). Duration from hpd (`2793`); no bar growth for lateness.
- Messages: threadKeys `dm:`/`group:`/`job:`/`panel:`/`op:`. `postMessage` (`api.js:213`).
  `saveNewGroup` (`6338`). Backend `recipientsForThread` (`messages.js:122`) pushes to
  thread membership (group → memberIds), and sender must be a participant (`messages.js:221`).
  So reaching all admins reliably ⇒ a `group:` thread whose memberIds include them.
- Admins: `people.filter(p => p.userRole === "admin")`.

**iOS (`TRAQS Scheduling/`):**
- Card = `TaskCardV1` (`TasksView.swift:889`); date+chevron at `1044-1054`; whole card
  wrapped in `NavigationLink(value: task.job)` at `35-38`, `223-228`, `504-507`.
- `JobsHubView` owns `NavigationStack(path:[Job])`; destination `JobDetailView(job:)` at
  `130`. Programmatic push via `path` (`204-209`).
- No iOS code sets status Finished. `AppState.updateJob` exists (used by `signOff`).
- `TasksView` filters by assignment + date range only, NOT status — finished jobs are
  NOT hidden today (`262-284`, `300-338`). Status only drives the pill (`1001-1013`).
- Messages: `Message` (`Models.swift:657`) has `threadKey`, `scope`, `type`,
  `participantIds`, time-off request fields. `ChatGroup` (`726`). `createGroup(name:memberIds:)`
  (`AppState.swift:1025`), `addGroupMembers` (`1050`), `sendMessageThrowing` (`857`).
  Time-off request bubble with inline Approve/Deny is the template.
- Admins: `appState.people.filter { $0.isAdmin }`; current user `appState.currentPerson`.
- Glass menu pattern: `Menu {…} label:{…}.buttonStyle(.glass)` (`JobsHubView.swift:166`),
  or `.glassEffect(.regular.interactive(), in: Circle())`.

## Phase 1 — Completion feature

### A. iOS 3-dot menu (`TaskCardV1`)
- Remove the top-right date + `chevron.right`; add a 3-dot `ellipsis` button in a
  `.glassEffect(.regular.interactive(), in: Circle())` `Menu`.
- Menu content: `Button("Information", systemImage:"info.circle")` → open detail;
  `Divider()`; `Button("Request Completion", systemImage:"checkmark.seal")` → request.
- Navigation: add `onOpenJob: (Job) -> Void` from `JobsHubView` (appends to `path`) down
  through `TasksView` → `TaskCardV1`. Replace the 3 `NavigationLink(value:)` wrap sites
  with a tappable card that calls `onOpenJob(task.job)` (interior Start/Stop buttons keep
  their own tap handling). Menu "Information" also calls `onOpenJob`.
- Admin vs worker: any assigned user may Request Completion (workers included — approval
  is what gates finishing).

### B. Unified completion-request flow (iOS + web + backend)
- **Group thread:** ensure a single group named **"Completion Requests"** (create-or-reuse
  by name; dedupe exists both sides). memberIds = union(all admin ids, requester id).
  (Requester must be a member to post/see per `messages.js:221`.)
- **On request** (job-level): set `job.finishRequest = {requestId, by, byName, at}` and
  append to `job.finishRequests[]`; post a `type:"finish_request"` message to
  `group:<completionGroupId>` with `jobId`, `finishRequestId`, text
  "Completion requested by <name> for Job #<num> — <title>".
- **Admin sees** the request as a card/bubble in that thread with **Approve / Deny**:
  - Web: reuse the `finish_request` card (`14602`) — now rendered in the group thread.
  - iOS: new `type == "finish_request"` bubble (model on the time-off bubble) with
    Approve/Deny shown when `currentPerson.isAdmin`.
- **Approve** → set the WHOLE job `status:"Finished"` (job + all panels + all ops),
  clear `finishRequest`, mark `finishRequests` entry approved, post a confirmation to the
  thread, notify requester. Web: extend `adminApproveJobFinish` to cascade job→panels→ops.
  iOS: `AppState.approveCompletion(jobId:)` sets statuses + `updateJob` + post confirm.
- **Deny** → mark declined, post a decline message; job stays active/overdue. No required
  reason.
- **Model additions (iOS `Message`):** add `finishRequestId: String?` (JSON-compatible;
  web already sends it). Reuse existing `type`.
- **Backend:** `type:"finish_request"` already handled by `notify.js:88`. Group-thread
  delivery reaches admins via `recipientsForThread` group branch. Add requester
  notification on approve/deny if needed.

### C. iOS finished jobs disappear
- In `TasksView`'s task assembly (`myTasks` / `tasks(in:)`), exclude tasks whose
  `job.status == .finished`. Approved job drops off the list. (No finished section on iOS.)

### E. Web rename
- `20635` label "Request Finish Approval" → "Request Completion"; sub-text
  "Send to all admins for review and approval" (keep or tweak); confirm modal wording
  (`19244`) and any "finish approval" copy → "completion".

## Phase 2 — Overdue lifecycle (web schedule)

### D1. Never auto-finish + Overdue visibility (low risk)
- Time-period filter (`4532`): change `isFinished` to `status === "Finished"` only (drop
  the `end < TD` clause). Past-end unfinished jobs classify as current/overdue, not
  finished, so they stay visible.
- Ensure such jobs render with the existing **Overdue** treatment (getHealth critical,
  overdue grouping/badge) across Jobs list and schedule viewport.

### D2. Gantt bar extend + derived push-back (high risk)
- For an unfinished job with `end < today`, compute a **derived effective end = today**
  and render its bar through today (ongoing look). Stored `end` unchanged.
- Downstream jobs on the same person render **shifted later** by the derived overrun,
  computed at render time only — no writes. Implement incrementally in the gantt renderer
  (`9144-9166`, `9573`, `9903`); verify heavily. May need iteration; this is the riskiest
  piece and is explicitly display-only.

## Out of scope / non-goals
- No automatic date rewrites of any job (Phase 2 is derived/visual only).
- No new deny-reason requirement.
- Engineering sign-off / standalone Approval Queue are untouched (separate systems).

## Verification
- iOS: `xcodebuild ... build` succeeds; drive the flow in the simulator (menu → request →
  admin thread → approve → job disappears).
- Web: dev build; request from web + iOS, approve/deny in the group thread, confirm
  status + overdue behavior; confirm the rename.
