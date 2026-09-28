import Testing
import Foundation
@testable import TRAQS_Scheduling

@Suite("Simple job")
struct SimpleJobTests {

    /// 07:00–16:00, breaks at 09:00 and 14:00 (15m), lunch at 12:00 (1h).
    private var day: DayWindow {
        WorkDayClock.day(workStart: 7, workEnd: 16,
                         breaks: [OrgBreak(time: "09:00", durationMinutes: 15),
                                  OrgBreak(time: "14:00", durationMinutes: 15)],
                         lunch: OrgBreak(time: "12:00", durationMinutes: 60))
    }

    private func draft(start: String = "2026-10-01", end: String = "2026-10-01",
                       from: Double = 7, to: Double = 11) -> SimpleJob.Draft {
        .init(title: "  Cabinet install ", team: ["p1", "p2"],
              start: start, end: end, startHour: from, endHour: to)
    }

    private func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.001 }

    // MARK: Productive hours

    @Test func onlyTheBreaksTheSpanReachesComeOff() {
        // 07–11 crosses the 09:00 break only.
        #expect(near(WorkDayClock.productiveHours(from: 7, to: 11, in: day), 3.75))
        // 11:30–12:30 takes half the lunch.
        #expect(near(WorkDayClock.productiveHours(from: 11.5, to: 12.5, in: day), 0.5))
        // The whole day is the whole productive day.
        #expect(near(WorkDayClock.productiveHours(from: 7, to: 16, in: day), 7.5))
    }

    @Test func spansAreClippedToTheWorkingDay() {
        #expect(near(WorkDayClock.productiveHours(from: 5, to: 8, in: day), 1))
        #expect(near(WorkDayClock.productiveHours(from: 17, to: 19, in: day), 0))
    }

    @Test func productiveHoursIsTheInverseOfTheWalk() {
        let hpd = WorkDayClock.productiveHours(from: 8, to: 15, in: day)
        #expect(near(WorkDayClock.walk(from: 8, hours: hpd, in: day).endHour, 15))
    }

    // MARK: The job

    @Test func oneDayTaskKeepsItsTimes() {
        let job = SimpleJob.makeJob(draft(), day: day, color: "#123456", createdBy: "me")
        let sub = job.subs[0]
        #expect(job.title == "Cabinet install")
        #expect(job.jobType == "general")
        #expect(job.projectManagerId == "me")
        #expect(job.subs.count == 1 && sub.subs.isEmpty)
        #expect(sub.team == ["p1", "p2"])
        #expect(sub.start == "2026-10-01" && sub.end == "2026-10-01")
        #expect(near(sub.hpd, 3.75))
        #expect(sub.extras["startHour"] == .number(7))
        #expect(sub.extras["color"] == .string("#123456"))
    }

    @Test func multiDayTaskIsFullDaysFromTheStartOfTheDay() {
        let job = SimpleJob.makeJob(draft(end: "2026-10-03", from: 13, to: 14),
                                    day: day, color: "#123456", createdBy: nil)
        let sub = job.subs[0]
        #expect(job.start == "2026-10-01" && job.end == "2026-10-03")
        #expect(sub.end == "2026-10-03")
        #expect(near(sub.hpd, 7.5))
        #expect(sub.extras["startHour"] == .number(7))
    }

    @Test func aTinyWindowStillSchedulesAQuarterHour() {
        // Entirely inside lunch: nothing productive, floored like the web.
        let job = SimpleJob.makeJob(draft(from: 12, to: 12.5), day: day,
                                    color: "#123456", createdBy: nil)
        #expect(near(job.subs[0].hpd, 0.25))
    }

    @Test func idsLookLikeTheWebs() {
        let id = SimpleJob.newId()
        #expect(id.count == 9 && id.hasPrefix("t"))
    }
}
