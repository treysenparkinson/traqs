import SwiftUI
import UIKit

// MARK: - Keyboard tracker
//
// Follows the keyboard's actual position every frame, via the window's
// `keyboardLayoutGuide` — including an interactive swipe-down, during which
// UIKit posts NO notifications until the drag ends. The thread's composer was
// lifted from those notifications, so on a swipe-down it sat still and dropped
// only once the keyboard was fully gone (2026-10-14). Now it rides the keyboard.
//
// Reports the keyboard's height above the window's bottom edge (the guide
// includes the bottom safe area, so it reads that much with no keyboard), and
// whether the change is part of a UIKit animation (a normal show/hide) — in
// which case the caller animates to match — or a direct move (a drag), which
// the caller applies as-is.
struct KeyboardTracker: UIViewRepresentable {
    var onChange: (_ height: CGFloat, _ animationDuration: TimeInterval) -> Void

    func makeUIView(context: Context) -> Anchor {
        let v = Anchor()
        v.onChange = onChange
        return v
    }

    func updateUIView(_ uiView: Anchor, context: Context) {
        uiView.onChange = onChange
    }

    /// Zero-size, invisible; on joining a window it pins a probe to the ROOT
    /// view controller's view and that view's keyboard guide. Not the window
    /// itself: UIKit applies keyboard-guide changes through the view
    /// controller's layout pass, and a probe on the bare window was never laid
    /// out again — it never reported, and the composer never moved.
    final class Anchor: UIView {
        var onChange: ((CGFloat, TimeInterval) -> Void)?
        private var probe: Probe?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            probe?.removeFromSuperview()
            probe = nil
            guard let root = window?.rootViewController?.view else { return }
            let p = Probe()
            p.isUserInteractionEnabled = false
            p.translatesAutoresizingMaskIntoConstraints = false
            p.onHeight = { [weak self] h in
                // Read the animation context NOW (it only exists inside the
                // layout pass), deliver just AFTER it: the probe reports in the
                // middle of the hosting view's own layout, where a SwiftUI state
                // change is dropped — the composer never moved (2026-10-14).
                let duration = UIView.inheritedAnimationDuration
                DispatchQueue.main.async { self?.onChange?(h, duration) }
            }
            root.addSubview(p)
            NSLayoutConstraint.activate([
                p.leadingAnchor.constraint(equalTo: root.leadingAnchor),
                p.widthAnchor.constraint(equalToConstant: 1),
                p.topAnchor.constraint(equalTo: root.keyboardLayoutGuide.topAnchor),
                p.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            ])
            probe = p
        }

        override func removeFromSuperview() {
            probe?.removeFromSuperview()
            probe = nil
            super.removeFromSuperview()
        }
    }

    /// Its height IS the keyboard guide's; every change lands in layoutSubviews.
    final class Probe: UIView {
        var onHeight: ((CGFloat) -> Void)?
        private var last: CGFloat = -1

        override func layoutSubviews() {
            super.layoutSubviews()
            let h = bounds.height
            guard h != last else { return }
            last = h
            #if DEBUG
            print("[kb] probe height \(Int(h)) animating=\(UIView.inheritedAnimationDuration > 0)")
            #endif
            onHeight?(h)
        }
    }
}
