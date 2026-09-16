import Testing
import Foundation
@testable import TRAQS_Scheduling

// `buildDayWindows` and `walkProductiveHours` — the arithmetic every bar on the
// Schedule page is drawn from. A bar's width, its end hour, and whether it fits
// the day it starts in are all this, so it is worth more tests than its size
// suggests: the naive version of it already shipped once and clipped bars onto
// the following Monday.
@Suite("Work-day clock")
struct WorkDayClockTests {

    /// The shape the source's own comments use: a 9-hour day (07:00–16:00) with
    /// two 15-minute breaks and an hour of lunch → 7.5 productive hours painted
    /// across 9 hours of width.
    private var breaks: [OrgBreak] {
        [OrgBreak(time: "09:00", durationMinutes: 15),
         OrgBreak(time: "14:00", durationMinutes: 15)]
    }
    private var lunch: OrgBreak { OrgBreak(time: "12:00", durationMinutes: 60) }
    private var day: DayWindow {
        WorkDayClock.day(workStart: 7, workEnd: 16, breaks: breaks, lunch: lunch)
    }
    /// A lunch of zero, to isolate a case from the implicit one — see
    /// `aMissingLunchIsStillAnHourAtNoon`.
    private var noLunch: OrgBreak { OrgBreak(time: "12:00", durationMinutes: 0) }

    private func near(_ a: Double, _ b: Double, _ tol: Double = 0.001) -> Bool {
        abs(a - b) < tol
    }

    // MARK: The day

    @Test func theDayIsWidthMinusItsBreaks() {
        #expect(near(day.totalHours, 9))
        #expect(near(day.deadHours, 1.5))
        #expect(near(day.productiveHours, 7.5))
        #expect(day.dead.map(\.start) == [9, 12, 14])
    }

    /// "An op whose hpd equals productiveHoursPerDay always ends exactly at
    /// workEnd and fills the column." Everything else is built on this holding.
    @Test func aFullDayFillsExactlyOneColumn() {
        let full = WorkDayClock.walk(from: 7, hours: day.productiveHours, in: day)
        #expect(full.days == 1)
        #expect(near(full.endHour, 16))
        #expect(near(full.columns, 1))
    }

    // MARK: Stepping over breaks

    /// THE BUG THIS REPLACED. A flat pro-rate gave a one-hour task about seven
    /// minutes of a lunch it never reaches, which was enough to spill it onto a
    /// second day — over a weekend, for anything late on a Friday.
    @Test func aShortTaskDoesNotInheritABreakItNeverReaches() {
        let short = WorkDayClock.walk(from: 7, hours: 1, in: day)
        #expect(short.days == 1)
        #expect(near(short.endHour, 8))
        #expect(near(short.columns, 1.0 / 9.0))
    }

    @Test func workThatReachesABreakStepsOverIt() {
        // 2h from 08:00 → 1h of work, the 09:00–09:15 break, then 1h more.
        #expect(near(WorkDayClock.walk(from: 8, hours: 2, in: day).endHour, 10.25))
        // Exactly 1h stops AT the break's edge rather than past it.
        #expect(near(WorkDayClock.walk(from: 8, hours: 1, in: day).endHour, 9))
        // A minute past it lands a minute past the break.
        #expect(near(WorkDayClock.walk(from: 8, hours: 1.9, in: day).endHour, 10.15))
    }

    // MARK: Rolling forward

    @Test func workRollsToTheNextDayWhenTheDayRunsOut() {
        let two = WorkDayClock.walk(from: 7, hours: day.productiveHours * 2, in: day)
        #expect(two.days == 2)
        #expect(near(two.endHour, 16))
        #expect(near(two.columns, 2))
    }

    /// Three and a half PRODUCTIVE days is NOT three and a half columns. The last
    /// 3.75 hours run 07:00 → 11:00 because the 09:00 break sits inside them —
    /// four ninths of a nine-hour column. Columns are wall-clock width; hours are
    /// productive time, and conflating the two is the whole bug above.
    @Test func halfADayOfHoursIsNotHalfAColumn() {
        let span = WorkDayClock.walk(from: 7, hours: day.productiveHours * 3.5, in: day)
        #expect(span.days == 4)
        #expect(near(span.endHour, 11))
        #expect(near(span.columns, 3 + 4.0 / 9.0))
    }

    @Test func startingLateCarriesTheRemainderIntoTomorrow() {
        // From 15:00 there is one hour of day left; the 14:00 break is behind us.
        let late = WorkDayClock.walk(from: 15, hours: 2, in: day)
        #expect(late.days == 2)
        #expect(near(late.endHour, 8))
    }

    // MARK: Configurations that should not break it

    @Test func noHoursIsOneDayAndNoWidth() {
        #expect(WorkDayClock.walk(from: 7, hours: 0, in: day)
                == WorkDayClock.Span(days: 1, endHour: 7, columns: 0))
    }

    /// A day configured with more break than day would otherwise make every bar
    /// infinitely long, so the day always keeps an hour of work in it.
    @Test func aDayOfNothingButBreakStillHasAnHourInIt() {
        let silly = WorkDayClock.day(workStart: 8, workEnd: 9,
                                     breaks: [OrgBreak(time: "08:00", durationMinutes: 600)],
                                     lunch: noLunch)
        #expect(near(silly.productiveHours, 1))
        #expect(WorkDayClock.walk(from: 8, hours: 40, in: silly).days > 1)
    }

    /// `lunch?.durationMinutes ?? 60` — a MISSING lunch is an hour at noon, not no
    /// lunch. Surprising enough to pin: it is what makes an org that never
    /// configured one still lose an hour a day.
    @Test func aMissingLunchIsStillAnHourAtNoon() {
        let implied = WorkDayClock.day(workStart: 8, workEnd: 16, breaks: [], lunch: nil)
        #expect(implied.dead == [DeadWindow(start: 12, duration: 1)])
    }

    /// An entry timed outside the working day is still time that comes off it —
    /// banked at the START, because parking it at the end would stop a full-day
    /// op short of quitting time and reopen the gap this exists to close.
    @Test func timeOutsideTheDayIsBankedAtItsStart() {
        let outside = WorkDayClock.day(workStart: 8, workEnd: 16,
                                       breaks: [OrgBreak(time: "22:00", durationMinutes: 60)],
                                       lunch: noLunch)
        #expect(near(outside.deadHours, 1))
        #expect(near(outside.dead.first?.start ?? -1, 8))
    }

    /// Overlapping entries merge — but the time lost to the overlap is not
    /// forgiven. The configured total comes off the day however badly the entries
    /// are placed, so the remainder is re-banked at the start.
    @Test func overlappingBreaksMergeWithoutLosingTheirTotal() {
        let overlap = WorkDayClock.day(workStart: 8, workEnd: 17,
                                       breaks: [OrgBreak(time: "12:00", durationMinutes: 60),
                                                OrgBreak(time: "12:30", durationMinutes: 60)],
                                       lunch: noLunch)
        #expect(overlap.dead.contains { near($0.start, 12) && near($0.end, 13.5) })
        #expect(near(overlap.deadHours, 2))
        #expect(overlap.dead.contains { near($0.start, 8) && near($0.duration, 0.5) })
    }
}
