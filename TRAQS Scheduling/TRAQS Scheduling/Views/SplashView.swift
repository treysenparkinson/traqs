import SwiftUI

// MARK: - Splash · "Aurora" load-up
//
// Port of the Claude Design "TRAQS Aurora Load-up" spec (splash/splash-aurora.jsx).
// Colour fields bloom and drift; the wordmark resolves out of the light — it
// fades up from a soft blur (`spInkOn`) with a pool of accent light gathering
// behind it. The splash then fades into the app.
//
// Two departures from the design file, both requested:
//   • The four hardcoded aurora blobs are replaced by the app's own LIQUID
//     background — the same wash the web offers under background customization
//     — so the splash is tinted by whatever accent the user picked.
//   • No printhead dot and no pulse rings. The previous splash printed the mark
//     with a travelling dot that popped and pulsed away; the aurora resolve
//     replaces that entirely.

struct SplashView: View {
    @Binding var isShowing: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ThemeSettings.self) private var theme

    private let logoSize: CGFloat = 96          // very large wordmark — splash hero

    // Animated state.
    @State private var overallOpacity: Double = 1
    @State private var inkIn = false            // wordmark resolve (opacity + blur)
    @State private var poolIn = false           // light pooling behind the mark
    @State private var started = false

    // Timing, from the design (ms → s). Scene ends at ~2.2s.
    private let poolDelay = 0.50, poolDur = 0.90
    private let inkDelay  = 0.60, inkDur  = 1.00
    private let fadeAt    = 2.00, fadeDur = 0.40

    /// `cubic-bezier(.22,.61,.36,1)` — the design's resolve curve.
    private let resolve = Animation.timingCurve(0.22, 0.61, 0.36, 1, duration: 1.00)

    /// Which wordmark reads on this splash. The mark sits on the LIQUID WASH,
    /// which is the accent colour — not on the theme's page background — so the
    /// choice follows the accent's own luminance: a dark accent (the brand
    /// blues) gets the white mark, a light one (amber, cyan) gets black.
    /// Uses the app's shared contrast rule so the threshold lives in one place.
    private var markOnLightBackground: Bool {
        Color(hex: theme.accent).readableText == .black
    }

    var body: some View {
        ZStack {
            // ── Ground ──
            // Radial base per the design, in the theme's own values so the
            // splash matches whichever background preset is active.
            RadialGradient(
                colors: theme.isLightTheme
                    ? [Color(hex: "#FFFFFF"), Color(hex: "#F3F5FB")]
                    : [Color(hex: "#0C1020"), Color(hex: "#05070C")],
                center: UnitPoint(x: 0.5, y: 0.44),
                startRadius: 0,
                endRadius: 620
            )
            .ignoresSafeArea()

            // ── The liquid wash (replaces the design's four static blobs) ──
            // Thicker and much faster than the ambient page setting: the web's
            // 17–25s paths move almost imperceptibly over a 2.4s splash, so the
            // load-up drives them at ~3.4× with correspondingly bigger travel.
            //
            // Deliberately NOT the page canvas's LiquidTuning values. Matching
            // them was tried and the splash lost its punch — a full-bleed, heavier
            // wash is what reads in 2.4s, where the page needs to stay quiet
            // behind content all day.
            LiquidBackground(thickness: 1.6, energy: 3.4)
                .ignoresSafeArea()
                .opacity(poolIn ? 1 : 0)

            // ── Soft light pooling behind the mark as it resolves ──
            Ellipse()
                .fill(Color(hex: theme.isLightTheme ? T.accent : T.accentGradientStart)
                        .opacity(theme.isLightTheme ? 0.10 : 0.22))
                .frame(width: 300, height: 150)
                .blur(radius: 46)
                .opacity(poolIn ? 1 : 0)

            // ── The wordmark, resolving out of the light ──
            TRAQSWordmark(size: logoSize, onLightBackground: markOnLightBackground)
                .opacity(inkIn ? 1 : 0)
                .blur(radius: inkIn ? 0 : 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(overallOpacity)
        .onAppear { run() }
    }

    private func run() {
        guard !started else { return }
        started = true

        // Reduce Motion → no bloom, no blur resolve; just show the mark and hand off.
        if reduceMotion {
            poolIn = true
            inkIn = true
            withAnimation(.easeIn(duration: fadeDur).delay(0.90)) { overallOpacity = 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.90 + fadeDur) { isShowing = false }
            return
        }

        // 1 — the colour fields bloom in.
        withAnimation(.easeOut(duration: poolDur).delay(poolDelay)) { poolIn = true }

        // 2 — the wordmark resolves out of the light.
        withAnimation(resolve.delay(inkDelay)) { inkIn = true }

        // 3 — the finished scene fades into the app.
        withAnimation(.easeIn(duration: fadeDur).delay(fadeAt)) { overallOpacity = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + fadeAt + fadeDur + 0.05) { isShowing = false }
    }
}
