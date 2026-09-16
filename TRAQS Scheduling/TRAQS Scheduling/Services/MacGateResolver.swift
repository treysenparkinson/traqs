import Foundation

// MARK: - The auth gate's steps
//
// One case per step in the web gate's own list (src/App.jsx:1385):
//   "org" | "create-org" | "forgot-org" | "team" | "domain-error" | "not-in-team"
// plus "login" and "wrong-user", which it sets elsewhere, and `resolved` for
// "the gate is done, show the app".
enum GateStep: Equatable {
    case org, createOrg, forgotOrg, team, login
    case domainError, notInTeam, wrongUser
    case resolved
}

// MARK: - Gate step resolution
//
// The web gate makes its decisions in four `useEffect`s. Those effects mix the
// decision with the fetching, the storage writes and the React state, which is
// why the rules are worth pulling out: each one here is a pure function of its
// inputs, so the reasons a person gets bounced are testable without a network or
// a view. See MacGateResolverTests.
//
// Caseless enum of statics with every dependency passed in — the convention this
// codebase uses for logic that needs testing (HoursCalculator, StatsMath,
// SchedulePacker). Lives in shared Services/ for the same reason: that is what
// the iOS test target compiles.
enum MacGateResolver {

    /// What to show on launch, from whatever org-code storage already holds.
    static func launchStep(storedOrgCode: String?) -> GateStep {
        guard let code = storedOrgCode, !code.isEmpty else { return .org }
        return .team
    }

    /// The outcome of fetching an org's config for a stored code.
    struct ConfigFetchOutcome: Equatable {
        let step: GateStep
        /// Whether the stored org code should be forgotten.
        let clearsStoredCode: Bool
    }

    /// Every config-fetch failure lands on org entry, but only a 404 FORGETS the
    /// code. The web's reason, copied: "Only clear the org code if the org truly
    /// doesn't exist (404). For transient errors (network, 500), keep the code so
    /// the user isn't forced to re-enter it on every blip."
    ///
    /// `status: nil` is a transport failure with no HTTP status at all — the most
    /// transient case there is, so it must not clear either.
    static func afterConfigFetch(status: Int?) -> ConfigFetchOutcome {
        ConfigFetchOutcome(step: .org, clearsStoredCode: status == 404)
    }

    /// You tapped a face on the roster, then signed in as somebody else. Returns
    /// nil when there is nothing to contradict — admin sign-in skips the roster,
    /// so there is no selection to compare against.
    ///
    /// Case-insensitive: Auth0 may hand back a differently-cased address than the
    /// roster stores, and that is not a different person.
    static func personCheck(tapped: String?, signedIn: String?) -> GateStep? {
        guard let tapped, !tapped.isEmpty else { return nil }
        guard let signedIn, !signedIn.isEmpty else { return nil }
        return tapped.lowercased() == signedIn.lowercased() ? nil : .wrongUser
    }

    /// The signed-in email's domain against the org's configured one.
    ///
    /// An org with NO configured domain cannot reject anybody — otherwise a blank
    /// setting would lock out the entire organization.
    static func domainCheck(email: String?, orgDomain: String?) -> GateStep? {
        guard let orgDomain, !orgDomain.isEmpty else { return nil }
        guard let domain = email?.split(separator: "@").last?.lowercased() else { return nil }
        return domain == orgDomain.lowercased() ? nil : .domainError
    }

    /// Roster membership. The SERVER decides: `/org-config` requires org
    /// membership, so a 403 or 404 there is the answer, and the client never
    /// compares emails to reach it.
    ///
    /// Two guards on the local fallback, both load-bearing:
    ///
    ///  • `isAdminKnown == false` counts as ADMIN. `isAdmin` arrives with the
    ///    /org-config response, and in the gap between login and that response
    ///    treating it as false flashes "not in team" at every admin. The web
    ///    comment: "while it's undefined we treat the user as potentially-admin
    ///    so the UI doesn't flicker."
    ///  • An EMPTY roster proves nothing. A roster that has not loaded yet must
    ///    not read as one you are absent from.
    static func membership(status: Int?, isAdminKnown: Bool, isAdmin: Bool,
                           inRoster: Bool, rosterIsEmpty: Bool) -> GateStep? {
        if status == 403 || status == 404 { return .notInTeam }
        let treatAsAdmin = !isAdminKnown || isAdmin
        if !inRoster && !treatAsAdmin && !rosterIsEmpty { return .notInTeam }
        return nil
    }
}
