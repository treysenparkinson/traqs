import SwiftUI

// MARK: - Home header controls (top-right)
// The account controls that used to live in the side drawer, now on the Home
// header's trailing edge. Left → right: Admin (admins only) · Settings glass
// menu · Profile avatar.

struct HomeHeaderControls: View {
    var body: some View {
        HStack(spacing: 6) {
            // Down to a single control. Profile became the first item inside the
            // settings menu, and Admin moved to the Analytics header — the page an
            // admin is already on when they want it.
            SettingsGlassMenu()
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

/// Internal, not private: the Analytics header uses it too — it is the one
/// control that belongs beside the stats an admin is already looking at, rather
/// than on Home.
struct AdminHeaderButton: View {
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
    @Environment(AppState.self) private var appState
    @State private var showCustomize = false
    @State private var showProfile = false

    /// The signed-in person's name, so the profile row reads as "who you are"
    /// rather than a generic label. Falls back to "Profile" before people load.
    private var profileTitle: String {
        let name = appState.currentPerson?.name ?? ""
        return name.isEmpty ? "Profile" : name
    }

    var body: some View {
        Menu {
            // Was the avatar button in the header. A menu row can't render the
            // photo itself — the system draws these as label + SF Symbol — so it
            // carries the person's NAME, which identifies the account just as well.
            Button {
                showProfile = true
            } label: {
                Label(profileTitle, systemImage: "person.crop.circle")
            }
            Divider()
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
        .sheet(isPresented: $showProfile) {
            EditProfileView().edgeSwipeBack { showProfile = false }
        }
    }
}
