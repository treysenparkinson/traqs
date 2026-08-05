import SwiftUI

// MARK: - Lunch / Break confirmation banner
//
// A deliberately loud, unmissable confirmation shown AFTER a lunch or break
// toggle succeeds. The whole point is that a worker glancing at the phone can
// tell LUNCH from BREAK without reading — so the word is huge and the
// started/ended state is the smaller second line.
//
// Styled to match the nav bar: Liquid Glass on a heavily rounded rect, with the
// word and icon in the org's chosen accent gradient (T.brandGradient), so it
// re-tints along with everything else in Customize.
//
// Auto-dismisses after `autoDismissAfter`; a tap anywhere closes it early.

enum ClockActionBannerKind: Equatable {
    case lunchStarted, lunchEnded, breakStarted, breakEnded

    /// The dominant word — the thing they're meant to read at a glance.
    var word: String {
        switch self {
        case .lunchStarted, .lunchEnded: return "LUNCH"
        case .breakStarted, .breakEnded: return "BREAK"
        }
    }

    var state: String { started ? "STARTED" : "ENDED" }

    var started: Bool {
        switch self {
        case .lunchStarted, .breakStarted: return true
        case .lunchEnded, .breakEnded:     return false
        }
    }

    var icon: String {
        if !started { return "play.circle.fill" }
        switch self {
        case .lunchStarted: return "fork.knife"
        case .breakStarted: return "cup.and.saucer.fill"
        default:            return "play.circle.fill"
        }
    }

    /// One plain-language line under the shout, so there's no ambiguity about
    /// what it did to their pay.
    var subtitle: String {
        switch self {
        case .lunchStarted: return "Your pay clock is paused"
        case .lunchEnded:   return "Your pay clock is running again"
        case .breakStarted: return "You're still on the clock"
        case .breakEnded:   return "Welcome back"
        }
    }
}

struct ClockActionBanner: View {
    @Environment(ThemeSettings.self) private var theme
    let kind: ClockActionBannerKind
    var autoDismissAfter: Double = 1.6
    let onDismiss: () -> Void

    @State private var shown = false

    /// Softer than any card on the page — the banner should read as a floating
    /// pebble, not another panel.
    private let radius: CGFloat = 36

    var body: some View {
        // Touch the theme so a live Customize accent change re-tints the banner
        // (the T.* tokens it reads aren't observable on their own) — same
        // reason FrostedCard does this.
        _ = theme.accent

        // Dimmed and blurred backdrop, matching the PIN pad and the end-job
        // photo prompt. This DOES swallow taps for as long as the banner is up,
        // where the page underneath used to stay live — acceptable because a tap
        // anywhere dismisses and `autoDismissAfter` closes it regardless, so the
        // page is never unreachable for more than a moment.
        //
        // The scrim also fills the whole screen (safe area included), so the
        // card lands on the TRUE center rather than the center of whatever
        // container it was dropped into.
        return ZStack {
            ModalScrim { onDismiss() }
            card
        }
        .ignoresSafeArea()
    }

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return VStack(spacing: 10) {   // `shape` is the tap/hit shape below
            Image(systemName: kind.icon)
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(T.brandGradient(start: .top, end: .bottom))

            VStack(spacing: 1) {
                // The shout. minimumScaleFactor keeps it on one line at the
                // largest Dynamic Type sizes instead of wrapping mid-word.
                Text(kind.word)
                    .font(.custom(TFontName.extrabold.rawValue, size: 32))
                    .tLabel(tracking: 1.2)
                    .foregroundStyle(T.brandGradient(start: .top, end: .bottom))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                Text(kind.state)
                    .font(.custom(TFontName.bold.rawValue, size: 17))
                    .tLabel(tracking: 2.2)
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }

            Text(kind.subtitle)
                .font(TTypo.xs(12))
                .foregroundStyle(Color(hex: T.muted))
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 24)
        .padding(.horizontal, 26)
        .frame(maxWidth: 260)
        // Real frosted glass — the shared recipe, also used by the PIN pad and
        // the end-job photo prompt.
        .glassPanel(radius: radius)
        .scaleEffect(shown ? 1 : 0.88)
        .opacity(shown ? 1 : 0)
        .contentShape(shape)
        .onTapGesture { onDismiss() }
        .sensoryFeedback(.success, trigger: kind)
        .onAppear {
            withAnimation(.spring(response: 0.34, dampingFraction: 0.72)) { shown = true }
            // Keyed to `kind` via the caller's .id(), so a second toggle while
            // one is still up replaces the view (and this timer) cleanly.
            Task {
                try? await Task.sleep(nanoseconds: UInt64(autoDismissAfter * 1_000_000_000))
                if !Task.isCancelled { onDismiss() }
            }
        }
    }
}
