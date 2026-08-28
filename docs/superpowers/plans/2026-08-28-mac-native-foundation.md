# macOS Native Foundation (PASS 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the TRAQS Mac app the plumbing every ported screen needs — real DM Sans, theme by environment, real `AppState`, one page-chrome implementation, native Liquid Glass with a working morph, and a side-by-side parity harness — without porting any screen.

**Architecture:** The Mac target already compiles the iOS app's `Models/` and `Services/` through Xcode file-system-synchronized groups, so `AppState`, `APIService` and `AuthManager` are literally the same files. This pass adds a third synchronized group for the iOS `Fonts/`, replaces synthesised font weights with real faces, moves `TTheme` from a hand-threaded parameter into `@Environment`, extracts the web app's page chrome into one `TPage`, converts the sidebar's `matchedGeometryEffect` pill to `glassEffectID`, and replaces the Native-UI toggle with a three-mode Native/Split/Web harness.

**Tech Stack:** SwiftUI, macOS 26 (`MACOSX_DEPLOYMENT_TARGET = 26.0`), Swift Testing (`import Testing`, not XCTest), Xcode project `objectVersion = 77` with `PBXFileSystemSynchronizedRootGroup`.

**Spec:** `docs/superpowers/specs/2026-08-28-mac-native-foundation-design.md`

## Global Constraints

- **The Mac app is a visual copy of the Netlify web app.** Read every number out of `src/TRAQS.jsx` and paste it. A number in the Mac app that was not copied is a bug. This covers layout *and* type: font family, weight, size, letter spacing, line height.
- **The one sanctioned divergence is buttons.** Native `glassEffect`, plus header clusters that morph. Nothing else may differ.
- **There is no CSS constraint on the native app.** `MacNativeSkin` is a `WKUserScript` injected into the *web view* only. Never reach for it when styling native views.
- **No `AnyView` on any path that carries a glass effect.** `glassEffectID` interpolates a glass shape and needs the view carrying it to be continuous; one type erasure anywhere on the path degrades the morph to a cross-fade. Controls are data rendered through a concrete `switch`, or generic `@ViewBuilder` parameters — never `AnyView`.
- **New Swift files in `TRAQS MacBook Native/` need NO `project.pbxproj` edit.** The target uses `PBXFileSystemSynchronizedRootGroup`; anything dropped in the directory is picked up. Editing the pbxproj to register a source file is wasted work and risks conflict. (Adding a whole new *directory* to the target does need an edit — Task 2.)
- **Tests are Swift Testing** (`import Testing`, `@Test`, `#expect`) in the existing `TRAQS SchedulingTests` target, and `@testable import TRAQS_Scheduling` (underscore).
- **The Mac target has no test target.** Only one `PBXNativeTarget`, product type application. Pure logic therefore goes into the shared `Services/` directory, where the iOS test target already compiles it. Mac-only view code is verified by build plus the parity harness.
- Build commands:
  - Mac: `xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" -configuration Debug build` from `TRAQS MacBook Native/`
  - iOS: `xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" -destination 'generic/platform=iOS Simulator' -configuration Debug build` from `TRAQS Scheduling/`
  - iOS tests: `xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:"TRAQS SchedulingTests"` from `TRAQS Scheduling/`
- **Every task that touches shared `Services/` must leave the iOS build green and iOS tests passing.** Two apps compile those files.

---

### Task 1: Web font weight → DM Sans face (shared, TDD)

The only piece of PASS 0 with real logic, so it goes in shared `Services/` where the iOS test target can reach it. Both apps map web `fontWeight` numbers onto DM Sans faces; neither should invent its own answer.

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Services/Typography.swift:9-15`
- Test: `TRAQS Scheduling/TRAQS SchedulingTests/WebFontWeightTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `TFontName: CaseIterable`, and `static func TFontName.face(forWebWeight: Int) -> TFontName`. Task 2 calls both.

- [ ] **Step 1: Write the failing test**

Create `TRAQS Scheduling/TRAQS SchedulingTests/WebFontWeightTests.swift`:

```swift
import Testing
@testable import TRAQS_Scheduling

// The web app asks for DM Sans by NUMBER (`fontWeight: 700`); the apps ship it as
// five named files. This is the one place that translation happens, so both apps
// resolve a given web weight to the same face.
@Suite("Web font weight → DM Sans face")
struct WebFontWeightTests {

    @Test func theFourShippedMidWeightsEachGetTheirOwnFace() {
        #expect(TFontName.face(forWebWeight: 400) == .regular)
        #expect(TFontName.face(forWebWeight: 500) == .medium)
        #expect(TFontName.face(forWebWeight: 600) == .semibold)
        #expect(TFontName.face(forWebWeight: 700) == .bold)
        #expect(TFontName.face(forWebWeight: 800) == .extrabold)
    }

    // index.html:16 loads `DM+Sans:wght@300;400;500;600;700;800`. 900 is NOT among
    // them, so `pageTitleStyle`'s `fontWeight: 900` (TRAQS.jsx:12714) is already
    // clamped by the browser to the heaviest face it has — 800. Copying what the web
    // RENDERS means ExtraBold; `.black` would overshoot the thing being copied.
    @Test func nineHundredClampsToExtraBoldTheWayTheBrowserDoes() {
        #expect(TFontName.face(forWebWeight: 900) == .extrabold)
    }

    // 300 (Light) IS loaded by the web but is not one of the five shipped faces.
    // Recorded as a deliberate approximation rather than left to chance: the moment a
    // ported screen actually uses 300, DMSans-Light gets added and this expectation
    // changes with it.
    @Test func lightFallsBackToRegularUntilThatFaceShips() {
        #expect(TFontName.face(forWebWeight: 300) == .regular)
    }

    @Test func nonsenseWeightsClampRatherThanCrash() {
        #expect(TFontName.face(forWebWeight: 0) == .regular)
        #expect(TFontName.face(forWebWeight: 10_000) == .extrabold)
    }

    // Task 2's launch assertion iterates all five to check they registered.
    @Test func everyFaceIsEnumerable() {
        #expect(TFontName.allCases.count == 5)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `TRAQS Scheduling/`:

```bash
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests" 2>&1 | grep -E "error:|TEST"
```

Expected: compile failure — `type 'TFontName' has no member 'face'`, and `allCases` unavailable because `TFontName` is not `CaseIterable`.

- [ ] **Step 3: Write the minimal implementation**

In `Services/Typography.swift`, add `CaseIterable` to the enum and the mapping below it:

```swift
enum TFontName: String, CaseIterable {
    case regular   = "DMSans-Regular"
    case medium    = "DMSans-Medium"
    case semibold  = "DMSans-SemiBold"
    case bold      = "DMSans-Bold"
    case extrabold = "DMSans-ExtraBold"
}

extension TFontName {
    /// The face a web `fontWeight` resolves to.
    ///
    /// The web app styles by number and the apps ship five named files, so this is
    /// the translation — in ONE place, because two copies would drift and the
    /// symptom (type a half-weight off) is nearly invisible.
    ///
    /// Ranges rather than exact matches so an unlisted weight lands on its nearest
    /// shipped neighbour instead of falling through to a default that happens to be
    /// Regular.
    ///
    /// 300 (Light) is loaded by the web but not shipped here; it approximates to
    /// Regular. Add `DMSans-Light` the moment a ported screen actually uses it —
    /// see `WebFontWeightTests`.
    static func face(forWebWeight w: Int) -> TFontName {
        switch w {
        case ..<450: return .regular      // 300 (approximated), 400
        case ..<550: return .medium       // 500
        case ..<650: return .semibold     // 600
        case ..<750: return .bold         // 700
        default:     return .extrabold    // 800, and 900 — which the browser
                                          // clamps here too, since it never
                                          // loads a 900 face
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command as Step 2. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Verify the iOS app still builds**

Run from `TRAQS Scheduling/`:

```bash
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`. Adding a conformance and an extension cannot break callers, but this file is shared by two apps and the guarantee is the point.

- [ ] **Step 6: Commit**

```bash
git add "TRAQS Scheduling/TRAQS Scheduling/Services/Typography.swift" \
        "TRAQS Scheduling/TRAQS SchedulingTests/WebFontWeightTests.swift"
git commit -m "feat(type): map web fontWeight numbers to DM Sans faces

The web app styles by number and both apps ship five named files. One
translation, shared, so they cannot drift. 900 maps to ExtraBold because
index.html never loads a 900 face — the browser is already clamping there,
and copying the web means copying what it renders."
```

---

### Task 2: DM Sans ships in the Mac bundle, and `TFont` stops faking weights

The app is not currently rendering in DM Sans at all. `TFont.body` asks for `"DMSans-Regular"`, the Mac bundle has no font files, and `Font.custom` silently returns the system face. Every measurement in the shell is already right and the typeface is wrong.

**Files:**
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native.xcodeproj/project.pbxproj` (three insertions + one build setting, both configurations)
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/Theme.swift:63-71`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift` (call the assertion once at launch)

**Interfaces:**
- Consumes: `TFontName.face(forWebWeight:)` and `TFontName.allCases` from Task 1.
- Produces: `TFont.body(_ size: CGFloat, _ webWeight: Int) -> Font`, `TFont.nav(_ active: Bool) -> Font`, `TFont.assertFacesRegistered()`. Every later task that sets type calls `TFont.body` with a **web weight number**, not a `Font.Weight`.

- [ ] **Step 1: Add the Fonts directory to the target (pbxproj)**

The iOS faces live in `TRAQS Scheduling/TRAQS Scheduling/Fonts/` (five `.ttf`). They are **referenced, not copied** — two copies of one font is how the apps end up on different cuts of it.

Three edits, each copying the pattern the `Models` and `Services` groups already use. In `PBXFileSystemSynchronizedRootGroup`, after the `...0012 /* ...Services */` block:

```
		TD0000000000000000000013 /* ../TRAQS Scheduling/TRAQS Scheduling/Fonts */ = {
			isa = PBXFileSystemSynchronizedRootGroup;
			path = "../TRAQS Scheduling/TRAQS Scheduling/Fonts";
			sourceTree = "<group>";
		};
```

In the root `PBXGroup` (`TD0000000000000000000030`) children, after the Services line:

```
				TD0000000000000000000013 /* ../TRAQS Scheduling/TRAQS Scheduling/Fonts */,
```

In `PBXNativeTarget` (`TD0000000000000000000040`) `fileSystemSynchronizedGroups`, after the Services line:

```
				TD0000000000000000000013 /* ../TRAQS Scheduling/TRAQS Scheduling/Fonts */,
```

- [ ] **Step 2: Declare the fonts (a real Info.plist — NOT a build setting)**

macOS uses `ATSApplicationFontsPath` where iOS uses `UIAppFonts`; `.` means the bundle's resource root.

**`INFOPLIST_KEY_ATSApplicationFontsPath` does not work.** Xcode maps only a known allowlist of `INFOPLIST_KEY_*` settings into the generated plist, and that key is not on it — the build succeeds, the setting is silently dropped, and the key never reaches the bundle. (Verified during execution: `plutil -p` on the built plist showed nothing.) It needs a real plist.

`GENERATE_INFOPLIST_FILE` stays `YES`: with `INFOPLIST_FILE` also set, Xcode **merges** the keys it generates into the file rather than replacing it, so the file only carries what generation cannot.

Create `Info.plist` at the **project root**, beside the `.xcodeproj` — *not* inside the `TRAQS MacBook Native/` source directory, which is a synchronized group and would also copy it into the bundle as a resource (Xcode warns about exactly that):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ATSApplicationFontsPath</key>
	<string>.</string>
</dict>
</plist>
```

Then add to **both** the Debug and Release `XCBuildConfiguration` blocks:

```
				INFOPLIST_FILE = Info.plist;
```

- [ ] **Step 3: Verify the faces are actually in the built bundle**

Run from `TRAQS MacBook Native/`:

```bash
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
find ~/Library/Developer/Xcode/DerivedData -path "*TRAQS MacBook Native.app/Contents/Resources/DMSans-*" 2>/dev/null | wc -l
plutil -p ~/Library/Developer/Xcode/DerivedData/TRAQS_MacBook_Native-*/Build/Products/Debug/"TRAQS MacBook Native.app"/Contents/Info.plist | grep -iE "fonts|CFBundleName"
```

Expected: `** BUILD SUCCEEDED **` with no Copy-Bundle-Resources warning, `5` fonts, and the plist showing **both** `ATSApplicationFontsPath => "."` and `CFBundleName` — the second proves the generated keys merged rather than replaced the file.

**Both checks are load-bearing and each catches a different silent failure.** No fonts in Resources means Step 1's synchronized group did not take. Fonts present but no `ATSApplicationFontsPath` means they shipped undeclared, so nothing registers them — the original bug wearing a disguise. **If either fails, stop.**

- [ ] **Step 4: Rewrite `TFont` to resolve real faces**

Replace `Theme.swift:63-71` entirely:

```swift
// MARK: Type
//
// The web app styles type by NUMBER — `fontWeight: 700`, `fontSize: 13`. So does
// this API: callers pass the web's number and get the DM Sans face that number
// resolves to, via the shared `TFontName.face(forWebWeight:)`. That is what keeps
// "copy the number out of TRAQS.jsx" true for type the way it is for layout.
//
// It used to be `.custom("DMSans-Regular", size:).weight(weight)`, which asked
// SwiftUI to synthesise a bold from the Regular face. DM Sans ships real Medium,
// SemiBold, Bold and ExtraBold cuts; a synthesised weight is a different shape,
// and next to the web app in split mode the difference is visible.
enum TFont {
    /// `size` and `webWeight` are the web app's own numbers, copied.
    static func body(_ size: CGFloat, _ webWeight: Int = 400) -> Font {
        .custom(TFontName.face(forWebWeight: webWeight).rawValue, size: size)
    }

    /// Sidebar and control labels — 13pt on the web, 500 idle / 700 active.
    static func nav(_ active: Bool) -> Font {
        body(13, active ? 700 : 500)
    }

    #if DEBUG
    /// A missing font is SILENT: `Font.custom` with a name it cannot find returns
    /// the system face and reports nothing. That is exactly how the app came to
    /// look finished while rendering in the wrong typeface, so the check is an
    /// assertion at launch rather than something to notice by eye.
    static func assertFacesRegistered() {
        // CoreText, NOT `NSFontManager.shared` — touching the shared font manager
        // from `App.init()` spins up AppKit's font panel machinery and logs
        // "A shared NSFontManager instance already exists". PostScript names are
        // exactly what `Font.custom` matches on.
        let names = CTFontManagerCopyAvailablePostScriptNames() as? [String] ?? []
        let available = Set(names)
        let missing = TFontName.allCases.map(\.rawValue).filter { !available.contains($0) }
        assert(missing.isEmpty, """
            DM Sans faces are not registered: \(missing.joined(separator: ", ")).
            Check that Info.plist carries ATSApplicationFontsPath = "." and the Fonts \
            directory is in the target's fileSystemSynchronizedGroups.
            """)
    }
    #endif
}
```

Add `import CoreText` at the top of `Theme.swift`.

- [ ] **Step 5: Call the assertion once at launch**

In `TRAQSDesktopApp.swift`, add an `init()` to the `App` struct:

```swift
    init() {
        #if DEBUG
        TFont.assertFacesRegistered()
        #endif
    }
```

- [ ] **Step 6: Fix every existing `TFont.body` call site**

`TFont.body` no longer takes a `Font.Weight`. Find them and convert each to the web's number — `.bold` → `700`, `.semibold` → `600`, `.medium` → `500`, omit for regular:

```bash
cd "TRAQS MacBook Native" && grep -rn "TFont.body(" "TRAQS MacBook Native/"
```

Known call sites in `NativeShell.swift`: the page placeholder (`28, .bold` → `28, 700`), the org label (`10, .bold` → `10, 700`), the profile name (`13, .semibold` → `13, 600`), the profile role (`10` → `10`), the avatar initials (`12, .bold` → `12, 700`), and the nav row label (`fontSize, active ? .bold : .medium` → `fontSize, active ? 700 : 500`).

- [ ] **Step 7: Build and confirm the assertion passes**

```bash
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
open ~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug/"TRAQS MacBook Native.app"
```

Expected: `** BUILD SUCCEEDED **`, the app launches without tripping the assertion, and the sidebar type visibly changes — DM Sans is narrower and tighter than the system face, so this is a *visible* diff, not a subtle one. If the app traps at launch, the message names what is missing.

- [ ] **Step 8: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native.xcodeproj/project.pbxproj" \
        "TRAQS MacBook Native/TRAQS MacBook Native/Theme.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift"
git commit -m "fix(mac): the app was not rendering in DM Sans at all

The Mac bundle had no font files, so Font.custom(\"DMSans-Regular\") fell
back to the system face and said nothing — every measurement copied
correctly and the typeface wrong. The iOS faces are now referenced (not
copied, so the apps cannot drift onto different cuts) and declared via
ATSApplicationFontsPath, since the generated Info.plist has no UIAppFonts.

TFont also stopped synthesising weights off Regular and now takes the
web's own weight NUMBER, resolving it to a real face. A debug assertion at
launch turns the silent fallback into a trap."
```

---

### Task 3: Theme by environment

`NativeShell(theme:)` is fine for one view and rots by the fourth. The Jobs screen alone is a queue, a list, a detail panel and the cards inside each; none of them should have to be handed a `TTheme` to know what colour to be.

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/ThemeEnvironment.swift`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift` (drop `let theme`, read the environment)
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift` (inject once)

**Interfaces:**
- Consumes: `TTheme` from `Theme.swift`.
- Produces: `EnvironmentValues.tqTheme: TTheme`, and `MacTheme.current(isLight: Bool) -> TTheme`. Tasks 4, 6, 7 and 8 read `@Environment(\.tqTheme)`.

- [ ] **Step 1: Create the environment key and the theme source**

Create `ThemeEnvironment.swift`:

```swift
import SwiftUI

// MARK: - The theme, by environment
//
// Screens read `@Environment(\.tqTheme)` rather than taking a `theme:` parameter.
// Threading it by hand works for one view and becomes a chore the moment a screen
// has depth — the Jobs page is a queue, a list, a detail panel and the cards
// inside each, and not one of them should need a colour handed to it.
//
// Written as an explicit EnvironmentKey rather than with the `@Entry` macro: this
// target is on Swift 5 language mode to match the iOS target (the shared files
// were written under it), and an EnvironmentKey works everywhere regardless.

private struct TQThemeKey: EnvironmentKey {
    /// Matches `ThemeSettings.defaultBgPresetId`, which is the light preset.
    static let defaultValue: TTheme = .frost
}

extension EnvironmentValues {
    var tqTheme: TTheme {
        get { self[TQThemeKey.self] }
        set { self[TQThemeKey.self] = newValue }
    }
}

// MARK: - Which theme
//
// TODO: follow the web app's own theme list. `THEMES` in TRAQS.jsx (:2399-2401)
// carries Dark, Obsidian and White, and the web has a picker for them. Deriving
// the theme from the iOS app's two presets maps onto two of the three, so
// OBSIDIAN IS CURRENTLY UNREACHABLE. Whether the Mac gets its own picker or
// follows a shared setting is a decision for when a ported screen makes the
// answer obvious; it is written down here rather than left implied.
enum MacTheme {
    static func current(isLight: Bool) -> TTheme { isLight ? .frost : .midnight }
}
```

- [ ] **Step 2: Make `NativeShell` read the environment**

In `NativeShell.swift`, replace `let theme: TTheme` with:

```swift
    @Environment(\.tqTheme) private var theme
```

Every `theme.` reference in the file keeps working unchanged — same name, same type, different source.

- [ ] **Step 3: Inject it once at the root**

In `TRAQSDesktopApp.swift`, on the `RootView` in the `WindowGroup`, add alongside the other `.environment` calls:

```swift
                .environment(\.tqTheme, MacTheme.current(isLight: themeSettings.isLightTheme))
```

Then change the `NativeShell(theme: …)` call site in `RootView.body` to plain `NativeShell()`.

- [ ] **Step 4: Build**

```bash
cd "TRAQS MacBook Native" && xcodebuild -project "TRAQS MacBook Native.xcodeproj" \
  -scheme "TRAQS MacBook Native" -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`, and the app looks identical — this task changes plumbing only. A colour change here means the injected theme and the old parameter disagreed, which is worth stopping for.

- [ ] **Step 5: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/ThemeEnvironment.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift"
git commit -m "refactor(mac): theme by environment instead of by parameter

Screens read @Environment(\\.tqTheme). Handing TTheme down explicitly is
fine for one view and a chore by the fourth, and the Jobs page has four
levels on its own. Also records the theme-source loose end: deriving from
the iOS app's two presets leaves Obsidian unreachable."
```

---

### Task 4: The shell shows the real person and the real org

`NativeShell`'s profile block, org label and two gated nav rows are currently fiction — hardcoded defaults, shown to whoever opens the app.

**Files:**
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift` (remove four stored properties, add two environment reads, adjust `profile`)

**Interfaces:**
- Consumes: `EnvironmentValues.tqTheme` (Task 3); `AppState.currentPerson`, `AppState.orgName` (`AppState.swift:210`), `AppState.isAdmin` (`:2925`), `AppState.canViewApprovalQueue` (`:1054`).
- Produces: `NativeShell()` — no parameters at all.

- [ ] **Step 1: Replace the hardcoded properties with environment reads**

In `NativeShell`, delete these four lines:

```swift
    var canSeeApprovals = true
    var isAdmin = true
    var personName = "Treysen Parkinson"
    var orgName = "MATRIX SYSTEMS"
```

and add, beside the existing `@Environment(\.tqTheme)`:

```swift
    @Environment(AppState.self) private var appState

    // Read as computed properties rather than stored ones so the shell tracks
    // AppState. The four values they replace were hardcoded defaults — a real
    // person's name, shown to whoever opened the app.
    //
    // Deliberately REMOVED as parameters rather than defaulted: a default is an
    // invitation to pass fiction again.
    private var personName: String { appState.currentPerson?.name ?? "" }
    private var orgName: String { appState.orgName }
    private var isAdmin: Bool { appState.isAdmin }
    private var canSeeApprovals: Bool { appState.canViewApprovalQueue }
```

- [ ] **Step 2: Handle the no-session case in `profile`**

Before people load there is no name, and `initials("")` would render an empty circle with a stray subtitle. In `profile`, wrap the initials overlay and gate the text block:

```swift
            Circle()
                .fill(theme.accent.opacity(0.22))
                .frame(width: 32, height: 32)
                .overlay {
                    // No initials before people load, rather than a placeholder
                    // that swaps a beat later.
                    if !personName.isEmpty {
                        Text(initials(personName))
                            .font(TFont.body(12, 700))
                            .foregroundStyle(theme.accent)
                    }
                }
            if expanded && !personName.isEmpty {
```

(The `VStack` that follows, and its closing brace, are unchanged — only the `if expanded` condition gains `&& !personName.isEmpty`.)

- [ ] **Step 3: Fix the call site**

In `TRAQSDesktopApp.swift`, `NativeShell()` already takes no arguments after Task 3. Confirm no `personName:`/`orgName:`/`isAdmin:`/`canSeeApprovals:` arguments remain anywhere:

```bash
cd "TRAQS MacBook Native" && grep -rn "NativeShell(" "TRAQS MacBook Native/"
```

Expected: only `NativeShell()`.

- [ ] **Step 4: Build**

```bash
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`. Launch it: with no Keychain session the profile block shows a bare avatar circle and the org label is empty, and Approval Queue and Admin are **absent** from the sidebar. That is the correct signed-out shell — Task 5 gives it a session.

- [ ] **Step 5: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift"
git commit -m "feat(mac): the shell reads AppState instead of hardcoded names

The profile block, org label and the gated Approvals/Admin rows were
fiction — a real person's name compiled in as a default. Now the person,
org, admin flag and approval permission all come from AppState, and the
parameters are removed rather than defaulted so fiction cannot be passed
again. Signed out shows an empty shell, not a placeholder."
```

---

### Task 5: `Account ▸ Sign In…` — a session for the native half

The web view authenticates by being a browser, but its Auth0 session lives in `WKWebView` localStorage while `AuthManager` uses `ASWebAuthenticationSession` and the Keychain. The two halves do not share a session, so after Task 4 the native shell has no way to become signed in.

This is **not** a stand-in for the web app's auth gate (that is its own pass — `src/App.jsx`, 1709 lines, eight steps). A menu bar is something a Mac app has and a web page cannot, so there is nothing on the Netlify site for it to be identical to, and it stays after the real gate lands.

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/AccountCommands.swift`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift` (add the command group)

**Interfaces:**
- Consumes: `AuthManager.login() async`, `AuthManager.logout()`, `AuthManager.isAuthenticated`, `AuthManager.userEmail`; `AppState.configure(auth:orgCode:)` (`AppState.swift:269`), `AppState.orgCode`, `AppState.matchEmail`, `AppState.loadAll() async`.
- Produces: `AccountCommands` — a `Commands`-conforming struct taking `auth: AuthManager` and `appState: AppState`.

- [ ] **Step 1: Create the commands**

Create `AccountCommands.swift`:

```swift
import SwiftUI

// MARK: - Account menu
//
// How the NATIVE half gets a session. The web half signs in by being a browser,
// but its Auth0 session lives in the WKWebView's localStorage while AuthManager
// uses ASWebAuthenticationSession and the Keychain — the two never share one.
//
// This is NOT the web app's auth gate. That is `src/App.jsx`: 1709 lines across
// eight steps, with a 460-line team picker, a PIN keypad, org creation, code
// recovery, three rejection screens and an animated lockup. It gets its own pass,
// ported faithfully.
//
// Nor is this a placeholder for it. A menu bar is something a Mac app has and a
// web page cannot, so there is nothing on the Netlify site for it to be identical
// to, and it stays once the real gate lands — the way Reload does. What it does
// not do is the gate's job: no org creation, no code recovery, no team picker, no
// domain or roster validation.
struct AccountCommands: Commands {
    let auth: AuthManager
    let appState: AppState

    @State private var orgCodeDraft = ""

    var body: some Commands {
        CommandMenu("Account") {
            if auth.isAuthenticated {
                // The signed-in identity, as a disabled row — a menu that only
                // offers "Sign Out" leaves you guessing who you are.
                Text(auth.userEmail ?? "Signed in")
                Divider()
                Button("Sign Out") { auth.logout() }
            } else {
                Button("Sign In…") {
                    Task {
                        await auth.login()
                        // Same order the org gate uses: a session is not usable
                        // until AppState knows which org it belongs to.
                        guard auth.isAuthenticated, !appState.orgCode.isEmpty else { return }
                        appState.matchEmail = auth.userEmail
                        appState.configure(auth: auth, orgCode: appState.orgCode)
                        await appState.loadAll()
                    }
                }
            }

            Divider()

            // Org code, typed. The real gate resolves this from the signed-in
            // email (APIService.lookupOrgByEmail) and can create one; this is the
            // manual path, which is all the native half needs to reach a screen.
            TextField("Org code", text: $orgCodeDraft)
            Button("Use Org Code") {
                let code = orgCodeDraft.trimmingCharacters(in: .whitespaces).uppercased()
                guard !code.isEmpty else { return }
                appState.orgCode = code
                guard auth.isAuthenticated else { return }
                appState.matchEmail = auth.userEmail
                appState.configure(auth: auth, orgCode: code)
                Task { await appState.loadAll() }
            }
            .disabled(orgCodeDraft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}
```

- [ ] **Step 2: Register it**

In `TRAQSDesktopApp.swift`, inside the existing `.commands { … }` block, after the `CommandGroup(after: .toolbar)`:

```swift
            AccountCommands(auth: auth, appState: appState)
```

- [ ] **Step 3: Build**

```bash
cd "TRAQS MacBook Native" && xcodebuild -project "TRAQS MacBook Native.xcodeproj" \
  -scheme "TRAQS MacBook Native" -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Verify a real sign-in reaches the shell**

Launch the app. Type your org code into `Account ▸ Org code` and choose **Use Org Code**, then `Account ▸ Sign In…` and complete Auth0 in the sheet that appears. Switch to Native mode.

Expected: the sidebar profile block shows your real name and role, the org label shows the org, and Approval Queue / Admin appear according to your actual permissions. The Account menu now shows your email and **Sign Out**.

If the Auth0 sheet does not appear, the presentation anchor is the thing to check — `AuthManager.swift:282` returns `NSApplication.shared.windows.first`, which needs a window on screen.

- [ ] **Step 5: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/AccountCommands.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift"
git commit -m "feat(mac): an Account menu, so the native half can hold a session

The web half signs in by being a browser, but that session lives in the
WKWebView's localStorage while AuthManager uses ASWebAuthenticationSession
and the Keychain — they never share one, so after the shell started reading
AppState the native half had no way to become signed in.

Not the web app's gate, and not a placeholder for it: a menu bar is
something a Mac app has and a web page cannot, so it stays once the real
eight-step gate lands. It does none of the gate's work — no org creation,
no code recovery, no team picker, no domain or roster checks."
```

---

### Task 6: `TPage` — one implementation of the page

Written before any screen exists, on purpose. The web app's own comment records what happens otherwise: a second hand-rolled copy of its page header omitted `minHeight` and drifted 0.8px, and titles visibly jumped between pages.

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/TPage.swift`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift` (`page` renders its placeholder through `TPage`)

**Interfaces:**
- Consumes: `EnvironmentValues.tqTheme` (Task 3), `TFont.body(_:_:)` (Task 2), `WebGlyph`/`WebIcon.back` (existing).
- Produces: `TPage<Right: View, Content: View>` with `init(_ title: String, onBack: (() -> Void)? = nil, right: @escaping () -> Right, content: @escaping () -> Content)` and a `Right == EmptyView` convenience overload. Also `TPageMetrics` (the copied numbers) and `TBackButton`. Task 7 puts glass controls in `right`; the Jobs pass uses `TPage` for its screen.

- [ ] **Step 1: Create `TPage`**

Create `TPage.swift`:

```swift
import SwiftUI

// MARK: - The page, copied from the web app
//
// Every number here is lifted from TRAQS.jsx, not chosen — see `TPageMetrics`.
//
// ONE implementation, and the web app already paid for the lesson. Its comment
// above `pageHead` (TRAQS.jsx:12771):
//
//   > One implementation on purpose: a second hand-rolled copy drifted by 0.8px
//   > because it omitted minHeight, and the title visibly jumped when you moved
//   > between pages.
//
// `Right` is a GENERIC parameter, never AnyView. The header's right cluster is
// where the app's one sanctioned divergence lives — real Liquid Glass buttons —
// and `glassEffectID` needs the view carrying a glass shape to be continuous. A
// single type erasure anywhere on that path turns the morph into a cross-fade.

/// The web app's page measurements, in one place so a screen cannot invent its own.
enum TPageMetrics {
    /// `frostScroll`'s default `pad` — "34px 32px 28px" (TRAQS.jsx:12791).
    static let padTop: CGFloat = 34
    static let padSide: CGFloat = 32
    static let padBottom: CGFloat = 28

    /// `pageHeader` (TRAQS.jsx:12731). `minHeight` is the header row's signature —
    /// the web app identifies its own header rows by it — and it is the number the
    /// drifting copy omitted.
    static let headerMinHeight: CGFloat = 50
    static let headerGap: CGFloat = 22
    static let headerBottomMargin: CGFloat = 18

    /// `pageTitleStyle` (TRAQS.jsx:12711). Weight 900 there; the browser clamps it
    /// to the heaviest loaded face, 800 — see `TFontName.face(forWebWeight:)`.
    static let titleSize: CGFloat = 44
    static let titleWeight: Int = 900
    /// `letterSpacing: "-0.07em"` — em-relative on the web, so points here.
    static var titleTracking: CGFloat { titleSize * -0.07 }
    static let titleLineHeight: CGFloat = 1.1

    /// `FIELD_COL_W` (TRAQS.jsx:12756). For form FIELDS ONLY. Pages themselves
    /// fill the panel edge to edge — that is what carries the background and keeps
    /// gaps off the right and bottom — and titles stay in the top-left corner.
    static let fieldColumnWidth: CGFloat = 1180
}

struct TPage<Right: View, Content: View>: View {
    @Environment(\.tqTheme) private var theme

    let title: String
    var onBack: (() -> Void)? = nil
    @ViewBuilder let right: () -> Right
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                header
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, TPageMetrics.padTop)
            .padding(.horizontal, TPageMetrics.padSide)
            .padding(.bottom, TPageMetrics.padBottom)
        }
        // Never an opaque background. The content panel paints the theme's bg
        // behind every page, so a page that fills its own hides it — which on the
        // web is exactly what went wrong with liquid and image backgrounds.
        .background(Color.clear)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: TPageMetrics.headerGap) {
            // Back LEADS the row, ahead of the title. Per the web app: a page you
            // can go back from puts Back in the same spot every time, and putting
            // it after the title would move it with the title's length.
            if let onBack { TBackButton(action: onBack) }

            Text(title)
                .font(TFont.body(TPageMetrics.titleSize, TPageMetrics.titleWeight))
                .tracking(TPageMetrics.titleTracking)
                .lineSpacing(TPageMetrics.titleSize * (TPageMetrics.titleLineHeight - 1))
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)

            // `right` is whatever used to sit in the top-left — a toolbar,
            // filters, a count. It moves to the right of the title, and takes the
            // remaining width so it can wrap.
            right()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: TPageMetrics.headerMinHeight)
        .padding(.bottom, TPageMetrics.headerBottomMargin)
    }
}

extension TPage where Right == EmptyView {
    /// A page with no header controls.
    init(_ title: String,
         onBack: (() -> Void)? = nil,
         @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, onBack: onBack, right: { EmptyView() }, content: content)
    }
}

extension TPage {
    init(_ title: String,
         onBack: (() -> Void)? = nil,
         @ViewBuilder right: @escaping () -> Right,
         @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, onBack: onBack, right: right, content: content)
    }
}

// MARK: - Back
//
// `backBtn` (TRAQS.jsx:12762). Solid tokens only — no translucent colour that
// could resolve white-on-white; it reads the same whatever it sits on.
//
// NOT glass, deliberately, even though it is a button. It is one of the elements
// the web app already opts out of its own button chrome, and the sanctioned
// divergence is the header's ACTION buttons, not its navigation.
struct TBackButton: View {
    @Environment(\.tqTheme) private var theme
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                WebGlyph(spec: WebIcon.back, size: 16, color: theme.text)
                Text("Back")
                    .font(TFont.body(13, 700))
                    .foregroundStyle(theme.text)
            }
            .padding(.leading, 12)
            .padding(.trailing, 16)
            .padding(.vertical, 8)
            .background(Capsule().fill(hovering ? theme.surface : theme.card))
            .overlay(Capsule().stroke(theme.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .onHover { hovering = $0 }
    }
}
```

- [ ] **Step 2: Render the placeholder through `TPage`**

In `NativeShell.swift`, replace the `page` property:

```swift
    private var page: some View {
        ZStack {
            theme.bg
            // Still a placeholder — no screen is ported in this pass. It goes
            // through TPage so the chrome is exercised (and visibly wrong if the
            // copied numbers are wrong) before any real screen depends on it.
            TPage(settingsMode ? settingsSection.label : view.label) {
                Text("Not ported yet")
                    .font(TFont.body(15))
                    .foregroundStyle(theme.textDim)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
```

- [ ] **Step 3: Confirm `WebIcon.back` exists**

```bash
cd "TRAQS MacBook Native" && grep -n "static let back" "TRAQS MacBook Native/WebIcons.swift"
```

Expected: a match — `settingsNav` already uses `WebIcon.back`. If it is missing, copy the `<svg>` for the back chevron out of TRAQS.jsx per the instructions at the top of `WebIcons.swift`; do not substitute an SF Symbol.

- [ ] **Step 4: Build and compare against the web app**

```bash
xcodebuild -project "TRAQS MacBook Native.xcodeproj" -scheme "TRAQS MacBook Native" \
  -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`. Launch, switch to Native mode, and compare the title's position and size against the same page on the deployed site. The title should sit at the same offset from the panel's top-left corner and be the same height. (Task 8 makes this comparison a side-by-side instead of a from-memory one.)

- [ ] **Step 5: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/TPage.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift"
git commit -m "feat(mac): TPage, the web app's page chrome in one place

Padding, header row, title and the field-column cap, every number lifted
out of TRAQS.jsx rather than chosen. One implementation because the web app
already paid for the alternative: a second hand-rolled copy omitted
minHeight, drifted 0.8px, and titles visibly jumped between pages.

The header's right cluster is a GENERIC parameter, never AnyView — that is
where the glass buttons go, and glassEffectID needs the view carrying a
glass shape to be continuous."
```

---

### Task 7: Real Liquid Glass, and one morph mechanism

The shell's own comment says "buttons are real Liquid Glass, and the active pill morphs from row to row". Neither is true: `grep glassEffect` over the Mac sources returns nothing, and the pill is `Capsule().fill(accent.opacity(0.18))` moved by `matchedGeometryEffect`.

**Files:**
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift` (`sidebar` wrapped in a container; `navRow`'s active background; the file's header comment)
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/GlassControls.swift`

**Interfaces:**
- Consumes: `EnvironmentValues.tqTheme` (Task 3), `TFont` (Task 2).
- Produces: `TGlassButton<Label: View>` — a generic, non-erased glass control for `TPage`'s `right` cluster. The Jobs pass uses it and hoists its controls into a never-unmounting host.

- [ ] **Step 1: Convert the sidebar pill to `glassEffectID`**

Two edits in `NativeShell.swift`.

The `sidebar` body must sit inside a `GlassEffectContainer` — `glassEffectID` has no effect outside one. Wrap the existing `VStack`:

```swift
    private var sidebar: some View {
        // glassEffectID does nothing outside a container. `spacing: 0` because
        // only ONE shape in here carries glass — the active pill — so there is
        // nothing for a fuse distance to weld it to. (That precondition becomes
        // live in the page header, where several controls sit 14pt apart; see
        // GlassControls.)
        GlassEffectContainer(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                hamburger
                Group {
                    if settingsMode { settingsNav } else { mainNav }
                }
                .padding(.horizontal, navPad)

                Spacer(minLength: 0)
                orgLabel
                profile
            }
        }
        .frame(width: railWidth, alignment: .leading)
        .background(theme.surface)
        .clipped()
    }
```

Then, in `navRow`'s `.background { ZStack { … } }`, replace the active branch:

```swift
                if active {
                    // ONE shape, handed from row to row — the pill travels rather
                    // than being redrawn where you tapped.
                    //
                    // glassEffectID, not matchedGeometryEffect. Both move a shape,
                    // but only this one carries the MATERIAL across: the glass
                    // resamples what is behind it as it travels instead of a
                    // flat fill sliding over the rail. One mechanism in the app
                    // rather than two.
                    Color.clear
                        .glassEffect(.regular.tint(theme.accent.opacity(0.18)), in: .capsule)
                        .glassEffectID("nav.active", in: navGlass)
                }
```

Keep the `else if let fill` and `else if hovered == key` branches exactly as they are — those are not glass.

- [ ] **Step 2: Update the file's header comment so it stops lying**

At the top of `NativeShell.swift`, replace the "ONE intended difference" paragraph:

```swift
// The ONE intended difference from the web app: buttons are real Liquid Glass —
// native `glassEffect`, not the CSS imitation the web view wears (MacNativeSkin,
// which is injected into the WEB VIEW only and never touches native views). The
// active nav pill travels on `glassEffectID`, so the material moves with it.
```

- [ ] **Step 3: Create the glass control for page headers**

Create `GlassControls.swift`:

```swift
import SwiftUI

// MARK: - Glass controls
//
// The app's one sanctioned divergence from the web app. Everything else is copied
// verbatim; header buttons are native Liquid Glass.
//
// THE FOUR PRECONDITIONS for a morphing glass cluster, learned on iOS the
// expensive way (attempted and reverted 2026-08-26, rebuilt 2026-08-27 in
// `bff1cb1`). All four must hold or the morph silently degrades to a cross-fade:
//
//  1. THE HOST MUST NEVER UNMOUNT. Controls owned by the pages give the container
//     nothing to morph FROM — a page swap happens in a single frame. So header
//     controls are hosted above the page and pages DECLARE what the header holds.
//     Not needed yet (one placeholder page), and the Jobs pass does the hoisting.
//  2. NOTHING ON THE PATH MAY BE TYPE-ERASED. The big one. `glassEffectID`
//     interpolates a glass shape and needs the carrying view continuous. Three
//     separate AnyView designs each failed on iOS. Controls are DATA through a
//     concrete `switch`, or generic parameters — never AnyView. That is why
//     `TGlassButton` and `TPage.Right` are generic.
//  3. THE CHANGE NEEDS AN ANIMATED TRANSACTION. `.animation(_:value:)` on the
//     container is NOT equivalent — the host mirrors the selection into its own
//     @State inside `withAnimation`.
//  4. THERE MUST BE A FUSE WINDOW. `GlassEffectContainer(spacing:)` melts shapes
//     closer than `spacing`. It has to sit BELOW the resting gap or every control
//     welds into one permanent blob, but not so far below that shapes crowding
//     during a morph never cross it. iOS settled on a 14pt gap against a 10pt
//     fuse; those are the numbers below.
//
// Also carried over: ONE shape primitive everywhere. A Capsule on a square frame
// IS a circle — mixing `Circle` and `Capsule` hands the container two unrelated
// shapes. And share ids across screens so shapes flow rather than insert/remove.

enum TGlassMetrics {
    /// Resting gap between header controls. Above `fuseDistance`, so controls stay
    /// separate shapes at rest.
    static let clusterGap: CGFloat = 14
    /// `GlassEffectContainer(spacing:)`. Below `clusterGap` — that ordering is the
    /// whole mechanism, and inverting it welds the cluster into one blob.
    static let fuseDistance: CGFloat = 10
}

/// A header action button. Generic in its label, never AnyView — see precondition 2.
struct TGlassButton<Label: View>: View {
    @Environment(\.tqTheme) private var theme

    /// Shared across screens so the shape FLOWS between headers rather than being
    /// removed and inserted.
    let glassID: String
    let namespace: Namespace.ID
    var tint: Color? = nil
    let action: () -> Void
    @ViewBuilder let label: () -> Label

    var body: some View {
        Button(action: action) { label() }
            .buttonStyle(.plain)
            // ORDER MATTERS: appearance, then the effect, then the id.
            .glassEffect(.regular.tint(tint ?? theme.accent.opacity(0.18)).interactive(),
                         in: .capsule)
            .glassEffectID(glassID, in: namespace)
    }
}
```

- [ ] **Step 4: Build**

```bash
cd "TRAQS MacBook Native" && xcodebuild -project "TRAQS MacBook Native.xcodeproj" \
  -scheme "TRAQS MacBook Native" -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Verify the morph, at speed**

Launch, switch to Native mode, and click down the sidebar rows.

Expected: the active pill *travels*, and it is visibly glass — it refracts the rail behind it as it moves, rather than being a flat tint sliding over it.

**Check it fast as well as slow.** Per the iOS notes, the tell for a broken morph is "animates when I switch slowly, jumps when I switch fast" — that symptom means something is re-rendering the host a beat after the change, and it does not show up if you only click gently.

- [ ] **Step 6: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/GlassControls.swift"
git commit -m "feat(mac): real Liquid Glass, and one morph mechanism

The shell claimed 'buttons are real Liquid Glass, and the active pill
morphs' while containing no glassEffect at all — the pill was a flat
capsule fill on matchedGeometryEffect. It travels on glassEffectID now, so
the material moves with it, and the file's comment is true.

GlassControls carries the four glassEffectID preconditions from the iOS
build so the Mac header does not repeat the 2026-08-26 dead end. Both
TGlassButton and TPage's right cluster are generic rather than AnyView,
which is precondition 2 and the one that silently degrades a morph to a
cross-fade."
```

---

### Task 8: `ParityView` — see both at once

The whole project rests on "the numbers are copied, not chosen", and there is currently no way to check that. The Native-UI toggle *replaces* the window, so every comparison is against memory.

**Files:**
- Create: `TRAQS MacBook Native/TRAQS MacBook Native/ParityView.swift`
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift` (`RootView` renders `ParityView`; the toolbar toggle becomes a three-way picker; `webView` moves)

**Interfaces:**
- Consumes: `SiteStore` (existing), `NativeShell()` (Task 4), `WebViewHost(store:)` (existing).
- Produces: `ParityView(store:)` and `ParityMode` (`native`/`split`/`web`, `@AppStorage("traqs.parityMode")`).

- [ ] **Step 1: Create `ParityView`**

Create `ParityView.swift`:

```swift
import SwiftUI

// MARK: - Native, Split, Web
//
// The project's premise is that the Mac app is a visual COPY of the Netlify site,
// with only the buttons diverging. That premise needs checking on every screen,
// and it was previously unfalsifiable: the Native-UI toggle swapped the whole
// window, so a comparison meant flipping back and forth and trusting memory.
//
// Split renders both halves side by side. This is the mode the port is meant to
// be done in — Native and Web are for using the thing.
//
// The web half stays until the last screen lands.
enum ParityMode: String, CaseIterable, Identifiable {
    case native, split, web
    var id: String { rawValue }
    var label: String {
        switch self {
        case .native: return "Native"
        case .split:  return "Split"
        case .web:    return "Web"
        }
    }
}

struct ParityView<Web: View>: View {
    @Binding var mode: ParityMode
    /// Generic, not AnyView: the native half's header carries glass, and a type
    /// erasure on that path degrades the morph (see GlassControls, precondition 2).
    @ViewBuilder let web: () -> Web

    var body: some View {
        switch mode {
        case .native:
            NativeShell()
        case .web:
            web()
        case .split:
            HSplitView {
                NativeShell()
                    .frame(minWidth: 420)
                web()
                    .frame(minWidth: 420)
            }
        }
    }
}
```

`HSplitView` rather than a plain `HStack` on purpose: the divider is draggable, so you can widen one half to inspect a detail without leaving the mode.

- [ ] **Step 2: Wire it into `RootView`**

In `TRAQSDesktopApp.swift`, replace `@AppStorage("traqs.useNativeUI") private var useNativeUI = false` with:

```swift
    @AppStorage("traqs.parityMode") private var mode: ParityMode = .web
```

and replace the `body`'s `Group { if useNativeUI { … } else { webView } }` with:

```swift
        ParityView(mode: $mode) { webView }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $mode) {
                    ForEach(ParityMode.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .help("Native rebuild, the deployed web app, or both side by side")
            }
        }
```

`@AppStorage` needs `ParityMode: RawRepresentable` with a `String` raw value — it already is.

- [ ] **Step 3: Build**

```bash
cd "TRAQS MacBook Native" && xcodebuild -project "TRAQS MacBook Native.xcodeproj" \
  -scheme "TRAQS MacBook Native" -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`. If `webView`'s own `.toolbar` modifiers conflict with the principal item, leave them — they attach inside the web branch and only apply when that branch renders.

- [ ] **Step 4: Verify all three modes, and use Split for a real check**

Launch and step through Native, Split, Web. In **Split**, put the same page on both halves and compare:

- the page title's size, weight and left offset (Task 6's copied numbers)
- the sidebar's type — DM Sans on both, same glyph shapes (Task 2)
- the sidebar rail's width, row height and the gap between rows
- the active pill: glass on the native half, flat on the web half. **This one is supposed to differ** — it is the sanctioned divergence.

Anything else that differs is a bug in a copied number. Note it; do not fix it inside this task.

- [ ] **Step 5: Commit**

```bash
git add "TRAQS MacBook Native/TRAQS MacBook Native/ParityView.swift" \
        "TRAQS MacBook Native/TRAQS MacBook Native/TRAQSDesktopApp.swift"
git commit -m "feat(mac): Native / Split / Web, so 'identical' can be checked

The project's premise is that the Mac app is a visual copy of the Netlify
site with only the buttons diverging, and that was unfalsifiable: the old
toggle swapped the whole window, so every comparison ran against memory.
Split renders both halves side by side on a draggable divider, which is the
mode the port is meant to be done in."
```

---

### Task 9: Both apps still green, and the spec's claims are true

The last two tasks touched shared files and the shell's own documentation. This task is the whole-pass check.

**Files:**
- Modify: `TRAQS MacBook Native/TRAQS MacBook Native/NativeShell.swift` (only if a stale comment survives)

- [ ] **Step 1: iOS builds and its tests pass**

Run from `TRAQS Scheduling/`:

```bash
xcodebuild -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug build 2>&1 | grep -E "error:|BUILD"
xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests" 2>&1 | grep -E "\*\* TEST|error:"
```

Expected: `** BUILD SUCCEEDED **` and `** TEST SUCCEEDED **`. Task 1 changed a file both apps compile.

- [ ] **Step 2: Mac builds clean**

```bash
cd "TRAQS MacBook Native" && xcodebuild -project "TRAQS MacBook Native.xcodeproj" \
  -scheme "TRAQS MacBook Native" -configuration Debug build 2>&1 | grep -E "error:|warning:|BUILD"
```

Expected: `** BUILD SUCCEEDED **`, no new warnings.

- [ ] **Step 3: No lies left in the comments, and no leftover fiction**

```bash
cd "TRAQS MacBook Native" && \
  grep -rn "Treysen Parkinson\|MATRIX SYSTEMS\|useNativeUI" "TRAQS MacBook Native/"; \
  grep -rn "matchedGeometryEffect" "TRAQS MacBook Native/" | grep -v "^\S*: *//"; \
  grep -rn "TFont.body(.*\.\(bold\|semibold\|medium\|regular\)" "TRAQS MacBook Native/"
```

Expected: **no output at all.** Any hit is leftover from Tasks 2, 4, 7 or 8 — fix it before committing.

The `matchedGeometryEffect` grep filters comment lines on purpose: Task 7 leaves one mention in a comment explaining why `glassEffectID` is used instead, and that line is meant to stay.

- [ ] **Step 4: Walk the spec's Verification section**

Open `docs/superpowers/specs/2026-08-28-mac-native-foundation-design.md` and confirm each of its six numbered verification items, including the two that need a person: the font assertion and the split-mode type comparison (item 5), and the morph checked *at speed* (item 6).

- [ ] **Step 5: Commit anything Step 3 turned up**

```bash
git add -A "TRAQS MacBook Native"
git commit -m "chore(mac): clear the last of the placeholder shell

Leftovers from the foundation pass: hardcoded names, the retired
useNativeUI flag, matchedGeometryEffect, and TFont calls still passing a
Font.Weight instead of the web's weight number."
```

---

## Plan Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| §1 Signing in — a menu command | Task 5 |
| §2 `ThemeEnvironment` | Task 3 |
| §3 `NativeShell` reads real data | Task 4 |
| §4 `TPage` | Task 6 |
| §5 DM Sans + real weights | Tasks 1, 2 |
| §6 Liquid Glass + the morph | Task 7 |
| §7 `ParityView` | Task 8 |
| Known loose end: theme source | Task 3, Step 1 (the `TODO` in `MacTheme`) |
| Verification 1–6 | Task 9 |

No gaps.

**Type consistency:** `TFontName.face(forWebWeight:)` is defined in Task 1 and called in Task 2 only. `TFont.body(_:_:)` takes `(CGFloat, Int)` from Task 2 onward and is called that way in Tasks 4, 6 and 7. `EnvironmentValues.tqTheme` is defined in Task 3 and read in 4, 6, 7. `TPage`'s `Right` generic is introduced in Task 6 and consumed by `TGlassButton` in Task 7. `ParityMode` is defined and used in Task 8 only.

**Known deviation from the skill's TDD default, stated rather than hidden:** only Task 1 has a failing-test-first cycle. The Mac target has no test target (one `PBXNativeTarget`, product type application), and Tasks 2–8 are wiring, layout constants and view code — there is nothing to assert that would not just restate the constant. Task 1 carries the one piece of real logic, placed in shared `Services/` precisely so the existing iOS test target can reach it, per the repo's convention that testable logic lives there as a caseless `enum` of `static` functions. Everything else is verified by build plus the split-mode comparison the pass exists to enable.
