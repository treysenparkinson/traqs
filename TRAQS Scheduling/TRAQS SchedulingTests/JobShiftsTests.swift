import Testing
import Foundation
@testable import TRAQS_Scheduling

@Suite("Job shifts") @MainActor
struct JobShiftsTests {

    /// 07:00–16:00, breaks at 09:00 and 14:00 (15m), lunch at 12:00 (1h).
    private var day: DayWindow {
        WorkDayClock.day(workStart: 7, workEnd: 16,
                         breaks: [OrgBreak(time: "09:00", durationMinutes: 15),
                                  OrgBreak(time: "14:00", durationMinutes: 15)],
                         lunch: OrgBreak(time: "12:00", durationMinutes: 60))
    }

    private func simple(_ title: String, _ team: [String], _ start: String, _ end: String,
                        from: Double = 7, to: Double = 11, fullDays: Bool = false) -> Job {
        SimpleJob.makeJob(.init(title: title, team: team, start: start, end: end,
                                startHour: from, endHour: to, fullDays: fullDays),
                          day: day, color: "#123456", createdBy: nil)
    }

    @Test func aSimpleJobIsOneShiftPerPersonAtItsTimes() {
        let shifts = JobShifts.all(in: [simple("Install", ["a", "b"], "2026-10-01", "2026-10-01", from: 8, to: 12)],
                                   day: day)
        #expect(shifts.map(\.personId) == ["a", "b"])
        #expect(shifts[0].startHour == 8)
        #expect(abs(shifts[0].endHour - 12) < 0.001, "8→12 walks back to 12 through the 09:00 break")
    }

    @Test func aFullDayRunsToQuittingTime() {
        let s = JobShifts.all(in: [simple("Build", ["a"], "2026-10-01", "2026-10-03")], day: day)[0]
        #expect(s.startHour == 7 && abs(s.endHour - 16) < 0.001)
        #expect(!s.isOneDay)
    }

    @Test func sameDaysFindsOverlapsAndSkipsTheViewer() {
        let jobs = [
            simple("Mine", ["me", "a"], "2026-10-02", "2026-10-02"),
            simple("Other", ["b"], "2026-10-01", "2026-10-03"),
            simple("Earlier", ["c"], "2026-09-28", "2026-09-30"),
        ]
        let found = JobShifts.sameDays(JobShifts.all(in: jobs, day: day),
                                       start: "2026-10-02", end: "2026-10-02", excluding: "me")
        #expect(found.map(\.personId) == ["b", "a"], "earliest start first; c doesn't overlap")
    }

    @Test func opsClaimTheirCrewAndThePanelKeepsTheRest() {
        var panel = Panel.empty(title: "P1")
        panel.start = "2026-10-01"; panel.end = "2026-10-01"; panel.team = ["a", "b"]
        var op = Operation.empty(title: "Wire", hpd: 2)
        op.start = "2026-10-01"; op.end = "2026-10-01"; op.team = ["a"]
        panel.subs = [op]
        let job = Job(id: "j", title: "J", start: "2026-10-01", end: "2026-10-01", subs: [panel])
        let shifts = JobShifts.all(in: [job], day: day)
        #expect(Set(shifts.map(\.id)) == ["a/\(op.id)", "b/\(panel.id)"])
    }

    @Test func labels() {
        #expect(JobShifts.hourLabel(13.5) == "1:30 PM")
        #expect(JobShifts.hourLabel(0) == "12:00 AM")
        #expect(JobShifts.hourLabel(12) == "12:00 PM")
    }

    @Test func oneDayOffMeansFullDaysEvenOnOneDate() {
        let job = simple("Solo", ["a"], "2026-10-01", "2026-10-01", from: 13, to: 14, fullDays: true)
        #expect(abs(job.subs[0].hpd - day.productiveHours) < 0.001)
        #expect(JobShifts.startHour(job.subs[0].extras) == 7)
    }
}
