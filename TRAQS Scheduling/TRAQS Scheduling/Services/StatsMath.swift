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

    /// Paid break hours bucketed by the calendar day each break STARTED.
    ///
    /// Rows are paired within each person's own sequence. Pairing everyone
    /// against a single global cursor silently loses time whenever two people
    /// are on break at once — the normal case, since a shop breaks together.
    /// One worker's start overwrote another's, so the ends that followed either
    /// paired with the wrong start or were dropped: fifteen workers taking
    /// fifteen minutes together reported fifteen minutes instead of 3h45m,
    /// which inflated `working` and pushed team efficiency down.
    ///
    /// An unpaired start is ignored rather than guessed at — the live accrual
    /// covers a break that is still open right now.
    static func breakHoursByDay(_ rows: [BreakRow], calendar: Calendar) -> [Date: Double] {
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
}
