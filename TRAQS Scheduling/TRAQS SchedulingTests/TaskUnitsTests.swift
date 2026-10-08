import Testing
import Foundation
@testable import TRAQS_Scheduling

/// #451. Tasks — the level people are scheduled to and clock into — reach the
/// phone, and Start clocks the TASK. The clock target is the deepest node: a job
/// with tasks offers its tasks; a job with none is itself the unit.
@Suite("What can be clocked into under a job") @MainActor
struct TaskUnitsTests {

    private func op(_ id: String, team: [String] = [], status: JobStatus = .notStarted) -> TRAQS_Scheduling.Operation {
        var o = TRAQS_Scheduling.Operation.empty(id: id, title: "Task \(id)", hpd: 8)
        o.team = team
        o.status = status
        return o
    }

    private func panel(_ id: String, team: [String] = [], ops: [TRAQS_Scheduling.Operation]) -> Panel {
        var p = Panel.empty(id: id, title: "Job \(id)")
        p.team = team
        p.subs = ops
        return p
    }

    private func job(_ panels: [Panel]) -> Job {
        Job(id: "parent", title: "Parent", start: "2026-10-12", end: "2026-10-16", subs: panels)
    }

    // MARK: The Jobs list's card: units under a job

    @Test func aJobWithTasksOffersEachTaskAndStartCarriesItsId() {
        let p = panel("p1", ops: [op("o1", team: ["me"]), op("o2", team: ["sam"])])
        let units = TaskUnits.units(job: job([p]), panel: p, me: "me")
        #expect(units.map { $0.op?.id } == ["o1", "o2"])          // never a job-level (nil) unit
        #expect(units.map(\.isMine) == [true, false])              // a colleague's task is reachable, marked
    }

    @Test func aJobWithNoTasksIsItselfTheUnit() {
        let p = panel("p1", team: ["me"], ops: [])
        let units = TaskUnits.units(job: job([p]), panel: p, me: "me")
        #expect(units.count == 1)
        #expect(units[0].op == nil)                                // job-level Start, by the deepest-node rule
        #expect(units[0].isMine)
    }

    @Test func nobodyLoggedInOwnsNothing() {
        let p = panel("p1", ops: [op("o1", team: ["me"])])
        #expect(TaskUnits.units(job: job([p]), panel: p, me: nil).map(\.isMine) == [false])
    }

    // MARK: On the job's team but on none of its tasks

    @Test func aJobTeamMemberGetsTheJobsUnfinishedTasksNotTheJob() {
        let p = panel("p1", team: ["me"], ops: [op("o1"), op("o2", status: .finished), op("o3")])
        let units = TaskUnits.forJobTeamMember(job: job([p]), panel: p)
        #expect(units.map { $0.op?.id } == ["o1", "o3"])           // tasks, finished ones dropped
        #expect(units.allSatisfy { !$0.isMine })                   // NOT ASSIGNED is true of each
    }

    @Test func aJobTeamMemberOfAJobWithNoTasksGetsTheJob() {
        let p = panel("p1", team: ["me"], ops: [])
        let units = TaskUnits.forJobTeamMember(job: job([p]), panel: p)
        #expect(units.count == 1 && units[0].op == nil)
    }

    // MARK: Ruled 2026-10-08: only the lowest level is clockable

    @Test func aJobWithTasksIsNeverClockableOnlyItsTasksAre() {
        let p = panel("p1", team: ["me"], ops: [op("o1"), op("o2")])
        let j = job([p])
        #expect(!TaskUnits.isClockable(TaskAssignment(job: j, panel: p, op: nil)))      // the job card: no Start
        #expect(TaskUnits.isClockable(TaskAssignment(job: j, panel: p, op: p.subs[0]))) // its task: Start
        #expect(!TaskUnits.isClockable(job: j, panelId: "p1", opId: nil))               // the clock-in refuses too
        #expect(TaskUnits.isClockable(job: j, panelId: "p1", opId: "o1"))
    }

    @Test func aJobWithNoTasksIsTheLowestLevelAndClockable() {
        let p = panel("p1", ops: [])
        let j = job([p])
        #expect(TaskUnits.isClockable(TaskAssignment(job: j, panel: p, op: nil)))
        #expect(TaskUnits.isClockable(job: j, panelId: "p1", opId: nil))
    }

    @Test func theParentIsNeverClockableWhenItHasJobs() {
        let j = job([panel("p1", ops: [])])
        #expect(!TaskUnits.isClockable(job: j, panelId: nil, opId: nil))
    }

    @Test func everyUnitTheListsOfferIsClockable() {
        let withTasks = panel("p1", ops: [op("o1"), op("o2")])
        let noTasks = panel("p2", ops: [])
        let j = job([withTasks, noTasks])
        let all = j.subs.flatMap { TaskUnits.units(job: j, panel: $0, me: "me") }
          + j.subs.flatMap { TaskUnits.forJobTeamMember(job: j, panel: $0) }
        #expect(!all.isEmpty && all.allSatisfy(TaskUnits.isClockable))
    }
}
