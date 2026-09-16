import Testing
import Foundation
@testable import TRAQS_Scheduling

/// Roll-forward day packing.
///
/// The bug these pin down: the gantt used to pack every task overlapping a day
/// sequentially from workStart with NO cap, then grow the lane to fit. An
/// overbooked day therefore ran into the small hours. Capping it naively was the
/// original "missing jobs" bug — the overflow was silently discarded. The fix is
/// to defer the overflow to the next work day, so nothing is lost and the lane
/// stays inside org hours.
struct SchedulePackerTests {

    // Mon 2026-08-03 .. Sun 2026-08-09, so weekday arithmetic is unambiguous.
    private let cal = Calendar(identifier: .gregorian)

    private func day(_ d: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 8; c.day = d
        c.hour = 0; c.minute = 0; c.second = 0
        c.timeZone = TimeZone(identifier: "UTC")
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: c)!
    }

    /// Mon–Fri, matching the org default `workDays: [1,2,3,4,5]`.
    private func isWeekday(_ d: Date) -> Bool {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let dow = cal.component(.weekday, from: d) - 1   // Sun=0 … Sat=6
        return (1...5).contains(dow)
    }

    private func next(_ d: Date) -> Date? {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(byAdding: .day, value: 1, to: d)
    }

    private func allocate(_ tasks: [SchedulePacker.Task],
                          from: Date, through: Date,
                          keep: Set<Date>? = nil,
                          capacity: Double) -> [Date: [SchedulePacker.Slice]] {
        // Default: keep every day in range, so tests see the whole walk.
        var all: Set<Date> = []
        var d = from
        while d <= through { all.insert(d); guard let n = next(d) else { break }; d = n }
        return SchedulePacker.allocate(
            tasks: tasks, from: from, through: through,
            keep: keep ?? all, capacity: capacity,
            isWorkDay: isWeekday, nextDay: next, maxDays: 500)
    }

    private func hours(_ out: [Date: [SchedulePacker.Slice]], _ d: Date) -> Double {
        (out[d] ?? []).reduce(0) { $0 + $1.hours }
    }

    // MARK: - The regression: a day never exceeds org capacity

    /// Three full-day tasks on one Monday = 24h of demand against a 7h day. The
    /// old packer laid all 24 hours end-to-end from 07:00, which is what pushed
    /// the timeline past midnight.
    @Test func overbookedDayNeverExceedsCapacity() {
        let mon = day(3)
        let tasks = (0..<3).map { _ in
            SchedulePacker.Task(hpd: 8, totalHours: 8, earliest: mon)
        }
        let out = allocate(tasks, from: mon, through: day(14), capacity: 7)

        for (d, slices) in out {
            let total = slices.reduce(0) { $0 + $1.hours }
            #expect(total <= 7.0001, "\(d) got \(total)h against a 7h capacity")
        }
    }

    /// …and the overflow is DEFERRED, not dropped. All 24 hours still land.
    @Test func overflowRollsForwardAndNothingIsLost() {
        let mon = day(3)
        let tasks = (0..<3).map { _ in
            SchedulePacker.Task(hpd: 8, totalHours: 8, earliest: mon)
        }
        let out = allocate(tasks, from: mon, through: day(14), capacity: 7)

        let placed = out.values.flatMap { $0 }.reduce(0) { $0 + $1.hours }
        #expect(abs(placed - 24) < 0.01, "expected all 24h placed, got \(placed)")

        // 24h at 7h/day = Mon 7, Tue 7, Wed 7, Thu 3.
        #expect(abs(hours(out, day(3)) - 7) < 0.01)
        #expect(abs(hours(out, day(4)) - 7) < 0.01)
        #expect(abs(hours(out, day(5)) - 7) < 0.01)
        #expect(abs(hours(out, day(6)) - 3) < 0.01)
    }

    // MARK: - hpd stays a daily RATE, not a budget

    /// The guard that keeps ordinary days identical to before: one 20h task at
    /// 4h/day takes 4h a day even though the day could absorb 7.
    @Test func taskNeverExceedsItsDailyRate() {
        let mon = day(3)
        let out = allocate([SchedulePacker.Task(hpd: 4, totalHours: 20, earliest: mon)],
                           from: mon, through: day(14), capacity: 7)
        for d in [3, 4, 5, 6, 7] {
            #expect(abs(hours(out, day(d)) - 4) < 0.01, "day \(d) should get exactly 4h")
        }
        // 20h at 4h/day = five work days, so the following Monday is clear.
        #expect(hours(out, day(10)) == 0)
    }

    /// A single task that fits inside the day is untouched by the change — this is
    /// the common case and it must not move.
    @Test func normallyLoadedDayIsUnchanged() {
        let mon = day(3)
        let out = allocate([SchedulePacker.Task(hpd: 6, totalHours: 6, earliest: mon)],
                           from: mon, through: day(14), capacity: 7)
        #expect(abs(hours(out, day(3)) - 6) < 0.01)
        #expect(out[day(3)]?.count == 1)
        #expect(hours(out, day(4)) == 0)
    }

    // MARK: - Calendar rules

    /// Overflow skips the weekend: Fri's spill lands on Monday, not Saturday.
    @Test func overflowSkipsNonWorkDays() {
        let fri = day(7)
        let tasks = (0..<2).map { _ in
            SchedulePacker.Task(hpd: 8, totalHours: 8, earliest: fri)
        }
        let out = allocate(tasks, from: fri, through: day(17), capacity: 7)
        #expect(hours(out, day(8)) == 0, "Saturday must stay empty")
        #expect(hours(out, day(9)) == 0, "Sunday must stay empty")
        #expect(abs(hours(out, day(7)) - 7) < 0.01)
        #expect(abs(hours(out, day(10)) - 7) < 0.01, "Friday's overflow belongs on Monday")
    }

    /// A task cannot be pulled earlier than its own start date.
    @Test func taskNeverStartsBeforeItsStartDate() {
        let out = allocate([SchedulePacker.Task(hpd: 4, totalHours: 4, earliest: day(5))],
                           from: day(3), through: day(14), capacity: 7)
        #expect(hours(out, day(3)) == 0)
        #expect(hours(out, day(4)) == 0)
        #expect(abs(hours(out, day(5)) - 4) < 0.01)
    }

    // MARK: - placedBefore drives the worked stripe across a roll-forward

    /// `placedBefore` must accumulate across days, so a worked-hours fill pours
    /// front-to-back over the task's whole run rather than restarting each day.
    @Test func placedBeforeAccumulatesAcrossDays() {
        let mon = day(3)
        let out = allocate([SchedulePacker.Task(hpd: 7, totalHours: 21, earliest: mon)],
                           from: mon, through: day(14), capacity: 7)
        #expect(out[day(3)]?.first?.placedBefore == 0)
        #expect(abs((out[day(4)]?.first?.placedBefore ?? -1) - 7) < 0.01)
        #expect(abs((out[day(5)]?.first?.placedBefore ?? -1) - 14) < 0.01)
    }

    // MARK: - `keep` only trims output, never the walk

    /// Days before the visible window still consume capacity — that's how the view
    /// learns what has already rolled forward — but they aren't materialised.
    @Test func keepTrimsOutputWithoutChangingAllocation() {
        let mon = day(3)
        let tasks = (0..<3).map { _ in
            SchedulePacker.Task(hpd: 8, totalHours: 8, earliest: mon)
        }
        let thu = day(6)
        let trimmed = SchedulePacker.allocate(
            tasks: tasks, from: mon, through: day(14), keep: [thu], capacity: 7,
            isWorkDay: isWeekday, nextDay: next, maxDays: 500)

        #expect(Set(trimmed.keys) == [thu], "only the requested day should materialise")
        // Thursday is the tail of the 24h spill: 24 - 7 - 7 - 7 = 3h.
        #expect(abs(hours(trimmed, thu) - 3) < 0.01)
    }

    // MARK: - Degenerate input

    @Test func zeroCapacityPlacesNothingRatherThanSpinning() {
        let out = allocate([SchedulePacker.Task(hpd: 8, totalHours: 8, earliest: day(3))],
                           from: day(3), through: day(14), capacity: 0)
        #expect(out.isEmpty)
    }

    @Test func emptyTaskListIsEmpty() {
        #expect(allocate([], from: day(3), through: day(14), capacity: 7).isEmpty)
    }

    /// `maxDays` bounds the walk even when the range is absurd.
    @Test func walkIsBoundedByMaxDays() {
        let out = SchedulePacker.allocate(
            tasks: [SchedulePacker.Task(hpd: 1, totalHours: 10_000, earliest: day(3))],
            from: day(3), through: day(3).addingTimeInterval(86_400 * 100_000),
            keep: [], capacity: 7,
            isWorkDay: isWeekday, nextDay: next, maxDays: 10)
        #expect(out.isEmpty)   // keep is empty, so nothing materialises …
        // … and the call returned at all, which is the actual assertion here.
    }
}
