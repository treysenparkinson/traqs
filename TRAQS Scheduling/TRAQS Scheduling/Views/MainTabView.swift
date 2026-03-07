import SwiftUI

struct MainTabView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        TabView {
            GanttView()
                .tabItem { Label("Schedule", systemImage: "calendar") }

            TasksView()
                .tabItem { Label("Jobs", systemImage: "checklist") }

            ClientsView()
                .tabItem { Label("Clients", systemImage: "building.2") }

            MessagesView()
                .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right") }

            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .tint(Color(hex: T.accent))
        .overlay(alignment: .top) {
            saveStatusBanner
        }
    }

    @ViewBuilder
    private var saveStatusBanner: some View {
        switch appState.saveStatus {
        case .saving:
            HStack(spacing: 6) {
                ProgressView().scaleEffect(0.7).tint(.white)
                Text("Saving…").font(.caption).foregroundColor(.white)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(hex: T.surface).opacity(0.9))
            .cornerRadius(20)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
        case .saved:
            HStack(spacing: 6) {
                Image(systemName: "checkmark").font(.caption).foregroundColor(Color(hex: T.statusFinished))
                Text("Saved").font(.caption).foregroundColor(Color(hex: T.text))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(hex: T.surface).opacity(0.9))
            .cornerRadius(20)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
        default:
            EmptyView()
        }
    }
}
