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

### 2. Modal backdrop — an invisible tap-catcher plus a page blur

There is no tint of any kind, and the scrim draws nothing. Separation comes entirely from
blurring the page behind the modal.

Two pieces in `Views/Primitives.swift`:

- `ModalScrim(onTap:)` — a full-screen, fully transparent tap target that sits under a
  modal card so a tap outside it dismisses. `.fill(.clear)` +
  `.contentShape(Rectangle())`, so it still catches every tap while drawing nothing.
- `.modalPageBlur(_ active: Bool)` — `.blur(radius: active ? 3 : 0)`, applied to the
  page **by whoever owns the page**. The radius is one constant,
  `modalPageBlurRadius`, and it is the only dial.

**A material scrim does NOT work here, and this was established by testing, not
theory.** The first implementation used `Rectangle().fill(.ultraThinMaterial)` on the
assumption that a material samples the real window backdrop through a cover's
`.presentationBackground(.clear)`. It does not. A material only blurs content inside its
own render surface, and `.fullScreenCover` is a separate presentation — so the scrim had
nothing behind it to sample, rendered as a flat wash, and the page stayed perfectly
sharp.

Fading a material's opacity to get a *slight* blur is also the wrong tool: it cross-fades
a fully-blurred layer against the sharp original, which reads as haze rather than as a
small blur radius. `.blur(radius:)` on the content is the only thing that produces a
genuinely gentle blur.

Because `.blur()` must be applied to the content being blurred, each modal reaches its
page differently:

| Modal | How the page gets blurred |
| --- | --- |
| End-job photo prompt (`.fullScreenCover`) | Can't blur the page from inside a separate presentation, so it sets `appNav.modalBlur` and `MainTabView` blurs `TabHost` + `TRAQSTabBar` as one group. The cover is unaffected by that blur and stays sharp automatically. |
| Clock PIN pads (in-hierarchy) | `TimeClockView` groups its own page content and applies `.modalPageBlur` directly. The nav bar is hidden outright for these, so there's nothing more to reach. |
| Lunch/break shout (in-hierarchy) | Same page blur as the PIN pads, **plus** `appNav.blurTabBar`, because the bar stays visible for this one (see §5) and is a sibling out in `MainTabView`, out of reach from inside the page. |

`modalBlur` and `blurTabBar` have to stay separate: `modalBlur` blurs the whole
`TabHost` group, and an in-hierarchy modal lives *inside* `TabHost`, so reusing it would
blur the modal along with everything else.

`appNav.modalBlur` is cleared both in the photo prompt's `onClose` and in an
`.onDisappear` failsafe — without the latter, a card torn down while the prompt is up
would leave the entire app blurred with no way back.

### 3. Photo prompt restyle — `Views/PanelPhotoSheet.swift`

- card: `.frostedCard(radius: T.cornerHero)` → `.glassPanel(radius: 36)`, matching the
  banner's softer pebble radius rather than `T.cornerHero`'s 30
- backdrop: the local `Color.black.opacity(appear ? 0.45 : 0)` → `ModalScrim`, tap still
  calls the cancel path and is still suppressed while `isWorking`
- entrance: **fades and scales up in place at the centre**, not the cover's slide-up from
  the bottom. `.fullScreenCover` animates its own presentation, so both setting and
  clearing `endJobTarget` are wrapped in `withTransaction(.noAnimation)` (a small
  `Transaction` extension) to suppress that, leaving the overlay's own
  `spring(response: 0.34, dampingFraction: 0.72)` / `scaleEffect(0.88)` as the only
  entrance — the same spring the banner uses. A matching `dismiss(clockOut:)` fades out
  over 0.18s before handing back to the caller; without it, killing the cover's animation
  would make the card vanish in a single frame on the way out.
- cancel: a 36pt glass `xmark` in the card's top-left, placed exactly like the PIN pad's
  (after the glass, before the outer frame, so it sits on the card rather than out in the
  backdrop). Backing out was previously only possible by tapping the backdrop, which
  nothing advertised. The card gains 28pt of top padding so the message clears it.
- the attachment square keeps its 176pt size and its photo/file preview states, but
  **loses its dashed border** — that outline read as clutter next to the glass "+". The
  soft tinted panel remains as the frame.
- unchanged: the `GradientCTA` **End Job** button with its `hasPhoto` gating and `Ending…`
  spinner, the **Skip** bypass, the panel title line, and the error text slot

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

- `ClockPinOverlay`: `Color.black.opacity(0.32)` → `ModalScrim`, plus the page blur.
  Tap-to-cancel and the `submitting` suppression are preserved. The nav bar continues to
  hide outright while a pad is up, as it already did.
- `ClockActionBanner`: gains a scrim it does not currently have. **This is a deliberate
  behaviour change.** Today the banner's backdrop is `Color.clear.allowsHitTesting(false)`
  (`ClockActionBanner.swift:81`) so the page behind stays visible and tappable; a scrim
  swallows those taps for as long as the banner is up. Acceptable because tap-anywhere
  dismissal and the 1.6s `autoDismissAfter` both already exist, so nothing can get
  stuck — but the page is untouchable for up to 1.6s, where it previously was not.
- **The nav bar stays put for the banner and blurs in place** rather than sliding away.
  An earlier revision slid it off via `hideTabBar`; blurring it alongside the page reads
  better and avoids the bottom safe-area inset collapsing and re-expanding over the
  banner's 1.6s life, which made page content jump.

  Consequence to be aware of: with the bar visible it renders *above* the banner in
  `MainTabView`'s ZStack, and the banner's tap-catcher doesn't cover it, so a tab tap
  still works while the shout is up. The two never overlap visually — the banner is
  centred at 260pt wide, the bar sits at the bottom edge — so this is left as-is rather
  than blocked.

## Files touched

| File | Change |
| --- | --- |
| `Views/Primitives.swift` | add `glassPanel(radius:)`, `ModalScrim`, `.modalPageBlur`, `Transaction.noAnimation` |
| `Views/PanelPhotoSheet.swift` | glass card, cancel X, centre fade, Liquid Glass source menu, no dashed border |
| `Views/ClockActionBanner.swift` | use `glassPanel`, add scrim |
| `Views/TimeClockView.swift` | `ClockPinOverlay` uses `glassPanel` + scrim; page content grouped and blurred; bar blurs (not hides) for the banner |
| `Views/MainTabView.swift` | group page + nav bar for `modalBlur`; blur the bar alone for `blurTabBar` |
| `Views/TasksView.swift` | drive `modalBlur`, suppress the cover's slide, `.onDisappear` failsafe |
| `Services/AppNav.swift` | add `modalBlur` and `blurTabBar` |

## Verification

The app has no view-level test coverage, so verification is a clean build plus a visual
pass. Per project convention the user runs the simulator; the build is confirmed with
`xcodebuild`.

Visual checks, in order:

1. Break/lunch banner and PIN pad are unchanged after the `glassPanel` extraction
   (step 1 in isolation).
2. **The page behind each modal is actually blurred.** This is the item a compile cannot
   confirm and the one that has already been wrong once — the first material-based
   attempt left the page perfectly sharp (§2). Check all three modals, and check that the
   nav bar blurs with the page for the photo prompt and the lunch/break shout.
3. The modals themselves stay sharp — nothing blurs the modal along with its page.
4. The photo prompt fades in at the centre; no slide from the bottom, in or out.
5. The `+` → pills morph, and back.
6. All three sources still attach: camera, photo album, file. **End Job** stays disabled
   until something is attached, **Skip** still ends the job without a photo, and the X
   backs out without ending it.
7. The blur clears on every exit path — including cancelling via the X, via the backdrop,
   and after a completed End Job. A stuck `modalBlur` blurs the whole app.
