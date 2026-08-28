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

            var f = container.frame
            guard abs(f.height - height) > 0.5 else { return }
            f.size.height = height
            f.origin.y = frameView.bounds.height - height   // not flipped: y from the bottom
            container.frame = f

            // AppKit centres the bar in the container on its own pass, but that
            // pass may not come before the next draw, and a half-frame of the
            // buttons in the old place reads as a jump.
            bar.frame = NSRect(x: 0,
                               y: (height - bar.frame.height) / 2,
                               width: container.bounds.width,
                               height: bar.frame.height)
        }

        deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    }
}
