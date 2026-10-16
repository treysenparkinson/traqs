import Foundation

/// #297 — who may clear a chat thread. A port of `src/threadClear.js`, the rule
/// the server's DELETE /messages enforces, so the inbox only lets you select a
/// thread for deletion when the server would actually clear it.
///
/// Ruled 2026-10-16: a group is its creator's or an admin's; a job, panel or op
/// thread is an admin's (it has no creator); a DM is nobody's. Any other thread
/// kind is refused.
enum ThreadClearRule {
    static func canClear(threadKey: String, viewerId: String?, isAdmin: Bool, groups: [ChatGroup]) -> Bool {
        guard let viewerId, !viewerId.isEmpty else { return false }
        if threadKey.hasPrefix("group:") {
            let ref = String(threadKey.dropFirst(6))
            guard let g = groups.first(where: { $0.id == ref || $0.name == ref }) else { return false }
            return isAdmin || (g.createdBy != nil && g.createdBy == viewerId)
        }
        if threadKey.hasPrefix("job:") || threadKey.hasPrefix("panel:") || threadKey.hasPrefix("op:") {
            return isAdmin
        }
        return false
    }
}
