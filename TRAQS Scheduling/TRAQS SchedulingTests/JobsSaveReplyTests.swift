import Testing
import Foundation
@testable import TRAQS_Scheduling

// `POST /tasks`'s reply. Every refusal used to read "check your connection"
// (defect #294), and a success's `conflicts` list was thrown away unread.
@Suite("Jobs save reply")
struct JobsSaveReplyTests {

    private func data(_ s: String) -> Data { Data(s.utf8) }

    private func job(_ id: String, _ title: String) -> Job {
        Job(id: id, title: title, start: "2026-03-01", end: "2026-03-02")
    }

    // MARK: Refusals

    @Test func a422NamesTheRuleNotTheNetwork() {
        let body = data(#"{"error":"Start date can't be after the end date","violations":[{"jobId":"j1","rule":"dates"}]}"#)
        #expect(JobsSaveReply.errorMessage(status: 422, body: body)
                == "Start date can't be after the end date")
    }

    @Test func a403NamesThePermission() {
        let body = data(#"{"error":"You don't have permission to move jobs"}"#)
        #expect(JobsSaveReply.errorMessage(status: 403, body: body)
                == "You don't have permission to move jobs")
    }

    @Test func aBodyWithoutAnErrorFallsBackToTheStatus() {
        let body = data(#"{"message":"nope"}"#)
        let message = JobsSaveReply.errorMessage(status: 500, body: body)
        #expect(message == "Couldn't save — server error 500")
        #expect(message != JobsSaveReply.connectionMessage)
    }

    @Test func aNonJSONBodyFallsBackToTheStatus() {
        let body = data("<html><body>Bad Gateway</body></html>")
        #expect(JobsSaveReply.errorMessage(status: 502, body: body)
                == "Couldn't save — server error 502")
    }

    // MARK: Conflicts

    @Test func conflictsArePickedOutOfASuccess() {
        let body = data(#"{"ok":true,"conflicts":["j1","j2"]}"#)
        #expect(JobsSaveReply.conflicts(in: body) == ["j1", "j2"])
    }

    @Test func anEmptyConflictListIsNone() {
        #expect(JobsSaveReply.conflicts(in: data(#"{"ok":true,"conflicts":[]}"#)).isEmpty)
    }

    @Test func anAbsentConflictListIsNone() {
        #expect(JobsSaveReply.conflicts(in: data(#"{"ok":true}"#)).isEmpty)
        #expect(JobsSaveReply.conflicts(in: Data()).isEmpty)
    }

    @Test func theToastCountsTheJobs() {
        #expect(JobsSaveReply.conflictMessage(count: 1)
                == "1 job changed on the server and wasn't saved")
        #expect(JobsSaveReply.conflictMessage(count: 3)
                == "3 jobs changed on the server and weren't saved")
    }

    // MARK: Refreshing the conflicted jobs

    @Test func onlyTheConflictedJobsTakeTheServersCopy() {
        let local = [job("j1", "Mine"), job("j2", "Mine too"), job("j3", "Local only")]
        let server = [job("j1", "Server"), job("j2", "Server too"), job("j4", "Elsewhere")]
        let out = JobsSaveReply.replacingConflicts(["j1"], in: local, from: server)
        #expect(out.map(\.id) == ["j1", "j2", "j3"])
        #expect(out[0].title == "Server")
        #expect(out[1].title == "Mine too")
    }

    @Test func aConflictedJobComesBackOrGoesWithTheServer() {
        let local = [job("j1", "Mine")]
        let server = [job("j2", "Kept on server")]
        let out = JobsSaveReply.replacingConflicts(["j1", "j2"], in: local, from: server)
        #expect(out.map(\.id) == ["j2"])
    }
}
