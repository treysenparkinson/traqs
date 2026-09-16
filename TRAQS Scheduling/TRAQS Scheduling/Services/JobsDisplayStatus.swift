import Foundation

// MARK: - The status a row SHOWS, which is not always the status it stores
//
// `getOpDisplayStatus` (TRAQS.jsx:5925) and `getPanelDisplayStatus` (:5946).
//
// The grid's Status pill is derived, not stored. An operation with hours against
// it reads "In Progress" while somebody is clocked into it and "Paused" once they
// clock out — neither of which is ever written to `op.status`. A panel then rolls
// its operations' DISPLAY statuses up rather than reporting its own stored one,
// which is only a fallback for a panel with no operations at all.
//
// Without this the Mac showed the raw stored value at levels 1 and 2, so a panel
// with logged hours and a live clock on it read "Not Started".
//
// `Paused` is the reason this is its own type rather than `JobStatus`. It is a
// DISPLAY-ONLY value: it is not in `STATUSES`, nothing ever writes it, and it
// cannot be picked from the status popover. Folding it into `JobStatus` would put
// it in `allCases` and therefore into every picker on both platforms.
//
// Pure, with the clock lookup passed in — same convention as `JobsProgress` and
// `HoursCalculator`, and for the same reason: this is the directory the test
// target compiles, so the rule is checkable without a view or a network.

enum JobsDisplayStatus: Equatable {
    case stored(JobStatus)
    /// Hours logged against the row and nobody clocked in. `DEFAULT_STA_C` gives
    /// it On Hold's amber and On Hold's emblem.
    case paused

    /// The web's own string, so a pill's label needs no second table.
    var label: String {
        switch self {
        case .stored(let s): return s.rawValue
        case .paused:        return "Paused"
        }
    }

    /// `DEFAULT_STA_C["Paused"] === "#f59e0b"` — the same amber as On Hold.
    var hex: String {
        switch self {
        case .stored(let s): return s.hex
        case .paused:        return "#f59e0b"
        }
    }

    /// `DEFAULT_STA_ICON["Paused"] === "◕"`, again On Hold's.
    var emblem: String {
        switch self {
        case .stored(let s): return s.emblem
        case .paused:        return "\u{25D5}"   // ◕
        }
    }

    /// The stored status this display value came from, or nil for `paused` —
    /// which has none, and is what the status popover has to fall back from when
    /// it asks "which row is ticked".
    var stored: JobStatus? {
        if case .stored(let s) = self { return s } else { return nil }
    }
}

enum JobsStatusRollup {

    /// `getOpDisplayStatus`, with ONE deliberate divergence — see below.
    ///
    /// `logged` is the greater of the op's own `loggedHours` counter and its
    /// production-hours rollup: the web's `(op.loggedHours || 0) > 0 ||
    /// producedFor(op) > 0`, which tests both because the two disagree when a
    /// session's credit is lost to a concurrent tasks.json save.
    ///
    /// `clockedIn` answers "is anybody's clock naming this row right now". The
    /// web resolves that with `sameId(jc.opId ?? jc.panelId ?? jc.jobId, op.id)`
    /// — the DEEPEST id the clock carries — so a panel-level clock marks the
    /// panel, not one of its operations.
    ///
    /// THE DIVERGENCE: a status somebody picked by hand wins over "Paused".
    ///
    /// The web's order is `Finished > (logged > 0 ? clocked : Paused) > stored`,
    /// so the stored status is unreachable on any operation with hours against
    /// it. That makes the grid's status dropdown a control that writes a value
    /// you cannot see — pick "On Hold" on an op somebody has worked and the cell
    /// keeps saying "Paused". Reported as a bug, and it is one: a dropdown that
    /// does nothing visible is indistinguishable from a broken one.
    ///
    /// So the order here is:
    ///
    ///   1. Finished        — objective, and a finished op with hours is not Paused
    ///   2. a live clock    — objective: work IS happening right now
    ///   3. a stored status other than Not Started — somebody chose it
    ///   4. Paused          — hours against it and nobody on it
    ///   5. Not Started
    ///
    /// "Not Started" is what stands for "nobody has said anything", which is why
    /// it is the only stored value the derivation is allowed to overrule.
    ///
    /// Step 2 is also slightly ahead of the web, which only consults the clock
    /// once `logged > 0`: an op just clocked into with no hours banked yet reads
    /// "Not Started" there. The web's own comment says it is trying to catch
    /// exactly that case and is defeated by its counter.
    static func display(status: JobStatus, logged: Double,
                        clockedIn: Bool) -> JobsDisplayStatus {
        if status == .finished { return .stored(.finished) }
        if clockedIn           { return .stored(.inProgress) }
        if status != .notStarted { return .stored(status) }
        return logged > 0 ? .paused : .stored(status)
    }

    /// `getPanelDisplayStatus`, with the same divergence as `display`.
    ///
    /// A panel with NO operations reads its own logged time exactly as an
    /// operation's is read, rather than falling through to its stored status —
    /// the web's comment says why: a panel with hours against it and someone
    /// clocked in reported "Not Started".
    ///
    /// With operations, the web rolls them up and IGNORES `panel.status`
    /// entirely, so picking a status on a panel row writes a field nothing ever
    /// displays. Here the rollup keeps precedence only where it is objectively
    /// right, and a picked status wins otherwise:
    ///
    ///   1. every operation Finished — the panel IS done, whatever anyone typed
    ///   2. the panel's OWN reading, when it says anything at all
    ///   3. the web's rollup order: in-progress > paused > on-hold > pending >
    ///      any-other-started > not-started
    ///
    /// Rule 1 is what stops a panel that was set to "In Progress" months ago from
    /// still claiming it after every operation under it has been signed off.
    ///
    /// Rule 2 is `ownDisplay` — the panel run through `display` above — rather
    /// than its stored status, and that is load-bearing rather than tidy: it
    /// already resolves a live clock and a picked status against each other in the
    /// right order, so a panel somebody is clocked INTO reads "In Progress" even
    /// though the clock names no operation. The web drops that case entirely: with
    /// operations present it rolls them up and never looks at the panel's own
    /// clock, so a panel being worked directly reads "Paused".
    ///
    /// `Not Started` is again the one value that means "nobody has said anything",
    /// and only then do the operations speak for the panel.
    static func rollup(ownDisplay: JobsDisplayStatus,
                       operations: [JobsDisplayStatus]) -> JobsDisplayStatus {
        guard !operations.isEmpty else { return ownDisplay }

        if operations.allSatisfy({ $0 == .stored(.finished) }) { return .stored(.finished) }
        if ownDisplay != .stored(.notStarted) { return ownDisplay }

        if operations.contains(.stored(.inProgress)) { return .stored(.inProgress) }
        if operations.contains(.paused)              { return .paused }
        if operations.contains(.stored(.onHold))     { return .stored(.onHold) }
        if operations.contains(.stored(.pending))    { return .stored(.pending) }
        // "any other started" — anything that is not Not Started, which after the
        // tests above can only be Finished on a panel that is not ALL finished.
        if operations.contains(where: { $0 != .stored(.notStarted) }) {
            return .stored(.inProgress)
        }
        return .stored(.notStarted)
    }
}

// MARK: - Every row's display status, in one pass
//
// The same shape as `JobsProgress.Index`, and here for the same reason: the grid
// asks for a figure at all three levels on every redraw, and a per-cell
// derivation would re-walk the operations under each panel once per panel and
// scan the roster once per operation.
//
// `Equatable` and a plain value, so handing it to a few hundred cells costs a
// retain, and a redraw in which nothing clocked in or out compares equal.

extension JobsDisplayStatus {

    struct Index: Equatable {
        private(set) var byID: [String: JobsDisplayStatus] = [:]

        init() {}

        /// Falls back to the row's own stored status for anything not walked —
        /// an id from another page, or one that has gone away since.
        func status(_ id: String, fallback: JobStatus) -> JobsDisplayStatus {
            byID[id] ?? .stored(fallback)
        }

        fileprivate mutating func set(_ id: String, _ value: JobsDisplayStatus) {
            byID[id] = value
        }
    }

    /// Display statuses for every job, panel and operation, keyed by id.
    ///
    /// `logged` is the operation's logged-hours figure — `max(loggedHours,
    /// producedFor(op))` in the app, a literal in a test. `clockedOn` answers
    /// whether a clock names that id.
    ///
    /// A JOB's own pill is NOT derived: the web reads `item.status` straight at
    /// level 0 (`level === 2 ? getOpDisplayStatus : level === 1 ?
    /// getPanelDisplayStatus : (item.status || "Not Started")`), so a job is
    /// written into the index as stored and the cells need no level test.
    static func index(for jobs: [Job],
                      logged: (Operation) -> Double,
                      clockedOn: (String) -> Bool) -> Index {
        var index = Index()

        for job in jobs {
            index.set(job.id, .stored(job.status))

            for panel in job.subs {
                var operationStatuses: [JobsDisplayStatus] = []
                operationStatuses.reserveCapacity(panel.subs.count)

                for op in panel.subs {
                    let value = JobsStatusRollup.display(status: op.status,
                                                         logged: logged(op),
                                                         clockedIn: clockedOn(op.id))
                    index.set(op.id, value)
                    operationStatuses.append(value)
                }

                // The panel read AS IF it were an operation, which is what
                // `getOpDisplayStatus(panel)` does for a panel with no ops. A
                // panel carries no `loggedHours` of its own in this model, so the
                // only thing that can lift it off its stored status is a clock
                // naming it directly.
                let own = JobsStatusRollup.display(status: panel.status, logged: 0,
                                                   clockedIn: clockedOn(panel.id))

                index.set(panel.id,
                          JobsStatusRollup.rollup(ownDisplay: own,
                                                  operations: operationStatuses))
            }
        }
        return index
    }
}
