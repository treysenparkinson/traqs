import SwiftUI

// MARK: - TRAQS Wordmark (image asset)
// Uses the official brand wordmark PNG from Assets.xcassets. `size` is the
// rendered HEIGHT in points; aspect ratio is preserved.
// Light theme → "TRAQSLogoBlack" (dark ink wordmark for light surfaces).
// Dark theme  → "TRAQSLogoWhite" (paper wordmark for dark surfaces).

struct TRAQSWordmark: View {
    @Environment(ThemeSettings.self) private var themeSettings
    var size: CGFloat = 44

    var body: some View {
        Image(themeSettings.isLightTheme ? "TRAQSLogoBlack" : "TRAQSLogoWhite")
            .resizable()
            // .interpolation(.high) tells SwiftUI to use high-quality
            // sampling when scaling the 3840-wide source down to display
            // size, and .antialiased smooths the resulting glyph edges so
            // the wordmark doesn't look pixelated in the nav header.
            .interpolation(.high)
            .antialiased(true)
            .scaledToFit()
            .frame(height: size)
    }
}

// Back-compat: a few places still call TRAQSNavLogo() — keep as the image wordmark.
struct TRAQSNavLogo: View {
    var body: some View { TRAQSWordmark(size: 44) }
}

// MARK: - Screen Header
// Wordmark on the left, trailing icons + magenta profile avatar on the right.
// No center title — the tab bar tells the user where they are.

struct TRAQSNavHeader<Trailing: View>: View {
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            TRAQSMenuButton()
            TRAQSWordmark(size: 58)
            Spacer()
            HStack(spacing: 6) {
                trailing()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 36)
    }
}

extension TRAQSNavHeader where Trailing == EmptyView {
    init() { self.trailing = { EmptyView() } }
    /// Back-compat: older call sites used a centered tab name. Per the wireframes
    /// there's no centered title now — the tab bar tells the user where they are.
    /// We accept and ignore the argument so the build keeps moving while screens
    /// are rewritten.
    init(tabName _: String) { self.trailing = { EmptyView() } }
}

// MARK: - Profile Button (right side of the header)

struct TRAQSProfileButton: View {
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    @State private var showSheet = false

    private var person: Person? { appState.currentPerson }
    private var initial: String {
        // Take two initials when we have a "First Last" pattern; otherwise one.
        let parts = (person?.name ?? "—")
            .split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
        return parts.joined()
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
                // Avatar: centered initials over the magenta circle
                ZStack {
                    Circle().fill(Color(hex: T.magenta))
                    Text(initial)
                        .font(.custom(TFontName.bold.rawValue, size: 12))
                        .foregroundStyle(.white)
                }
                .frame(width: 32, height: 32)

                if isSaving {
                    ProgressView()
                        .scaleEffect(0.5)
                        .tint(Color(hex: T.sky))
                        .frame(width: 12, height: 12)
                        .background(Circle().fill(Color(hex: T.surface)))
                        .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
                        .offset(x: 2, y: 2)
                        .transition(.opacity)
                } else if isSaved {
                    Image(systemName: "checkmark")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 12, height: 12)
                        .background(Circle().fill(Color(hex: T.green)))
                        .overlay(Circle().stroke(Color(hex: T.surface), lineWidth: 1.5))
                        .offset(x: 2, y: 2)
                        .transition(.opacity)
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
    private var initials: String {
        let parts = (person?.name ?? "—")
            .split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
        return parts.joined()
    }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 18) {
                Avatar(initials: initials, size: 72, fill: Color(hex: T.magenta))
                    .padding(.top, 12)

                VStack(spacing: 4) {
                    Text(person?.name ?? "—")
                        .font(TTypo.h3(20))
                        .foregroundStyle(Color(hex: T.ink))
                    if let email = person?.email, !email.isEmpty {
                        Text(email)
                            .font(TTypo.sm(14))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    if let role = person?.role, !role.isEmpty {
                        Chip(label: role, stroke: Color(hex: T.hair), color: Color(hex: T.muted))
                            .padding(.top, 4)
                    }
                }

                Spacer()

                Button {
                    auth.logout()
                    dismiss()
                } label: {
                    HStack(spacing: 8) {
                        TIconView(icon: .signOut, size: 13, color: Color(hex: T.red))
                        Text("SIGN OUT")
                            .font(TTypo.xsBold(12))
                            .tLabel(tracking: 1.0)
                    }
                    .foregroundStyle(Color(hex: T.red))
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                    .background(Capsule().fill(Color(hex: T.red).opacity(0.10)))
                    .overlay(Capsule().stroke(Color(hex: T.red).opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
    }
}

// MARK: - FastTRAQSPillButton — kept for back-compat
struct FastTRAQSPillButton: View {
    var body: some View {
        TIconView(icon: .sparkle, size: 15, color: Color(hex: T.sky))
            .padding(8)
            .background(Circle().fill(Color(hex: T.sky).opacity(0.12)))
            .overlay(Circle().stroke(Color(hex: T.sky).opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Legacy view-modifiers (kept compiling for older call sites — the new design
// uses SBox / PillBtn / IconBtn directly).

extension View {
    func traqsCard(radius: CGFloat = T.cornerMd) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color(hex: T.surface)))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
            .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                    radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
    }

    func traqsToolbar(radius: CGFloat = T.cornerLg) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color(hex: T.surface)))
            .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                    radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
    }

    func traqsField(radius: CGFloat = T.cornerMd) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color(hex: T.surface)))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
    }
}
