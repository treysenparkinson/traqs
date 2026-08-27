// The Messages thread header lives in its own UIWindow so the keyboard can't
// displace it. UIWindow is UIKit, so on macOS — which compiles this same file
// via the shared Services group — the whole thing compiles out. The Mac app
// draws that header in its own window chrome instead.
#if canImport(UIKit)
import SwiftUI
import UIKit

// MARK: - Overlay header window
//
// The Messages conversation header must stay fixed when the keyboard opens.
// We proved that the root UIHostingController animates the ENTIRE SwiftUI tree
// on keyboard show/hide, so no view placed anywhere inside that tree can escape
// it. The only reliable fix is to render the header in a SEPARATE UIWindow,
// which the keyboard animation cannot touch.
//
// The window is only as tall as the header (top safe area + bar), so every
// touch below it falls through to the main window automatically — no hitTest
// override needed. It's hidden unless a thread is open.

/// The header content hosted inside the overlay window. Driven by an explicit
/// `context` the controller pushes on every change (we don't rely on @Observable
/// tracking reaching across into a separate window's hosting controller).
struct OverlayHeaderContent: View {
    let context: ThreadContext?
    let topInset: CGFloat
    /// Passed in explicitly and re-published below.
    ///
    /// This view is the ROOT of a separate UIWindow, so its hosting controller
    /// inherits NOTHING from the app's environment — not AppState, not this.
    /// That was invisible until the frosted-glass toggle went app-wide: the
    /// header's `HeaderGlassCircle` back button started reading
    /// `@Environment(ThemeSettings.self)` to decide glass-vs-flat, and a
    /// non-optional @Environment object that was never provided traps at
    /// runtime — so opening any thread crashed.
    let theme: ThemeSettings

    private let barHeight: CGFloat = 108
    private let fade: CGFloat = 36   // bottom edge that dissolves into the page

    var body: some View {
        if let ctx = context {
            let total = topInset + barHeight
            let solid = total > 0 ? max(0, (total - fade) / total) : 1
            ZStack(alignment: .top) {
                // Frosted glass: the messages scrolling underneath show through,
                // blurred. The bottom edge fades to clear so the header dissolves
                // into the page instead of ending on a hard line.
                // Always a real blur, NEVER flattened by the frosted-glass
                // toggle — the one exception among the bars.
                //
                // This plate is masked to fade out along its bottom edge, so
                // "flat" means an opaque slab dissolving into nothing, which
                // reads as a rendering fault rather than as a design. The blur
                // is also doing a job here that no flat fill can: the messages
                // scrolling UNDER it have to stay legible-but-receded, and a
                // solid surface colour would simply swallow them.
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .mask(
                        LinearGradient(stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: solid),
                            .init(color: .clear, location: 1)
                        ], startPoint: .top, endPoint: .bottom)
                    )
                ThreadTopBar(title: ctx.title,
                             isDM: ctx.isDM,
                             participants: ctx.participants,
                             onBack: ctx.onBack,
                             onTapIdentity: ctx.onTapIdentity)
                    .padding(.top, topInset)   // drop below the status bar
            }
            .ignoresSafeArea()
            // Everything above — the plate and the bar's glass back button —
            // reads this. It has to be injected here because nothing upstream
            // of this window can do it.
            .environment(theme)
        } else {
            Color.clear
        }
    }
}

@MainActor
final class OverlayWindowController {
    private let appState: AppState
    /// Injected into the hosted view — see `OverlayHeaderContent.theme`.
    private let theme: ThemeSettings
    private var window: UIWindow?
    private var host: UIHostingController<OverlayHeaderContent>?
    private weak var scene: UIWindowScene?

    // Header window height (status bar + this). Taller than the bar's intrinsic
    // content so there's room below it for a long fade into the page.
    private let barHeight: CGFloat = 108

    init(appState: AppState, theme: ThemeSettings) {
        self.appState = appState
        self.theme = theme
    }

    /// Create the overlay window once, on the given scene.
    func attach(to windowScene: UIWindowScene) {
        guard window == nil else { return }
        scene = windowScene

        let h = UIHostingController(rootView: OverlayHeaderContent(context: nil, topInset: 0, theme: theme))
        h.view.backgroundColor = .clear

        let w = UIWindow(windowScene: windowScene)
        w.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.normal.rawValue + 1)
        w.backgroundColor = .clear
        w.rootViewController = h
        w.isHidden = true

        window = w
        host = h
        track()
        apply()
    }

    /// Re-arm observation (withObservationTracking is one-shot) and refresh.
    private func track() {
        withObservationTracking {
            _ = appState.activeMessageThread
            _ = appState.threadModalPresented
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.apply()
                self?.track()
            }
        }
    }

    /// Show the header only when a thread is open AND nothing is presented over
    /// it. See `AppState.threadModalPresented` — this window outranks every
    /// normal presentation, so a modal that doesn't set that flag gets the header
    /// stranded on top of it.
    private var headerContext: ThreadContext? {
        appState.threadModalPresented ? nil : appState.activeMessageThread
    }

    /// Top safe-area inset from the MAIN (key) window — stable, not the overlay's.
    private var topInset: CGFloat {
        let key = scene?.keyWindow ?? scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
        return key?.safeAreaInsets.top ?? 0
    }

    private var hiding = false

    private func apply() {
        guard let w = window, let h = host, let scene else { return }
        if let ctx = headerContext {
            // Show / update. Reset any in-flight exit animation.
            hiding = false
            w.layer.removeAllAnimations()
            h.rootView = OverlayHeaderContent(context: ctx, topInset: topInset, theme: theme)
            // Only as tall as the header, so touches below pass through.
            w.frame = CGRect(x: 0, y: 0, width: scene.screen.bounds.width, height: topInset + barHeight)
            w.alpha = 1
            w.isHidden = false
        } else if !w.isHidden && !hiding {
            // Hide by fading + sliding right, in sync with the nav pop, keeping
            // the last header on screen through the animation (don't clear the
            // rootView until it finishes, or it would vanish instantly).
            hiding = true
            UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut]) {
                w.alpha = 0
                w.frame.origin.x = w.bounds.width
            } completion: { [weak self] _ in
                guard let self else { return }
                self.hiding = false
                if self.headerContext == nil { w.isHidden = true }
                w.alpha = 1
                w.frame.origin.x = 0   // reset (the next show re-sets the frame anyway)
            }
        }
    }

    func detach() {
        window?.isHidden = true
        window = nil
        host = nil
        scene = nil
    }
}

// MARK: - Installer
//
// A zero-size, non-interactive SwiftUI view dropped into the app's view tree
// (ContentView). It grabs the UIWindowScene once it's in a window and hands it
// to the controller. The Coordinator retains the controller for the app's life.

struct OverlayWindowInstaller: UIViewRepresentable {
    let appState: AppState
    let theme: ThemeSettings

    func makeCoordinator() -> Coordinator { Coordinator(appState: appState, theme: theme) }

    func makeUIView(context: Context) -> AnchorView {
        let v = AnchorView()
        v.isUserInteractionEnabled = false
        let coord = context.coordinator
        v.onScene = { scene in coord.controller.attach(to: scene) }
        return v
    }

    func updateUIView(_ uiView: AnchorView, context: Context) {}

    static func dismantleUIView(_ uiView: AnchorView, coordinator: Coordinator) {
        coordinator.controller.detach()
    }

    @MainActor final class Coordinator {
        let controller: OverlayWindowController
        init(appState: AppState, theme: ThemeSettings) {
            controller = OverlayWindowController(appState: appState, theme: theme)
        }
    }

    final class AnchorView: UIView {
        var onScene: ((UIWindowScene) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let scene = window?.windowScene { onScene?(scene) }
        }
    }
}

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
