import SwiftUI

struct SplashView: View {
    @Environment(ThemeSettings.self) private var themeSettings
    @Binding var isShowing: Bool

    @State private var logoOpacity = 0.0
    @State private var logoScale = 0.82
    @State private var overallOpacity = 1.0

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            Image(themeSettings.isLightTheme ? "TRAQSLogoBlack" : "TRAQSLogoWhite")
                .resizable()
                .scaledToFit()
                .frame(width: 200)
                .opacity(logoOpacity)
                .scaleEffect(logoScale)
        }
        .opacity(overallOpacity)
        .onAppear {
            // Logo fades in and scales up
            withAnimation(.easeOut(duration: 0.55).delay(0.1)) {
                logoOpacity = 1.0
                logoScale = 1.0
            }
            // Fade out
            withAnimation(.easeIn(duration: 0.4).delay(1.5)) {
                overallOpacity = 0.0
            }
            // Dismiss
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.95) {
                isShowing = false
            }
        }
    }
}
