import Foundation

/// The members page's open/close sequence, as a state machine (2026-10-14).
///
/// Opening and closing each take several passes and an animation. Nothing used
/// to stop a second tap mid-way: tapping the pill while the page was closing let
/// the close's completion run AFTER the new open had begun, and it hid the page
/// that had just opened ("the group page sometimes disappears"). A request that
/// arrives mid-transition is now ignored rather than interleaved.
struct MembersTransition: Equatable {
    enum Phase: Equatable { case closed, opening, open, closing }
    private(set) var phase: Phase = .closed

    /// True when an open may start; moves to `.opening`.
    mutating func requestOpen() -> Bool {
        guard phase == .closed else { return false }
        phase = .opening
        return true
    }

    mutating func didOpen() {
        if phase == .opening { phase = .open }
    }

    /// True when a close may start; moves to `.closing`.
    mutating func requestClose() -> Bool {
        guard phase == .open else { return false }
        phase = .closing
        return true
    }

    mutating func didClose() {
        if phase == .closing { phase = .closed }
    }
}
