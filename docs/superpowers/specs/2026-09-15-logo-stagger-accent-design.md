# iOS: the logo palette as a staggered, navigation-derived accent

Date: 2026-09-15
Scope: `TRAQS Scheduling` (native SwiftUI app) only. No web-app changes, no macOS changes.

Follows commit `241d2f7`, which shipped the new app icon: four bars in coral, amber, sky
and green, drawn through Icon Composer glass. The icon now carries a four-colour brand
palette that the app itself knows nothing about. This spec closes that gap.

## Problem

The accent system is single-valued by construction. `ThemeSettings.accentPresets` is
`[String]` — eight hexes — and choosing one sets `T.accent` plus three derived tokens
through `applyAccentToT()`. Every accent deliberately yields a *same-hue* two-stop
gradient; the file records that hue rotation was tried and rejected because the far stop
"read as a completely different color."

That design is correct for a single accent and has no room for four. The app ships an
icon built from four brand colours and then renders itself in one blue.

## Goals

1. A new accent mode in which the four icon colours are distributed across the app, one
   per tab, so moving between tabs moves the accent.
2. That mode is the default for new installs and the target of Reset.
3. The in-app bars mark (`TRAQSBarsMark`) draws in the icon's own four colours, so the
   logo in the header matches the logo on the springboard.
4. The splash load-up wash carries all four colours at once.
5. Each page's liquid wash carries that page's colour.
6. Existing users who have chosen an accent keep it.

## Non-goals

- Changing what any of the 85 `T.accent*` read sites do. The value moves under them; the
  contract does not change.
- Multiple accents visible simultaneously inside one page. The stagger axis is
  navigation, not layout — one accent is live at any instant.
- Touching the eight existing solid presets or the custom colour picker.
- Any change to the `.solid` path's behaviour. With `.solid` selected the app renders
  exactly as it does today.
- Web or macOS. `LiquidBackground` is a port of the web's Liquid mode; the web keeps its
  own accent model.

## Decisions taken during design

Recorded because each had live alternatives:

- **Stagger axis: per tab**, not per list row, per section, or a four-stop gradient. One
  accent is live at a time, so every `T.accent*` site keeps working unchanged and no
  single view has to reconcile four accents.
- **Five tabs, four colours: Home takes the hero.** The longest bar is the sky one and it
  is the icon's hero; Home is the centre tab and the app's resting state. Coral repeats on
  `.stats`, at the opposite end of the bar from `.jobs`.
- **Default scope: new installs and Reset.** Users with a saved accent keep it. No
  migration flag, no surprise reskin for anyone on 1.3.x.
- **Splash wordmark contrast follows the theme, not the wash.** See "The splash contrast
  problem" below.
- **Splash blob colours are the sampled icon hexes**, not literal red/blue/green/yellow.
  The request named four hues; coral/sky/green/amber are those four, and sampling keeps
  the splash and the icon from drifting.

## The palette

New file `TRAQS Scheduling/TRAQS Scheduling/Services/LogoPalette.swift`.

```swift
enum LogoPalette {
    static let coral = "#FF826A"   // bar 1, top
    static let amber = "#F4B61E"   // bar 2
    static let sky   = "#41C9FA"   // bar 3, full width — the hero
    static let green = "#1E8D6F"   // bar 4, bottom, shortest
    static let ordered = [coral, amber, sky, green]   // top → bottom, as the icon draws them
}
```

Values are sampled from the centre pixel of each bar in the shipped asset
(`AppIcon.icon/Assets/traqs-bars-candy-v2.png`, sRGB). Hex rather than `Color` so the file
needs no SwiftUI and compiles wherever the test target does — the same reason `JobPalette`
is hex.

`ordered` is the single source of truth for bar order. `TRAQSBarsMark` and the splash wash
both index it; the tab map names its members individually.

## Accent becomes a mode

```swift
enum AccentMode: String, CaseIterable { case solid, logoStagger }
```

`ThemeSettings` gains:

- `var accentMode: AccentMode` — persisted under `themeAccentMode`.
- `var activeTab: TTab` — the tab the stagger reads from. Defaults to `.home`, matching
  `AppNav.selected`'s own default. Not persisted; nav sets it on every launch.
- `var activeAccent: String` — **the value that feeds `applyAccentToT()`**. Computed:
  `.solid` → `accent`; `.logoStagger` → `LogoPalette` colour for `activeTab`.

`accent` keeps its present meaning: the user's saved *solid* choice. Stagger never writes
it. This is what lets a user flip to stagger, flip back, and land on the colour they had.

`applyAccentToT()` changes one line — it reads `activeAccent` instead of `accent`. The
derived tokens (`accentGradientStart/End`, `glowBlob`, `ctaGlowColor`) and the same-hue
derivation in `derivedEnd(from:)` are untouched and keep working per-colour.

### Persistence and the existing-user rule

On `init`:

| `themeAccentMode` | `themeAccent` | Result | Why |
|---|---|---|---|
| present | — | use it | explicit choice |
| absent | present | `.solid` | saved a theme once, so chose an accent — keep it |
| absent | absent | `.logoStagger` | fresh install, no preference to respect |

`themeAccent` is written by `commitChanges()` only, so its presence is a reliable proxy
for "this user has saved a theme at least once."

`defaultAccentMode = .logoStagger`. `reset()` sets it alongside the other defaults.

Read with `object(forKey:) as? String`, not `string(forKey:)`, for the same reason the
file already documents for the two Bool flags: a missing key must be distinguishable from
a written one.

### Preview / commit

`accentMode` joins the existing preview-snapshot machinery: a `savedAccentMode` field,
captured in `beginPreview()`, restored in `cancelPreview()`, persisted in
`commitChanges()`. `setAccentMode(_:)` mirrors `setAccent(_:)` — live preview, no
persistence.

## Theme learns about navigation

This is the structural change, and the reason this is not a bounded task.

`ThemeSettings` lives in `Services/` and today knows nothing about navigation.
`.logoStagger` requires it to know which tab is showing.

The edge is one-way and thin:

```swift
func setActiveTab(_ tab: TTab)   // on ThemeSettings
```

`MainTabView` calls it from `.onChange(of: nav.selected)`. **Nav pushes; theme never
imports, observes or retains `AppNav`.** `TTab` already lives in
`Services/NavigationTypes.swift` — moved there precisely so the state layer would stop
depending upward on the views — so `ThemeSettings` referencing `TTab` introduces no new
layering violation.

In `.solid`, `setActiveTab` stores the tab and returns without touching `T.*`.

### The map

```
.jobs  → LogoPalette.coral   #FF826A
.hours → LogoPalette.amber   #F4B61E
.home  → LogoPalette.sky     #41C9FA     hero bar, hero tab
.chat  → LogoPalette.green   #1E8D6F
.stats → LogoPalette.coral   #FF826A     repeat
```

Amended during review: the plan overrode this on testability grounds and the code
follows the plan, not this section as originally written. The map lives as
`LogoPalette.accent(for:)` in `Services/LogoPalette.swift`, not as a `TTab` extension in
`Views/MainTabView.swift` — a `private` extension inside a View file cannot be reached
from the test target, and `LogoPaletteTests` covers exactly this table, which fails
silently (wrong colour, no crash) when it's wrong.

`tabBarOrder` is `[.jobs, .hours, .home, .chat, .stats]`, so the two coral tabs sit at
opposite ends of the bar and never touch.

### Observation

Twenty-four code sites across twelve files read the `ThemeSettings` instance's `.accent`
directly (as against the 85 `T.accent*` sites, which are untouched). Nineteen are
deliberate no-op reads (`_ = theme.accent`) whose only job is to register an `@Observable`
dependency so the view re-renders when the theme changes. Those must move to
`activeAccent`, or they will not re-render on a tab change.

Five, in four files, are real reads rather than observation tokens, and each needs its
own decision:

- `LiquidBackground.swift:314` — `color ?? theme.accent` → `activeAccent`. This is what
  delivers goal 5.
- `SharedComponents.swift:191` — `TRAQSBarsMark`'s accent bar. Superseded by the four-
  colour treatment below.
- `SplashView.swift:46` — wordmark contrast. See "The splash contrast problem".
- `CustomizeView.swift:29,110` — selection state and the colour-picker seed. These must
  keep reading `accent`, the saved solid choice, **not** `activeAccent`. Otherwise the
  solid swatches show a selection while stagger is active.

### Transition

`setActiveTab` wraps its `T.*` write in `withAnimation(.easeInOut(duration: 0.35))`.

`T.*` are plain `static var`s re-read during render, not animatable values, so a crossfade
is an expectation and not a guarantee. It must be verified on device before the feature is
called done. If SwiftUI does not interpolate the fills, the fallback is an explicit
`.animation(_:value:)` on `activeAccent` at the few highest-visibility sites (nav pill
highlight, CTAs, the wash) rather than a global mechanism.

## The bars mark

`TRAQSBarsMark` draws four bars at widths `[0.554, 0.788, 1.0, 0.451]` top to bottom with
`accentIndex = 2` — the full-width bar — filled from the accent, the other three from
`T.muted`.

That geometry already matches the icon: four bars, third longest. So the change is a fill
swap, not a redraw.

- `.logoStagger` → bar `i` fills from `LogoPalette.ordered[i]`.
- `.solid` → unchanged: three muted, one accent.

The mark stays four-colour on every tab. It is the logo; it does not stagger.

Its observation read (`themeSettings.accent`, line 191) becomes a read of `accentMode` and
`activeAccent` so it re-renders when the mode changes.

`TRAQSHeaderLogo` and `TRAQSNavLogo` compose the mark and need no change.

## The splash wash

`LiquidBackground.specs` builds exactly two blobs: `(0..<2)`, two hues derived from one
base, two paths, two tempos (`[23, 29]`), two alphas (`[0.58, 0.50]`), anchored on
opposite corners of a diagonal.

The file's own header notes that this replaced "the four hardcoded aurora blobs" from the
original Claude Design spec. This restores four, in brand colours.

Add an override:

```swift
var palette: [String]? = nil
```

When non-nil, `specs` builds one blob per entry instead of deriving a pair from a single
base:

- **Hues** — each entry through `LiquidColor.vivid(_, saturation)`, the same treatment the
  derived pair gets. No `companion`/`tertiary` derivation; the palette *is* the ladder.
- **Tempos** — four coprime durations in the established band, e.g. `[23, 29, 31, 37]`, so
  no two blobs ever re-sync.
- **Paths** — the existing `LiquidPath.a` / `.b` and their reverses, one per blob, so no
  two share a trajectory.
- **Anchors** — four corners rather than the pair's diagonal, restoring the original
  aurora composition.
- **Alphas** — lower than the pair's `[0.58, 0.50]`. Two blobs "have to carry it alone, so
  each one holds more pigment"; four stacking at that density will muddy toward grey where
  they overlap. Starting point `~[0.42, 0.38, 0.38, 0.34]`, to be tuned by eye.

`blurRadius`, `scale`, `amplitude` and the `a(_:)` thickness helper are untouched.

`SplashView` passes `palette: LogoPalette.ordered` and keeps its existing
`thickness: 1.6, energy: 3.4, saturation: 0.45` tuning, which the file documents as
deliberately louder than the page canvas.

The splash carries all four colours regardless of `accentMode`. It is the brand moment,
and it runs before any tab exists.

### The splash contrast problem

`markOnLightBackground` (`SplashView.swift:46`) chooses the wordmark's black-or-white by
reading `Color(hex: theme.accent).readableText`. Against a four-colour wash there is no
single accent to ask, and the answer genuinely differs per colour: amber `#F4B61E` wants a
black mark, green `#1E8D6F` wants white, and on a drifting wash they are adjacent.

**Decision: pin the splash mark to `theme.isLightTheme`** — the theme's own light/dark —
rather than to the wash. The ground underneath is already the theme's radial gradient
(white-ish or near-black), the blobs sit at partial alpha over it, and the mark resolves
with a light pool of its own behind it. The theme is the stable signal; the wash is not.

The pool ellipse below the mark keeps reading `T.accent` / `T.accentGradientStart` and
so takes the active tab's colour — correct, since it is a glow rather than a contrast
surface.

## Customize

The accent grid is a `LazyVGrid` of eight `AccentSwatch`es plus a trailing `ColorPicker`.

Add a leading swatch for `.logoStagger`, drawn as **four horizontal stripes** inside the
36pt circle, echoing the mark rather than a colour wheel — a quartered swatch reads as a
generic "multicolour" chip, where stripes say *this is the logo*. Selected when
`accentMode == .logoStagger`; tapping it calls `setAccentMode(.logoStagger)`.

Tapping any solid swatch or using the colour picker calls `setAccentMode(.solid)` as well
as `setAccent(hex)`, so choosing a colour is what leaves stagger.

Selection state for the solid swatches stays bound to `accent` **and** `accentMode ==
.solid`, so exactly one swatch in the row reads as selected at any time.

The grid is `count: 8`; a ninth swatch plus the picker makes ten cells. Move to
`count: 5` — ten cells fill two rows exactly, where 8 leaves a ragged row of two, and the
swatches gain breathing room at their existing 36pt.

## Files

| File | Change |
|---|---|
| `Services/LogoPalette.swift` | new — the four hexes and their order, and the `TTab → colour` map (`accent(for:)`) — kept here rather than a `MainTabView` extension so `LogoPaletteTests` can reach it |
| `Services/ThemeSettings.swift` | `AccentMode`, `activeAccent`, `activeTab`, persistence, `setActiveTab`, preview/commit/reset |
| `Services/NavigationTypes.swift` | unchanged — `TTab` already lives here |
| `Views/MainTabView.swift` | push `nav.selected` into theme |
| `Views/SharedComponents.swift` | `TRAQSBarsMark` four-colour fill |
| `Views/LiquidBackground.swift` | `palette` override; four-blob branch; `activeAccent` |
| `Views/SplashView.swift` | pass the palette; pin mark contrast to the theme |
| `Views/CustomizeView.swift` | the stagger swatch; mode-aware selection |
| 8 other view files | the 19 remaining `_ = theme.accent` observation reads → `activeAccent` |

## Verification

Per project convention the user builds and runs. The implementation's obligation is to
confirm the app compiles, plus these checks, which are behavioural and cannot be read off
the source:

1. Fresh install (no `themeAccentMode`, no `themeAccent`) lands on stagger.
2. A user with a saved accent lands on `.solid` with that accent.
3. Every tab change repaints nav pill, CTAs and wash to the mapped colour.
4. The crossfade in "Transition" actually interpolates, or the fallback is applied.
5. The bars mark shows four colours in stagger and three-muted-plus-accent in solid.
6. The splash shows four distinct blobs that do not muddy to grey where they overlap.
7. Selecting a solid swatch leaves stagger and the selection ring lands on one swatch.
