import Testing
import Foundation
@testable import TRAQS_Scheduling

/// Which ITEM a completion request belongs to.
///
/// Covers "completion requests come in but I can't accept, deny or undo them on
/// iOS". The web writes the request onto the item that was actually requested —
/// sub-op, else panel, else the job (`addFinishReq` in TRAQS.jsx recurses by
/// item id). iOS modelled `finishRequests` on Job alone, so a task-level request
/// decoded away to nothing: the chat card could never learn it was pending, and
/// so rendered neither Approve/Deny nor Undo.
@MainActor
struct CompletionRequestTargetTests {

    private func entry(_ id: String, _ status: String) -> FinishRequestEntry {
        FinishRequestEntry(id: id, by: "7", byName: "Quincy",
                           at: "2026-08-27T09:00:00Z", status: status)
    }

    /// A job whose OP carries the request — the shape the web writes.
    private func jobWithOpRequest(_ status: String) throws -> Job {
        try JSONDecoder().decode(Job.self, from: Data("""
        {"id":402,"title":"Panel Run","status":"In Progress",
         "subs":[{"id":17,"title":"Panel A","status":"In Progress",
                  "subs":[{"id":93,"title":"Weld","status":"In Progress",
                           "finishRequest":{"requestId":"req_1","by":7,"byName":"Quincy","at":"T"},
                           "pendingFinish":true,
                           "finishRequests":[{"id":"req_1","by":7,"byName":"Quincy",
                                              "at":"2026-08-27T09:00:00Z","status":"\(status)"}]}]}]}
        """.utf8))
    }

    // MARK: - The defect

    @Test func aRequestOnAnOpIsFoundOnTheOpNotTheJob() throws {
        let job = try jobWithOpRequest("pending")
        // The job itself carries nothing — which is exactly why the old lookup failed.
        #expect(job.finishRequests == nil)
        let status = CompletionRequestRules.status(job: job, panelId: "17", opId: "93",
                                                   requestId: "req_1")
        #expect(status == "pending")
        #expect(CompletionRequestRules.isActionable(status))
    }

    @Test func anApprovedOpRequestIsUndoable() throws {
        let job = try jobWithOpRequest("approved")
        #expect(CompletionRequestRules.status(job: job, panelId: "17", opId: "93",
                                              requestId: "req_1") == "approved")
    }

    @Test func aRequestOnAPanelIsFoundOnThePanel() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data("""
        {"id":"j1","title":"T","subs":[{"id":"p1","title":"Panel A","subs":[],
          "finishRequests":[{"id":"req_2","by":"7","byName":"Q","at":"T","status":"pending"}]}]}
        """.utf8))
        #expect(CompletionRequestRules.status(job: job, panelId: "p1", opId: nil,
                                              requestId: "req_2") == "pending")
    }

    // MARK: - Not conflating absence with data

    /// The job's entries belong to a DIFFERENT request, so an unresolvable panel
    /// must NOT fall through to them.
    @Test func anUnresolvablePanelDoesNotFallBackToTheJob() {
        let job = Job(id: "j1", title: "T", start: "", end: "",
                      finishRequests: [entry("req_job", "pending")])
        let status = CompletionRequestRules.status(job: job, panelId: "nope", opId: nil,
                                                   requestId: "req_job")
        #expect(status == nil)
    }

    @Test func aMissingJobIsUnknownNotPending() {
        #expect(CompletionRequestRules.status(job: nil, panelId: nil, opId: nil,
                                              requestId: "req_1") == nil)
        #expect(!CompletionRequestRules.isActionable(nil))
    }

    // MARK: - Older requests that predate the entry list

    @Test func aStampWithoutAnEntryRowStillReadsAsPending() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data("""
        {"id":"j1","title":"T","subs":[{"id":"p1","title":"A","subs":[],
          "pendingFinish":true}]}
        """.utf8))
        #expect(CompletionRequestRules.status(job: job, panelId: "p1", opId: nil,
                                              requestId: "req_x") == "pending")
    }

    @Test func aFinishedTargetWithNoRowReadsAsApproved() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data("""
        {"id":"j1","title":"T","subs":[{"id":"p1","title":"A","status":"Finished","subs":[]}]}
        """.utf8))
        #expect(CompletionRequestRules.status(job: job, panelId: "p1", opId: nil,
                                              requestId: "req_x") == "approved")
    }

    // MARK: - Round-trip: iOS saving a job must not strip these

    /// Codable's synthesised encode only writes what the struct models, and
    /// `updateJob` persists the WHOLE object — so an unmodelled field was wiped
    /// from the server on every iOS job save.
    @Test func taskLevelRequestsSurviveAnEncodeDecodeRoundTrip() throws {
        let job = try jobWithOpRequest("pending")
        let round = try JSONDecoder().decode(Job.self, from: JSONEncoder().encode(job))
        let op = round.subs.first?.subs.first
        #expect(op?.finishRequests?.first?.id == "req_1")
        #expect(op?.finishRequest?.requestId == "req_1")
        #expect(op?.pendingFinish == true)
    }
}
