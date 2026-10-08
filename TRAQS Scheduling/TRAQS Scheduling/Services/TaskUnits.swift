import Foundation

// MARK: - What can be clocked into under a job (#451)
//
// The hierarchy is PARENT → JOB → TASK (`Job` → `Panel` → `Operation`). Tasks are
// what people are scheduled to and clock into. iOS modelled all three levels
// from its first commit, but its lists stopped at the job: a job-level block
// whose Start clocked in with `opId` nil.
//
// THE CLOCK TARGET IS THE DEEPEST NODE — the rule the schedule, JobShifts and
// `myAssignments` already share. A job WITH tasks offers its tasks; a job with
// NO tasks is itself the unit of work (a simple job is shaped exactly that way,
// SimpleJob.swift), so it keeps a job-level Start.
//
// One place, so the Jobs list's card, `TasksView.myTasks` and
// `AppState.myAssignments` cannot drift apart again.

enum TaskUnits {

    /// Every clockable unit under `panel`: its tasks, or the job itself when it
    /// has none. `isMine` is whether `me` is on that unit's team.
    static func units(job: Job, panel: Panel, me: String?) -> [TaskAssignment] {
        func mine(_ team: [String]) -> Bool { me.map { team.contains($0) } ?? false }
        if panel.subs.isEmpty {
            return [TaskAssignment(job: job, panel: panel, op: nil, isMine: mine(panel.team))]
        }
        return panel.subs.map { TaskAssignment(job: job, panel: panel, op: $0, isMine: mine($0.team)) }
    }

    /// For someone on the JOB's team but on none of its tasks: the job's
    /// unfinished tasks (they are the work, and Start must clock a task), or the
    /// job itself when it has no tasks. Not "mine" at task level — the card says
    /// NOT ASSIGNED, which is true of each task.
    static func forJobTeamMember(job: Job, panel: Panel) -> [TaskAssignment] {
        if panel.subs.isEmpty {
            return [TaskAssignment(job: job, panel: panel, op: nil)]
        }
        return panel.subs
            .filter { $0.status != .finished }
            .map { TaskAssignment(job: job, panel: panel, op: $0, isMine: false) }
    }
}
