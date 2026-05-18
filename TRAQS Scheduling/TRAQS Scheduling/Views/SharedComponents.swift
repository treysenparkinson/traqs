import SwiftUI

// MARK: - TRAQS Nav Bar Logo

struct TRAQSNavLogo: View {
    @Environment(ThemeSettings.self) private var themeSettings

    var body: some View {
        Image(themeSettings.isLightTheme ? "TRAQSLogoBlack" : "TRAQSLogoWhite")
            .resizable()
            .scaledToFit()
            .frame(height: 32)
    }
}

// MARK: - TRAQS Nav Header (logo left · page name center · profile right)

struct TRAQSNavHeader: View {
    let tabName: String

    var body: some View {
        ZStack {
            // Center: page name
            Text(tabName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color(hex: T.muted))
                .kerning(1.2)
                .textCase(.uppercase)

            HStack {
                TRAQSNavLogo()
                Spacer()
                TRAQSProfileButton()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 18)
        // No background — the header is part of the page bg.
        // The rounded toolbar pills below sit on the bg with their own shadows,
        // creating clear separation without a hard divider.
    }
}

// MARK: - Profile Button (top-right)

struct TRAQSProfileButton: View {
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    @State private var showSheet = false

    private var person: Person? { appState.currentPerson }
    private var initial: String {
        String((person?.name ?? "U").prefix(1)).uppercased()
    }
    private var avatarColor: Color {
        Color(hex: person?.color ?? T.accent)
    }
    private var isSaving: Bool {
        if case .saving = appState.saveStatus { return true }
        return false
    }
    private var isSaved: Bool {
        if case .saved = appState.saveStatus { return true }
        return false
    }

    var body: some View {
        Button { showSheet = true } label: {
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(avatarColor)
                    .frame(width: 34, height: 34)
                    .overlay(
                        Text(initial)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                    )
                    .overlay(Circle().stroke(Color(hex: T.border), lineWidth: 1))

                // Save status badge
                if isSaving {
                    ProgressView()
                        .scaleEffect(0.55)
                        .tint(Color(hex: T.accent))
                        .frame(width: 14, height: 14)
                        .background(Circle().fill(Color(hex: T.surface)))
                        .overlay(Circle().stroke(Color(hex: T.border), lineWidth: 1))
                        .offset(x: 2, y: 2)
                        .transition(.scale.combined(with: .opacity))
                } else if isSaved {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 14, height: 14)
                        .background(Circle().fill(Color(hex: T.statusFinished)))
                        .overlay(Circle().stroke(Color(hex: T.surface), lineWidth: 1.5))
                        .offset(x: 2, y: 2)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: isSaving)
            .animation(.easeInOut(duration: 0.2), value: isSaved)
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showSheet) {
            ProfileSheet()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Profile Sheet

private struct ProfileSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss

    private var person: Person? { appState.currentPerson }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 18) {
                // Avatar
                Circle()
                    .fill(Color(hex: person?.color ?? T.accent))
                    .frame(width: 72, height: 72)
                    .overlay(
                        Text(String((person?.name ?? "U").prefix(1)).uppercased())
                            .font(.system(size: 30, weight: .bold))
                            .foregroundColor(.white)
                    )
                    .padding(.top, 16)

                VStack(spacing: 4) {
                    Text(person?.name ?? "—")
                        .font(.title3.bold())
                        .foregroundColor(Color(hex: T.text))
                    if let email = person?.email, !email.isEmpty {
                        Text(email)
                            .font(.subheadline)
                            .foregroundColor(Color(hex: T.muted))
                    }
                    if let role = person?.role, !role.isEmpty {
                        Text(role)
                            .font(.caption)
                            .foregroundColor(Color(hex: T.muted))
                            .padding(.horizontal, 10).padding(.vertical, 3)
                            .background(Capsule().fill(Color(hex: T.card)))
                            .overlay(Capsule().stroke(Color(hex: T.border), lineWidth: 1))
                            .padding(.top, 4)
                    }
                }

                Spacer()

                Button {
                    auth.logout()
                    dismiss()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                        Text("Sign Out")
                    }
                    .font(.subheadline.bold())
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color(hex: T.danger).opacity(0.14))
                    .foregroundColor(Color(hex: T.danger))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(hex: T.danger).opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
    }
}

// MARK: - Shared Rounded-Surface Modifiers

extension View {
    /// Card body — for groups of related content (e.g. job row, status card).
    func traqsCard(radius: CGFloat = T.cornerMd) -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color(hex: T.card))
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Color(hex: T.border), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(T.shadowOpacity * 0.5),
                    radius: T.shadowRadius * 0.5, x: 0, y: T.shadowY * 0.5)
    }

    /// Toolbar / sub-header strip — sits under TRAQSNavHeader, rounded all the way around.
    func traqsToolbar(radius: CGFloat = T.cornerLg) -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color(hex: T.surface))
            )
            .shadow(color: Color.black.opacity(T.shadowOpacity * 0.65),
                    radius: T.shadowRadius * 0.8, x: 0, y: T.shadowY * 0.75)
    }

    /// Inset field (search bars, single-line containers).
    func traqsField(radius: CGFloat = T.cornerMd) -> some View {
        self
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color(hex: T.surface))
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Color(hex: T.border), lineWidth: 1)
            )
    }
}

// MARK: - Fast TRAQS Labeled Button

struct FastTRAQSPillButton: View {
    var body: some View {
        Image(systemName: "bolt.fill")
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(Color(hex: T.accent))
            .frame(width: 32, height: 32)
            .background(Color(hex: T.accent).opacity(0.12))
            .clipShape(Circle())
            .overlay(Circle().stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
    }
}
