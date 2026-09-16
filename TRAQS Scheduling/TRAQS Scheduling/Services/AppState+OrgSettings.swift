import Foundation

// MARK: - Writing org settings
//
// The half that was missing. `APIService.saveOrgSettings` has existed all along
// and nothing on the Mac ever called it, so a custom column added on the Jobs
// grid lived in memory until the next settings fetch and then vanished — which
// reads as the app losing your work, not as a feature being unfinished.
//
// TWO THINGS MAKE THIS SAFE TO ADD, and both were put in place first:
//
//   * `OrgSettings` carries a `JSONExtras` passthrough. `settings.js` REPLACES
//     the object rather than merging it, so a POST from Swift would otherwise
//     destroy `conditions`, `statusOpts`, `priOpts`, `signOffTemplates` and
//     everything else Swift does not model — the same way `tasks.js` destroyed
//     every panel's approval chain. See JSONPassthrough.
//   * The endpoint is admin-gated (`requirePerm(member, "orgSettings")`), so an
//     unprivileged write is a 403 rather than a silent no-op. `canEditOrgSettings`
//     below lets the UI ask the same question BEFORE offering the control.

extension AppState {

    /// Whether this person may change org settings at all — the client half of
    /// `requirePerm(member, "orgSettings")`.
    var canEditOrgSettings: Bool { can(.orgSettings) }

    /// Apply a change to org settings and persist it.
    ///
    /// Optimistic: the local copy moves first so the grid redraws immediately,
    /// and a failed POST rolls it back rather than leaving the app showing a
    /// column the server does not have. That is the opposite of the jobs path,
    /// which keeps the optimistic write and retries — and deliberately so:
    /// settings are one small object with no debounce and no undo stack, so the
    /// honest thing on failure is to put it back.
    @discardableResult
    func updateOrgSettings(_ change: (inout OrgSettings) -> Void) -> Bool {
        guard canEditOrgSettings else { return false }

        let previous = orgSettings
        var next = orgSettings
        change(&next)
        guard next != previous else { return true }

        orgSettings = next
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.persistOrgSettings(next)
            } catch {
                // Only roll back if nothing else has moved on since — an inbound
                // sync may already have replaced this object, and putting the old
                // one back would undo somebody else's change too.
                if self.orgSettings == next { self.orgSettings = previous }
                self.saveStatus = .error("Couldn\u{2019}t save column settings")
                print("[orgSettings] save failed, reverted: \(error)")
            }
        }
        return true
    }
}
