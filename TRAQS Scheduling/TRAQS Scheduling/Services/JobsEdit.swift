import Foundation

// MARK: - One grid edit, applied to a job tree
//
// `updTask(id, fields, pid)` (TRAQS.jsx) — the Jobs grid's single write path. The
// web reaches into the tree by id and patches whatever it finds; this splits that
// into WHERE (a path) and WHAT (a field), so the reach is written once and every
// cell's edit goes through it.
//
// Pure: a Job in, a Job out. Persisting is the caller's job, which is what makes
// the reach testable — see JobsEditTests. A wrong edit here silently rewrites the
// wrong operation, and that is not something to find out from a screenshot.

/// Which node in a job's tree an edit lands on.
enum JobsEditPath: Equatable {
    case job
    case panel(String)
    case operation(panel: String, op: String)
}

enum JobsEdit {

    /// One field, with its new value. An enum rather than a dictionary because
    /// the web's `{ [col]: val }` is stringly-typed — `updTask(id, { stat: ... })`
    /// is a silent no-op there, and a case cannot be misspelled.
    enum Field: Equatable {
        case title(String)
        case jobNumber(String)
        case status(JobStatus)
        case priority(Priority)
        case start(String)
        case end(String)
        /// nil clears it. Only a job has one.
        case dueDate(String?)
    }

    /// Whether a field is editable at a given level, matching the web's own
    /// per-cell guards. Worth stating once rather than as an `if level == 0`
    /// scattered through the cells:
    ///
    ///   * title    — every level (`onDoubleClick` has no level guard)
    ///   * jobNumber, dueDate — level 0 only; a panel has neither
    ///   * status   — every level, through the popover
    ///   * priority — level 0 only (`if (level === 0) cyclePri(item)`)
    ///   * start/end — every level
    static func isEditable(_ field: Field, atLevel level: Int) -> Bool {
        switch field {
        case .title, .status, .start, .end:  return true
        case .jobNumber, .dueDate, .priority: return level == 0
        }
    }

    /// The job with `field` applied at `path`. Returns it unchanged when the path
    /// does not resolve — a panel deleted by an inbound sync between the click and
    /// the commit must not throw away the rest of the tree.
    static func apply(_ field: Field, at path: JobsEditPath, in job: Job) -> Job {
        var job = job
        switch path {
        case .job:
            applyToJob(field, &job)

        case .panel(let panelID):
            guard let pi = job.subs.firstIndex(where: { $0.id == panelID }) else { return job }
            applyToPanel(field, &job.subs[pi])

        case .operation(let panelID, let opID):
            guard let pi = job.subs.firstIndex(where: { $0.id == panelID }),
                  let oi = job.subs[pi].subs.firstIndex(where: { $0.id == opID })
            else { return job }
            applyToOperation(field, &job.subs[pi].subs[oi])
        }
        return job
    }

    private static func applyToJob(_ field: Field, _ job: inout Job) {
        switch field {
        case .title(let v):     job.title = v
        // Trimmed and emptied to nil: the web stores "" and then prints "#" with
        // nothing after it. `jobNumber` is optional here, so absent means absent.
        case .jobNumber(let v):
            let t = v.trimmingCharacters(in: .whitespaces)
            job.jobNumber = t.isEmpty ? nil : t
        case .status(let v):    job.status = v
        case .priority(let v):  job.pri = v
        case .start(let v):     job.start = v
        case .end(let v):       job.end = v
        case .dueDate(let v):
            let t = v?.trimmingCharacters(in: .whitespaces)
            job.dueDate = (t?.isEmpty ?? true) ? nil : t
        }
    }

    private static func applyToPanel(_ field: Field, _ panel: inout Panel) {
        switch field {
        case .title(let v):    panel.title = v
        case .status(let v):   panel.status = v
        case .priority(let v): panel.pri = v
        case .start(let v):    panel.start = v
        case .end(let v):      panel.end = v
        // A panel has no number and no due date. Ignored rather than stored on
        // some other field — `isEditable` already stops the cell from offering it.
        case .jobNumber, .dueDate: break
        }
    }

    private static func applyToOperation(_ field: Field, _ op: inout Operation) {
        switch field {
        case .title(let v):    op.title = v
        case .status(let v):   op.status = v
        case .priority(let v): op.pri = v
        case .start(let v):    op.start = v
        case .end(let v):      op.end = v
        case .jobNumber, .dueDate: break
        }
    }

    /// Whether an edit actually changed anything.
    ///
    /// This cannot be `a != b`. `Job`'s `==` is `lhs.id == rhs.id` (Models.swift),
    /// deliberately, so job arrays diff by identity — which makes it useless for
    /// "did this edit change a field". The comparison has to be on the encoded
    /// value, and Job holds only scalars and arrays, so the encoding is stable.
    ///
    /// Worth having: a picker reopened and confirmed on the same day, or a field
    /// committed on blur without being touched, would otherwise push a pointless
    /// entry onto the undo stack and make Cmd-Z do nothing visible.
    static func differs(_ a: Job, _ b: Job) -> Bool {
        guard let ea = try? JSONEncoder().encode(a),
              let eb = try? JSONEncoder().encode(b) else { return true }
        return ea != eb
    }

    // MARK: Cycling

    /// `cyclePri` — clicking the cell steps to the next priority and wraps.
    static func nextPriority(after current: Priority) -> Priority {
        let all = Priority.allCases
        let i = all.firstIndex(of: current) ?? 0
        return all[(i + 1) % all.count]
    }

    /// Whether choosing this status has to go through the completion-approval flow
    /// instead of being written straight in.
    ///
    /// The web routes EVERY move to Finished through "Request Completion", which
    /// notifies the admins rather than closing the job (:26530). So the grid can
    /// never set Finished directly, at any level — a status popover that appeared
    /// to close a job without the request would quietly skip an approval step
    /// somebody depends on.
    static func needsCompletionRequest(_ status: JobStatus) -> Bool {
        status == .finished
    }

    // MARK: Removing

    /// The job with the node at `path` taken out.
    ///
    /// `nil` means "the job itself" — the caller removes it from the array, since
    /// a Job cannot delete itself. Everything else comes back as a job with one
    /// panel or one operation fewer.
    ///
    /// A path that no longer resolves returns the job UNCHANGED rather than
    /// throwing. An inbound sync between the right-click and the confirmation can
    /// remove the node already, and deleting nothing is the correct outcome
    /// there; a throw would be a dialog about a row that is already gone.
    static func removing(_ path: JobsEditPath, from job: Job) -> Job? {
        switch path {
        case .job:
            return nil
        case .panel(let panelID):
            var job = job
            job.subs.removeAll { $0.id == panelID }
            return job
        case .operation(let panelID, let opID):
            var job = job
            guard let i = job.subs.firstIndex(where: { $0.id == panelID }) else { return job }
            job.subs[i].subs.removeAll { $0.id == opID }
            return job
        }
    }

    // MARK: Dependency mode

    /// The three states a panel's operations can be linked in, and what each one
    /// writes. Ported from the toggle at TRAQS.jsx:28016 — the important part is
    /// that the MODE and the per-operation `deps` are written TOGETHER, because
    /// the web reads both and they disagree if only one is set.
    ///
    ///   * `free`     — the mode is cleared and every op's `deps` is emptied.
    ///   * `unlocked` — every op depends on all its siblings. The web writes the
    ///                  full sibling list on each op, not a chain.
    ///   * `locked`   — the mode is set and `deps` is left exactly as it is.
    ///
    /// `depsMode` is not a modelled field; it rides on `Panel.extras`. See
    /// `JSONExtras` — before that existed, this write was destroyed on save.
    static func settingDependencyMode(_ mode: String?, panelID: String,
                                      in job: Job) -> Job {
        var job = job
        guard let i = job.subs.firstIndex(where: { $0.id == panelID }) else { return job }

        switch mode {
        case "unlocked":
            let all = job.subs[i].subs.map(\.id)
            job.subs[i].extras.set("depsMode", .string("unlocked"))
            for k in job.subs[i].subs.indices {
                let me = job.subs[i].subs[k].id
                job.subs[i].subs[k].deps = all.filter { $0 != me }
            }
        case "locked":
            job.subs[i].extras.set("depsMode", .string("locked"))
        default:
            // Removing the key, not writing null — the web tests it with a bare
            // truthiness check and `undefined` is what it writes to clear it.
            job.subs[i].extras.set("depsMode", nil)
            for k in job.subs[i].subs.indices { job.subs[i].subs[k].deps = [] }
        }
        return job
    }

    /// The mode a panel is currently in.
    static func dependencyMode(of panel: Panel) -> String? {
        panel.extras.string("depsMode")
    }
}

// MARK: - Where a row sits in its job

extension JobRow {

    /// The id of the JOB this row belongs to — the record that actually gets
    /// saved, whichever level the row is.
    var jobID: String {
        switch self {
        case .job(let j):                   return j.id
        case .panel(_, let jid, _):         return jid
        case .operation(_, let jid, _, _):  return jid
        }
    }

    var editPath: JobsEditPath {
        switch self {
        case .job:                              return .job
        case .panel(let p, _, _):               return .panel(p.id)
        case .operation(let o, _, let pid, _):  return .operation(panel: pid, op: o.id)
        }
    }
}
