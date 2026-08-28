import SwiftUI

// MARK: - Liquid Glass segmented toggle — lift, travel, drop
//
// Implements `docs/LIQUID_GLASS_TOGGLE_LIFT_BRIEF.md` §4. Every value here is the
// brief's, unmodified — §9 says set them exactly as written on the first pass and
// do not pre-tune, so §6's tuning table has NOT been applied.
//
// SCOPE (the brief's §0 preamble). This is a standalone component and has nothing
// to do with the header morph work:
//
//   • It owns its OWN @Namespace. Never hand it another component's, and never
//     reuse HeaderSlot ids — two components sharing a namespace matched-geometry
//     against each other's shapes.
//   • It gets its OWN GlassEffectContainer. Do not nest it in another one.
//   • It lives in PAGE CONTENT, not the shell. The persistent-container rule from
//     the header brief does not apply and must not be imported here.
//
// WHY THE LIFT NEEDS KEYFRAMES (§1), because this is the thing a later edit will
// undo "for simplicity":
//
//   `withAnimation` interpolates between two ENDPOINTS. The lift starts at rest
//   and ends at rest — scale 1.0 → 1.08 → 1.0 — so its start and end are
//   IDENTICAL and there is nothing to interpolate. SwiftUI correctly renders no
//   change. Only x differs between the two states, so only x animates, which is
//   exactly the flat left-right slide.
//
//   No spring can fix this. `.bouncy`, `.snappy`, more extraBounce, longer
//   duration — none can pass through a value that is not one of its endpoints.
//   The lift must travel THROUGH intermediate values, which is what
//   `keyframeAnimator` is for.
//
// WHY x IS NOT A KEYFRAME TRACK (§3): a keyframe animator replays from its
// `initialValue` whenever the trigger fires, and the resting x changes with every
// selection — so x on a track makes the thumb jump back to the old position
// before each animation. x stays on a normal spring, DELAYED, and that delay is
// the whole "lifts up, then moves" sequencing.

/// The four independent tracks (§2). They are deliberately NOT on one timeline:
/// share it and you get a uniform grow-and-shrink, which reads as a wobble rather
/// than a lift.
struct LiftValues: Equatable {
    var scale: CGFloat = 1.0
    var stretch: CGFloat = 1.0
    var y: CGFloat = 0
    var elevation: CGFloat = 0
}

struct GlassSegmentedToggle<T: Hashable & Identifiable>: View {
    let options: [T]
    let title: (T) -> String
    @Binding var selection: T

    /// Label colours, EXPLICIT rather than semantic.
    ///
    /// §7 makes contrast the implementer's job: "Verify label contrast in both
    /// selected and unselected states against content passing beneath the clear
    /// glass." Semantic `.primary`/`.secondary` cannot satisfy that on their own,
    /// because they follow the ambient appearance while a clear thumb over a
    /// FIXED palette does not — which is exactly how the selected label ended up
    /// white on a light thumb.
    ///
    /// Defaults are the brief's, so a caller in a normally-themed context gets
    /// §4's behaviour unchanged.
    var selectedColor: Color = .primary
    var unselectedColor: Color = .secondary

    /// This component's own identity space — see the scope note above.
    @Namespace private var thumbSpace

    /// §3. Small, and load-bearing: without it the thumb starts travelling on
    /// frame one and the lift disappears into the motion.
    private let travelDelay: Double = 0.05

    /// §7. Reduce Motion removes the lift ENTIRELY — no keyframes, no stretch, no
    /// shadow pulse. The objection is to the motion itself, so shortening the
    /// durations is not an answer.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // THE LABEL ROW IS BUILT TWICE, and the duplication is the fix for a real
        // rendering fault rather than an accident.
        //
        // `GlassEffectContainer` hoists its glass into a separate compositing
        // layer, so declaration order INSIDE it does not settle z-order: the clear
        // thumb rendered above the selected label and refracted it, which looked
        // like a blurred label with a ghost of itself underneath. The unselected
        // label, outside the thumb, stayed crisp — which is what identified it.
        //
        // So the visible labels live OUTSIDE the container, in an `.overlay`,
        // where nothing can composite over them. An invisible copy stays inside
        // to do the two jobs the visible one cannot do from out there:
        //
        //   1. define the control's SIZE (the thumb cannot — see the greedy-shape
        //      note on `.background` below), and
        //   2. carry the matchedGeometryEffect SOURCES the thumb matches to, which
        //      is what lets it adopt each segment's real width.
        //
        // The two copies are the same view built from the same data, so they
        // cannot drift.
        labelRow(sources: true)
            .hidden()
            // The container in a `.background`, whose content is sized to its
            // HOST. `Capsule().fill(.clear)` is a GREEDY shape — offered a size it
            // takes all of it — so given the chance it expands the control to fill
            // the window. It had that chance once: the track became a page-sized
            // grey stadium and a corner alignment had nothing to push against.
            .background {
                GlassEffectContainer(spacing: 12) { thumb }
            }
            .overlay { labelRow(sources: false) }
            .padding(4)
            .background(.black.opacity(0.06), in: .capsule)
            // Ideal size, not offered size — belt and braces against the same
            // class of expansion from anything else in the chain.
            .fixedSize()
    }

    // MARK: Indicator

    @ViewBuilder
    private var thumb: some View {
        if reduceMotion {
            // Moves directly. No lift, no stretch, no elevation.
            Capsule()
                .fill(.clear)
                .glassEffect(.clear.interactive(), in: .capsule)
                .matchedGeometryEffect(id: selection, in: thumbSpace, isSource: false)
                .allowsHitTesting(false)
        } else {
            Capsule()
                .fill(.clear)
                .glassEffect(.clear.interactive(), in: .capsule)
                // Position: a normal spring, delayed so the lift reads first.
                // matchedGeometryEffect rather than a computed offset, so the
                // thumb adopts each segment's EXACT width for free and segments
                // with different label lengths stay correct.
                .matchedGeometryEffect(id: selection, in: thumbSpace, isSource: false)
                .animation(.bouncy(duration: 0.34, extraBounce: 0.06).delay(travelDelay),
                           value: selection)
                // Lift: a keyframe timeline. Passes THROUGH values and returns to
                // rest — see the §1 note above.
                .keyframeAnimator(initialValue: LiftValues(), trigger: selection) { content, v in
                    content
                        .scaleEffect(x: v.scale * v.stretch, y: v.scale, anchor: .center)
                        .offset(y: v.y)
                        .shadow(color: .black.opacity(0.22 * v.elevation),
                                radius: 14 * v.elevation,
                                y: 6 * v.elevation)
                } keyframes: { _ in

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

                    // Peaks mid-travel, after the lift and before the drop. This
                    // is the liquid part.
                    KeyframeTrack(\.stretch) {
                        LinearKeyframe(1.00, duration: 0.10)
                        CubicKeyframe(1.14, duration: 0.14)
                        CubicKeyframe(1.00, duration: 0.20)
                    }
                }
                // Decorative: the labels carry the accessibility, and taps must
                // reach them rather than being swallowed here.
                .allowsHitTesting(false)
        }
    }

    // MARK: Labels

    /// The segment row.
    ///
    /// `sources: true` is the invisible copy inside the glass container: it sets
    /// the control's size and publishes the matchedGeometryEffect sources.
    /// `sources: false` is the visible copy in the overlay, which takes the taps.
    /// Publishing sources from both would give the thumb two candidates per id.
    private func labelRow(sources: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(options) { option in
                Text(title(option))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(option == selection ? selectedColor : unselectedColor)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 18)
                    .background {
                        if sources {
                            // Invisible source rect the thumb matches to.
                            Color.clear
                                .matchedGeometryEffect(id: option, in: thumbSpace,
                                                       isSource: true)
                        }
                    }
                    .contentShape(.capsule)
                    .onTapGesture {
                        guard option != selection else { return }
                        // A BARE withAnimation on purpose. The thumb's own
                        // .animation(_:value:) and keyframeAnimator supply the
                        // real timing; a spring specified here would fight them.
                        withAnimation { selection = option }
                    }
                    // §7: the indicator is decorative, so the state lives here.
                    .accessibilityAddTraits(option == selection ? [.isButton, .isSelected]
                                                                : [.isButton])
            }
        }
    }
}
