import Foundation

// MARK: - Pay periods
//
// `src/payPeriod.js` — getPayPeriodFromDates / getPayPeriodAtOffsetFromDates, held to the web
// by fixtures/schedule-parity.json (`payPeriods`) rather than by a comment. A pay period is a
// SHOP concept (chunk D ruling 3): `today` is the shop's day and so is the answer.
//
// Worked on "yyyy-MM-dd" days, as the JS is: a Gregorian calendar in UTC normalises an
// out-of-range month or day exactly as `new Date(y, m, d)` does (day 0 → the last day of the
// month before, month 13 → next January), and never meets a DST change.
enum PayPeriod {

    struct Period: Equatable {
        let start: String
        let end: String
        let periodNumber: Int
    }

    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    /// `new Date(y, m, d)` with a 0-based month, as a day string.
    private static func ds(_ y: Int, _ m0: Int, _ d: Int) -> String {
        guard let date = utc.date(from: DateComponents(year: y, month: m0 + 1, day: d)) else { return "" }
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func parts(_ day: String) -> (y: Int, m0: Int, d: Int)? {
        let p = day.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return (p[0], p[1] - 1, p[2])
    }

    /// `getPayPeriodFromDates` — e.g. [5, 20] → the 5th–19th and the 20th–4th. An empty list
    /// is [5, 20], as the web's settings merge makes it before this is ever called.
    static func fromDates(_ payDates: [Int], today: String) -> Period {
        let dates = (payDates.isEmpty ? [5, 20] : payDates).sorted()
        let d1 = dates[0], d2 = dates.count > 1 ? dates[1] : dates[0]
        guard let (y, m, day) = parts(today) else { return Period(start: today, end: today, periodNumber: 1) }
        let start: String, end: String
        if day >= d1 && day < d2 {
            start = ds(y, m, d1); end = ds(y, m, d2 - 1)
        } else if day >= d2 {
            start = ds(y, m, d2); end = ds(y, m + 1, d1 - 1)
        } else {
            start = ds(y, m - 1, d2); end = ds(y, m, d1 - 1)
        }
        let periodNumber = (y - 2020) * 24 + m * 2 + (day >= d2 ? 1 : day >= d1 ? 0 : -1) + 1
        return Period(start: start, end: end, periodNumber: max(1, periodNumber))
    }

    /// `getPayPeriodAtOffsetFromDates` — the period `offset` periods before (negative) or
    /// after the one holding `today`.
    static func atOffset(_ payDates: [Int], today: String, offset: Int) -> Period {
        var period = fromDates(payDates, today: today)
        for _ in 0..<abs(offset) {
            let ref = offset < 0 ? JobsScheduler.adding(days: -1, to: period.start)
                                 : JobsScheduler.adding(days: 1, to: period.end)
            period = fromDates(payDates, today: ref)
        }
        return period
    }

    /// The pay period `now` falls in, as the SHOP's midnights starting its first and last
    /// days. Was AppState.payPeriodWindow, on the device's calendar: late Sunday in Denver a
    /// New York phone was already in Monday's period.
    static func window(org s: OrgSettings, now: Date, shop: ShopTime = .current) -> (start: Date, end: Date) {
        let cal = shop.calendar
        let today = cal.startOfDay(for: now)
        // Orgs configure pay periods via explicit days-of-month (payDates, e.g.
        // [5, 20]) in "setdate" mode — the semi-monthly model the desktop
        // payroll table actually uses (getPayPeriodFromDates). Prefer it whenever
        // payDates is present or payMode is "setdate"; otherwise fall back to the
        // legacy biweekly/weekly/semimonthly rolling logic below.
        if s.payMode == "setdate" || !s.payDates.isEmpty {
            let p = fromDates(s.payDates, today: shop.day(now))
            return (shop.date(ofDay: p.start) ?? today, shop.date(ofDay: p.end) ?? today)
        }
        let anchor = s.payPeriodStart.flatMap { shop.date(ofDay: $0) } ?? today
        switch s.payPeriodType {
        case "weekly":
            let weekday = cal.component(.weekday, from: today)
            let toMonday = weekday == 1 ? -6 : -(weekday - 2)
            let start = cal.date(byAdding: .day, value: toMonday, to: today) ?? today
            let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
            return (start, end)
        case "semimonthly":
            let day = cal.component(.day, from: today)
            let comps = cal.dateComponents([.year, .month], from: today)
            let monthStart = cal.date(from: comps) ?? today
            if day <= 15 {
                let end = cal.date(byAdding: .day, value: 14, to: monthStart) ?? today
                return (monthStart, end)
            } else {
                let start = cal.date(byAdding: .day, value: 15, to: monthStart) ?? today
                let nextMonth = cal.date(byAdding: .month, value: 1, to: monthStart) ?? today
                let end = cal.date(byAdding: .day, value: -1, to: nextMonth) ?? today
                return (start, end)
            }
        default: // biweekly
            let days = cal.dateComponents([.day], from: anchor, to: today).day ?? 0
            let cycles = days / 14
            let start = cal.date(byAdding: .day, value: cycles * 14, to: anchor) ?? today
            let end = cal.date(byAdding: .day, value: 13, to: start) ?? today
            return (start, end)
        }
    }
}
