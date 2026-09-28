import Foundation

// MARK: - Shifts: who is scheduled when
//
// Basic doesn't clock time against jobs; a job there is a shift — a day (or run
// of days) and a window of time. This turns the jobs array into those shifts,
// one per person per assignment, so a job's details can say who else is working
// the same day and when, and a card can print its own time.
//
// WHO: the same leaf rule `AppState.myAssignments` uses. A person on one or more
// of a panel's ops is working those ops; a person on the panel but on none of
// its ops is working the panel itself.
//
// WHEN: a unit starts at its `startHour` (the web writes it; the simple-job
// form does too) or the start of the working day, and runs `hpd` productive
// hours — walked through lunch and breaks by WorkDayClock, so an 8am start with
// 4h lands at 12:00 before lunch, not wherever a naive 8 + 4 would put it. A
// unit longer than the day ends at quitting time.

enum JobShifts {

    struct Shift: Identifiable, Equatable {
        let personId: String
        let jobId: String
        let jobTitle: String
        /// The panel or op this shift is, for a stable id.
        let unitId: String
        /// yyyy-MM-dd, inclusive.
        let start: String
        let end: String
        /// Wall-clock hours on each day of the shift.
        let startHour: Double
        let endHour: Double

        var id: String { "\(personId)/\(unitId)" }
        var isOneDay: Bool { start == end }
    }

    /// A unit's daily window.
    static func window(startHour: Double?, hpd: Double, day: DayWindow) -> (start: Double, end: Double) {
        let s = min(max(startHour ?? day.workStart, day.workStart), day.workEnd)
        let walk = WorkDayClock.walk(from: s, hours: hpd, in: day)
        return (s, walk.days > 1 ? day.workEnd : walk.endHour)
    }

    /// `startHour` as the web stores it on a panel or op — a number in extras.
    static func startHour(_ extras: JSONExtras) -> Double? {
        if case .number(let h)? = extras["startHour"] { return h }
        return nil
    }

    /// Every scheduled shift in `jobs`. Unscheduled units (no start date) have
    /// no day to share and are skipped.
    static func all(in jobs: [Job], day: DayWindow) -> [Shift] {
        var out: [Shift] = []
        for job in jobs {
            for panel in job.subs {
                var onAnOp = Set<String>()
                for op in panel.subs {
                    guard !op.start.isEmpty else { continue }
                    let w = window(startHour: startHour(op.extras), hpd: op.hpd, day: day)
                    for pid in op.team {
                        onAnOp.insert(pid)
                        out.append(Shift(personId: pid, jobId: job.id, jobTitle: job.title, unitId: op.id,
                                         start: op.start, end: op.end.isEmpty ? op.start : op.end,
                                         startHour: w.start, endHour: w.end))
                    }
                }
                guard !panel.start.isEmpty else { continue }
                let w = window(startHour: startHour(panel.extras), hpd: panel.hpd, day: day)
                for pid in panel.team where !onAnOp.contains(pid) {
                    out.append(Shift(personId: pid, jobId: job.id, jobTitle: job.title, unitId: panel.id,
                                     start: panel.start, end: panel.end.isEmpty ? panel.start : panel.end,
                                     startHour: w.start, endHour: w.end))
                }
            }
        }
        return out
    }

    /// Shifts sharing at least one day with `start…end` (yyyy-MM-dd strings,
    /// which compare correctly as text), minus `excluding`, earliest first.
    static func sameDays(_ shifts: [Shift], start: String, end: String,
                         excluding personId: String?) -> [Shift] {
        shifts
            .filter { $0.personId != personId && $0.start <= end && $0.end >= start }
            .sorted { a, b in
                if a.start != b.start { return a.start < b.start }
                if a.startHour != b.startHour { return a.startHour < b.startHour }
                return a.personId < b.personId
            }
    }

    // MARK: Labels

    /// 13.5 → "1:30 PM".
    static func hourLabel(_ h: Double) -> String {
        let minutes = Int((h * 60).rounded())
        let hh = (minutes / 60) % 24, mm = minutes % 60
        let h12 = hh % 12 == 0 ? 12 : hh % 12
        return String(format: "%d:%02d %@", h12, mm, hh < 12 ? "AM" : "PM")
    }

    static func timeLabel(start: Double, end: Double) -> String {
        "\(hourLabel(start)) – \(hourLabel(end))"
    }

    /// "Tue, Oct 1" for one day, "Oct 1 – Oct 3" for a run.
    static func dateLabel(start: String, end: String) -> String {
        guard let s = parse(start) else { return start }
        guard let e = parse(end), end != start else { return oneDay.string(from: s) }
        return "\(short.string(from: s)) – \(short.string(from: e))"
    }

    private static func parse(_ ymd: String) -> Date? { ymdFormatter.date(from: ymd) }

    private static let ymdFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let oneDay: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE, MMM d"; return f
    }()
    private static let short: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "MMM d"; return f
    }()
}
