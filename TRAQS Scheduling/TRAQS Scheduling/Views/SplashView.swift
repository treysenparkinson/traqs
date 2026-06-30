import SwiftUI

struct SplashView: View {
    @Binding var isShowing: Bool

    @State private var overallOpacity = 1.0

    private let logoSize: CGFloat = 96          // very large wordmark — splash hero

    var body: some View {
        ZStack {
            // Brand canvas: tinted vertical gradient + ambient glow blobs.
            AmbientBackground()

            // Static wordmark — no trace/pen animation. Shows instantly,
            // then the whole splash cross-fades to the app. A soft lavender
            // glow sits directly behind it so the wordmark reads as the hero.
            ZStack {
                SplashWordmarkGlow()
                TRAQSWordmark(size: logoSize)
                    .fixedSize()
            }
        }
        .opacity(overallOpacity)
        .preferredColorScheme(.light)
        .onAppear { runAnimation() }
    }

    private func runAnimation() {
        // Hold briefly, then fade the splash out into the app.
        withAnimation(.easeIn(duration: 0.45).delay(0.7)) { overallOpacity = 0.0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { isShowing = false }
    }
}

// One-off, splash-local: a soft radial brand glow that haloes the wordmark.
// Echoes the AmbientBackground glow language using the signature accent stops.
private struct SplashWordmarkGlow: View {
    var body: some View {
        RadialGradient(
            colors: [
                Color(hex: T.accentGradientStart).opacity(0.30),
                Color(hex: T.accentGradientEnd).opacity(0.16),
                .clear
            ],
            center: .center, startRadius: 0, endRadius: 220)
            .frame(width: 440, height: 440)
            .blur(radius: 36)
            .allowsHitTesting(false)
    }
}
