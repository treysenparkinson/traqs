import Foundation

// MARK: - The Jobs list, filtered and sorted
//
// Ported from `filtered` (src/TRAQS.jsx:7474), `activeTasks` (:10827),
// `sortTasks` (:10800) and `jobMatchesSearch`.
//
// Pure, with every lookup passed in — no AppState, no clock. Same convention as
// JobHealth, HoursCalculator and StatsMath, and here for the same reason: this is
// the directory the iOS test target compiles, so the rules that decide which jobs
// a person sees are testable without a view or a network. See JobsQueryTests.

/// Which columns the Jobs grid has, in the web's own order. `STD_COL_DEFS`
/// (TRAQS.jsx:98) — the `i` there is the index into `colWidths`, which is why the
/// widths below are not simply in declaration order on the web.
enum JobColumn: String, CaseIterable, Identifiable, Equatable {
    case name, jobNum, client, status, pri, start, end, due, hrs, progress, team

    var id: String { rawValue }

    var label: String {
        switch self {
        case .name:     return "Name"
        case .jobNum:   return "#"
        case .client:   return "Client"
        case .status:   return "Status"
        case .pri:      return "Priority"
        case .start:    return "Start"
        case .end:      return "End"
        case .due:      return "Due"
        case .hrs:      return "Hrs"
        case .progress: return "Progress"
        case .team:     return "Team"
        }
    }

    enum Align { case leading, center, trailing }

    var align: Align {
        switch self {
        case .pri:  return .center
        case .hrs:  return .trailing
        default:    return .leading
        }
    }

    /// `colWidths` (TRAQS.jsx:4815) — `[26, 200, 80, 120, 132, 80, 100, 100, 100,
    /// 70, 130, 140, 36]`, read at `1 + i`. The leading 26 and trailing 36 are the
    /// row-handle and add-column cells, not columns.
    var defaultWidth: CGFloat {
        switch self {
        case .name:     return 200
        case .jobNum:   return 80
        case .client:   return 120
        case .status:   return 132
        case .pri:      return 80
        case .start:    return 100
        case .end:      return 100
        case .due:      return 100
        case .hrs:      return 70
        case .progress: return 130
        case .team:     return 140
        }
    }

    /// The trailing "+" cell that opens the column picker. A column's worth of
    /// grid width with no column in it.
    static let addColumnWidth: CGFloat = 36
}

/// `fTimePeriod`. All three on means no period filtering at all.
enum JobTimePeriod: String, CaseIterable, Identifiable {
    case current, future, finished
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

/// What the Filter popover and the search field hold between them.
struct JobsFilter: Equatable {
    /// `fStat`. EMPTY means every status — the web's "All" chip clears the list
    /// rather than selecting each one.
    var statuses: Set<JobStatus> = []
    /// `fTimePeriod`. Starts with all three, i.e. filtering nothing.
    var timePeriods: Set<JobTimePeriod> = Set(JobTimePeriod.allCases)
    /// `fJobNum` — a substring of the job number, not an exact match.
    var jobNumber: String = ""
    /// `taskSearchQ`.
    var search: String = ""

    /// What the Filter button's badge counts (`activeFilterCount`). The search box
    /// is its own control with its own affordance, so it is not counted.
    var activeCount: Int {
        var n = 0
        if !statuses.isEmpty { n += 1 }
        if timePeriods.count < JobTimePeriod.allCases.count { n += 1 }
        if !jobNumber.isEmpty { n += 1 }
        return n
    }

    var isEmpty: Bool { activeCount == 0 && search.isEmpty }
}

/// `colSort`. `column == nil` is the web's third click: sorting off, back to the
/// default order.
struct JobsSort: Equatable {
    var column: JobColumn?
    var ascending: Bool = true

    /// One click sorts ascending, a second descending, a third clears it.
    func cycled(_ column: JobColumn) -> JobsSort {
        guard self.column == column else { return JobsSort(column: column, ascending: true) }
        return ascending ? JobsSort(column: column, ascending: false) : JobsSort(column: nil)
    }
}

enum JobsQuery {

    /// Everything the rules need that is not on a Job. Passed in rather than
    /// reached for, so a test can state the world in one literal.
    struct Context {
        /// `TD` — today as `yyyy-MM-dd`.
        var today: String
        var clientName: (String?) -> String = { _ in "" }
        var personName: (String) -> String = { _ in "" }
        /// `_jobPct`. Injected because the real one reads logged hours and live
        /// job clocks off AppState, which is not something to reproduce here.
        var percentComplete: (Job) -> Int = { _ in 0 }
    }

    // MARK: The list

    /// `activeTasks` (:10827): filtered, NOT finished, searched, then sorted.
    ///
    /// Finished jobs are excluded outright, exactly as the web does — they have
    /// their own `finishedTasks` list (:10826) built from the UNFILTERED jobs. So
    /// `.finished` in `timePeriods` cannot bring one back into this grid; it is
    /// the finished section's own switch.
    static func activeRows(_ jobs: [Job], filter: JobsFilter, sort: JobsSort,
                           context: Context) -> [Job] {
        let kept = jobs.filter { $0.status != .finished && matches($0, filter: filter, context: context) }
        return sorted(kept, by: sort, context: context)
    }

    // MARK: Sections
    //
    // The grid is NOT one table. The default view is one card per PROJECT
    // MANAGER (TRAQS.jsx:12269), each with its own column header — which is why
    // every job in a fresh org appears under a section headed "Unassigned".

    struct ManagerSection: Identifiable, Equatable {
        /// `"__none__"` for the unassigned section, matching the web's own key, so
        /// a collapse state stored against it survives a manager being assigned.
        let id: String
        /// nil = no project manager.
        let managerID: String?
        let jobs: [Job]

        static let unassignedID = "__none__"
        var isUnassigned: Bool { managerID == nil }
    }

    /// Sections in the order their managers FIRST APPEAR in `jobs` — not
    /// alphabetical, and not with unassigned pinned anywhere. The list is already
    /// sorted by whatever the user chose, so ordering sections by first
    /// appearance keeps the sections in that same order.
    static func managerSections(_ jobs: [Job]) -> [ManagerSection] {
        var order: [String] = []
        var buckets: [String: [Job]] = [:]
        for job in jobs {
            let key = job.projectManagerId.flatMap { $0.isEmpty ? nil : $0 }
                ?? ManagerSection.unassignedID
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(job)
        }
        return order.map { key in
            ManagerSection(id: key,
                           managerID: key == ManagerSection.unassignedID ? nil : key,
                           jobs: buckets[key] ?? [])
        }
    }

    /// `finishedTasks` (:10826), and it is deliberately built from the UNFILTERED
    /// jobs — the page's status, period and job-number filters do not apply to it.
    /// The web's own reading: the Finished section is an archive sitting under the
    /// working list, not a view of it.
    static func finishedRows(_ jobs: [Job], sort: JobsSort, context: Context) -> [Job] {
        sorted(jobs.filter { $0.status == .finished }, by: sort, context: context)
    }

    // MARK: Filtering

    static func matches(_ job: Job, filter: JobsFilter, context: Context) -> Bool {
        if !filter.statuses.isEmpty && !filter.statuses.contains(job.status) { return false }

        if !filter.jobNumber.isEmpty {
            let num = (job.jobNumber ?? "").lowercased()
            if !num.contains(filter.jobNumber.lowercased()) { return false }
        }

        if !searchMatches(job, filter.search, context: context) { return false }

        // Skipped entirely when all three are on, which is both faster and what
        // the web does — `fTimePeriod.length < 3`.
        if filter.timePeriods.count < JobTimePeriod.allCases.count {
            if !filter.timePeriods.contains(period(of: job, today: context.today)) { return false }
        }
        return true
    }

    /// The web's comment, and the rule it protects: "Jobs never auto-finish: only
    /// an explicit Finished status counts as finished. A past-end unfinished job
    /// stays 'current' (and shows as Overdue), never hidden."
    static func period(of job: Job, today: String) -> JobTimePeriod {
        if job.status == .finished { return .finished }
        if !job.start.isEmpty && job.start > today { return .future }
        return .current
    }

    // MARK: Search
    //
    // `jobMatchesSearch` — a substring against a bag of the job's own fields, its
    // client's name, and its team's names. Descends into panels and ops, so
    // searching an operation's title finds the job that holds it.

    static func searchMatches(_ job: Job, _ query: String, context: Context) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return true }

        var hay: [String] = []
        func push(_ s: String?) {
            guard let s, !s.isEmpty else { return }
            hay.append(s.lowercased())
        }
        func collect(title: String, jobNumber: String?, status: JobStatus, pri: Priority,
                     start: String, end: String, due: String?, team: [String]) {
            push(title); push(jobNumber); push(status.rawValue); push(pri.rawValue)
            push(start); push(end); push(due)
            for id in team { push(context.personName(id)) }
        }

        collect(title: job.title, jobNumber: job.jobNumber, status: job.status, pri: job.pri,
                start: job.start, end: job.end, due: job.dueDate, team: job.team)
        push(context.clientName(job.clientId))
        push(job.notes)
        push(job.poNumber)
        for panel in job.subs {
            collect(title: panel.title, jobNumber: nil, status: panel.status, pri: panel.pri,
                    start: panel.start, end: panel.end, due: nil, team: panel.team)
            for op in panel.subs {
                collect(title: op.title, jobNumber: nil, status: op.status, pri: op.pri,
                        start: op.start, end: op.end, due: nil, team: op.team)
            }
        }
        return hay.contains { $0.contains(needle) }
    }

    // MARK: Sorting

    /// With no column chosen this is the web's fallback: by start date ascending.
    static func sorted(_ jobs: [Job], by sort: JobsSort, context: Context) -> [Job] {
        guard let column = sort.column else {
            return jobs.sorted { $0.start < $1.start }
        }
        let ascending = sort.ascending
        return jobs.sorted { a, b in
            let order = compare(a, b, on: column, context: context)
            // A stable tiebreak on id. Swift's sort is not stable, so equal keys
            // could otherwise reshuffle rows on any unrelated redraw.
            if order == 0 { return a.id < b.id }
            return ascending ? order < 0 : order > 0
        }
    }

    /// Negative when `a` sorts first. One place per column, so a comparator and a
    /// cell cannot disagree about what a column means.
    static func compare(_ a: Job, _ b: Job, on column: JobColumn, context: Context) -> Int {
        switch column {
        case .name:
            return text(a.title, b.title)
        case .jobNum:
            // `{ numeric: true }` on the web: "#9" before "#10", not after.
            return sign((a.jobNumber ?? "").compare(b.jobNumber ?? "", options: [.numeric, .caseInsensitive]))
        case .client:
            return text(context.clientName(a.clientId), context.clientName(b.clientId))
        case .status:
            return index(of: a.status, in: JobStatus.allCases) - index(of: b.status, in: JobStatus.allCases)
        case .pri:
            return index(of: a.pri, in: Priority.allCases) - index(of: b.pri, in: Priority.allCases)
        case .start:
            return text(a.start, b.start)
        case .end:
            return text(a.end, b.end)
        case .due:
            // No due date sorts LAST, whichever direction — the web pads it to
            // "9999-99" rather than treating it as empty.
            return text(a.dueDate ?? "9999-99", b.dueDate ?? "9999-99")
        case .hrs:
            return numeric(estimatedHours(of: a), estimatedHours(of: b))
        case .progress:
            return numeric(Double(context.percentComplete(a)), Double(context.percentComplete(b)))
        case .team:
            let ta = a.team.first.map(context.personName) ?? ""
            let tb = b.team.first.map(context.personName) ?? ""
            return text(ta, tb)
        }
    }

    // MARK: Estimated hours
    //
    // `opHrs` / `panelHrs` / `jobHrs` (TRAQS.jsx:11795). Each level rounds to one
    // decimal, and the rounding happens at EVERY level rather than once at the
    // top — sum-then-round and round-then-sum disagree by a tenth often enough
    // that the grid and the job detail would print different totals.
    //
    // The web's comment on why this is not a daily rate: "op.hpd is the TOTAL
    // productive hours for the op. Display it directly — no multiplication by
    // days, which was the legacy 'daily rate x days' formula that inflated
    // multi-day ops."

    /// `op.hpd || 7.5` — the literal fallback the web uses here, not the org's
    /// configured default. A zero would otherwise read as a free operation.
    static func estimatedHours(of op: Operation) -> Double {
        round1(op.hpd > 0 ? op.hpd : 7.5)
    }

    static func estimatedHours(of panel: Panel) -> Double {
        round1(panel.subs.reduce(0) { $0 + estimatedHours(of: $1) })
    }

    static func estimatedHours(of job: Job) -> Double {
        round1(job.subs.reduce(0) { $0 + estimatedHours(of: $1) })
    }

    private static func round1(_ v: Double) -> Double { (v * 10).rounded() / 10 }

    // MARK: Comparator plumbing

    private static func text(_ a: String, _ b: String) -> Int {
        sign(a.lowercased().compare(b.lowercased()))
    }

    private static func numeric(_ a: Double, _ b: Double) -> Int {
        a < b ? -1 : (a > b ? 1 : 0)
    }

    private static func sign(_ r: ComparisonResult) -> Int {
        switch r {
        case .orderedAscending:  return -1
        case .orderedDescending: return 1
        case .orderedSame:       return 0
        }
    }

    private static func index<T: Equatable>(of value: T, in list: [T]) -> Int {
        // An unknown value sorts as the first bucket, which is what
        // `indexOf(...)` returning -1 does on the web once it is used in a
        // subtraction. Clamped to 0 so it cannot sort ahead of a real first.
        max(0, list.firstIndex(of: value) ?? 0)
    }
}
