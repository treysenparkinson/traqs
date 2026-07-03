import SwiftUI
import OneSignalFramework
#if os(iOS)
import UIKit
#endif

@main
struct TRAQS_SchedulingApp: App {
    @State private var auth = AuthManager()
    @State private var appState = AppState()
    @State private var themeSettings = ThemeSettings()
    @State private var appNav = AppNav()
    @Environment(\.scenePhase) private var scenePhase
    #if os(iOS)
    // Handles silent (content-available) sync pushes in the background — see
    // AppDelegate below. OneSignal's click listener (foreground taps / deep
    // links) is registered separately in AppNav.registerPushHandlers().
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    init() {
        OneSignal.initialize("41fd1ecb-1bcb-432f-8e0b-2192801d96f4", withLaunchOptions: nil)
        OneSignal.Notifications.requestPermission({ _ in
            // No-op — the system permission UI is the user-facing signal;
            // we don't need to log the boolean outcome.
        }, fallbackToSettings: false)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(appState)
                .environment(themeSettings)
                .environment(appNav)
                // App-wide tight letter spacing for a modern look. Kept small
                // because tracking is absolute (not size-relative): a large value
                // that suits the 56pt titles would overlap body text. Any Text
                // that sets its own .tracking (uppercase eyebrow labels, the
                // PageTitle wordmarks) overrides this — innermost wins.
                .tracking(-0.5)
                .preferredColorScheme(themeSettings.isLightTheme ? .light : .dark)
                .id(themeSettings.version)
                .task {
                    // Register the notification-tap listener once. OneSignal
                    // replays a cold-start tap as soon as this is added, so a
                    // push that launched the app still deep-links correctly.
                    appNav.registerPushHandlers()
                }
                .onChange(of: appState.currentPersonId, initial: true) { _, personId in
                    // `initial: true` is critical — without it, this only
                    // fired when currentPersonId *changed*, which meant a
                    // returning user (personId already loaded from Keychain
                    // on launch) never got OneSignal.login called. The
                    // external user ID was unset on the OneSignal side, so
                    // the server's include_external_user_ids never matched
                    // and pushes were silently dropped. Fixing this is
                    // what makes message notifications actually arrive.
                    if let personId {
                        OneSignal.login(personId)
                        // Diagnostic: confirm login() actually attached the
                        // external ID. If this logs "nil" the SDK call failed
                        // silently and no server push (targeted by external_id
                        // alias) can ever resolve this device. Note the read
                        // can lag login() by a moment since it round-trips, so
                        // treat a one-off nil right here as inconclusive —
                        // what matters is the Audience → user record.
                        print("[onesignal] login called for personId=\(personId), current external id=\(OneSignal.User.externalId ?? "nil")")
                        // notify.js / messages.js filter recipients by
                        // person.pushToken. Writing the OneSignal
                        // subscription ID back to people.json is what
                        // actually opts this device into pushes.
                        appState.registerPushTokenIfNeeded()
                    }
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await appState.loadAll() }
                Task { await MainActor.run { appState.startAutoRefresh() } }
                // Fallback catch-up when Ably is degraded / was suspended while
                // backgrounded: pull the delta on every foreground.
                Task { await MainActor.run { appState.foregroundSync() } }
            } else if newPhase == .background {
                Task { await MainActor.run { appState.stopAutoRefresh() } }
            }
        }
        #if os(macOS)
        .defaultSize(width: 1200, height: 800)
        #endif
    }
}

#if os(iOS)
// Handles silent (content-available) push notifications that wake the app in
// the background to delta-sync, so SwiftData is fresh by the time the user opens
// the app. OneSignal's SDK swizzles the app delegate and forwards to this
// method, so this background-sync path and the OneSignal CLICK listener
// (foreground taps / deep links, in AppNav.registerPushHandlers) coexist.
// UIBackgroundModes already declares "remote-notification" and aps-environment
// is set, so no plist/entitlement change is needed.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        // Foreground: Ably realtime is live and the scenePhase .active handler
        // already delta-syncs, so a push-triggered sync would be redundant.
        // No-op (Phase 5 adversarial check #5 — deltaSync self-coalesces anyway).
        if application.applicationState == .active {
            completionHandler(.noData)
            return
        }
        // Backgrounded/inactive: every push we send marks a data change, so run
        // one coalesced background delta-sync. Race it against a 25s cap so we
        // always call the completion handler inside iOS's ~30s budget (5s buffer).
        // We don't gate on the payload's type=="sync": VISIBLE event pushes also
        // carry content_available, and syncing on them too keeps the cache fresh
        // before the user taps in.
        Task { @MainActor in
            let didWrite = await withTaskGroup(of: Bool.self) { group -> Bool in
                group.addTask { @MainActor in await AppState.shared?.backgroundSync() ?? false }
                group.addTask { @MainActor in
                    try? await Task.sleep(nanoseconds: 25_000_000_000)
                    return false
                }
                let first = await group.next() ?? false
                group.cancelAll()
                return first
            }
            completionHandler(didWrite ? .newData : .noData)
        }
    }
}
#endif
