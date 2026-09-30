# PERMISSIONS_AUDIT — client gates vs server gates (root cause 4)

Read-only audit, 2026-09-30, against `master` at 66c3843. Line numbers: `J:` = src/TRAQS.jsx.

Legend:
- **LOOSER** — the client allows it, the server refuses or silently drops it.
- **STRICTER** — the server allows more than the client.
- **Right:** which side is correct, and why.

Primitives agree on every platform. Web `can()` (J:5217), iOS/Mac `Person.can` (Models.swift:882) and server `can()` (`_utils/can.js:52`) are all `isAdmin && (adminPerms == null || adminPerms[key] === true)`, with approveCompletions and approveTimeOff granted when absent. One edge: iOS treats a non-object `adminPerms` as unrestricted (Models.swift:919), while the server treats it as restricted. The mismatches are in which key each ACTION asks for, and in which fields each action writes.

Verified by executing the real handlers (not just read):
- A worker autosave's POST /clients returns 403 (clients.js checks before any no-op test).
- A worker's POST /people without a colleague returns 200, and the colleague is removed.
- A stored node without `attachments`/`deps`/`notes` counts as an editJobs change when a client saves it back as `[]`/`""`.

---

## A. Side effects demanding a permission the action doesn't need

Server rule: any changed field that has no carve-out → editJobs.

- **moveLog** — written by every move.
  - Week-view drag (`buildGroupMove` J:9700/9707).
  - Resize (J:19177, **#42**).
  - `applyPushes` (J:9855, **#43**).
  - Gantt drag/resize (J:12738/12753/12764).
  - Approve/decline placement (`finishedOpFields`, `revertSession`).
  - A moveJobs-only admin gets a 403 on all of them.
- **Finish resolution fields** — status, pendingFinish, pendingSession, finishedAt, actualHours, planned*, plus the placement's start/end/hours.
  - Chat Approve (`adminApproveJobFinish`, J:11709, **#169/#170**).
  - Hours → Admin Approve (`approveFinish` J:21713).
  - Decline (J:21731, J:11763).
  - Undo approval (J:11813).
  - iOS approve/deny/undo (MessagesView.swift:2358/2361/2377).
  - An approver with approveCompletions but not editJobs/moveJobs gets a 403.
- **pendingFinish on raise** — iOS/Mac task-level Request Completion writes `pendingFinish = true` (CompletionRequestRules.swift:195–205).
  - Every worker's request gets a 403 and is rolled back.
  - The chat message still goes out (AppState.swift:1480).
- **apprChain** — signing a chain step writes `apprChain` (J:12068, AppState+Approval.swift:97).
  - It falls through to editJobs, so a canApprove non-admin can't sign.
- **attachments** — the worker's end-of-job panel photo (J:33709 from 22711; iOS attachPanelPhoto AppState.swift:3029).
  - Needs editJobs. The photo reaches S3, but the link to it is rolled back.
- **Absent vs empty** — iOS `Panel.encode` always writes attachments/hpd/notes/deps/team (Models.swift:318–323).
  - Stored nodes that lack those keys read as editJobs/moveJobs edits on every restricted user's save.

## B. Wrong key at the client (LOOSER)

Web — tasks:
- Bulk Schedule delete: `isAdmin`, needs editJobs (J:16979, **#164**).
  - It also skips the active-clock check.
- Bulk Jobs delete: no gate, needs editJobs (J:14003/14104).
- Jobs List inline cells: no gates (J:14465–14852).
  - Needs editJobs, or moveJobs for dates.
- Job-detail custom fields and photo add: no gate, needs editJobs (J:28361–28391).
- Dependencies toggle/editor: no gate, needs editJobs (J:34010/34042).
- Gantt Day-view drag/resize: no gate, needs moveJobs (J:13070–13078).
- Project Plan "Assign": gated on editJobs, needs reassign (J:26116).
- Drop in Schedule: gated on moveJobs, also needs reassign (J:32096).
- Pending tray drop: effectively editJobs, needs editJobs+moveJobs+reassign (J:10714).
- Edit Job / Reschedule wizard: gated on editJobs.
  - Changing dates needs moveJobs; changing the team needs reassign (J:11245).
- Week/Gantt drag onto another row: Gantt checks no reassign (J:12869).
  - A worked-split on drag also needs editJobs.
- Engineering sign-off: client uses canApprove.
  - Server needs admin||isEngineer, so a canSignOff-only user gets a 403 (J:12009).
- Hours → Admin Approve/Decline: gated on isAdmin, should be approveCompletions (J:23198/23829).
- Undo approval: button gate approveCompletions, function gate isAdmin (J:25179 vs J:11813).
- Undo/Redo: undoHistory only.
  - The server judges the restored diff. This is inherent; accept the 403.

Web — people, clients, settings:
- **Autosave POSTs /clients on every save** (J:8574).
  - Needs manageClients, so every worker and restricted admin gets a 403.
  - Since root cause 2 that means a false "saveClients failed" banner and a rollback. No data is lost.
- Employees card right-click Edit/Delete: no gate (J:20639→20341/20389).
  - Edit is silently dropped.
  - **Delete succeeds for any member** — see D.
- "+ Add Member": gated on isAdmin (mobile: editJobs), needs manageTeam (J:17120, J:24350, **#168**).
  - The new person is dropped silently.
- Person modal (cap, department, timeOff): gated on isAdmin/editJobs, needs manageTeam (J:10544).
  - The request record and `person.timeOff` drift apart.
- PTO bar drag/resize: gated on moveJobs, needs manageTeam (J:18152/19012, **#147**).
  - The PTO menu already uses manageTeam.
- User Permissions modal (role, adminPerms, canSignOff, PIN): gated on isAdmin, needs manageTeam (J:24610, 33112–33195).
  - A role change gets a 403. The rest is silently dropped, yet "PIN saved" still shows.
- Settings → Permissions / Time Clock team rows: gated on orgSettings, needs manageTeam (J:30298, 28637).
- Time Clock Settings modal: gated on isAdmin (J:23072).
  - Needs orgSettings for settings and manageTeam for people.
  - A settings 403 only reaches `console.warn`.
- Mobile Settings (Scheduling, Departments, Sign Off): no gate, needs orgSettings (J:24583–24602).
- Mobile client add/edit: gated on editJobs, needs manageClients (J:24310/24334).
- FAST TRAQS import of people/clients: gated on editJobs, needs manageTeam/manageClients (J:30310).
- Time-off Approve/Deny buttons: gated on isAdmin, needs approveTimeOff (J:25258).
  - The handler silently does nothing.
- Time-off bell: gated on isAdmin, should be approveTimeOff (J:12272).
- Mobile org-code panel: gated on isAdmin, but the endpoint is disabled with a 503 (J:24626).
- Panel photo "+ Add": no gate (J:28392/33751).
  - The server needs isAdmin or a recent clock-out.
- Finish-request "no approvers" fallback: `userRole === "admin"` (J:11679, **#176** remainder).
  - The audience itself already matches the server.

iOS / Mac:
- **Mac Jobs grid — every cell, New Job, Delete, dependency toggle: no `can()` anywhere in JobsPage.**
  - Needs editJobs, or moveJobs for dates.
- iOS JobEditView: gated on editJobs, but date pickers are always live, so a date change needs moveJobs.
- iOS/Mac Edit Steps / Remove chain: isAdmin, needs editJobs.
- iOS Undo completion: method guard is isAdmin only (AppState.swift:1587).
- iOS time-off approve from Messages: gated on **approveCompletions**, needs approveTimeOff (MessagesView.swift:2161).
- iOS TimeOffView approve: isAdmin, needs approveTimeOff (TimeOffView.swift:140).

## C. STRICTER — the server allows more

- Complete Now (`adminFinishItem` J:11879): client needs editJobs+approveCompletions, server needs editJobs only.
  - The status popover also sets Finished on isAdmin (J:31818).
- unclosedAt stamp (J:7338, **#191**): client needs self or manageTeam, server needs self or isAdmin.
- Add worked hours: client needs editJobs, server `adminJobHours` needs isAdmin only.
  - **#171** is not a real mismatch, since editJobs implies admin. The server is simply loose.
- Group edit/delete, Clear chat: client needs editJobs, server needs membership only.
- Add/remove engineering block: client isAdmin, server admin||isEngineer.

## D. Server holes found by the audit (not client mismatches)

- **POST /people tombstones any person missing from the array, whoever calls** (people.js:215–216).
  - Any member can delete a colleague.
  - Verified by execution.
- POST /clients refuses an unchanged array for non-manageClients callers.
  - /tasks already treats a no-op as allowed; clients.js doesn't.
- The timeclock admin actions, confirmTimesheet and adminJobHours check bare isAdmin.
  - No granular key exists, so a restricted admin keeps full timeclock power.
- timeoff.js edit/cancel check isAdmin, not approveTimeOff/manageTeam (timeoff.js:316/325).

## E. MATCH (abridged)

- **Web:**
  - Project Plan cells.
  - New job, add task/phase, single delete.
  - Template sign-off.
  - Request Completion.
  - Attachment delete.
  - Worker clock actions.
  - Clients page.
  - Add Employee / Invite.
  - Crew time-off.
  - Org name/domain, billing.
  - Timeclock admin tabs.
  - Engineering notify.
- **iOS:**
  - Reschedule (writes start/end only, no moveLog).
  - assignTeam.
  - Engineering sign-off.
  - Delete job.
  - Add job, status cycle.
  - Job-level request.
  - Clients.
  - Org settings.
  - PersonEditView.
  - Self actions.
- **Status of named defects:**
  - #171 is not a mismatch.
  - #172 was fixed in root cause 2.
  - #176 is fixed except the J:11679 fallback.

## F. Dead or unverified

- **Dead:**
  - `copyItem`/paste.
  - The reschedule modal (no opener).
  - `toggleLock`.
  - `orgSettingsModalOpen`.
  - iOS TeamView toggles (no view shows TeamView).
- **Unverified:**
  - Whether `reflowJob` writes non-date fields.
  - Custom column options.
  - The groups POST gate for the job-level iOS request.
  - How many live nodes lack attachments/deps/notes.
