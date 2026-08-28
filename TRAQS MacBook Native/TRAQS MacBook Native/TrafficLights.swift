import SwiftUI
import AppKit

// MARK: - Putting the window's buttons on the brand strip's centreline
//
// macOS places close / minimise / zoom about 14pt from the window's top, being
// 12pt buttons centred in a 28pt title bar. With `.hiddenTitleBar` the brand
// strip occupies that space, and 14pt is well above the lockup's centre — so the
// buttons and the logo read as a diagonal rather than as one row.
//
// Nothing in SwiftUI reaches them: they belong to the NSWindow, not to the view
// hierarchy, and they are drawn by the window server. So this is AppKit, and it
// IS a hack — AppKit lays these buttons out itself, and holding them somewhere
// else means giving them constraints of our own and stopping the title bar from
// clipping what then hangs below it. Two consequences worth knowing:
//
//   * Constraints, not frames. A frame set here is wiped by the next layout
//     pass — on resize, on losing focus, on entering full screen. Constraints
//     survive those.
//   * Full screen is left alone. The buttons move into the menu-bar overlay
//     there and are no longer ours to place.
struct TrafficLightAligner: NSViewRepresentable {

    /// Points from the window's top edge to the buttons' centres. CLAMPED to
    /// `maxCenterY` — see there.
    var centerY: CGFloat

    /// How far down these can usefully go: a 12pt button centred at 22 spans
    /// 16–28 and stays inside the 28pt title bar.
    ///
    /// Past that they still DRAW, since the bar is told not to clip, but they
    /// stop taking clicks: `NSView.hitTest` returns nil for a point outside the
    /// receiver's own bounds, so the part hanging below is dead. A close button
    /// that looks fine and does nothing is a worse bug than a few points of
    /// misalignment, so the lockup covers the remaining distance by rising
    /// instead — see `BrandStrip.topPad`.
    static let maxCenterY: CGFloat = 22

    /// macOS's own horizontal placement — first centre 20pt in, 20pt apart. Kept
    /// as defaults because only the vertical is wrong for us, and a window's
    /// buttons sitting anywhere but their usual left inset looks broken.
    var leading: CGFloat = 20
    var spacing: CGFloat = 20

    final class Coordinator {
        /// Ours, so a re-run replaces them instead of stacking a second set on
        /// top and leaving the solver to pick a winner.
        var constraints: [NSLayoutConstraint] = []
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Zero-sized and invisible. This exists only to get a handle on the window.
    func makeNSView(context: Context) -> NSView { NSView(frame: .zero) }

    func updateNSView(_ view: NSView, context: Context) {
        // `view.window` is nil until the view is in a hierarchy, and the buttons
        // are positioned after that, so this waits for the current pass to end.
        DispatchQueue.main.async { [coordinator = context.coordinator] in
            align(view.window, coordinator)
        }
    }

    private func align(_ window: NSWindow?, _ coordinator: Coordinator) {
        guard let window, !window.styleMask.contains(.fullScreen) else { return }

        let kinds: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
        let buttons = kinds.compactMap { window.standardWindowButton($0) }
        // All three or none. Placing two of them and leaving the third where
        // AppKit put it is worse than not touching any.
        guard buttons.count == kinds.count, let bar = buttons[0].superview else { return }

        // The title bar is 28pt tall and the buttons now hang past its bottom
        // edge. NSView does not clip by default, but the title bar is a view we
        // do not own, so this says so rather than relying on it.
        bar.clipsToBounds = false

        NSLayoutConstraint.deactivate(coordinator.constraints)

        var made: [NSLayoutConstraint] = []
        for (i, button) in buttons.enumerated() {
            button.translatesAutoresizingMaskIntoConstraints = false
            made.append(button.centerYAnchor.constraint(equalTo: bar.topAnchor,
                                                        constant: min(centerY, Self.maxCenterY)))
            made.append(button.centerXAnchor.constraint(equalTo: bar.leadingAnchor,
                                                        constant: leading + spacing * CGFloat(i)))
        }
        NSLayoutConstraint.activate(made)
        coordinator.constraints = made
    }
}
