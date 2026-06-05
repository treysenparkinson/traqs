import SwiftUI

// MARK: - App-wide Navigation
// Holds the selected tab and the side-menu open state. Injected at the App
// root so the header's hamburger button (anywhere) and the drawer overlay
// (in MainTabView) can both read & toggle it.

@Observable
@MainActor
final class AppNav {
    var selected: TTab = .jobs
    var isMenuOpen: Bool = false
}
