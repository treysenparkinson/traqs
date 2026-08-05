# iOS: liquid background as the default page canvas

Date: 2026-08-05
Scope: `TRAQS Scheduling` (native SwiftUI app) only. No web-app changes.

This is **phase 1 of two**. Phase 2 — converting every container and row in the app to
real frosted glass — is scoped at the end but specced separately, so the glass treatments
can be judged against the real background rather than guessed at.

## Problem

The liquid wash already exists and looks good, but it only appears for ~2.4s on the
splash (`Views/SplashView.swift:68`). Every actual page renders `AmbientBackground()` — a
static vertical gradient plus one faint glow blob. The app's most distinctive visual is
shown exactly where nobody can look at it.

## Goals

1. The liquid wash is the default background behind every page.
2. It can be switched off in Customize.
3. Its palette follows the user's chosen accent, with companion tones derived
   automatically.
4. It moves continuously, at a tempo that suits an all-day background rather than a
   splash screen.

## Non-goals

- Converting surfaces to frosted glass. That is phase 2 (see the end of this document).
- Changing the splash. Its louder `thickness: 1.6, energy: 3.4` tuning is correct for a
  2.4s appearance and stays as-is.
- Adding liquid as a third background *preset*. It is a layer over whichever preset is
  selected, not an alternative to them.
- Any web-app change. `LiquidBackground` is already a port of the web's Liquid mode; the
  web is not touched.

## What already works, and is therefore not being built

`LiquidBackground` (`Views/LiquidBackground.swift`) already:

- defaults `color` to `theme.accent` (line 192), then derives `LiquidColor.companion` and
  `LiquidColor.tertiary` from it (lines 193–194). Both rotations are constrained to the
  pick's own warm/cool family — warm is the wrapped 295°→55° arc, and `rotateInFamily`
  *reflects* off the ends rather than wrapping, so a rotation can never tip a warm pick
  into the cool family. **Goal 3 is already satisfied by construction.**
- accepts a `base:` shape style painted behind the blobs, so it composes over any ground.
- exposes `thickness` (pigment density; blur tightens as it rises) and `energy` (motion
  multiplier).
- honours `accessibilityReduceMotion` (line 256), freezing the wash. **No accessibility
  work is needed.**

The work here is wiring, tuning, and a toggle — not new rendering.

## Design

### 1. One branch point instead of 22 call sites

`AmbientBackground()` is called at 22 sites across 18 files. Rather than edit each to
choose a background, the component itself becomes the branch: liquid when the toggle is
on, today's gradient-plus-glow canvas when off. Call sites keep calling one thing, and the
toggle flips the entire app at once.

It is renamed `PageBackground`, with the existing static canvas kept as a private
`AmbientCanvas` for the off branch. The current name, whose doc comment reads "tinted
vertical canvas + faint glow blobs", would actively mislead once it can render an animated
wash. The rename is 22 mechanical one-line edits.

```
PageBackground
├── theme.liquidBackground == true  → LiquidBackground(base: presetGround, thickness: …, energy: 1)
└── theme.liquidBackground == false → AmbientCanvas   (today's gradient + GlowBlob, unchanged)
```

`presetGround` is the light gradient (`T.bgGradTop` → `T.bgGradBottom`) on a light preset
and flat `T.bg` on a dark one — the same choice `AmbientCanvas` makes today, so the ground
under the wash matches the selected preset. Liquid therefore works over both presets and
is not itself a preset.

### 2. `ThemeSettings.liquidBackground`

New `var liquidBackground: Bool = true`, persisted under `themeLiquidBackground`, read in
`init()` alongside `themeAccent` and the preset id.

It must be threaded through the **entire** preview lifecycle, which already exists for
accent and preset:

| Hook | Change |
| --- | --- |
| `setLiquidBackground(_:)` | new — live preview, mirrors `setAccent` / `setBgPreset`; does not persist |
| `beginPreview()` | snapshot into `savedLiquidBackground` |
| `cancelPreview()` | restore from `savedLiquidBackground` |
| `commitChanges()` | persist to UserDefaults |
| `reset()` | back to `true` |

Missing `cancelPreview` is the live failure mode: opening Customize, flipping the toggle,
then backing out **without** saving would leave the toggle stuck at the previewed value.
All five hooks are required, not optional.

Unlike accent and preset changes, this flag does not feed the `T.*` token table, so it
needs no `applyToT()` counterpart. Views observe it directly.

### 3. The Customize control

A toggle row in `CustomizeView`, placed with the background-preset section since that is
what it modifies. It calls `setLiquidBackground`, so it previews live exactly like the
accent swatches and preset rows, and is committed or reverted by the existing Save /
back-out paths.

### 4. Tuning: small scattered blobs at ~50% ground

Target balance: **~50% ground / 30% primary accent / 20% derived tones**, with the
distinct, visibly churning blobs of the splash rather than a diffuse wash.

Reaching that needed two changes to `LiquidBackground` itself, because the existing knobs
could not express it:

- **`thickness` is not the colour dial.** It fades pigment *and* widens the blur
  (`blurRadius = max(44, 80 / thickness)`), so lowering it yields the same colour as haze
  rather than less colour.
- **Blob size was hardcoded** at `w: 0.76, h: 0.34`, with blur in absolute points — so
  shrinking blobs under a fixed 100pt blur would dissolve them entirely.

New parameters, both defaulting to today's behaviour so the splash is untouched:

| Parameter | Default | Page canvas | Effect |
| --- | --- | --- | --- |
| `blobScale` | `1` | `0.55` | Shrinks blobs **and** re-lays them out. THE dial for ground-vs-colour. |
| `primaryWeighted` | `false` | `true` | Hue ladder 5:2:2 toward the primary instead of an even 3:3:3. |

`blobScale` cannot be a pure size multiplier. The original geometry covers the canvas by
hanging wide blobs off *alternating edges* so neighbours meet in the middle; shrunk, that
strands the centre bare. Below 1 the blobs therefore scatter across the width at
successive heights, and take their own vertical spacing — the fixed 0.13 step is tuned to
0.34-tall blobs and would bunch smaller ones into the top third. Blur also scales with
blob footprint now, which is what keeps a small blob reading as a shape.

The arithmetic behind the balance: nine ellipses of `0.76 · 0.34 · scale²` cover ≈55% of
the canvas before overlap, so `0.55` leaves roughly half as ground — the mode's own
near-white or near-black. The 5:2:2 ladder then splits that colour 56/22/22, giving about
28% primary and 22% derived.

Final page values: `blobScale: 0.55`, `thickness: 1.15`, `energy: 3.0`,
`primaryWeighted: true`.

`thickness` ends up *higher* than the 1.1 first planned, not lower. Once coverage sets the
overall colour, pigment is free to stay dense enough that each blob reads as a distinct
shape. `energy: 3.0` sits near the splash's 3.4 deliberately — the ask was for that kind
of visible churn — and also widens travel via `amplitude` (1.5× here), which keeps the
smaller blobs roaming the whole screen instead of each patrolling its own patch.

**Splash equivalence is by construction, not by inspection.** At `blobScale: 1` every
derived value reduces to its original expression, including
`blurRadius = 1 × max(44, 80 / thickness)`. `SplashView` has no edits.

## Risks

**GPU cost.** This replaces a static gradient with nine continuously-animating blobs,
each blurred 44–80pt, full-screen, on every page. `Primitives.swift:640` records a
full-screen offscreen pass being *removed* from Home/Stats/TimeClock for precisely this
reason, so this is knowingly spending back something previously reclaimed.

**Multiple live instances.** `TabHost` keeps all tabs alive, so several pages may each
hold a `PageBackground`. CoreAnimation should not rasterise views that aren't visible, so
the cost is expected to stay bounded to the front page — but this is an expectation, not a
measurement. If it proves wrong, the fix is hoisting a single instance to `MainTabView`
behind everything, with `PageBackground` rendering only the ground.

Both risks are why phase 1 ships alone: the background's own cost gets established before
phase 2 stacks ~119 blur passes on top of it.

## Files touched

| File | Change |
| --- | --- |
| `Services/ThemeSettings.swift` | `liquidBackground` flag + all five lifecycle hooks |
| `Views/Primitives.swift` | `AmbientBackground` → `PageBackground` branch + private `AmbientCanvas`; the three tuning dials |
| `Views/LiquidBackground.swift` | `blobScale` + `primaryWeighted`; blur scaled to blob footprint; scattered layout below full size |
| `Views/CustomizeView.swift` | toggle row |
| 22 call sites, 18 files | `AmbientBackground()` → `PageBackground()` (mechanical) |

## Verification

No view-level test coverage exists, so this is a clean build plus a visual pass. Per
project convention the user runs the simulator; the build is confirmed with `xcodebuild`.

1. Liquid appears behind every page, not just the splash. Check a page from each tab.
2. The toggle turns it off, and the old gradient-plus-glow canvas returns unchanged.
3. Changing the accent re-tints the wash live, and the companion tones stay in the same
   temperature family — check a warm pick (Amber `#f59e0b`) and a cool one
   (Cyan `#06b6d4`).
4. **Toggle it, then back out of Customize without saving — it must revert.** Same for
   Save keeping it, and across an app relaunch.
5. It reads as calm behind real content. If it competes for attention, lower `thickness`.
6. Both presets: the wash sits on the light gradient under White and on the dark ground
   under Charcoal, with no banding at either.
7. Scrolling a long list (All Jobs) stays smooth with the wash behind it. This is the
   baseline measurement phase 2 will be judged against.
8. Reduce Motion freezes the wash.

## Phase 2, for context only

Decided, not specced here:

- Every **container and row** — cards, panels, list rows, sheets, headers — becomes real
  frosted glass, using the same `glassPanel` recipe as the modals
  (`.ultraThinMaterial` + `T.surface @ 0.22`). Real blur, not a translucent fill.
- Small inline marks — status chips, department tags, badges, progress bars, buttons —
  keep their solid fills, so they read as opaque marks *on* the glass and status colours
  don't wash out.
- Scale: ~119 surfaces (58 `frostedCard`/`frostedPill` calls, 42 ad-hoc `T.surface` /
  `T.card` fills, 19 existing `glassEffect` sites).
- Known tension to be measured, not assumed: seven comments in the codebase record blur,
  shadow, and `compositingGroup` passes being stripped from repeated surfaces for GPU
  reasons — `Primitives.swift:737` and `:864`, `Primitives.swift:180`,
  `TasksView.swift:1296` and `:337`. The long lists (All Jobs, Messages inbox) are where
  this will show up first if it shows up at all.
