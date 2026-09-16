# iOS Liquid Glass Bottom Nav + Home Header Controls — Design

**Date:** 2026-07-29
**Status:** Approved (testing only — DO NOT commit or push)
**App:** TRAQS Scheduling (native SwiftUI, iOS 26)

## Goal

Replace the swipeable left side drawer with a **native Liquid Glass bottom tab bar** as the app's
primary navigation, and move the account controls (profile, settings, admin) into the **Home
header's top-right corner**. Put the `traqs=` logo lockup in the **top-left of every page's header**
and remove the hamburger/drawer entirely.

This is an experimental branch of work for testing. No commits, no pushes.

## Decisions (locked)

- **Nav bar:** native SwiftUI `TabView` — iOS 26 renders its tab bar as Liquid Glass automatically.
- **Tab order (all 5, everyone):** Home · Jobs · Time Clock · Stats · Messages. Salary filter dropped.
- **Home top-right order (left→right):** Admin · Settings · Profile avatar. Admin only when `appState.isAdmin`.
- **Settings gear:** opens a Liquid Glass **dropdown** (Customization + divider + Log out).
  - Customization → dismiss dropdown, present existing `CustomizeView` sheet.
  - Log out (red) → `auth.logout()`.
- **Profile avatar:** presents existing `EditProfileView` (name / email / phone / photo). The retired
  `SettingsView`'s account footer (Organization, Role, "About TRAQS vX (build)") folds into the
  bottom of `EditProfileView`.
- **Admin:** presents existing `AdminView` full-screen cover.
- **Logo:** `traqs=` lockup (`TRAQSWordmark` + accent `TRAQSBarsMark`) in the top-left of every page.
- **Pulsing missed-notification dot** (was on the hamburger): dropped. Messages tab keeps its numeric
  unread badge.

## Components

### MainTabView (rewrite)
From a `ZStack` drawer + `switch appNav.selected` content-swap → a `TabView(selection: $appNav.selected)`.

- Each `TTab` case becomes a `Tab`/`.tabItem` with label + `TIcon` glyph.
- Messages tab: `.badge(appState.totalUnreadMessages)`.
- Preserved at the container level (wrap the `TabView` in a `ZStack`):
  - `SyncStatusDot` overlay.
  - Global clock-in/out `TRAQSLoadingOverlay` (`appState.clockActionLabel`).
  - Time Off presentation via `appNav.openTimeOffPage` `onChange` + `fullScreenCover`.
  - `.preferredColorScheme(themeSettings.isLightTheme ? .light : .dark)`.

### Removed
- `SideMenu`, `SideMenuRow`, `ProfileFooter` (drawer-only).
- `TRAQSMenuButton`, drawer drag gesture, `drawerX`/`progress`/`dragOffset`/`isDragging`,
  `drawerWidth`/`edgeGrabZone`.
- `AppNav.isMenuOpen` (now unused).
- Pulsing dot usage on the (removed) hamburger. `PulsingDot` may stay defined if referenced elsewhere;
  otherwise remove.
- `TRAQSProfileButton` + `ProfileSheet` in `SharedComponents` (superseded by the Home avatar button).
- `SettingsView` (retired; reachable pieces `EditProfileView` / `CustomizeView` reached directly).

### TRAQSHeaderLogo (new)
The `traqs=` lockup extracted from the old drawer header (`TRAQSWordmark(size:)` + `TRAQSBarsMark`
nudged in as a trailing "=" mark). Placed in `TRAQSNavHeader`'s leading slot on every page.

### TRAQSNavHeader (change)
- Leading slot always shows `TRAQSHeaderLogo` (retire the `showLogo` flag and the `TRAQSMenuButton`).
- Trailing slot unchanged — each page passes its own controls.

### HomeHeaderControls (new — Home's trailing slot)
`Admin?` · `Settings gear` · `Profile avatar`, in that order.

- **SettingsGlassDropdown (new):** a gear button that toggles a small glass popover anchored beneath it,
  animating open with a spring (scale + opacity). Rows: **Customization**, hairline divider,
  **Log out** (red). Background uses `glassEffect`. Tapping outside dismisses.
- **Profile avatar button:** reuses avatar rendering from the old `TRAQSProfileButton`; presents
  `EditProfileView`.
- **Admin button:** presents `AdminView` (gated on `appState.isAdmin`).

### EditProfileView (extend)
Append an "About" footer: Organization name, Role, and `About TRAQS vX (build)` — the info salvaged
from the retired `SettingsView`.

## Data flow / risks

- **Selection binding:** `appNav.selected` (`TTab: Int, Hashable`) is the `TabView` selection + each
  tab's tag. Existing deep-link routing (`handleNotification`) sets `appNav.selected` / `jobsMode` and
  continues to work — the `TabView` reacts to the binding.
- **Sub-page detail views** (job detail, etc.): standard `TabView` behavior; pushed views can hide the
  bar. No change needed for approval.
- **Theme accent** on the bars mark tracks `ThemeSettings` (native draw), unchanged.

## Testing

Manual, on the iOS simulator/build (user runs the simulator; assistant only confirms it compiles):
1. Bottom Liquid Glass bar shows 5 tabs in order; tapping switches pages; Messages badge shows unread.
2. Deep-link push still lands on the right tab.
3. Home top-right: Admin (admins only) → AdminView; gear → glass dropdown → Customization opens
   CustomizeView, Log out signs out; avatar → EditProfileView with the About footer.
4. Logo lockup shows top-left on every page; no hamburger, no drawer, no edge-swipe drawer.
5. Clock-in/out overlay and sync-status dot still appear.

## Out of scope

Web app, Android. No behavior change to Jobs list/gantt toggle, Time Clock, Stats, Messages internals.
