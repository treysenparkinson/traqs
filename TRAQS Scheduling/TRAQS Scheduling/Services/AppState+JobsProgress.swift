import Foundation

// MARK: - The Jobs grid's percentages
//
// `JobsProgress` does the walk; this supplies the one thing it cannot be pure
// about — an operation's hours pair, which reads the production-hours rollup and
// whatever job clock is running right now.
//
// The reason this is a method and not three calls to `jobPct` / `panelPct` /
// `opPct` is a performance bug that made expanding a job row take about a
// second. Two things were wrong and this fixes both:
//
//  1. THE WALK RAN THREE TIMES. `jobPct` flat-maps every operation in the job and
//     sums their hours; `panelPct` then walks the same operations again per
//     panel; `opPct` a third time per operation. The grid asks for all three
//     levels, so every redraw paid for the same arithmetic three times over, plus
//     one array allocation per job for the flat-map.
//
//  2. EVERY OPERATION SCANNED THE WHOLE ROSTER. `opHoursPair` needs to know
//     whether a clock is running on that operation, and the only way to ask was
//     `people.first { $0.activeJobClock?.opId == op.id }` — a linear scan of every
//     person, per operation, per redraw. At a few hundred operations and a few
//     dozen people that is tens of thousands of comparisons to discover that
//     almost always nobody is clocked in.
//
// So the roster is indexed ONCE per pass, `Date()` is read ONCE per pass, and the
// walk happens ONCE. `AppState.jobPct` and friends stay where they are — other
// screens ask for a single figure and the scan is the right shape for that.

extension AppState {

    /// Every percentage the Jobs grid shows, for every level, in one pass.
    ///
    /// Call this ONCE per redraw and hand the result down. It deliberately walks
    /// collapsed branches too: a figure that does not depend on what is expanded
    /// cannot make expanding something recompute it, which is the whole fix.
    func jobsProgressIndex(for jobs: [Job]) -> JobsProgress.Index {
        // Once, not once per operation — see (2) above.
        let clocks = activeClocksByOperation()
        let now = Date()
        let defaultHpd = orgSettings.hpd

        return JobsProgress.index(for: jobs) { op in
            HoursCalculator.opHoursPair(
                status: op.status,
                hpd: op.hpd,
                loggedHours: op.loggedHours,
                producedHours: self.producedFor(op: op),
                defaultHpd: defaultHpd,
                liveElapsed: clocks[op.id].map {
                    HoursCalculator.liveElapsedHours(clockIn: $0.clockIn,
                                                     totalPausedMs: $0.totalPausedMs,
                                                     now: now)
                } ?? 0)
        }
    }

    /// Running job clocks, keyed by the operation they are running against.
    ///
    /// A clock with no `opId` is clocked into a job or a panel rather than an
    /// operation, and contributes to no operation's hours — the same rows the
    /// scan this replaces skipped by never matching. A blank `clockIn` is a
    /// half-written record and is skipped for the same reason.
    ///
    /// Last writer wins if two people are somehow on the same operation, which is
    /// what `first(where:)` did in the other order. It is not a case the data is
    /// supposed to produce.
    func activeClocksByOperation() -> [String: ActiveJobClock] {
        var index: [String: ActiveJobClock] = [:]
        for person in people {
            guard let clock = person.activeJobClock,
                  let opID = clock.opId, !opID.isEmpty,
                  !clock.clockIn.isEmpty else { continue }
            index[opID] = clock
        }
        return index
    }
}
