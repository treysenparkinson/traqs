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

// Shared 36×36 Liquid Glass circle label. A fixed glyph box keeps the circle the
// exact same size regardless of the SF Symbol's intrinsic width, so the Admin,
// Settings, and Profile controls all match (36 = 22 glyph box + 7 padding ×2).
private struct GlassCircleIcon: View {
    let systemName: String
    var color: Color = Color(hex: T.accent)

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 22, height: 22)
            .padding(7)
            .glassEffect(.regular.interactive(), in: Circle())
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
            GlassCircleIcon(systemName: "gearshape", color: Color(hex: T.accent))
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
