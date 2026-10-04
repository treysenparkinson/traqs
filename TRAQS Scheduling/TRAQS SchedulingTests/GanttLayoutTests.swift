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

    /// #252, ruled 2026-10-04: finished work SHOWS, as on the web — a DONE bar is a record of
    /// what happened. Finished HISTORY is still hidden like any other history; deleted work is
    /// never drawn.
    @Test func finishedWorkIsDrawnDeletedWorkIsNot() {
        #expect(ids(jobs(panel(op("A", status: "Finished", todayOp)))) == ["A"])
        #expect(ids(jobs(panel(op("A", todayOp)), jobFields: #""status":"Finished""#)) == ["A"])
        #expect(ids(jobs(panel(op("A", status: "Finished", #""start":"2026-10-01","end":"2026-10-02","hpd":3"#)))) == [])
        #expect(ids(jobs(panel(op("A", todayOp + #","deletedAt":"2026-10-01""#), team: "[9]"))) == [])
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

// #250: the live hours a running job clock puts on its op — the web's sessionWorkedHours,
// in shop time. iOS used wall clock minus pauses, counted only on the start day.
@Suite("Live op hours")
struct LiveOpHoursTests {
    private func org(_ tz: String) -> OrgSettings {
        let json = #"{"workStart":"08:00","workEnd":"17:00","workDays":[1,2,3,4,5],"holidays":[],"#
            + #""lunch":{"time":"12:00","durationMinutes":60},"#
            + #""breaks":[{"time":"10:00","durationMinutes":15},{"time":"14:00","durationMinutes":15}],"#
            + #""timeZone":"\#(tz)"}"#
        return try! JSONDecoder().decode(OrgSettings.self, from: json.data(using: .utf8)!)
    }
    private func person(_ clock: String) -> Person {
        try! JSONDecoder().decode(Person.self, from: #"{"id":"7","name":"W","userRole":"user","activeJobClock":\#(clock)}"#.data(using: .utf8)!)
    }
    private func at(_ iso: String) -> Date { Date.fromFlexibleISO8601(iso)! }

    /// Friday 14:00 → Monday 10:00 in Denver, nobody clocked out: the session stops at Friday's
    /// quitting time. 14:00–17:00 less the 14:00 break is 2.75 h — not the 92 h of wall clock.
    @Test func aClockLeftOpenOverTheWeekendStopsAtQuittingTime() {
        let p = person(#"{"clockIn":"2026-10-09T20:00:00.000Z","jobId":"J","opId":"X"}"#)
        let h = SessionHours.live(opId: "X", people: [p], now: at("2026-10-12T16:00:00.000Z"), org: org("America/Denver"))
        #expect(abs(h - 2.75) < 1e-9)
    }

    /// Across lunch: 09:00–15:00 is 6 h of wall clock, 4.5 h of work.
    @Test func lunchAndBreaksComeOff() {
        let p = person(#"{"clockIn":"2026-10-05T15:00:00.000Z","jobId":"J","opId":"X"}"#)
        let h = SessionHours.live(opId: "X", people: [p], now: at("2026-10-05T21:00:00.000Z"), org: org("America/Denver"))
        #expect(abs(h - 4.5) < 1e-9)
    }

    /// A held clock stops at the hold, whatever the time now.
    @Test func aHeldClockStopsAtTheHold() {
        let held = Date.fromFlexibleISO8601("2026-10-05T16:30:00.000Z")!.timeIntervalSince1970 * 1000
        let p = person(#"{"clockIn":"2026-10-05T14:00:00.000Z","jobId":"J","opId":"X","frozenAtMs":\#(Int(held))}"#)
        let h = SessionHours.live(opId: "X", people: [p], now: at("2026-10-05T22:00:00.000Z"), org: org("America/Denver"))
        #expect(abs(h - 2.25) < 1e-9)   // 08:00–10:30 less the 10:00 break
    }

    /// The shop's zone, not the device's: the same instants in a New York shop are two hours
    /// later on its clock — 11:00–17:00, less lunch and one break.
    @Test func theShopsZoneDecidesTheWorkingDay() {
        let p = person(#"{"clockIn":"2026-10-05T15:00:00.000Z","jobId":"J","opId":"X"}"#)
        let h = SessionHours.live(opId: "X", people: [p], now: at("2026-10-05T21:00:00.000Z"), org: org("America/New_York"))
        #expect(abs(h - 4.75) < 1e-9)
    }
}

// #306 and #264/#307: what an org that leaves things out gets.
@Suite("Org fallbacks")
struct OrgFallbackTests {
    private func org(_ json: String) -> OrgSettings {
        try! JSONDecoder().decode(OrgSettings.self, from: json.data(using: .utf8)!)
    }

    /// #306: a malformed day falls back to the org defaults (07:00–15:00, 30-min lunch) — 7.5
    /// paid hours, not a flat 8. (Paid hours keep breaks; productive hours do not.)
    @Test func malformedHoursFallBackToTheOrgDefaults() {
        let o = org(#"{"workStart":"nonsense","workEnd":"","lunch":{"time":"12:00","durationMinutes":30}}"#)
        #expect(o.paidHoursPerDay == 7.5)
        // No `breaks` key is the default 10:00 break too, as `withOrgDefaults` fills it.
        #expect(o.productiveHoursPerDay == 7.25)
    }

    /// #264/#307: a break with no length is no break; a lunch with no length is 30 minutes.
    @Test func aBreakWithNoLengthIsNoBreak() {
        let o = org(#"{"workStart":"08:00","workEnd":"16:00","lunch":{"time":"12:00"},"breaks":[{"time":"10:00"}]}"#)
        #expect(o.lunch.durationMinutes == 30)
        #expect(o.breaks.map(\.durationMinutes) == [0])
        #expect(o.productiveHoursPerDay == 7.5)
    }
}
