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
    static func fromFlexibleISO8601(_ string: String) -> Date? {
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

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = ISO8601DateFormatter()
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
