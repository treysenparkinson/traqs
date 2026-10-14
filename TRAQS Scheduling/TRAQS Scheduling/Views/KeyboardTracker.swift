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

    /// Zero-size, invisible; on joining a window it pins a probe to that
    /// window's keyboard guide.
    final class Anchor: UIView {
        var onChange: ((CGFloat, TimeInterval) -> Void)?
        private var probe: Probe?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            probe?.removeFromSuperview()
            probe = nil
            guard let window else { return }
            let p = Probe()
            p.isUserInteractionEnabled = false
            p.translatesAutoresizingMaskIntoConstraints = false
            p.onHeight = { [weak self] h in
                self?.onChange?(h, UIView.inheritedAnimationDuration)
            }
            window.addSubview(p)
            NSLayoutConstraint.activate([
                p.leadingAnchor.constraint(equalTo: window.leadingAnchor),
                p.widthAnchor.constraint(equalToConstant: 1),
                p.topAnchor.constraint(equalTo: window.keyboardLayoutGuide.topAnchor),
                p.bottomAnchor.constraint(equalTo: window.bottomAnchor),
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
            onHeight?(h)
        }
    }
}
