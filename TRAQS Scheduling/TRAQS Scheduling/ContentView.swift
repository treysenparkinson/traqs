import SwiftUI

struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState
    @State private var showSplash = true

    var body: some View {
        ZStack {
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

            if showSplash {
                SplashView(isShowing: $showSplash)
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
    }
}
