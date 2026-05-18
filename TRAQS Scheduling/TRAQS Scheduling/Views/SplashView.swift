import SwiftUI

struct SplashView: View {
    @Environment(ThemeSettings.self) private var themeSettings
    @Binding var isShowing: Bool

    @State private var fadeIn = 0.0          // ghost wordmark fade-in
    @State private var traceProgress = 0.0   // left-to-right reveal of the bright wordmark
    @State private var overallOpacity = 1.0  // final fade-out
    @State private var penGlow = 0.0         // pulsing glow on the writing tip

    private let logoWidth: CGFloat = 320
    private let logoHeight: CGFloat = 60

    private var logoAssetName: String {
        themeSettings.isLightTheme ? "TRAQSLogoBlack" : "TRAQSLogoWhite"
    }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            ZStack {
                // Faint "ghost" wordmark fades in first.
                logoImage
                    .opacity(0.18 * fadeIn)

                // Bright wordmark masked to reveal left-to-right (the "writing").
                logoImage
                    .mask(
                        GeometryReader { geo in
                            Rectangle()
                                .frame(width: geo.size.width * traceProgress,
                                       height: geo.size.height,
                                       alignment: .leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    )

                // "Pen tip" — slim accent line tracking the leading edge.
                GeometryReader { geo in
                    let x = geo.size.width * traceProgress
                    Rectangle()
                        .fill(LinearGradient(
                            colors: [Color(hex: T.accent).opacity(0),
                                     Color(hex: T.accent),
                                     Color(hex: T.accent).opacity(0)],
                            startPoint: .top, endPoint: .bottom))
                        .frame(width: 2, height: geo.size.height * 1.15)
                        .position(x: x, y: geo.size.height / 2)
                        .shadow(color: Color(hex: T.accent).opacity(0.85), radius: 8 + penGlow * 4)
                        .opacity(traceProgress > 0.01 && traceProgress < 0.995 ? 1 : 0)
                }
                .allowsHitTesting(false)
            }
            .frame(width: logoWidth, height: logoHeight)
        }
        .opacity(overallOpacity)
        .onAppear { runAnimation() }
    }

    private var logoImage: some View {
        Image(logoAssetName)
            .resizable()
            .scaledToFit()
            .frame(width: logoWidth, height: logoHeight)
    }

    private func runAnimation() {
        // 1. Fade the ghost wordmark in
        withAnimation(.easeOut(duration: 0.35).delay(0.1)) {
            fadeIn = 1.0
        }

        // 2. "Write" the wordmark left-to-right
        withAnimation(.easeInOut(duration: 1.25).delay(0.4)) {
            traceProgress = 1.0
        }

        // 3. Soft pulse on the pen tip while writing
        withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true).delay(0.4)) {
            penGlow = 1.0
        }

        // 4. Fade out
        withAnimation(.easeIn(duration: 0.45).delay(2.1)) {
            overallOpacity = 0.0
        }

        // 5. Dismiss
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) {
            isShowing = false
        }
    }
}
