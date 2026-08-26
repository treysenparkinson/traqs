//
//  TRAQS_SchedulingTests.swift
//  TRAQS SchedulingTests
//
//  Created by Treysen Parkinson on 3/5/26.
//

import Testing
import Foundation
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

// MARK: - Stats math

/// Fixed UTC calendar so these assert on the arithmetic, not on wherever the
/// test happens to run.
private let statsCalendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()
private let statsISO: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.timeZone = TimeZone(identifier: "UTC")!
    return f
}()
private func at(_ iso: String) -> Date { statsISO.date(from: iso)! }
private func startOfDay(_ iso: String) -> Date { statsCalendar.startOfDay(for: at(iso)) }
private func brk(_ person: String, _ type: String, _ iso: String) -> StatsMath.BreakRow {
    StatsMath.BreakRow(personId: person, type: type, t: at(iso))
}
/// Default `now` sits on a LATER day than every fixture below, so an unpaired
/// start in those fixtures is stale rather than live and stays excluded. Tests
/// that exercise a break still running pass their own same-day `now`.
private let statsDefaultNow = at("2026-08-05T00:00:00Z")
private func totalBreak(_ rows: [StatsMath.BreakRow], now: Date = statsDefaultNow) -> Double {
    StatsMath.breakHoursByDay(rows, now: now, calendar: statsCalendar).values.reduce(0, +)
}

struct StatsMathBreakTests {

    /// The bug: every worker's rows were paired against ONE global cursor, so a
    /// shop breaking together lost most of its break time. Three simultaneous
    /// 15-minute breaks reported 0.25h — one break, not three.
    @Test func simultaneousBreaksAreCountedPerPerson() {
        let rows = [
            brk("p1", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p2", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p3", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p1", "breakEnd",   "2026-08-03T10:15:00Z"),
            brk("p2", "breakEnd",   "2026-08-03T10:15:00Z"),
            brk("p3", "breakEnd",   "2026-08-03T10:15:00Z"),
        ]
        #expect(abs(totalBreak(rows) - 0.75) < 0.0001)
    }

    /// Interleaved (not identical) intervals were the worse case — the old
    /// pairing reported 0.15h of the real 0.75h.
    @Test func staggeredOverlappingBreaksAreCountedPerPerson() {
        let rows = [
            brk("p1", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p2", "breakStart", "2026-08-03T10:03:00Z"),
            brk("p3", "breakStart", "2026-08-03T10:06:00Z"),
            brk("p1", "breakEnd",   "2026-08-03T10:15:00Z"),
            brk("p2", "breakEnd",   "2026-08-03T10:18:00Z"),
            brk("p3", "breakEnd",   "2026-08-03T10:21:00Z"),
        ]
        #expect(abs(totalBreak(rows) - 0.75) < 0.0001)
    }

    /// One person's two breaks in a day still pair independently.
    @Test func twoBreaksInOneDayBothCount() {
        let rows = [
            brk("p1", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p1", "breakEnd",   "2026-08-03T10:15:00Z"),
            brk("p1", "breakStart", "2026-08-03T14:00:00Z"),
            brk("p1", "breakEnd",   "2026-08-03T14:15:00Z"),
        ]
        #expect(abs(totalBreak(rows) - 0.5) < 0.0001)
    }

    /// A STALE unpaired start — one left open on an earlier day — is ignored
    /// rather than guessed at, and must not swallow another person's end.
    @Test func staleUnpairedStartIsIgnoredWithoutStealingAnotherPersonsEnd() {
        let rows = [
            brk("p1", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p2", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p2", "breakEnd",   "2026-08-03T10:15:00Z"),
        ]
        #expect(abs(totalBreak(rows) - 0.25) < 0.0001)
    }

    /// Break time is filed under the day the break started.
    @Test func breakHoursBucketByStartDay() {
        let byDay = StatsMath.breakHoursByDay([
            brk("p1", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p1", "breakEnd",   "2026-08-03T10:15:00Z"),
            brk("p2", "breakStart", "2026-08-04T10:00:00Z"),
            brk("p2", "breakEnd",   "2026-08-04T10:30:00Z"),
        ], now: statsDefaultNow, calendar: statsCalendar)
        #expect(abs((byDay[startOfDay("2026-08-03T00:00:00Z")] ?? 0) - 0.25) < 0.0001)
        #expect(abs((byDay[startOfDay("2026-08-04T00:00:00Z")] ?? 0) - 0.50) < 0.0001)
    }

    /// The bug this fixes: a break that is STILL RUNNING was counted nowhere.
    ///
    /// `breakHoursByDay` ignored an unpaired start on the stated assumption that
    /// "the live accrual covers a break that is still open right now" — but the
    /// only break flow workers use (`breakBegin`) writes `person.activeBreak` and
    /// a payhours row, never `activeClockIn.events`, which is the sole source the
    /// live accrual read. So an open break was subtracted from neither: pay kept
    /// accruing gross while production sat paused, and efficiency sagged by the
    /// whole elapsed break until the worker ended it.
    @Test func openBreakCountsElapsedTimeUpToNow() {
        let rows = [brk("p1", "breakStart", "2026-08-03T10:00:00Z")]
        let now = at("2026-08-03T10:20:00Z")
        #expect(abs(totalBreak(rows, now: now) - (20.0 / 60.0)) < 0.0001)
    }

    /// A closed break earlier in the day plus one still running: both count.
    @Test func closedAndOpenBreakOnSameDayBothCount() {
        let rows = [
            brk("p1", "breakStart", "2026-08-03T10:00:00Z"),
            brk("p1", "breakEnd",   "2026-08-03T10:15:00Z"),
            brk("p1", "breakStart", "2026-08-03T14:00:00Z"),
        ]
        let now = at("2026-08-03T14:10:00Z")
        #expect(abs(totalBreak(rows, now: now) - (0.25 + 10.0 / 60.0)) < 0.0001)
    }

    /// An open break is filed under the day it STARTED, like a closed one.
    @Test func openBreakBucketsUnderItsStartDay() {
        let byDay = StatsMath.breakHoursByDay(
            [brk("p1", "breakStart", "2026-08-03T10:00:00Z")],
            now: at("2026-08-03T10:30:00Z"),
            calendar: statsCalendar)
        #expect(abs((byDay[startOfDay("2026-08-03T00:00:00Z")] ?? 0) - 0.5) < 0.0001)
    }

    /// A start left open on an earlier day is NOT closed at `now` — that would
    /// credit an abandoned break every hour since, blowing past the day's pay and
    /// clamping working time (and so efficiency) to zero. The server pairs a
    /// forgotten break at clock-out; until then it stays out.
    @Test func staleOpenBreakFromAnEarlierDayIsNotAccruedToNow() {
        let rows = [brk("p1", "breakStart", "2026-08-03T10:00:00Z")]
        let now = at("2026-08-04T09:00:00Z")
        #expect(totalBreak(rows, now: now) == 0)
    }

    /// A start stamped after `now` (clock skew between a device and the server)
    /// must not produce negative break time.
    @Test func openBreakStartingAfterNowContributesNothing() {
        let rows = [brk("p1", "breakStart", "2026-08-03T10:20:00Z")]
        let now = at("2026-08-03T10:00:00Z")
        #expect(totalBreak(rows, now: now) == 0)
    }

    /// At shop scale the undercount was ~15×.
    @Test func fifteenWorkersBreakingTogether() {
        var rows: [StatsMath.BreakRow] = []
        for i in 0..<15 {
            rows.append(brk("w\(i)", "breakStart", "2026-08-03T10:00:00Z"))
            rows.append(brk("w\(i)", "breakEnd",   "2026-08-03T10:15:00Z"))
        }
        #expect(abs(totalBreak(rows) - 3.75) < 0.0001)
    }
}

struct StatsMathWeekTests {

    /// The platform split: `.weekOfYear` starts Sunday under en_US, so Sunday's
    /// hours landed in a different week than the desktop's Monday-anchored one.
    @Test func sundayBelongsToTheWeekThatStartedMonday() {
        let week = StatsMath.weekInterval(containing: at("2026-08-09T13:00:00Z"), calendar: statsCalendar)
        #expect(week.start == startOfDay("2026-08-03T00:00:00Z"))
        #expect(week.end == startOfDay("2026-08-10T00:00:00Z"))
    }

    @Test func mondayOpensItsOwnWeek() {
        let week = StatsMath.weekInterval(containing: at("2026-08-03T00:30:00Z"), calendar: statsCalendar)
        #expect(week.start == startOfDay("2026-08-03T00:00:00Z"))
    }

    @Test func everyDayMondayThroughSundayResolvesToOneWeek() {
        for offset in 0..<7 {
            let day = statsCalendar.date(byAdding: .day, value: offset, to: at("2026-08-03T09:00:00Z"))!
            let week = StatsMath.weekInterval(containing: day, calendar: statsCalendar)
            #expect(week.start == startOfDay("2026-08-03T00:00:00Z"))
        }
    }

    /// The Sunday before is the PREVIOUS week, not this one.
    @Test func precedingSundayFallsInThePreviousWeek() {
        let week = StatsMath.weekInterval(containing: at("2026-08-02T12:00:00Z"), calendar: statsCalendar)
        #expect(week.start == startOfDay("2026-07-27T00:00:00Z"))
    }
}

struct StatsMathBarScaleTests {

    /// A fixed 9-hour ceiling pegged every bar on the org dashboard, where each
    /// bar sums the whole shop.
    @Test func chartScalesToItsOwnTallestBar() {
        #expect(StatsMath.barMax([8, 6, 7.5, 4]) == 8)
        #expect(StatsMath.barMax([120, 96, 140, 88]) == 140)
    }

    @Test func emptyWeekFloorsAtOne() {
        #expect(StatsMath.barMax([]) == 1)
        #expect(StatsMath.barMax([0, 0, 0]) == 1)
    }
}
