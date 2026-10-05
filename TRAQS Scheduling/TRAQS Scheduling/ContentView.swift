import SwiftUI

struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var showSplash = true
    /// The intro (logo + liquid + Get Started) plays once per launch in front of
    /// Welcome. Signed-in launches never see it: auth is restored synchronously
    /// when AuthManager is created, so there's no signed-out first frame.
    @State private var introDone = false
    /// Plus / Pro Max and larger (≥430pt on the short side): the whole app reads
    /// a size up. Measured off the root's own size, so it is right in either
    /// orientation and on whichever screen the scene is on.
    @State private var largeScreen = false

    // Email-based org auto-link state. We try once per login session.
    // `attempted` gates the lookup so a re-render doesn't re-fire it.
    // `matches.count == 0` falls through to OrgCodeView. `> 1` shows the picker.
    @State private var attemptedAutoLink = false
    @State private var lookupInFlight = false
    @State private var lookupMatches: [OrgMatch] = []
    @State private var lookupError: String?
    /// Orgs this launch has already told the server "signed in" (see
    /// `announceSignIn`). Per org, so switching orgs announces the new one.
    @State private var announcedOrgs: Set<String> = []

    /// Whether the logged-out gate (Intro / Welcome / signup / code recovery)
    /// is what's on screen. ONE definition, read by the branch below, by the
    /// window style, and by the app root's colour scheme, so the three can't
    /// disagree about whether somebody is signed in.
    ///
    /// The gate always draws in TRAQS's default light look. The saved theme is
    /// device-wide, so before anybody has signed in it is only whatever the
    /// last person left behind, and it must not reach this screen. Left to the
    /// theme, a dark preset pinned the WINDOWS dark (ThemeStyleSync) and the app
    /// root dark (`.preferredColorScheme`), which beat the screens' own
    /// `.preferredColorScheme(.light)`: dark Liquid Glass buttons, a dark
    /// keyboard, dark system menus and a dark Auth0 sheet on the paper ground.
    static func showsSignIn(auth: AuthManager, appState: AppState) -> Bool {
        appState.orgCode.isEmpty || !auth.isAuthenticated
    }

    var body: some View {
        let signIn = Self.showsSignIn(auth: auth, appState: appState)
        ZStack(alignment: .top) {
            Group {
                // Org FIRST, sign-in second — the order the web's AuthGate uses.
                // It ran the other way round here, which meant a person could be
                // signed in before the app knew which organization they were
                // signing in to. WelcomeView covers both stages and carries its
                // own load-up.
                if signIn {
                    if introDone || auth.isAuthenticated {
                        WelcomeView(autoLinkError: lookupError, logoAlreadyShown: introDone)
                    } else {
                        // Swapped with no transition: both screens are the same
                        // paper with the logo in the same spot, so a cut IS the
                        // seamless version.
                        IntroView { withTransaction(.noAnimation) { introDone = true } }
                    }
                } else if lookupInFlight {
                    OrgLinkingView()
                } else if lookupMatches.count > 1 && appState.orgCode.isEmpty {
                    OrgPickerView(matches: lookupMatches) { pick in
                        applyOrg(code: pick.code)
                    }
                } else {
                    MainTabView()
                        .task { await appState.loadAll() }
                }
            }
            .animation(.easeInOut, value: auth.isAuthenticated)
            .onAppear { handleAuthState() }
            .onChange(of: auth.isAuthenticated) { _, _ in handleAuthState() }
            .onChange(of: auth.userEmail) { _, _ in handleAuthState() }
            // The invite email's Accept button, when TRAQS is installed. See InviteLink.
            .onOpenURL { url in openInvite(url) }

            ErrorBanner()
                .zIndex(2)
        }
        // Big phones get bigger type and the kit's elements with it: every face is
        // a custom font that scales with Dynamic Type, and the Revamp kit sizes its
        // tiles, discs, bars and dots with @ScaledMetric. A FLOOR, not a fixed
        // size — anyone who already reads larger keeps their own setting.
        .onGeometryChange(for: Bool.self) { min($0.size.width, $0.size.height) >= 430 } action: {
            largeScreen = $0
        }
        .dynamicTypeSize(largeScreen ? DynamicTypeSize.xxLarge ... .accessibility5
                                     : DynamicTypeSize.xSmall ... .accessibility5)
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
        // Installs the overlay UIWindow that renders the Messages header outside
        // the main UIHostingController (so the keyboard can't displace it). Zero
        // size, non-interactive; the window itself only appears while a thread is
        // open (driven by appState.activeMessageThread).
        .background(OverlayWindowInstaller(appState: appState, theme: themeSettings))
        // Pin the scene's windows to the theme's interface style so presented
        // sheets/covers inherit it instead of following the device's Dark Mode
        // (which made `.primary` text render white on our light sheet bg). Reads
        // `isLightTheme` so it re-applies live when the theme changes. Always
        // light at the sign-in gate — see `showsSignIn`.
        .background(ThemeStyleSync(isLight: signIn || themeSettings.isLightTheme))
    }

    private func handleAuthState() {
        guard auth.isAuthenticated, let token = auth.accessToken else { return }

        // Returning user with a known org → bring up the app immediately while
        // we still re-verify membership in the background. This keeps cold
        // launches fast and matches the web's sessionStorage behavior.
        if !appState.orgCode.isEmpty {
            appState.matchEmail = auth.userEmail
            appState.configure(auth: auth, orgCode: appState.orgCode)
            announceSignIn(orgCode: appState.orgCode, token: token)
        }
        redeemPendingInvite(token: token)

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
        guard let token = auth.accessToken else { return }
        appState.matchEmail = auth.userEmail
        appState.configure(auth: auth, orgCode: code)
        announceSignIn(orgCode: code, token: token)
        lookupMatches = []
    }

    // MARK: - Invites

    /// An invite link arrived. Signed out, the invite names the org, so it
    /// replaces any remembered code and Welcome goes straight to "Sign in";
    /// the token is redeemed once Auth0 returns (`redeemPendingInvite`).
    ///
    /// Already signed in to THAT org, it is redeemed now. Signed in to a
    /// different one, it is NOT acted on: the person holding this phone may not
    /// be the person invited, and silently switching them into another org would
    /// be worse than asking them to sign out.
    private func openInvite(_ url: URL) {
        guard let link = InviteLink.parse(url) else { return }
        if !auth.isAuthenticated {
            appState.pendingInvite = link
            appState.rememberOrg(code: link.orgCode)
            return
        }
        guard appState.orgCode.isEmpty || appState.orgCode.caseInsensitiveCompare(link.orgCode) == .orderedSame else {
            appState.errorMessage = "This invitation is for another organization. Sign out, then tap Accept in the email again."
            return
        }
        appState.pendingInvite = link
        if appState.orgCode.isEmpty { applyOrg(code: link.orgCode) }
        if let token = auth.accessToken { redeemPendingInvite(token: token) }
    }

    /// Spend the pending invite. Most failures are left quiet, as on the web:
    /// Add Employee already put the invitee on the roster, so signing in is what
    /// actually lets them in, and a stale link should not stand in their way.
    /// The two that ARE said out loud are the ones the person can do something
    /// about.
    private func redeemPendingInvite(token: String) {
        guard let link = appState.pendingInvite else { return }
        appState.pendingInvite = nil
        Task {
            do {
                try await APIService.acceptInvite(inviteToken: link.token, orgCode: link.orgCode, token: token)
            } catch let failure as APIService.ServerMessageError {
                if failure.message.contains("email-mismatch") {
                    appState.errorMessage = "This invitation was sent to a different email address. Sign out and sign in with that address."
                } else if failure.message.contains("expired") {
                    appState.errorMessage = "This invitation has expired. Ask your administrator to send a new one."
                }
            } catch {
                // Network: harmless. announceSignIn spends the invite next time.
            }
        }
    }

    /// Tell the server this person has signed in to `orgCode`, once per org per
    /// launch. `/org-config` is the web's once-per-login call; iOS never made
    /// it, and it is where an invite is marked accepted for somebody who got in
    /// without pressing Accept (settleInvitesOnLogin) — without it their card on
    /// the web would say Pending Invitation forever. Fire and forget.
    private func announceSignIn(orgCode: String, token: String) {
        guard !orgCode.isEmpty, !announcedOrgs.contains(orgCode) else { return }
        announcedOrgs.insert(orgCode)
        Task { _ = try? await APIService.orgConfig(token: token, orgCode: orgCode) }
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
                            .cornerRadius(T.cornerSm)
                            .overlay(RoundedRectangle(cornerRadius: T.cornerSm).stroke(Color(hex: T.border), lineWidth: 1))
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
                        .foregroundStyle(Color.red.readableText)
                    Text(msg)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.red.readableText)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Button(action: clearError) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.red.readableText)
                            .padding(6)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.red.opacity(0.92))
                .clipShape(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous))
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
