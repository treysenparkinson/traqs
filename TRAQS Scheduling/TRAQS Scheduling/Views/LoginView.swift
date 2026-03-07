import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Logo / Brand
                VStack(spacing: 8) {
                    Text("TRAQS")
                        .font(.system(size: 52, weight: .black, design: .default))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color(hex: T.accent), Color(hex: "#2563eb")],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                    Text("Scheduling & Production Management")
                        .font(.subheadline)
                        .foregroundColor(Color(hex: T.muted))
                }

                Spacer()

                // Sign in button
                VStack(spacing: 16) {
                    if auth.isLoading {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(1.2)
                    } else {
                        Button {
                            Task { await auth.login() }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "lock.shield.fill")
                                Text("Sign In with Auth0")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Color(hex: T.accent))
                            .foregroundColor(.white)
                            .cornerRadius(14)
                        }
                        .buttonStyle(.plain)
                    }

                    if let error = auth.error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 48)
            }
        }
        #if os(macOS)
        .frame(minWidth: 400, minHeight: 400)
        #endif
    }
}
