import SwiftUI

// MARK: - Glass controls
//
// The app's one sanctioned divergence from the web app. Everything else is copied
// verbatim; header buttons are native Liquid Glass.
//
// Nothing here has anything to do with `MacNativeSkin`. That is CSS injected into
// the WEB VIEW so the wrapper looks less like a browser tab until the port is
// done — it never touches a native view, and there is no CSS constraint on this
// side. `MACOSX_DEPLOYMENT_TARGET = 26.0`, so the real API is available.
//
// THE FOUR PRECONDITIONS for a morphing glass cluster, learned on iOS the
// expensive way (attempted and reverted 2026-08-26, rebuilt 2026-08-27 in
// `bff1cb1`). All four must hold or the morph silently degrades to a cross-fade:
//
//  1. THE HOST MUST NEVER UNMOUNT. Controls owned by the pages give the container
//     nothing to morph FROM — a page swap happens in a single frame. So header
//     controls are hosted above the page and pages DECLARE what the header holds.
//     Not needed yet (one placeholder page); the Jobs pass does the hoisting.
//  2. NOTHING ON THE PATH MAY BE TYPE-ERASED. The big one. `glassEffectID`
//     interpolates a glass shape and needs the carrying view continuous. Three
//     separate AnyView designs each failed on iOS. Controls are DATA through a
//     concrete `switch`, or generic parameters — never AnyView. That is why
//     `TGlassButton` and `TPage`'s `Right` are generic.
//  3. THE CHANGE NEEDS AN ANIMATED TRANSACTION. `.animation(_:value:)` on the
//     container is NOT equivalent — the host mirrors the selection into its own
//     @State inside `withAnimation`. (`NativeShell.select(_:)` already does this.)
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
