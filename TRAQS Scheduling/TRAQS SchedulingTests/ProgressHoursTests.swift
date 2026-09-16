import Testing
import Foundation
@testable import TRAQS_Scheduling

/// Hours-weighted progress: an op worked past its estimate has to READ past its
/// estimate.
///
/// The reported bug: the progress bar sat just under 100% on jobs that were
/// demonstrably over, and the only place the real overrun showed was the desktop's
/// right-click "Set Worked Hours" dialog. The percentage maths was never capped —
/// the input was. iOS read the cumulative `loggedHours` counter alone, and that
/// counter drifts BELOW the job-clock session rows, so an overrun could never
/// cross 100%.
struct ProgressHoursTests {

    // MARK: - The reported symptom

    /// 10.08h of sessions against an 8h estimate is 126%. Reading the drifted
    /// counter (8.2h) instead reported 103% — and with a smaller drift, under 100%.
    @Test func sessionRowsCarryTheOverrunWhenTheCounterHasDrifted() {
        let pair = HoursCalculator.opHoursPair(
            status: .inProgress, hpd: 8, loggedHours: 8.2,
            producedHours: 10.08, defaultHpd: 8, liveElapsed: 0)
        #expect(abs(pair.logged - 10.08) < 0.001)
        #expect(abs(pair.est - 8) < 0.001)

        let pct = Int((pair.logged / pair.est * 100).rounded())
        #expect(pct == 126, "expected 126%, got \(pct)%")
    }

    /// The exact shape of the complaint: a counter that lands a hair under the
    /// estimate while the sessions are over it. Counter-only maths reads 98%.
    @Test func overrunIsNotHiddenBehindACounterStuckJustUnderFull() {
        let counterOnly = HoursCalculator.opHoursPair(
            status: .inProgress, hpd: 8, loggedHours: 7.85,
            producedHours: 0, defaultHpd: 8, liveElapsed: 0)
        #expect(Int((counterOnly.logged / counterOnly.est * 100).rounded()) == 98)

        let withSessions = HoursCalculator.opHoursPair(
            status: .inProgress, hpd: 8, loggedHours: 7.85,
            producedHours: 11.5, defaultHpd: 8, liveElapsed: 0)
        #expect(Int((withSessions.logged / withSessions.est * 100).rounded()) == 144)
    }

    // MARK: - The max() goes both ways

    /// "Set Worked Hours" credits the counter with no session row at all, and a
    /// non-admin only receives their OWN rows — so the counter must still win when
    /// it's the larger number.
    @Test func counterWinsWhenItExceedsTheVisibleSessionRows() {
        let pair = HoursCalculator.opHoursPair(
            status: .inProgress, hpd: 8, loggedHours: 12,
            producedHours: 3, defaultHpd: 8, liveElapsed: 0)
        #expect(abs(pair.logged - 12) < 0.001)
    }

    /// No session rows on hand → behaves exactly as it did before the change.
    @Test func absentSessionRowsDegradeToTheOldBehaviour() {
        let pair = HoursCalculator.opHoursPair(
            status: .inProgress, hpd: 8, loggedHours: 5,
            producedHours: 0, defaultHpd: 8, liveElapsed: 0)
        #expect(abs(pair.logged - 5) < 0.001)
    }

    /// A live session stacks on top of the resolved total rather than replacing it.
    @Test func liveElapsedAddsToTheGreaterOfTheTwo() {
        let pair = HoursCalculator.opHoursPair(
            status: .inProgress, hpd: 8, loggedHours: 4,
            producedHours: 9, defaultHpd: 8, liveElapsed: 1.5)
        #expect(abs(pair.logged - 10.5) < 0.001)
    }

    /// Completion still pins to exactly the estimate, so a job closed under budget
    /// reads 100% and one closed over doesn't stay amber.
    @Test func finishedStillPinsToTheEstimate() {
        let pair = HoursCalculator.opHoursPair(
            status: .finished, hpd: 8, loggedHours: 2,
            producedHours: 40, defaultHpd: 8, liveElapsed: 5)
        #expect(abs(pair.logged - 8) < 0.001)
        #expect(abs(pair.est - 8) < 0.001)
    }

    /// Negative counters can't drag progress below zero.
    @Test func negativeCounterIsFloored() {
        let pair = HoursCalculator.opHoursPair(
            status: .inProgress, hpd: 8, loggedHours: -5,
            producedHours: 0, defaultHpd: 8, liveElapsed: 0)
        #expect(pair.logged >= 0)
    }

    // MARK: - The scope rollup feeding it

    private func session(id: String, job: String, panel: String?, op: String?, hours: Double?) -> JobSession {
        let obj: [String: Any?] = [
            "id": id, "personId": "p1", "jobId": job,
            "panelId": panel, "opId": op, "hours": hours,
        ]
        let data = try! JSONSerialization.data(
            withJSONObject: obj.compactMapValues { $0 == nil ? nil : $0! })
        return try! JSONDecoder().decode(JobSession.self, from: data)
    }

    /// Hours land in all three scopes at once, so an op bar counts its own
    /// sessions while the job bar counts every session beneath it.
    @Test func rollupTotalsEveryScope() {
        let scopes = StatsMath.producedHoursByScope([
            session(id: "s1", job: "j1", panel: "pn1", op: "op1", hours: 4),
            session(id: "s2", job: "j1", panel: "pn1", op: "op1", hours: 2.5),
            session(id: "s3", job: "j1", panel: "pn2", op: "op2", hours: 3),
        ])
        #expect(abs((scopes.byOp["op1"] ?? 0) - 6.5) < 0.001)
        #expect(abs((scopes.byOp["op2"] ?? 0) - 3) < 0.001)
        #expect(abs((scopes.byPanel["pn1"] ?? 0) - 6.5) < 0.001)
        #expect(abs((scopes.byJob["j1"] ?? 0) - 9.5) < 0.001)
    }

    /// A panel-level punch carries no opId — it must still count toward its job
    /// rather than being dropped or landing under a bogus key.
    @Test func rowsWithoutAnOpStillCountTowardTheirJob() {
        let scopes = StatsMath.producedHoursByScope([
            session(id: "s1", job: "j1", panel: "pn1", op: nil, hours: 5),
        ])
        #expect(scopes.byOp.isEmpty)
        #expect(abs((scopes.byJob["j1"] ?? 0) - 5) < 0.001)
    }

    /// Zero / missing hours contribute nothing and don't create empty keys.
    @Test func zeroAndMissingHoursAreIgnored() {
        let scopes = StatsMath.producedHoursByScope([
            session(id: "s1", job: "j1", panel: "pn1", op: "op1", hours: 0),
            session(id: "s2", job: "j1", panel: "pn1", op: "op1", hours: nil),
        ])
        #expect(scopes.byOp.isEmpty)
        #expect(scopes.byJob.isEmpty)
    }

    @Test func emptyInputRollsUpToNothing() {
        #expect(StatsMath.producedHoursByScope([]) == StatsMath.ProducedScopes.empty)
    }
}
