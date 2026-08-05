import SwiftUI
import PhotosUI
import UIKit

// MARK: - Edit Profile (name / email / phone / color / photo)
// The account editor plus an About footer (org / role / version) folded in from
// the retired SettingsView sheet.

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
                PageBackground()
                ScrollView {
                    VStack(spacing: 22) {
                        VStack(spacing: 12) {
                            Avatar(initials: initials, size: 96, fill: .personFill(color), imageData: imageData)
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

                        // ── About (folded in from the retired Settings sheet) ──
                        VStack(alignment: .leading, spacing: 12) {
                            Text("ABOUT")
                                .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                                .foregroundStyle(Color(hex: T.muted))
                            aboutRow(label: "Organization",
                                     value: appState.orgName.isEmpty ? "TRAQS" : appState.orgName)
                            if let role = appState.currentPerson?.role, !role.isEmpty {
                                aboutRow(label: "Role", value: role)
                            }
                            aboutRow(label: "TRAQS",
                                     value: "\(appVersionString) (\(appBuildString))")
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

    @ViewBuilder
    private func aboutRow(label: String, value: String) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(TTypo.sm(14))
                .foregroundStyle(Color(hex: T.muted))
            Spacer(minLength: 8)
            Text(value)
                .font(TTypo.smBold(14))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private var appVersionString: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        return v == "—" ? v : "v\(v)"
    }
    private var appBuildString: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
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
