import Testing
@testable import TRAQS_Scheduling

// The web gate's decisions (src/App.jsx AuthGate) as pure rules. Two of these
// encode fixes the web's own comments call out, and those are the tests that
// matter — the rest is bookkeeping.
@Suite("Mac auth gate step resolution")
struct MacGateResolverTests {

    // MARK: Launch

    @Test func noStoredCodeStartsAtOrgEntry() {
        #expect(MacGateResolver.launchStep(storedOrgCode: "") == .org)
        #expect(MacGateResolver.launchStep(storedOrgCode: nil) == .org)
    }

    @Test func aStoredCodeGoesStraightToTheRoster() {
        #expect(MacGateResolver.launchStep(storedOrgCode: "MATRIX") == .team)
    }

    // App.jsx: "Only clear the org code if the org truly doesn't exist (404).
    // For transient errors (network, 500), keep the code so the user isn't
    // forced to re-enter it on every blip."
    @Test func onlyA404ClearsTheStoredOrgCode() {
        #expect(MacGateResolver.afterConfigFetch(status: 404).clearsStoredCode)
        #expect(MacGateResolver.afterConfigFetch(status: 500).clearsStoredCode == false)
        #expect(MacGateResolver.afterConfigFetch(status: nil).clearsStoredCode == false)
    }

    @Test func anyConfigFailureLandsOnOrgEntry() {
        #expect(MacGateResolver.afterConfigFetch(status: 404).step == .org)
        #expect(MacGateResolver.afterConfigFetch(status: 500).step == .org)
    }

    // MARK: Who signed in

    @Test func tappingOneFaceAndSigningInAsAnotherIsWrongUser() {
        #expect(MacGateResolver.personCheck(tapped: "bob@matrix.com",
                                            signedIn: "alice@matrix.com") == .wrongUser)
    }

    @Test func caseDiffersButThePersonDoesNot() {
        #expect(MacGateResolver.personCheck(tapped: "Bob@Matrix.com",
                                            signedIn: "bob@matrix.com") == nil)
    }

    @Test func noTappedPersonMeansNothingToContradict() {
        // Admin sign-in skips the roster, so there is no selection to check.
        #expect(MacGateResolver.personCheck(tapped: nil,
                                            signedIn: "alice@matrix.com") == nil)
    }

    // MARK: Domain

    @Test func aForeignDomainIsRejected() {
        #expect(MacGateResolver.domainCheck(email: "alice@gmail.com",
                                            orgDomain: "matrix.com") == .domainError)
    }

    @Test func theOrgsOwnDomainPasses() {
        #expect(MacGateResolver.domainCheck(email: "alice@MATRIX.com",
                                            orgDomain: "matrix.com") == nil)
    }

    @Test func noConfiguredDomainCannotReject() {
        // An org with no domain set must not lock everyone out.
        #expect(MacGateResolver.domainCheck(email: "alice@matrix.com",
                                            orgDomain: nil) == nil)
    }

    // MARK: Roster membership

    @Test func theServerSaying403Or404IsNotInTeam() {
        #expect(MacGateResolver.membership(status: 403, isAdminKnown: true, isAdmin: false,
                                           inRoster: false, rosterIsEmpty: false) == .notInTeam)
        #expect(MacGateResolver.membership(status: 404, isAdminKnown: true, isAdmin: false,
                                           inRoster: false, rosterIsEmpty: false) == .notInTeam)
    }

    // App.jsx: "`isAdmin` is set by /org-config; while it's undefined we treat
    // the user as potentially-admin so the UI doesn't flicker." Without this the
    // screen flashes "not in team" in the gap between login and that fetch.
    @Test func anUnknownAdminFlagCountsAsAdminSoTheScreenCannotFlicker() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: false, isAdmin: false,
                                           inRoster: false, rosterIsEmpty: false) == nil)
    }

    @Test func anAdminOutsideTheRosterIsStillLetIn() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: true,
                                           inRoster: false, rosterIsEmpty: false) == nil)
    }

    @Test func anEmptyRosterIsNotEvidenceOfExclusion() {
        // A roster that hasn't loaded yet must not read as "you're not on it".
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: false,
                                           inRoster: false, rosterIsEmpty: true) == nil)
    }

    @Test func aNonAdminMissingFromANonEmptyRosterIsRejected() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: false,
                                           inRoster: false, rosterIsEmpty: false) == .notInTeam)
    }

    @Test func aNonAdminOnTheRosterPasses() {
        #expect(MacGateResolver.membership(status: 200, isAdminKnown: true, isAdmin: false,
                                           inRoster: true, rosterIsEmpty: false) == nil)
    }
}
