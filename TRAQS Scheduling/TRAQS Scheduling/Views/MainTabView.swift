import SwiftUI

struct MainTabView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        TabView {
            GanttView()
                .tabItem { Label("Schedule", systemImage: "calendar") }

            TasksView()
                .tabItem { Label("Jobs", systemImage: "checklist") }

            TimeClockView()
                .tabItem { Label("Time Clock", systemImage: "clock") }

            MessagesView()
                .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right") }

            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .tint(Color(hex: T.accent))
        .overlay(alignment: .topTrailing) {
            SaveStatusDot()
                .padding(.top, 22)
                .padding(.trailing, 16)
        }
    }
}

// MARK: - Save Status Dot

private struct SaveStatusDot: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        switch appState.saveStatus {
        case .saving:
            ProgressView()
                .scaleEffect(0.75)
                .tint(Color(hex: T.accent))
                .frame(width: 28, height: 28)
                .background(Color(hex: T.surface).opacity(0.92))
                .clipShape(Circle())
                .shadow(color: .black.opacity(0.12), radius: 4, x: 0, y: 2)
                .transition(.opacity)
        case .saved:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 26))
                .foregroundColor(Color(hex: T.statusFinished))
                .shadow(color: .black.opacity(0.12), radius: 4, x: 0, y: 2)
                .transition(.opacity)
        default:
            Color.clear.frame(width: 28, height: 28)
        }
    }
}
