# TRAQS iOS — Work Context / Progress

_Last updated: 2026-06-16_

This is a personal progress note for the SwiftUI iOS app (`TRAQS Scheduling/`).
Pick back up from **"Where I left off"** below.

---

## ⏯️ Where I left off (2026-07-13, later) — messaging audit fixes

Full line-by-line audit of the messaging subsystem (client + server). Fixes:
- **Group threads now keyed by ID (web parity).** Web builds `group:<id>`; iOS
  built `group:<name>` → same group got two threadKeys → cross-platform group
  chats never converged. `createGroup` now returns the group so callers navigate
  `group:<id>`; all group READ paths (resolveTitle, ThreadDetailView.displayTitle,
  threadParticipants) resolve id OR name so legacy name-keyed threads still work.
- **Fractional-second timestamps** on optimistic sends + read marks via new
  `Date.nowISO()`/`Date.isoString()` (AppConfig.swift) — fixes out-of-order
  optimistic bubbles and consolidates ~ a dozen ad-hoc ISO8601DateFormatter()s.
- **Dropped isMyMessage name fallback** (same-name users mis-attributed).
- **Dead code removed:** `ThreadRow`, `AppState.sendMessage(_:)` (fire-forget),
  `String.shortTimestamp` (had the fractional-parse bug).
- Deferred: a `ThreadKey` value type (cosmetic, high-churn) and unreadCount
  counting own messages (minor). Builds clean (simulator). **Device-test group
  chat convergence web↔iOS.**

---

## ⏯️ Where I left off (2026-07-13) — messaging reliability fix

**Bug reported:** some chats / whole conversations don't load; two people can't
see their chat with each other. **Root cause (client-side):** the `/messages`
GET returns the viewer's FULL history (ACL-filtered, NOT time-filtered) but only
ever wrote the in-memory `messages` array — it never touched the SwiftData
cache. The cache is populated ONLY by `/sync` deltas, which ARE time-filtered
(`changedSince`). So any history predating the device's sync cursor — most
importantly a group/job thread's messages from **before the viewer was added** —
lived only in memory. The next `rehydrateFromCache()` (a race in `loadAll`, or
ANY later Ably "changed" event) overwrote `messages` from the delta-only cache
and silently dropped that history. A full resync only runs when there's no
cursor, so it never self-healed.

**Fix (all client-side; server 2000-msg cap left as-is — not the cause):**
- `APIService.fetchMessagesData()` — raw GET bytes.
- `LocalCache.reconcile(_:_:)` — upserts present rows AND evicts absent ones so
  the cache exactly mirrors an authoritative full list (empty-guarded).
- `SyncService.mergeFullMessages(_:)` — canonical parse (same `.sortedKeys` as
  deltas) → `reconcile`, so byte-compare no-op skipping still holds.
- `AppState.applyServerMessages(_:)` — both `loadAll` and `refreshMessages` now
  route the GET through this: assign in-memory AND fold into the cache. Cache is
  now the single COMPLETE source of truth; rehydrate is always correct.
- Reconcile fires on: Messages tab appear, thread open, pull-to-refresh,
  app-foreground `loadAll`. Builds clean (simulator, 2026-07-13). **Not yet
  device-tested** — verify a newly-added group member sees full history.

---

## ⏯️ Where I left off (2026-06-16, evening)

The **end-job panel photo** feature is **done, committed, builds clean, and now
TESTED GREEN ON DEVICE.** ✅ The whole flow worked on the real phone.

### The device-launch blocker (RESOLVED)
Earlier this session the on-device launch crashed before `main()` — a low-level
`libxpc`/`dyld` abort (`-[OS_dispatch_mach_msg _setContext:]: unrecognized
selector`). It was **environmental, not our code**: my **iPhone 17 Pro is on iOS
27.0** but Xcode lacked the iOS 27 **device-support** files.
- Now fixed: `~/Library/Developer/Xcode/iOS DeviceSupport/` has
  `iPhone18,1 27.0 (24A5355q)`. Toolchain is **Xcode 26.3 / iOS 26.2 SDK**, which
  builds + deploys to the iOS 27.0 device fine.
- If a future device-launch crashes pre-`main()` again, suspect missing
  DeviceSupport for the phone's OS, not the code.

### Next time I sit down
1. **Show panel attachments in iOS `JobDetailView`** (thumbnails + delete) for
   parity with the web app — NOT built yet on native. This is the main task.
   - Source of truth for the shape: `Panel.attachments` ([`PanelAttachment`] in
     `Models.swift`) — `key, filename, mimeType, size, uploadedById,
     uploadedByName, uploadedAt, opId`.
   - Web app does thumbnails + delete; mirror that. Upload path already exists
     (`AppState.attachPanelPhoto(...)`); will likely need a delete/remove path.

---

## 🎯 The feature: end-job panel photo

When a worker taps **STOP** on a job card (Jobs tab), an attachment step pops
up **before** the job ends. They photograph the finished panel; the photo
uploads and attaches to that panel, then the job clocks out.

### Flow
- Tap **STOP** on a `TaskCardV1` → faded, dimmed overlay fades in (not a full
  screen). Heading: _"Please take a picture of your panel before ending."_
- A square "+" attachment window → tap it → iOS action sheet:
  **Take Photo / Photo Album / Choose File**.
- **End Job** (enabled once a photo is attached) → uploads the photo, then
  clocks out.
- **Skip — end without photo** → clocks out, no photo (bypass; the plan is to
  make the photo **required later** by gating the End Job button on `hasPhoto`).
- **Tap outside the card** → cancels entirely (job keeps running).
- The card's blue STOP button shows **"STOPPING…"** while the clock-out runs.

### Auto-naming
`<PanelName>_<yyyy-MM-dd>.<ext>` (spaces → `_`), with `_2`, `_3` for same-day
repeats. Images are downscaled to JPEG (≤1600px, 0.82). Mirrors the web app.

### Key files
- `TRAQS Scheduling/Views/PanelPhotoSheet.swift` — `EndJobPhotoOverlay` (the
  dimmed/faded overlay), `CameraPicker` (UIKit camera bridge), `ImageDownscaler`,
  and `PanelPhotoTarget`.
- `TRAQS Scheduling/Views/TasksView.swift` — `TaskCardV1`: STOP opens the overlay
  via `endJobTarget`; the overlay calls back `onClose(clockOut:)` so the **card**
  dismisses (nils the item binding) and runs `jobClockOut()` on the app-level
  `appState`. (This decoupling fixed an earlier hang where the overlay stayed up
  during clock-out.)
- `TRAQS Scheduling/Services/AppState.swift` — `attachPanelPhoto(...)` uploads +
  stamps provenance + persists the job; `panelAttachmentCount(...)` for
  same-day filename dedup.
- `TRAQS Scheduling/Models/Models.swift` — `PanelAttachment` model +
  `Panel.attachments` (decodes/encodes; matches web `panel.attachments` shape:
  `key, filename, mimeType, size, uploadedById, uploadedByName, uploadedAt, opId`).
- `TRAQS-Scheduling-Info.plist` — `NSCameraUsageDescription` +
  `NSPhotoLibraryUsageDescription`.

### Notes / gotchas learned
- Presented as `.fullScreenCover` + `.presentationBackground(.clear)` so it
  fades in over the jobs list instead of being a whole new screen. Avoids the
  "two `.sheet` on one view" SwiftUI conflict (the card already has a LOG TIME
  sheet).
- If the photo **upload fails**, the job does **not** end — overlay stays open
  with an error so the worker can retry or skip.
- The prompt lives on the **Jobs tab End Job flow only** — NOT the Hours/
  pay-period clock (`TimeClockView`), which we explicitly reverted.

---

## 🔔 Notifications (same session — also done)

- `step`/`ready` push notifications now name the approver (e.g. "Trey approved
  Verified on …") instead of "Someone" — added `approvedByName` to
  `NotifyPayload` (`Models.swift`, `AppState.swift`).
- **Notification tap deep-linking** (`AppNav.swift`, `TRAQS_SchedulingApp.swift`,
  `TasksView.swift`, `MessagesView.swift`): event pushes (new_job/assigned/
  step/ready, carry `jobNumber`) open the job detail; message pushes (chat +
  finish-request, carry `threadKey`) open the conversation. Registered via a
  OneSignal v5 click listener (`PushClickHandler`).
- Native push is **OneSignal** (SPM 5.4.2); server targets by `external_user_id`
  = person id and only people with a `pushToken` in `people.json`. iOS writes
  the OneSignal subscription id back as `pushToken` on login.

---

## ✅ Testing checklist (on device) — PASSED 2026-06-16
1. Jobs tab → start a job (LOG TIME), then tap **STOP**.
2. Overlay fades in with the "+" square + heading.
3. Tap square → **Take Photo** (camera permission prompt first time) / **Photo
   Album** / **Choose File**.
4. **End Job** → uploads, overlay closes, card shows **STOPPING…**, job ends.
5. **Skip** → job ends with no photo. **Tap outside** → job keeps running.
6. Confirm the photo shows on the **web app**'s panel Attachments.

## Commits (this session, on `master`)
- `6708e0a` add photo library usage string for panel photo picker
- `3b23a4f` end-job panel photo capture
- `ca71506` bump version to 1.0.19 (build 17)
- `63e7277` name approver in step/ready pushes + deep-link notification taps
