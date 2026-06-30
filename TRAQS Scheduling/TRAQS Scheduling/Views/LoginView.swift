import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 28) {
                Spacer()

                // ── Brand lockup ──────────────────────────────────────────
                VStack(spacing: 14) {
                    TRAQSWordmark(size: 80)
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
