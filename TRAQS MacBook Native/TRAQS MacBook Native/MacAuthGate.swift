import SwiftUI

// MARK: - The auth gate
//
// `AuthGate` (App.jsx:1382). Owns the step, the org config, the roster cache and
// the tapped person, and runs `MacGateResolver`'s rules at the moments the web
// runs them.
//
// The DECISIONS are not here — they are in the shared `MacGateResolver`, which is
// pure and tested. This is the part that fetches, stores and renders. Keeping the
// two apart is the whole reason the rules can be tested at all: the web's version
// mixes them into four `useEffect`s.
struct MacAuthGate: View {
    /// Called once the gate is satisfied. The shell takes over from here.
    let onResolved: () -> Void

    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState

    @State private var step: GateStep = .org
    @State private var orgName: String?
    @State private var orgDomain: String?
    @State private var connection: String?
    /// Set by the server's authenticated `/org-config`. `nil` means NOT ANSWERED
    /// YET, which decides differently from `false` — see `MacGateResolver`.
    @State private var serverIsAdmin: Bool?
    @State private var rosterEmails: [String] = []
    /// The face that was tapped on the roster. In memory only, matching the web's
    /// `sessionStorage`: a relaunch should not inherit a stale selection.
    @State private var tappedPerson: Person?
    @State private var booted = false

    private enum Key {
        static let orgName = "traqs.gate.orgName"
        static let orgDomain = "traqs.gate.orgDomain"
        static let connection = "traqs.gate.connection"
    }

    var body: some View {
        content
            // PINNED LIGHT, and this is a correctness fix rather than a
            // preference. The gate's palette is hardcoded and unconditionally
            // light — paper, ink, stone — because it paints before a theme
            // exists (App.jsx:24). But SEMANTIC colours (`.primary`,
            // `.secondary`, and anything else that adapts) follow the SYSTEM
            // appearance, so on a Mac in Dark Mode the gate drew a light card
            // with white text on it. The toggle's selected label was the visible
            // symptom; every semantic colour in the gate had the same fault.
            //
            // Pinning the scheme makes the adaptive colours agree with the fixed
            // ones. `NativeShell` already does this for the app proper, from the
            // theme; the gate has no theme, so it states the answer directly.
            .preferredColorScheme(.light)
            .task { if !booted { booted = true; await boot() } }
            // Auth0 can return at any point; re-run the post-login checks whenever
            // it does.
            .onChange(of: auth.isAuthenticated) { _, _ in Task { await afterLogin() } }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .org, .createOrg, .forgotOrg:
            // create-org and forgot-org are routable but unreachable, exactly as
            // on the web — its org step offers no create button and no forgot
            // link, only the text "New organizations coming soon". They fall
            // through to org entry rather than to a blank screen.
            GateOrgCodeStep(onResolved: adopt)

        case .team:
            GateTeamStep(orgCode: appState.orgCode,
                         orgName: orgName,
                         onPersonTapped: signIn(as:),
                         onAdminLogin: adminSignIn,
                         onSwitch: switchOrg)

        case .login:
            GateLoginStep(orgCode: appState.orgCode,
                          orgName: orgName,
                          orgDomain: orgDomain,
                          connection: connection,
                          loginHint: tappedPerson?.email,
                          onSwitch: switchOrg)

        case .domainError:
            GateDomainError(userEmail: auth.userEmail, orgDomain: orgDomain, onLogout: signOut)

        case .notInTeam:
            GateNotInTeamError(userEmail: auth.userEmail, onLogout: signOut)

        case .wrongUser:
            GateWrongUserError(loggedInEmail: auth.userEmail,
                               selectedName: tappedPerson?.name,
                               selectedEmail: tappedPerson?.email,
                               onLogout: signOut)

        case .resolved:
            GateSpinner(label: "Loading TRAQS…")
        }
    }

    // MARK: Launch

    /// The web's mount effect (App.jsx:1401): with a stored code, re-fetch the
    /// config so it stays fresh, and only forget the code on a 404.
    private func boot() async {
        restoreCachedConfig()
        let stored = appState.orgCode
        step = MacGateResolver.launchStep(storedOrgCode: stored)
        guard !stored.isEmpty else { return }
        do {
            let info = try await APIService.lookupOrg(code: stored)
            cache(info)
            if auth.isAuthenticated { await afterLogin() }
        } catch {
            let outcome = MacGateResolver.afterConfigFetch(status: Self.status(of: error))
            if outcome.clearsStoredCode { forgetOrg() }
            step = outcome.step
        }
    }

    // MARK: After Auth0 returns

    /// The web's three post-login effects, in its order: who signed in, then the
    /// domain, then what the SERVER says about membership.
    private func afterLogin() async {
        guard auth.isAuthenticated else { return }

        if let bounce = MacGateResolver.personCheck(tapped: tappedPerson?.email,
                                                   signedIn: auth.userEmail) {
            step = bounce
            return
        }
        if let bounce = MacGateResolver.domainCheck(email: auth.userEmail,
                                                   orgDomain: orgDomain) {
            step = bounce
            return
        }

        // The authenticated config. Its STATUS is the membership verdict.
        var status: Int? = 200
        if let token = auth.accessToken {
            do {
                let cfg = try await APIService.orgConfig(token: token, orgCode: appState.orgCode)
                serverIsAdmin = cfg.isAdmin
                if let n = cfg.name { orgName = n }
                if let d = cfg.domain { orgDomain = d }
                if let c = cfg.connection { connection = c }
            } catch {
                status = Self.status(of: error)
                // A network hiccup is NOT a rejection. The web: "Network or Auth0
                // hiccup — leave the user where they are; downstream API calls
                // will surface a clearer error if it's persistent."
                if status != 403 && status != 404 { status = 200 }
            }
        }

        let email = auth.userEmail?.lowercased()
        let inRoster = rosterEmails.contains { $0 == email }
        if let bounce = MacGateResolver.membership(status: status,
                                                  isAdminKnown: serverIsAdmin != nil,
                                                  isAdmin: serverIsAdmin == true,
                                                  inRoster: inRoster,
                                                  rosterIsEmpty: rosterEmails.isEmpty) {
            step = bounce
            return
        }

        await handOff()
    }

    /// Configure the app's state and let the shell take over.
    private func handOff() async {
        step = .resolved
        appState.matchEmail = auth.userEmail
        appState.configure(auth: auth, orgCode: appState.orgCode)
        await appState.loadAll()
        onResolved()
    }

    // MARK: Actions

    private func adopt(_ code: String, _ info: OrgInfo) {
        appState.orgCode = code
        cache(info)
        step = .team
        Task { await loadRosterEmails(code) }
    }

    private func signIn(as person: Person) {
        tappedPerson = person
        Task { await auth.login(loginHint: person.email, connection: connection) }
    }

    /// Admin sign-in skips the roster, so there is no tapped person — which is
    /// also why `personCheck` has nothing to contradict afterwards.
    private func adminSignIn() {
        tappedPerson = nil
        Task { await auth.login(connection: connection) }
    }

    private func switchOrg() {
        forgetOrg()
        tappedPerson = nil
        step = .org
    }

    private func signOut() {
        tappedPerson = nil
        auth.logout()
        step = MacGateResolver.launchStep(storedOrgCode: appState.orgCode)
    }

    // MARK: Storage
    //
    // Org code lives in the Keychain already (AppState.orgCode). The config and
    // the roster are a CACHE, so UserDefaults is right for them — losing either
    // costs one fetch.

    private func cache(_ info: OrgInfo) {
        orgName = info.name
        orgDomain = info.domain
        connection = info.connection
        let d = UserDefaults.standard
        d.set(info.name, forKey: Key.orgName)
        d.set(info.domain, forKey: Key.orgDomain)
        d.set(info.connection, forKey: Key.connection)
    }

    private func restoreCachedConfig() {
        let d = UserDefaults.standard
        orgName = d.string(forKey: Key.orgName)
        orgDomain = d.string(forKey: Key.orgDomain)
        connection = d.string(forKey: Key.connection)
    }

    private func forgetOrg() {
        appState.orgCode = ""
        orgName = nil; orgDomain = nil; connection = nil
        serverIsAdmin = nil
        rosterEmails = []
        let d = UserDefaults.standard
        for k in [Key.orgName, Key.orgDomain, Key.connection] { d.removeObject(forKey: k) }
    }

    /// Emails only — this is for the membership check, not for display. The
    /// roster screen fetches its own people.
    private func loadRosterEmails(_ code: String) async {
        if let people = try? await APIService.fetchRoster(orgCode: code) {
            rosterEmails = people.map { $0.email.lowercased() }
        }
    }

    private static func status(of error: Error) -> Int? {
        if case APIError.httpError(let code) = error { return code }
        return nil
    }
}
