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
        .onAppear {
            // Returning users skip OrgCodeView, so configure API manually
            if let token = auth.accessToken, !appState.orgCode.isEmpty {
                appState.matchEmail = auth.userEmail
                appState.configure(token: token, orgCode: appState.orgCode)
            }
        }
        .onChange(of: auth.isAuthenticated) { _, isAuth in
            if isAuth, let token = auth.accessToken, !appState.orgCode.isEmpty {
                appState.matchEmail = auth.userEmail
                appState.configure(token: token, orgCode: appState.orgCode)
            }
        }

            if showSplash {
                SplashView(isShowing: $showSplash)
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
    }
}
