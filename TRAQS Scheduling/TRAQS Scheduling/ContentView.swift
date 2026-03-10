import SwiftUI

struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if !auth.isAuthenticated {
                LoginView()
            } else if appState.orgCode.isEmpty {
                OrgCodeView()
            } else {
                MainTabView()
                    .task { await appState.loadAll() }
            }
        }
        .animation(.easeInOut, value: auth.isAuthenticated)
    }
}
