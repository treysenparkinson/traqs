import Foundation

extension Date {
    /// Parse an ISO8601 timestamp tolerant of fractional seconds.
    ///
    /// The Netlify functions emit timestamps via JavaScript's
    /// `new Date().toISOString()`, which always includes milliseconds
    /// (`2026-05-22T19:30:00.123Z`). Swift's default `ISO8601DateFormatter`
    /// silently fails on that input unless `.withFractionalSeconds` is set —
    /// which is why the live job-clock counter on the Tasks tab showed "—"
    /// the moment the auto-refresh replaced our optimistic clockIn (written
    /// without fractions) with the server's canonical one. This helper
    /// tries fractional first and falls back to no-fractions so every
    /// callsite can stop worrying about the format.
    /// Memoised. `ISO8601DateFormatter.date(from:)` builds its underlying
    /// CFDateFormatter on EVERY parse — Time Profiler on device shows
    /// `CFDateFormatterCreate` / `icu::DateFormatSymbols` /
    /// `ures_getAllItemsWithFallback` inside this call even though the formatter
    /// objects below are cached statics. Caching the formatter isn't enough; the
    /// only fix is to not call it.
    ///
    /// That matters because callers parse the SAME immutable strings over and
    /// over: `MoreView.efficiencyDays` walks every pay entry and job session
    /// three times per render, inside a 1-second timeline. Timestamps are
    /// immutable, so a string→Date map is always valid.
    static func fromFlexibleISO8601(_ string: String) -> Date? {
        ISO8601ParseCache.parse(string)
    }

    /// Uncached parse — the actual ICU work, called once per distinct string.
    fileprivate static func parseISO8601Uncached(_ string: String) -> Date? {
        if let d = isoFractional.date(from: string) { return d }
        return isoPlain.date(from: string)
    }

    /// Canonical ISO8601 string with fractional seconds — byte-compatible with
    /// the server's `new Date().toISOString()`. Use this for every timestamp we
    /// stamp locally (message sends, read cursors, read marks) so optimistic
    /// values sort and parse identically to server values. A plain formatter
    /// (no fractions) produces e.g. "…05Z", which STRING-sorts after the
    /// server's "…05.123Z" and fails `fromFlexibleISO8601`'s fractional parse —
    /// the source of out-of-order optimistic bubbles.
    static func isoString(_ date: Date) -> String { isoFractional.string(from: date) }

    /// Convenience for "now" as a canonical fractional ISO8601 string.
    static func nowISO() -> String { isoFractional.string(from: Date()) }

    /// Plain ISO8601 (no fractional seconds) from a CACHED formatter.
    ///
    /// Constructing an `ISO8601DateFormatter` loads ICU locale resource bundles
    /// (`DateFormatSymbols` / `ures_getAllItemsWithFallback`) — Time Profiler on
    /// device showed that construction, not formatting, dominating main-thread
    /// time. Never write `ISO8601DateFormatter().string(from:)` inline; use this.
    static func isoPlainString(_ date: Date) -> String { isoPlain.string(from: date) }

    /// Date-only ISO8601 ("yyyy-MM-dd"), cached for the same reason.
    static func fromISOFullDate(_ string: String) -> Date? {
        isoFullDate.date(from: string) ?? isoPlain.date(from: string)
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = ISO8601DateFormatter()

    private static let isoFullDate: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        return f
    }()
}

/// String→Date memo for ISO8601 timestamps.
///
/// Locked rather than main-actor-bound because `fromFlexibleISO8601` is called
/// from both view bodies and background sync code.
private enum ISO8601ParseCache {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [String: Date] = [:]

    static func parse(_ s: String) -> Date? {
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[s] { return hit }
        guard let d = Date.parseISO8601Uncached(s) else { return nil }   // nil isn't cached
        // Backstop against unbounded growth over a very long session.
        if cache.count > 20_000 { cache.removeAll(keepingCapacity: true) }
        cache[s] = d
        return d
    }
}

extension DateFormatter {
    /// A cached formatter for a DISPLAY format string (e.g. "MMM d").
    ///
    /// Constructing a `DateFormatter` loads ICU locale resource bundles —
    /// Time Profiler on device repeatedly showed `CFDateFormatterCreate` /
    /// `icu::DateFormatSymbols` at the top of the main thread from exactly this
    /// pattern (`let f = DateFormatter(); f.dateFormat = …` inside a view body).
    ///
    /// Unlike the fixed-format PARSERS, which pin `en_US_POSIX` for correctness,
    /// these keep the device locale so month and day names stay localized. The
    /// key includes the locale so changing region at runtime can't serve a
    /// stale formatter.
    static func display(_ format: String) -> DateFormatter {
        let locale = Locale.current
        let key = "\(format)|\(locale.identifier)"
        displayLock.lock()
        defer { displayLock.unlock() }
        if let hit = displayCache[key] { return hit }
        let f = DateFormatter()
        f.locale = locale
        f.dateFormat = format
        displayCache[key] = f
        return f
    }

    private static let displayLock = NSLock()
    nonisolated(unsafe) private static var displayCache: [String: DateFormatter] = [:]
}

enum AppConfig {
    static let netlifyBase = "https://traqs.netlify.app/.netlify/functions"

    /// Feature flag: gate the "must be clocked in to work a job" + "can't clock
    /// out while on a job" rules. DISABLED for now — flip to true to re-enable
    /// (also flip ENFORCE_CLOCK_JOB_DEPENDENCY in timeclock.js + TRAQS.jsx).
    static let enforceClockJobDependency = false

    enum Auth0 {
        static let domain = "matrixpci.us.auth0.com"
        static let clientId = "xnuXY9QAr8VaB7so8DfBHydUgTgKbGtt"
        static let audience = "https://traqs.matrixsystems.com/api"
        static let callbackScheme = "TRAQS.TRAQS-Scheduling"
        static let redirectURI = "TRAQS.TRAQS-Scheduling://callback"
        static let scope = "openid profile email offline_access"

        static var authorizationURL: URL {
            URL(string: "https://\(domain)/authorize")!
        }
        static var tokenURL: URL {
            URL(string: "https://\(domain)/oauth/token")!
        }
    }
}
