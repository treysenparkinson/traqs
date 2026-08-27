import Testing
import Foundation
@testable import TRAQS_Scheduling

/// IDs arrive as either JSON strings or JSON numbers — the web app stores both.
///
/// These cover "completion request messages come in but Approve/Deny can't be
/// pressed": `Message.jobId` was decoded strictly as a String, so a numeric job
/// id THREW, the `try?` turned it into nil, and the chat card could never find
/// the job to learn the request was still pending — so it rendered no buttons.
@MainActor
struct FlexIDDecodingTests {

    private func decodeMessage(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    // MARK: - The defect

    @Test func messageKeepsANumericJobIdAsAString() throws {
        let m = try decodeMessage("""
        {"id":"msg_1","threadKey":"group:g1","scope":"group",
         "jobId":402,"panelId":17,"opId":93,
         "text":"Completion requested by Quincy for Job #402 — Panel A",
         "authorId":7,"authorName":"Quincy","authorColor":"#4169e1",
         "participantIds":[],"attachments":[],"timestamp":"2026-08-27T09:00:00Z",
         "type":"finish_request","finishRequestId":"req_1"}
        """)
        #expect(m.jobId == "402")
        #expect(m.panelId == "17")
        #expect(m.opId == "93")
        #expect(m.finishRequestId == "req_1")
    }

    /// The whole point: a numeric jobId has to match the Job it names, since
    /// `Job.id` has always flex-decoded.
    @Test func aNumericJobIdMatchesTheJobItNames() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data("""
        {"id":402,"title":"Panel Run","subs":[],"jobNumber":402}
        """.utf8))
        let m = try decodeMessage("""
        {"id":"msg_1","threadKey":"group:g1","scope":"group","jobId":402,
         "text":"x","authorId":"7","authorName":"Q","authorColor":"#000",
         "participantIds":[],"attachments":[],"timestamp":"T",
         "type":"finish_request","finishRequestId":"req_1"}
        """)
        #expect(job.id == "402")
        #expect(m.jobId == job.id)
        // And the number renders, rather than vanishing from "Job #…".
        #expect(job.jobNumber == "402")
    }

    // MARK: - No regression for the string form

    @Test func stringIdsStillDecodeUnchanged() throws {
        let m = try decodeMessage("""
        {"id":"msg_1","threadKey":"dm:a_b","scope":"dm",
         "jobId":"job_abc","panelId":"panel_abc","opId":"op_abc",
         "text":"x","authorId":"a","authorName":"A","authorColor":"#000",
         "participantIds":[],"attachments":[],"timestamp":"T"}
        """)
        #expect(m.jobId == "job_abc")
        #expect(m.panelId == "panel_abc")
        #expect(m.opId == "op_abc")
    }

    @Test func absentAndNullIdsStayNil() throws {
        let m = try decodeMessage("""
        {"id":"msg_1","threadKey":"dm:a_b","scope":"dm","panelId":null,
         "text":"x","authorId":"a","authorName":"A","authorColor":"#000",
         "participantIds":[],"attachments":[],"timestamp":"T"}
        """)
        #expect(m.jobId == nil)
        #expect(m.panelId == nil)
        #expect(m.opId == nil)
    }

    // MARK: - The same class, elsewhere

    @Test func jobKeepsANumericClientId() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data("""
        {"id":"j1","title":"T","subs":[],"clientId":88}
        """.utf8))
        #expect(job.clientId == "88")
    }

    /// End to end: the card decides on `displayStatus`, which needs the job the
    /// message points at. With the id decoded, a pending request is actionable.
    @Test func aPendingRequestIsActionableOnceTheJobIsFound() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data("""
        {"id":402,"title":"Panel Run","subs":[],
         "finishRequests":[{"id":"req_1","by":"7","byName":"Quincy",
                            "at":"2026-08-27T09:00:00Z","status":"pending"}]}
        """.utf8))
        let m = try decodeMessage("""
        {"id":"msg_1","threadKey":"group:g1","scope":"group","jobId":402,
         "text":"x","authorId":"7","authorName":"Q","authorColor":"#000",
         "participantIds":[],"attachments":[],"timestamp":"T",
         "type":"finish_request","finishRequestId":"req_1"}
        """)
        let found = [job].first { $0.id == m.jobId }
        #expect(found != nil)
        let status = CompletionRequestRules.displayStatus(entries: found?.finishRequests,
                                                          requestId: m.finishRequestId)
        #expect(status == "pending")
        #expect(CompletionRequestRules.isActionable(status))
    }
}
