import Foundation

/// The hold on the Delete Account confirmation. Removing yourself from the org
/// is not undoable from the app, so the destructive button stays disabled and
/// visibly counts down before it accepts a tap.
///
/// Pure math with the clock passed in, so the view owns the timer and this
/// stays testable.
enum DeleteAccountCountdown {

    /// How long the confirm button stays disabled.
    static let holdSeconds = 10

    /// Whole seconds still owed before the button arms, clamped to 0...holdSeconds.
    /// A partial second counts as unelapsed, and a clock that moves backwards
    /// returns the full hold rather than a negative or oversized count.
    static func remaining(startedAt: Date, now: Date) -> Int {
        let elapsed = now.timeIntervalSince(startedAt)
        guard elapsed > 0 else { return holdSeconds }
        let whole = Int(elapsed.rounded(.down))
        return max(0, holdSeconds - whole)
    }

    static func isArmed(startedAt: Date, now: Date) -> Bool {
        remaining(startedAt: startedAt, now: now) == 0
    }

    static func label(remaining: Int) -> String {
        remaining > 0 ? "Delete Account (\(remaining))" : "Delete Account"
    }
}
