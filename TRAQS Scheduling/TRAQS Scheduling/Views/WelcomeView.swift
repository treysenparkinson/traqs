import SwiftUI

// MARK: - Welcome · the logged-out load-up
//
// The pre-auth screen, matching the web's AuthGate (src/App.jsx) so the two
// platforms open the same way. It replaces LoginView + OrgCodeView, which asked
// in the OPPOSITE order — Auth0 first, org code after — and so could sign a
// person in before knowing which organization they were signing in to.
//
// One screen, two stages: enter the org code, then confirm the org and sign in.
// The org lookup (`GET /org?code=`) is deliberately unauthenticated — the
// endpoint returns only name/domain/connection for exactly this purpose.
//
// The load-up is the web's: the lockup fades in dead centre of the screen, rises
// to its resting place, then the copy, card and footer arrive in sequence. The
// aurora SplashView is NOT used here — that one plays for an authenticated
// launch, and this is what an unauthenticated one gets.
struct WelcomeView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState

    /// Human-readable explanation when the email→org auto-link couldn't resolve
    /// an org. Shown above the code field.
    var autoLinkError: String? = nil

    // MARK: Palette
    //
    // The web's paper palette, verbatim (PAPER / CARD_BG / INK / STONE in
    // App.jsx). Deliberately not the theme's tokens: no theme has been resolved
    // at this point — there is no signed-in person to have chosen one — and the
    // warmth is what separates this from a generic auth screen.
    private let paper = Color(hex: "#EDEAE3")
    private let cardBG = Color(hex: "#FBFAF7")
    private let ink = Color(hex: "#0B0B0C")
    private let stone = Color(hex: "#8A867E")
    private let hairline = Color(hex: "#101828").opacity(0.08)
    /// The button blue. Fixed, not the customization accent — see `signInButton`.
    private let brandBlue = Color(hex: "#4169E1")

    // MARK: Timings
    //
    // Three acts. The mark fades up LARGE at the centre of the screen, holds
    // there long enough to be looked at, then travels to its resting size and
    // place. Only once it has landed does anything else arrive, and then all at
    // once — Welcome, the instruction, the card — 0.15s apart, so they read as
    // one gesture rather than four separate events.
    private let logoFadeDur = 0.85
    /// The beat where the mark just sits there, big and still.
    private let logoHold = 0.50
    /// Long enough for the ease to read. A heavy slow-fast-slow curve needs the
    /// duration to show it off — at 0.75s the middle was over before you saw it
    /// accelerate, which is what made the move feel snapped rather than carried.
    private let logoMoveDur = 0.95
    /// The travel curve: slow out of the centre, quick through the middle, slow
    /// into its resting place. `cubic-bezier(.76, 0, .24, 1)` — an easeInOutQuart.
    ///
    /// NOT the `(.22, 1, .36, 1)` used for the copy: that is an ease-OUT, which
    /// leaves at full speed and coasts to a stop. Right for something appearing,
    /// wrong for something travelling — a journey wants weight at both ends.
    private let logoTravel = Animation.timingCurve(0.76, 0, 0.24, 1, duration: 0.95)
    /// Everything below arrives after the mark lands (fade + hold + move).
    private var landsAt: Double { logoFadeDur + logoHold + logoMoveDur }
    private var welcomeAt: Double { landsAt + 0.05 }
    private var hintAt: Double { landsAt + 0.20 }
    private var cardAt: Double { landsAt + 0.35 }
    /// Last, and gently — this one is a whisper, not an entrance.
    private var footAt: Double { landsAt + 0.75 }

    /// How much bigger the mark is at the centre than at rest.
    private let logoBigScale: CGFloat = 1.75

    // MARK: State
    private enum Stage: Equatable { case code, signIn }
    @State private var stage: Stage = .code
    @State private var org: OrgInfo?

    @State private var code = ""
    @State private var isChecking = false
    @State private var error: String?
    @FocusState private var codeFocused: Bool

    /// Measured distance from the lockup's resting position to the screen's
    /// centre. Measured, not guessed: a fixed offset lands wherever this step's
    /// content height happens to put it, which is what made the web's earlier
    /// attempts drift past centre.
    @State private var rise: CGFloat = 0
    /// Two separate beats, deliberately: the mark FADES first (still big, still
    /// centred) and only later TRAVELS. One flag driving both would tie the
    /// journey to the fade and lose the hold between them.
    @State private var logoVisible = false
    @State private var landed = false
    @State private var showWelcome = false
    @State private var showHint = false
    @State private var showCard = false
    @State private var showFoot = false

    var body: some View {
        ZStack {
            paper.ignoresSafeArea()

            GeometryReader { screen in
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    lockup(screen: screen)
                    copy
                    card
                    footer
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 28)
            }
        }
        .preferredColorScheme(.light)
        .onAppear(perform: start)
        // A code already remembered (a returning user who signed out) skips
        // straight to the sign-in stage, so they aren't asked to retype it.
        .task { await adoptRememberedOrg() }
        #if os(macOS)
        .frame(minWidth: 400, minHeight: 400)
        #endif
    }

    // MARK: - Brand

    private func lockup(screen: GeometryProxy) -> some View {
        TRAQSHeaderLogo(size: 62)
            .background {
                // Reports where the lockup RESTS, so the rise can be computed
                // against the screen's true centre.
                GeometryReader { g in
                    Color.clear.onAppear {
                        let mid = g.frame(in: .global).midY
                        rise = screen.frame(in: .global).midY - mid
                    }
                }
            }
            // Scale and offset move together on the same curve, so the mark
            // shrinks INTO its resting place rather than arriving and then
            // settling.
            .scaleEffect(landed ? 1 : logoBigScale)
            .offset(y: landed ? 0 : rise)
            .opacity(logoVisible ? 1 : 0)
            .padding(.bottom, 22)
    }

    /// Greeting then instruction, each on its own beat. Both fade IN PLACE —
    /// no upward travel. The mark's journey is the only movement in the
    /// sequence, and copy sliding up under it competed with it.
    private var copy: some View {
        VStack(spacing: 5) {
            Text(stage == .code ? "Welcome" : "You're in")
                .font(TTypo.h3(20))
                .tracking(-0.4)
                .foregroundStyle(ink)
                .opacity(showWelcome ? 1 : 0)
            Text(stage == .code
                 ? "Enter your organization code to get started."
                 : "Sign in to access your schedule.")
                .font(TTypo.sm(13.5))
                .foregroundStyle(stone)
                .multilineTextAlignment(.center)
                .opacity(showHint ? 1 : 0)
        }
        .padding(.bottom, 28)
        .animation(.easeInOut(duration: 0.22), value: stage)
    }

    // MARK: - Card

    private var card: some View {
        VStack(spacing: 0) {
            switch stage {
            case .code:   codeStage
            case .signIn: signInStage
            }
        }
        .frame(maxWidth: 420)
        // Roomier than the web's 22, because the corner arc is now deep enough
        // to crowd the label and the pill's own ends.
        .padding(.horizontal, 26)
        .padding(.vertical, 26)
        // T.cornerHero (42), not the web's 20 — the app's own radius for a large
        // frosted surface, so this card sits on the same ramp as every hero card
        // inside the app rather than being a one-off.
        .background(RoundedRectangle(cornerRadius: T.cornerHero, style: .continuous).fill(cardBG))
        .overlay(RoundedRectangle(cornerRadius: T.cornerHero, style: .continuous)
            .strokeBorder(hairline, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.07), radius: 30, x: 0, y: 18)
        .opacity(showCard ? 1 : 0)
    }

    private var codeStage: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let message = autoLinkError ?? error {
                Text(message)
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

            Text("ORGANIZATION CODE")
                .font(TTypo.xsBold(10))
                .tracking(1)
                .foregroundStyle(stone)
                .padding(.bottom, 8)

            TextField("Enter your organization code", text: $code)
                .textFieldStyle(.plain)
                .font(.custom(TFontName.bold.rawValue, size: 17))
                .foregroundStyle(ink)
                .focused($codeFocused)
                .autocorrectionDisabled()
                .onChange(of: code) { code = code.uppercased() }
                #if os(iOS)
                .textInputAutocapitalization(.characters)
                #endif
                .onSubmit { Task { await submitCode() } }
                .padding(.horizontal, 20).padding(.vertical, 14)
                .background(Capsule(style: .continuous).fill(Color.white))
                .overlay(Capsule(style: .continuous)
                    .strokeBorder(codeFocused ? brandBlue : hairline, lineWidth: 1))
                .animation(.easeInOut(duration: 0.15), value: codeFocused)

            continueButton.padding(.top, 18)

            Text("New organizations coming soon")
                .font(TTypo.xs(12.5))
                .foregroundStyle(Color(hex: "#B4B0A7"))
                .frame(maxWidth: .infinity)
                .padding(.top, 18)
        }
    }

    private var signInStage: some View {
        VStack(spacing: 0) {
            // The org, confirmed. Green dot + name, as the web's LoginStep does —
            // this is the whole reason the code step comes first: you see WHICH
            // organization you are about to sign in to before you do it.
            HStack(spacing: 8) {
                Circle()
                    .fill(Color(hex: "#10B981"))
                    .frame(width: 8, height: 8)
                    .shadow(color: Color(hex: "#10B981").opacity(0.5), radius: 4)
                Text(org?.name ?? appState.orgCode)
                    .font(TTypo.smBold(13))
                    .foregroundStyle(brandBlue)
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
            .background(Capsule().fill(brandBlue.opacity(0.12)))
            .overlay(Capsule().strokeBorder(brandBlue.opacity(0.22), lineWidth: 1))

            if let domain = org?.domain, !domain.isEmpty {
                Text("@\(domain) accounts only")
                    .font(TTypo.sm(13))
                    .foregroundStyle(stone)
                    .padding(.top, 10)
            }

            signInButton.padding(.top, 22)

            if let error = auth.error {
                Text(error)
                    .font(TTypo.xs(12))
                    .foregroundStyle(Color(hex: "#B42318"))
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)
            }

            Button("Switch organization") {
                withAnimation(.easeInOut(duration: 0.22)) {
                    appState.forgetOrg()
                    org = nil
                    code = ""
                    stage = .code
                }
            }
            .font(TTypo.smBold(13))
            .foregroundStyle(stone)
            .buttonStyle(.plain)
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Buttons

    /// Liquid Glass, like Sign in — the two buttons in this flow are the same
    /// control at two steps, so they take the same material and the same tint.
    private var continueButton: some View {
        Button { Task { await submitCode() } } label: {
            let enabled = !code.trimmingCharacters(in: .whitespaces).isEmpty && !isChecking
            let label = Group {
                if isChecking {
                    ProgressView().tint(glassCTALabel(brandBlue))
                } else {
                    Text("Continue").font(TTypo.smBold(15))
                }
            }
            .foregroundStyle(enabled ? glassCTALabel(brandBlue) : Color.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)

            // BOTH faces are always rendered, cross-faded by opacity. An
            // if/else swaps one view for another, which SwiftUI cannot tween —
            // the colour arrived and left in a single frame however long the
            // animation said. Two layers can actually fade past each other, so
            // the button warms up as the code is typed and cools as it's
            // backspaced away.
            label
                .background {
                    ZStack {
                        // Muted grey rather than tinted glass: disabled glass
                        // still reads as a live button.
                        Capsule(style: .continuous)
                            .fill(stone.opacity(0.45))
                            .opacity(enabled ? 0 : 1)
                        Color.clear
                            .glassCTA(in: Capsule(style: .continuous), tint: brandBlue)
                            .opacity(enabled ? 1 : 0)
                    }
                }
                .animation(.easeInOut(duration: 0.32), value: enabled)
        }
        .buttonStyle(.plain)
        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isChecking)
    }

    /// Liquid Glass, tinted a FIXED blue.
    ///
    /// Not `T.accent`: the accent is a per-person customization setting, and
    /// nobody has signed in yet to have one — before login `T.accent` is just
    /// whatever the last session left behind. Blue is the brand's default and
    /// the colour this button is on the web (#4169E1, the BTN gradient's start).
    private var signInButton: some View {
        Group {
            if auth.isLoading {
                ProgressView()
                    .tint(brandBlue)
                    .scaleEffect(1.2)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            } else {
                Button { Task { await auth.login() } } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "lock.shield.fill")
                            .font(.system(size: 16, weight: .semibold))
                        Text("Sign in with Auth0")
                            .font(TTypo.smBold(15))
                    }
                    .foregroundStyle(glassCTALabel(brandBlue))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .glassCTA(in: Capsule(), tint: brandBlue)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var footer: some View {
        Text("Secured by Auth0 · TRAQS")
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .tracking(0.8)
            .foregroundStyle(Color(hex: "#B4B0A7"))
            .padding(.top, 16)
            .opacity(showFoot ? 1 : 0)
    }

    // MARK: - Sequence

    /// Fade the mark in large at the centre · hold · travel to rest · then the
    /// rest of the screen in quick succession.
    private func start() {
        guard !logoVisible else { return }
        withAnimation(.easeOut(duration: logoFadeDur)) { logoVisible = true }
        // The journey starts only after the hold, so the mark is genuinely still
        // for that beat rather than easing the whole way.
        schedule(logoFadeDur + logoHold) {
            withAnimation(logoTravel) { landed = true }
        }
        schedule(welcomeAt) { withAnimation(.easeOut(duration: 0.34)) { showWelcome = true } }
        schedule(hintAt)    { withAnimation(.easeOut(duration: 0.34)) { showHint = true } }
        schedule(cardAt)    { withAnimation(.easeOut(duration: 0.38)) { showCard = true } }
        // Slower and softer than the rest, so it settles in rather than appears.
        schedule(footAt)    { withAnimation(.easeInOut(duration: 0.9)) { showFoot = true } }
    }

    private func schedule(_ delay: Double, _ work: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // MARK: - Org resolution

    /// A remembered code means the org step is already done — resolve its name
    /// so the confirmation reads properly, and go straight to signing in.
    private func adoptRememberedOrg() async {
        let remembered = appState.orgCode
        guard !remembered.isEmpty, stage == .code else { return }
        org = try? await APIService.lookupOrg(code: remembered)
        stage = .signIn
    }

    private func submitCode() async {
        let upper = code.trimmingCharacters(in: .whitespaces).uppercased()
        guard !upper.isEmpty else { return }
        isChecking = true
        error = nil
        defer { isChecking = false }

        do {
            let info = try await APIService.lookupOrg(code: upper)
            // Remembered, NOT configured: configure needs a token, and there
            // isn't one until Auth0 returns. RootView picks the code up then.
            appState.rememberOrg(code: upper)
            withAnimation(.easeInOut(duration: 0.28)) {
                org = info
                stage = .signIn
            }
        } catch APIError.httpError(404) {
            // `self.` throughout: an un-annotated `catch` binds its own `error`,
            // which shadows the state property this is meant to set.
            self.error = "Organization not found. Check your code with your administrator."
        } catch {
            self.error = "Couldn't reach TRAQS. Check your connection and try again."
        }
    }
}
