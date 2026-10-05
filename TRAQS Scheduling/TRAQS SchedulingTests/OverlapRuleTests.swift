import Testing
import Foundation
@testable import TRAQS_Scheduling

// The shared overlap rule, on the SAME fixtures as scripts/overlap-test.mjs part 1
// — the ones the web's five old rules disagreed on. The JS and this port must
// give the same verdict on every one of them.
//
// 08:00–17:00, lunch 12:00 for 60 min → 8 productive hours; Mon–Fri; today is
// Wed 2026-09-30. Candidate X against existing Y, both person 7 unless said.
@Suite("Overlap rule") @MainActor
struct OverlapRuleTests {

    private let today = "2026-09-30"
    private let monday = "2026-10-05"

    private var context: OverlapRule.Context {
        OverlapRule.Context(
            day: WorkDayClock.day(workStart: 8, workEnd: 17, breaks: [],
                                  lunch: OrgBreak(time: "12:00", durationMinutes: 60)),
            calendar: WorkCalendar(workDays: [1, 2, 3, 4, 5], holidays: []),
            today: today)
    }

    /// One op, as the web stores it. Decoded rather than built, so `team` goes
    /// through the real flex-id decoding and `startHour` through extras.
    /// `status` is a parameter, never part of `fields`: written in both, the key appeared twice
    /// and Foundation keeps the FIRST, so a "Finished" op decoded as Not Started (#367).
    private func op(_ id: String, team: String = "[7]", status: String = "Not Started", _ fields: String) -> String {
        #"{"id":"\#(id)","title":"\#(id)","team":\#(team),"status":"\#(status)",\#(fields)}"#
    }

    private func job(_ ops: String...) -> [Job] {
        let json = #"{"id":"J","title":"Job","subs":[{"id":"P","title":"Panel","subs":["#
            + ops.joined(separator: ",") + "]}]}"
        return [try! JSONDecoder().decode(Job.self, from: json.data(using: .utf8)!)]
    }

    /// Which units X overlaps, by id — `hits` in the JS test.
    private func hits(_ jobs: [Job], _ candidateID: String = "X") -> [String] {
        let units = OverlapRule.occupyingUnits(in: jobs, context: context)
        guard let me = units.first(where: { $0.id == candidateID }) else { return ["<no X>"] }
        return OverlapRule.overlaps(me, with: units, context: context).map(\.other.id)
    }

    // MARK: The fixtures

    @Test func adjacentBlocksDoNotOverlap() {
        #expect(hits(job(op("Y", #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":2"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":10,"hpd":2"#))) == [])
    }

    @Test func intersectingBlocksOverlap() {
        #expect(hits(job(op("Y", #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":3"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":10,"hpd":2"#))) == ["Y"])
    }

    @Test func aGapOnTheSameDayIsNotAnOverlap() {
        #expect(hits(job(op("Y", #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":2"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":13,"hpd":2"#))) == [])
    }

    /// No `startHour` is the start of the working day, so both run from 08:00.
    @Test func sameDayWithNoHoursOverlaps() {
        #expect(hits(job(op("Y", #""start":"2026-10-05","end":"2026-10-05","hpd":4"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","hpd":4"#))) == ["Y"])
    }

    /// A Fri→Mon op does not occupy the weekend; an op put ON a Saturday does
    /// occupy it, and they still don't meet.
    @Test func friToMonDoesNotHoldTheWeekend() {
        let jobs = job(op("Y", #""start":"2026-10-03","end":"2026-10-03","startHour":8,"hpd":4"#),
                       op("X", #""start":"2026-10-02","end":"2026-10-05","hpd":16"#))
        #expect(hits(jobs) == [])
        let x = OverlapRule.occupyingUnits(in: jobs, context: context).first { $0.id == "X" }!
        #expect(OverlapRule.blocks(of: x, context: context) == [
            .init(day: "2026-10-02", start: 8, end: 17),
            .init(day: "2026-10-05", start: 8, end: 17)])
        let y = OverlapRule.occupyingUnits(in: jobs, context: context).first { $0.id == "Y" }!
        #expect(OverlapRule.blocks(of: y, context: context) == [.init(day: "2026-10-03", start: 8, end: 12)])
    }

    @Test func finishedWorkDoesNotTakePart() {
        #expect(hits(job(op("Y", status: "Finished", #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":4"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":9,"hpd":2"#))) == [])
    }

    @Test func historyDoesNotTakePart() {
        #expect(hits(job(op("Y", #""start":"2026-09-29","end":"2026-09-29","startHour":8,"hpd":4"#),
                         op("X", #""start":"2026-09-30","end":"2026-09-30","startHour":9,"hpd":2"#))) == [])
    }

    @Test func numericAndStringIDsAreOnePerson() {
        #expect(hits(job(op("Y", team: #"["7"]"#, #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":4"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":9,"hpd":2"#))) == ["Y"])
    }

    /// `hpd` is the whole team's: two people on 8 h is 4 h each, 08:00–12:00.
    @Test func aTeamMemberHoldsOnlyTheirShare() {
        let y = op("Y", team: #"[7,8]"#, #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":8"#)
        #expect(hits(job(y, op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":10,"hpd":2"#))) == ["Y"])
        #expect(hits(job(y, op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":13,"hpd":2"#))) == [])
    }

    /// A lock pins a unit; it does not free its time.
    @Test func lockedWorkTakesPart() {
        #expect(hits(job(op("Y", #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":4,"locked":true"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":9,"hpd":2"#))) == ["Y"])
    }

    @Test func tombstonedWorkDoesNotTakePart() {
        #expect(hits(job(op("Y", #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":4,"deletedAt":"2026-09-30T00:00:00Z""#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":9,"hpd":2"#))) == [])
    }

    @Test func differentPeopleNeverOverlap() {
        #expect(hits(job(op("Y", team: #"[8]"#, #""start":"2026-10-05","end":"2026-10-05","startHour":8,"hpd":4"#),
                         op("X", #""start":"2026-10-05","end":"2026-10-05","startHour":9,"hpd":2"#))) == [])
    }

    // MARK: Pieces

    /// Half-open: touching is not intersecting.
    @Test func blocksAreHalfOpen() {
        let a = [OverlapRule.Block(day: "2026-10-05", start: 8, end: 10)]
        #expect(OverlapRule.blocksOverlap(a, [.init(day: "2026-10-05", start: 10, end: 12)]) == nil)
        #expect(OverlapRule.blocksOverlap(a, [.init(day: "2026-10-05", start: 9, end: 12)])
                == .init(day: "2026-10-05", start: 9, end: 10))
        #expect(OverlapRule.blocksOverlap(a, [.init(day: "2026-10-06", start: 8, end: 10)]) == nil)
    }

    /// The walk steps over lunch: 4 h from 10:00 is 10–12 then 13–15.
    @Test func blocksWalkThroughLunch() {
        #expect(OverlapRule.blocks(start: monday, end: monday, startHour: 10, hours: 4, context: context)
                == [.init(day: monday, start: 10, end: 15)])
        // Unestimated is one productive day.
        #expect(OverlapRule.blocks(start: monday, end: monday, startHour: nil, hours: 0, context: context)
                == [.init(day: monday, start: 8, end: 17)])
    }
}
