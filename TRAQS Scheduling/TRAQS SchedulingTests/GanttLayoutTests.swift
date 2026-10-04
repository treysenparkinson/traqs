import Testing
import Foundation
@testable import TRAQS_Scheduling

// The iOS gantt's two questions, one per defect of chunk A:
//   which units are on my timeline — getPersonBars' task rules (TRAQS.jsx), ported;
//   where each sits on a day — dayViewBlocks (statsMath.js), via ScheduleParityTests' fixture,
//   plus the named regressions below.
//
// Matrix's day: 08:00–17:00, lunch 12:00 for 60 min, breaks 10:00 and 14:00 for 15 → 7.5
// productive hours. Today is Wed 2026-10-07.
@Suite("Gantt layout")
struct GanttLayoutTests {

    private let today = "2026-10-07"
    private let me = "7"

    private var context: OverlapRule.Context {
        OverlapRule.Context(
            day: WorkDayClock.day(workStart: 8, workEnd: 17,
                                  breaks: [OrgBreak(time: "10:00", durationMinutes: 15),
                                           OrgBreak(time: "14:00", durationMinutes: 15)],
                                  lunch: OrgBreak(time: "12:00", durationMinutes: 60)),
            calendar: WorkCalendar(workDays: [1, 2, 3, 4, 5], holidays: []),
            today: today)
    }

    /// One op, as the web stores it — decoded, so `team` and `startHour` go through the real
    /// flex-id decoding and extras.
    private func op(_ id: String, team: String = "[7]", status: String = "Not Started", _ fields: String) -> String {
        #"{"id":"\#(id)","title":"\#(id)","team":\#(team),"status":"\#(status)",\#(fields)}"#
    }
    private func panel(_ ops: String..., id: String = "P", team: String = "[7]",
                       fields: String = #""start":"2026-10-07","end":"2026-10-07","hpd":4"#) -> String {
        #"{"id":"\#(id)","title":"\#(id)","team":\#(team),"status":"Not Started",\#(fields),"subs":["#
            + ops.joined(separator: ",") + "]}"
    }
    private func jobs(_ panels: String..., jobFields: String = #""status":"Not Started""#) -> [Job] {
        let json = #"{"id":"J","title":"Job",\#(jobFields),"subs":["# + panels.joined(separator: ",") + "]}"
        return [try! JSONDecoder().decode(Job.self, from: json.data(using: .utf8)!)]
    }
    private func ids(_ js: [Job], live: Set<String> = []) -> [String] {
        GanttLayout.units(for: me, in: js, live: live, today: today).map(\.unit.id)
    }
    private let todayOp = #""start":"2026-10-07","end":"2026-10-07","hpd":3"#

    // MARK: Which units — getPersonBars

    @Test func myOpIsOnMyTimelineAndOthersAreNot() {
        #expect(ids(jobs(panel(op("A", todayOp), op("B", team: "[9]", todayOp)))) == ["A"])
    }

    /// #241: a panel I'm on whose live ops all belong to other people is NOT my work. It drew
    /// as one bar holding the panel's whole estimate — the 75-hour bar.
    @Test func aPanelWhoseLiveOpsAreOthersIsNotMine() {
        #expect(ids(jobs(panel(op("B", team: "[9]", todayOp), team: "[7]"))) == [])
    }

    @Test func aPanelImOnWithNoOpsIsMine() {
        #expect(ids(jobs(panel(team: "[7]"))) == ["P"])
    }

    @Test func aPanelWhoseOpsAreAllDeletedIsMine() {
        #expect(ids(jobs(panel(op("B", team: "[9]", todayOp + #","deletedAt":"2026-09-01""#), team: "[7]"))) == ["P"])
    }

    @Test func finishedAndDeletedWorkIsNotDrawn() {
        #expect(ids(jobs(panel(op("A", status: "Finished", todayOp)))) == [])
        #expect(ids(jobs(panel(op("A", todayOp + #","deletedAt":"2026-10-01""#), team: "[9]"))) == [])
        #expect(ids(jobs(panel(op("A", todayOp)), jobFields: #""status":"Finished""#)) == [])
    }

    @Test func undatedWorkIsNotDrawn() {
        #expect(ids(jobs(panel(op("A", #""start":"","end":"","hpd":3"#)))) == [])
    }

    /// #248: history is hidden, not rolled forward — unless someone is clocked into it.
    @Test func historyIsHiddenUnlessClockedIn() {
        let past = jobs(panel(op("A", #""start":"2026-10-01","end":"2026-10-06","hpd":40"#)))
        #expect(ids(past) == [])
        #expect(ids(past, live: ["A"]) == ["A"])
    }

    // MARK: Where — the day view's Business rule

    private func unit(_ id: String, _ start: String, _ end: String, startHour: Double? = nil,
                      hpd: Double, team: [String] = ["7"]) -> OverlapRule.Unit {
        OverlapRule.Unit(id: id, start: start, end: end, startHour: startHour, hpd: hpd, team: team)
    }
    private func place(_ units: [OverlapRule.Unit], on day: String = "2026-10-07") -> [[Double]] {
        GanttLayout.dayBlocks(units, on: day, context: context, business: true).map { [$0.start, $0.end] }
    }

    /// #243: a stored startHour places the bar. The gantt used to start everything at workStart.
    @Test func storedStartHourIsHonoured() {
        #expect(place([unit("A", "2026-10-07", "2026-10-07", startHour: 13, hpd: 2)]) == [[13, 15.25]])
    }

    /// #244: the 10:00 break is stepped over, not walked through. 3 h from 08:00 is 11:15.
    @Test func breaksAreSteppedOver() {
        #expect(place([unit("A", "2026-10-07", "2026-10-07", hpd: 3)]) == [[8, 11.25]])
    }

    /// #240 and #238: my share of a two-person 6 h op is 3 h — the team total ÷ team.
    @Test func aBarIsMyShareOfTheTeamTotal() {
        #expect(place([unit("A", "2026-10-07", "2026-10-07", hpd: 6, team: ["7", "9"])]) == [[8, 11.25]])
    }

    /// #245: a day holds 7.5 productive hours, not 8. Two 4 h ops: the second stops at quitting
    /// time instead of running half an hour into a day that doesn't have it.
    @Test func aDayHoldsItsProductiveHours() {
        #expect(place([unit("A", "2026-10-07", "2026-10-07", hpd: 4),
                       unit("B", "2026-10-07", "2026-10-07", hpd: 4)]) == [[8, 13.25], [13.25, 17]])
    }

    /// #247: nothing rolls onto later days. A one-day op too big for its day stays on its day.
    @Test func overflowDoesNotRollForward() {
        let big = [unit("A", "2026-10-07", "2026-10-07", hpd: 30)]
        #expect(place(big) == [[8, 17]])
        #expect(place(big, on: "2026-10-08") == [])
    }

    /// A preferred hour another bar already holds is pushed past it, never overlapped.
    @Test func aTakenHourIsPushedNotOverlapped() {
        #expect(place([unit("A", "2026-10-07", "2026-10-07", startHour: 8, hpd: 2),
                       unit("B", "2026-10-07", "2026-10-07", startHour: 9, hpd: 1)]) == [[8, 10], [10, 11.25]])
    }
}
