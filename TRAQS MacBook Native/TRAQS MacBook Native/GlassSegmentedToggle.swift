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
        // The container lets the thumb's glass deform against its surroundings.
        GlassEffectContainer(spacing: 12) {
            ZStack(alignment: .leading) {
                thumb
                labels
            }
            .padding(4)
            .background(.black.opacity(0.06), in: .capsule)
        }
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

    private var labels: some View {
        HStack(spacing: 0) {
            ForEach(options) { option in
                Text(title(option))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(option == selection ? .primary : .secondary)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 18)
                    // Invisible source rect the thumb matches to.
                    .background {
                        Color.clear
                            .matchedGeometryEffect(id: option, in: thumbSpace, isSource: true)
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
