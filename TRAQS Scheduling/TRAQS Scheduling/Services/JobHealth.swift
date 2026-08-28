import Foundation

// MARK: - Job health
//
// The coloured dot on a job row. Ported from `getHealth` (src/TRAQS.jsx:656) and
// its `HEALTH_DOT` palette (:669).
//
// The rule is "has elapsed TIME run ahead of the progress this status implies?"
// Each status carries an assumed completion — In Progress means half done, On
// Hold a quarter, Pending 0.15 — and the answer is how far the clock has got past
// that. Two margins: 0.15 ahead is behind, 0.35 ahead is critical.
//
// Pure, with `today` PASSED IN rather than read from the clock, so it is testable
// and so a row cannot change colour halfway through a render. Same convention as
// HoursCalculator and StatsMath, and it lives here for the same reason: this is
// where the iOS test target can reach it. iOS has no health indicator yet; when
// it gets one, it should use this rather than a second copy of these thresholds.
enum JobHealth: String, Equatable {
    case onTime, behind, critical, done

    /// `HEALTH_DOT` (:669). onTime and done share a colour on the web too — the
    /// distinction is in the glyph beside them, not the dot.
    var hex: String {
        switch self {
        case .onTime, .done: return "#10b981"
        case .behind:        return "#f59e0b"
        case .critical:      return "#ef4444"
        }
    }

    /// Assumed completion per status (:663). An unknown status counts as no
    /// progress, which is what the web's chained ternary falls through to.
    private static func assumedProgress(_ status: String) -> Double {
        switch status {
        case "Finished":    return 1
        case "In Progress": return 0.5
        case "On Hold":     return 0.25
        case "Pending":     return 0.15
        default:            return 0
        }
    }

    /// `start`, `end` and `today` are plain `yyyy-MM-dd` day strings, as the job
    /// records store them.
    static func of(status: String, start: String?, end: String?, today: String) -> JobHealth {
        if status == "Finished" { return .done }

        // Not Started is decided by the start date alone: past it is critical,
        // before it is fine. No elapsed-time maths applies to work that has not
        // begun.
        if status == "Not Started" {
            guard let start, let elapsed = dayDiff(from: start, to: today) else { return .onTime }
            return elapsed > 0 ? .critical : .onTime
        }

        // Undated work cannot be judged on time, so it is left alone rather than
        // being called critical for lacking a schedule.
        guard let start, let end,
              let total = dayDiff(from: start, to: end),
              let elapsed = dayDiff(from: start, to: today) else { return .onTime }

        // +1 on both, as the web does — a job starting and ending today is one
        // day long, not zero. `max(total, 1)` then guards a reversed window.
        let pctTime = min(Double(elapsed + 1) / Double(max(total + 1, 1)), 1)
        let pctDone = assumedProgress(status)

        // On Hold past halfway is critical BEFORE the margins are consulted: a
        // held job is not progressing at all, so the assumed 0.25 stops meaning
        // anything once the window is half gone.
        if status == "On Hold" && pctTime > 0.5 { return .critical }

        if pctTime > pctDone + 0.35 { return .critical }
        if pctTime > pctDone + 0.15 { return .behind }
        return .onTime
    }

    // MARK: Day maths
    //
    // `diffD` (:532) parses both ends at NOON to sidestep DST: a midnight-anchored
    // subtraction lands on 23 or 25 hours across a transition and rounds to the
    // wrong day.

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'12:00:00"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static func noon(_ day: String) -> Date? {
        guard !day.isEmpty else { return nil }
        return dayFormatter.date(from: day + "T12:00:00")
    }

    private static func dayDiff(from a: String, to b: String) -> Int? {
        guard let da = noon(a), let db = noon(b) else { return nil }
        return Int((db.timeIntervalSince(da) / 86_400).rounded())
    }
}
