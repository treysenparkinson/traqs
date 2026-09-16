# Logo-Stagger Accent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iOS app an accent mode in which the app icon's four colours are distributed across the app one per tab, shipped as the default, with the bars mark and the splash wash drawing from the same palette.

**Architecture:** The accent stops being a stored hex and becomes a *resolved* value. `ThemeSettings.accent` keeps its meaning — the user's saved solid choice — and a new computed `activeAccent` is what feeds `applyAccentToT()`. In `.logoStagger` it resolves from the selected tab instead. Because only one accent is ever live, all 85 `T.accent*` read sites keep working untouched; the value moves under them. The one structural change is that `ThemeSettings` learns which tab is showing, pushed to it by `TabHost`.

**Tech Stack:** Swift 6 / SwiftUI, `@Observable`, `UserDefaults`, Swift Testing (`import Testing`, `@Test`, `#expect`).

**Spec:** `docs/superpowers/specs/2026-09-15-logo-stagger-accent-design.md` (commit `a830322`)

## Global Constraints

- **Scope is `TRAQS Scheduling` only.** No web-app changes, no `TRAQS MacBook Native` changes.
- **Never edit `project.pbxproj` to register a new Swift file.** The project is `objectVersion = 77` with `PBXFileSystemSynchronizedRootGroup`; files dropped into the target directory are picked up automatically. Editing it is wasted work and invites conflicts.
- **Tests are Swift Testing, not XCTest.** `import Testing`, `@Test func …`, `#expect(…)`. Module name for `@testable import` is `TRAQS_Scheduling` (underscore).
- **Pure logic lives in `Services/` as a caseless `enum` of `static` functions with every dependency passed in.** No `AppState`, no captured `Calendar`, no implicit `Date()`. Follow `HoursCalculator` / `StatsMath` / `SchedulePacker`. Test those; do not test Views.
- **Colours are hex `String`, not `Color`,** in `Services/` files, so they compile wherever the test target and the macOS target do. Same reason `JobPalette` is hex.
- **The user builds and runs the app themselves.** For view tasks, stop at `BUILD SUCCEEDED` and hand off. Do not boot, install, launch or screenshot the simulator. Do not re-run the unit-test suite after a view-only change.
- **Compile check (no simulator needed):**
  ```bash
  cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
  xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
    -destination 'generic/platform=iOS Simulator' -configuration Debug build
  ```
- **Unit tests (Tasks 1 and 2 only):**
  ```bash
  cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
  xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    -only-testing:"TRAQS SchedulingTests"
  ```
- **If the build dies inside a C dependency** (msgpack, xdelta, Ably) with `fatal error: module file '.../ExplicitPrecompiledModules/*.pcm' not found`, that is **not** your Swift change. Delete both `<DerivedData>/Build/Intermediates.noindex` and `<DerivedData>/Build/Products` and rebuild; keep `SourcePackages/`.
- **Exact palette values, copied verbatim — do not re-sample, re-derive or round:**
  `coral #FF826A` · `amber #F4B61E` · `sky #41C9FA` · `green #1E8D6F`

---

## File Structure

All paths relative to `/Users/treysenparkinson/traqs/TRAQS Scheduling/`.

**Created:**

| File | Responsibility |
|---|---|
| `TRAQS Scheduling/Services/LogoPalette.swift` | The four icon colours, their order, and which tab owns which. The single source of truth for brand colour. |
| `TRAQS Scheduling/Services/AccentMode.swift` | The `AccentMode` enum and `AccentResolver` — the pure rules for *which* accent is live and *which mode* a launch starts in. |
| `TRAQS SchedulingTests/LogoPaletteTests.swift` | Tests for the palette and the tab map. |
| `TRAQS SchedulingTests/AccentResolverTests.swift` | Tests for mode resolution and accent resolution. |

**Modified:**

| File | Change |
|---|---|
| `TRAQS Scheduling/Services/ThemeSettings.swift` | Holds `accentMode` / `activeTab`, exposes `activeAccent`, persists the mode, gains `setAccentMode` and `setActiveTab`. |
| `TRAQS Scheduling/Views/MainTabView.swift` | `TabHost` pushes `appNav.selected` into the theme. |
| `TRAQS Scheduling/Views/SharedComponents.swift` | `TRAQSBarsMark` draws four logo colours in stagger. |
| `TRAQS Scheduling/Views/LiquidBackground.swift` | `palette` override and the four-blob branch; wash follows `activeAccent`. |
| `TRAQS Scheduling/Views/SplashView.swift` | Passes the logo palette; mark contrast pinned to the theme. |
| `TRAQS Scheduling/Views/CustomizeView.swift` | The stagger swatch, mode-aware selection, 5-column grid. |
| 8 other view files | 19 `@Observable` registration reads retargeted to `activeAccent`. |

**Why `LogoPalette.accent(for:)` lives in Services, not beside the tab bar.** The spec placed the tab→colour map as a `TTab` extension in `MainTabView.swift`, following the convention in `NavigationTypes.swift` that colours live beside their view. That convention loses to the testing one here: an extension in `MainTabView.swift` would sit alongside `private` declarations and could not be reached from a test, and this map is exactly the kind of table that fails silently when wrong. It goes in `LogoPalette` with the colours it names.

---

### Task 1: The logo palette and the tab map

**Files:**
- Create: `TRAQS Scheduling/Services/LogoPalette.swift`
- Test: `TRAQS SchedulingTests/LogoPaletteTests.swift`

**Interfaces:**
- Consumes: `TTab` from `Services/NavigationTypes.swift` (existing).
- Produces: `LogoPalette.coral` / `.amber` / `.sky` / `.green` : `String`; `LogoPalette.ordered` : `[String]`; `LogoPalette.accent(for: TTab) -> String`.

- [ ] **Step 1: Write the failing test**

Create `TRAQS SchedulingTests/LogoPaletteTests.swift`:

```swift
import Testing
@testable import TRAQS_Scheduling

/// The app icon's four colours, and which tab owns which.
///
/// Under test because both halves fail silently. A wrong hex just looks
/// slightly off-brand next to the springboard icon; a wrong `ordered` puts the
/// bars mark in the wrong sequence, which reads as a different logo. Neither
/// throws, neither logs.
struct LogoPaletteTests {

    @Test func hexesMatchTheShippedIconAsset() {
        #expect(LogoPalette.coral == "#FF826A")
        #expect(LogoPalette.amber == "#F4B61E")
        #expect(LogoPalette.sky   == "#41C9FA")
        #expect(LogoPalette.green == "#1E8D6F")
    }

    /// `TRAQSBarsMark` indexes `ordered` positionally, so this order IS the
    /// logo's geometry — top bar first, full-width sky bar third.
    @Test func orderedRunsTopToBottomAsTheIconDrawsThem() {
        #expect(LogoPalette.ordered == ["#FF826A", "#F4B61E", "#41C9FA", "#1E8D6F"])
        #expect(LogoPalette.ordered.count == 4)
        #expect(LogoPalette.ordered[2] == LogoPalette.sky)
    }

    @Test func homeTakesTheHeroColour() {
        #expect(LogoPalette.accent(for: .home) == LogoPalette.sky)
    }

    @Test func everyTabResolvesToALogoColour() {
        for tab in TTab.allCases {
            #expect(LogoPalette.ordered.contains(LogoPalette.accent(for: tab)))
        }
    }

    /// Five tabs, four colours: coral is the one that repeats, and it must land
    /// on the two tabs at OPPOSITE ends of `tabBarOrder` so they never touch.
    @Test func coralRepeatsOnlyOnTheOuterTabs() {
        #expect(LogoPalette.accent(for: .jobs)  == LogoPalette.coral)
        #expect(LogoPalette.accent(for: .stats) == LogoPalette.coral)

        let all = TTab.allCases.map { LogoPalette.accent(for: $0) }
        #expect(all.filter { $0 == LogoPalette.coral }.count == 2)
        #expect(Set(all).count == 4)
    }

    @Test func theMiddleThreeAreDistinct() {
        #expect(LogoPalette.accent(for: .hours) == LogoPalette.amber)
        #expect(LogoPalette.accent(for: .chat)  == LogoPalette.green)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests/LogoPaletteTests"
```

Expected: FAIL to compile — `cannot find 'LogoPalette' in scope`.

- [ ] **Step 3: Write the implementation**

Create `TRAQS Scheduling/Services/LogoPalette.swift`:

```swift
import Foundation

// MARK: - The app icon's palette
//
// Sampled from the centre pixel of each bar in the shipped asset
// (`AppIcon.icon/Assets/traqs-bars-candy-v2.png`, sRGB), which landed in
// commit 241d2f7. The icon and the app are meant to be the same four colours;
// this is where that is written down once so the two cannot drift.
//
// Hex rather than Color, Foundation rather than SwiftUI, for the reason
// JobPalette gives: this has to compile wherever the test target does.

enum LogoPalette {

    static let coral = "#FF826A"   // bar 1 — top
    static let amber = "#F4B61E"   // bar 2
    static let sky   = "#41C9FA"   // bar 3 — full width, the hero
    static let green = "#1E8D6F"   // bar 4 — bottom, shortest

    /// Top → bottom, exactly as the icon draws them. `TRAQSBarsMark` indexes
    /// this positionally, so the order is the logo's geometry rather than a
    /// convenience — reordering it redraws the mark.
    static let ordered = [coral, amber, sky, green]

    /// Which colour a tab owns under `AccentMode.logoStagger`.
    ///
    /// Five tabs, four colours. Home takes the hero: the longest bar is the sky
    /// one, and Home is the centre tab and the app's resting state. Coral is
    /// the repeat, on `.jobs` and `.stats` — opposite ends of `tabBarOrder`
    /// (`[.jobs, .hours, .home, .chat, .stats]`), so the two never sit adjacent.
    static func accent(for tab: TTab) -> String {
        switch tab {
        case .jobs:  return coral
        case .hours: return amber
        case .home:  return sky
        case .chat:  return green
        case .stats: return coral
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests/LogoPaletteTests"
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Services/LogoPalette.swift" \
        "TRAQS Scheduling/TRAQS SchedulingTests/LogoPaletteTests.swift"
git commit -m "Add the icon's four colours as LogoPalette, with the tab map

Sampled from the shipped asset so the app and the springboard icon
cannot drift. The tab map lives here rather than beside the tab bar
because a private extension in MainTabView could not be tested, and a
colour table that is wrong fails silently.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Accent mode and the resolution rules

**Files:**
- Create: `TRAQS Scheduling/Services/AccentMode.swift`
- Test: `TRAQS SchedulingTests/AccentResolverTests.swift`

**Interfaces:**
- Consumes: `LogoPalette.accent(for:)` and `LogoPalette` colour constants from Task 1; `TTab`.
- Produces: `enum AccentMode: String, CaseIterable { case solid, logoStagger }`; `AccentResolver.mode(storedMode: String?, hasSavedAccent: Bool) -> AccentMode`; `AccentResolver.activeAccent(mode: AccentMode, solidAccent: String, tab: TTab) -> String`.

- [ ] **Step 1: Write the failing test**

Create `TRAQS SchedulingTests/AccentResolverTests.swift`:

```swift
import Testing
@testable import TRAQS_Scheduling

/// Which accent is live, and which mode a launch starts in.
///
/// The launch rule is the one that matters: it decides whether an existing
/// user's chosen accent survives the update. Getting it wrong repaints the app
/// for people who already told us what they wanted, and there is no error to
/// notice — they just open TRAQS one morning and it is a different colour.
struct AccentResolverTests {

    // MARK: Launch mode

    @Test func freshInstallGetsTheStaggeredPalette() {
        #expect(AccentResolver.mode(storedMode: nil, hasSavedAccent: false) == .logoStagger)
    }

    /// The load-bearing case. `themeAccent` is written by `commitChanges()` and
    /// nowhere else, so its presence means this user has saved a theme at least
    /// once — they chose an accent, and it must survive.
    @Test func existingUserWithASavedAccentStaysSolid() {
        #expect(AccentResolver.mode(storedMode: nil, hasSavedAccent: true) == .solid)
    }

    @Test func anExplicitStoredModeWinsOverBothDefaults() {
        #expect(AccentResolver.mode(storedMode: "solid", hasSavedAccent: false) == .solid)
        #expect(AccentResolver.mode(storedMode: "logoStagger", hasSavedAccent: true) == .logoStagger)
    }

    /// A raw value we do not recognise — a downgrade, or a corrupted default —
    /// must fall through to the same rule as a missing key, not trap.
    @Test func anUnknownStoredModeFallsBackToTheKeyRule() {
        #expect(AccentResolver.mode(storedMode: "rainbow", hasSavedAccent: true) == .solid)
        #expect(AccentResolver.mode(storedMode: "", hasSavedAccent: false) == .logoStagger)
    }

    // MARK: Active accent

    @Test func solidModeIgnoresTheTabEntirely() {
        for tab in TTab.allCases {
            #expect(AccentResolver.activeAccent(mode: .solid,
                                                solidAccent: "#3B82F6",
                                                tab: tab) == "#3B82F6")
        }
    }

    @Test func staggerModeIgnoresTheSavedAccentEntirely() {
        #expect(AccentResolver.activeAccent(mode: .logoStagger,
                                            solidAccent: "#3B82F6",
                                            tab: .home) == LogoPalette.sky)
        #expect(AccentResolver.activeAccent(mode: .logoStagger,
                                            solidAccent: "#FF1FB4",
                                            tab: .hours) == LogoPalette.amber)
    }

    /// Flipping to stagger and back must land on the colour the user had —
    /// which only holds because stagger never writes `accent`.
    @Test func theSavedAccentSurvivesARoundTripThroughStagger() {
        let saved = "#7c3aed"
        _ = AccentResolver.activeAccent(mode: .logoStagger, solidAccent: saved, tab: .chat)
        #expect(AccentResolver.activeAccent(mode: .solid,
                                            solidAccent: saved,
                                            tab: .chat) == saved)
    }

    @Test func everyModeHasARawValueThatRoundTrips() {
        for mode in AccentMode.allCases {
            #expect(AccentMode(rawValue: mode.rawValue) == mode)
        }
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests/AccentResolverTests"
```

Expected: FAIL to compile — `cannot find 'AccentResolver' in scope`.

- [ ] **Step 3: Write the implementation**

Create `TRAQS Scheduling/Services/AccentMode.swift`:

```swift
import Foundation

/// How the live accent is decided.
///
/// `.solid` is the app's original behaviour: one hex, chosen in Customize,
/// everywhere. `.logoStagger` derives it from the selected tab instead, so the
/// icon's four colours are distributed across the app one per tab.
///
/// Only ONE accent is live at any instant either way — which is why every
/// `T.accent*` read site works unchanged under both modes. The value moves
/// under them; the contract does not change.
enum AccentMode: String, CaseIterable {
    case solid
    case logoStagger
}

// MARK: - The resolution rules
//
// Pure statics with every dependency passed in, per the Services convention.
// ThemeSettings owns the state and the UserDefaults access; this decides what
// that state MEANS, and that decision is the part worth a test.

enum AccentResolver {

    /// Which mode a launch starts in.
    ///
    /// The middle case is the whole point. `themeAccent` is written by
    /// `commitChanges()` and nowhere else, so its presence means this user has
    /// saved a theme at least once and therefore chose an accent; handing them
    /// the staggered palette would overwrite a real preference. A user with
    /// neither key has never expressed one, so they get the new default.
    ///
    /// An unrecognised raw value falls through to the same rule as a missing
    /// key rather than trapping — a downgrade or a corrupted default should
    /// degrade, not crash.
    static func mode(storedMode: String?, hasSavedAccent: Bool) -> AccentMode {
        if let storedMode, let known = AccentMode(rawValue: storedMode) { return known }
        return hasSavedAccent ? .solid : .logoStagger
    }

    /// The hex that feeds `applyAccentToT()`.
    ///
    /// `solidAccent` is the user's SAVED choice and is passed through untouched
    /// in `.solid`; stagger ignores it rather than overwriting it, which is what
    /// lets a user flip to stagger and back and land on the colour they had.
    static func activeAccent(mode: AccentMode, solidAccent: String, tab: TTab) -> String {
        switch mode {
        case .solid:       return solidAccent
        case .logoStagger: return LogoPalette.accent(for: tab)
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests/AccentResolverTests"
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Services/AccentMode.swift" \
        "TRAQS Scheduling/TRAQS SchedulingTests/AccentResolverTests.swift"
git commit -m "Add AccentMode and the pure accent-resolution rules

Two decisions, both silent when wrong, both now under test: which mode a
launch starts in (an existing user's saved accent has to survive), and
which hex is live given mode and tab.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the mode into ThemeSettings

**Files:**
- Modify: `TRAQS Scheduling/Services/ThemeSettings.swift`

**Interfaces:**
- Consumes: `AccentMode`, `AccentResolver.mode(storedMode:hasSavedAccent:)`, `AccentResolver.activeAccent(mode:solidAccent:tab:)` from Task 2; `TTab`.
- Produces: `ThemeSettings.accentMode: AccentMode`, `.activeTab: TTab`, `.activeAccent: String` (computed, read-only), `.setAccentMode(_ mode: AccentMode)`, `.setActiveTab(_ tab: TTab)`, `ThemeSettings.defaultAccentMode: AccentMode`.

No test. The rules this wires up are already covered by Task 2; what remains is `UserDefaults` plumbing and `@Observable` state, which the project tests through neither.

- [ ] **Step 1: Add the stored properties**

In `ThemeSettings`, directly after `static let defaultAccent: String = "#3B82F6"`:

```swift
    /// The shipped default. New installs land on the icon's palette; users who
    /// have already saved an accent keep it — see `AccentResolver.mode`.
    static let defaultAccentMode: AccentMode = .logoStagger
```

Directly after `var accent: String = ThemeSettings.defaultAccent`:

```swift
    /// Whether the live accent comes from `accent` or from the selected tab.
    var accentMode: AccentMode = ThemeSettings.defaultAccentMode

    /// The tab the stagger reads from. NOT persisted — `TabHost` pushes it on
    /// appear and on every change, so it is rebuilt each launch. Defaults to
    /// `.home` to match `AppNav.selected`'s own default, so the first frame is
    /// already the right colour rather than flashing and correcting.
    var activeTab: TTab = .home

    /// What actually feeds the `T.*` tokens.
    ///
    /// `accent` above keeps its original meaning — the user's saved SOLID
    /// choice — and stagger never writes it. That is what lets someone flip to
    /// the logo palette, flip back, and land on the colour they picked.
    var activeAccent: String {
        AccentResolver.activeAccent(mode: accentMode, solidAccent: accent, tab: activeTab)
    }
```

Directly after `private var savedAccent: String = ThemeSettings.defaultAccent`:

```swift
    private var savedAccentMode: AccentMode = ThemeSettings.defaultAccentMode
```

- [ ] **Step 2: Resolve the mode in `init`**

In `init()`, the existing first line is:

```swift
        accent = UserDefaults.standard.string(forKey: "themeAccent") ?? ThemeSettings.defaultAccent
```

Replace it with:

```swift
        // Read the raw object BEFORE defaulting `accent` — whether the key
        // EXISTS is the signal `AccentResolver.mode` needs, and `??` erases it.
        let storedAccent = UserDefaults.standard.object(forKey: "themeAccent") as? String
        accent = storedAccent ?? ThemeSettings.defaultAccent
        accentMode = AccentResolver.mode(
            storedMode: UserDefaults.standard.object(forKey: "themeAccentMode") as? String,
            hasSavedAccent: storedAccent != nil
        )
```

Then, in the block that snapshots the saved values, after `savedAccent = accent`:

```swift
        savedAccentMode = accentMode
```

- [ ] **Step 3: Add the two setters**

Directly after the existing `setAccent(_:)`:

```swift
    /// Live preview only (see `setAccent`). Persists on `commitChanges()`.
    func setAccentMode(_ mode: AccentMode) {
        accentMode = mode
        applyAccentToT()
    }

    /// Nav pushes the selected tab in; the theme never observes `AppNav`.
    ///
    /// Not a preview setter and not persisted — this is live navigation state,
    /// so it takes effect immediately and is not part of the Save/Cancel pair.
    /// In `.solid` it stores the tab and stops: nothing the tokens read has
    /// changed, so repainting would be pure work.
    func setActiveTab(_ tab: TTab) {
        guard activeTab != tab else { return }
        activeTab = tab
        guard accentMode == .logoStagger else { return }
        withAnimation(.easeInOut(duration: 0.35)) { applyAccentToT() }
    }
```

- [ ] **Step 4: Point the token application at `activeAccent`**

In `applyAccentToT()`, the body currently opens:

```swift
        T.accent = accent
        T.accentGradientStart = accent
        T.accentGradientEnd   = ThemeSettings.derivedEnd(from: accent)
```

Replace those three lines with:

```swift
        // `activeAccent`, not `accent` — in stagger the live colour comes from
        // the tab. Everything below is unchanged and still derives from a
        // SINGLE hue, so the same-hue gradient rule holds per-colour.
        let live = activeAccent
        T.accent = live
        T.accentGradientStart = live
        T.accentGradientEnd   = ThemeSettings.derivedEnd(from: live)
```

- [ ] **Step 5: Fold the mode into reset / preview / commit**

In `reset()`, directly after `setAccent(ThemeSettings.defaultAccent)`:

```swift
        setAccentMode(ThemeSettings.defaultAccentMode)
```

In `beginPreview()`, after `savedAccent = accent`:

```swift
        savedAccentMode = accentMode
```

In `cancelPreview()`, after `accent = savedAccent`:

```swift
        accentMode = savedAccentMode
```

In `commitChanges()`, after `UserDefaults.standard.set(accent, forKey: "themeAccent")`:

```swift
        UserDefaults.standard.set(accentMode.rawValue, forKey: "themeAccentMode")
```

and after `savedAccent = accent`:

```swift
        savedAccentMode = accentMode
```

- [ ] **Step 6: Verify it compiles**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 7: Run the Task 1 + 2 tests to confirm nothing regressed**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests"
```

Expected: PASS. This is the last task that runs the suite — every task after this one is view-only.

- [ ] **Step 8: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Services/ThemeSettings.swift"
git commit -m "Resolve the live accent through activeAccent, not accent

applyAccentToT now reads activeAccent, so T.* follows the mode. accent
keeps its old meaning as the saved solid choice and stagger never writes
it — flipping modes has to be lossless.

init reads themeAccent as an object before defaulting it, because
whether the key EXISTS is the signal that decides an existing user's
mode, and ?? erases exactly that.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Push the selected tab into the theme

**Files:**
- Modify: `TRAQS Scheduling/Views/MainTabView.swift` (the `TabHost` struct, around lines 295–327)

**Interfaces:**
- Consumes: `ThemeSettings.setActiveTab(_:)` from Task 3.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Give `TabHost` the theme**

`TabHost` currently declares one environment value:

```swift
private struct TabHost: View {
    @Environment(AppNav.self) private var appNav
```

Add the theme beneath it:

```swift
private struct TabHost: View {
    @Environment(AppNav.self) private var appNav
    @Environment(ThemeSettings.self) private var theme
```

- [ ] **Step 2: Push on appear and on change**

`TabHost.body` ends with the closing brace of the `TabView`. Attach both modifiers to that `TabView` — after the last `.toolbar(.hidden, for: .tabBar)` line and its closing `}`:

```swift
        }
        // The accent follows the tab in `.logoStagger`. Nav PUSHES; the theme
        // never observes AppNav, which keeps the Services→Views edge one-way.
        //
        // `onAppear` as well as `onChange`: `activeTab` is not persisted, so a
        // launch restored onto a non-Home tab (a push deep link writes
        // `appNav.selected` before this view appears) would otherwise render
        // Home's colour until the first manual tab change.
        .onAppear { theme.setActiveTab(appNav.selected) }
        .onChange(of: appNav.selected) { _, tab in theme.setActiveTab(tab) }
    }
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Views/MainTabView.swift"
git commit -m "TabHost pushes the selected tab into the theme

onAppear as well as onChange: activeTab is not persisted, and a push
deep link writes appNav.selected before TabHost appears, so without the
former a notification-launched session sits on Home's colour.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Retarget the observation reads

**Files:**
- Modify, 19 lines across 8 files:
  - `Views/JobDetailPopup.swift:126`
  - `Views/MainTabView.swift:451`
  - `Views/TimeClockView.swift:550,754`
  - `Views/ClockActionBanner.swift:38`
  - `Views/MessagesView.swift:2830,3004,3425`
  - `Views/Primitives.swift:387,1081,1127,1193,1247,1331,1618,1817`
  - `Views/TimeOffView.swift:441`
  - `Views/TasksView.swift:1349,1911`

**Interfaces:**
- Consumes: `ThemeSettings.activeAccent` from Task 3.
- Produces: nothing.

These are `_ = theme.accent` no-op reads whose only job is to register an `@Observable` dependency so the view re-renders. Left pointing at `accent`, they will **not** fire on a tab change, and those views will keep painting the previous tab's colour until something else invalidates them.

The `sed` below also rewrites two *comments* in `Primitives.swift` that mention `theme.accent` by name. That is intended — both describe where the blob hues come from — so the line count to expect is 21, not 19.

**Do not touch `CustomizeView.swift`, `SharedComponents.swift`, `SplashView.swift` or `LiquidBackground.swift`** — each holds a real read handled by its own task, and `CustomizeView` must keep reading `accent` deliberately.

- [ ] **Step 1: Rewrite the 8 files**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling/TRAQS Scheduling/Views"
sed -i '' \
  -e 's/\btheme\.accent\b/theme.activeAccent/g' \
  -e 's/\bthemeSettings\.accent\b/themeSettings.activeAccent/g' \
  JobDetailPopup.swift MainTabView.swift TimeClockView.swift \
  ClockActionBanner.swift MessagesView.swift Primitives.swift \
  TimeOffView.swift TasksView.swift
```

- [ ] **Step 2: Confirm the edit hit 21 lines and no stragglers remain**

Nineteen of those are the code reads. The other two are prose in
`Primitives.swift:1042` and `:1124` that name `theme.accent` in a comment; the
rewrite is correct there too, since both describe where the blob hues now come
from. Expect 21, not 19 — a result of 19 means the comments were skipped and the
pattern is wrong.

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling/TRAQS Scheduling/Views"
echo "rewritten: $(grep -c 'activeAccent' JobDetailPopup.swift MainTabView.swift \
  TimeClockView.swift ClockActionBanner.swift MessagesView.swift Primitives.swift \
  TimeOffView.swift TasksView.swift | awk -F: '{s+=$2} END {print s}')"
echo "--- any .accent left in these 8 (should be none) ---"
grep -n '\(theme\|themeSettings\)\.accent\b' JobDetailPopup.swift MainTabView.swift \
  TimeClockView.swift ClockActionBanner.swift MessagesView.swift Primitives.swift \
  TimeOffView.swift TasksView.swift || echo "none"
```

Expected: `rewritten: 21`, then `none`.

- [ ] **Step 3: Verify it compiles**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Views"
git commit -m "Point the theme-observation reads at activeAccent

Nineteen no-op reads whose only job is registering an @Observable
dependency. Left on accent they never fire on a tab change, and the view
keeps painting the previous tab's colour until something else happens to
invalidate it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The bars mark takes the icon's colours

**Files:**
- Modify: `TRAQS Scheduling/Views/SharedComponents.swift` (`TRAQSBarsMark`, lines 179–208)

**Interfaces:**
- Consumes: `LogoPalette.ordered` (Task 1), `ThemeSettings.accentMode` / `.activeAccent` (Task 3).
- Produces: nothing.

The mark's widths are `[0.554, 0.788, 1.0, 0.451]` with `accentIndex = 2` — four bars, third full-width. That is already the icon's geometry, so this is a fill swap, not a redraw.

- [ ] **Step 1: Swap the fills**

In `TRAQSBarsMark.body`, replace these three lines:

```swift
        let accentColor = Color(hex: themeSettings.accent)
        let _ = themeSettings.bgPresetId
        let greyColor = Color(hex: T.muted)
```

with:

```swift
        // Read accentMode / activeAccent / bgPresetId so the mark re-renders
        // live when the customizer changes any of them.
        let mode = themeSettings.accentMode
        let accentColor = Color(hex: themeSettings.activeAccent)
        let _ = themeSettings.bgPresetId
        let greyColor = Color(hex: T.muted)
```

Then replace the fill line inside the `ForEach`:

```swift
                    .fill(i == accentIndex ? accentColor : greyColor)
```

with:

```swift
                    // In stagger the mark IS the icon: all four bars, in the
                    // icon's own order. It does not change per tab — the logo
                    // is the one thing that stays put while the accent moves.
                    .fill(mode == .logoStagger
                          ? Color(hex: LogoPalette.ordered[i])
                          : (i == accentIndex ? accentColor : greyColor))
```

- [ ] **Step 2: Update the type's doc comment**

The comment above `struct TRAQSBarsMark` currently ends:

```swift
// rendered raster (`Image("TRAQSIconBars")`) so it follows the system theme: the
// accent bar tracks the user's chosen accent, and the three grey bars use the
// theme's muted ink so they stay legible on light AND dark backgrounds. `size` is the
// rendered HEIGHT in points; width is derived from the original 184×150 art.
```

Append after it:

```swift
//
// Under `.logoStagger` it drops the grey entirely and draws all four bars in
// `LogoPalette.ordered`, so the mark in the header is the same object as the
// icon on the springboard. `widths` and `LogoPalette.ordered` are both
// top-to-bottom and are indexed together — they must stay in step.
```

- [ ] **Step 3: Verify it compiles**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Views/SharedComponents.swift"
git commit -m "Draw the bars mark in the icon's four colours under stagger

The mark's widths were already the icon's geometry — four bars, third
full-width — so this is a fill swap. It does NOT change per tab: the
logo is the one thing that stays put while the accent moves.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: A palette override for the wash

**Files:**
- Modify: `TRAQS Scheduling/Views/LiquidBackground.swift` (property block ~line 247, `specs` ~line 307)

**Interfaces:**
- Consumes: `ThemeSettings.activeAccent` (Task 3).
- Produces: `LiquidBackground.palette: [String]?` — declared **immediately after `color`**, so the memberwise initialiser accepts `LiquidBackground(palette:thickness:energy:saturation:)` in Task 8. Declaration order is the parameter order; do not move it.

- [ ] **Step 1: Declare the override**

Immediately after the existing `var color: String? = nil` and its doc comment:

```swift
    /// An explicit multi-hue palette — one blob per entry — replacing the
    /// two-hue pair derived from `color`.
    ///
    /// The pair derives its partner through `LiquidColor.companion`/`tertiary`
    /// precisely because it has ONE hue to work from. A palette already is the
    /// ladder, so nothing is derived: each entry is pushed toward full colour
    /// by `saturation` and used as given.
    ///
    /// Declared here, directly after `color`, because the memberwise init takes
    /// its parameter order from declaration order and SplashView calls
    /// `LiquidBackground(palette:thickness:energy:saturation:)`.
    var palette: [String]? = nil
```

- [ ] **Step 2: Branch `specs`**

`specs` currently opens:

```swift
    private var specs: [BlobSpec] {
        let base = color ?? theme.accent
```

Replace those two lines with:

```swift
    private var specs: [BlobSpec] {
        // Corrected during review: the spec gave a single-colour palette its
        // own blob rather than discarding it (commit 3029294), so the guard
        // is non-emptiness, not count > 1.
        if let palette, !palette.isEmpty { return paletteSpecs(palette) }
        // `activeAccent`, not `accent` — under stagger the wash on each page is
        // that page's tab colour.
        let base = color ?? theme.activeAccent
```

- [ ] **Step 3: Add the four-blob builder**

Immediately after the closing brace of `specs`, add:

```swift
    /// One blob per colour.
    ///
    /// The pair's composition — two shapes on a diagonal, each wider than the
    /// canvas — does not extend to four: at that size they cover the ground
    /// completely and the wash stops reading as shapes on a background. So this
    /// restores the FOUR-CORNER arrangement the original aurora spec had,
    /// before it was collapsed to the accent pair, with smaller blobs.
    private func paletteSpecs(_ palette: [String]) -> [BlobSpec] {
        let hues = palette.map { LiquidColor.vivid($0, saturation) }

        // Coprime, and spread wider than the pair's 23/29 — four shapes on
        // close periods drift back into phase often enough to read as a pulse.
        let durations: [Double] = [23, 29, 31, 37]

        // Lower than the pair's [0.58, 0.50]. Two blobs carry the colour alone
        // and so hold more pigment; four at that density stack toward grey
        // wherever they overlap, which on four DIFFERENT hues is worse than on
        // two related ones.
        let alphas: [Double] = [0.42, 0.38, 0.38, 0.34]

        // Four trajectories, no two alike — a shared path would make two blobs
        // visibly track each other.
        let paths: [[LiquidStop]] = [LiquidPath.a,
                                     LiquidPath.reversed(LiquidPath.b),
                                     LiquidPath.b,
                                     LiquidPath.reversed(LiquidPath.a)]

        // Smaller than the pair (0.85/0.60 against 1.05/0.72): four of these
        // span the canvas between them where four full-size ones would drown it.
        let w = 0.85 * scale
        let h = 0.60 * scale

        // Two up, two down, alternating edges. Anchored as fractions of the
        // blob's OWN height for the same reason the pair is — so `scale`
        // shrinks the group without pulling it apart.
        let corners: [(leading: Double?, trailing: Double?, top: Double)] = [
            (-0.14, nil,   -h * 0.18),
            (nil,   -0.14, -h * 0.05),
            (-0.10, nil,   1 - h * 0.80),
            (nil,   -0.10, 1 - h * 0.95),
        ]

        return hues.indices.map { i in
            let corner = corners[i % corners.count]
            return BlobSpec(
                id: i,
                w: w,
                h: h,
                leading:  corner.leading,
                trailing: corner.trailing,
                top:      corner.top,
                hex:      hues[i],
                alpha:    a(alphas[i % alphas.count]),
                stops:    paths[i % paths.count],
                duration: durations[i % durations.count]
            )
        }
    }
```

- [ ] **Step 4: Verify it compiles**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Views/LiquidBackground.swift"
git commit -m "Let the wash take an explicit palette, one blob per colour

Restores the four-corner composition the aurora spec had before it was
collapsed to the accent pair — but smaller and thinner than the pair,
because four full-size blobs at [0.58, 0.50] cover the ground and stack
toward grey where they overlap.

Also points the derived path at activeAccent, so each page's wash is its
own tab's colour.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The splash carries all four

**Files:**
- Modify: `TRAQS Scheduling/Views/SplashView.swift` (lines 40–46, 68)

**Interfaces:**
- Consumes: `LiquidBackground.palette` (Task 7), `LogoPalette.ordered` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Pass the palette**

Replace:

```swift
            LiquidBackground(thickness: 1.6, energy: 3.4, saturation: 0.45)
```

with:

```swift
            LiquidBackground(palette: LogoPalette.ordered,
                             thickness: 1.6, energy: 3.4, saturation: 0.45)
```

The splash carries all four colours under **both** accent modes. It is the brand moment, and it runs before any tab exists to stagger from.

- [ ] **Step 2: Pin the mark's contrast to the theme**

Replace the whole of `markOnLightBackground`, comment included:

```swift
    /// Which wordmark reads on this splash. The mark sits on the LIQUID WASH,
    /// which is the accent colour — not on the theme's page background — so the
    /// choice follows the accent's own luminance: a dark accent (the brand
    /// blues) gets the white mark, a light one (amber, cyan) gets black.
    /// Uses the app's shared contrast rule so the threshold lives in one place.
    private var markOnLightBackground: Bool {
        Color(hex: theme.accent).readableText == .black
    }
```

with:

```swift
    /// Which wordmark reads on this splash.
    ///
    /// This used to ask the ACCENT's luminance, because the wash was the accent
    /// and the mark sits on the wash. With four colours there is no single
    /// accent to ask, and the honest answer differs per blob: amber #F4B61E
    /// wants a black mark, green #1E8D6F wants white, and on a drifting wash
    /// they are adjacent — no fixed choice is right against the wash itself.
    ///
    /// So it follows the THEME instead. The blobs sit at partial alpha over the
    /// theme's own radial ground (near-white or near-black), and the mark
    /// resolves with a light pool of its own behind it, so the ground is what
    /// actually decides legibility. The theme is stable; the wash is not.
    private var markOnLightBackground: Bool {
        theme.isLightTheme
    }
```

- [ ] **Step 3: Update the header comment**

The file header lists two departures from the design file. The first currently reads:

```swift
//   • The four hardcoded aurora blobs are replaced by the app's own LIQUID
//     background — the same wash the web offers under background customization
//     — so the splash is tinted by whatever accent the user picked.
```

Replace it with:

```swift
//   • The four hardcoded aurora blobs are replaced by the app's own LIQUID
//     background — the same wash the web offers under background customization.
//     It ran on the user's accent at first, a single hue in a two-blob pair.
//     Since the icon became a four-colour mark it runs on LogoPalette instead,
//     one blob per colour: four again, as the design had them, but the brand's
//     own four rather than hardcoded ones.
```

- [ ] **Step 4: Verify it compiles**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Views/SplashView.swift"
git commit -m "Run the splash wash on the logo's four colours

And pin the wordmark's contrast to the theme rather than the accent:
with four hues there is no single accent to ask, and amber and green
want opposite marks while sitting next to each other on a drifting wash.
The theme's radial ground is what actually decides legibility.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The stagger swatch in Customize

**Files:**
- Modify: `TRAQS Scheduling/Views/CustomizeView.swift` (grid lines 27–44, `onAppear` line 110, `AccentSwatch` line 137)

**Interfaces:**
- Consumes: `ThemeSettings.accentMode` / `.setAccentMode(_:)` (Task 3), `LogoPalette.ordered` / `.sky` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Rebuild the accent grid**

Replace the whole `LazyVGrid` block — from `LazyVGrid(columns:` through its closing brace — with:

```swift
                            // Five columns, not eight: nine swatches plus the
                            // picker is ten cells, which fills two rows exactly
                            // where eight left a ragged row of two.
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 14) {

                                // Leads the row — it is the default.
                                LogoStaggerSwatch(isSelected: theme.accentMode == .logoStagger) {
                                    theme.setAccentMode(.logoStagger)
                                }

                                ForEach(ThemeSettings.accentPresets, id: \.self) { hex in
                                    // Selection is mode-aware: while stagger is
                                    // on, NO solid swatch reads as selected even
                                    // though `accent` still holds the user's
                                    // saved colour underneath.
                                    AccentSwatch(hex: hex,
                                                 isSelected: theme.accentMode == .solid && theme.accent == hex) {
                                        // Picking a colour is what leaves stagger.
                                        theme.setAccentMode(.solid)
                                        theme.setAccent(hex)
                                        customAccentColor = Color(hex: hex)
                                    }
                                }

                                // Custom color picker
                                ColorPicker("", selection: $customAccentColor, supportsOpacity: false)
                                    .labelsHidden()
                                    .frame(width: 36, height: 36)
                                    .clipShape(Circle())
                                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1.5))
                                    .onChange(of: customAccentColor) { _, newColor in
                                        theme.setAccentMode(.solid)
                                        theme.setAccent(newColor.hexString)
                                    }
                            }
```

- [ ] **Step 2: Add the swatch**

Directly after the closing brace of `private struct AccentSwatch`, add:

```swift
// The `.logoStagger` swatch: the four icon colours as horizontal stripes inside
// the same 36pt circle the solid swatches use.
//
// Stripes rather than a quartered or conic fill because they echo the bars mark
// — a quartered circle reads as a generic "multicolour" chip, where stripes say
// which multicolour. Same order as the mark and the icon.
private struct LogoStaggerSwatch: View {
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                ForEach(LogoPalette.ordered.indices, id: \.self) { i in
                    Rectangle().fill(Color(hex: LogoPalette.ordered[i]))
                }
            }
            .frame(width: 36, height: 36)
            .clipShape(Circle())
            .overlay(
                isSelected
                    // Fixed white with a shadow, not `readableText`: the tick
                    // lands across all four stripes at once, so there is no one
                    // background colour to contrast against.
                    ? Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .shadow(color: .black.opacity(0.35), radius: 2, x: 0, y: 1)
                    : nil
            )
            .overlay(
                Circle()
                    .stroke(isSelected ? Color.white.opacity(0.6) : Color(hex: T.hair),
                            lineWidth: isSelected ? 2 : 1)
            )
            .shadow(color: isSelected ? Color(hex: LogoPalette.sky).opacity(T.skyShadowOpacity) : .clear,
                    radius: isSelected ? T.skyShadowRadius : 0, x: 0, y: isSelected ? T.skyShadowY : 0)
        }
        .buttonStyle(.plain)
    }
}
```

- [ ] **Step 3: Seed the picker from the saved accent**

`onAppear` reads `theme.accent`, which stays correct — it is the saved solid choice, and it is what the picker should open on even while stagger is live. Leave line 110 as it is. Add the reason, directly above it:

```swift
            // `accent`, deliberately NOT `activeAccent` — the picker should
            // open on the colour the user saved, not on whichever tab's colour
            // happens to be live behind the customizer.
```

- [ ] **Step 4: Verify it compiles**

```bash
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling"
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 5: Commit**

```bash
cd /Users/treysenparkinson/traqs
git add "TRAQS Scheduling/TRAQS Scheduling/Views/CustomizeView.swift"
git commit -m "Add the logo-stagger swatch to Customize

Four stripes in a 36pt circle, leading the row because it is the
default. Selection is mode-aware, so no solid swatch shows a tick while
stagger is on even though accent still holds the saved colour; picking
any colour is what leaves stagger.

Grid goes 8 columns to 5 — ten cells now, which fills two rows exactly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Hand-off checks

These are behavioural and cannot be read off the source. The user runs them.

1. **Fresh install** (delete the app first, so neither `themeAccentMode` nor `themeAccent` exists) lands on the staggered palette.
2. **An existing install** with a saved accent still opens on that accent, in `.solid`.
3. **Every tab change** repaints the nav pill, CTAs and the page wash to the mapped colour: Jobs coral · Hours amber · Home sky · Messages green · Analytics coral.
4. **The transition.** `setActiveTab` wraps `applyAccentToT()` in `withAnimation`, but `T.*` are plain `static var`s re-read at render, not animatable values — a crossfade is the expectation, not a guarantee. If it cuts hard instead, the fallback is an explicit `.animation(_:value:)` keyed on `activeAccent` at the few highest-visibility sites (nav pill highlight, CTAs, the wash), **not** a global mechanism.
5. **The bars mark** shows four colours in stagger, and three-muted-plus-accent in solid.
6. **The splash** shows four distinct blobs that stay distinct — they must not stack toward grey where they overlap. `alphas` in `paletteSpecs` is the dial: currently `[0.42, 0.38, 0.38, 0.34]`, lower it if they muddy.
7. **Customize**: exactly one swatch reads as selected at any time; tapping a solid colour drops stagger; Save/back-out both round-trip the mode.

## Open tuning values

Deliberately left as starting points, since they are eye judgments and the implementer cannot see the result:

- `paletteSpecs.alphas` — `[0.42, 0.38, 0.38, 0.34]`
- `paletteSpecs` blob size — `w = 0.85 * scale`, `h = 0.60 * scale`
- `paletteSpecs.corners` — the four anchor positions
- `setActiveTab` crossfade duration — `0.35`
