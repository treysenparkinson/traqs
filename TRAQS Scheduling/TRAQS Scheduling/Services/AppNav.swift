import SwiftUI
import OneSignalFramework

// MARK: - Jobs tab view mode
// The Jobs tab merges the old Jobs (list) and Schedule (gantt) pages into one.
// `jobsMode` chooses which view the Jobs tab renders; the header toggle flips it.
enum JobsViewMode: Hashable {
    case list, gantt
    mutating func toggle() { self = self == .list ? .gantt : .list }
}

// MARK: - App-wide Navigation
// Holds the selected tab and the side-menu open state. Injected at the App
// root so the header's hamburger button (anywhere) and the drawer overlay
// (in MainTabView) can both read & toggle it. Also owns deep-link routing
// for tapped push notifications (see below).

@Observable
@MainActor
final class AppNav {
    var selected: TTab = .home
    var isMenuOpen: Bool = false

    /// Which view the merged Jobs tab shows — list (TasksView) or gantt (GanttView).
    /// Persists across tab switches; reset to `.list` for job deep links so the
    /// list view's deep-link consumer can resolve the tapped job (see below).
    var jobsMode: JobsViewMode = .list

    // MARK: - Push deep links
    //
    // A tapped push carries a `data` dict set server-side. Three shapes reach
    // the device (see netlify/functions/notify.js, messages.js, timeoff.js):
    //   • event pushes (new_job / assigned / step / ready) → { jobNumber }
    //   • message pushes (chat + finish-request messages)   → { threadKey }
    //   • time-off pushes (request/approved/denied/cancelled) → { requestId }
    // We translate the tap into a tab switch plus a pending target that the
    // owning tab (Jobs / Chat) consumes once its data is loaded, then clears.
    // Keeping it pending (rather than navigating here) lets a cold-start tap
    // wait for jobs/messages to load before resolving. Time-off pushes are
    // different: Time Off is its own nav page (not a tab), so those flip
    // `openTimeOffPage` instead, which MainTabView presents as a cover.
    enum DeepLink: Equatable {
        case job(number: String)        // open that job's detail
        case approvals(number: String)  // step/ready push → open the Approval Queue
                                         // (carries jobNumber so non-approvers fall
                                         // back to the job detail)
        case thread(key: String)        // open that chat thread
        case timeOff(requestId: String) // documents the requestId push shape
    }
    var pendingDeepLink: DeepLink?

    /// A tapped time-off push flips this true; MainTabView observes it to
    /// present TimeOffView, then resets it. (Time Off left the Hours tab, so
    /// it can't be reached via `selected`/`pendingDeepLink` like the others.)
    var openTimeOffPage: Bool = false

    /// Map a tapped notification's `additionalData` to a tab + pending target.
    /// threadKey wins over jobNumber: message pushes only carry threadKey, and
    /// a payload with both belongs in the conversation it came from. requestId
    /// is unique to time-off pushes (they carry neither of the other keys).
    func handleNotification(_ data: [AnyHashable: Any]) {
        if let key = data["threadKey"] as? String, !key.isEmpty {
            selected = .chat
            pendingDeepLink = .thread(key: key)
        } else if let number = Self.stringValue(data["jobNumber"]), !number.isEmpty {
            selected = .jobs
            // The job/approvals deep-link consumers live in the list view, so make
            // sure the merged Jobs tab is showing the list (not gantt) for it.
            jobsMode = .list
            // Engineering sign-off pushes (step/ready) route to the Approval Queue
            // for approvers; JobsHubView falls back to the job detail otherwise.
            // Everything else (new_job/assigned) opens the job detail directly.
            let type = data["type"] as? String
            if type == "step" || type == "ready" {
                pendingDeepLink = .approvals(number: number)
            } else {
                pendingDeepLink = .job(number: number)
            }
        } else if let requestId = Self.stringValue(data["requestId"]), !requestId.isEmpty {
            // Time Off is its own nav page now (not the Hours tab): present it
            // as a cover instead of routing to a tab. The list shows the user's
            // own requests, so the specific requestId isn't needed to resolve.
            openTimeOffPage = true
        }
    }

    /// notify.js sends jobNumber as a JSON string, but coerce defensively in
    /// case it ever arrives as a number through OneSignal's bridge.
    private static func stringValue(_ any: Any?) -> String? {
        switch any {
        case let s as String:   return s
        case let n as NSNumber: return n.stringValue
        default:                return nil
        }
    }

    // MARK: - OneSignal click listener
    // Registered once at launch and retained for the app's lifetime. OneSignal
    // (v5) caches a cold-start click and replays it the instant a listener is
    // added, so this also covers "tapped while the app was killed".
    private var clickHandler: PushClickHandler?

    func registerPushHandlers() {
        guard clickHandler == nil else { return }
        let handler = PushClickHandler { [weak self] data in
            self?.handleNotification(data)
        }
        clickHandler = handler
        OneSignal.Notifications.addClickListener(handler)
    }
}

/// Bridges OneSignal's listener protocol to a closure. OneSignal requires an
/// object conforming to OSNotificationClickListener; AppNav can't conform
/// directly (it's a @MainActor @Observable class and the callback is invoked
/// off-actor), so this thin NSObject adapter forwards the click's
/// additionalData back onto the main actor.
final class PushClickHandler: NSObject, OSNotificationClickListener {
    private let handler: ([AnyHashable: Any]) -> Void
    init(_ handler: @escaping ([AnyHashable: Any]) -> Void) { self.handler = handler }

    func onClick(event: OSNotificationClickEvent) {
        let data = event.notification.additionalData ?? [:]
        let handler = self.handler
        Task { @MainActor in handler(data) }
    }
}
