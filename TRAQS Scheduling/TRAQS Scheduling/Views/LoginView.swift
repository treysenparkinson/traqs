import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 28) {
                Spacer()

                VStack(spacing: 12) {
                    TRAQSWordmark(size: 56)
                    Text("Scheduling & Production Management")
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .tLabel(tracking: 0.8)
                }

                Spacer()

                VStack(spacing: 16) {
                    if auth.isLoading {
                        ProgressView()
                            .tint(Color(hex: T.sky))
                            .scaleEffect(1.2)
                    } else {
                        Button {
                            Task { await auth.login() }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "lock.shield.fill")
                                    .font(.system(size: 16, weight: .semibold))
                                Text("Sign in with Auth0")
                                    .font(TTypo.smBold(15))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Capsule().fill(Color(hex: T.sky)))
                            .foregroundStyle(.white)
                            .shadow(color: Color(hex: T.sky).opacity(T.skyShadowOpacity),
                                    radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                        }
                        .buttonStyle(.plain)
                    }

                    if let error = auth.error {
                        Text(error)
                            .font(TTypo.xs(12))
                            .foregroundStyle(Color(hex: T.red))
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.light)
        #if os(macOS)
        .frame(minWidth: 400, minHeight: 400)
        #endif
    }
}
