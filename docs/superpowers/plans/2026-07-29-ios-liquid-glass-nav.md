# iOS Liquid Glass Bottom Nav + Home Header Controls — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This is a SwiftUI UI
> change with no unit-test harness, so each task verifies by **compiling clean** (not a TDD cycle).
> **NO commits, NO pushes** — testing only (user rule overrides the skill's commit steps).

**Goal:** Replace the side drawer with a native Liquid Glass bottom `TabView`, and move
profile/settings/admin controls into the Home header's top-right; put the `traqs=` logo top-left on
every page.

**Architecture:** `MainTabView` becomes a `TabView(selection: $appNav.selected)` wrapped in a `ZStack`
that keeps the sync-status dot, clock overlay, and Time Off cover. The drawer and hamburger are
deleted. `TRAQSNavHeader` always shows a new `TRAQSHeaderLogo` in its leading slot; Home supplies a
new `HomeHeaderControls` (Admin · Settings-glass-dropdown · Profile-avatar) as its trailing slot.

**Tech Stack:** SwiftUI, iOS 26, native Liquid Glass (`TabView`, `glassEffect`).

## Global Constraints

- iOS deployment target 26.0 — native Liquid Glass APIs available.
- No commits, no pushes at any point.
- User runs the simulator; assistant only confirms the app **compiles**.
- Verify command (compile-check):
  `xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO`
  run from `/Users/treysenparkinson/traqs/TRAQS Scheduling`.
- All file paths below are under `/Users/treysenparkinson/traqs/TRAQS Scheduling/TRAQS Scheduling/`.

---

### Task 1: `TRAQSHeaderLogo` + logo-on-every-page header

**Files:**
- Modify: `Views/SharedComponents.swift` (`TRAQSNavHeader` leading slot; add `TRAQSHeaderLogo`)

**Interfaces:**
- Produces: `struct TRAQSHeaderLogo: View` — the `traqs=` lockup (`TRAQSWordmark(size: 30)` +
  `TRAQSBarsMark` trailing "=" mark), theme-accent aware.
- Changes: `TRAQSNavHeader` leading slot always renders `TRAQSHeaderLogo` (drop `showLogo` + the
  `TRAQSMenuButton`).

- [ ] Step 1: Add `TRAQSHeaderLogo` (extract the wordmark+bars lockup from the old drawer header).
- [ ] Step 2: Replace `TRAQSNavHeader`'s leading `HStack { TRAQSMenuButton(); if showLogo {...} }`
  with `TRAQSHeaderLogo()`. Keep `showLogo` as an ignored back-compat parameter to avoid churn at
  call sites, or remove it and fix call sites.
- [ ] Step 3: Compile-check.

---

### Task 2: `MainTabView` → native Liquid Glass `TabView`

**Files:**
- Modify: `Views/MainTabView.swift`
- Modify: `Services/AppNav.swift` (remove `isMenuOpen`)

**Interfaces:**
- Consumes: `appNav.selected: TTab`, `appState.totalUnreadMessages`, `appState.clockActionLabel`,
  `appNav.openTimeOffPage`, `themeSettings.isLightTheme`.
- Produces: a `TabView(selection: $appNav.selected)` with 5 tabs (Home, Jobs, Time Clock, Stats,
  Messages) each tagged by its `TTab` case; Messages `.badge(appState.totalUnreadMessages)`.

- [ ] Step 1: Rewrite `MainTabView.body` as a `ZStack` containing a `TabView(selection:)` with the 5
  tabs (always all 5 — drop the salary filter). Preserve: `SyncStatusDot` overlay, clock
  `TRAQSLoadingOverlay`, Time Off `fullScreenCover` + `onChange(of: appNav.openTimeOffPage)`,
  `.preferredColorScheme(...)`.
- [ ] Step 2: Delete drawer machinery: `SideMenu`, `SideMenuRow`, `ProfileFooter`, `TRAQSMenuButton`,
  `drawerWidth`/`edgeGrabZone`, `drawerX`/`progress`/`dragOffset`/`isDragging`, the `DragGesture`,
  `closeMenu()`, and the `showSettings`/`showAdmin` state (settings/admin now live on Home).
- [ ] Step 3: Remove `isMenuOpen` from `AppNav`.
- [ ] Step 4: Keep `PulsingDot` only if still referenced; otherwise remove. Remove the hamburger's
  missed-notification dot usage.
- [ ] Step 5: Compile-check.

---

### Task 3: `HomeHeaderControls` (Admin · Settings dropdown · Profile)

**Files:**
- Create: `Views/HomeHeaderControls.swift`
- Modify: `Views/HomeView.swift` (pass `HomeHeaderControls()` as the header trailing slot)

**Interfaces:**
- Consumes: `appState.isAdmin`, `appState.currentPerson`, `AuthManager.logout()`, `ThemeSettings`.
- Produces:
  - `struct HomeHeaderControls: View` — trailing HStack: `AdminHeaderButton?` · `SettingsGlassMenu` ·
    `ProfileAvatarButton`.
  - `SettingsGlassMenu` — gear button toggling a glass dropdown: **Customization** (→ `CustomizeView`
    sheet) + divider + **Log out** (red → `auth.logout()`), spring open/close.
  - `ProfileAvatarButton` — magenta avatar; presents `EditProfileView`.
  - `AdminHeaderButton` — presents `AdminView` `fullScreenCover`; only when `appState.isAdmin`.

- [ ] Step 1: Create `HomeHeaderControls.swift` with the three sub-views above (reuse avatar rendering
  from the old `TRAQSProfileButton`; glass background via `glassEffect`).
- [ ] Step 2: In `HomeView`, set the `TRAQSNavHeader` trailing slot to `HomeHeaderControls()`.
- [ ] Step 3: Compile-check.

---

### Task 4: Fold "About" footer into `EditProfileView`; retire `SettingsView`/`ProfileSheet`

**Files:**
- Modify: `Views/SettingsView.swift` (`EditProfileView` gets the About footer; delete `SettingsView`)
- Modify: `Views/SharedComponents.swift` (delete `TRAQSProfileButton` + `ProfileSheet`)

**Interfaces:**
- Consumes: `appState.orgName`, `appState.currentPerson?.role`, bundle version/build strings.
- Produces: `EditProfileView` with a bottom About block (Organization, Role, `About TRAQS vX (build)`).

- [ ] Step 1: Append the About footer to `EditProfileView` (move `appVersionString`/`appBuildString`
  helpers if they were on `SettingsView`).
- [ ] Step 2: Delete `SettingsView` struct and its private helper structs that nothing else uses
  (keep any shared by `EditProfileView`).
- [ ] Step 3: Delete `TRAQSProfileButton` + `ProfileSheet` from `SharedComponents.swift`.
- [ ] Step 4: Grep for any remaining references to `SettingsView`/`TRAQSProfileButton`/`ProfileSheet`
  and fix.
- [ ] Step 5: Compile-check (full build).

---

## Self-Review

- **Spec coverage:** Nav bar (T2), tab order/all-5 (T2), logo every page (T1), Home controls order
  Admin·Settings·Profile (T3), settings dropdown Customization+Logout (T3), profile→EditProfile (T3),
  admin→AdminView (T3), About footer into profile (T4), retire SettingsView/ProfileSheet/drawer (T2,
  T4), drop pulsing dot (T2). All covered.
- **Placeholders:** none — each step names exact files/actions.
- **Type consistency:** `TRAQSHeaderLogo`, `HomeHeaderControls`, `SettingsGlassMenu`,
  `ProfileAvatarButton`, `AdminHeaderButton` referenced consistently across tasks.
