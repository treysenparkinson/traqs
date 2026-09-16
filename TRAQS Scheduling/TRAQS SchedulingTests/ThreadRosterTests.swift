import Testing
@testable import TRAQS_Scheduling

/// Who a thread's avatar stack should show.
///
/// These cover "some group messages still aren't showing the multiple profile
/// images": the inbox row built its stack from message AUTHORS, so a group
/// showed one avatar per person who had SPOKEN rather than one per member. A
/// four-person group where only one person had posted rendered a single
/// avatar — and one where the only speaker wasn't in `people` rendered the
/// generic "#" fallback.
struct ThreadRosterTests {

    private func person(_ id: String, _ name: String) -> Person {
        Person(id: id, name: name, role: "", email: "", cap: 8,
               color: "#7C3AED", userRole: "user")
    }

    private func message(_ id: String, thread: String, author: String,
                         participants: [String] = []) -> Message {
        Message(id: id, threadKey: thread, scope: "group",
                jobId: nil, panelId: nil, opId: nil,
                text: "hi", authorId: author, authorName: author, authorColor: "#7C3AED",
                participantIds: participants, attachments: [],
                timestamp: "2026-08-26T10:00:00Z")
    }

    private var everyone: [Person] {
        [person("u1", "Caleb Smith"), person("u2", "Quincy Doe"),
         person("u3", "Max Power"),   person("u4", "Trey Parkinson")]
    }

    // MARK: - The defect

    @Test func groupShowsEveryMemberNotJustWhoHasSpoken() {
        let g = ChatGroup(id: "g1", name: "Crew", memberIds: ["u1", "u2", "u3", "u4"])
        // One message, one author — the case that rendered a single avatar.
        let msgs = [message("m1", thread: "group:g1", author: "u1")]
        let roster = ThreadRoster.participants(threadKey: "group:g1",
                                               messages: msgs,
                                               people: everyone,
                                               groups: [g])
        #expect(roster.map(\.id) == ["u1", "u2", "u3", "u4"])
    }

    @Test func groupWithNoMessagesStillShowsItsMembers() {
        let g = ChatGroup(id: "g1", name: "Crew", memberIds: ["u2", "u3"])
        let roster = ThreadRoster.participants(threadKey: "group:g1",
                                               messages: [],
                                               people: everyone,
                                               groups: [g])
        #expect(roster.map(\.id) == ["u2", "u3"])
    }

    /// Groups keyed by NAME rather than id — the web app's older format, which
    /// `canViewThread` and the thread header both still accept.
    @Test func groupResolvesByNameAsWellAsId() {
        let g = ChatGroup(id: "g1", name: "Crew", memberIds: ["u1", "u3"])
        let roster = ThreadRoster.participants(threadKey: "group:Crew",
                                               messages: [],
                                               people: everyone,
                                               groups: [g])
        #expect(roster.map(\.id) == ["u1", "u3"])
    }

    // MARK: - The fallback, when the group hasn't synced yet

    /// A freshly created group routinely lands a beat AFTER its first message
    /// (see `canViewThread`). The roster has to come off the message itself
    /// until the group arrives — and `participantIds`, not just the author, is
    /// what makes that more than one face.
    @Test func unsyncedGroupFallsBackToTheMessageRoster() {
        let msgs = [message("m1", thread: "group:g9", author: "u1",
                            participants: ["u1", "u2", "u3"])]
        let roster = ThreadRoster.participants(threadKey: "group:g9",
                                               messages: msgs,
                                               people: everyone,
                                               groups: [])
        #expect(Set(roster.map(\.id)) == ["u1", "u2", "u3"])
    }

    @Test func jobThreadUsesTheMessageRoster() {
        let msgs = [message("m1", thread: "job:j1", author: "u2",
                            participants: ["u2", "u4"])]
        let roster = ThreadRoster.participants(threadKey: "job:j1",
                                               messages: msgs,
                                               people: everyone,
                                               groups: [])
        #expect(Set(roster.map(\.id)) == ["u2", "u4"])
    }

    // MARK: - Shape guarantees the avatar stack depends on

    @Test func dmResolvesBothSidesFromTheKey() {
        let roster = ThreadRoster.participants(threadKey: "dm:u1_u4",
                                               messages: [],
                                               people: everyone,
                                               groups: [])
        #expect(roster.map(\.id) == ["u1", "u4"])
    }

    @Test func rosterHasNoDuplicates() {
        let g = ChatGroup(id: "g1", name: "Crew", memberIds: ["u1", "u1", "u2"])
        let roster = ThreadRoster.participants(threadKey: "group:g1",
                                               messages: [],
                                               people: everyone,
                                               groups: [g])
        #expect(roster.map(\.id) == ["u1", "u2"])
    }

    /// Order has to be stable across re-renders or the stack visibly shuffles.
    @Test func fallbackOrderIsStableByFirstAppearance() {
        let msgs = [message("m1", thread: "job:j1", author: "u3", participants: ["u3", "u1"]),
                    message("m2", thread: "job:j1", author: "u2", participants: ["u2"])]
        let roster = ThreadRoster.participants(threadKey: "job:j1",
                                               messages: msgs,
                                               people: everyone,
                                               groups: [])
        #expect(roster.map(\.id) == ["u3", "u1", "u2"])
    }

    @Test func unknownPeopleAreDropped() {
        let g = ChatGroup(id: "g1", name: "Crew", memberIds: ["u1", "ghost", "u2"])
        let roster = ThreadRoster.participants(threadKey: "group:g1",
                                               messages: [],
                                               people: everyone,
                                               groups: [g])
        #expect(roster.map(\.id) == ["u1", "u2"])
    }
}
