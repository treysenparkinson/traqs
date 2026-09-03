import Testing
import Foundation
@testable import TRAQS_Scheduling

/// RAISING a completion request, and the read that follows it.
///
/// Covers "a completion request comes in and there is no Approve or Deny on it —
/// but once it's been approved on the web I can Undo it from the phone".
///
/// The write and the read disagreed about which item owns a request. iOS posted a
/// task-level request with the panel/op ids on the chat message, then appended the
/// entry to `job.finishRequests`. `target` resolved the message's ids to the
/// panel, found no row, no stamp and no `pendingFinish` there, and `status`
/// answered `nil` — genuinely unknown, and unknown is never actionable, so the
/// card rendered no buttons.
///
/// Undo worked afterwards because the WEB's approval upserts the resolved row
/// onto the correct item, so by then the panel really did carry an "approved"
/// row. That asymmetry — no Approve/Deny, but a working Undo — is the signature
/// of this bug, and `raisingOnAPanelIsImmediatelyActionable` is what would have
/// caught it.
@MainActor
struct CompletionRequestRaiseTests {

    private func entry(_ id: String) -> FinishRequestEntry {
        FinishRequestEntry(id: id, by: "7", byName: "Quincy",
                           at: "2026-09-03T09:00:00Z", status: "pending")
    }

    /// A job → panel → op tree carrying no requests at all.
    private func cleanJob() throws -> Job {
        try JSONDecoder().decode(Job.self, from: Data("""
        {"id":"j1","title":"Panel Run","status":"In Progress",
         "subs":[{"id":"p1","title":"Panel A","status":"In Progress",
                  "subs":[{"id":"o1","title":"Weld","status":"In Progress"}]}]}
        """.utf8))
    }

    // MARK: - The defect

    /// The regression test. A request raised against a PANEL must read back as
    /// pending through the very ids the chat message carries.
    @Test func raisingOnAPanelIsImmediatelyActionable() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: "p1", opId: nil, entry: entry("req_1")))

        let status = CompletionRequestRules.status(job: job, panelId: "p1", opId: nil,
                                                   requestId: "req_1")
        #expect(status == "pending")
        #expect(CompletionRequestRules.isActionable(status))
    }

    @Test func raisingOnASubOpIsImmediatelyActionable() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: "p1", opId: "o1", entry: entry("req_1")))

        let status = CompletionRequestRules.status(job: job, panelId: "p1", opId: "o1",
                                                   requestId: "req_1")
        #expect(status == "pending")
        #expect(CompletionRequestRules.isActionable(status))
    }

    /// The write lands on the requested item and NOWHERE else. Putting the entry
    /// on the job was the whole defect, so a passing status check isn't enough —
    /// assert the job stayed clean.
    @Test func aPanelRequestIsNotWrittenToTheJob() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: "p1", opId: nil, entry: entry("req_1")))

        #expect(job.finishRequests == nil)
        #expect(job.finishRequest == nil)
        #expect(job.subs[0].finishRequests?.count == 1)
        #expect(job.subs[0].subs[0].finishRequests == nil)
    }

    @Test func aSubOpRequestIsNotWrittenToThePanelOrTheJob() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: "p1", opId: "o1", entry: entry("req_1")))

        #expect(job.finishRequests == nil)
        #expect(job.subs[0].finishRequests == nil)
        #expect(job.subs[0].subs[0].finishRequests?.count == 1)
    }

    // MARK: - All three signals the web reads

    /// The web reads the row, the `finishRequest` stamp OR `pendingFinish`, and
    /// treats any of them as pending. Write all three so the desktop agrees
    /// however it happens to look.
    @Test func aPanelRequestWritesTheStampAndTheFlag() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: "p1", opId: nil, entry: entry("req_1")))
        let panel = job.subs[0]

        #expect(panel.finishRequest?.requestId == "req_1")
        #expect(panel.finishRequest?.byName == "Quincy")
        #expect(panel.pendingFinish == true)
        #expect(panel.finishRequests?.first?.status == "pending")
    }

    @Test func aSubOpRequestWritesTheStampAndTheFlag() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: "p1", opId: "o1", entry: entry("req_1")))
        let op = job.subs[0].subs[0]

        #expect(op.finishRequest?.requestId == "req_1")
        #expect(op.pendingFinish == true)
        #expect(op.finishRequests?.first?.status == "pending")
    }

    /// A job-level request has no panel id to resolve, so it lands on the job —
    /// and `Job` carries no `pendingFinish`, which is why `target` reads `false`
    /// there rather than treating its absence as a signal.
    @Test func aJobLevelRequestLandsOnTheJob() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: nil, opId: nil, entry: entry("req_1")))

        #expect(job.finishRequest?.requestId == "req_1")
        #expect(job.finishRequests?.count == 1)
        #expect(CompletionRequestRules.status(job: job, panelId: nil, opId: nil,
                                              requestId: "req_1") == "pending")
    }

    // MARK: - Refusing to write to the wrong item

    /// An unresolvable panel id returns nil rather than falling back to the job.
    /// Silently retargeting is how the entry ended up on the wrong item in the
    /// first place.
    @Test func anUnknownPanelRefusesTheWrite() throws {
        let job = try cleanJob()
        #expect(CompletionRequestRules.addPendingRequest(
            to: job, panelId: "nope", opId: nil, entry: entry("req_1")) == nil)
    }

    @Test func anUnknownSubOpRefusesTheWrite() throws {
        let job = try cleanJob()
        #expect(CompletionRequestRules.addPendingRequest(
            to: job, panelId: "p1", opId: "nope", entry: entry("req_1")) == nil)
    }

    // MARK: - Existing history is kept

    @Test func aNewRequestIsAppendedToThePanelsHistory() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data("""
        {"id":"j1","title":"Panel Run","subs":[{"id":"p1","title":"Panel A","subs":[],
          "finishRequests":[{"id":"old","by":"7","byName":"Q","at":"T","status":"declined"}]}]}
        """.utf8))
        let out = try #require(CompletionRequestRules.addPendingRequest(
            to: job, panelId: "p1", opId: nil, entry: entry("req_1")))

        #expect(out.subs[0].finishRequests?.map(\.id) == ["old", "req_1"])
        #expect(CompletionRequestRules.status(job: out, panelId: "p1", opId: nil,
                                              requestId: "old") == "declined")
    }

    // MARK: - The decision path can now read what the request path wrote

    /// End to end: raise it, then resolve it. `applyDecision` reads the entries
    /// `target` resolves, so a request written to the wrong item was refused even
    /// when a button did somehow get pressed.
    @Test func aRaisedPanelRequestCanBeApproved() throws {
        let job = try #require(CompletionRequestRules.addPendingRequest(
            to: cleanJob(), panelId: "p1", opId: nil, entry: entry("req_1")))

        let entries = CompletionRequestRules.target(job: job, panelId: "p1", opId: nil).entries
        let resolved = CompletionRequestRules.applyDecision(
            to: entries, requestId: "req_1", newStatus: "approved",
            allowedFrom: ["pending"], resolvedBy: "1", resolvedByName: "Trey", resolvedAt: "T")

        #expect(resolved?.first?.status == "approved")
        #expect(resolved?.first?.resolvedByName == "Trey")
    }
}
