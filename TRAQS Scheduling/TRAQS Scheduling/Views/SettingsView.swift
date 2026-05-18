import SwiftUI

// MARK: - Settings · TRAQS Light
// Lightweight V1 settings — appearance, notifications, account, about.
// More sections can be added as the product grows.

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var showAppearance = false

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Settings")
                        .font(.custom(TFontName.bold.rawValue, size: 22))
                        .foregroundStyle(Color(hex: T.ink))
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
                .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 16)

                ScrollView {
                    VStack(spacing: 20) {
                        // ── Appearance ──
                        SettingsSection(title: "Appearance") {
                            SettingsRow(icon: .sparkle,
                                        title: "Theme & accent",
                                        subtitle: "Customize colors and palette",
                                        trailing: .chevron) {
                                showAppearance = true
                            }
                        }

                        // ── Account ──
                        SettingsSection(title: "Account") {
                            VStack(spacing: 8) {
                                if let p = appState.currentPerson {
                                    SettingsDetailRow(label: "Signed in as", value: p.name)
                                    if !p.email.isEmpty {
                                        SettingsDetailRow(label: "Email", value: p.email)
                                    }
                                    if !p.role.isEmpty {
                                        SettingsDetailRow(label: "Role", value: p.role)
                                    }
                                }
                                SettingsDetailRow(label: "Organization", value: appState.orgCode.isEmpty ? "—" : appState.orgCode)
                            }
                        }

                        // ── About ──
                        SettingsSection(title: "About") {
                            VStack(spacing: 8) {
                                SettingsDetailRow(label: "Version", value: appVersionString)
                                SettingsDetailRow(label: "Build", value: appBuildString)
                            }
                        }

                        // ── Sign out ──
                        Button {
                            auth.logout()
                            dismiss()
                        } label: {
                            HStack(spacing: 8) {
                                TIconView(icon: .signOut, size: 14, color: Color(hex: T.red))
                                Text("SIGN OUT")
                                    .font(TTypo.xsBold(12))
                                    .tLabel(tracking: 1.0)
                            }
                            .foregroundStyle(Color(hex: T.red))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Capsule().fill(Color(hex: T.red).opacity(0.10)))
                            .overlay(Capsule().stroke(Color(hex: T.red).opacity(0.30), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 4)
                        .padding(.bottom, 32)
                    }
                    .padding(.horizontal, 20)
                }
                .scrollIndicators(.hidden)
            }
        }
        .sheet(isPresented: $showAppearance) { CustomizeView() }
    }

    private var appVersionString: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }
    private var appBuildString: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }
}

// MARK: - Section wrapper

private struct SettingsSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.4)
                .padding(.leading, 4)
            content()
        }
    }
}

// MARK: - Tappable row (icon + title + chevron)

enum SettingsTrailing { case chevron, none }

private struct SettingsRow: View {
    let icon: TIcon
    let title: String
    var subtitle: String? = nil
    var trailing: SettingsTrailing = .chevron
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Capsule().fill(Color(hex: T.sky).opacity(0.10))
                        .frame(width: 36, height: 28)
                    TIconView(icon: icon, size: 16, color: Color(hex: T.sky))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.ink))
                    if let s = subtitle {
                        Text(s)
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                }
                Spacer()
                if trailing == .chevron {
                    TIconView(icon: .chev, size: 12, color: Color(hex: T.muted))
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                .fill(Color(hex: T.surface)))
            .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                .stroke(Color(hex: T.hair), lineWidth: 1))
            .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                    radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Read-only detail row

private struct SettingsDetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(TTypo.sm(13))
                .foregroundStyle(Color(hex: T.muted))
            Spacer()
            Text(value)
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.ink))
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
            .fill(Color(hex: T.surface)))
        .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
            .stroke(Color(hex: T.hair), lineWidth: 1))
    }
}
