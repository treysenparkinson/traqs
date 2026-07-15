# Request Completion + Overdue Job Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Request Completion" flow (iOS 3-dot card menu + web rename) that finishes a whole job only via admin approval delivered in a Messages group thread, and stop jobs auto-finishing so overdue jobs persist and (on the web schedule) visually extend and push others back.

**Architecture:** One backend mechanism (`type:"finish_request"` messages in a shared admins group thread, `finishRequest` on the job) drives both apps. Web reuses/extends its existing finish-request flow; iOS gains the request UI + an admin request bubble. Overdue behavior is a filter fix (never auto-finish) plus derived, non-persisted gantt rendering.

**Tech Stack:** React 18 / Vite (`src/TRAQS.jsx`, `src/api.js`), Netlify functions (`netlify/functions/*.js`), native SwiftUI iOS 26 (`TRAQS Scheduling/`), shared Netlify backend.

## Global Constraints

- iOS app is native SwiftUI at `TRAQS Scheduling/` (scheme `TRAQS Scheduling`); it is NOT the web app in a wrapper. Build check: `xcodebuild -project "TRAQS Scheduling/TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" -configuration Debug -destination 'generic/platform=iOS Simulator' -skipPackagePluginValidation build`. Do NOT launch the simulator; the user runs it.
- Theme tokens: `T.*` (hex + `Color(hex:)`), fonts `TTypo.*`, glass via `.glassEffect(.regular.interactive(), in:)`.
- Admins: web `people.filter(p => p.userRole === "admin")`; iOS `appState.people.filter { $0.isAdmin }`.
- Completion label copy is exactly **"Request Completion"** in both apps.
- Phase 2 pushes NOTHING to storage — overdue bar-extend and downstream shift are render-time only.
- Do not commit or push unless the user asks.
- Xcode project uses synchronized file groups — new Swift files under the folder are auto-included; no pbxproj edit.

---

## Phase 1 — Completion feature

### Task 1: Backend + web — deliver finish requests to an admins group thread; rename to "Request Completion"

**Files:**
- Modify: `src/TRAQS.jsx` (`requestFinishApproval` ~5829; context-menu label ~20635; confirm modal ~19244; `adminApproveJobFinish` ~5893)
- Reference: `netlify/functions/messages.js` (`recipientsForThread` 122, participant gate 221), `src/api.js` (`postMessage` 213, `saveGroups`)

**Interfaces:**
- Produces: a group named `"Completion Requests"` (memberIds = all admin ids ∪ requester id); `type:"finish_request"` messages carry `threadKey:"group:<id>"`, `jobId`, `finishRequestId`. `adminApproveJobFinish(itemId)` finishes the whole job (job + panels + ops).

- [ ] **Step 1: Rename the context-menu item + confirm modal copy**
  In `src/TRAQS.jsx:20635`, change `label="Request Finish Approval"` → `label="Request Completion"`. Keep sub `"Send to all admins for review and approval"`. In the confirm modal (~19244) change any "Finish Approval"/"finish" heading/button copy to "Request Completion"/"Send Completion Request".

- [ ] **Step 2: Route the request message to the admins group thread**
  In `requestFinishApproval` (~5829), after computing `adminParticipants = people.filter(p => p.userRole === "admin")`, ensure a shared group:
  ```js
  // Ensure a single "Completion Requests" group of all admins + the requester.
  const grpName = "Completion Requests";
  const memberIds = [...new Set([...adminParticipants.map(a => a.id), loggedInUser.id])];
  let grp = groups.find(g => g.name === grpName);
  if (!grp) { grp = { id: uid(), name: grpName, memberIds, createdBy: loggedInUser.id, createdAt: new Date().toISOString() }; await saveGroups([...groups, grp], getToken, orgCode); }
  else if (memberIds.some(id => !grp.memberIds.includes(id))) { grp = { ...grp, memberIds: [...new Set([...grp.memberIds, ...memberIds])] }; await saveGroups(groups.map(g => g.id === grp.id ? grp : g), getToken, orgCode); }
  ```
  Then change the `postMessage` (~5880) to target the group thread:
  ```js
  postMessage({ threadKey: `group:${grp.id}`, scope: "group", jobId: parentJob.id,
    text: `Completion requested by ${loggedInUser.name} for Job ${parentJob.jobNumber ? "#"+parentJob.jobNumber : ""} — ${parentJob.title}`,
    type: "finish_request", finishRequestId: requestId,
    authorId: loggedInUser.id, authorName: loggedInUser.name, authorColor: loggedInUser.color,
    participantIds: grp.memberIds, attachments: [] }, getToken, orgCode);
  ```
  (Keep writing `finishRequest`/`finishRequests` onto the job as today.)

- [ ] **Step 3: Make approval finish the WHOLE job**
  In `adminApproveJobFinish` (~5893), when resolving the target job, set `status:"Finished"` on the job AND cascade to every panel and op under it (map subs → status Finished), clear `finishRequest`, mark the `finishRequests` entry approved, `saveTasks(...)`, and post the confirmation message to `group:${grp.id}` (same group).

- [ ] **Step 4: Build + drive (web)**
  Run: `cd /Users/treysenparkinson/traqs && npx esbuild src/TRAQS.jsx --loader:.jsx=jsx --jsx=automatic --bundle=false --outfile=/dev/null` → expect no errors.
  Then in the running dev app: right-click a job → "Request Completion" → confirm; verify a message appears in a "Completion Requests" thread; as an admin, Approve → the whole job (all panels/ops) shows Finished.

- [ ] **Step 5 (optional): Commit** — only if the user asks.

### Task 2: iOS — Message model + AppState completion methods

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Models/Models.swift` (`Message` ~657)
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Services/AppState.swift`
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Services/APIService.swift` (if a job-status save endpoint is needed)

**Interfaces:**
- Produces: `Message.finishRequestId: String?`; `AppState.requestJobCompletion(jobId:) async`; `AppState.approveJobCompletion(jobId:requestId:) async`; `AppState.denyJobCompletion(jobId:requestId:) async`.

- [ ] **Step 1: Add `finishRequestId` to `Message`**
  In `Models.swift` `Message`, add `var finishRequestId: String?` and decode it in `init(from:)` via `try? c.decodeIfPresent(String.self, forKey: .finishRequestId)` (synthesized CodingKeys include it once the property exists). Confirm encode round-trips.

- [ ] **Step 2: `requestJobCompletion(jobId:)`**
  In `AppState.swift`, add:
  ```swift
  func requestJobCompletion(jobId: String) async {
      guard let me = currentPerson, let job = jobs.first(where: { $0.id == jobId }) else { return }
      let adminIds = people.filter { $0.isAdmin }.map(\.id)
      let members = Array(Set(adminIds + [me.id]))
      let grp = await createGroup(name: "Completion Requests", memberIds: members)
      let reqId = UUID().uuidString
      // (optimistically flag the job locally if a job-level finishRequest field is added; else rely on the message)
      let msg = Message(/* threadKey: "group:\(grp.id)", scope: "group", jobId: jobId,
          text: "Completion requested by \(me.name) for Job \(job.jobNumber.map{"#\($0)"} ?? "") — \(job.title)",
          type: "finish_request", finishRequestId: reqId,
          authorId: me.id, authorName: me.name, authorColor: me.color,
          participantIds: grp.memberIds, attachments: [] */)
      try? await sendMessageThrowing(msg)
  }
  ```
  (Match the exact `Message` initializer in `Models.swift`; `createGroup` dedupes by name and ensures membership — if it doesn't merge new admins, call `addGroupMembers` first.)

- [ ] **Step 3: `approveJobCompletion` / `denyJobCompletion`**
  ```swift
  func approveJobCompletion(jobId: String, requestId: String) async {
      guard let idx = jobs.firstIndex(where: { $0.id == jobId }) else { return }
      var job = jobs[idx]
      job.status = .finished
      job.subs = job.subs.map { var p = $0; p.status = .finished; p.subs = p.subs.map { var o = $0; o.status = .finished; return o }; return p }
      await updateJob(job)   // existing persistence path used by signOff
      // post confirmation message to the same group thread (reuse the group)
  }
  func denyJobCompletion(jobId: String, requestId: String) async { /* post a decline message; no status change */ }
  ```
  Verify `updateJob` signature in `AppState.swift` and reuse it.

- [ ] **Step 4: Build (iOS)** — run the Global-Constraints build command; expect `** BUILD SUCCEEDED **`.

### Task 3: iOS — 3-dot Liquid-Glass menu on the job card

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Views/TasksView.swift` (`TaskCardV1` 889; date+chevron 1044-1054; wrap sites 35-38, 223-228, 504-507)
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Views/JobsHubView.swift` (owns `path`)

**Interfaces:**
- Consumes: `AppState.requestJobCompletion(jobId:)` (Task 2).
- Produces: `TaskCardV1` gains `onOpen: () -> Void` and `onRequestCompletion: () -> Void`; `TasksView` gains `onOpenJob: (Job) -> Void`.

- [ ] **Step 1: Thread a navigation closure from JobsHubView**
  In `JobsHubView.swift`, pass `onOpenJob: { job in path.append(job) }` into `TasksView(...)`. Add `let onOpenJob: (Job) -> Void` to `TasksView`.

- [ ] **Step 2: Replace the 3 `NavigationLink(value:)` wrap sites**
  At `35-38`, `223-228`, `504-507`, replace `NavigationLink(value: task.job){ TaskCardV1(task:task) }.buttonStyle(.plain)` with `TaskCardV1(task: task, onOpen: { onOpenJob(task.job) }, onRequestCompletion: { Task { await appState.requestJobCompletion(jobId: task.job.id) } })` and add a card-level tap (`.contentShape(Rectangle()).onTapGesture { onOpen() }`) so a body tap still opens detail (interior Start/Stop Buttons keep their own taps).

- [ ] **Step 3: Swap the date+chevron for the menu**
  In `TaskCardV1` (1044-1054), remove the `dateRange` Text + `chevron.right`; add:
  ```swift
  Menu {
      Button { onOpen() } label: { Label("Information", systemImage: "info.circle") }
      Divider()
      Button { onRequestCompletion() } label: { Label("Request Completion", systemImage: "checkmark.seal") }
  } label: {
      Image(systemName: "ellipsis")
          .font(.system(size: 16, weight: .bold))
          .foregroundStyle(Color(hex: T.muted))
          .padding(8)
          .glassEffect(.regular.interactive(), in: Circle())
          .contentShape(Circle())
  }
  .buttonStyle(.plain)
  ```

- [ ] **Step 4: Build (iOS)** — Global-Constraints build; expect success. Drive: tap ⋯ → Information opens detail; Request Completion posts to the "Completion Requests" thread.

### Task 4: iOS — admin request bubble (Approve/Deny) in the thread

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Views/MessagesView.swift` (message bubble rendering; time-off request bubble ~954 is the template)

**Interfaces:**
- Consumes: `AppState.approveJobCompletion(jobId:requestId:)`, `denyJobCompletion(...)` (Task 2); `Message.type == "finish_request"`, `Message.jobId`, `Message.finishRequestId`.

- [ ] **Step 1: Render a `finish_request` bubble**
  Where the thread renders each `Message`, add a branch for `message.type == "finish_request"`: a card showing the request text + the job (`appState.jobs.first(where: { $0.id == message.jobId })`), styled like the time-off request bubble.

- [ ] **Step 2: Admin Approve/Deny buttons**
  When `appState.currentPerson?.isAdmin == true`, show **Approve** (green) and **Deny** (red) calling `Task { await appState.approveJobCompletion(jobId: message.jobId ?? "", requestId: message.finishRequestId ?? "") }` / `denyJobCompletion(...)`. After resolution show an approved/denied state (derive from job status or a follow-up message).

- [ ] **Step 3: Build (iOS)** — Global-Constraints build; drive approve → job status Finished.

### Task 5: iOS — finished jobs disappear from the Jobs list

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Views/TasksView.swift` (`myTasks` 262-284 / `tasks(in:)` 332-338)

- [ ] **Step 1: Exclude finished jobs**
  In the task assembly, skip any task whose `task.job.status == .finished` (add `&& job.status != .finished` to the job loop that builds `myTasks`).

- [ ] **Step 2: Build (iOS)** — Global-Constraints build; drive: approving a completion request removes the card from the list.

---

## Phase 2 — Overdue lifecycle (web)

### Task 6: Web — never auto-finish; overdue stays visible

**Files:**
- Modify: `src/TRAQS.jsx` (time-period filter ~4532)

- [ ] **Step 1: Drop the date clause from `isFinished`**
  At ~4532 change `const isFinished = t.status === "Finished" || (t.end && t.end < TD);` → `const isFinished = t.status === "Finished";`. Now a past-end unfinished job classifies as current (not finished) and isn't hidden by the finished-period toggle.

- [ ] **Step 2: Confirm Overdue treatment**
  Verify such jobs render with existing overdue styling (`getHealth` critical ~388, overdue group ~11667, OVERDUE badge ~8141). No new code expected; if the schedule viewport still hides them, ensure the viewport includes overdue (end < today, not finished) jobs.

- [ ] **Step 3: esbuild check + drive** — the esbuild command from Task 1; then confirm a past-due unfinished job stays on the Jobs page + schedule labeled Overdue and only leaves when Finished.

### Task 7: Web — gantt bar extends to today (derived)

**Files:**
- Modify: `src/TRAQS.jsx` (gantt bar geometry ~9144-9166, ~9573, ~9903)

- [ ] **Step 1: Derived effective end**
  Where a bar's end date drives its width/position, compute `const effEnd = (t.status !== "Finished" && t.end < TD) ? TD : t.end;` and use `effEnd` for rendering ONLY (never write it back). The bar now extends to today for overdue jobs.

- [ ] **Step 2: esbuild check + drive** — overdue bars visibly extend to today; stored `end` unchanged (verify via job edit still shows original end).

### Task 8: Web — derived downstream push-back

**Files:**
- Modify: `src/TRAQS.jsx` (per-person gantt layout, same region as Task 7)

- [ ] **Step 1: Compute per-person overrun and shift downstream (render-time)**
  For each person, order their bars by start; track cumulative overrun = sum of `max(0, effEnd - end)` from earlier overdue bars; render later bars offset right by the accumulated overrun (business-day aware), without mutating stored dates. Keep the computation isolated to the render pass.

- [ ] **Step 2: esbuild check + drive** — confirm downstream bars visually shift when an earlier job is overdue, and that saved dates are untouched. Iterate if layout looks off (this is the highest-risk step).

---

## Self-Review

- **Spec coverage:** A (Task 3), B (Tasks 1,2,4), C (Task 5), E (Task 1), D1 (Task 6), D2 (Tasks 7,8). All spec sections mapped.
- **Placeholders:** Swift `Message`/`updateJob` initializers are marked "match exact signature" because they must be read at implementation time; all other steps carry concrete code/anchors.
- **Type consistency:** `finishRequestId` (iOS Message) matches web's `finishRequestId`; `requestJobCompletion`/`approveJobCompletion`/`denyJobCompletion` names consistent across Tasks 2/3/4; `onOpen`/`onRequestCompletion`/`onOpenJob` consistent across Task 3.
