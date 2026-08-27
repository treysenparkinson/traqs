import Foundation

extension String {
    /// Parse a `yyyy-MM-dd` schedule date.
    ///
    /// The formatter is a CACHED static. It used to be constructed on every
    /// call, and this is called from inside nested loops over
    /// people × jobs × panels × ops (see `MoreView.assignedHours` →
    /// `taskOverlaps`) on views that re-render every 1–5 seconds. Time Profiler
    /// on device attributed ~850ms of main-thread time to `CFDateFormatterCreate`
    /// from this one line — constructing a DateFormatter loads ICU locale
    /// resource bundles, which costs far more than the parse itself.
    ///
    /// `en_US_POSIX` is the documented locale for parsing a FIXED format: it
    /// stops a device set to a non-Gregorian calendar from misreading these
    /// dates. Time zone is deliberately left as the device default so these keep
    /// resolving to local midnight, matching the `Calendar.current` comparisons
    /// everywhere else. (AppState already uses en_US_POSIX for this same format.)
    var asDate: Date? { ScheduleDateParser.parse(self) }
}

/// Parses `yyyy-MM-dd` schedule dates, memoised by string.
///
/// Caching the FORMATTER wasn't enough. `MoreView.assignedHours` runs once per
/// worker and each run walks every job → panel → op, so the same handful of
/// date strings were being re-parsed once per worker — ~20× redundant work per
/// render, on a view that re-renders every 1–5 seconds. Time Profiler still
/// showed `CFDateFormatterCreate` under `DateFormatter.getObjectValue` after the
/// formatter was cached, so the parse call itself is not cheap either.
///
/// Distinct strings are few (schedule dates repeat heavily across tasks), so a
/// dictionary turns the whole nested loop into hash lookups.
enum ScheduleDateParser {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [String: Date] = [:]

    /// `en_US_POSIX` is the documented locale for parsing a FIXED format — it
    /// stops a device on a non-Gregorian calendar from misreading these dates.
    /// Time zone stays the device default so they resolve to local midnight,
    /// matching the `Calendar.current` comparisons used everywhere else.
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ s: String) -> Date? {
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[s] { return hit }
        guard let d = formatter.date(from: s) else { return nil }
        // Schedule dates are bounded in practice; this is a backstop, not a policy.
        if cache.count > 10_000 { cache.removeAll(keepingCapacity: true) }
        cache[s] = d
        return d
    }
}
