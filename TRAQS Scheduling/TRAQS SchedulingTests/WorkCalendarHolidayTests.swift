import Testing
import Foundation
@testable import TRAQS_Scheduling

// One working calendar (scheduleRules.js `workCalendar`): a day works when it is in
// the org's `workDays` (empty → Mon–Fri) AND not in `holidays`. These are the iOS
// places that used to read `workDays` alone, so a holiday was a working day on the
// Schedule page, the Tasks strip, and when a reopened job was pulled forward.
@Suite("Work calendar holidays")
struct WorkCalendarHolidayTests {

    private var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    /// 2026-08-<d> at noon UTC — Mon 2026-08-03.
    private func day(_ d: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 8; c.day = d; c.hour = 12
        c.timeZone = TimeZone(identifier: "UTC")
        return cal.date(from: c)!
    }

    private func org(workDays: [Int] = [1, 2, 3, 4, 5], holidays: [String] = []) -> OrgSettings {
        var s = OrgSettings.default
        s.workDays = workDays
        s.holidays = holidays
        return s
    }

    // MARK: GanttView / TasksView predicate

    @Test func theSchedulePredicateSkipsAHoliday() {
        let o = org(holidays: ["2026-08-05"])
        #expect(GanttView.isWorkDay(day(4), org: o, in: cal))
        #expect(!GanttView.isWorkDay(day(5), org: o, in: cal))    // the holiday
        #expect(!GanttView.isWorkDay(day(8), org: o, in: cal))    // Saturday
    }

    // Empty used to show all seven days on the Schedule page; it is Mon–Fri now,
    // the same as WorkCalendar everywhere else.
    @Test func anEmptyWorkWeekIsMondayToFriday() {
        let o = org(workDays: [])
        #expect(GanttView.isWorkDay(day(3), org: o, in: cal))
        #expect(!GanttView.isWorkDay(day(9), org: o, in: cal))    // Sunday
    }

    // MARK: The reopen shift

    private let workCal = WorkCalendar()

    // A Mon–Fri range moved to a Wednesday keeps its five working days: Wed → the
    // next Tue. A calendar-day shift ended it on a Sunday, three working days long.
    @Test func aReopenedRangeKeepsItsWorkingDays() {
        let moved = workCal.shiftingRange(start: "2026-08-03", end: "2026-08-07",
                                          from: "2026-08-03", to: "2026-08-12")
        #expect(moved.start == "2026-08-12")
        #expect(moved.end == "2026-08-18")
        #expect(workCal.workDaysInclusive(from: moved.start, through: moved.end) == 5)
    }

    @Test func aReopenedRangeSkipsAHoliday() {
        let withHoliday = WorkCalendar(workDays: [1, 2, 3, 4, 5], holidays: ["2026-08-13"])
        let moved = withHoliday.shiftingRange(start: "2026-08-03", end: "2026-08-07",
                                              from: "2026-08-03", to: "2026-08-12")
        #expect(moved.start == "2026-08-12")
        #expect(moved.end == "2026-08-19")
        #expect(withHoliday.workDaysInclusive(from: moved.start, through: moved.end) == 5)
    }

    // A child keeps its working-day offset from the job's earliest date: Wed–Thu,
    // two working days in, lands Fri → Mon.
    @Test func aChildRangeKeepsItsOffset() {
        let moved = workCal.shiftingRange(start: "2026-08-05", end: "2026-08-06",
                                          from: "2026-08-03", to: "2026-08-12")
        #expect(moved.start == "2026-08-14")
        #expect(moved.end == "2026-08-17")
    }

    // A target that isn't a working day starts on the next one that is; an
    // unscheduled end stays unscheduled.
    @Test func aWeekendTargetStartsMonday() {
        let moved = workCal.shiftingRange(start: "2026-08-03", end: "",
                                          from: "2026-08-03", to: "2026-08-15")
        #expect(moved.start == "2026-08-17")
        #expect(moved.end == "")
    }
}
