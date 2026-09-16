import Testing
import Foundation
@testable import TRAQS_Scheduling

// `getHealth` (src/TRAQS.jsx:656) — the dot on every job row. Its rules are not
// obvious from the output, which is why they are pinned here rather than left to
// be re-derived from a colour.
@Suite("Job health")
struct JobHealthTests {

    /// Every case passes `today` in, so none of these depend on when they run.
    private let today = "2026-03-10"

    // MARK: The status short-circuits

    @Test func finishedIsAlwaysDone() {
        // Even a job whose window ended months ago.
        #expect(JobHealth.of(status: "Finished", start: "2025-01-01", end: "2025-01-05",
                             today: today) == .done)
    }

    @Test func notStartedPastItsStartDateIsCritical() {
        #expect(JobHealth.of(status: "Not Started", start: "2026-03-01", end: "2026-03-20",
                             today: today) == .critical)
    }

    @Test func notStartedBeforeItsStartDateIsOnTime() {
        #expect(JobHealth.of(status: "Not Started", start: "2026-03-20", end: "2026-03-30",
                             today: today) == .onTime)
    }

    // MARK: The time-vs-progress comparison
    //
    // Each status carries an assumed completion — In Progress 0.5, On Hold 0.25,
    // Pending 0.15 — and health is how far elapsed TIME has run ahead of it.

    @Test func inProgressEarlyInItsWindowIsOnTime() {
        // 1 of 20 days elapsed = 0.05 against an assumed 0.5. Well ahead.
        #expect(JobHealth.of(status: "In Progress", start: "2026-03-10", end: "2026-03-29",
                             today: today) == .onTime)
    }

    @Test func inProgressPastHalfPlusFifteenIsBehind() {
        // 14 of 20 days = 0.70 against 0.5 → over the 0.15 margin, under 0.35.
        #expect(JobHealth.of(status: "In Progress", start: "2026-02-25", end: "2026-03-16",
                             today: today) == .behind)
    }

    @Test func inProgressPastHalfPlusThirtyFiveIsCritical() {
        // 18 of 20 days = 0.90 against 0.5 → past the 0.35 margin.
        #expect(JobHealth.of(status: "In Progress", start: "2026-02-21", end: "2026-03-12",
                             today: today) == .critical)
    }

    // On Hold has its own rule ABOVE the margin comparison: past halfway is
    // critical outright, because a held job is not progressing at all.
    @Test func onHoldPastHalfwayIsCriticalRegardlessOfMargins() {
        // 11 of 20 days = 0.55. The margin test alone would say behind (0.55 vs
        // 0.25 + 0.35 = 0.60), so this asserts the earlier rule wins.
        #expect(JobHealth.of(status: "On Hold", start: "2026-02-28", end: "2026-03-19",
                             today: today) == .critical)
    }

    @Test func onHoldBeforeHalfwayFallsThroughToTheMargins() {
        // 3 of 20 days = 0.15 against 0.25. Inside every margin.
        #expect(JobHealth.of(status: "On Hold", start: "2026-03-08", end: "2026-03-27",
                             today: today) == .onTime)
    }

    // MARK: Degenerate windows
    //
    // `total` is divided by, so a zero- or negative-length window must not blow up.

    @Test func aSingleDayWindowDoesNotDivideByZero() {
        let h = JobHealth.of(status: "In Progress", start: today, end: today, today: today)
        #expect(h == .onTime || h == .behind || h == .critical)   // any answer but a crash
    }

    @Test func missingDatesFallBackRatherThanCrashing() {
        #expect(JobHealth.of(status: "In Progress", start: "", end: "", today: today) == .onTime)
        #expect(JobHealth.of(status: "In Progress", start: nil, end: nil, today: today) == .onTime)
    }

    @Test func anUnknownStatusIsTreatedAsNoProgress() {
        // pctDone 0, so any elapsed time past 0.35 is critical.
        #expect(JobHealth.of(status: "Sasquatch", start: "2026-02-21", end: "2026-03-12",
                             today: today) == .critical)
    }
}
