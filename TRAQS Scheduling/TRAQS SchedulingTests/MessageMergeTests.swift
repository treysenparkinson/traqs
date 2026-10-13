import Testing
@testable import TRAQS_Scheduling

// A refresh landing while a send is in flight used to replace the message list with
// one that didn't have the sent message yet, so the bubble vanished and came back
// when the send finished. MessageMerge.keepingOutgoing is what keeps it on screen.
@Suite("Message list keeps in-flight sends")
struct MessageMergeTests {
    private func msg(_ id: String, at time: String) -> Message {
        Message(id: id, threadKey: "group:g1", scope: "group",
                jobId: nil, panelId: nil, opId: nil,
                text: id, authorId: "u1", authorName: "Caleb", authorColor: "#7C3AED",
                participantIds: ["u1", "u2"], attachments: [],
                timestamp: time)
    }

    @Test("a refresh without my sending message still shows it, in time order")
    func keepsAMissingSend() {
        let server = [msg("a", at: "2026-10-13T10:00:00Z"), msg("c", at: "2026-10-13T10:02:00Z")]
        let sending = [msg("b", at: "2026-10-13T10:01:00Z")]
        let merged = MessageMerge.keepingOutgoing(server, outgoing: sending)
        #expect(merged.map(\.id) == ["a", "b", "c"])
    }

    @Test("a refresh that already has it doesn't show it twice")
    func noDuplicateOnceStored() {
        let server = [msg("a", at: "2026-10-13T10:00:00Z"), msg("b", at: "2026-10-13T10:01:00Z")]
        let sending = [msg("b", at: "2026-10-13T10:01:00Z")]
        let merged = MessageMerge.keepingOutgoing(server, outgoing: sending)
        #expect(merged.map(\.id) == ["a", "b"])
    }

    @Test("nothing in flight: the incoming list is used as is")
    func nothingInFlight() {
        let server = [msg("a", at: "2026-10-13T10:00:00Z"), msg("b", at: "2026-10-13T10:01:00Z")]
        #expect(MessageMerge.keepingOutgoing(server, outgoing: []) == server)
    }

    @Test("an empty refresh keeps the sending message")
    func emptyRefresh() {
        let sending = [msg("b", at: "2026-10-13T10:01:00Z")]
        #expect(MessageMerge.keepingOutgoing([], outgoing: sending).map(\.id) == ["b"])
    }
}
