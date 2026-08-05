import SwiftUI

// MARK: - Home header controls (top-right)
// The account controls that used to live in the side drawer, now on the Home
// header's trailing edge. Left → right: Admin (admins only) · Settings glass
// menu · Profile avatar.

struct HomeHeaderControls: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(spacing: 6) {
            if appState.isAdmin { AdminHeaderButton() }
            SettingsGlassMenu()
            ProfileAvatarButton()
        }
    }
}

// Liquid Glass circle label. Sizing lives in HeaderGlassCircle so these match
// every other header control in the app — they used to be 36 here while other
// pages ran 32, 34 and 38.
private struct GlassCircleIcon: View {
    let systemName: String
    /// Ink by default — header glyphs read as plain black or white, and an accent
    /// tint on a permanent control reads as a selected state.
    var color: Color = Color(hex: T.ink)

    var body: some View {
        HeaderGlassCircle {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(color)
        }
    }
}

// MARK: - Admin button → full-screen AdminView

private struct AdminHeaderButton: View {
    @State private var showAdmin = false

    var body: some View {
        Button { showAdmin = true } label: {
            GlassCircleIcon(systemName: "shield.lefthalf.filled",
                            color: Color(hex: T.ink))
        }
        .buttonStyle(.plain)
        .fullScreenCover(isPresented: $showAdmin) {
            AdminView().edgeSwipeBack { showAdmin = false }
        }
    }
}

// MARK: - Settings gear → native Liquid Glass menu
// A glass circle that morphs into a native menu (Customization · Log out) —
// the same Liquid Glass forming behaviour as the Jobs page's availability
// button (AvailabilityCheckButton).

private struct SettingsGlassMenu: View {
    @Environment(AuthManager.self) private var auth
    @State private var showCustomize = false

    var body: some View {
        Menu {
            Button {
                showCustomize = true
            } label: {
                Label("Customization", systemImage: "sparkles")
            }
            Divider()
            Button(role: .destructive) {
                auth.logout()
            } label: {
                Label("Log out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            // Ink, not accent: plain black on light presets, plain white on dark.
            // The accent tint made the gear read as an active/selected state.
            GlassCircleIcon(systemName: "gearshape", color: Color(hex: T.ink))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showCustomize) { CustomizeView() }
    }
}

// MARK: - Profile avatar → Edit Profile

private struct ProfileAvatarButton: View {
    @Environment(AppState.self) private var appState
    @State private var showProfile = false

    private var person: Person? { appState.currentPerson }
    private var initials: String {
        let parts = (person?.name ?? "—")
            .split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
        return parts.joined()
    }

    var body: some View {
        Button { showProfile = true } label: {
            Avatar(initials: initials.isEmpty ? "—" : initials,
                   size: 36, gradient: true, imageData: person?.image)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showProfile) {
            EditProfileView().edgeSwipeBack { showProfile = false }
        }
    }
}
