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
        } else {
            Color.clear
        }
    }
}

@MainActor
final class OverlayWindowController {
    private let appState: AppState
    private var window: UIWindow?
    private var host: UIHostingController<OverlayHeaderContent>?
    private weak var scene: UIWindowScene?

    // Header window height (status bar + this). Taller than the bar's intrinsic
    // content so there's room below it for a long fade into the page.
    private let barHeight: CGFloat = 108

    init(appState: AppState) { self.appState = appState }

    /// Create the overlay window once, on the given scene.
    func attach(to windowScene: UIWindowScene) {
        guard window == nil else { return }
        scene = windowScene

        let h = UIHostingController(rootView: OverlayHeaderContent(context: nil, topInset: 0))
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
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.apply()
                self?.track()
            }
        }
    }

    /// Top safe-area inset from the MAIN (key) window — stable, not the overlay's.
    private var topInset: CGFloat {
        let key = scene?.keyWindow ?? scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
        return key?.safeAreaInsets.top ?? 0
    }

    private func apply() {
        guard let w = window, let h = host, let scene else { return }
        let ctx = appState.activeMessageThread
        let top = topInset
        h.rootView = OverlayHeaderContent(context: ctx, topInset: top)
        if ctx != nil {
            // Only as tall as the header, so touches below pass through.
            w.frame = CGRect(x: 0, y: 0, width: scene.screen.bounds.width, height: top + barHeight)
            w.isHidden = false
        } else {
            w.isHidden = true
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

    func makeCoordinator() -> Coordinator { Coordinator(appState: appState) }

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
        init(appState: AppState) { controller = OverlayWindowController(appState: appState) }
    }

    final class AnchorView: UIView {
        var onScene: ((UIWindowScene) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let scene = window?.windowScene { onScene?(scene) }
        }
    }
}
