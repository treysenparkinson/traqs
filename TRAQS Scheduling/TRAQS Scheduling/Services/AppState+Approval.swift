import Foundation

// MARK: - Signing from the Jobs grid
//
// `JobsApproval` holds the rules and stays pure; this is the half that cannot
// be — who is signing, persisting the result, and the two notifications the web
// fires on a sign-off.
//
// Deliberately NOT folded into the existing `signOff(jobId:panelId:step:…)`.
// That one is the iOS engineering queue's, it names a step by `EngStep`, and it
// therefore only knows the ENGINEERING shape. The grid's chips can be any of the
// three, and the cell has one click for all of them — see `JobsApproval.signing`,
// which dispatches on the state's own kind so the chips and the write cannot
// disagree about which chain is running.

extension AppState {

    /// Who is signing, as the pure layer wants it.
    ///
    /// `canApprove` is the web's `loggedInUser.userRole === "admin" ||
    /// canSignOff === true || isEngineer === true` (TRAQS.jsx:9736), which is the
    /// same three-way test `canViewApprovalQueue` already spells out.
    var approvalActor: JobsApproval.Actor {
        JobsApproval.Actor(id: currentPersonId ?? "",
                           name: currentPerson?.name ?? "",
                           canApprove: canViewApprovalQueue)
    }

    /// Every row's approval state AND its Activity line, for one render of the
    /// Jobs grid, in ONE walk.
    ///
    /// Job rows get the rollup, panel rows their own chain, operations nothing.
    ///
    /// This used to be two functions over the same tree, and the second repeated
    /// everything the first had done: `activity(ofPanel:)` derived the panel's
    /// state again as its fallback, and `activity(ofJob:)` derived every panel's
    /// state again to build the rollup. Measured on 240 panels with a full
    /// twenty-entry trail each, release build:
    ///
    ///     approval index    45.3 ms  ->  0.9 ms
    ///     activity index   762.7 ms  ->  1.1 ms
    ///
    /// against a 16 ms frame. That is what made an edit take seconds to appear:
    /// the write was instant, the redraw behind it was not. The rest of the gain
    /// is in `JobsApproval` — reading the JSON tree directly instead of
    /// round-tripping every chain step and log entry through Codable, and
    /// ordering stamps without building a `Date`.
    struct JobsApprovalIndex {
        var states: [String: ApprovalState] = [:]
        var activity: [String: ApprovalActivity] = [:]
    }

    func jobsApprovalIndex(for jobs: [Job]) -> JobsApprovalIndex {
        // The templates and the engineering labels, decoded ONCE for the page
        // rather than once per panel.
        let context = ApprovalContext(orgSettings)
        var index = JobsApprovalIndex()

        for job in jobs {
            var panelStates: [ApprovalState] = []
            panelStates.reserveCapacity(job.subs.count)

            for panel in job.subs {
                guard let state = JobsApproval.state(of: panel, context: context) else {
                    // Still ask for its activity: a panel can carry a trail from a
                    // chain that has since been removed.
                    if let a = JobsApproval.activity(ofPanel: panel, state: nil) {
                        index.activity[panel.id] = a
                    }
                    continue
                }
                index.states[panel.id] = state
                if let a = JobsApproval.activity(ofPanel: panel, state: state) {
                    index.activity[panel.id] = a
                }
                panelStates.append(state)
            }

            if let rollup = JobsApproval.rollup(panelStates: panelStates) {
                index.states[job.id] = rollup
            }
            if let a = JobsApproval.activity(ofJob: job, panelStates: panelStates) {
                index.activity[job.id] = a
            }
        }
        return index
    }

    // MARK: Writing

    /// Sign one step of a panel's chain, whichever shape it is.
    ///
    /// Refused silently when this person may not sign it — the cell already only
    /// offers a clickable chip to someone who can, so reaching here without the
    /// right is a race (a permission changed under an open page), not a case that
    /// deserves an alert.
    func signApproval(jobId: String, panelId: String, stepIndex: Int) {
        guard let job = jobs.first(where: { $0.id == jobId }) else { return }
        let updated = JobsApproval.signing(step: stepIndex, panelID: panelId, in: job,
                                           settings: orgSettings, by: approvalActor)
        guard JobsEdit.differs(job, updated) else { return }
        updateJob(updated)
        notifyApproval(job: updated, panelId: panelId, stepIndex: stepIndex)
    }

    func revertApproval(jobId: String, panelId: String, stepIndex: Int) {
        guard let job = jobs.first(where: { $0.id == jobId }) else { return }
        let updated = JobsApproval.reverting(step: stepIndex, panelID: panelId, in: job,
                                             settings: orgSettings, by: approvalActor)
        guard JobsEdit.differs(job, updated) else { return }
        updateJob(updated)
    }

    /// "Edit Steps" — replace the panel's chain outright.
    func setApprovalChain(jobId: String, panelId: String, steps: [ApprovalChainStep]) {
        guard let job = jobs.first(where: { $0.id == jobId }) else { return }
        let updated = JobsApproval.settingChain(steps, panelID: panelId, in: job,
                                                by: approvalActor)
        guard JobsEdit.differs(job, updated) else { return }
        updateJob(updated)
    }

    /// "Remove chain" — drop the custom chain and fall back to whatever the panel
    /// had underneath it.
    func removeApprovalChain(jobId: String, panelId: String) {
        guard let job = jobs.first(where: { $0.id == jobId }) else { return }
        let updated = JobsApproval.removingChain(panelID: panelId, in: job,
                                                 by: approvalActor)
        guard JobsEdit.differs(job, updated) else { return }
        updateJob(updated)
    }

    // MARK: The notifications

    /// The web fires TWO on a sign-off (`signOffEngineering`, :9793): a `step`
    /// heads-up every time, and a `ready` when that signature was the last one
    /// outstanding.
    ///
    /// Read from the UPDATED job, so `allDone` reflects the signature just
    /// written. The web reads it from `next` for exactly this reason — its own
    /// comment says "fire notifications after state is updated".
    ///
    /// `jobTeamIds` is every operation's team flattened, not `job.team`: the web
    /// notifies the people actually working the job, and a panel's approval
    /// concerns them rather than the job's nominal roster.
    private func notifyApproval(job: Job, panelId: String, stepIndex: Int) {
        guard let panel = job.subs.first(where: { $0.id == panelId }),
              let state = JobsApproval.state(of: panel, settings: orgSettings),
              state.steps.indices.contains(stepIndex)
        else { return }

        // Built BEFORE the Task, so nothing inside it reaches back into AppState.
        let signer = currentPerson?.name
        let payload = { (type: String) in
            NotifyPayload(
                type: type,
                jobTitle: job.title, jobNumber: job.jobNumber,
                panelTitle: panel.title, stepLabel: state.steps[stepIndex].label,
                jobTeamIds: Array(Set(job.subs.flatMap { $0.subs.flatMap(\.team) })),
                newTeamIds: nil, clientName: nil,
                approvedByName: signer)
        }
        let allDone = state.allDone

        Task {
            await sendNotify(payload("step"))
            if allDone { await sendNotify(payload("ready")) }
        }
    }
}
