import Foundation

// MARK: - One overlap rule
//
// `overlapRules.js` and `opDaySegments` (statsMath.js), which the web and the
// server share. Swift cannot import the JS, so this is a port, case for case —
// a change to either side must land on both.
//
// A person can't be doing two things at once, measured on the hours they
// actually work:
//   - a unit (an op, or a panel with no live ops) occupies, per day, the block
//     its person's SHARE of `hpd` walks through productive time, from its
//     `startHour` on its first day and from the start of each day after — on
//     working days only, except its own start and end days, so a Fri→Mon op
//     does not occupy the weekend while an op put on a Saturday does;
//   - blocks are half-open [start, end): an op ending at 12:00 and one starting
//     at 12:00 do not overlap;
//   - two units overlap when they share an assignee (ids compared as strings)
//     and have blocks on the same day that intersect;
//   - taking part: unfinished, dated, live (no `deletedAt` on it or its
//     parents), and ending today or later. Locked units take part — a lock pins
//     a unit, it does not free its time. Finished units and history do not.
//
// Pure: every input is passed in — no AppState, no `Date()`. Same pattern as
// HoursCalculator and SchedulePacker.

enum OverlapRule {

    /// `EPS` in overlapRules.js — a sliver below this is float dust, not overlap.
    static let epsilon = 1e-6

    /// One day's wall-clock block, for one person. `start`/`end` are hours since
    /// midnight; the block is [start, end).
    struct Block: Equatable {
        let day: String
        let start: Double
        let end: Double
    }

    /// `overlapContext` — what every function here reads, from org settings.
    struct Context {
        /// The working day with lunch and breaks placed in it.
        var day: DayWindow
        /// `isWorkDay` — the org's `workDays` (0 = Sunday) and holidays.
        var calendar: WorkCalendar
        /// `yyyy-MM-dd`. Units ending before it are history, and blocks before it
        /// are dropped. Nil compares everything, as the server's "before" view does.
        var today: String?

        /// `productiveHoursPerDay` — derived from the SAME windows the walk steps
        /// over, never the org's own figure, so the two cannot disagree.
        var productiveHoursPerDay: Double { day.productiveHours }
    }

    /// One unit, reduced to what the rule reads.
    struct Unit: Equatable {
        let id: String
        let start: String
        let end: String
        /// Nil is the start of the working day.
        let startHour: Double?
        /// The unit's TOTAL for the whole team; 0 is unestimated.
        let hpd: Double
        let team: [String]
        let finished: Bool
        /// `deletedAt` on the unit — its parents are checked by `occupyingUnits`.
        let deleted: Bool

        init(id: String, start: String, end: String, startHour: Double?, hpd: Double,
             team: [String], finished: Bool = false, deleted: Bool = false) {
            self.id = id; self.start = start; self.end = end; self.startHour = startHour
            self.hpd = hpd; self.team = team; self.finished = finished; self.deleted = deleted
        }

        init(_ op: Operation) {
            self.init(id: op.id, start: op.start, end: op.end,
                      startHour: OverlapRule.startHour(op.extras), hpd: op.hpd, team: op.team,
                      finished: op.status == .finished, deleted: OverlapRule.isTombstoned(op.extras))
        }

        init(_ panel: Panel) {
            self.init(id: panel.id, start: panel.start, end: panel.end,
                      startHour: OverlapRule.startHour(panel.extras), hpd: panel.hpd,
                      team: panel.team, finished: panel.status == .finished,
                      deleted: OverlapRule.isTombstoned(panel.extras))
        }
    }

    // MARK: Reading the model

    /// `op.startHour != null`. The web writes a number; a numeric string is read
    /// too, because the JS clamp (`Math.max`) coerces one.
    static func startHour(_ extras: JSONExtras) -> Double? {
        extras.double("startHour")
    }

    /// `x.deletedAt` is truthy. The models don't name it, so it lives in extras.
    static func isTombstoned(_ extras: JSONExtras) -> Bool {
        switch extras["deletedAt"] {
        case nil, .null?:         return false
        case .string(let s)?:     return !s.isEmpty
        case .number(let d)?:     return d != 0
        case .bool(let b)?:       return b
        case .object?, .array?:   return true
        }
    }

    // MARK: Blocks

    /// `personShareHours` — hpd ÷ team, or one productive day when unestimated.
    static func shareHours(hpd: Double, teamCount: Int, productiveHoursPerDay: Double) -> Double {
        hpd > 0 ? hpd / Double(max(1, teamCount)) : productiveHoursPerDay
    }

    /// `opDaySegments` for one person carrying `hours`, then clipped to today
    /// (`unitBlocks`). `hours` of 0 is unestimated: one productive day.
    ///
    /// Walked through productive time from `startHour` on the first day, then
    /// from the start of each following day, until the hours run out or the end
    /// date is reached. A unit with more hours than its days hold ends at
    /// quitting time on its last day.
    static func blocks(start: String, end: String, startHour: Double?, hours: Double,
                       context: Context, maxDays: Int = 400) -> [Block] {
        guard !start.isEmpty else { return [] }
        let day = context.day
        let last = !end.isEmpty && end >= start ? end : start
        var left = hours > 0 ? hours : context.productiveHoursPerDay
        var from = startHour.map { min(max($0, day.workStart), day.workEnd) } ?? day.workStart
        var out: [Block] = []
        var current = start
        var n = 0

        while current <= last && n < maxDays && left > WorkDayClock.epsilon {
            defer { current = JobsScheduler.adding(days: 1, to: current); n += 1 }
            guard context.calendar.isWorkDay(current) || current == start || current == last
            else { continue }

            let walk = WorkDayClock.walk(from: from, hours: left, in: day)
            if walk.days > 1 || (current == last && walk.endHour > day.workEnd) {
                // Runs past quitting time: this day is full from `from`; carry the rest.
                out.append(Block(day: current, start: from, end: day.workEnd))
                left -= WorkDayClock.productiveHours(from: from, to: day.workEnd, in: day)
            } else {
                out.append(Block(day: current, start: from, end: min(walk.endHour, day.workEnd)))
                left = 0
            }
            from = day.workStart
        }

        guard let today = context.today else { return out }
        return out.filter { $0.day >= today }
    }

    /// `unitBlocks` — the unit's blocks for any ONE of its assignees.
    static func blocks(of unit: Unit, context: Context) -> [Block] {
        blocks(start: unit.start, end: unit.end, startHour: unit.startHour,
               hours: shareHours(hpd: unit.hpd, teamCount: unit.team.count,
                                 productiveHoursPerDay: context.productiveHoursPerDay),
               context: context)
    }

    /// `blocksOverlap` — the first intersection, or nil. Half-open, so touching
    /// end to start is not an overlap.
    static func blocksOverlap(_ a: [Block], _ b: [Block]) -> Block? {
        for x in a {
            for y in b where x.day == y.day {
                let s = max(x.start, y.start), e = min(x.end, y.end)
                if e - s > epsilon { return Block(day: x.day, start: s, end: e) }
            }
        }
        return nil
    }

    // MARK: Who takes part

    /// `takesPart` — unfinished, dated, live, and not history.
    static func takesPart(_ unit: Unit, context: Context) -> Bool {
        guard !unit.start.isEmpty, !unit.deleted, !unit.finished else { return false }
        guard let today = context.today else { return true }
        return (unit.end.isEmpty ? unit.start : unit.end) >= today
    }

    /// `occupyingUnits` — live ops, and panels with no live ops, that take part.
    /// `excludingJob` leaves one job out: the one being scheduled.
    static func occupyingUnits(in jobs: [Job], context: Context,
                               excludingJob jobID: String? = nil) -> [Unit] {
        var out: [Unit] = []
        for job in jobs where job.id != jobID && !isTombstoned(job.extras) {
            for panel in job.subs where !isTombstoned(panel.extras) {
                let ops = panel.subs.filter { !isTombstoned($0.extras) }
                let units = ops.isEmpty ? [Unit(panel)] : ops.map(Unit.init)
                out += units.filter { takesPart($0, context: context) }
            }
        }
        return out
    }

    // MARK: Overlaps

    /// One hit: the unit overlapped, the person both are on, and where.
    struct Hit: Equatable {
        let other: Unit
        let personID: String
        let at: Block
    }

    /// `overlapsWith` — every unit in `others` (from `occupyingUnits`) that
    /// `candidate` overlaps, per shared assignee. The candidate's own id is
    /// skipped, as are `excluding`.
    static func overlaps(_ candidate: Unit, with others: [Unit], context: Context,
                         excluding: Set<String> = []) -> [Hit] {
        guard takesPart(candidate, context: context) else { return [] }
        let mine = candidate.team
        guard !mine.isEmpty else { return [] }
        let a = blocks(of: candidate, context: context)
        guard !a.isEmpty else { return [] }

        var out: [Hit] = []
        for other in others where other.id != candidate.id && !excluding.contains(other.id) {
            guard let shared = other.team.first(where: mine.contains) else { continue }
            if let at = blocksOverlap(a, blocks(of: other, context: context)) {
                out.append(Hit(other: other, personID: shared, at: at))
            }
        }
        return out
    }
}
