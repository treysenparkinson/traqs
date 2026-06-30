import SwiftUI

// MARK: - Settings · TRAQS Revamp
// Lightweight V1 settings — appearance, notifications, account, about.
// Restyled to the revamp design language: ambient canvas, PageTitle, frosted
// profile / section cards, gradient avatar, icon chips, red sign-out card.

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var showAppearance = false

    // ── Derived display values (no state — pure read of appState) ──
    private var personName: String { appState.currentPerson?.name ?? "—" }
    private var personRole: String { appState.currentPerson?.role ?? "" }
    private var personEmail: String { appState.currentPerson?.email ?? "" }
    private var orgValue: String { appState.orgCode.isEmpty ? "—" : appState.orgCode }
    private var avatarInitials: String {
        let parts = personName
            .split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
        let joined = parts.joined()
        return joined.isEmpty ? "—" : joined
    }
    private var profileSubtitle: String {
        if !personEmail.isEmpty && orgValue != "—" { return "\(personEmail) · \(orgValue)" }
        if !personEmail.isEmpty { return personEmail }
        return orgValue
    }
    private var nameRoleLine: String {
        personRole.isEmpty ? personName : "\(personName) · \(personRole)"
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                // Header (sheet chrome — keep dismiss action)
                HStack {
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(Color(hex: T.surface)))
                            .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 4)

                ScrollView {
                    VStack(spacing: 18) {
                        PageTitle(title: "Settings")
                            .padding(.top, 4)

                        // ── Profile card (frosted) — tap opens appearance ──
                        Button { showAppearance = true } label: {
                            HStack(spacing: 14) {
                                Avatar(initials: avatarInitials, size: 52, gradient: true)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(nameRoleLine)
                                        .font(TTypo.h3(17))
                                        .foregroundStyle(Color(hex: T.ink))
                                        .lineLimit(1)
                                    if !profileSubtitle.isEmpty {
                                        Text(profileSubtitle)
                                            .font(TTypo.sm(13))
                                            .foregroundStyle(Color(hex: T.muted))
                                            .lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 8)
                                TIconView(icon: .chev, size: 13, color: Color(hex: T.muted))
                            }
                            .padding(16)
                            .frostedCard(radius: T.cornerHero)
                        }
                        .buttonStyle(.plain)

                        // ── PREFERENCES — frosted card with chip rows ──
                        SettingsGroup(title: "Preferences") {
                            SettingsActionRow(icon: .sparkle,
                                              label: "Theme & accent",
                                              value: nil,
                                              showChevron: true) {
                                showAppearance = true
                            }
                        }

                        // ── ACCOUNT — frosted card, chip + label + value rows ──
                        SettingsGroup(title: "Account") {
                            VStack(spacing: 0) {
                                if let p = appState.currentPerson {
                                    SettingsValueRow(icon: .person,
                                                     label: "Signed in as",
                                                     value: p.name)
                                    SettingsDivider()
                                    if !p.email.isEmpty {
                                        SettingsValueRow(icon: .send,
                                                         label: "Email",
                                                         value: p.email)
                                        SettingsDivider()
                                    }
                                    if !p.role.isEmpty {
                                        SettingsValueRow(icon: .admin,
                                                         label: "Role",
                                                         value: p.role)
                                        SettingsDivider()
                                    }
                                }
                                SettingsValueRow(icon: .clients,
                                                 label: "Organization",
                                                 value: orgValue)
                                SettingsDivider()
                                SettingsValueRow(icon: .bolt,
                                                 label: "About TRAQS",
                                                 value: "\(appVersionString) (\(appBuildString))")
                            }
                        }

                        // ── Sign out — its own frosted card, red text/icon ──
                        Button {
                            auth.logout()
                            dismiss()
                        } label: {
                            HStack(spacing: 8) {
                                TIconView(icon: .signOut, size: 16, color: Color(hex: T.red))
                                Text("Sign out")
                                    .font(TTypo.smBold(15))
                                    .foregroundStyle(Color(hex: T.red))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .frostedCard(radius: T.cornerHero)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 4)
                        .padding(.bottom, 32)
                    }
                    .padding(.horizontal, 16)
                }
                .scrollIndicators(.hidden)
            }
        }
        .sheet(isPresented: $showAppearance) { CustomizeView() }
    }

    private var appVersionString: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        return v == "—" ? v : "v\(v)"
    }
    private var appBuildString: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }
}

// MARK: - Section group: uppercased label + frosted card

private struct SettingsGroup<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.4)
                .padding(.leading, 6)
            VStack(spacing: 0) {
                content()
            }
            .padding(.vertical, 4)
            .frostedCard(radius: T.cornerHero)
        }
    }
}

// MARK: - Hairline divider between rows inside a frosted card

private struct SettingsDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color(hex: T.hair).opacity(0.7))
            .frame(height: 1)
            .padding(.leading, 64)
            .padding(.trailing, 16)
    }
}

// MARK: - Tappable row: IconChip + label + optional value + chevron

private struct SettingsActionRow: View {
    let icon: TIcon
    let label: String
    var value: String? = nil
    var showChevron: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                IconChip(icon: icon, color: Color(hex: T.pillIndigoFg), size: 36)
                Text(label)
                    .font(TTypo.smBold(15))
                    .foregroundStyle(Color(hex: T.ink))
                Spacer(minLength: 8)
                if let value {
                    Text(value)
                        .font(TTypo.sm(14))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
                if showChevron {
                    TIconView(icon: .chev, size: 12, color: Color(hex: T.muted))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Read-only row: IconChip + label + trailing value

private struct SettingsValueRow: View {
    let icon: TIcon
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 14) {
            IconChip(icon: icon, color: Color(hex: T.pillIndigoFg), size: 36)
            Text(label)
                .font(TTypo.smBold(15))
                .foregroundStyle(Color(hex: T.ink))
            Spacer(minLength: 8)
            Text(value)
                .font(TTypo.sm(14))
                .foregroundStyle(Color(hex: T.muted))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }
}
