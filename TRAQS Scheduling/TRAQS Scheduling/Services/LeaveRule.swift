import Foundation

/// Which time-off entries make a day a day off — the web's `countsAsLeave` / `leaveOn`
/// (src/timeOff.js), so the day view and the web agree about what a PTO day is (#252).
///
/// An entry counts when it has NO status (entries an admin types in directly) or its status
/// is "approved"; a pending or denied request does not. `status` reaches iOS through
/// `TimeOffEntry.extras` (#522) — before that it was dropped on decode.
///
/// Pure: same pattern as OverlapRule and WorkDayClock.
enum LeaveRule {
    static func counts(_ entry: TimeOffEntry) -> Bool {
        switch entry.extras["status"] {
        case nil, .null?:              return true
        case .string("approved")?:     return true
        default:                       return false
        }
    }

    /// The first entry that counts as leave and covers `day` ("YYYY-MM-DD"), ends inclusive.
    static func leave(on day: String, in entries: [TimeOffEntry]) -> TimeOffEntry? {
        entries.first { counts($0) && $0.start <= day && $0.end >= day }
    }
}
