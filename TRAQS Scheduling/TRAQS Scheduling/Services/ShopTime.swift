import Foundation

// MARK: - Shop time
//
// `src/shopTime.js`: the org's clock, not the device's. A schedule question — what day it is,
// what hour, where a working day ends — is about the SHOP, so it is answered in the org's
// timezone (`orgSettings.timeZone`, e.g. "America/Denver"); with none set, or an unknown name,
// it falls back to the device's zone, which is what everything did before.
//
// Ported algorithm for algorithm rather than re-expressed through Calendar: an instant's wall
// clock is the instant plus the zone's offset AT that instant, read in UTC; a wall-clock
// time's instant is found by subtracting the offset twice — once to land near it, once more
// from the far side of a DST change. That is what makes 08:00 on a DST day 08:00, and it is
// held to the JS by fixtures/schedule-parity.json (`shop`), DST days included.
//
// This is the primitive #250 needs. Moving the rest of the app onto it is #304 (chunk D).
struct ShopTime {
    let zone: TimeZone

    init(zone: TimeZone) { self.zone = zone }

    /// The org's zone, or the device's when the org has none (or names one Foundation does
    /// not know) — `setShopZone`'s fallback.
    init(org: OrgSettings) {
        zone = org.timeZone.flatMap { TimeZone(identifier: $0) } ?? .current
    }

    private static let hourMs = 3_600_000.0
    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    /// `offsetMs` — whole seconds, as the JS formatter gives them.
    private func offsetMs(_ ms: Double) -> Double {
        Double(zone.secondsFromGMT(for: Date(timeIntervalSince1970: (ms / 1000).rounded(.down)))) * 1000
    }

    private func wall(_ date: Date) -> (day: String, hour: Double) {
        // Integer milliseconds, as the JS works in; the wall clock is read off the UTC day.
        let ms = (date.timeIntervalSince1970 * 1000).rounded()
        let w = ms + offsetMs(ms)
        let dayMs = 86_400_000.0
        let midnight = (w / dayMs).rounded(.down) * dayMs
        let c = Self.utc.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: midnight / 1000))
        let day = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        return (day, (w - midnight) / Self.hourMs)
    }

    /// `shopDay` — the shop's calendar day for an instant, `yyyy-MM-dd`.
    func day(_ date: Date) -> String { wall(date).day }

    /// `shopHour` — hours since the shop's midnight, fractional.
    func hour(_ date: Date) -> Double { wall(date).hour }

    /// `shopMs` — the instant the shop's wall clock reads `hour` on `day`.
    func instant(_ day: String, hour: Double) -> Date {
        let p = day.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3,
              let midnight = Self.utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
        else { return Date(timeIntervalSince1970: 0) }
        let wall = midnight.timeIntervalSince1970 * 1000 + (hour.isFinite ? hour : 0) * Self.hourMs
        var utc = wall - offsetMs(wall)
        utc = wall - offsetMs(utc)          // second pass: the far side of a DST change
        return Date(timeIntervalSince1970: utc / 1000)
    }

    /// `endOfDayFor` — the end of the working day a clock-in belongs to: workEnd on its shop
    /// day, or, for a clock-in at or after it, workEnd on the next working day.
    func endOfDay(clockIn: Date, workEnd: Double, calendar: WorkCalendar) -> Date {
        let first = day(clockIn)
        let end = instant(first, hour: workEnd)
        guard clockIn >= end else { return end }
        var ds = JobsScheduler.adding(days: 1, to: first)
        for _ in 0..<400 where !calendar.isWorkDay(ds) { ds = JobsScheduler.adding(days: 1, to: ds) }
        return instant(ds, hour: workEnd)
    }
}

// MARK: - Job-clock session hours
//
// `sessionWorkedHours`, `openSessionEnd`, `productiveHoursBetween` (src/statsMath.js) — THE
// definition of a worked hour for a job-clock session, shared on the web by the live bar and
// by the server's credit at clock-out. A session counts productive time only: inside the
// working day, minus lunch and breaks, on working days, in shop time. It stops where the work
// stopped — at a hold, at an open pause, or at the end of the working day for a clock nobody
// closed (`unclosed`) — and closed MANUAL pauses come off; lunch pauses already did, as dead
// windows.
//
// iOS used raw wall clock minus pauses, counted only on the day the clock started (#250).
// Replayed over Matrix's 266 recorded sessions that is 1,136 h against the rule's 667 h, 171
// sessions off by more than 15 minutes, and a Friday-into-Monday session shown as 95.5 h of
// 6.2 h worked.
enum SessionHours {

    struct Result: Equatable {
        let hours: Double
        let end: Date
        /// The window stopped before `now`: held, paused, or past the end of the day.
        let frozen: Bool
        /// Stopped by the end of the working day — nobody closed it.
        let unclosed: Bool
    }

    private static let hourS = 3600.0

    /// `productiveHoursBetween` — productive hours between two instants, in shop time.
    static func productiveHoursBetween(_ start: Date, _ end: Date, day: DayWindow,
                                       calendar: WorkCalendar, shop: ShopTime) -> Double {
        guard end > start, day.workEnd - day.workStart > 0 else { return 0 }
        var total = 0.0
        var ds = shop.day(start)
        var guardCount = 0
        while guardCount < 400 && shop.instant(ds, hour: 0) <= end {
            defer { ds = JobsScheduler.adding(days: 1, to: ds); guardCount += 1 }
            guard calendar.isWorkDay(ds) else { continue }
            let a = max(start, shop.instant(ds, hour: day.workStart))
            let b = min(end, shop.instant(ds, hour: day.workEnd))
            guard b > a else { continue }
            var hours = b.timeIntervalSince(a) / hourS
            // Only the part of a dead window the span reaches comes off.
            for w in day.dead {
                let dS = shop.instant(ds, hour: w.start)
                let dE = dS.addingTimeInterval(w.duration * hourS)
                let oa = max(a, dS), ob = min(b, dE)
                if ob > oa { hours -= ob.timeIntervalSince(oa) / hourS }
            }
            total += max(0, hours)
        }
        return total
    }

    /// `openSessionEnd` — where an open session's window stops: a hold first, then an open
    /// pause, then the end of its working day.
    static func openEnd(clockIn: Date, pausedAt: Date?, frozenAt: Date?, now: Date,
                        day: DayWindow, calendar: WorkCalendar, shop: ShopTime) -> (end: Date, frozen: Bool, unclosed: Bool) {
        if let frozenAt { return (min(now, frozenAt), true, false) }
        if let pausedAt, pausedAt > clockIn { return (min(now, pausedAt), true, false) }
        let dayEnd = shop.endOfDay(clockIn: clockIn, workEnd: day.workEnd, calendar: calendar)
        if now > dayEnd { return (dayEnd, true, true) }
        return (now, false, false)
    }

    /// `sessionWorkedHours` — rounded to the hundredth, as the web and the server do.
    static func worked(clockIn: Date, clockOut: Date?, pausedAt: Date?, frozenAt: Date?,
                       totalPausedMs: Double, autoPausedMs: Double, now: Date,
                       day: DayWindow, calendar: WorkCalendar, shop: ShopTime) -> Result {
        let at = clockOut ?? now
        let e = openEnd(clockIn: clockIn, pausedAt: pausedAt, frozenAt: frozenAt, now: at,
                        day: day, calendar: calendar, shop: shop)
        let gross = productiveHoursBetween(clockIn, e.end, day: day, calendar: calendar, shop: shop)
        let manualH = max(0, totalPausedMs - autoPausedMs) / 3_600_000
        let hours = max(0, ((gross - manualH) * 100).rounded() / 100)
        return Result(hours: hours, end: e.end, frozen: e.frozen, unclosed: e.unclosed)
    }

    /// `liveOpHours` — the live productive hours on one op: every open job clock on it,
    /// each measured by `worked`. A total over the session, not per day; the gantt pours it
    /// across the unit's run.
    static func live(opId: String, people: [Person], now: Date, org: OrgSettings) -> Double {
        let day = WorkDayClock.day(from: org), calendar = WorkCalendar(org: org), shop = ShopTime(org: org)
        return people.reduce(0.0) { acc, p in
            guard let jc = p.activeJobClock, jc.opId == opId,
                  let clockIn = Date.fromFlexibleISO8601(jc.clockIn) else { return acc }
            return acc + worked(clockIn: clockIn, clockOut: nil,
                                pausedAt: jc.pausedAt.flatMap { Date.fromFlexibleISO8601($0) },
                                frozenAt: jc.frozenAtMs.map { Date(timeIntervalSince1970: $0 / 1000) },
                                totalPausedMs: jc.totalPausedMs ?? 0, autoPausedMs: jc.autoPausedMs ?? 0,
                                now: now, day: day, calendar: calendar, shop: shop).hours
        }
    }
}
