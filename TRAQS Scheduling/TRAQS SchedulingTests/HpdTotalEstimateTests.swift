import Testing
import Foundation
@testable import TRAQS_Scheduling

/// `hpd` is a unit's TOTAL estimated productive hours for the whole team — not a
/// per-day rate. A person's share is `hpd / teamSize`, a day is the org's
/// PRODUCTIVE hours, and 0 (or absent) means unestimated: no invented 7.5.
@Suite("hpd is a total estimate") @MainActor
struct HpdTotalEstimateTests {

    /// 07:00–16:00, breaks at 09:00 and 14:00 (15m), lunch at 12:00 (1h) — a
    /// 7.5-hour productive day.
    private var day: DayWindow {
        WorkDayClock.day(workStart: 7, workEnd: 16,
                         breaks: [OrgBreak(time: "09:00", durationMinutes: 15),
                                  OrgBreak(time: "14:00", durationMinutes: 15)],
                         lunch: OrgBreak(time: "12:00", durationMinutes: 60))
    }

    private func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.001 }

    // MARK: JobShifts walks the person's share

    @Test func aTwoPersonUnitWalksHalfItsHours() {
        #expect(near(JobShifts.share(hpd: 6, teamCount: 2, day: day), 3))
        // 3h from 07:00: two hours, the 09:00 break, one more → 10:15.
        let w = JobShifts.window(startHour: 7, hpd: 6, teamCount: 2, day: day)
        #expect(w.start == 7)
        #expect(near(w.end, 10.25), "got \(w.end)")
    }

    @Test func eachPersonOnATwoPersonOpGetsTheHalfWindow() {
        var panel = Panel.empty(title: "P")
        panel.start = "2026-10-01"; panel.end = "2026-10-01"
        var op = Operation.empty(title: "Wire", hpd: 6)
        op.start = "2026-10-01"; op.end = "2026-10-01"; op.team = ["a", "b"]
        op.extras.set("startHour", .number(7))
        panel.subs = [op]
        let job = Job(id: "j", title: "J", start: "2026-10-01", end: "2026-10-01", subs: [panel])
        let shifts = JobShifts.all(in: [job], day: day)
        #expect(shifts.count == 2)
        #expect(shifts.allSatisfy { near($0.endHour, 10.25) })
    }

    @Test func anUnestimatedUnitIsOneProductiveDay() {
        #expect(near(JobShifts.share(hpd: 0, teamCount: 3, day: day), 7.5))
        let w = JobShifts.window(startHour: nil, hpd: 0, teamCount: 3, day: day)
        #expect(w.start == 7 && near(w.end, 16))
    }

    @Test func aShareLongerThanTheDayStillEndsAtQuittingTime() {
        // 30h for two is 15h each — two days, so each day's window ends at 16:00.
        let w = JobShifts.window(startHour: 7, hpd: 30, teamCount: 2, day: day)
        #expect(near(w.end, 16))
    }

    // MARK: Gantt
    //
    // The gantt's share and placement are GanttLayout's now — the web's day-view rule, held to
    // the web by ScheduleParityTests (shares included) and GanttLayoutTests. The roll-forward
    // packer these tests covered (SchedulePacker) is gone, with its separate day capacity.

    // MARK: durationDays

    @Test func durationIsTheShareOverAProductiveDay() {
        #expect(JobsScheduler.durationDays(hpd: 30, teamSize: 2, productiveHoursPerDay: 7.5) == 2)
        #expect(JobsScheduler.durationDays(hpd: 7.6, teamSize: 1, productiveHoursPerDay: 7.5) == 2)
        #expect(JobsScheduler.durationDays(hpd: 0, teamSize: 2, productiveHoursPerDay: 7.5) == 1)
    }

    // MARK: Absent hpd stays absent

    private func object(_ value: some Encodable) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
    }

    @Test func anOpWithoutHpdRoundTripsWithoutIt() throws {
        let op = try JSONDecoder().decode(Operation.self,
                                          from: Data(#"{"id":"o","title":"Wire"}"#.utf8))
        #expect(op.hpd == 0, "absent is unestimated, not 7.5")
        #expect(try object(op)["hpd"] == nil)
    }

    @Test func anExplicitZeroHpdIsWrittenBackAsZero() throws {
        let op = try JSONDecoder().decode(Operation.self,
                                          from: Data(#"{"id":"o","title":"Wire","hpd":0}"#.utf8))
        #expect(op.hpd == 0)
        #expect(try object(op)["hpd"] as? Double == 0)
    }

    @Test func anAbsentHpdThatIsThenEstimatedIsWritten() throws {
        var op = try JSONDecoder().decode(Operation.self,
                                          from: Data(#"{"id":"o","title":"Wire"}"#.utf8))
        op.hpd = 4
        #expect(try object(op)["hpd"] as? Double == 4)
    }

    @Test func absenceIsNotAnEdit() throws {
        let absent = try JSONDecoder().decode(Operation.self,
                                              from: Data(#"{"id":"o","title":"Wire"}"#.utf8))
        let zero = try JSONDecoder().decode(Operation.self,
                                            from: Data(#"{"id":"o","title":"Wire","hpd":0}"#.utf8))
        #expect(absent == zero)
    }

    @Test func panelsAndJobsKeepAnAbsentHpdAbsentToo() throws {
        let job = try JSONDecoder().decode(Job.self, from: Data(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[]}]}
        """#.utf8))
        let obj = try object(job)
        #expect(obj["hpd"] == nil)
        let panel = (obj["subs"] as! [[String: Any]])[0]
        #expect(panel["hpd"] == nil)
    }
}
