import SwiftUI

struct OrgCodeView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState

    /// Email we tried to auto-resolve. Shown in the subtitle so the user can
    /// confirm they're logged in as the right person before typing a code.
    var noticeEmail: String? = nil
    /// Human-readable explanation when auto-link couldn't find/resolve an org.
    /// `nil` means we fell here without trying (e.g. first launch).
    var autoLinkError: String? = nil

    @State private var code = ""
    @State private var isChecking = false
    @State private var error: String?

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 28) {
                Spacer()

                // Brand mark — gradient avatar tile, echoing the wireframe's
                // gradient identity language.
                Avatar(initials: "T", size: 72, gradient: true)

                VStack(spacing: 8) {
                    Text("Enter Org Code")
                        .font(.custom(TFontName.bold.rawValue, size: 30))
                        .foregroundStyle(Color(hex: T.ink))
                    if let msg = autoLinkError {
                        Text(msg)
                            .font(TTypo.sm(14))
                            .foregroundColor(Color(hex: T.muted))
                            .multilineTextAlignment(.center)
                    } else {
                        Text("Enter your organization's TRAQS code to continue.")
                            .font(TTypo.sm(14))
                            .foregroundColor(Color(hex: T.muted))
                            .multilineTextAlignment(.center)
                    }
                    if let email = noticeEmail, !email.isEmpty {
                        Text("Signed in as \(email)")
                            .font(.caption)
                            .foregroundColor(Color(hex: T.muted))
                    }
                }

                // Frosted input card — frosted hero surface holds the code field,
                // any inline error, and the gradient CTA.
                VStack(spacing: 14) {
                    TextField("Org Code", text: $code)
                        .textFieldStyle(.plain)
                        .font(.custom(TFontName.bold.rawValue, size: 17))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                                .fill(Color(hex: T.bg))
                        )
                        .foregroundColor(Color(hex: T.ink))
                        .overlay(
                            RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                                .stroke(Color(hex: T.hair), lineWidth: 1)
                        )
                        .autocorrectionDisabled()
                        .onChange(of: code) { code = code.uppercased() }
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        #endif
                        .onSubmit { Task { await submit() } }

                    if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    GradientCTA(
                        disabled: code.trimmingCharacters(in: .whitespaces).isEmpty || isChecking,
                        dimmed: code.trimmingCharacters(in: .whitespaces).isEmpty || isChecking,
                        verticalPadding: 15,
                        action: { Task { await submit() } }
                    ) {
                        if isChecking {
                            ProgressView().tint(.white)
                        } else {
                            HStack(spacing: 8) {
                                Text("Continue")
                                    .font(.custom(TFontName.bold.rawValue, size: 16))
                                TIconView(icon: .chev, size: 15, color: .white, weight: .bold)
                            }
                        }
                    }
                }
                .padding(20)
                .frostedCard(radius: T.cornerHero)

                Spacer()

                Button("Sign Out") {
                    auth.logout()
                }
                .foregroundColor(.red)
                .font(TTypo.smBold(13))
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 28)
        }
        #if os(macOS)
        .frame(minWidth: 400, minHeight: 400)
        #endif
    }

    private func submit() async {
        let upper = code.trimmingCharacters(in: .whitespaces).uppercased()
        guard !upper.isEmpty else { return }
        isChecking = true
        error = nil

        // Verify org exists before proceeding
        guard let url = URL(string: "\(AppConfig.netlifyBase)/org?code=\(upper)") else {
            self.error = "Invalid URL"
            isChecking = false
            return
        }

        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0

            guard statusCode == 200 else {
                self.error = "Org code not found (HTTP \(statusCode))"
                isChecking = false
                return
            }

            guard auth.accessToken != nil else {
                self.error = "No auth token — sign out and back in"
                isChecking = false
                return
            }

            appState.matchEmail = auth.userEmail
            appState.configure(auth: auth, orgCode: upper)
            await appState.loadAll()
        } catch {
            self.error = "Network error: \(error.localizedDescription)"
        }
        isChecking = false
    }
}
