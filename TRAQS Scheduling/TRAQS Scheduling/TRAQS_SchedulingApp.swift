import SwiftUI
import OneSignalFramework

@main
struct TRAQS_SchedulingApp: App {
    @State private var auth = AuthManager()
    @State private var appState = AppState()
    @State private var themeSettings = ThemeSettings()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        OneSignal.initialize("41fd1ecb-1bcb-432f-8e0b-2192801d96f4", withLaunchOptions: nil)
        OneSignal.Notifications.requestPermission({ accepted in
            print("OneSignal permission: \(accepted)")
        }, fallbackToSettings: false)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(appState)
                .environment(themeSettings)
                .preferredColorScheme(themeSettings.isLightTheme ? .light : .dark)
                .id(themeSettings.version)
                .onChange(of: appState.currentPersonId) { _, personId in
                    if let personId {
                        OneSignal.login(String(personId))
                    }
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await appState.loadAll() }
                appState.startAutoRefresh()
            } else if newPhase == .background {
                appState.stopAutoRefresh()
            }
        }
        #if os(macOS)
        .defaultSize(width: 1200, height: 800)
        #endif
    }
}
