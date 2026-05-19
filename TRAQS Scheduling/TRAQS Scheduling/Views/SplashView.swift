import SwiftUI

struct SplashView: View {
    @Binding var isShowing: Bool

    @State private var overallOpacity = 1.0

    private let logoSize: CGFloat = 64          // very large wordmark — splash hero

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            // Static wordmark — no trace/pen animation. Shows instantly,
            // then the whole splash cross-fades to the app.
            TRAQSWordmark(size: logoSize)
                .fixedSize()
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
