import Testing
import Foundation
@testable import TRAQS_Scheduling

// #288. With nobody holding approveCompletions, the web records the request and tells the
// requester nobody can receive it. Both phone paths said "sent" instead: the Tasks screen
// built a "Completion Requests" thread holding only the requester and posted into it, and
// the job-detail Request Finish (server `finishRequest`) did the same server-side.
@Suite("A completion request with nobody to approve it says so (#288)")
struct NoApproverTests {
    private func person(_ json: String) -> Person {
        try! JSONDecoder().decode(Person.self, from: Data(json.utf8))
    }

    @Test("the audience is admins who can approve completions — the web's rule")
    func audience() {
        let people = [
            person(#"{"id":"1","name":"A","userRole":"admin"}"#),
            person(#"{"id":"2","name":"B","userRole":"admin","adminPerms":{"approveCompletions":false}}"#),
            person(#"{"id":"7","name":"W","userRole":"user"}"#),
        ]
        #expect(CompletionRequestRules.approverIds(in: people) == ["1"])
    }

    @Test("no admin with the permission means no approver")
    func nobody() {
        let people = [
            person(#"{"id":"2","name":"B","userRole":"admin","adminPerms":{"approveCompletions":false}}"#),
            person(#"{"id":"7","name":"W","userRole":"user"}"#),
        ]
        #expect(CompletionRequestRules.approverIds(in: people).isEmpty)
    }

    @Test("the server's noApprover answer is read; its absence is not")
    func serverAnswer() {
        #expect(CompletionRequestRules.serverSaysNoApprover(Data(#"{"ok":true,"requestId":"r","noApprover":true}"#.utf8)))
        #expect(!CompletionRequestRules.serverSaysNoApprover(Data(#"{"ok":true,"requestId":"r"}"#.utf8)))
        #expect(!CompletionRequestRules.serverSaysNoApprover(Data(#"{"ok":true,"alreadyOpen":true}"#.utf8)))
        #expect(!CompletionRequestRules.serverSaysNoApprover(Data()))
    }

    @Test("the message is the web's, word for word")
    func sameWords() {
        #expect(CompletionRequestRules.noApproverMessage
                == "No admins are available to receive this request. Please contact your administrator directly.")
    }
}
