import Foundation

/// Roll-forward day packing, lifted out of GanttView.
///
/// Pure by design: no AppState, no captured Calendar, no implicit `Date()`. The
/// caller supplies the day capacity, the work-day predicate and the day-stepping.
/// That is what makes this testable — the two behaviours that actually matter
/// (overflow DEFERRING to the next work day rather than being dropped or spilling
/// past workEnd, and a task never exceeding its daily rate however empty the day)
/// were previously only observable by squinting at a rendered timeline.
///
/// Same relocation pattern as `HoursCalculator` and `StatsMath`.
enum SchedulePacker {

    /// One schedulable task, reduced to the three numbers the walk needs.
    struct Task: Equatable {
        /// Per-DAY ceiling. `hpd` is a rate, not a budget: a 40-hour task still
        /// takes only its 8 hours today even when the rest of the day is empty.
        /// This is what keeps a normally-loaded day packed exactly as it was
        /// before overflow began rolling forward.
        let hpd: Double
        /// The task's whole budget — hpd × its business-day span.
        let totalHours: Double
        /// Nothing may be placed before this day (the task's own start).
        let earliest: Date
    }

    /// Hours handed to one task on one day.
    struct Slice: Equatable {
        let taskIndex: Int
        let hours: Double
        /// Hours of this same task already placed on EARLIER days. Lets the caller
        /// pour a worked-hours stripe front-to-back across the task's whole run
        /// instead of restarting it every morning.
        let placedBefore: Double
    }

    /// Walk work days from `start` through `end`, handing each day out to the tasks
    /// in order until its capacity is gone. Whatever a task doesn't get rolls on to
    /// the next work day it's eligible for.
    ///
    /// Days outside `keep` are still walked — they establish how much has already
    /// rolled forward into view — but their slices are discarded, so the caller
    /// only pays to materialise the days it renders.
    ///
    /// `maxDays` bounds the walk so a corrupt date can't make this unbounded.
    static func allocate(tasks: [Task],
                         from start: Date,
                         through end: Date,
                         keep: Set<Date>,
                         capacity: Double,
                         isWorkDay: (Date) -> Bool,
                         nextDay: (Date) -> Date?,
                         maxDays: Int) -> [Date: [Slice]] {
        guard !tasks.isEmpty, capacity > 0 else { return [:] }

        var remaining = tasks.map(\.totalHours)
        var placed    = [Double](repeating: 0, count: tasks.count)
        var out: [Date: [Slice]] = [:]

        var day = start
        var budget = maxDays
        while day <= end, budget > 0 {
            budget -= 1
            if isWorkDay(day) {
                let keeping = keep.contains(day)
                var left = capacity
                for i in tasks.indices where remaining[i] > 0.01 {
                    if left <= 0.01 { break }
                    guard tasks[i].earliest <= day else { continue }
                    let take = min(remaining[i], tasks[i].hpd, left)
                    guard take > 0.01 else { continue }
                    if keeping {
                        out[day, default: []].append(
                            Slice(taskIndex: i, hours: take, placedBefore: placed[i]))
                    }
                    remaining[i] -= take
                    placed[i]    += take
                    left         -= take
                }
            }
            guard let n = nextDay(day) else { break }
            day = n
        }
        return out
    }
}
