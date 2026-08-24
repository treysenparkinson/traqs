import Testing
@testable import TRAQS_Scheduling

/// Rules for resolving a completion (finish) request.
///
/// These cover the two defects behind "I approved it but the buttons stayed,
/// and later it came back and could be approved again":
///   1. a decision must be REFUSED unless the entry exists and is still pending;
///   2. a card must be able to tell "not loaded yet" apart from "pending", so it
///      never offers Approve/Deny for a request whose status it doesn't know.
struct CompletionRequestRulesTests {

    private func entry(_ id: String, _ status: String) -> FinishRequestEntry {
        FinishRequestEntry(id: id, by: "u1", byName: "Caleb", at: "2026-08-24T10:00:00Z", status: status)
    }

    // MARK: applyDecision

    @Test func approvingAPendingRequestResolvesIt() {
        let out = CompletionRequestRules.applyDecision(
            to: [entry("r1", "pending")], requestId: "r1", newStatus: "approved",
            allowedFrom: ["pending"], resolvedBy: "admin", resolvedByName: "Trey", resolvedAt: "T")
        #expect(out?.count == 1)
        #expect(out?.first?.status == "approved")
        #expect(out?.first?.resolvedByName == "Trey")
        #expect(out?.first?.resolvedAt == "T")
    }

    @Test func approvingTwiceIsRefused() {
        let out = CompletionRequestRules.applyDecision(
            to: [entry("r1", "approved")], requestId: "r1", newStatus: "approved",
            allowedFrom: ["pending"], resolvedBy: "admin", resolvedByName: "Trey", resolvedAt: "T")
        #expect(out == nil)   // already resolved — must not re-resolve or re-notify
    }

    @Test func denyingAnAlreadyApprovedRequestIsRefused() {
        let out = CompletionRequestRules.applyDecision(
            to: [entry("r1", "approved")], requestId: "r1", newStatus: "declined",
            allowedFrom: ["pending"], resolvedBy: "admin", resolvedByName: "Trey", resolvedAt: "T")
        #expect(out == nil)
    }

    @Test func decidingAnUnknownRequestIsRefused() {
        #expect(CompletionRequestRules.applyDecision(
            to: [entry("other", "pending")], requestId: "r1", newStatus: "approved",
            allowedFrom: ["pending"], resolvedBy: "a", resolvedByName: "T", resolvedAt: "T") == nil)
        #expect(CompletionRequestRules.applyDecision(
            to: nil, requestId: "r1", newStatus: "approved",
            allowedFrom: ["pending"], resolvedBy: "a", resolvedByName: "T", resolvedAt: "T") == nil)
    }

    @Test func otherRequestsAreLeftUntouched() {
        let out = CompletionRequestRules.applyDecision(
            to: [entry("r1", "pending"), entry("r2", "pending")], requestId: "r1",
            newStatus: "approved", allowedFrom: ["pending"],
            resolvedBy: "a", resolvedByName: "T", resolvedAt: "T")
        #expect(out?.first(where: { $0.id == "r2" })?.status == "pending")
    }

    @Test func undoOnlyAppliesToAnApprovedRequestAndClearsTheResolver() {
        let approved = FinishRequestEntry(id: "r1", by: "u1", byName: "Caleb",
                                          at: "A", status: "approved",
                                          resolvedBy: "admin", resolvedByName: "Trey", resolvedAt: "T")
        let out = CompletionRequestRules.applyDecision(
            to: [approved], requestId: "r1", newStatus: "pending",
            allowedFrom: ["approved"], resolvedBy: nil, resolvedByName: nil, resolvedAt: nil)
        #expect(out?.first?.status == "pending")
        #expect(out?.first?.resolvedBy == nil)
        #expect(out?.first?.resolvedByName == nil)
        #expect(out?.first?.resolvedAt == nil)

        // Undoing something that was never approved is refused.
        #expect(CompletionRequestRules.applyDecision(
            to: [entry("r1", "pending")], requestId: "r1", newStatus: "pending",
            allowedFrom: ["approved"], resolvedBy: nil, resolvedByName: nil, resolvedAt: nil) == nil)
    }

    // MARK: displayStatus — "not loaded" must NOT read as "pending"

    @Test func displayStatusIsNilWhenTheRequestIsNotLoaded() {
        #expect(CompletionRequestRules.displayStatus(entries: nil, requestId: "r1") == nil)
        #expect(CompletionRequestRules.displayStatus(entries: [], requestId: "r1") == nil)
        #expect(CompletionRequestRules.displayStatus(entries: [entry("other", "pending")], requestId: "r1") == nil)
        #expect(CompletionRequestRules.displayStatus(entries: [entry("r1", "pending")], requestId: nil) == nil)
    }

    @Test func displayStatusReportsTheRealStatusWhenKnown() {
        #expect(CompletionRequestRules.displayStatus(entries: [entry("r1", "approved")], requestId: "r1") == "approved")
        #expect(CompletionRequestRules.displayStatus(entries: [entry("r1", "pending")], requestId: "r1") == "pending")
    }

    @Test func actionsAreOfferedOnlyForAKnownPendingRequest() {
        #expect(CompletionRequestRules.isActionable(nil) == false)        // unknown
        #expect(CompletionRequestRules.isActionable("pending") == true)
        #expect(CompletionRequestRules.isActionable("approved") == false)
        #expect(CompletionRequestRules.isActionable("declined") == false)
    }
}
