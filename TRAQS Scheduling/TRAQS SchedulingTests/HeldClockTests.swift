import Testing
import Foundation
@testable import TRAQS_Scheduling

// #521 (#283's iOS twin). A job clock HELD for a pending finish request (`frozenAtMs`)
// stops — the web's `liveElapsedHours` measures to min(now, frozen), and measures an
// open pause against that same instant so a hold landed mid-pause doesn't keep
// deducting. iOS took no hold, so a held session kept climbing on the phone's live hours
// and progress bars.
@Suite("A held job clock stops, as on the web (#521)")
struct HeldClockTests {
    private func iso(_ h: Int, _ m: Int = 0) -> String { String(format: "2026-10-13T%02d:%02d:00.000Z", h, m) }
    private func at(_ h: Int, _ m: Int = 0) -> Date { Date.fromFlexibleISO8601(iso(h, m))! }
    private func ms(_ h: Int, _ m: Int = 0) -> Double { at(h, m).timeIntervalSince1970 * 1000 }

    @Test("held at 10:00, seen at 12:00: 2 hours, not 4")
    func stopsAtTheHold() {
        let h = HoursCalculator.liveElapsedHours(clockIn: iso(8), pausedAt: nil, totalPausedMs: 0,
                                                 frozenAtMs: ms(10), now: at(12))
        #expect(abs(h - 2) < 1e-9)
    }

    @Test("a pause open when the hold landed stops being deducted at the hold")
    func pauseMeasuredToTheHold() {
        let h = HoursCalculator.liveElapsedHours(clockIn: iso(8), pausedAt: iso(9, 30), totalPausedMs: 0,
                                                 frozenAtMs: ms(10), now: at(12))
        #expect(abs(h - 1.5) < 1e-9)
    }

    @Test("not held: unchanged")
    func notHeld() {
        let h = HoursCalculator.liveElapsedHours(clockIn: iso(8), pausedAt: nil, totalPausedMs: 0,
                                                 frozenAtMs: nil, now: at(12))
        #expect(abs(h - 4) < 1e-9)
    }

    @Test("a hold in the future (clock skew) doesn't extend anything")
    func futureHold() {
        let h = HoursCalculator.liveElapsedHours(clockIn: iso(8), pausedAt: nil, totalPausedMs: 0,
                                                 frozenAtMs: ms(14), now: at(12))
        #expect(abs(h - 4) < 1e-9)
    }
}
