
#if canImport(UIKit)
import SwiftUI
import UIKit

// MARK: - Theme interface-style sync
//
// SwiftUI's `.preferredColorScheme` only styles the hosting controller it is
// attached to. Sheets and fullScreenCovers are presented in FRESH hosting
// controllers whose interface style is `.unspecified`, so they fall back to the
// device's system appearance — which is why a pull-up sheet painting a light
// `T.bg` shows white `.primary` text (white-on-white) when the phone is in Dark
// Mode, even though the app is pinned to a light theme. Forcing the scene's
// WINDOWS to the theme's interface style makes every presented controller
// inherit it, fixing all sheets from one place instead of pinning
// `.preferredColorScheme` on each of ~30 presentation sites.
struct ThemeStyleSync: UIViewRepresentable {
    let isLight: Bool

    func makeUIView(context: Context) -> AnchorView {
        let v = AnchorView()
        v.isUserInteractionEnabled = false
        v.style = isLight ? .light : .dark
        return v
    }

    func updateUIView(_ uiView: AnchorView, context: Context) {
        uiView.style = isLight ? .light : .dark
        uiView.apply()
    }

    final class AnchorView: UIView {
        var style: UIUserInterfaceStyle = .light
        override func didMoveToWindow() {
            super.didMoveToWindow()
            apply()
        }
        /// Pin every window in this view's scene to the theme's interface style.
        func apply() {
            guard let scene = window?.windowScene else { return }
            for w in scene.windows { w.overrideUserInterfaceStyle = style }
        }
    }
}

#endif
