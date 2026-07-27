//
//  TRAQS_SchedulingTests.swift
//  TRAQS SchedulingTests
//
//  Created by Treysen Parkinson on 3/5/26.
//

import Testing
@testable import TRAQS_Scheduling

struct TRAQS_SchedulingTests {

    // MARK: - canViewThread: delivered messages must never vanish

    /// Builds a minimal message on `threadKey` whose server-set participant
    /// roster is `participants`.
    private func message(_ threadKey: String, participants: [String]) -> Message {
        Message(id: "m1", threadKey: threadKey, scope: "group",
                jobId: nil, panelId: nil, opId: nil,
                text: "hi", authorId: participants.first ?? "x",
                authorName: "Someone", authorColor: "#4169e1",
                participantIds: participants, attachments: [], timestamp: "2026-07-27T00:00:00Z")
    }

    /// The bug: a time-off request spins up a brand-new group and drops its
    /// bubble in the same instant, so the message routinely arrives before the
    /// group syncs into `appState.groups`. The old filter hid the whole thread
    /// (and its Approve/Deny actions) whenever the group wasn't loaded yet.
    @Test func groupThreadVisibleBeforeGroupSyncsViaMessageRoster() {
        let me = "admin-1"
        let msg = message("group:new-timeoff-group", participants: [me, "worker-2"])
        // groups is EMPTY (not synced yet) — must still be visible because the
        // delivered message lists me as a participant.
        #expect(MessagesView.canViewThread("group:new-timeoff-group",
                                            myId: me, jobs: [], groups: [],
                                            messages: [msg]) == true)
    }

    /// The fallback is not an ACL hole: a thread I'm genuinely not part of never
    /// carries my id in `participantIds`, so it stays hidden even unsynced.
    @Test func groupThreadHiddenWhenNotAParticipant() {
        let msg = message("group:someone-elses-group", participants: ["worker-2", "worker-3"])
        #expect(MessagesView.canViewThread("group:someone-elses-group",
                                            myId: "admin-1", jobs: [], groups: [],
                                            messages: [msg]) == false)
    }

    /// When the group IS loaded, membership is still authoritative.
    @Test func groupThreadHonorsLoadedMembership() {
        let g = ChatGroup(id: "g1", name: "Team", memberIds: ["admin-1"])
        #expect(MessagesView.canViewThread("group:g1", myId: "admin-1",
                                            jobs: [], groups: [g], messages: []) == true)
        #expect(MessagesView.canViewThread("group:g1", myId: "outsider",
                                            jobs: [], groups: [g], messages: []) == false)
    }

    /// DMs are self-authorizing from the key and never depended on a synced
    /// entity — guard against regressions.
    @Test func dmThreadAuthorizedFromKey() {
        #expect(MessagesView.canViewThread("dm:admin-1_worker-2",
                                            myId: "admin-1", jobs: [], groups: []) == true)
        #expect(MessagesView.canViewThread("dm:worker-2_worker-3",
                                            myId: "admin-1", jobs: [], groups: []) == false)
    }
}
