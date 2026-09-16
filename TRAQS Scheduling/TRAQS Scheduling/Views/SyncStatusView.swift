import SwiftUI

// MARK: - Shake (Phase 6, STEP 3)
//
// A horizontal shake driven by an incrementing token. Native, no deps. Bump the
// token (e.g. on a save/send failure) and the modified view shakes once. Usage:
//   @State private var shakeToken = 0
//   TextField(...).shakeIfChanged(shakeToken)
//   // on failure: shakeToken += 1

private struct ShakeGeometry: GeometryEffect {
    var travel: CGFloat = 6
    var shakes: CGFloat = 3
    var animatableData: CGFloat   // = token; SwiftUI interpolates 0→1 on change
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(
            translationX: travel * sin(animatableData * .pi * 2 * shakes), y: 0))
    }
}

struct ShakeIfChanged: ViewModifier {
    /// Bump this Int to trigger exactly one shake.
    var token: Int
    func body(content: Content) -> some View {
        content
            .modifier(ShakeGeometry(animatableData: CGFloat(token)))
            .animation(.linear(duration: 0.4), value: token)
    }
}

extension View {
    /// Shake once each time `token` increments.
    func shakeIfChanged(_ token: Int) -> some View { modifier(ShakeIfChanged(token: token)) }
}

// MARK: - Sync status mark
//
// A very small glyph beside the wordmark. Silent when everything is healthy —
// it renders nothing at all, which is most of the time.
//
// Replaces a floating capsule that sat under the header and spelled the state
// out in words ("Reconnecting…", "Sync problem — will retry"). A sentence is a
// lot of chrome for something the user cannot act on, and it moved the eye away
// from the page. Connection state is ambient, so it reads as a mark on the
// brand lockup rather than as a notice.
//
// States come from AppState.syncBadge, debounced upstream so it can't flicker:
//   • offline / error → wifi with an exclamation, pulsing (something is wrong)
//   • reconnecting    → plain wifi, pulsing (it is working on it)
//   • reconnected     → a check, steady, for the ~2s the flash lasts
//   • syncing/hidden  → nothing

struct SyncStatusMark: View {
    @Environment(AppState.self) private var appState
    /// Drives the breathing. Only ever animated for the two pulsing states, so
    /// nothing is left running once the mark goes quiet.
    @State private var dim = false

    var body: some View {
        let badge = appState.syncBadge
        Group {
            switch badge {
            case .offline, .error:
                mark("wifi.exclamationmark", Color(hex: T.red), "Offline — changes won't sync")
                    .opacity(dim ? 0.3 : 1)
            case .reconnecting:
                mark("wifi", Color(hex: T.amber), "Reconnecting")
                    .opacity(dim ? 0.25 : 1)
            case .reconnected:
                mark("checkmark", Color(hex: T.green), "Connected")
            case .syncing, .hidden:
                EmptyView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: badge)
        .onChange(of: badge, initial: true) { _, now in setPulse(for: now) }
    }

    private func mark(_ symbol: String, _ color: Color, _ label: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(color)
            .accessibilityLabel(label)
            .transition(.opacity.combined(with: .scale(scale: 0.8)))
    }

    /// Start the breathing for the two unsettled states, stop it otherwise.
    ///
    /// `repeatForever` really does mean forever, so it has to be turned off
    /// explicitly — left running behind a hidden mark it would keep the view
    /// re-rendering for the life of the app.
    private func setPulse(for badge: AppState.SyncBadge) {
        let pulsing = badge == .offline || badge == .error || badge == .reconnecting
        if pulsing {
            withAnimation(.easeInOut(duration: 0.75).repeatForever(autoreverses: true)) {
                dim = true
            }
        } else {
            withAnimation(.easeInOut(duration: 0.2)) { dim = false }
        }
    }
}
