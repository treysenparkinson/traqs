import Testing
import Foundation
@testable import TRAQS_Scheduling

// The Jobs list's rules (src/TRAQS.jsx `filtered` / `activeTasks` / `sortTasks`).
// Several of these encode decisions the web's own comments call out, and those are
// the tests that matter — the rest is bookkeeping.
@Suite("Jobs query")
struct JobsQueryTests {

    private let today = "2026-03-10"

    private var context: JobsQuery.Context {
        JobsQuery.Context(
            today: today,
            clientName: { id in
                switch id {
                case "c1": return "Acme"
                case "c2": return "Boreal"
                default:   return ""
                }
            },
            personName: { id in
                switch id {
                case "p1": return "Alice"
                case "p2": return "Bob"
                default:   return ""
                }
            },
            percentComplete: { job in job.id == "slow" ? 10 : 90 }
        )
    }

    // Jobs are DECODED, not constructed. Panel and Operation have only
    // `init(from:)` — no memberwise init — and going through the real decoder is
    // what the other suites here do, which also means a decoding regression shows
    // up as a failure rather than being bypassed.
    //
    // `try!` on a literal: if it throws the test has a typo, and failing loudly at
    // that line is exactly what should happen.

    private func decode(_ object: [String: Any]) -> Job {
        let data = try! JSONSerialization.data(withJSONObject: object)
        return try! JSONDecoder().decode(Job.self, from: data)
    }

    /// A job with only what a test cares about set. Everything else is left to the
    /// decoder's own defaults, so a new field cannot silently change what these
    /// assert. `nil` keys are OMITTED rather than sent as null.
    private func job(_ id: String, title: String = "Job", num: String? = nil,
                     status: JobStatus = .inProgress, pri: Priority = .medium,
                     start: String = "2026-03-01", end: String = "2026-03-20",
                     due: String? = nil, client: String? = nil, team: [String] = [],
                     panels: [[String: Any]] = []) -> Job {
        var o: [String: Any] = [
            "id": id, "title": title, "start": start, "end": end,
            "status": status.rawValue, "pri": pri.rawValue,
            "team": team, "subs": panels,
        ]
        if let num { o["jobNumber"] = num }
        if let due { o["dueDate"] = due }
        if let client { o["clientId"] = client }
        return decode(o)
    }

    private func op(_ id: String, hpd: Double, title: String = "Op") -> [String: Any] {
        ["id": id, "title": title, "start": "2026-03-01", "end": "2026-03-02",
         "status": "In Progress", "pri": "Medium", "team": [], "hpd": hpd]
    }

    private func panel(_ id: String, ops: [[String: Any]],
                       title: String = "Panel") -> [String: Any] {
        ["id": id, "title": title, "start": "2026-03-01", "end": "2026-03-02",
         "status": "In Progress", "pri": "Medium", "team": [], "subs": ops]
    }

    // MARK: Finished jobs are not in this list at all

    // `activeTasks` excludes Finished outright — the finished section has its own
    // list, built from the UNFILTERED jobs. So ticking "Finished" in the time
    // period filter must NOT pull one back into the grid.
    @Test func finishedJobsAreExcludedEvenWhenTheFinishedPeriodIsSelected() {
        let jobs = [job("a"), job("done", status: .finished)]
        var f = JobsFilter()
        f.timePeriods = [.finished]
        let rows = JobsQuery.activeRows(jobs, filter: f, sort: JobsSort(), context: context)
        #expect(rows.isEmpty)
    }

    // MARK: Status

    @Test func anEmptyStatusSetMeansEveryStatus() {
        // The "All" chip CLEARS the list rather than selecting each one, so empty
        // cannot mean "match nothing".
        let jobs = [job("a", status: .inProgress), job("b", status: .onHold)]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(), sort: JobsSort(), context: context)
        #expect(rows.count == 2)
    }

    @Test func aStatusSetKeepsOnlyThoseStatuses() {
        let jobs = [job("a", status: .inProgress), job("b", status: .onHold)]
        var f = JobsFilter()
        f.statuses = [.onHold]
        let rows = JobsQuery.activeRows(jobs, filter: f, sort: JobsSort(), context: context)
        #expect(rows.map(\.id) == ["b"])
    }

    // MARK: Time period

    // The web: "Jobs never auto-finish: only an explicit Finished status counts as
    // finished. A past-end unfinished job stays 'current' (and shows as Overdue),
    // never hidden."
    @Test func aJobPastItsEndDateIsStillCurrent() {
        let overdue = job("late", start: "2026-01-01", end: "2026-02-01")
        #expect(JobsQuery.period(of: overdue, today: today) == .current)
    }

    @Test func aJobStartingAfterTodayIsFuture() {
        #expect(JobsQuery.period(of: job("f", start: "2026-04-01"), today: today) == .future)
    }

    @Test func aJobStartingTodayIsCurrentNotFuture() {
        // `start > TD`, strictly. Today's job is work in hand.
        #expect(JobsQuery.period(of: job("t", start: today), today: today) == .current)
    }

    @Test func anUndatedJobIsCurrent() {
        #expect(JobsQuery.period(of: job("u", start: ""), today: today) == .current)
    }

    // MARK: Job number

    @Test func theJobNumberFilterIsASubstringNotAnExactMatch() {
        let jobs = [job("a", num: "1042"), job("b", num: "2042"), job("c", num: "9999")]
        var f = JobsFilter()
        f.jobNumber = "042"
        let rows = JobsQuery.activeRows(jobs, filter: f, sort: JobsSort(column: .jobNum), context: context)
        #expect(rows.map(\.id) == ["a", "b"])
    }

    // MARK: Search

    @Test func searchReachesTheClientName() {
        let jobs = [job("a", client: "c1"), job("b", client: "c2")]
        var f = JobsFilter()
        f.search = "acme"
        let rows = JobsQuery.activeRows(jobs, filter: f, sort: JobsSort(), context: context)
        #expect(rows.map(\.id) == ["a"])
    }

    @Test func searchReachesATeamMembersName() {
        let jobs = [job("a", team: ["p1"]), job("b", team: ["p2"])]
        var f = JobsFilter()
        f.search = "bob"
        let rows = JobsQuery.activeRows(jobs, filter: f, sort: JobsSort(), context: context)
        #expect(rows.map(\.id) == ["b"])
    }

    // Searching an OPERATION's title has to find the job that holds it, or the
    // box is useless for the thing people actually look for.
    @Test func searchDescendsIntoPanelsAndOperations() {
        let deep = job("a", panels: [panel("pn", ops: [op("o", hpd: 4, title: "Powder coat")])])
        var f = JobsFilter()
        f.search = "powder"
        let rows = JobsQuery.activeRows([deep, job("b")], filter: f, sort: JobsSort(), context: context)
        #expect(rows.map(\.id) == ["a"])
    }

    @Test func anEmptySearchMatchesEverything() {
        #expect(JobsQuery.searchMatches(job("a"), "   ", context: context))
    }

    // MARK: Sorting

    @Test func noColumnSortFallsBackToStartDate() {
        let jobs = [job("b", start: "2026-05-01"), job("a", start: "2026-01-01")]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(), sort: JobsSort(), context: context)
        #expect(rows.map(\.id) == ["a", "b"])
    }

    // `{ numeric: true }` on the web. Plain string order puts "10" before "9".
    @Test func jobNumbersSortNumericallyNotAsText() {
        let jobs = [job("ten", num: "10"), job("nine", num: "9")]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(),
                                        sort: JobsSort(column: .jobNum), context: context)
        #expect(rows.map(\.id) == ["nine", "ten"])
    }

    // The web pads a missing due date to "9999-99" rather than treating it as
    // empty, so undated work sorts to the END rather than the top.
    @Test func aMissingDueDateSortsLast() {
        let jobs = [job("none"), job("soon", due: "2026-03-12")]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(),
                                        sort: JobsSort(column: .due), context: context)
        #expect(rows.map(\.id) == ["soon", "none"])
    }

    @Test func statusSortsInTheStatusListsOwnOrderNotAlphabetically() {
        // On Hold before Not Started alphabetically; Not Started first by rank.
        let jobs = [job("hold", status: .onHold), job("new", status: .notStarted)]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(),
                                        sort: JobsSort(column: .status), context: context)
        #expect(rows.map(\.id) == ["new", "hold"])
    }

    @Test func descendingReversesTheOrder() {
        let jobs = [job("a", title: "Alpha"), job("b", title: "Beta")]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(),
                                        sort: JobsSort(column: .name, ascending: false),
                                        context: context)
        #expect(rows.map(\.id) == ["b", "a"])
    }

    @Test func progressSortsOnTheInjectedPercentage() {
        let jobs = [job("fast"), job("slow")]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(),
                                        sort: JobsSort(column: .progress), context: context)
        #expect(rows.map(\.id) == ["slow", "fast"])
    }

    @Test func equalKeysKeepAStableOrder() {
        // Swift's sort is not stable, so rows with the same key could otherwise
        // reshuffle on any unrelated redraw.
        let jobs = [job("c", title: "Same"), job("a", title: "Same"), job("b", title: "Same")]
        let rows = JobsQuery.activeRows(jobs, filter: JobsFilter(),
                                        sort: JobsSort(column: .name), context: context)
        #expect(rows.map(\.id) == ["a", "b", "c"])
    }

    // MARK: The sort cycle

    @Test func clickingAColumnThreeTimesTurnsSortingOff() {
        var s = JobsSort()
        s = s.cycled(.name)
        #expect(s == JobsSort(column: .name, ascending: true))
        s = s.cycled(.name)
        #expect(s == JobsSort(column: .name, ascending: false))
        s = s.cycled(.name)
        #expect(s.column == nil)
    }

    @Test func clickingADifferentColumnStartsItAscending() {
        let s = JobsSort(column: .name, ascending: false).cycled(.status)
        #expect(s == JobsSort(column: .status, ascending: true))
    }

    // MARK: Estimated hours

    // Rounding happens at EVERY level, not once at the top. Sum-then-round and
    // round-then-sum disagree often enough that the grid and the job detail would
    // print different totals.
    @Test func hoursRoundAtEveryLevel() {
        // Reached through the job, since the helpers now produce JSON rather
        // than typed values.
        let j = job("a", panels: [panel("p", ops: [op("o1", hpd: 1.04), op("o2", hpd: 1.04)])])
        #expect(JobsQuery.estimatedHours(of: j.subs[0]) == 2.0)   // 1.0 + 1.0, not 2.1
    }

    @Test func aZeroHourOperationFallsBackToSevenAndAHalf() {
        // `op.hpd || 7.5` — a zero would otherwise read as a free operation.
        let j = job("a", panels: [panel("p", ops: [op("o", hpd: 0)])])
        #expect(JobsQuery.estimatedHours(of: j.subs[0].subs[0]) == 7.5)
    }

    @Test func jobHoursSumItsPanels() {
        let j = job("a", panels: [
            panel("p1", ops: [op("o1", hpd: 4), op("o2", hpd: 2)]),
            panel("p2", ops: [op("o3", hpd: 1.5)]),
        ])
        #expect(JobsQuery.estimatedHours(of: j) == 7.5)
    }

    @Test func aJobWithNoPanelsHasNoHours() {
        #expect(JobsQuery.estimatedHours(of: job("a")) == 0)
    }

    // MARK: The filter badge

    @Test func theBadgeCountsGroupsNotIndividualChoices() {
        var f = JobsFilter()
        #expect(f.activeCount == 0)
        f.statuses = [.onHold, .inProgress]
        #expect(f.activeCount == 1)          // one group, however many chips
        f.jobNumber = "10"
        #expect(f.activeCount == 2)
        f.timePeriods = [.current]
        #expect(f.activeCount == 3)
    }

    @Test func searchIsNotCountedByTheFilterBadge() {
        // It is its own control with its own affordance.
        var f = JobsFilter()
        f.search = "acme"
        #expect(f.activeCount == 0)
        #expect(!f.isEmpty)
    }
}

// The grid's three levels, flattened. Expansion decides what exists, not what is
// hidden — a collapsed job's operations are never produced.
@Suite("Jobs grid rows")
struct JobRowFlattenTests {

    private func decode(_ object: [String: Any]) -> Job {
        let data = try! JSONSerialization.data(withJSONObject: object)
        return try! JSONDecoder().decode(Job.self, from: data)
    }

    private var jobWithTwoPanels: Job {
        decode([
            "id": "j1", "title": "Job", "color": "#ff0000", "subs": [
                ["id": "p1", "title": "Panel 1", "subs": [
                    ["id": "o1", "title": "Op 1", "hpd": 4],
                    ["id": "o2", "title": "Op 2", "hpd": 2],
                ]],
                ["id": "p2", "title": "Panel 2", "subs": [
                    ["id": "o3", "title": "Op 3", "hpd": 1],
                ]],
            ],
        ])
    }

    @Test func collapsedShowsOnlyTheJob() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: [])
        #expect(rows.map(\.itemID) == ["j1"])
    }

    @Test func expandingTheJobShowsItsPanelsButNotItsOperations() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: ["j1"])
        #expect(rows.map(\.itemID) == ["j1", "p1", "p2"])
    }

    @Test func expandingAPanelShowsItsOperations() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: ["j1", "p1"])
        #expect(rows.map(\.itemID) == ["j1", "p1", "o1", "o2", "p2"])
    }

    // A panel marked expanded inside a COLLAPSED job must produce nothing. The
    // panel is not on screen, so neither are its operations.
    @Test func anExpandedPanelUnderACollapsedJobProducesNothing() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: ["p1"])
        #expect(rows.map(\.itemID) == ["j1"])
    }

    @Test func levelsAreAssignedByDepth() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: ["j1", "p1"])
        #expect(rows.map(\.level) == [0, 1, 2, 2, 1])
    }

    // Imported data can give a panel the same id as its job, and a duplicate id
    // in a ForEach silently drops rows — so the row's identity carries ancestry
    // while `itemID` stays the bare id that edits and expansion key off.
    @Test func rowIdentityIncludesAncestryWhileItemIDDoesNot() {
        let clash = decode([
            "id": "same", "title": "Job",
            "subs": [["id": "same", "title": "Panel", "subs": []]],
        ])
        let rows = JobRow.flatten([clash], expanded: ["same"])
        #expect(rows.map(\.id) == ["same", "same/same"])
        #expect(Set(rows.map(\.id)).count == rows.count)
        #expect(rows.map(\.itemID) == ["same", "same"])
    }

    // A panel's assignee is tinted with the JOB's colour, not its own, at every
    // level — so the colour has to travel down with the row.
    @Test func theJobsColourTravelsDownToEveryLevel() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: ["j1", "p1"])
        #expect(rows.allSatisfy { $0.jobColor == "#ff0000" })
    }

    @Test func hoursAreReportedAtEachRowsOwnLevel() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: ["j1", "p1"])
        #expect(rows[0].estimatedHours == 7)    // the job: 6 + 1
        #expect(rows[1].estimatedHours == 6)    // panel 1: 4 + 2
        #expect(rows[2].estimatedHours == 4)    // op 1
    }

    @Test func onlyAJobRowExposesAJob() {
        let rows = JobRow.flatten([jobWithTwoPanels], expanded: ["j1"])
        #expect(rows[0].job != nil)
        #expect(rows[1].job == nil)
    }

    @Test func opCountsAreCountedBeneathTheRow() {
        let mixed = decode([
            "id": "j", "title": "J", "subs": [
                ["id": "p", "title": "P", "subs": [
                    ["id": "a", "title": "A", "status": "Finished"],
                    ["id": "b", "title": "B", "status": "In Progress"],
                ]],
            ],
        ])
        let rows = JobRow.flatten([mixed], expanded: ["j"])
        #expect(rows[0].finishedAndTotalOps == (1, 2))
        #expect(rows[1].finishedAndTotalOps == (1, 2))
    }
}
