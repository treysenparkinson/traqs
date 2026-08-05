# iOS: frosted-glass modals and a Liquid Glass photo-source menu

Date: 2026-08-05
Scope: `TRAQS Scheduling` (native SwiftUI app) only. No web-app changes.

## Problem

The end-job photo prompt (`EndJobPhotoOverlay`, `Views/PanelPhotoSheet.swift`) reads as
a flat panel next to the break/lunch popup and the clock-in PIN pad, which are real
frosted glass. The cause is `.frostedCard()` (`Views/Primitives.swift:727`): despite the
name it paints an opaque `T.surface` fill plus a hairline border, with no blur.

Two views have already worked around this by hand-rolling the real recipe —
`ClockActionBanner` (`Views/ClockActionBanner.swift:125`) and `ClockPinOverlay`
(`Views/TimeClockView.swift:704`) — so the recipe is now duplicated, and the photo
overlay is the one modal still using the flat card.

Separately, the photo overlay's add-source picker is a stock `.confirmationDialog`
action sheet, which is visually unrelated to the rest of the app's Liquid Glass
surfaces.

Finally, all three modals sit on a plain black scrim (or, for the banner, on nothing at
all). A blurred backdrop would separate the modal from the page behind it far better
than tint alone.

## Goals

1. The photo prompt looks like the break/lunch popup: real frosted glass, same radius,
   same spring entrance.
2. Pressing the add control opens a Liquid Glass menu — Take Photo / Photo Album /
   Choose File — that morphs out of the `+` instead of an action sheet.
3. All three modals (photo prompt, break/lunch banner, clock PIN pad) share one
   backdrop that fades in and blurs the content behind it.
4. The glass recipe lives in exactly one place.

## Non-goals

- Making the photo mandatory. The **Skip — end without photo** bypass stays, per the
  existing `PanelPhotoSheet.swift:13` note that gating on `hasPhoto` is a later step.
- Changing any upload, attach, clock-out, or picker behaviour. All of
  `attachPanelPhoto`, `ImageDownscaler`, `CameraPicker`, `loadLibraryItem`,
  `handleFileImport`, and `filename(ext:)` are untouched.
- Retiring `.frostedCard()` app-wide. It has ~30 call sites on non-modal surfaces where
  a flat opaque card is the correct look; only modals move to glass.

## Design

### 1. `glassPanel(radius:)` — shared frost recipe

New `ViewModifier` in `Views/Primitives.swift`, alongside `FrostedCard`. Lifted verbatim
from the two existing hand-rolled copies so nothing shifts visually:

- `RoundedRectangle(cornerRadius: radius, style: .continuous)`
- `.ultraThinMaterial` fill, then `Color(hex: T.surface).opacity(0.22)` on top — the
  tint is the transparency knob; the material provides the actual blur
- `.compositingGroup()` then `.shadow(color: .black.opacity(0.22), radius: 24, x: 0, y: 10)`
- reads `_ = theme.accent` and `_ = theme.bgPresetId` so a live Customize change
  re-tints it, the same reason `FrostedCard` does

`ClockActionBanner` and `ClockPinOverlay` both switch to it and lose their local copies.
Neither should change appearance; that is the check for this step.

### 2. `ModalScrim` — fade-in dim plus backdrop blur

New view in `Views/Primitives.swift`. Takes a `progress: Double` (0 → 1) driving both
layers together, and an optional `onTap` closure:

- `Rectangle().fill(.ultraThinMaterial)` — samples and blurs the content behind
- `Color.black.opacity(0.22 * progress)` — the tint
- whole thing `.opacity(progress)`, `.ignoresSafeArea()`, `.contentShape(Rectangle())`

**Why a material and not `.blur()`:** `.blur()` has to be applied to the content being
blurred. `EndJobPhotoOverlay` is presented in a `.fullScreenCover`, a separate view
hierarchy with no handle on the Jobs list underneath it, so `.blur()` is unavailable
there. A material samples the real window backdrop through the cover's
`.presentationBackground(.clear)`, so it is the one approach that works identically at
all three call sites.

**Known tension:** the cards are themselves `.ultraThinMaterial`. With the same material
behind them, a card samples an already-blurred, already-dimmed scrim, so it renders
flatter and loses some of the texture that makes it read as glass over content. This is
why the tint is `0.22` rather than the `0.32` the PIN pad uses today — the blur now does
the separation work, so less tint is needed. If the blur reads too weakly in the
simulator the adjustment is the material tier (`.thinMaterial`, then `.regularMaterial`);
a material's blur radius is not directly settable, so that tier is the only dial.

### 3. Photo prompt restyle — `Views/PanelPhotoSheet.swift`

- card: `.frostedCard(radius: T.cornerHero)` → `.glassPanel(radius: 36)`, matching the
  banner's softer pebble radius rather than `T.cornerHero`'s 30
- backdrop: the local `Color.black.opacity(appear ? 0.45 : 0)` → `ModalScrim`, tap still
  calls `onClose(false)` and is still suppressed while `isWorking`
- entrance: `easeOut(0.22)` / `scaleEffect(0.92)` → `spring(response: 0.34, dampingFraction: 0.72)`
  / `scaleEffect(0.88)`, matching the banner
- unchanged: the 176pt dashed attachment square and its photo/file preview states, the
  `GradientCTA` **End Job** button with its `hasPhoto` gating and `Ending…` spinner, the
  **Skip** bypass, the panel title line, and the error text slot

### 4. Liquid Glass source menu — `Views/PanelPhotoSheet.swift`

`.confirmationDialog("Add a photo", …)` and its `showSourceDialog` state are removed.
Replacing them:

- the attachment square and the menu live inside a `GlassEffectContainer` sharing one
  `@Namespace`
- closed: the `+` glyph carries a `.glassEffectID` in that namespace
- open: three pills overlaid on the square, each
  `.glassEffect(.regular.interactive(), in: Capsule())` with its own `glassEffectID` in
  the same namespace — **Take Photo** (`camera`), **Photo Album** (`photo.on.rectangle`),
  **Choose File** (`folder`)
- the open/close toggle is animated so the container runs its fluid merge/split
- choosing a pill sets the existing `showCamera` / `showLibrary` / `showFiles` binding
  and closes the menu; tapping the card outside the pills closes it with no selection
- while the menu is open the scrim tap closes **the menu only**, not the whole overlay —
  otherwise a stray tap aimed at dismissing the menu would cancel the end-job. The scrim
  reverts to cancelling the overlay once the menu is closed.
- **Take Photo** keeps the existing `UIImagePickerController.isSourceTypeAvailable(.camera)`
  guard and its "No camera available on this device." error

**Expected result, stated plainly:** one shape becoming three is not a true 1:1 morph.
What this produces is glass separating out of the `+` and settling into pills, then
re-merging on close — recognisably Liquid Glass, but not a literal single-blob split.

### 5. Extend the scrim to the other two modals

In the order the user asked for — after the photo prompt is done.

- `ClockPinOverlay` (`Views/TimeClockView.swift:646`): `Color.black.opacity(0.32)` →
  `ModalScrim`. Tap-to-cancel and the `submitting` suppression are preserved.
- `ClockActionBanner`: gains a scrim it does not currently have. **This is a deliberate
  behaviour change.** Today the banner's backdrop is `Color.clear.allowsHitTesting(false)`
  (`ClockActionBanner.swift:81`) so the page behind stays visible and tappable; a scrim
  swallows those taps for as long as the banner is up. Acceptable because tap-anywhere
  dismissal and the 1.6s `autoDismissAfter` both already exist, so nothing can get
  stuck — but the page is untouchable for up to 1.6s, where it previously was not.

## Files touched

| File | Change |
| --- | --- |
| `Views/Primitives.swift` | add `glassPanel(radius:)` and `ModalScrim` |
| `Views/PanelPhotoSheet.swift` | glass card, scrim, spring entrance, Liquid Glass source menu |
| `Views/ClockActionBanner.swift` | use `glassPanel`, add scrim |
| `Views/TimeClockView.swift` | `ClockPinOverlay` uses `glassPanel` + scrim |

## Verification

The app has no view-level test coverage, so verification is a clean build plus a visual
pass. Per project convention the user runs the simulator; the build is confirmed with
`xcodebuild`.

Visual checks, in order:

1. Break/lunch banner and PIN pad are unchanged after the `glassPanel` extraction
   (step 1 in isolation).
2. The scrim's blur actually reads through the `fullScreenCover` on the photo prompt.
   This is the one item a compile cannot confirm and the most likely thing to need
   adjustment.
3. Cards still read as glass over the blurred scrim rather than blur-on-blur mush; if
   not, raise the material tier per §2.
4. The `+` → pills morph, and back.
5. All three sources still attach: camera, photo album, file. **End Job** stays disabled
   until something is attached, and **Skip** still ends the job without a photo.
