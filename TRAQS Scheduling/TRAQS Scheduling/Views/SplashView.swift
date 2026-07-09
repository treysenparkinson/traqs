import SwiftUI

struct SplashView: View {
    @Binding var isShowing: Bool

    @State private var overallOpacity = 1.0

    private let logoSize: CGFloat = 96          // very large wordmark — splash hero

    var body: some View {
        ZStack {
            // Plain canvas — no brand gradient or glow. Just the wordmark.
            Color(hex: T.bg).ignoresSafeArea()

            TRAQSWordmark(size: logoSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
