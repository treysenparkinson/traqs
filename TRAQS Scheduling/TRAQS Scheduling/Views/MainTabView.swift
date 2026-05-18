import SwiftUI

struct MainTabView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        TabView {
            GanttView()
                .tabItem { Label("Schedule", systemImage: "calendar") }

            TasksView()
                .tabItem { Label("Jobs", systemImage: "briefcase") }

            TimeClockView()
                .tabItem { Label("Time Stamp", systemImage: "clock") }

            MessagesView()
                .tabItem { Label("Messages", systemImage: "message") }

            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .tint(Color(hex: T.accent))
    }
}
