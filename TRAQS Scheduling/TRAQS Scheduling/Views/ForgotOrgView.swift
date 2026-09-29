import SwiftUI

// MARK: - Forgot org code · recovering it by email
//
// The web's ForgotOrgStep (src/App.jsx), on the same paper set as WelcomeView
// and OrgSignupView so reaching it from the welcome card doesn't drop you into
// a different looking product.
//
// `POST /forgot-org` is unauthenticated and ADMIN-ONLY: it mails the codes of
// every organization the address administers, and nothing to anybody else. It
// answers the same way whether or not anything matched, so this screen never
// promises delivery — see `sentPanel`.

private enum Paper {
    static let card = Color(hex: "#FBFAF7")
    static let ink = Color(hex: "#0B0B0C")
    static let stone = Color(hex: "#8A867E")
    static let hairline = Color(hex: "#101828").opacity(0.08)
    /// The button blue — fixed, not the customization accent. See WelcomeView.
    static let blue = Color(hex: "#4169E1")
}

struct ForgotOrgView: View {
    /// Back to the welcome screen's code step.
    let onBack: () -> Void

    @State private var email = ""
    @State private var loading = false
    @State private var error: String?
    @State private var sent = false
    @FocusState private var emailFocused: Bool

    var body: some View {
        GeometryReader { screen in
            ScrollView {
                VStack(spacing: 0) {
                    TRAQSHeaderLogo(size: 52, fixedBrand: true)
                        .padding(.top, 24)
                        .padding(.bottom, 14)
                    VStack(spacing: 5) {
                        Text(sent ? "Check your email" : "Find your organization")
                            .font(TTypo.h3(20))
                            .tracking(-0.4)
                            .foregroundStyle(Paper.ink)
                        if !sent {
                            Text("We'll send the code to the administrator's address.")
                                .font(TTypo.sm(13.5))
                                .foregroundStyle(Paper.stone)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.bottom, 22)

                    card

                    Text("Secured by Auth0 · TRAQS")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .tracking(0.8)
                        .foregroundStyle(Color(hex: "#B4B0A7"))
                        .padding(.top, 16)
                }
                .padding(.bottom, 24)
                .frame(maxWidth: 440)
                .padding(.horizontal, 22)
                .frame(maxWidth: .infinity, minHeight: screen.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .preferredColorScheme(.light)
        .animation(.easeInOut(duration: 0.22), value: sent)
    }

    // MARK: - Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if sent { sentPanel } else { form }
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 26)
        .background(RoundedRectangle(cornerRadius: T.cornerHero, style: .continuous).fill(Paper.card))
        .overlay(RoundedRectangle(cornerRadius: T.cornerHero, style: .continuous)
            .strokeBorder(Paper.hairline, lineWidth: 1))
        .shadow(color: .black.opacity(0.07), radius: 30, x: 0, y: 18)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let error {
                Text(error)
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: "#B42318"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(hex: "#EF4444").opacity(0.08)))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color(hex: "#EF4444").opacity(0.28), lineWidth: 1))
                    .padding(.bottom, 16)
            }

            Text("WORK EMAIL ADDRESS")
                .font(TTypo.xsBold(10))
                .tracking(1)
                .foregroundStyle(Paper.stone)
                .padding(.bottom, 8)

            TextField("you@yourcompany.com", text: $email)
                .textFieldStyle(.plain)
                .font(.custom(TFontName.bold.rawValue, size: 17))
                .foregroundStyle(Paper.ink)
                .focused($emailFocused)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                #endif
                .submitLabel(.send)
                .onSubmit { Task { await submit() } }
                .padding(.horizontal, 20).padding(.vertical, 14)
                .background(Capsule(style: .continuous).fill(Color.white))
                .overlay(Capsule(style: .continuous)
                    .strokeBorder(emailFocused ? Paper.blue : Paper.hairline, lineWidth: 1))
                .animation(.easeInOut(duration: 0.15), value: emailFocused)

            sendButton.padding(.top, 18)
            backLink.padding(.top, 14)
        }
        .onAppear { emailFocused = true }
    }

    /// Deliberately says "if": the endpoint answers the same way whether or not
    /// anything matched, so that a stranger cannot use it to find out which
    /// addresses run an organization. Promising delivery here would give that
    /// away in the UI instead.
    private var sentPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("If that address is an administrator of a TRAQS organization, its code is on its way. It can take a minute to arrive.")
                .font(TTypo.sm(13.5))
                .foregroundStyle(Paper.stone)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 18)

            Button(action: onBack) {
                Text("Back to sign in")
                    .font(TTypo.smBold(15))
                    .foregroundStyle(glassCTALabel(Paper.blue))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .glassCTA(in: Capsule(style: .continuous), tint: Paper.blue)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Buttons

    private var sendButton: some View {
        Button { Task { await submit() } } label: {
            Group {
                if loading {
                    ProgressView().tint(glassCTALabel(Paper.blue))
                } else {
                    Text("Send my org code").font(TTypo.smBold(15))
                }
            }
            .foregroundStyle(glassCTALabel(Paper.blue))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .glassCTA(in: Capsule(style: .continuous), tint: Paper.blue)
        }
        .buttonStyle(.plain)
        .disabled(loading)
    }

    /// A quiet text link, as on the web: the send button is what you came here
    /// to press, and a second full button would compete with it.
    private var backLink: some View {
        Button(action: onBack) {
            Text("Back to sign in")
                .font(TTypo.sm(13))
                .underline()
                .foregroundStyle(Paper.stone)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .disabled(loading)
    }

    // MARK: - Send

    private func submit() async {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty, trimmed.contains("@") else {
            error = "Please enter a valid email address."
            return
        }
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }

        do {
            try await APIService.forgotOrgCode(email: trimmed)
            emailFocused = false
            sent = true
        } catch let failure as APIService.ServerMessageError {
            self.error = failure.message
        } catch {
            self.error = "Couldn't reach TRAQS. Check your connection and try again."
        }
    }
}
