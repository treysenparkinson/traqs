import SwiftUI

// MARK: - App-wide Navigation
// Holds the selected tab and the side-menu open state. Injected at the App
// root so the header's hamburger button (anywhere) and the drawer overlay
// (in MainTabView) can both read & toggle it.

@Observable
@MainActor
final class AppNav {
    var selected: TTab = .schedule
    var isMenuOpen: Bool = false
    /// Secondary destinations opened from the drawer. Rendered as a full-screen
    /// cover over the current tab so the wireframe's 5-tab IA is preserved.
    var extra: DrawerExtra? = nil
}

enum DrawerExtra: String, Hashable, Identifiable {
    case clients, team
    var id: String { rawValue }
}
