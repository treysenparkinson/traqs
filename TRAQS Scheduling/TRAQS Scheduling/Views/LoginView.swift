import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ZStack {
            AnimatedLoginBackground()

            VStack(spacing: 28) {
                Spacer()

                // ── Brand lockup ──────────────────────────────────────────
                VStack(spacing: 14) {
                    TRAQSWordmark(size: 120)
                    Text("Scheduling & Production Management")
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .tLabel(tracking: 0.8)
                }

                Spacer()

                // ── Frosted sign-in panel ─────────────────────────────────
                VStack(spacing: 16) {
                    if auth.isLoading {
                        ProgressView()
                            .tint(Color(hex: T.sky))
                            .scaleEffect(1.2)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    } else {
                        GradientCTA(verticalPadding: 16) {
                            Task { await auth.login() }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "lock.shield.fill")
                                    .font(.system(size: 16, weight: .semibold))
                                Text("Sign in with Auth0")
                                    .font(TTypo.smBold(15))
                            }
                        }
                    }

                    if let error = auth.error {
                        Text(error)
                            .font(TTypo.xs(12))
                            .foregroundStyle(Color(hex: T.red))
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(24)
                .frostedCard(radius: T.cornerHero)
                .padding(.horizontal, 28)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.light)
        #if os(macOS)
        .frame(minWidth: 400, minHeight: 400)
        #endif
    }
}

// MARK: - Animated login background
// A fun, slowly drifting light-blue & white gradient with soft blue blobs.
private struct AnimatedLoginBackground: View {
    @State private var animate = false

    var body: some View {
        ZStack {
            // Light blue → white base, with the gradient direction easing
            // back and forth so it feels alive.
            LinearGradient(
                colors: [Color(hex: "#CFE6FF"), Color(hex: "#FFFFFF")],
                startPoint: animate ? .topLeading : .top,
                endPoint: animate ? .bottom : .bottomTrailing)

            // Two soft blue blobs drifting in opposite directions.
            Circle()
                .fill(Color(hex: "#8FC4FF").opacity(0.55))
                .frame(width: 340, height: 340)
                .blur(radius: 90)
                .offset(x: animate ? -130 : 120, y: animate ? -200 : -120)

            Circle()
                .fill(Color(hex: "#BBDEFF").opacity(0.6))
                .frame(width: 380, height: 380)
                .blur(radius: 100)
                .offset(x: animate ? 150 : -110, y: animate ? 240 : 300)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 7).repeatForever(autoreverses: true)) {
                animate = true
            }
        }
    }
}
