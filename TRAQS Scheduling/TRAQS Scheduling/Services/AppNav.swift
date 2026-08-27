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

    /// Hides the custom frosted tab bar (e.g. while inside a message thread).
    /// Driven by the owning tab; MainTabView animates the bar out/in.
    var hideTabBar: Bool = false

    /// Set while a modal presented in its OWN window (a .fullScreenCover) is up,
    /// so MainTabView can blur the whole page — nav bar included — behind it.
    /// A modal can't blur the page from inside a separate presentation, so the
    /// blur has to be driven from out here. See the note above `ModalScrim`.
    var modalBlur: Bool = false

    /// Set while an IN-HIERARCHY modal (the lunch/break shout) is up. Such a
    /// modal lives inside the page, so it blurs its own content with
    /// `.modalPageBlur` and can't use `modalBlur` — that would blur the modal
    /// along with everything else. The nav bar is the one thing it can't reach
    /// from in there, since the bar is its sibling out in MainTabView, so this
    /// blurs just the bar to match.
    var blurTabBar: Bool = false

    /// Break banner shown on the Jobs page — set by TaskCardV1's break button,
    /// consumed by JobsHubView which hosts the same frosted-glass popup as the
    /// time clock page. Kept here so the card (deep in a ScrollView) can signal
    /// the page-level overlay without threading closures.
    var jobsBreakBanner: ClockActionBannerKind?

    /// Which view the merged Jobs tab shows — list (TasksView) or gantt (GanttView).
    /// Persists across tab switches; reset to `.list` for job deep links so the
    /// list view's deep-link consumer can resolve the tapped job (see below).
    var jobsMode: JobsViewMode = .list

    // MARK: - Header state
    //
    // The state behind the app-wide header controls, held here rather than in the
    // pages because the CONTROLS live here — see HeaderControls.swift. A page
    // reads and writes these exactly as it used to read its own @State; the only
    // difference is that the header can reach them too.
    //
    // This is the cost the morph charges. The controls have to be concrete views
    // the host builds itself, and a host can't reach into five pages' private
    // @State, so the state that drives them comes out here.

    // Jobs
    var jobsSearchOpen = false
    var jobsSearchText = ""
    var showApprovalQueue = false
    var showAvailability = false

    // Messages
    var chatSearchOpen = false
    var chatSearchText = ""
    var chatFilter: ChatFilter = .all
    var chatSelectMode = false
    var chatSelectedKeys: Set<String> = []
    var showNewMessage = false
    var showDeleteThreads = false

    // Account menu + Admin, opened from the header and presented by the shell.
    var showAdmin = false
    /// The header's Log out row. AuthManager isn't reachable from AppNav, so the
    /// shell — which has it — consumes this and calls logout().
    var logoutRequested = false
    var showCustomize = false
    var showProfile = false

    // Analytics
    var statsWorkerId: String? = nil
    var statsWeekAnchor: Date = Date()

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
    /// Held so OneSignal's listener isn't deallocated (it holds only a weak ref).
    private var foregroundHandler: PushForegroundHandler?

    /// - Parameter activeThreadKey: the thread the user is currently reading, if
    ///   any. Used to suppress a push for a conversation that's already on screen.
    func registerPushHandlers(activeThreadKey: @escaping () -> String? = { nil }) {
        guard clickHandler == nil else { return }
        let handler = PushClickHandler { [weak self] data in
            self?.handleNotification(data)
        }
        clickHandler = handler
        OneSignal.Notifications.addClickListener(handler)

        // Only a CLICK listener was registered before, so nothing stood between an
        // incoming push and the banner while the app was open — a message push
        // interrupted you in the very thread you were reading it in.
        let foreground = PushForegroundHandler(activeThreadKey: activeThreadKey)
        foregroundHandler = foreground
        OneSignal.Notifications.addForegroundLifecycleListener(foreground)
    }
}

/// Suppresses the banner for a message push whose thread is already open.
///
/// Foreground-only by construction: this listener is never invoked when the app is
/// backgrounded, so a push you genuinely need still arrives. It also only ever
/// suppresses when the thread keys MATCH — a push for any other conversation
/// displays normally, even while you're reading a different one.
final class PushForegroundHandler: NSObject, OSNotificationLifecycleListener {
    private let activeThreadKey: () -> String?
    init(activeThreadKey: @escaping () -> String?) { self.activeThreadKey = activeThreadKey }

    func onWillDisplay(event: OSNotificationWillDisplayEvent) {
        let data = event.notification.additionalData ?? [:]
        guard let pushThread = data["threadKey"] as? String else { return }   // not a message push
        // activeThreadKey reads @MainActor state; hop, decide, and preventDefault
        // synchronously is not possible from a hop, so read it via the closure the
        // caller supplied (it captures MainActor-isolated state and is only ever
        // invoked from here, where OneSignal calls us on the main queue).
        guard let open = activeThreadKey(), open == pushThread else { return }
        event.preventDefault()
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
