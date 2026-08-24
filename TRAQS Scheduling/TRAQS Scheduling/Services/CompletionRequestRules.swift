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
}
