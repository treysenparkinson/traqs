import Testing
@testable import TRAQS_Scheduling

/// #297 — the same cases as scripts/thread-clear-test.mjs §1, so the phone and
/// the server agree on which threads can be cleared.
struct ThreadClearRuleTests {
    let groups = [
        ChatGroup(id: "G1", name: "Crew", memberIds: ["7", "8"], createdBy: "7"),
        ChatGroup(id: "G2", name: "Legacy", memberIds: ["7", "8"]),
    ]
    func can(_ key: String, _ viewer: String?, admin: Bool = false) -> Bool {
        ThreadClearRule.canClear(threadKey: key, viewerId: viewer, isAdmin: admin, groups: groups)
    }

    @Test func groupIsTheCreatorsOrAnAdmins() {
        #expect(can("group:G1", "7"))
        #expect(!can("group:G1", "8"))
        #expect(can("group:G1", "1", admin: true))
        #expect(can("group:Crew", "7"))
    }

    @Test func groupWithNoCreatorIsAdminOnly() {
        #expect(!can("group:G2", "7"))
        #expect(can("group:G2", "1", admin: true))
        #expect(!can("group:nope", "1", admin: true))
    }

    @Test func jobPanelAndOpThreadsAreAdminOnly() {
        for key in ["job:J1", "panel:P1", "op:O1"] {
            #expect(can(key, "1", admin: true))
            #expect(!can(key, "8"))
        }
    }

    @Test func aDMIsNobodys() {
        #expect(!can("dm:7_8", "7"))
        #expect(!can("dm:7_8", "8"))
        #expect(!can("dm:1_7", "1", admin: true))
    }

    @Test func unknownKindsAndNoViewerAreRefused() {
        #expect(!can("other:x", "1", admin: true))
        #expect(!can("job:J1", nil, admin: true))
    }
}
