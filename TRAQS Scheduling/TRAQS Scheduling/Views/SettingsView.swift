import SwiftUI
import PhotosUI
import UIKit

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
    @State private var showEditProfile = false

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

                        // ── Profile card (frosted) — tap opens Edit Profile ──
                        Button { showEditProfile = true } label: {
                            HStack(spacing: 14) {
                                Avatar(initials: avatarInitials, size: 52, gradient: true,
                                       imageData: appState.currentPerson?.image)
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
                .scrollIndicators(.visible)
            }
        }
        .sheet(isPresented: $showAppearance) { CustomizeView() }
        .sheet(isPresented: $showEditProfile) {
            EditProfileView().edgeSwipeBack { showEditProfile = false }
        }
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

// MARK: - Edit Profile (name / email / phone / color / photo)

struct EditProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var color = "#7C3AED"
    @State private var imageData: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var showLibrary = false
    @State private var showCamera = false
    @State private var showSourceDialog = false
    @State private var saving = false
    @State private var error: String?
    @State private var loaded = false

    private let palette = ["#7C3AED", "#4169E1", "#0EA5E9", "#14B8A6", "#10B981",
                           "#F59E0B", "#F97316", "#EF4444", "#EC4899", "#8B5CF6"]

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2).map { String($0.prefix(1)).uppercased() }
        let j = parts.joined(); return j.isEmpty ? "?" : j
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AmbientBackground()
                ScrollView {
                    VStack(spacing: 22) {
                        VStack(spacing: 12) {
                            Avatar(initials: initials, size: 96, fill: Color(hex: color), imageData: imageData)
                            Button { showSourceDialog = true } label: {
                                Text(imageData == nil ? "Add Photo" : "Change Photo")
                                    .font(TTypo.smBold(13))
                                    .foregroundStyle(Color(hex: T.accentGradientStart))
                            }
                            .buttonStyle(.plain)
                            if imageData != nil {
                                Button { imageData = nil } label: {
                                    Text("Remove Photo").font(TTypo.xs(12)).foregroundStyle(Color(hex: T.muted))
                                }.buttonStyle(.plain)
                            }
                        }
                        .padding(.top, 8)

                        VStack(spacing: 14) {
                            labeledField("NAME", text: $name, autocap: .words)
                            labeledField("EMAIL", text: $email, keyboard: .emailAddress)
                            labeledField("PHONE", text: $phone, keyboard: .phonePad)
                        }

                        VStack(alignment: .leading, spacing: 10) {
                            Text("PROFILE COLOR")
                                .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                                .foregroundStyle(Color(hex: T.muted))
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 12) {
                                ForEach(palette, id: \.self) { hex in
                                    Circle()
                                        .fill(Color(hex: hex))
                                        .frame(height: 40)
                                        .overlay(Circle().stroke(.white, lineWidth: color.lowercased() == hex.lowercased() ? 3 : 0))
                                        .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
                                        .onTapGesture { color = hex }
                                }
                            }
                        }
                        .padding(16)
                        .frostedCard(radius: T.cornerHero)

                        if let error {
                            Text(error).font(TTypo.xs(12)).foregroundStyle(Color(hex: T.red))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { save() }
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Profile Photo", isPresented: $showSourceDialog, titleVisibility: .visible) {
                Button("Take Photo") {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
                }
                Button("Choose from Library") { showLibrary = true }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { img in setImage(img) }.ignoresSafeArea()
            }
            .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
            .onChange(of: photoItem) { _, item in loadPhoto(item) }
        }
        .onAppear {
            guard !loaded, let p = appState.currentPerson else { return }
            name = p.name; email = p.email; phone = p.phone ?? ""
            color = p.color.isEmpty ? "#7C3AED" : p.color
            imageData = p.image
            loaded = true
        }
    }

    private func labeledField(_ label: String, text: Binding<String>,
                              autocap: TextInputAutocapitalization = .never,
                              keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(TTypo.xsBold(11)).tLabel(tracking: 1.4).foregroundStyle(Color(hex: T.muted))
            TextField("", text: text)
                .textInputAutocapitalization(autocap)
                .keyboardType(keyboard)
                .autocorrectionDisabled(keyboard == .emailAddress)
                .font(TTypo.sm(15))
                .foregroundStyle(Color(hex: T.ink))
                .padding(12)
                .background(RoundedRectangle(cornerRadius: T.cornerMd).fill(Color(hex: T.surface)))
                .overlay(RoundedRectangle(cornerRadius: T.cornerMd).stroke(Color(hex: T.hair), lineWidth: 1))
        }
    }

    private func setImage(_ img: UIImage) {
        if let data = ImageDownscaler.jpeg(from: img, maxEdge: 512, quality: 0.85) {
            imageData = "data:image/jpeg;base64," + data.base64EncodedString()
        }
    }
    private func loadPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                await MainActor.run { setImage(img) }
            }
        }
    }
    private func save() {
        saving = true; error = nil
        let n = name.trimmingCharacters(in: .whitespaces)
        let e = email.trimmingCharacters(in: .whitespaces)
        let ph = phone.trimmingCharacters(in: .whitespaces)
        Task {
            let ok = await appState.updateMyProfile(name: n, email: e, phone: ph, color: color, image: imageData)
            saving = false
            if ok { dismiss() } else { error = "Couldn't save your profile. Try again." }
        }
    }
}
