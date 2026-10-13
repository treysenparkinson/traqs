import Foundation

// MARK: - The iOS gantt's geometry, ported from the web
//
// Two questions, and the web has settled both:
//
//   WHICH units are on my timeline — `getPersonBars`' task rules (TRAQS.jsx) with
//   `isAssignedHere` (statsMath.js): an op on my team, or a panel on my team that has no live
//   ops. A panel whose live ops belong to other people is THEIR work, not a bar of mine (#241).
//   Deleted and undated work is not drawn; finished work is, as DONE (#252). HISTORY — a unit
//   whose end is before today — is hidden rather than rolled forward, unless someone is
//   clocked into it (#248).
//
//   WHERE each sits on a day — `dayViewBlocks` (statsMath.js), the web day view's Business
//   rule: a multi-day unit by its own walk across its days (`OverlapRule.blocks`, the port of
//   `opDaySegments`); every other unit packed against one shared cursor from workStart, a
//   stored `startHour` honoured unless an earlier bar already holds that time (#243). Hours
//   are productive hours — breaks and lunch are stepped over, never worked through (#244),
//   so a day holds `productiveHoursPerDay`, not the paid day (#245). A unit sits on its own
//   dates: nothing rolls onto later days (#247).
//
// This replaced `SchedulePacker`, a roll-forward scheduler the web never had, built on the
// premise that "the schema doesn't carry time-of-day". It does (`startHour`).
//
// Swift cannot import the JS, so this is a port. It is held to the web by
// fixtures/schedule-parity.json — computed by the real JS, checked by
// scripts/schedule-parity-test.mjs on the web side and ScheduleParityTests here. A change to
// either side fails a build until both agree.
//
// Pure: every input passed in — same pattern as OverlapRule and WorkDayClock.
enum GanttLayout {

    /// One unit on a person's timeline, with the job and panel it belongs to.
    struct Entry {
        let job: Job
        let panel: Panel
        /// Nil when the unit is the panel itself (a panel with no live ops).
        let op: Operation?
        let unit: OverlapRule.Unit
    }

    /// One block on one day. `index` is the unit's position in the list `dayBlocks` was given.
    struct Placed: Equatable {
        let index: Int
        let start: Double
        let end: Double
        /// Whether this day is the unit's first / last drawn day (a single-day unit is both).
        let isFirst: Bool
        let isLast: Bool
    }

    // MARK: Which units

    /// `isAssignedHere` — the node a person is actually assigned, and so the one that gets a
    /// bar: on its team, and with no live children. Ids compare as strings.
    static func isAssignedHere(team: [String], liveChildren: Int, person: String) -> Bool {
        liveChildren == 0 && team.contains(person)
    }

    /// `getPersonBars`' task bars for one person, in row order. `live` is the ids of units
    /// someone is clocked into; `today` is `yyyy-MM-dd`.
    ///
    /// Not ported, because the iOS gantt has no equivalent yet: PTO bars, engineering chips
    /// and the overrun extension of a bar's visible end (#249, #252).
    static func units(for person: String, in jobs: [Job], live: Set<String>, today: String) -> [Entry] {
        func drawn(_ u: OverlapRule.Unit) -> Bool {
            // Finished work IS drawn, as on the web (`showCompleted`, on by default): a DONE bar
            // is a record of what happened (#252). Only its history is hidden, like any other.
            guard !u.deleted, !u.start.isEmpty else { return false }
            // HISTORY IS NOT ON THE SCHEDULE — except the unit someone is standing at.
            if !u.end.isEmpty && u.end < today && !live.contains(u.id) { return false }
            return true
        }
        var out: [Entry] = []
        for job in jobs where !OverlapRule.isTombstoned(job.extras) {
            for panel in job.subs where !OverlapRule.isTombstoned(panel.extras) {
                let liveOps = panel.subs.filter { !OverlapRule.isTombstoned($0.extras) }
                for op in liveOps {
                    let u = OverlapRule.Unit(op)
                    if isAssignedHere(team: u.team, liveChildren: 0, person: person), drawn(u) {
                        out.append(Entry(job: job, panel: panel, op: op, unit: u))
                    }
                }
                let p = OverlapRule.Unit(panel)
                if isAssignedHere(team: p.team, liveChildren: liveOps.count, person: person), drawn(p) {
                    out.append(Entry(job: job, panel: panel, op: nil, unit: p))
                }
            }
        }
        return out
    }

    // MARK: Where they sit

    /// `dayViewBlocks` — where each unit sits on `day`, for one person's row, in pack order.
    /// `business` false is Basic: each unit exactly at its own startHour, overlaps allowed.
    /// `context.today` is ignored: a unit's segments are walked from its own start, and which
    /// units are drawn at all is `units(for:)`'s question.
    static func dayBlocks(_ units: [OverlapRule.Unit], on day: String,
                          context: OverlapRule.Context, business: Bool) -> [Placed] {
        let dw = context.day
        let walkContext = OverlapRule.Context(day: dw, calendar: context.calendar, today: nil)
        func lastDay(_ u: OverlapRule.Unit) -> String { u.end.isEmpty ? u.start : u.end }
        func isMulti(_ u: OverlapRule.Unit) -> Bool { !u.start.isEmpty && !u.end.isEmpty && u.start != u.end }

        // On the day: its start..end covers it, and a multi-day unit with no startHour is not
        // drawn on a non-working day.
        let onDay = units.enumerated().filter { _, u in
            guard u.start <= day, lastDay(u) >= day else { return false }
            if isMulti(u) && u.startHour == nil && !context.calendar.isWorkDay(day) { return false }
            return true
        }
        // A startHour sorts by it, multi-day or not; the rest after, in row order.
        let order = onDay.sorted { a, b in
            let ah = a.element.startHour ?? .infinity, bh = b.element.startHour ?? .infinity
            return ah != bh ? ah < bh : a.offset < b.offset
        }

        var cursor = dw.workStart
        var out: [Placed] = []
        for (index, u) in order {
            var start: Double, end: Double, isFirst = true, isLast = true
            if isMulti(u) {
                let segs = OverlapRule.blocks(of: u, context: walkContext)
                guard let seg = segs.first(where: { $0.day == day }) else { continue }   // ran out before today
                start = seg.start; end = seg.end
                isFirst = segs.first?.day == day
                isLast = segs.last?.day == day
            } else {
                let share = OverlapRule.shareHours(hpd: u.hpd, teamCount: u.team.count,
                                                   productiveHoursPerDay: walkContext.productiveHoursPerDay)
                start = business ? max(u.startHour ?? cursor, cursor) : (u.startHour ?? dw.workStart)
                let w = WorkDayClock.walk(from: start, hours: share, in: dw)
                end = min(w.days > 1 ? dw.workEnd : w.endHour, dw.workEnd)
            }
            // Every unit advances the cursor, multi-day ones included.
            cursor = max(cursor, end)
            out.append(Placed(index: index, start: start, end: end, isFirst: isFirst, isLast: isLast))
        }
        return out
    }

    /// `dayGridHours` — the hour grid: whole hours from the hour the working day starts in to
    /// the hour it ends in, at least one, never past midnight (#257).
    static func hourGrid(workStart: Double, workEnd: Double) -> (start: Int, end: Int) {
        let start = max(0, Int(workStart.rounded(.down)))
        return (start, min(24, max(start + 1, Int(workEnd.rounded(.up)))))
    }
}

// MARK: - Cross-row work (#365)

extension GanttLayout {
    /// A stretch of time a person actually clocked on a unit (an op, or a panel that is
    /// its own unit).
    struct Worked: Equatable {
        let nodeId: String
        let start: Date
        let end: Date
    }

    /// A record bar on one day: hours on that shop day, from the first moment worked to
    /// the last.
    struct CrossRow: Equatable {
        let nodeId: String
        let start: Double
        let end: Double
    }

    /// The web's cross-row bars (`getPersonBars`, TRAQS.jsx): work a person clocked on a
    /// unit whose team they are NOT on. A unit they ARE on already has its own bar at its
    /// planned window, which is the right bar; only off-team work is added, so a worker
    /// covering someone else's op doesn't see an empty day.
    ///
    /// Drawn where it happened, not packed: a record of work, not a plan. Several sessions
    /// on one unit that day are one bar from the first start to the last end, as the web
    /// spans them. Clipped to the shop day, so a session over midnight shows on both days.
    static func crossRow(_ worked: [Worked], onTeam: (String) -> Bool,
                         day: String, shop: ShopTime) -> [CrossRow] {
        let dayStart = shop.instant(day, hour: 0)
        let dayEnd = shop.instant(day, hour: 24)
        var byNode: [String: (Date, Date)] = [:]
        for w in worked where !onTeam(w.nodeId) {
            let a = max(w.start, dayStart), b = min(w.end, dayEnd)
            guard b > a else { continue }
            if let (s, e) = byNode[w.nodeId] {
                byNode[w.nodeId] = (min(s, a), max(e, b))
            } else {
                byNode[w.nodeId] = (a, b)
            }
        }
        // WALL-clock hours in the shop's zone, as the timeline places everything (so a DST
        // day doesn't shift the bar by an hour) — except a span running to the day's end,
        // which reads 24 rather than the next day's 0.
        func hours(_ d: Date) -> Double { d >= dayEnd ? 24 : shop.hour(d) }
        return byNode
            .map { CrossRow(nodeId: $0.key, start: hours($0.value.0), end: hours($0.value.1)) }
            .sorted { ($0.start, $0.nodeId) < ($1.start, $1.nodeId) }
    }
}
