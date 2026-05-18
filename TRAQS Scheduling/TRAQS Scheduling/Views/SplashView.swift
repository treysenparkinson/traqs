import SwiftUI

struct SplashView: View {
    @Binding var isShowing: Bool

    @State private var ghostOpacity = 0.0       // ghost wordmark fade-in
    @State private var traceProgress = 0.0      // left-to-right reveal of the inked wordmark
    @State private var overallOpacity = 1.0
    @State private var penGlow = 0.0

    private let logoSize: CGFloat = 64          // very large wordmark — splash hero

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            ZStack {
                // Ghost wordmark — full image at reduced opacity, fades in first
                TRAQSWordmark(size: logoSize)
                    .opacity(0.16 * ghostOpacity)

                // Inked wordmark, masked left-to-right (the "writing")
                TRAQSWordmark(size: logoSize)
                    .mask(
                        GeometryReader { geo in
                            Rectangle()
                                .frame(width: geo.size.width * traceProgress,
                                       height: geo.size.height,
                                       alignment: .leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    )

                // Pen-tip — sky vertical line riding the trace's leading edge
                GeometryReader { geo in
                    let x = geo.size.width * traceProgress
                    Rectangle()
                        .fill(LinearGradient(
                            colors: [Color(hex: T.sky).opacity(0),
                                     Color(hex: T.sky),
                                     Color(hex: T.sky).opacity(0)],
                            startPoint: .top, endPoint: .bottom))
                        .frame(width: 2, height: geo.size.height * 1.15)
                        .position(x: x, y: geo.size.height / 2)
                        .shadow(color: Color(hex: T.sky).opacity(0.85), radius: 8 + penGlow * 4)
                        .opacity(traceProgress > 0.01 && traceProgress < 0.995 ? 1 : 0)
                }
                .allowsHitTesting(false)
            }
            .fixedSize()
        }
        .opacity(overallOpacity)
        .preferredColorScheme(.light)
        .onAppear { runAnimation() }
    }

    private func runAnimation() {
        withAnimation(.easeOut(duration: 0.35).delay(0.1)) { ghostOpacity = 1.0 }
        withAnimation(.easeInOut(duration: 1.25).delay(0.4)) { traceProgress = 1.0 }
        withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true).delay(0.4)) { penGlow = 1.0 }
        withAnimation(.easeIn(duration: 0.45).delay(2.1)) { overallOpacity = 0.0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { isShowing = false }
    }
}
