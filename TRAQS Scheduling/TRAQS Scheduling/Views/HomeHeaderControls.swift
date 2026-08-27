import SwiftUI

// MARK: - Home header controls (top-right)
// The account controls that used to live in the side drawer, now on the Home
// header's trailing edge. One control: your profile picture, which morphs into
// the account menu.

// MARK: - Admin button → full-screen AdminView

/// Internal, not private: the Analytics header uses it too — it is the one
/// control that belongs beside the stats an admin is already looking at, rather
/// than on Home.
struct AdminHeaderButton: View {
    @State private var showAdmin = false

    var body: some View {
        Button { showAdmin = true } label: {
            // Bare — HeaderControlsHost paints the glass so the shape sits at
            // the level glassEffectID binds to. See that host's note.
            HeaderSlot {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
            }
        }
        .buttonStyle(.plain)
        .fullScreenCover(isPresented: $showAdmin) {
            AdminView().edgeSwipeBack { showAdmin = false }
        }
    }
}

// MARK: - Profile picture → native Liquid Glass menu
// A glass circle that morphs into a native menu (Profile · Customization · Log
// out) — the same Liquid Glass forming behaviour as the Jobs page's availability
// button (AvailabilityCheckButton).
//
// The label is your own profile picture rather than a gear. A gear names the
// least of what the menu holds — the menu is the ACCOUNT, and your face is what
// says whose account it is. It also matches where every other app puts this, so
// it needs no learning.

/// Internal, not private: HomeView publishes this into the app-wide header host
/// rather than rendering it itself. See HeaderControls.swift.
struct AccountGlassMenu: View {
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState
    @State private var showCustomize = false
    @State private var showProfile = false

    /// The control itself: your photo, or your colour and initials when you have
    /// none, sitting INSIDE the standard header glass circle rather than
    /// replacing it — that circle is what morphs into the menu, so the avatar is
    /// inset a hair and rides the same glass every other header control does.
    ///
    /// Before people load there is no photo and no colour to fall back on, so it
    /// shows a person glyph rather than an empty circle or a "?" that would flash
    /// and then swap.
    @ViewBuilder
    private var profileLabel: some View {
        if let me = appState.currentPerson {
            HeaderSlot {
                Avatar(initials: Initials.from(me),
                       size: HeaderControl.diameter - avatarInset * 2,
                       fill: .personFill(me.color),
                       imageData: me.image)
            }
        } else {
            HeaderSlot {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
            }
        }
    }

    /// Glass left showing around the photo. Enough to read as a rim on the same
    /// material as its neighbours; more and the photo stops reading as a photo.
    private let avatarInset: CGFloat = 3

    var body: some View {
        Menu {
            // Just "Profile". This used to carry the person's NAME, from when the
            // header button was a gear and the menu was the only thing saying
            // whose account it was. The button is your face now, so repeating the
            // name here labels the row with the answer instead of the action.
            Button {
                showProfile = true
            } label: {
                Label("Profile", systemImage: "person.crop.circle")
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
            profileLabel
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showCustomize) { CustomizeView() }
        .sheet(isPresented: $showProfile) {
            EditProfileView().edgeSwipeBack { showProfile = false }
        }
    }
}
