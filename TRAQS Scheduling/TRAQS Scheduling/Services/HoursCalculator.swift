import Foundation

/// Hours math, lifted out of AppState.
///
/// Every function here is a pure function of its arguments — no AppState, no
/// `people`, no `orgSettings`, no implicit `Date()`. Callers pass `now`, which
/// is what makes these testable: the live-elapsed calculations were previously
/// unassertable because they read the wall clock internally.
///
/// This is a relocation, not a rewrite. Each function is the body that used to
/// sit on AppState, with the state it closed over turned into a parameter.
/// AppState now supplies those values and keeps its original signatures, so no
/// call site outside this file changed.
enum HoursCalculator {

    // MARK: Pause accounting

    /// Paid-time pause total, in milliseconds.
    ///
    /// LUNCH ONLY — breaks are deliberately not deducted from pay (see 84295a2:
    /// a 9h window minus a 60min lunch is the 8h paid day; a worker taking two
    /// 15-minute breaks would otherwise read 7.5h). Breaks come out of
    /// PRODUCTION time instead.
    ///
    /// An open lunch is closed at `end`, exactly as the server does at clock-out.
    static func payPausedMs(_ events: [ClockEvent], end: Date) -> Double {
        var paused = 0.0
        var lunchOpen: Date?
        for ev in events {
            guard let t = Date.fromFlexibleISO8601(ev.ts) else { continue }
            switch ev.type {
            case "lunchStart": lunchOpen = t
            case "lunchEnd":   if let l = lunchOpen { paused += max(0, t.timeIntervalSince(l) * 1000); lunchOpen = nil }
            default: break
            }
        }
        if let l = lunchOpen { paused += max(0, end.timeIntervalSince(l) * 1000) }
        return paused
    }

    // MARK: Job / production hours

    /// Hours accrued on an open job clock, net of paused time.
    /// Returns 0 for a clock that never started or is currently paused out.
    static func liveElapsedHours(clockIn: String, totalPausedMs: Double?, now: Date) -> Double {
        guard let started = Date.fromFlexibleISO8601(clockIn) else { return 0 }
        let elapsedH = now.timeIntervalSince(started) / 3600
        let pausedH = (totalPausedMs ?? 0) / 3_600_000
        return max(0, elapsedH - pausedH)
    }

    /// (logged, estimated) for an operation.
    ///
    /// A finished op reports its full estimate as logged, so progress reads 100%
    /// rather than whatever the timer happened to capture. `liveElapsed` is the
    /// caller's contribution from any clock currently running on this op.
    static func opHoursPair(status: JobStatus, hpd: Double, loggedHours: Double?,
                            defaultHpd: Double, liveElapsed: Double) -> (logged: Double, est: Double) {
        let est = max(0.0001, hpd > 0 ? hpd : defaultHpd)
        if status == .finished { return (est, est) }
        return ((loggedHours ?? 0) + liveElapsed, est)
    }

    // MARK: Pay hours

    /// Hours on the current open pay shift, net of lunch.
    static func liveShiftHours(clockIn: String, events: [ClockEvent], now: Date,
                               parse: (String) -> Date?) -> Double {
        guard let start = parse(clockIn) else { return 0 }
        let totalMs = now.timeIntervalSince(start) * 1000
        return max(0, (totalMs - payPausedMs(events, end: now)) / 3_600_000)
    }

    /// Sum of completed pay entries whose clock-in falls inside `[from, to)`.
    ///
    /// `resolve` maps an entry to its effective timestamp — callers differ in
    /// whether they can fall back to a date-only field, so that stays theirs.
    static func sumEntries<Entry>(_ entries: [Entry], from: Date, to: Date,
                                  resolve: (Entry) -> Date?,
                                  hours: (Entry) -> Double) -> Double {
        entries.reduce(0.0) { acc, e in
            guard let d = resolve(e) else { return acc }
            return (d >= from && d < to) ? acc + hours(e) : acc
        }
    }

    /// Sum of completed pay entries falling on one calendar day.
    static func sumEntriesOnDay<Entry>(_ entries: [Entry], day: Date,
                                       calendar: Calendar = .current,
                                       resolve: (Entry) -> Date?,
                                       hours: (Entry) -> Double) -> Double {
        entries.reduce(0.0) { acc, e in
            guard let d = resolve(e) else { return acc }
            return calendar.isDate(d, inSameDayAs: day) ? acc + hours(e) : acc
        }
    }
}
