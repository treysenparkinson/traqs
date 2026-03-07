import SwiftUI

struct OrgCodeView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState

    @State private var code = ""
    @State private var isChecking = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 8) {
                    Text("Enter Org Code")
                        .font(.title.bold())
                        .foregroundColor(Color(hex: T.text))
                    Text("Enter your organization's TRAQS code to continue.")
                        .font(.subheadline)
                        .foregroundColor(Color(hex: T.muted))
                        .multilineTextAlignment(.center)
                }

                VStack(spacing: 12) {
                    TextField("Org Code", text: $code)
                        .textFieldStyle(.plain)
                        .padding()
                        .background(Color(hex: T.surface))
                        .cornerRadius(12)
                        .foregroundColor(Color(hex: T.text))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
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
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        Group {
                            if isChecking {
                                ProgressView().tint(.white)
                            } else {
                                Text("Continue")
                                    .fontWeight(.semibold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color(hex: T.accent))
                        .foregroundColor(.white)
                        .cornerRadius(14)
                    }
                    .buttonStyle(.plain)
                    .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isChecking)
                }

                Spacer()

                Button("Sign Out") {
                    auth.logout()
                }
                .foregroundColor(Color(hex: T.muted))
                .font(.caption)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 32)
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
        guard let url = URL(string: "https://traqs.netlify.app/.netlify/functions/org?code=\(upper)") else {
            self.error = "Invalid URL"
            isChecking = false
            return
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            print("📡 Org lookup status: \(statusCode), body: \(String(data: data, encoding: .utf8) ?? "nil")")

            guard statusCode == 200 else {
                self.error = "Org code not found (HTTP \(statusCode))"
                isChecking = false
                return
            }

            guard let token = auth.accessToken else {
                self.error = "No auth token — sign out and back in"
                isChecking = false
                return
            }

            appState.matchEmail = auth.userEmail
            appState.configure(token: token, orgCode: upper)
            await appState.loadAll()
        } catch {
            self.error = "Network error: \(error.localizedDescription)"
        }
        isChecking = false
    }
}
