# macOS: the native app's foundation

Date: 2026-08-28
Scope: `TRAQS MacBook Native/` only. No iOS, web, or Netlify-function changes.

First pass of the native Mac build started in `002c96d`. That commit landed the shell;
this one lands the plumbing every screen needs. No screens.

## Problem

`002c96d` built the sidebar — rail, both nav layers, the morphing active pill, verbatim
web icons — and stopped there. What it did not build is anything a screen would stand on:

1. **`NativeShell.page` is a placeholder.** It renders the selected view's label centred
   in the content area. All ten nav entries render the same thing.
2. **Nothing reads `AppState`.** `NativeShell` takes `personName = "Treysen Parkinson"`,
   `orgName = "MATRIX SYSTEMS"`, `isAdmin = true`, `canSeeApprovals = true` as hardcoded
   defaults. The profile block, the org label, and the two gated nav rows are all fiction.
3. **There is no sign-in.** The Mac target compiles the iOS app's `Models/` and
   `Services/` but *not* `Views/`, so there is no `WelcomeView` to reuse. The web view
   handles auth today by being a browser; the native UI has no gate at all and would come
   up signed out with an empty `AppState`.
4. **There are no page-chrome conventions.** The first screen written would invent the
   page's padding, title size, and header row, and the second would invent them again
   slightly differently.
5. **"Identical to the web app" is unverifiable.** The stated method is that each ported
   screen is "checked against the deployed original side by side", but the Native-UI
   toolbar toggle *replaces the whole window*. Any comparison today is from memory.

## Goals

1. The native UI comes up signed in, showing the real person and the real org.
2. One implementation of the page — padding, title, header row — with every number copied
   out of `TRAQS.jsx` rather than chosen.
3. Theme and app data reach a screen without being threaded through it by hand.
4. "Identical to the Netlify site" becomes a standard that can actually be checked, not
   an aspiration.
5. Nothing built on speculation. Shared components arrive when a real screen asks.

## Non-goals

- **Any screen.** `NativeShell.page` still renders its placeholder when this lands. The
  Jobs port is the next pass and gets its own plan.
- **A component library.** Porting `Btn`/`Badge`/`Card`/`Modal`/`Field`/`Select` up front
  was considered and rejected: the web app's primitives are inline `style={{…}}` objects
  with no clean boundary to copy, so building them now means inventing ~15 component APIs
  against imagined needs. They get built when the Jobs screen names what it wants, so a
  real call site shapes each one.
- **A theme picker.** See "Known loose end" below.
- **Retiring the web view.** It stays until the last screen lands.

## The one sanctioned divergence

The Mac app is a visual copy of the web app. The only intended difference is that
**buttons are real Liquid Glass** where the web has a CSS imitation (`MacNativeSkin.css`),
plus the sidebar's active-pill morph, which already shipped.

The rule for every screen from here: **read the numbers out of `TRAQS.jsx` and paste
them.** A number in the Mac app that was not copied is a bug. `Theme.swift` already
states this for colour; this spec extends it to layout.

## Design

### 1. `MacWelcomeView` — the auth gate

`RootView` gains the iOS `RootView` state machine, in the same order. **Org first,
sign-in second** — it ran the other way on iOS once, which let a person be signed in
before the app knew which organization they were signing in to.

```
orgCode empty || !authenticated  →  MacWelcomeView
lookupInFlight                   →  linking spinner
matches.count > 1                →  org picker
else                             →  ParityView
```

Everything it needs already exists and is shared:

- `AuthManager` — already has the macOS presentation anchor
  (`Services/AuthManager.swift:282`, `NSApplication.shared.windows.first`).
- `APIService.lookupOrgByEmail(email:token:)` — the email→org auto-link.
- `appState.configure(auth:orgCode:)`, `appState.matchEmail`, `appState.loadAll()`.
- `AppState.orgCode` is Keychain-backed (`Services/AppState.swift:206`).

The returning-user fast path comes over too: when `orgCode` is already in the Keychain the
app comes up immediately and re-verifies membership in the background. That is what stops
a stale Keychain entry presenting as a blank profile with no jobs.

`matches.isEmpty` → the "no org for this email" message. Network failure on the lookup is
non-fatal: with an `orgCode` in hand the app keeps running.

### 2. `ThemeEnvironment` — theme by environment, not by parameter

`EnvironmentValues.tqTheme: TTheme`, injected once at the root. `NativeShell(theme:)` and
every prospective `Page(theme:)` parameter goes away.

This is a deliberate call against the current pattern. Passing `TTheme` down explicitly is
fine for one view and rots by the fourth: the Jobs screen alone is an engineering queue, a
list, a detail panel, and the cards inside each. An environment value costs nothing today
and removes a mechanical chore from every component written from here on.

Screens are written against **`TTheme`**, not the shared `T`. Both are compiled into this
target — `T` comes from `Services/TRAQSTheme.swift` with the iOS app — but `TTheme` is the
web's `THEMES` ported verbatim, and copying the web is the rule. `T` stays as whatever the
shared `Services` need internally.

### 3. `NativeShell` reads real data

| today | becomes |
|---|---|
| `personName = "Treysen Parkinson"` | `appState.currentPerson?.name` |
| `orgName = "MATRIX SYSTEMS"` | `appState.orgName` (`AppState.swift:210`) |
| `isAdmin = true` | `appState.isAdmin` (`AppState.swift:2925`) |
| `canSeeApprovals = true` | `appState.canViewApprovalQueue` (`AppState.swift:1054`) |

The parameters are removed rather than defaulted, so a future caller cannot reintroduce
fiction. `initials(_:)` stays as-is and now receives a real name; the profile subtitle
("Admin" / "Crew") follows `appState.isAdmin`.

Before people load there is no name. The profile block shows the avatar circle with no
initials rather than a placeholder that swaps a beat later.

### 4. `TPage` — one implementation of the page

Owns the web app's `frostScroll` (`TRAQS.jsx:12791`) and `pageHeader` (`:12731`). Every
number copied:

| thing | value | source |
|---|---|---|
| scroll padding | `34 / 32 / 28` | `frostScroll` default `pad` |
| scrollbar | gutter stable | `frostScroll` |
| page background | transparent | `frostScroll` — the panel paints `bg`; an opaque page hides it |
| header min height | `50` | `pageHeader` — the header row's signature |
| header gap | `22` | `pageHeader` |
| header bottom margin | `18` | `pageHeader` |
| title | 44pt, weight 900, tracking `-0.07em`, line height 1.1 | `pageTitleStyle` (`:12711`) |
| back pill | `card` on `border`, pill radius, 13pt/700, pad `8·16·8·12`, 16pt chevron | `backBtn` (`:12762`) |
| field column cap | `1180` | `FIELD_COL_W` (`:12756`) — **fields only**; pages fill edge to edge |

One implementation on purpose, and the web app already paid for the lesson. Its own
comment above `pageHead` (`:12771`):

> One implementation on purpose: a second hand-rolled copy drifted by 0.8px because it
> omitted minHeight, and the title visibly jumped when you moved between pages.

`TPage` takes a title, an optional `right` cluster, and an optional back action, matching
`pageHeader(title, right, extra, back)`.

### 5. `ParityView` — the side-by-side harness

Replaces the two-state Native-UI toggle with three modes: **Native · Split · Web**. Split
renders `NativeShell` and `WebViewHost` beside each other in one window.

This is the change that makes goal 4 real. Comparing a copy to its original by flipping
between two full-window states is comparing against memory; putting them side by side
turns "identical" into something you can see. `SiteStore` already drives the web half and
needs no change.

Mode persists in `@AppStorage`, replacing `traqs.useNativeUI`.

## Known loose end: the theme source

`RootView` derives the Mac theme as `themeSettings.isLightTheme ? .frost : .midnight`.
That maps the iOS app's two presets onto two of the three ported themes, so **Obsidian is
unreachable** and the web's fuller palette cannot be selected at all.

Left alone in this pass — it does not block the Jobs port — but `ThemeEnvironment` carries
a `// TODO` naming the web's `THEMES` as the target so it is written down rather than
implied. Whether the Mac gets its own picker or follows a shared setting is a decision for
when a screen makes the answer obvious.

## Files touched

| file | change |
|---|---|
| `MacWelcomeView.swift` | NEW — org code, Auth0 sign-in, org picker, linking spinner |
| `TPage.swift` | NEW — page scroll + header chrome, copied numbers |
| `ThemeEnvironment.swift` | NEW — `EnvironmentValues.tqTheme`, theme source + TODO |
| `ParityView.swift` | NEW — Native / Split / Web |
| `TRAQSDesktopApp.swift` | EDIT — auth gate in `RootView`; `ParityView` replaces the toggle |
| `NativeShell.swift` | EDIT — hardcoded parameters removed, `AppState` reads, theme from environment |

## Verification

`Services` is shared with iOS, so the data layer's existing tests already cover it. This
pass adds no logic worth unit-testing — it is wiring plus layout constants — so:

1. Mac target builds clean.
2. iOS target still builds and its tests still pass (the shared files are untouched, but
   the guarantee is what matters).
3. Signed out, the app presents `MacWelcomeView`; signing in reaches the shell with the
   real name, org, and correctly gated Approvals/Admin rows.
4. Split mode shows both halves at once.

If any real math appears later it goes to `Services` as a caseless `enum` of `static`
functions with every dependency passed in, per the existing convention
(`HoursCalculator`, `StatsMath`, `SchedulePacker`).

## Next

The Jobs screen (`renderTasks`, `TRAQS.jsx:11316`) — engineering queue plus jobs
list/detail — taken all the way to done before any other screen starts.
