import SwiftUI

struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState
    @State private var showSplash = true

    // Email-based org auto-link state. We try once per login session.
    // `attempted` gates the lookup so a re-render doesn't re-fire it.
    // `matches.count == 0` falls through to OrgCodeView. `> 1` shows the picker.
    @State private var attemptedAutoLink = false
    @State private var lookupInFlight = false
    @State private var lookupMatches: [OrgMatch] = []
    @State private var lookupError: String?

    var body: some View {
        ZStack(alignment: .top) {
            Group {
                if !auth.isAuthenticated {
                    LoginView()
                } else if lookupInFlight {
                    OrgLinkingView()
                } else if lookupMatches.count > 1 && appState.orgCode.isEmpty {
                    OrgPickerView(matches: lookupMatches) { pick in
                        applyOrg(code: pick.code)
                    }
                } else if appState.orgCode.isEmpty {
                    OrgCodeView(noticeEmail: auth.userEmail, autoLinkError: lookupError)
                } else {
                    MainTabView()
                        .task { await appState.loadAll() }
                }
            }
            .animation(.easeInOut, value: auth.isAuthenticated)
            .onAppear { handleAuthState() }
            .onChange(of: auth.isAuthenticated) { _, _ in handleAuthState() }
            .onChange(of: auth.userEmail) { _, _ in handleAuthState() }

            ErrorBanner()
                .zIndex(2)
        }
        // The splash is an OVERLAY, not a ZStack sibling. As a sibling it drove
        // the ZStack's width (its 440pt-wide glow made the whole stack wider
        // than the screen), so the app content laid out too wide — title
        // clipped at the left edge, cards edge-to-edge — for the entire time
        // the splash was on screen, then snapped back when it unmounted. An
        // overlay is sized to its host and never affects the host's layout.
        .overlay {
            // The logo loadup only plays once the user is authenticated — an
            // unauthenticated launch goes straight to the login screen.
            if showSplash && auth.isAuthenticated {
                SplashView(isShowing: $showSplash)
                    .transition(.opacity)
            }
        }
    }

    private func handleAuthState() {
        guard auth.isAuthenticated, let token = auth.accessToken else { return }

        // Returning user with a known org → bring up the app immediately while
        // we still re-verify membership in the background. This keeps cold
        // launches fast and matches the web's sessionStorage behavior.
        if !appState.orgCode.isEmpty {
            appState.matchEmail = auth.userEmail
            appState.configure(auth: auth, orgCode: appState.orgCode)
        }

        // Run the email→org lookup once per session. Even when we already have
        // an orgCode, we re-verify so a stale Keychain entry (the symptom
        // behind the "blank profile, no jobs" report) gets corrected to the
        // org the user actually belongs to.
        guard !attemptedAutoLink, let email = auth.userEmail, !email.isEmpty else { return }
        attemptedAutoLink = true

        Task { await runAutoLink(email: email, token: token) }
    }

    private func runAutoLink(email: String, token: String) async {
        // Only show the linking spinner when we have nothing to fall back on.
        // For returning users the app's already up — we silently correct in
        // the background.
        let cold = appState.orgCode.isEmpty
        if cold { lookupInFlight = true }
        defer { lookupInFlight = false }

        do {
            let matches = try await APIService.lookupOrgByEmail(email: email, token: token)
            lookupMatches = matches

            if matches.count == 1 {
                applyOrg(code: matches[0].code)
            } else if matches.isEmpty {
                lookupError = "No TRAQS organization is set up for \(email). Ask your admin to add you, or enter your org code manually."
            }
            // matches.count > 1 → the body picks up lookupMatches and shows the picker
        } catch {
            // Network failure on the lookup is non-fatal: if we already have
            // an orgCode the app keeps running; if not, fall through to manual entry.
            lookupError = "Couldn't auto-detect your org. Enter your code below."
        }
    }

    private func applyOrg(code: String) {
        guard auth.accessToken != nil else { return }
        appState.matchEmail = auth.userEmail
        appState.configure(auth: auth, orgCode: code)
        lookupMatches = []
    }
}

// MARK: - Linking spinner

private struct OrgLinkingView: View {
    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView().tint(Color(hex: T.accent))
                Text("Linking your organization…")
                    .font(.subheadline)
                    .foregroundColor(Color(hex: T.muted))
            }
        }
    }
}

// MARK: - Org picker (multi-match)

private struct OrgPickerView: View {
    let matches: [OrgMatch]
    let onPick: (OrgMatch) -> Void
    @Environment(AuthManager.self) private var auth

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                VStack(spacing: 8) {
                    Text("Choose your organization")
                        .font(.title2.bold())
                        .foregroundColor(Color(hex: T.text))
                    Text("Your email is linked to more than one TRAQS org.")
                        .font(.subheadline)
                        .foregroundColor(Color(hex: T.muted))
                        .multilineTextAlignment(.center)
                }

                VStack(spacing: 10) {
                    ForEach(matches, id: \.code) { m in
                        Button { onPick(m) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(m.name ?? m.code)
                                        .font(.headline)
                                        .foregroundColor(Color(hex: T.text))
                                    Text(m.code)
                                        .font(.caption)
                                        .foregroundColor(Color(hex: T.muted))
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            .padding()
                            .background(Color(hex: T.surface))
                            .cornerRadius(12)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)

                Spacer()
                Button("Sign Out") { auth.logout() }
                    .foregroundColor(Color(hex: T.muted))
                    .font(.caption)
                    .padding(.bottom, 24)
            }
        }
    }
}

// MARK: - Global error banner
// Watches every error field on AppState and pops a red banner from the
// top when any of them is set. Auto-dismisses after 5s and on tap.
// Before this existed, every async failure (clock-in/out, finish request,
// save) set an error field that nothing read — failures were invisible.

private struct ErrorBanner: View {
    @Environment(AppState.self) private var appState

    @State private var dismissTask: Task<Void, Never>?

    private var currentError: String? {
        if let e = appState.clockError, !e.isEmpty { return e }
        if let e = appState.errorMessage, !e.isEmpty { return e }
        if case let .error(msg) = appState.saveStatus, !msg.isEmpty { return msg }
        return nil
    }

    var body: some View {
        VStack {
            if let msg = currentError {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.white)
                    Text(msg)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Button(action: clearError) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(6)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.red.opacity(0.92))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 8, y: 2)
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { clearError() }
                .onAppear { scheduleAutoDismiss() }
                .onChange(of: msg) { _, _ in scheduleAutoDismiss() }
            }
            Spacer()
        }
        .animation(.easeOut(duration: 0.2), value: currentError)
    }

    private func scheduleAutoDismiss() {
        dismissTask?.cancel()
        dismissTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if !Task.isCancelled { clearError() }
        }
    }

    private func clearError() {
        dismissTask?.cancel()
        appState.clockError = nil
        appState.errorMessage = nil
        if case .error = appState.saveStatus { appState.saveStatus = .idle }
    }
}
