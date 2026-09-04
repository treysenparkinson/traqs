import Foundation

// MARK: - Everything the Jobs grid derives, cached
//
// The grid hands each cell a `JobsCellContext` so no cell reads AppState. That
// was right and it had a cost nobody had measured: the context was REBUILT on
// every body pass, so its dictionaries never shared storage, so `Dictionary ==`
// could not short-circuit on identity and walked every element — once per cell,
// and again per row and per section.
//
// Measured, 5000 rows of data across 2400 cells, release build:
//
//     comparing a context that SHARES storage        0.03 ms
//     comparing one rebuilt with equal contents    830.97 ms
//
// A frame is 16 ms. Every click that touched page state — expanding a row,
// starting an edit, opening a menu — paid the 831 ms, which is what "laggy
// inputs" was.
//
// So the derived data lives in a CLASS, built once per change and handed out by
// reference. `JobsCellContext` then compares it with `===`, which is a pointer
// test whatever the data is. Recomputed only when `dataRevision` moves, which
// `AppState` bumps from a `didSet` on jobs, people, clients and org settings.
//
// Immutable by construction — every property is `let`, so a box handed to a few
// hundred cells cannot change under them.

final class JobsCellIndices {
    let clientsByID: [String: Client]
    let peopleByID: [String: Person]
    /// Progress per row, every level, expanded or not — see `JobsProgress`.
    let percent: JobsProgress.Index
    /// What each row's Status pill SHOWS — see `JobsDisplayStatus`.
    let displayStatus: JobsDisplayStatus.Index
    /// Approval chains and the Activity line, from one walk — see `JobsApproval`.
    let approval: [String: ApprovalState]
    let activity: [String: ApprovalActivity]
    /// Jobs still waiting in TRAQS Cloud. Their Start and End cells read PENDING.
    let scheduledLater: Set<String>

    /// The empty one, for a page with nothing on it yet.
    static let empty = JobsCellIndices()

    private init() {
        clientsByID = [:]; peopleByID = [:]
        percent = JobsProgress.Index()
        displayStatus = JobsDisplayStatus.Index()
        approval = [:]; activity = [:]; scheduledLater = []
    }

    fileprivate init(clientsByID: [String: Client], peopleByID: [String: Person],
                     percent: JobsProgress.Index,
                     displayStatus: JobsDisplayStatus.Index,
                     approval: [String: ApprovalState],
                     activity: [String: ApprovalActivity],
                     scheduledLater: Set<String>) {
        self.clientsByID = clientsByID
        self.peopleByID = peopleByID
        self.percent = percent
        self.displayStatus = displayStatus
        self.approval = approval
        self.activity = activity
        self.scheduledLater = scheduledLater
    }
}

extension AppState {

    /// The grid's derived data, rebuilt only when something it reads has changed.
    ///
    /// Called from `JobsPage.body`, so it must be cheap on the common path — and
    /// on the common path it is a single `Int` comparison.
    func jobsCellIndices() -> JobsCellIndices {
        if let cached = cachedCellIndices, cachedCellIndicesRevision == dataRevision {
            return cached
        }

        var clientsByID: [String: Client] = [:]
        clientsByID.reserveCapacity(clients.count)
        for client in clients { clientsByID[client.id] = client }

        var peopleByID: [String: Person] = [:]
        peopleByID.reserveCapacity(people.count)
        for person in people { peopleByID[person.id] = person }

        let approval = jobsApprovalIndex(for: jobs)

        let built = JobsCellIndices(
            clientsByID: clientsByID,
            peopleByID: peopleByID,
            percent: jobsProgressIndex(for: jobs),
            displayStatus: jobsDisplayStatusIndex(for: jobs),
            approval: approval.states,
            activity: approval.activity,
            scheduledLater: Set(jobs.filter(JobsCellIndices.isScheduledLater).map(\.id)))

        cachedCellIndices = built
        cachedCellIndicesRevision = dataRevision
        return built
    }
}

extension JobsCellIndices {
    /// `t.scheduledLater`. Unmodelled — it rides on `Job.extras`, and the server
    /// has written it as both a bool and the string "true".
    static func isScheduledLater(_ job: Job) -> Bool {
        switch job.extras["scheduledLater"] {
        case .bool(let b):   return b
        case .string(let s): return s == "true"
        default:             return false
        }
    }
}
