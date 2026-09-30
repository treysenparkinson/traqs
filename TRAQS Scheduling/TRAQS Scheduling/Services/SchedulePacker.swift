import Foundation

/// Roll-forward day packing, lifted out of GanttView.
///
/// Pure by design: no AppState, no captured Calendar, no implicit `Date()`. The
/// caller supplies the day capacity, the work-day predicate and the day-stepping.
/// That is what makes this testable — the two behaviours that actually matter
/// (overflow DEFERRING to the next work day rather than being dropped or spilling
/// past workEnd, and a task never exceeding its daily ceiling however empty the day)
/// were previously only observable by squinting at a rendered timeline.
///
/// Same relocation pattern as `HoursCalculator` and `StatsMath`.
enum SchedulePacker {

    /// One schedulable task, reduced to the three numbers the walk needs.
    struct Task: Equatable {
        /// Per-DAY ceiling: the most of this task one day may take, however
        /// empty the rest of it is. The gantt passes the day's capacity — one
        /// person can put in a whole day on a task and no more.
        let dailyCeiling: Double
        /// The task's whole budget for this person — see `personalBudget`.
        let totalHours: Double
        /// Nothing may be placed before this day (the task's own start).
        let earliest: Date
    }

    /// One person's slice of a unit, as the walk wants it.
    ///
    /// `hpd` is the unit's TOTAL estimated productive hours for the whole team —
    /// not a per-day rate — so this person's budget is their share of it,
    /// `hpd / teamSize`. An unestimated unit (`hpd` 0) is drawn as one
    /// productive day per person: `productiveHoursPerDay × teamSize` shared
    /// among `teamSize`. The ceiling is simply the day's capacity.
    static func personalBudget(hpd: Double, teamSize: Int,
                               productiveHoursPerDay: Double,
                               dayCapacity: Double) -> (totalHours: Double, dailyCeiling: Double) {
        let team = Double(max(1, teamSize))
        let whole = hpd > 0 ? hpd : productiveHoursPerDay * team
        return (whole / team, dayCapacity)
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
                    let take = min(remaining[i], tasks[i].dailyCeiling, left)
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
