# Liquid Glass Toggle — Lift, Travel, Drop

**Target:** iOS 26+ / Xcode 26+ / SwiftUI
**Goal:** A clear-glass segmented toggle whose selection indicator **lifts,
travels** to the tapped segment, and **drops** back down — instead of sliding
flat left and right.

> Read §1 before writing code. It explains why the current implementation cannot
> produce a lift no matter how the spring is tuned.

**Scope:** This is a standalone component. It is unrelated to the header morph
work, and nothing in that brief applies here. If both briefs are present in this
repo, do not read them together and do not carry architecture, namespaces, or
containers between them:

- This toggle owns its own `@Namespace`. Never pass it the header's namespace, and
  never reuse `HeaderSlot` IDs. Two components sharing one namespace will try to
  matched-geometry against each other's shapes.
- This toggle gets its own `GlassEffectContainer`. Do not nest it inside the
  header's container, and do not merge them.
- This component lives inside page content, not in the shell. The
  persistent-container requirement from the header brief does not apply and must
  not be imported here.

## 0. First check: can this be a system Picker?

In iOS 26 the segmented picker adopts Liquid Glass automatically and its shape is
a capsule. Apple DTS has confirmed the shape is not customizable — no
`clipShape`, `containerShape`, or `background` override will change it.

```swift
Picker("Range", selection: $range) {
    Text("Week").tag(Range.week)
    Text("Month").tag(Range.month)
    Text("Year").tag(Range.year)
}
.pickerStyle(.segmented)
```

If a capsule segmented control with system styling is acceptable, use this and
delete the custom toggle. Everything below is only for when the design requires a
shape, size, or content the system picker will not give.

## 1. Why the lift is missing (the actual bug)

`withAnimation` interpolates between two endpoint states. It computes the start
value, the end value, and fills in between.

The lift is a property that starts at rest and ends at rest:

```
scale:      1.0  →  (1.08)  →  1.0
shadow:     0    →  (1.0)   →  0
y-offset:   0    →  (-3)    →  0
```

Start and end are identical. There is nothing to interpolate, so SwiftUI
correctly renders no change at all. Only the x position differs between the two
states, so only the x position animates — which is exactly the flat left-right
slide currently on screen.

This is not a tuning problem. `.bouncy`, `.snappy`, higher `extraBounce`, longer
duration — none of them can help, because no spring can pass through a value that
isn't one of its endpoints.

**The fix:** the lift needs an animation that travels *through* intermediate
values rather than *between* endpoints. In SwiftUI that means `keyframeAnimator`
(independent timing per property, recommended) or `phaseAnimator` (simpler, less
control).

## 2. Split the motion into four independent tracks

The reason the system version feels physical is that the properties are not on the
same timeline. The lift finishes before the travel does; the stretch peaks in the
middle of the travel; the drop lands last.

Put them on one shared spring and you get a uniform grow-and-shrink, which reads
as a wobble, not a lift.

| Track | Curve | Purpose |
|---|---|---|
| `scale` | 1.0 → 1.08 → 1.0 | The lift toward the viewer. Peaks early, holds, settles last. |
| `y` | 0 → −3 → 0 | Small literal rise. Subtle; reinforces the lift without reading as a jump. |
| `elevation` | 0 → 1 → 0 | Drives shadow radius, opacity, and y-offset. This is what sells "off the surface." |
| `stretch` | 1.0 → 1.14 → 1.0 | Horizontal squash-stretch. Peaks at mid-travel. This is the liquid part. |
| x position | start → end | **Not a keyframe track.** Kept on a normal spring — see §3. |

Timing skeleton (total ≈ 0.44s):

```
0.00 ──── 0.12 ──────────── 0.28 ──────────── 0.44
   lift up      travel + stretch      drop / settle
        └── travel starts at ~0.05, overlapping the lift ──┘
```

Overlap the phases slightly. Fully sequential phases read as robotic.

## 3. Keep x position OUT of the keyframe animator

`keyframeAnimator` always replays from its `initialValue` when the trigger fires.
The resting x position changes with every selection, so putting x on a keyframe
track makes the indicator jump back to the old position before each animation.

Drive x the way it already works — a spring bound to the selection — and give it a
small delay so the lift begins first:

```swift
.animation(.bouncy(duration: 0.34, extraBounce: 0.06).delay(0.05), value: selection)
```

That delay is the entire "lifts up then moves" sequencing. Without it, the
indicator starts travelling on frame one and the lift disappears into the motion.

Use `matchedGeometryEffect` for the position rather than a computed offset — it
makes the indicator adopt each segment's exact width for free, so segments with
different label lengths stay correct.

## 4. Reference implementation

See `TRAQS MacBook Native/TRAQS MacBook Native/GlassSegmentedToggle.swift`, which
is this section implemented verbatim.

```swift
struct LiftValues: Equatable {
    var scale: CGFloat = 1.0
    var stretch: CGFloat = 1.0
    var y: CGFloat = 0
    var elevation: CGFloat = 0
}
```

Tracks, exactly as specified:

```swift
KeyframeTrack(\.scale) {
    SpringKeyframe(1.08, duration: 0.12, spring: .snappy)
    LinearKeyframe(1.08, duration: 0.16)
    SpringKeyframe(1.00, duration: 0.16, spring: .bouncy)
}
KeyframeTrack(\.y) {
    SpringKeyframe(-3, duration: 0.12, spring: .snappy)
    LinearKeyframe(-3, duration: 0.16)
    SpringKeyframe(0, duration: 0.16, spring: .bouncy)
}
KeyframeTrack(\.elevation) {
    SpringKeyframe(1.0, duration: 0.12)
    LinearKeyframe(1.0, duration: 0.16)
    SpringKeyframe(0.0, duration: 0.16)
}
// Peaks mid-travel, after the lift and before the drop.
KeyframeTrack(\.stretch) {
    LinearKeyframe(1.00, duration: 0.10)
    CubicKeyframe(1.14, duration: 0.14)
    CubicKeyframe(1.00, duration: 0.20)
}
```

The label `onTapGesture` uses a **bare** `withAnimation`. The thumb's own
`.animation(_:value:)` and `keyframeAnimator` supply the real timing; a spring
specified at the call site would fight them.

## 5. Notes on the glass itself

- Use `Glass.clear` for a clear indicator, `.regular` if it needs more presence
  over busy content. There is no way to animate between glass variants, so the
  sense of the material "lighting up" during the lift must come from the shadow
  and scale tracks, plus the material's own specular response to the shape change.
- `.interactive()` gives the press-down response. Keep it.
- Wrap in `GlassEffectContainer` so the indicator's glass deforms against nearby
  glass as it moves.
- **Verify `scaleEffect` on device.** A transform scales the rendered glass layer,
  and the material can look smeared at larger scale factors. 1.08 is safe. If it
  smears, animate the thumb's frame width/height instead of using `scaleEffect` —
  more expensive, but the material re-renders at the correct size.
- Do not stack a manual stroke, gradient, or blur on the indicator to make it
  "pop" during the lift. It flattens the material and the effect gets worse, not
  better.

## 6. Tuning

Change one value at a time and re-test on device.

| Symptom | Adjust |
|---|---|
| Lift invisible | Raise `scale` peak to 1.10–1.12; raise shadow radius multiplier. |
| Reads as a wobble, not a lift | The tracks are sharing timing. Verify `scale` peaks before x settles. |
| Feels sluggish | Shorten total to ~0.36s; cut `travelDelay` to 0.03. |
| Lift and travel look disconnected | Cut `travelDelay` to 0.03 and widen the `scale` hold. |
| No liquid quality | Raise `stretch` peak to 1.18 and make sure it peaks mid-travel, not at the start. |
| Overshoots too much on landing | Lower `extraBounce` to 0.03; use `.smooth` on the final `scale` keyframe. |

Reference: `.bouncy(duration: 0.34, extraBounce: 0.06)` for travel. **Never
`.easeInOut`** — it reads as non-native immediately.

## 7. Accessibility

```swift
@Environment(\.accessibilityReduceMotion) private var reduceMotion
```

With Reduce Motion on, **skip the lift entirely** — no keyframe animator, no
stretch, no shadow pulse. Move the indicator directly, or crossfade the selection.
Do not simply shorten the durations; the objection is to the motion itself.

Also:

- Keep each segment's tap target at least 44pt tall.
- The indicator is decorative. Put the accessibility label and
  `.accessibilityAddTraits(.isSelected)` on the labels, not the thumb.
- Verify label contrast in both selected and unselected states against content
  passing beneath the clear glass.

## 8. Audit checklist

- [ ] Is the lift a `keyframeAnimator` or `phaseAnimator`, not a `withAnimation`
      spring? (If it's a spring, that is the bug — §1.)
- [ ] Is x position on a separate spring from the lift tracks, with a small delay?
- [ ] Is x kept out of the keyframe tracks? (In-track x makes the thumb jump
      backward on each tap.)
- [ ] Does `scale` peak before x settles?
- [ ] Does `stretch` peak at mid-travel rather than at t=0?
- [ ] Do all lift tracks return to their exact starting value at the end of the
      timeline?
- [ ] Is the indicator's position driven by `matchedGeometryEffect` so it adopts
      each segment's real width?
- [ ] Is the thumb behind the labels in z-order and non-interactive, so taps reach
      the labels?
- [ ] Is the whole toggle inside a `GlassEffectContainer`?
- [ ] Any manual stroke, gradient, or blur layered on the thumb? Remove.
- [ ] Is `accessibilityReduceMotion` handled by removing the lift, not shortening
      it?

## 9. Instructions to the implementing agent

1. Show me the current toggle implementation and identify exactly which properties
   are animated and by what. Confirm whether the lift is currently attempted via
   `withAnimation` (§1).
2. Run the §8 audit and report pass/fail per item with file and line.
3. Implement §4. Keep the existing selection binding and public API of the
   component unchanged unless I approve a change.
4. Set the tuning values exactly as written in §4 on the first pass. Do not
   pre-tune.
5. Confirm it builds, then tell me the total animation duration and the timestamp
   at which each track peaks.
6. Handle Reduce Motion per §7.

Do not add shadows, strokes, gradients, or blur layers beyond the single
`elevation` shadow in §4. Do not replace `keyframeAnimator` with a spring "for
simplicity" — that reintroduces the original bug.
