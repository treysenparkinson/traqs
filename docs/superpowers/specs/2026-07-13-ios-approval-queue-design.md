# iOS Approval Queue — Design Spec

_Date: 2026-07-13 · Target: `TRAQS Scheduling/` (SwiftUI iOS app)_

## Goal

Add an **Approval Queue** to the iOS app so approvers can review and sign off
panel engineering chains from their phone, at parity with the desktop web app's
approval queue. It replaces the job-creation button on the Jobs page, is gated
to users with the approver setting, groups pending items by step, is searchable,
updates immediately, and is reachable from notifications.

## Scope decisions (locked)

- **Job creation on iOS is dropped.** The top-right `+` (create job) is replaced
  by the Approval Queue entry point. `JobEditView` remains only for *editing*
  existing jobs (reached from `JobDetailView`). Creating jobs stays a desktop task.
- **Queue contents:** engineering **sign-off chains only** — panels with an
  engineering block that isn't fully signed off. Finish requests are OUT of scope
  (they remain as chat bubbles as today).
- **Sections:** grouped **by pending step** (Review / Approve / Release).
- **Notifications:** existing step/ready pushes **deep-link** to the queue for
  approvers, plus a live **count badge** on the entry button.

## Permission model

Mirror desktop `canSeeApprovalQueue = admin || canSignOff`.

- Add `canSignOff: Bool?` to `Models.Person` (decode key `canSignOff`,
  `decodeIfPresent`, default nil). This is the "approver enabled" setting the
  admin toggles on desktop (Permissions → "Approver").
- Add `AppState.canViewApprovalQueue: Bool` = `currentPerson?.isAdmin == true || currentPerson?.canSignOff == true`.
- Inline sign-off in `JobDetailView` is unchanged (engineers keep approving there).
  The queue itself is admin/approver only.

## Data model (already present — no changes)

- `Panel.engineering: Engineering?` — a panel "has an engineering block" iff this
  is non-nil.
- `Engineering { designed, verified, sentToPerforex: EngineeringSignOff? }` —
  three sequential steps. `EngStep` enum + `EngStep.label` supply the display
  labels (Review / Approve / Release).
- Sign-off order is sequential: `designed → verified → sentToPerforex`. A step is
  actionable only when the previous one is done.
- `AppState.signOff(jobId:panelId:step:personId:personName:)` and
  `revertSignOff(jobId:panelId:step:)` already exist, mutate `jobs` in memory
  optimistically, and persist via `updateJob` → `saveJobs` → Ably → delta-sync.

## Components

### 1. Entry point — `JobsHubView`
- Replace the admin-gated `+` `IconBtn` (which presented `JobEditView(job: nil)`)
  with a **checkmark** `IconBtn`, gated on `appState.canViewApprovalQueue`.
- Tapping presents `ApprovalQueueView` as a **full page via a navigation push**
  within the Jobs tab's existing `NavigationStack` (the same mechanism
  `JobDetailView` is shown with), so it gets a native back gesture. (If the Jobs
  page turns out not to own a `NavigationStack`, fall back to a `.sheet` with
  `.large` detent — decide at implementation time based on the existing structure.)
- The button carries a **count badge** = `appState.pendingApprovalCount`
  (hidden when 0).
- Remove the `JobEditView(job: nil)` creation path from `JobsHubView`. Leave
  `JobEditView` itself intact for editing.

### 2. `AppState` additions
- `var pendingApprovalCount: Int` (computed): number of panels across `jobs`
  where `engineering != nil` and the chain is incomplete (i.e. at least one of
  designed/verified/sentToPerforex is nil). Reactive — recomputes when `jobs`
  changes, so it stays live via delta-sync and after an optimistic sign-off.
- `var canViewApprovalQueue: Bool` (computed, see Permission model).
- A helper to enumerate queue items (may live on `AppState` or in the view):
  `approvalItems: [ApprovalItem]` where
  `ApprovalItem { job: Job, panel: Panel, pendingStep: EngStep }` and
  `pendingStep` = the first of `[designed, verified, sentToPerforex]` that is nil.
  Only panels with `engineering != nil` and an incomplete chain are included.

### 3. `ApprovalQueueView` (new file `Views/ApprovalQueueView.swift`)
- **Header:** `TRAQSNavHeader` + `PageTitle(title: orgSettings.approvalQueueLabel or "Approval Queue")`, matching `MessagesView`.
- **Search bar** at top (reuse `SearchBar`): filters items by job number, job
  title, panel title, and client name (case-insensitive).
- **Sections by pending step:** iterate `EngStep.allCases` in order; for each step
  render a `TSectionTitle` (step label + count) followed by the items whose
  `pendingStep == step`. Skip empty sections. Each panel appears in exactly one
  section (the step it's blocked on).
- **Row** (`frostedCard`): panel title, parent job (number + title), client name,
  completed-step chips (green check, per existing `EngStepButton` styling), the
  pending-step chip, and an **Approve** button that calls
  `appState.signOff(jobId:panelId:step:personId:personName:)` for `pendingStep`
  using `currentPerson`. Provide **Undo** on already-completed steps
  (`revertSignOff`). Tapping the row (outside the buttons) opens `JobDetailView`
  for the parent job.
- **Immediacy:** because `signOff` mutates `appState.jobs` optimistically and the
  view derives `approvalItems` from `appState.jobs` (`@Observable`), approving an
  item instantly re-buckets/removes it and updates the badge — no refetch.
- **Empty state:** "No approvals pending." (styled like `ChatEmptyState`).
- **UI/theme:** use the app's existing tokens — `AmbientBackground`,
  `frostedCard`, `TTypo`, `TSectionTitle`, `TagPill`, `T.eng`,
  `T.statusFinished`, `T.ink`/`T.muted` — so it matches the desktop colors and the
  rest of the app.

### 4. Notifications — `AppNav`
- Add a deep-link case `.approvals` to the pending-deep-link enum.
- In the push click handler (`registerPushHandlers`/`handleNotification`): for
  `type == "step"` or `type == "ready"` pushes, if the recipient
  `canViewApprovalQueue`, set the pending deep-link to `.approvals`; otherwise keep
  the current `jobNumber` → job-detail behavior.
- `JobsHubView` observes `appNav.pendingDeepLink`; on `.approvals` it presents
  `ApprovalQueueView` and clears the pending link (mirroring how `MessagesView`
  consumes `.thread`).

## Data flow

1. Server sign-off / eng change → publishes a `tasks` Ably change → delta-sync
   updates the cache → `rehydrateFromCache` updates `appState.jobs`.
2. `ApprovalQueueView` and the badge derive from `appState.jobs` → update live.
3. Approver taps **Approve** → `signOff` mutates `jobs` optimistically (instant UI)
   and persists via `updateJob` → `saveJobs`. The server publishes `tasks` +
   step/ready notifications. No post-mutation `loadAll` (Sprint 0 consistency).

## Error handling

- `signOff`/`revertSignOff` already persist through the debounced `persistJobs`,
  which has optimistic rollback (`rollbackSnapshot`) + error toast on save
  failure. The queue inherits this — no new error path.
- If `currentPerson` is nil (unresolved identity), the Approve button is disabled
  (can't attribute a sign-off), matching `EngStepButton`'s `currentPerson` guard.

## Out of scope (explicit)

- Finish-request approvals (stay in chat).
- Standalone/custom approval chains and multi-approver templates from desktop.
- Editing `orgSettings.approvalSteps` labels on iOS (read-only, as today).
- Creating jobs/panels/ops on iOS (unchanged; creation stays desktop-only).
- Adding a new push type — reuse existing step/ready pushes for deep-linking.

## Testing / verification

- Build clean on the simulator.
- Device/sim check: as an approver, the checkmark appears with a correct badge
  count; the queue lists panels grouped by pending step; search filters; Approve
  advances the panel to the next section and decrements the badge instantly;
  Undo reverts. As a non-approver, no checkmark button appears.
- Confirm a step/ready push opens the queue for an approver.
- Confirm job creation is no longer reachable and job *editing* still works.

## Files touched

- `Models/Models.swift` — add `Person.canSignOff`.
- `Services/AppState.swift` — `canViewApprovalQueue`, `pendingApprovalCount`,
  `approvalItems` helper.
- `Services/AppNav.swift` — `.approvals` deep-link + push routing.
- `Views/JobsHubView.swift` — replace `+` with the gated checkmark + badge;
  remove the create-job path; consume the `.approvals` deep link.
- `Views/ApprovalQueueView.swift` — new.
- (Possibly `Views/Icons.swift` if a checkmark/checklist icon isn't already there.)
