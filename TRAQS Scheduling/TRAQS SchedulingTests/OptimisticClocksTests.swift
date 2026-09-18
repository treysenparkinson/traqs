import Testing
import Foundation
@testable import TRAQS_Scheduling

/// The rule that keeps a clock tap on screen: a wholesale `people` overwrite —
/// from `loadAll()`'s network GET or from `rehydrateFromCache()`'s cache read —
/// must not roll back a clock the user JUST changed on this device.
///
/// The bug these pin down: `rehydrateFromCache()` assigned `people` straight
/// from the cache with no such guard, so any delta-sync triggered while a
/// clock-in was still in flight (another member's punch, a message, a job edit
/// — the org channel is busy) wiped the optimistic `activeJobClock` and the job
/// card snapped from TRACKING back to LOG TIME. The same overwrite cleared
/// `activeClockIn`, which `myShiftStatus` and `liveShiftHours` read DIRECTLY,
/// so the shift went "offline" and the live hours dropped to zero and back.
///
/// The interesting cases are the ones where the snapshot must NOT win: past the
/// grace window, and for a person who isn't in the incoming roster at all.
struct OptimisticClocksTests {

    private let me = "p1"
    private let t0 = Date(timeIntervalSince1970: 1_780_000_000)

    private func person(_ id: String,
                        job: ActiveJobClock? = nil,
                        pay: ActiveClockIn? = nil,
                        brk: ActiveBreak? = nil) -> Person {
        Person(id: id, name: "Person \(id)", role: "", email: "", cap: 8,
               color: "#000000", userRole: "user",
               activeClockIn: pay, activeJobClock: job, activeBreak: brk)
    }

    private var jobClock: ActiveJobClock {
        ActiveJobClock(clockIn: "2026-05-22T19:30:00.000Z", jobId: "j1",
                       panelId: "pn1", opId: "op1", jobTitle: "Job One")
    }

    private var payClock: ActiveClockIn {
        ActiveClockIn(clockIn: "2026-05-22T15:00:00.000Z", jobRefs: [], events: [], source: "ios-app")
    }

    // MARK: - capture

    @Test("A clock change made just now is captured")
    func capturesInsideWindow() {
        let snap = OptimisticClocks.capture(person: person(me, job: jobClock, pay: payClock),
                                            changedAt: t0, now: t0.addingTimeInterval(2))
        #expect(snap?.personId == me)
        #expect(snap?.jobClock == jobClock)
        #expect(snap?.payClock == payClock)
    }

    @Test("A clock change older than the grace window is not captured")
    func ignoresOutsideWindow() {
        let snap = OptimisticClocks.capture(person: person(me, job: jobClock),
                                            changedAt: t0,
                                            now: t0.addingTimeInterval(OptimisticClocks.graceWindow + 0.5))
        #expect(snap == nil)
    }

    @Test("No clock change recorded → nothing to preserve")
    func ignoresNilChangedAt() {
        #expect(OptimisticClocks.capture(person: person(me, job: jobClock), changedAt: nil, now: t0) == nil)
    }

    @Test("No current person → nothing to preserve")
    func ignoresNilPerson() {
        #expect(OptimisticClocks.capture(person: nil, changedAt: t0, now: t0) == nil)
    }

    /// An optimistic clock-OUT is a nil clock, and it has to survive the
    /// overwrite exactly like a clock-IN does — otherwise STOP glitches back to
    /// TRACKING when stale data lands.
    @Test("A cleared clock is still a snapshot, not an absence of one")
    func capturesClearedClock() {
        let snap = OptimisticClocks.capture(person: person(me), changedAt: t0, now: t0)
        #expect(snap != nil)
        #expect(snap?.jobClock == nil)
        #expect(snap?.payClock == nil)
    }

    // MARK: - apply

    @Test("The snapshot is re-applied over an incoming roster that predates the tap")
    func reappliesOverStaleRoster() {
        let snap = OptimisticClocks.capture(person: person(me, job: jobClock, pay: payClock),
                                            changedAt: t0, now: t0)
        let incoming = [person(me), person("p2")]          // cache row: no clocks yet
        let merged = OptimisticClocks.apply(snap, to: incoming)
        #expect(merged.first(where: { $0.id == me })?.activeJobClock == jobClock)
        #expect(merged.first(where: { $0.id == me })?.activeClockIn == payClock)
    }

    /// The whole point of the fix: what the old `rehydrateFromCache` did.
    @Test("Without a snapshot the stale roster wins — the regression this guards")
    func staleRosterWinsWithoutSnapshot() {
        let incoming = [person(me), person("p2")]
        let merged = OptimisticClocks.apply(nil, to: incoming)
        #expect(merged.first(where: { $0.id == me })?.activeJobClock == nil)
    }

    @Test("An optimistic clock-OUT is re-applied over a roster that still shows the shift open")
    func reappliesClearedClock() {
        let snap = OptimisticClocks.capture(person: person(me), changedAt: t0, now: t0)
        let incoming = [person(me, job: jobClock, pay: payClock)]
        let merged = OptimisticClocks.apply(snap, to: incoming)
        #expect(merged.first(where: { $0.id == me })?.activeJobClock == nil)
        #expect(merged.first(where: { $0.id == me })?.activeClockIn == nil)
    }

    @Test("Only the snapshot's own person is touched")
    func leavesOtherPeopleAlone() {
        let snap = OptimisticClocks.capture(person: person(me, job: jobClock), changedAt: t0, now: t0)
        let otherClock = ActiveJobClock(clockIn: "2026-05-22T18:00:00.000Z", jobId: "j9")
        let merged = OptimisticClocks.apply(snap, to: [person(me), person("p2", job: otherClock)])
        #expect(merged.first(where: { $0.id == "p2" })?.activeJobClock == otherClock)
        #expect(merged.count == 2)
    }

    /// A roster that no longer contains me (deleted, or a partial slice) must
    /// pass through untouched rather than have a row invented for it.
    @Test("A roster without the snapshot's person passes through unchanged")
    func rosterMissingPersonIsUnchanged() {
        let snap = OptimisticClocks.capture(person: person(me, job: jobClock), changedAt: t0, now: t0)
        let incoming = [person("p2")]
        #expect(OptimisticClocks.apply(snap, to: incoming).count == 1)
        #expect(OptimisticClocks.apply(snap, to: incoming).first?.activeJobClock == nil)
    }
}
