import SwiftUI
import OneSignalFramework

@main
struct TRAQS_SchedulingApp: App {
    @State private var auth = AuthManager()
    @State private var appState = AppState()
    @State private var themeSettings = ThemeSettings()
    @State private var appNav = AppNav()
    @Environment(\.scenePhase) private var scenePhase

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
            } else if newPhase == .background {
                Task { await MainActor.run { appState.stopAutoRefresh() } }
            }
        }
        #if os(macOS)
        .defaultSize(width: 1200, height: 800)
        #endif
    }
}
