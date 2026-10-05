import SwiftUI

// MARK: - Splash · load-up (iOS Wireframes v2, screen 00)
//
// The flat canvas, the real lockup — the wordmark asset and the native bars mark,
// never redrawn — and two moves: the wordmark fades and settles in from 0.8×,
// centred on its own; then the four bars draw left to right, each a beat after the
// one above, while the wordmark slides left so the finished lockup lands centred.
// "Loading your day…" sits near the bottom. The finished scene fades into the app.
//
// Timing: wordmark 0–0.8s, bars from 0.3s after it settles, 0.38s each with a 0.08s stagger
// (the slide runs the bars' whole span on the same curve), hold, then fade.

struct SplashView: View {
    @Binding var isShowing: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ThemeSettings.self) private var theme

    /// Wordmark height — the design's 56pt wordmark, set as the lockup's height.
    private let logoSize: CGFloat = 78

    @State private var markIn = false
    @State private var drawn: [CGFloat] = [0, 0, 0, 0]
    @State private var slid = false
    @State private var overallOpacity: Double = 1
    @State private var started = false

    private let markDur = 0.80
    private let barsAt = 1.10, barDur = 0.38, barStagger = 0.08
    private let fadeAt = 2.30, fadeDur = 0.40

    /// `cubic-bezier(.2,.8,.2,1)` and `(.65,0,.35,1)` — the design's two curves.
    private var markCurve: Animation { .timingCurve(0.2, 0.8, 0.2, 1, duration: markDur) }
    private func barCurve(_ i: Int) -> Animation {
        .timingCurve(0.65, 0, 0.35, 1, duration: barDur).delay(barsAt + Double(i) * barStagger)
    }

    // ── Centring the INK, not the frame ──
    // TRAQSHeaderLogo is the wordmark PNG plus the bars, pulled left by
    // 15/64 of the size to clear the PNG's built-in right margin. The PNG also
    // carries 14.1% of its width as empty margin on the LEFT (see GlassHeader's
    // `logoLeftBearing` note). So the visible ink of the wordmark alone runs from
    // 14.1% of its width to its width minus that right margin, and the finished
    // lockup's ink from the same left edge to the end of the bars. Each offset
    // below moves that ink's centre onto the frame's centre.
    private var wordW: CGFloat { (logoSize * TRAQSWordmark.aspect).rounded() }
    private var pull: CGFloat { logoSize * (15.0 / 64.0) }
    private var barsW: CGFloat { logoSize * (21.0 / 64.0) * (184.0 / 150.0) }
    private var lockupW: CGFloat { wordW - pull + barsW }
    private var inkLeft: CGFloat { wordW * 0.141 }
    /// Wordmark alone, centred.
    private var startOffset: CGFloat { lockupW / 2 - (inkLeft + wordW - pull) / 2 }
    /// Wordmark + lines, centred.
    private var endOffset: CGFloat { lockupW / 2 - (inkLeft + lockupW) / 2 }

    var body: some View {
        let _ = theme.bgPresetId
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            TRAQSHeaderLogo(size: logoSize, barsDrawn: drawn)
                .offset(x: slid ? endOffset : startOffset)
                .opacity(markIn ? 1 : 0)
                .scaleEffect(markIn ? 1 : 0.8)

            VStack {
                Spacer()
                Text("Loading your day…")
                    .font(.custom(TFontName.medium.rawValue, size: 12))
                    .tracking(0.5)
                    .foregroundStyle(Color(hex: T.muted))
                    .padding(.bottom, 60)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(overallOpacity)
        .onAppear { run() }
    }

    private func run() {
        guard !started else { return }
        started = true

        // Reduce Motion → the finished lockup, then hand off.
        if reduceMotion {
            markIn = true
            drawn = [1, 1, 1, 1]
            slid = true
            withAnimation(.easeIn(duration: fadeDur).delay(0.9)) { overallOpacity = 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9 + fadeDur) { isShowing = false }
            return
        }

        withAnimation(markCurve) { markIn = true }
        for i in drawn.indices {
            withAnimation(barCurve(i)) { drawn[i] = 1 }
        }
        // The slide spans the bars from the first starting to the last finishing.
        let slideDur = barDur + Double(drawn.count - 1) * barStagger
        withAnimation(.timingCurve(0.65, 0, 0.35, 1, duration: slideDur).delay(barsAt)) { slid = true }
        withAnimation(.easeIn(duration: fadeDur).delay(fadeAt)) { overallOpacity = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + fadeAt + fadeDur + 0.05) { isShowing = false }
    }
}
