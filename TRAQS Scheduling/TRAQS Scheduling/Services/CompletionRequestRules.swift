import Foundation

// MARK: - Completion (finish) request decision rules
//
// Pure rules, no AppState and no implicit `Date()`, so they can be tested
// directly — see CompletionRequestRulesTests.
//
// These exist because approving a completion request used to be neither
// idempotent nor honest about what it knew:
//
//   * `approveJobCompletion` / `denyJobCompletion` mapped over the entry list
//     and rewrote whichever entry matched, WITHOUT checking it was still
//     pending. Re-pressing re-resolved it and re-fired the resolution
//     notification, and an entry someone had just undone could be silently
//     re-finished.
//
//   * the card read `entry?.status ?? "pending"`, so any moment the job wasn't
//     in `appState.jobs` — not yet hydrated, or rolled back by a failed save
//     (AppState's `rollbackSnapshot` path) — an already-approved request
//     rendered as Pending WITH live Approve/Deny buttons. Absence of data was
//     being reported as a known state.
//
// The rule in both cases: never infer a status you don't have, and never
// resolve a request that isn't in a state a decision may be applied to.
enum CompletionRequestRules {

    /// Applies a decision to one entry, or returns `nil` if it must be refused.
    ///
    /// Refused when the list is missing, the request isn't in it, or the entry's
    /// current status isn't in `allowedFrom`. A `nil` result means "nothing
    /// changed" — the caller must NOT write, notify, or mutate job status.
    ///
    /// - Parameters:
    ///   - allowedFrom: statuses a decision may be applied from. Approve/deny
    ///     pass `["pending"]`; undo passes `["approved"]`.
    ///   - resolvedBy/resolvedByName/resolvedAt: stamped onto the entry. Undo
    ///     passes `nil` for all three to clear the previous resolver.
    static func applyDecision(to entries: [FinishRequestEntry]?,
                              requestId: String,
                              newStatus: String,
                              allowedFrom: Set<String>,
                              resolvedBy: String?,
                              resolvedByName: String?,
                              resolvedAt: String?) -> [FinishRequestEntry]? {
        guard let entries,
              let current = entries.first(where: { $0.id == requestId }),
              allowedFrom.contains(current.status)
        else { return nil }

        return entries.map { e in
            guard e.id == requestId else { return e }
            var e = e
            e.status = newStatus
            e.resolvedBy = resolvedBy
            e.resolvedByName = resolvedByName
            e.resolvedAt = resolvedAt
            return e
        }
    }

    /// The status to DISPLAY, or `nil` when it genuinely isn't known yet.
    ///
    /// Deliberately optional. Defaulting to "pending" is what let a resolved
    /// request come back as actionable whenever its job wasn't loaded.
    static func displayStatus(entries: [FinishRequestEntry]?, requestId: String?) -> String? {
        guard let requestId, let entries else { return nil }
        return entries.first(where: { $0.id == requestId })?.status
    }

    /// Whether Approve/Deny may be offered. Only for a request we KNOW is
    /// pending — an unknown status is never actionable.
    static func isActionable(_ status: String?) -> Bool { status == "pending" }

    // MARK: - Which item the request actually belongs to

    /// The item a completion request was raised against, and the state needed to
    /// judge it.
    ///
    /// A request does NOT necessarily live on the job. The web writes it to
    /// whichever item was requested — sub-op, else operation panel, else the
    /// whole job — so a worker finishing one op puts the entry on that op. iOS
    /// read `job.finishRequests` alone, found nothing, and rendered a card with
    /// no Approve/Deny and no Undo.
    ///
    /// `found` distinguishes "the item isn't loaded" from "the item is loaded
    /// and carries no entry" — the two must not be conflated (see `status`).
    struct TargetState: Equatable {
        var found: Bool
        var entries: [FinishRequestEntry]?
        /// `finishRequest.requestId` — the pending stamp the web clears on resolve.
        var stampRequestId: String?
        var pendingFinish: Bool
        var isFinished: Bool

        static let missing = TargetState(found: false, entries: nil, stampRequestId: nil,
                                         pendingFinish: false, isFinished: false)
    }

    /// Resolve `panelId`/`opId` (as carried on the chat message) against the job
    /// tree: sub-op, else panel, else the job itself. Mirrors the web's
    /// `frOp || frPanel || frJob`.
    ///
    /// A panel/op id that doesn't resolve returns `.missing` rather than quietly
    /// falling back to the job — the job's entries belong to a DIFFERENT request,
    /// and answering with them would be the same "absence reported as data" bug
    /// this file exists to prevent.
    static func target(job: Job?, panelId: String?, opId: String?) -> TargetState {
        guard let job else { return .missing }
        guard let panelId else {
            return TargetState(found: true,
                               entries: job.finishRequests,
                               stampRequestId: job.finishRequest?.requestId,
                               pendingFinish: false,
                               isFinished: job.status == .finished)
        }
        guard let panel = job.subs.first(where: { $0.id == panelId }) else { return .missing }
        guard let opId else {
            return TargetState(found: true,
                               entries: panel.finishRequests,
                               stampRequestId: panel.finishRequest?.requestId,
                               pendingFinish: panel.pendingFinish ?? false,
                               isFinished: panel.status == .finished)
        }
        guard let op = panel.subs.first(where: { $0.id == opId }) else { return .missing }
        return TargetState(found: true,
                           entries: op.finishRequests,
                           stampRequestId: op.finishRequest?.requestId,
                           pendingFinish: op.pendingFinish ?? false,
                           isFinished: op.status == .finished)
    }

    /// The status to DISPLAY for a request on a resolved target.
    ///
    /// Prefers the entry row. Falling back only when the target was FOUND but has
    /// no row for this request, which is a real case: the entry list is a later
    /// addition, and older requests exist as a `finishRequest` stamp plus a
    /// `pendingFinish` flag alone. The web reads the same three signals.
    ///
    /// Where this deliberately departs from the web: the web falls back to
    /// "pending" even when the target is MISSING, which is exactly what let a
    /// resolved request render live Approve/Deny whenever its job wasn't loaded.
    /// An unfound target stays `nil` — unknown — here. A wrong "pending" is not
    /// harmless just because `applyDecision` would refuse it: the card would
    /// still offer buttons that do nothing.
    static func status(target: TargetState, requestId: String?) -> String? {
        if let row = displayStatus(entries: target.entries, requestId: requestId) { return row }
        guard target.found else { return nil }
        if let requestId, target.stampRequestId == requestId { return "pending" }
        if target.pendingFinish { return "pending" }
        return target.isFinished ? "approved" : nil
    }

    /// Convenience: resolve the target and read the status in one step.
    static func status(job: Job?, panelId: String?, opId: String?, requestId: String?) -> String? {
        status(target: target(job: job, panelId: panelId, opId: opId), requestId: requestId)
    }
}
