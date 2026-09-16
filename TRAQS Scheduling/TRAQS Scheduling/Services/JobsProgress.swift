import Foundation

// MARK: - Every percentage on the Jobs grid, in one pass
//
// The Progress column shows a figure at all three levels, and the ratio behind
// all three is the same one: logged hours over estimated hours across the
// operations underneath. `AppState.jobPct`, `panelPct` and `opPct` each compute
// it independently, which means asking for a job's figure and then its panels'
// walks the same operations three times and pays for the same hours pair three
// times over.
//
// That was fine while the grid asked for one figure at a time. It stopped being
// fine when the grid started asking for ALL of them on every redraw: expanding a
// single job re-ran the whole walk for every job on the page, and the page took
// about a second to open the row.
//
// So: ONE walk, bottom up, each operation's hours pair computed exactly once and
// summed into its panel and its job on the way past. The result is a flat
// `[id: percent]` for every level, which is what the cells actually want.
//
// Pure, with the hours pair passed in — same convention as JobsQuery and
// HoursCalculator, and for the same reason: this is the directory the test target
// compiles, so the rule can be checked without a view, a clock or a network.

enum JobsProgress {

    /// Percentages for every job, panel and operation, keyed by id.
    ///
    /// `Equatable` and a plain value, so handing it to a few hundred cells costs
    /// a retain rather than a walk, and a redraw that did not change any hours
    /// compares equal.
    struct Index: Equatable {
        private(set) var byID: [String: Int] = [:]

        /// Spelled out rather than left to the memberwise initialiser: with a
        /// `private(set)` stored property the synthesised one is not reliably
        /// reachable from another file, and `Index()` is called from the view
        /// layer as the empty default.
        init() {}

        /// 0 for anything not walked — an id from another page, or one that has
        /// gone away since. The cells treat "no figure" and "nothing logged" the
        /// same way, which is what the web does with `_jobPct` on a missing row.
        subscript(id: String) -> Int { byID[id] ?? 0 }

        fileprivate mutating func set(_ id: String, _ pct: Int) { byID[id] = pct }
    }

    /// `hours` is `(logged, estimated)` for one operation — `AppState.opHoursPair`
    /// in the app, a literal in a test.
    ///
    /// Every level is walked, expanded or not. That looks wasteful next to only
    /// walking what is on screen, and it is the point: a figure that does not
    /// depend on what is expanded cannot make expanding something recompute it.
    /// One pass over every operation is cheap; a pass per redraw per level was
    /// not.
    static func index(for jobs: [Job],
                      hours: (Operation) -> (logged: Double, est: Double)) -> Index {
        var index = Index()

        for job in jobs {
            var jobLogged = 0.0, jobEst = 0.0, jobOpCount = 0

            for panel in job.subs {
                var panelLogged = 0.0, panelEst = 0.0

                for op in panel.subs {
                    let pair = hours(op)
                    panelLogged += pair.logged
                    panelEst += pair.est
                    index.set(op.id, percent(status: op.status,
                                             logged: pair.logged, est: pair.est,
                                             hasChildren: true))
                }

                jobLogged += panelLogged
                jobEst += panelEst
                jobOpCount += panel.subs.count

                index.set(panel.id, percent(status: panel.status,
                                            logged: panelLogged, est: panelEst,
                                            hasChildren: !panel.subs.isEmpty))
            }

            index.set(job.id, percent(status: job.status,
                                      logged: jobLogged, est: jobEst,
                                      hasChildren: jobOpCount > 0))
        }

        return index
    }

    /// The one rule, shared by all three levels.
    ///
    /// Finished pins to exactly 100 — without it a job closed while an operation
    /// sat at 140% would stay amber after completion, and "overdue until it is
    /// completed" is the whole point of the ramp. Everything else is UNCAPPED:
    /// 130 means 30% past the estimate and still open.
    ///
    /// `hasChildren` is what separates "nothing logged" from "nothing to log". A
    /// panel with no operations reports 0 rather than dividing by an estimate it
    /// does not have; an operation is its own unit of work, so it always counts.
    private static func percent(status: JobStatus, logged: Double, est: Double,
                                hasChildren: Bool) -> Int {
        if status == .finished { return 100 }
        guard hasChildren, est > 0, logged > 0 else { return 0 }
        return Int((logged / est * 100).rounded())
    }
}
