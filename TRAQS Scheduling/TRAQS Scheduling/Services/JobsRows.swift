import Foundation

// MARK: - One row of the Jobs grid
//
// The grid is three levels deep — job, panel, operation — and the web renders all
// three through one `GridRow` that duck-types whatever it is handed
// (TRAQS.jsx:11962). Swift cannot, so the three become cases of one enum and the
// per-level differences become computed properties on it.
//
// That turns out to be the better shape anyway: every "what does this column show
// at level 2" answer lives on the row rather than being re-derived inside each
// cell, which is where the web's version repeats itself.

enum JobRow: Identifiable, Equatable {
    case job(Job)
    /// `jobColor` travels down because the web colours a panel's and an op's
    /// assignee with the JOB's colour, not their own.
    case panel(Panel, jobID: String, jobColor: String)
    case operation(Operation, jobID: String, panelID: String, jobColor: String)

    var id: String {
        switch self {
        case .job(let j):                 return j.id
        // Prefixed, because a panel and its job can share an id in imported data
        // and a duplicate id in a ForEach silently drops rows.
        case .panel(let p, let jid, _):   return "\(jid)/\(p.id)"
        case .operation(let o, let jid, let pid, _): return "\(jid)/\(pid)/\(o.id)"
        }
    }

    /// The row's own id, without the ancestry. What edits and expansion key off.
    var itemID: String {
        switch self {
        case .job(let j):             return j.id
        case .panel(let p, _, _):    return p.id
        case .operation(let o, _, _, _): return o.id
        }
    }

    /// 0 = job, 1 = panel, 2 = operation. `indent` is `level * 20` on the web.
    var level: Int {
        switch self {
        case .job:       return 0
        case .panel:     return 1
        case .operation: return 2
        }
    }

    var title: String {
        switch self {
        case .job(let j):             return j.title
        case .panel(let p, _, _):     return p.title
        case .operation(let o, _, _, _): return o.title
        }
    }

    var status: JobStatus {
        switch self {
        case .job(let j):             return j.status
        case .panel(let p, _, _):     return p.status
        case .operation(let o, _, _, _): return o.status
        }
    }

    var priority: Priority {
        switch self {
        case .job(let j):             return j.pri
        case .panel(let p, _, _):     return p.pri
        case .operation(let o, _, _, _): return o.pri
        }
    }

    var start: String {
        switch self {
        case .job(let j):             return j.start
        case .panel(let p, _, _):     return p.start
        case .operation(let o, _, _, _): return o.start
        }
    }

    var end: String {
        switch self {
        case .job(let j):             return j.end
        case .panel(let p, _, _):     return p.end
        case .operation(let o, _, _, _): return o.end
        }
    }

    var team: [String] {
        switch self {
        case .job(let j):             return j.team
        case .panel(let p, _, _):     return p.team
        case .operation(let o, _, _, _): return o.team
        }
    }

    /// The colour the row's assignee is tinted with — the JOB's, at every level.
    var jobColor: String {
        switch self {
        case .job(let j):                return j.color
        case .panel(_, _, let c):        return c
        case .operation(_, _, _, let c): return c
        }
    }

    var childCount: Int {
        switch self {
        case .job(let j):             return j.subs.count
        case .panel(let p, _, _):     return p.subs.count
        case .operation:              return 0
        }
    }

    var hasChildren: Bool { childCount > 0 }

    /// Estimated hours for this row's own level.
    var estimatedHours: Double {
        switch self {
        case .job(let j):             return JobsQuery.estimatedHours(of: j)
        case .panel(let p, _, _):     return JobsQuery.estimatedHours(of: p)
        case .operation(let o, _, _, _): return JobsQuery.estimatedHours(of: o)
        }
    }

    /// Only a job carries these — a panel and an op have no client, number or due
    /// date of their own, and the web leaves those cells blank rather than
    /// inheriting the job's.
    var job: Job? { if case .job(let j) = self { return j } else { return nil } }

    /// Total ops beneath this row, and how many are finished. What the Progress
    /// column's "3/8 ops" counter reports.
    var finishedAndTotalOps: (finished: Int, total: Int) {
        switch self {
        case .job(let j):
            let ops = j.subs.flatMap(\.subs)
            return (ops.filter { $0.status == .finished }.count, ops.count)
        case .panel(let p, _, _):
            return (p.subs.filter { $0.status == .finished }.count, p.subs.count)
        case .operation:
            return (0, 0)
        }
    }
}

extension JobRow {

    /// The grid's rows, in draw order, with only the expanded branches walked.
    ///
    /// `expanded` holds the ids of rows whose children are showing — jobs and
    /// panels both, keyed by `itemID` as the web's `expandedJobs` is. A collapsed
    /// job's panels are not produced at all rather than produced and hidden, so
    /// nothing pays to lay out a thousand invisible operations.
    static func flatten(_ jobs: [Job], expanded: Set<String>) -> [JobRow] {
        var out: [JobRow] = []
        out.reserveCapacity(jobs.count)
        for job in jobs {
            out.append(.job(job))
            guard expanded.contains(job.id) else { continue }
            for panel in job.subs {
                out.append(.panel(panel, jobID: job.id, jobColor: job.color))
                guard expanded.contains(panel.id) else { continue }
                for op in panel.subs {
                    out.append(.operation(op, jobID: job.id, panelID: panel.id,
                                          jobColor: job.color))
                }
            }
        }
        return out
    }
}
