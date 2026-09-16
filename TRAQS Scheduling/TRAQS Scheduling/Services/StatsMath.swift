import Foundation

/// Pure math behind the Stats page, kept out of the views so both the app and
/// the test target can exercise it directly. Foundation only — no SwiftUI, no
/// AppState — so a change here is provable without running the UI.
enum StatsMath {

    // MARK: - Paid break time

    /// One breakStart / breakEnd punch, carrying the person it belongs to.
    struct BreakRow {
        let personId: String
        /// "breakStart" or "breakEnd".
        let type: String
        let t: Date

        init(personId: String, type: String, t: Date) {
            self.personId = personId
            self.type = type
            self.t = t
        }
    }

    /// Paid break hours bucketed by the calendar day each break STARTED,
    /// including a break that is still running.
    ///
    /// Rows are paired within each person's own sequence. Pairing everyone
    /// against a single global cursor silently loses time whenever two people
    /// are on break at once — the normal case, since a shop breaks together.
    /// One worker's start overwrote another's, so the ends that followed either
    /// paired with the wrong start or were dropped: fifteen workers taking
    /// fifteen minutes together reported fifteen minutes instead of 3h45m,
    /// which inflated `working` and pushed team efficiency down.
    ///
    /// A break still RUNNING is closed at `now`, exactly as the server closes an
    /// open lunch range at clock-out.
    ///
    /// This used to ignore an unpaired start, on the assumption that "the live
    /// accrual covers a break that is still open right now." It did not. The only
    /// break flow workers use is `breakBegin`/`breakClear`, which writes
    /// `person.activeBreak` plus a payhours row and never touches
    /// `activeClockIn.events` — the sole source the live accrual read. So an open
    /// break was subtracted from NEITHER: pay kept accruing gross while the job
    /// clock sat paused, and efficiency sagged by the whole elapsed break until
    /// the worker ended it. These rows are the one place every break shows up
    /// regardless of which path recorded it, so the open range is closed here and
    /// the live accrual no longer computes break time at all.
    ///
    /// A start left open on an EARLIER day is still ignored. Accruing it to `now`
    /// would bill an abandoned break every hour since, overrun the day's pay and
    /// clamp working time — and so efficiency — to zero. The server pairs a
    /// forgotten break at clock-out (`closeActiveBreak`); until then it stays out.
    static func breakHoursByDay(_ rows: [BreakRow], now: Date, calendar: Calendar) -> [Date: Double] {
        var byPerson: [String: [BreakRow]] = [:]
        for row in rows where row.type == "breakStart" || row.type == "breakEnd" {
            byPerson[row.personId, default: []].append(row)
        }
        var out: [Date: Double] = [:]
        for (_, personRows) in byPerson {
            var openBreak: Date? = nil
            for row in personRows.sorted(by: { $0.t < $1.t }) {
                if row.type == "breakStart" {
                    openBreak = row.t
                } else if let open = openBreak {
                    out[calendar.startOfDay(for: open), default: 0]
                        += max(0, row.t.timeIntervalSince(open) / 3600)
                    openBreak = nil
                }
            }
            // Still on break: count what has elapsed so far, same-day only.
            if let open = openBreak, calendar.isDate(open, inSameDayAs: now) {
                out[calendar.startOfDay(for: open), default: 0]
                    += max(0, now.timeIntervalSince(open) / 3600)
            }
        }
        return out
    }

    // MARK: - Week window

    /// The Monday–Sunday week containing `date`.
    ///
    /// Anchored on Monday explicitly rather than through `.weekOfYear`, whose
    /// first weekday follows the device locale (Sunday under en_US). The desktop
    /// keys its analytics week off Monday, so a locale-driven week filed every
    /// Sunday's hours into a different week on each platform and the two
    /// efficiency numbers could never agree.
    static func weekInterval(containing date: Date, calendar: Calendar) -> DateInterval {
        // weekday: 1 = Sunday … 7 = Saturday. Sunday closes the preceding week,
        // so it steps back six days rather than forward one.
        let weekday = calendar.component(.weekday, from: date)
        let mondayOffset = weekday == 1 ? -6 : 2 - weekday
        let shifted = calendar.date(byAdding: .day, value: mondayOffset, to: date) ?? date
        let start = calendar.startOfDay(for: shifted)
        let end = calendar.date(byAdding: .day, value: 7, to: start)
            ?? start.addingTimeInterval(7 * 86_400)
        return DateInterval(start: start, end: end)
    }

    // MARK: - Analytics window (week / pay period)

    /// A pay period as a HALF-OPEN interval.
    ///
    /// `AppState.payPeriodWindow` reports its `end` as the last DAY of the
    /// period; `weekInterval` reports the first instant AFTER the window, and
    /// every date comparison on the Analytics page is written `d >= start &&
    /// d < end`. Feeding the first convention to code expecting the second
    /// silently drops the period's final day — payday itself — from every
    /// number on the page. One conversion, here, tested.
    static func payPeriodInterval(start: Date, endInclusive: Date, calendar: Calendar) -> DateInterval {
        let s = calendar.startOfDay(for: start)
        let e = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: endInclusive))
            ?? endInclusive
        return DateInterval(start: s, end: max(e, s))
    }

    /// How many of an org's WORK days a window contains.
    ///
    /// Utilization divides assigned hours by capacity, and capacity was a
    /// hardcoded single week (`hpd × workDays.count`). Measured over a two-week
    /// pay period that denominator is half what it should be, so the whole team
    /// would have read about double their real utilization. Counting the
    /// window's own work days gives the same answer as before for a full week.
    ///
    /// `workDays` uses the JS convention the org settings store: Sun=0…Sat=6.
    static func workDayCount(in interval: DateInterval, workDays: Set<Int>, calendar: Calendar) -> Int {
        guard interval.end > interval.start else { return 0 }
        var count = 0
        var d = calendar.startOfDay(for: interval.start)
        while d < interval.end {
            if workDays.contains(calendar.component(.weekday, from: d) - 1) { count += 1 }
            guard let next = calendar.date(byAdding: .day, value: 1, to: d) else { break }
            d = next
        }
        return count
    }

    /// Split a day series into chart rows, wrapping onto a second row past
    /// `maxPerRow` with the LARGER half first on an odd count.
    ///
    /// Generic over the element so it can be tested without building EffDays.
    static func chartRows<T>(_ items: [T], maxPerRow: Int) -> [[T]] {
        guard maxPerRow > 0 else { return [items] }
        guard items.count > maxPerRow else { return [items] }
        let first = Int((Double(items.count) / 2).rounded(.up))
        return [Array(items.prefix(first)), Array(items.dropFirst(first))]
    }

    // MARK: - Production hours rolled up by scope

    /// Job-clock hours totalled per op, per panel and per job.
    ///
    /// Port of the web's `producedHoursByScope` (src/statsMath.js) — the same
    /// rollup, so both clients derive progress from the same numbers.
    struct ProducedScopes: Equatable {
        var byOp:    [String: Double] = [:]
        var byPanel: [String: Double] = [:]
        var byJob:   [String: Double] = [:]
        static let empty = ProducedScopes()
    }

    /// Total the session rows into the three scopes. A session with no `hours`
    /// (or zero) contributes nothing; a missing id simply doesn't register in that
    /// scope, so a panel-level punch still counts toward its job.
    static func producedHoursByScope(_ sessions: [JobSession]) -> ProducedScopes {
        var out = ProducedScopes()
        func add(_ map: inout [String: Double], _ key: String?, _ h: Double) {
            guard let k = key, !k.isEmpty else { return }
            map[k, default: 0] += h
        }
        for s in sessions {
            let h = s.hours ?? 0
            guard h != 0 else { continue }
            add(&out.byOp,    s.opId,    h)
            add(&out.byPanel, s.panelId, h)
            add(&out.byJob,   s.jobId,   h)
        }
        return out
    }

    // MARK: - Chart scale

    /// Tallest value a bar chart has to draw, floored at 1 so an empty week
    /// still divides cleanly.
    ///
    /// Self-scaling because one fixed ceiling cannot serve both views: the org
    /// dashboard sums every worker into each bar, so a per-person ceiling pegged
    /// all fourteen bars at full height and the chart showed nothing.
    static func barMax(_ values: [Double]) -> Double {
        max(values.max() ?? 1, 1)
    }
}
