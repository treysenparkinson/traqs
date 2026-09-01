import Testing
import Foundation
@testable import TRAQS_Scheduling

/// The Analytics page's Week / Pay Period window.
///
/// All three of these fail SILENTLY if they're wrong — no crash, no empty
/// screen, just numbers that are quietly off — which is exactly why they're out
/// of the view and under test:
///
///   • the half-open conversion drops payday from every figure on the page,
///   • the capacity denominator doubles everyone's utilization,
///   • the row split drops or duplicates a day.
struct StatsRangeTests {

    private var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    /// 2026-08-<d> — Mon 2026-08-03 … Sun 2026-08-16 is a clean two-week span.
    private func day(_ d: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 8; c.day = d
        c.timeZone = TimeZone(identifier: "UTC")
        return cal.date(from: c)!
    }

    // MARK: payPeriodInterval — the convention mismatch

    // `payPeriodWindow` names the last DAY; the page compares `d < end`. The
    // conversion has to push past that day, or the 14th is missing from
    // everything: efficiency, idle, task switching, the lot.
    @Test func theLastDayOfThePeriodIsInsideTheInterval() {
        let i = StatsMath.payPeriodInterval(start: day(3), endInclusive: day(16), calendar: cal)
        #expect(i.contains(day(16)))                       // payday itself
        #expect(i.contains(cal.date(byAdding: .hour, value: 23, to: day(16))!))
        #expect(!i.contains(day(17)))                      // and nothing beyond it
    }

    @Test func theIntervalCoversExactlyFourteenDays() {
        let i = StatsMath.payPeriodInterval(start: day(3), endInclusive: day(16), calendar: cal)
        #expect(cal.dateComponents([.day], from: i.start, to: i.end).day == 14)
    }

    // A window naming one day is one day long, not zero.
    @Test func aSingleDayPeriodIsNotEmpty() {
        let i = StatsMath.payPeriodInterval(start: day(3), endInclusive: day(3), calendar: cal)
        #expect(cal.dateComponents([.day], from: i.start, to: i.end).day == 1)
        #expect(i.contains(day(3)))
    }

    // Times of day on the boundaries must not leak in: the window is whole days.
    @Test func boundariesAreNormalisedToWholeDays() {
        let midMorning = cal.date(byAdding: .hour, value: 10, to: day(3))!
        let lateEvening = cal.date(byAdding: .hour, value: 22, to: day(16))!
        let i = StatsMath.payPeriodInterval(start: midMorning, endInclusive: lateEvening, calendar: cal)
        #expect(i.start == day(3))
        #expect(i.end == day(17))
    }

    // MARK: workDayCount — the utilization denominator

    private let monToFri: Set<Int> = [1, 2, 3, 4, 5]   // JS dow: Sun=0 … Sat=6

    // The regression guard: a full week has to keep returning exactly what the
    // old hardcoded `workDays.count` returned, or switching to Pay Period would
    // have moved Week's numbers too.
    @Test func aFullWeekStillCountsFiveWorkDays() {
        let week = StatsMath.weekInterval(containing: day(5), calendar: cal)
        #expect(StatsMath.workDayCount(in: week, workDays: monToFri, calendar: cal) == 5)
    }

    // And the reason this function exists: a fortnight is TEN work days, so
    // capacity doubles with the window instead of staying a single week's.
    @Test func aTwoWeekPeriodCountsTenWorkDays() {
        let i = StatsMath.payPeriodInterval(start: day(3), endInclusive: day(16), calendar: cal)
        #expect(StatsMath.workDayCount(in: i, workDays: monToFri, calendar: cal) == 10)
    }

    @Test func weekendsAreExcludedAndSixDayShopsCounted() {
        let i = StatsMath.payPeriodInterval(start: day(8), endInclusive: day(9), calendar: cal)
        #expect(StatsMath.workDayCount(in: i, workDays: monToFri, calendar: cal) == 0)  // Sat+Sun
        let sixDay: Set<Int> = [1, 2, 3, 4, 5, 6]
        #expect(StatsMath.workDayCount(in: i, workDays: sixDay, calendar: cal) == 1)    // Sat counts
    }

    // A mis-saved workDays would otherwise divide by zero; the caller floors the
    // capacity, and this is the value it floors.
    @Test func noConfiguredWorkDaysCountsZero() {
        let i = StatsMath.payPeriodInterval(start: day(3), endInclusive: day(16), calendar: cal)
        #expect(StatsMath.workDayCount(in: i, workDays: [], calendar: cal) == 0)
    }

    @Test func anEmptyIntervalCountsZero() {
        let empty = DateInterval(start: day(3), end: day(3))
        #expect(StatsMath.workDayCount(in: empty, workDays: monToFri, calendar: cal) == 0)
    }

    // MARK: chartRows — wrapping the efficiency bars

    @Test func aWeekStaysOnOneRow() {
        #expect(StatsMath.chartRows(Array(1...7), maxPerRow: 7) == [Array(1...7)])
        #expect(StatsMath.chartRows(Array(1...5), maxPerRow: 7).count == 1)
    }

    @Test func aFortnightSplitsIntoTwoSevens() {
        let rows = StatsMath.chartRows(Array(1...14), maxPerRow: 7)
        #expect(rows.count == 2)
        #expect(rows[0] == Array(1...7))
        #expect(rows[1] == Array(8...14))
    }

    // Semi-monthly periods are 15 or 16 days. The larger half goes first, and
    // nothing may be lost in the division.
    @Test func anOddPeriodPutsTheLargerHalfFirstAndKeepsEveryDay() {
        for n in [15, 16, 31] {
            let rows = StatsMath.chartRows(Array(1...n), maxPerRow: 7)
            #expect(rows.count == 2)
            #expect(rows[0].count >= rows[1].count)
            #expect(rows.flatMap { $0 } == Array(1...n))   // nothing dropped or duplicated
        }
    }

    @Test func anEmptySeriesIsOneEmptyRow() {
        let rows = StatsMath.chartRows([Int](), maxPerRow: 7)
        #expect(rows.count == 1)
        #expect(rows[0].isEmpty)
    }
}
