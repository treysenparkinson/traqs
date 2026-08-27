import SwiftUI

// MARK: - Decision actions — an Undo capsule that splits into Deny + Approve
//
// One control for the request cards in a message thread. Decided, it is a single
// clear-glass Undo capsule; undo it and that capsule SPLITS into the tinted
// Deny/Approve pair — and deciding again merges the pair back into one.
//
// This is the same mechanism as the end-job sheet's attachment button, which
// splits a "+" into three source pills and merges them back
// (PanelPhotoSheet.attachmentArea). Copied from it deliberately, down to the
// proportions, because that one demonstrably morphs on device:
//
//   * Each state gets its OWN `glassEffectID`. Not a shared id — the container
//     splits and merges by proximity, and distinct ids are what let one shape
//     become three (or two) rather than one shape chasing another.
//   * Both states sit in a ZStack, so they occupy the same place. Shapes that
//     are already on top of each other have nowhere to jump from.
//   * The pair's gap sits BELOW the container's spacing, so the two capsules are
//     born fused to each other and pull apart as they settle — the split.
//   * The flip runs inside an explicit `withAnimation`. Without it the capsules
//     just pop, exactly as the source pills would.
struct DecisionActions: View {

    /// One capsule's face and what it does.
    struct Action {
        let title: String
        let systemImage: String
        /// `nil` = plain glass and ink, the neutral treatment. Undo takes this:
        /// it is a way back, not a decision, and tinting it made it read as a
        /// third coloured verdict.
        let tint: Color?
        let run: () -> Void
    }

    /// Shown while the request is undecided, on the left.
    let deny: Action
    /// Shown while the request is undecided, on the right.
    let approve: Action
    /// Replaces the pair once the request is decided.
    let undo: Action
    /// `true` → one Undo capsule. `false` → the Deny/Approve pair.
    let resolved: Bool
    /// A decision is in flight. Dims and disables without unmounting anything —
    /// removing a capsule mid-flight would fire the morph off the wrong edge.
    var busy: Bool = false

    @Namespace private var glassNS

    /// How close two shapes must be to blend. ABOVE `pairGap` — that gap is the
    /// whole trick, and it is the attachment menu's 16 against a 10pt pill gap.
    private let fuseDistance: CGFloat = 16
    /// Gap between Deny and Approve. BELOW `fuseDistance`, so the pair leaves the
    /// Undo capsule as one surface and separates on the way out.
    private let pairGap: CGFloat = 12

    /// `resolved`, mirrored so the change carries an animated transaction.
    ///
    /// The attachment menu animates at its call site (`setMenu`) because a tap is
    /// what opens it. Here the value arrives from a data refresh with no
    /// animation attached, so the mirror is where the animation has to go — and
    /// `.animation(_:value:)` on the container is not equivalent.
    ///
    /// `nil` until the first render, so a card that is ALREADY decided when it
    /// appears draws its Undo capsule outright instead of animating into it.
    @State private var shown: Bool?

    private var isResolved: Bool { shown ?? resolved }

    var body: some View {
        GlassEffectContainer(spacing: fuseDistance) {
            ZStack {
                if isResolved {
                    capsule(undo, id: "decision.undo")
                } else {
                    HStack(spacing: pairGap) {
                        capsule(deny, id: "decision.deny")
                        capsule(approve, id: "decision.approve")
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .onChange(of: resolved, initial: true) { _, now in
            guard shown != nil else { shown = now; return }   // first render: no morph
            withAnimation(.spring(response: 0.38, dampingFraction: 0.74)) { shown = now }
        }
    }

    /// Order matters: the label is sized and coloured first, then the glass takes
    /// it, then the id names the shape.
    private func capsule(_ action: Action, id: String) -> some View {
        Button(action: action.run) {
            HStack(spacing: 8) {
                Image(systemName: action.systemImage)
                    .font(.system(size: 13, weight: .semibold))
                Text(action.title)
                    .font(TTypo.bodyBold(14))
                    .lineLimit(1)
            }
            .foregroundStyle(action.tint.map(glassCTALabel) ?? Color(hex: T.ink))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .glassEffect(glass(action.tint), in: Capsule())
            .glassEffectID(id, in: glassNS)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .opacity(busy ? 0.55 : 1)
    }

    /// Tinted when the action carries a colour, plain glass when it doesn't.
    /// One `Glass` value rather than a branch around the modifier, so both paths
    /// stay the same concrete view.
    private func glass(_ tint: Color?) -> Glass {
        var g = Glass.regular.interactive()
        if let tint { g = g.tint(tint) }
        return g
    }
}
