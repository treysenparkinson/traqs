import SwiftUI
import AppKit

// MARK: - Putting the window's buttons on the brand strip's centreline
//
// macOS places close / minimise / zoom about 14pt from the window's top, being
// 12pt buttons centred in a 28pt title bar. With `.hiddenTitleBar` the brand
// strip occupies that space, and 14pt is above the lockup's centre, so the two
// read as a diagonal rather than as one row.
//
// Nothing in SwiftUI reaches them: they belong to the NSWindow, not to the view
// hierarchy. So this is AppKit, and the mechanism matters — the first attempt at
// this constrained the buttons directly and did nothing at all, because:
//
//   * `NSThemeFrame` lays these buttons out ITSELF, setting their frames on every
//     pass. Constraints of ours are re-applied and then overwritten, and frames
//     of ours are overwritten outright.
//   * Moving a button below its superview's 28pt bounds also kills its clicks.
//     `NSView.hitTest` returns nil for a point outside the receiver's own bounds,
//     so the overhanging part goes dead even with clipping turned off.
//
// So this does not touch the buttons. It grows the TITLE BAR CONTAINER that holds
// them and lets AppKit re-centre its contents inside the taller region — the
// buttons come down because their frame of reference did, which is why AppKit's
// own layout pass cooperates instead of undoing it. It also means the region the
// buttons sit in is genuinely that tall, so they keep taking clicks.
struct TrafficLightAligner: NSViewRepresentable {

    /// Points from the window's top edge to the buttons' centres. The container
    /// is grown to twice this, since AppKit centres its contents in it.
    var centerY: CGFloat

    /// How much of the row the title bar view is allowed to keep. The rightmost
    /// button's centre is 60 with a ~6pt radius, so 100 clears the cluster with
    /// air and leaves the rest of the strip to the app.
    static let clusterWidth: CGFloat = 100

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSView {
        let probe = WindowProbe()
        probe.onWindow = { [coordinator = context.coordinator] window in
            coordinator.attach(to: window)
        }
        return probe
    }

    func updateNSView(_ view: NSView, context: Context) {
        context.coordinator.centerY = centerY
        context.coordinator.apply()
    }

    /// Reports the window as soon as there IS one. The first version polled once
    /// on a `DispatchQueue.main.async` and gave up silently if `view.window` was
    /// still nil — which, for a view SwiftUI has only just created, it usually is.
    private final class WindowProbe: NSView {
        var onWindow: ((NSWindow) -> Void)?
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let window { onWindow?(window) }
        }
    }

    final class Coordinator {
        var centerY: CGFloat = 22
        private weak var window: NSWindow?
        private var observers: [NSObjectProtocol] = []

        func attach(to window: NSWindow) {
            guard self.window !== window else { return }
            self.window = window
            observers.forEach { NotificationCenter.default.removeObserver($0) }
            observers = []

            // The container's frame is in its superview's coordinates, measured
            // from the BOTTOM, so a resize invalidates it. Full-screen transitions
            // hand the buttons to the menu-bar overlay and back again.
            for name: Notification.Name in [NSWindow.didResizeNotification,
                                            NSWindow.didExitFullScreenNotification,
                                            NSWindow.didBecomeKeyNotification] {
                let token = NotificationCenter.default.addObserver(
                    forName: name, object: window, queue: .main
                ) { [weak self] _ in self?.apply() }
                observers.append(token)
            }
            apply()
        }

        func apply() {
            guard let window, !window.styleMask.contains(.fullScreen),
                  let bar = window.standardWindowButton(.closeButton)?.superview,
                  let container = bar.superview,
                  let frameView = container.superview else { return }

            // Never SHORTER than the title bar macOS asked for — that would
            // squeeze the buttons rather than move them.
            let height = max(centerY * 2, bar.frame.height)

            // Only the container's own frame is skipped when it is already right.
            // The two writes below must still run: a resize leaves the height
            // correct while AppKit has widened the bar back to full span, and
            // returning early here left it that way.
            if abs(container.frame.height - height) > 0.5 {
                var f = container.frame
                f.size.height = height
                f.origin.y = frameView.bounds.height - height  // not flipped: y from the bottom
                container.frame = f
            }

            // Centred in the container, and NARROWED to the button cluster.
            //
            // Two reasons. AppKit does centre it on its own pass, but that pass
            // may not come before the next draw, and half a frame of buttons in
            // the old place reads as a jump. And the width matters more: this view
            // takes mouse events across its whole span — that is where a title bar
            // picks up window drags — so at full width it would sit over the
            // Notifications bell and the undo/redo pair and swallow their clicks.
            // Cut to the cluster, it covers only the buttons' own corner.
            bar.frame = NSRect(x: 0,
                               y: (height - bar.frame.height) / 2,
                               width: TrafficLightAligner.clusterWidth,
                               height: bar.frame.height)

            // Dragging the window by its title bar is most of what that swallowed
            // area was for, so hand the job to the background instead. Without
            // this, narrowing the bar leaves the strip un-draggable.
            window.isMovableByWindowBackground = true
        }

        deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    }
}
