import SwiftUI

// MARK: - Splash · "Printhead" load-up
// The brand wordmark is "printed" onto the canvas: a glowing accent dot pops in
// at the left baseline, glides left→right (slow→fast→slow) while the wordmark is
// revealed behind its travelling front, then pulses away. The splash then fades
// into the app. Mirrors the Claude Design "TRAQS Logo Load-up · Printhead" spec.
//
// We reveal the real brand wordmark PNG (rather than re-typesetting "traqs") so
// the mark stays pixel-faithful; the design's `spClipX` becomes a leading mask.

struct SplashView: View {
    @Binding var isShowing: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let logoSize: CGFloat = 96          // very large wordmark — splash hero

    // Measured rendered width of the wordmark (drives the reveal + dot travel).
    @State private var wordWidth: CGFloat = 0
    @State private var started = false

    // Animated state.
    @State private var overallOpacity: Double = 1
    @State private var revealFraction: CGFloat = 0     // 0…1 — how much of the mark is printed
    @State private var dotProgress: CGFloat = 0         // 0…1 — dot position along the mark
    @State private var dotScale: CGFloat = 0
    @State private var dotOpacity: Double = 0
    @State private var ringInScale: CGFloat = 0.5       // pop-in ring
    @State private var ringInOpacity: Double = 0
    @State private var ringOutScale: CGFloat = 1        // pulse-out ring
    @State private var ringOutOpacity: Double = 0

    // Geometry derived from the wordmark.
    private var dotSize: CGFloat { logoSize * 0.14 }
    private var dotBaselineY: CGFloat { logoSize * 0.18 }   // below center → near baseline

    // Motion curves lifted from the design.
    private let glide = Animation.timingCurve(0.65, 0, 0.35, 1, duration: 0.62)   // slow→fast→slow
    private let pulseOut = Animation.timingCurve(0.22, 0.61, 0.36, 1, duration: 0.34)
    private let pop = Animation.spring(response: 0.24, dampingFraction: 0.5)      // overshoot pop-in

    var body: some View {
        ZStack {
            // Plain canvas — no brand gradient or glow. Just the wordmark.
            Color(hex: T.bg).ignoresSafeArea()

            ZStack {
                // Wordmark, revealed left→right by a leading mask.
                TRAQSWordmark(size: logoSize)
                    .mask(alignment: .leading) {
                        Rectangle()
                            .frame(width: max(0, wordWidth * revealFraction))
                    }
                    .background(
                        GeometryReader { geo in
                            Color.clear
                                .onAppear { measure(geo.size.width) }
                                .onChange(of: geo.size.width) { _, w in measure(w) }
                        }
                    )

                // Travelling printhead dot (rides the reveal front, on the baseline).
                if !reduceMotion {
                    printhead
                        .offset(x: -wordWidth / 2 + dotProgress * wordWidth,
                                y: dotBaselineY)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(overallOpacity)
        .preferredColorScheme(.light)
    }

    // The dot + its pop-in and pulse-out rings, all tinted with the app accent.
    private var printhead: some View {
        let accent = Color(hex: T.accent)
        return ZStack {
            // Pop-in ring.
            Circle()
                .stroke(accent, lineWidth: 2)
                .frame(width: dotSize, height: dotSize)
                .scaleEffect(ringInScale)
                .opacity(ringInOpacity)

            // Pulse-out ring.
            Circle()
                .stroke(accent, lineWidth: 2)
                .frame(width: dotSize, height: dotSize)
                .scaleEffect(ringOutScale)
                .opacity(ringOutOpacity)

            // The dot itself, with a soft accent glow.
            Circle()
                .fill(accent)
                .frame(width: dotSize, height: dotSize)
                .shadow(color: accent.opacity(0.65), radius: dotSize * 0.85)
                .scaleEffect(dotScale)
                .opacity(dotOpacity)
        }
    }

    // Store the measured width once and kick the animation off.
    private func measure(_ w: CGFloat) {
        guard w > 0 else { return }
        wordWidth = w
        guard !started else { return }
        started = true
        run()
    }

    private func run() {
        // Reduce Motion → skip the print; just resolve the wordmark and hand off.
        if reduceMotion {
            revealFraction = 1
            withAnimation(.easeIn(duration: 0.4).delay(0.6)) { overallOpacity = 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { isShowing = false }
            return
        }

        // 1 — dot pops in at the left baseline (overshoot), with an expanding ring.
        withAnimation(pop) { dotScale = 1; dotOpacity = 1 }
        ringInOpacity = 0.6
        withAnimation(.easeOut(duration: 0.45)) { ringInScale = 2.4; ringInOpacity = 0 }

        // 2 — dot glides across, printing the wordmark behind its front.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.20) {
            withAnimation(glide) { revealFraction = 1; dotProgress = 1 }
        }

        // 3 — dot pulses away.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.85) {
            ringOutOpacity = 0.55
            ringOutScale = 1
            withAnimation(pulseOut) {
                dotScale = 2.3
                dotOpacity = 0
                ringOutScale = 3
                ringOutOpacity = 0
            }
        }

        // 4 — fade the finished mark out into the app.
        withAnimation(.easeIn(duration: 0.4).delay(1.30)) { overallOpacity = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.75) { isShowing = false }
    }
}
