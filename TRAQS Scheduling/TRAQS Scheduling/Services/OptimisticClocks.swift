import Foundation

/// Preserving a clock the user JUST changed across a wholesale `people`
/// overwrite.
///
/// Every clock action on this device writes its result into `people`
/// OPTIMISTICALLY, on the tap's own frame, so the card moves before the network
/// round-trip. Two paths then replace the whole `people` array from elsewhere:
/// `loadAll()` (network GET) and `rehydrateFromCache()` (local cache after a
/// delta sync). Either can be carrying data that predates the tap — the org
/// channel is busy, and any member's punch, message or job edit triggers a sync
/// on this device — and a plain assignment rolls the tap back:
///
///   * `activeJobClock` gone → the job card snaps from TRACKING to LOG TIME,
///     which reads as "the button didn't take" and gets tapped again.
///   * `activeClockIn` gone → `myShiftStatus` and `liveShiftHours` read that
///     field DIRECTLY, so the shift card flips to offline and the live hours
///     (and the pay-period total built on them) drop to zero, then jump back
///     when the next delta restores the field.
///
/// `loadAll()` carried this guard inline; `rehydrateFromCache()` did not, which
/// is what made both of the above intermittent. It lives here as one pure
/// implementation so the two paths cannot drift again.
///
/// The server stays authoritative — the snapshot only outranks incoming data
/// for `graceWindow` seconds after the tap, which is the window the write needs
/// to commit and come back around through sync.
enum OptimisticClocks {

    /// The current user's three clock fields as of the moment of capture.
    ///
    /// A nil field is meaningful, not missing: an optimistic clock-OUT is a nil
    /// clock and has to survive the overwrite exactly like a clock-IN, or STOP
    /// glitches back to TRACKING when stale data lands.
    struct Snapshot: Equatable {
        let personId: String
        let jobClock: ActiveJobClock?
        let activeBreak: ActiveBreak?
        let payClock: ActiveClockIn?
    }

    /// How long a local clock tap outranks incoming server/cache data.
    static let graceWindow: TimeInterval = 12

    /// Capture the current user's clocks, but only while a change made on this
    /// device is still settling. `changedAt` is `AppState.clockChangeAt`, bumped
    /// by every optimistic clock mutation.
    ///
    /// Returns nil when there's nothing to protect — no recorded change, no
    /// current person, or the change is old enough that the server's copy is
    /// the better answer.
    static func capture(person: Person?,
                        changedAt: Date?,
                        now: Date = Date(),
                        window: TimeInterval = graceWindow) -> Snapshot? {
        guard let person, let changedAt, now.timeIntervalSince(changedAt) < window else { return nil }
        return Snapshot(personId: person.id,
                        jobClock: person.activeJobClock,
                        activeBreak: person.activeBreak,
                        payClock: person.activeClockIn)
    }

    /// Re-apply a captured snapshot onto an incoming roster. Every other person
    /// is left alone — their clocks are the server's to report. A roster that no
    /// longer contains the snapshot's person passes through untouched rather
    /// than having a row invented for it.
    static func apply(_ snapshot: Snapshot?, to people: [Person]) -> [Person] {
        guard let snapshot,
              let idx = people.firstIndex(where: { $0.id == snapshot.personId }) else { return people }
        var out = people
        out[idx].activeJobClock = snapshot.jobClock
        out[idx].activeBreak = snapshot.activeBreak
        out[idx].activeClockIn = snapshot.payClock
        return out
    }
}
