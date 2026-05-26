import SwiftUI

struct CustomizeView: View {
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var customAccentColor: Color = Color(hex: "#3d7fff")

    private var presets: [BgPreset] { ThemeSettings.bgPresets }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {

                    // ── Accent Color ──
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Accent Color")

                        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 12) {
                            ForEach(ThemeSettings.accentPresets, id: \.self) { hex in
                                AccentSwatch(hex: hex, isSelected: theme.accent == hex) {
                                    theme.setAccent(hex)
                                    customAccentColor = Color(hex: hex)
                                }
                            }

                            // Custom color picker
                            ColorPicker("", selection: $customAccentColor, supportsOpacity: false)
                                .labelsHidden()
                                .frame(width: 36, height: 36)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color(hex: T.border), lineWidth: 1.5))
                                .onChange(of: customAccentColor) { _, newColor in
                                    theme.setAccent(newColor.hexString)
                                }
                        }
                        .padding(.horizontal, 16)
                    }

                    // ── Background ──
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Background")
                        VStack(spacing: 8) {
                            ForEach(presets) { preset in
                                BgPresetRow(preset: preset, isSelected: theme.bgPresetId == preset.id) {
                                    theme.setBgPreset(preset.id)
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    // ── Save ──
                    // Accent / background changes are already persisted
                    // live via setAccent / setBgPreset (they write to
                    // UserDefaults the moment they're picked), so this
                    // button's job is to commit the version bump that
                    // forces every open screen to re-render with the new
                    // T.* tokens and dismiss back to the previous view.
                    Button {
                        theme.commitChanges()
                        dismiss()
                    } label: {
                        Text("Save")
                            .font(.subheadline.bold())
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color(hex: T.accent))
                            .cornerRadius(12)
                            .shadow(color: Color(hex: T.accent).opacity(T.skyShadowOpacity),
                                    radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .padding(.top, 16)
            }
        }
        .navigationTitle("Customize")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(theme.isLightTheme ? .light : .dark, for: .navigationBar)
        .onAppear {
            customAccentColor = Color(hex: theme.accent)
        }
        .onDisappear {
            theme.commitChanges()
        }
    }

}

// MARK: - Subviews

private struct SectionHeader: View {
    let title: String
    var body: some View {
        Text(title)
            .font(.subheadline.bold())
            .foregroundColor(Color(hex: T.text))
            .padding(.horizontal, 16)
    }
}

private struct AccentSwatch: View {
    let hex: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(Color(hex: hex))
                .frame(width: 36, height: 36)
                .overlay(
                    isSelected
                        ? Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                        : nil
                )
                .overlay(
                    Circle()
                        .stroke(isSelected ? Color.white.opacity(0.6) : Color(hex: T.border), lineWidth: isSelected ? 2 : 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct BgPresetRow: View {
    let preset: BgPreset
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                // Color stack preview
                HStack(spacing: 3) {
                    ForEach([preset.bg, preset.surface, preset.card, preset.border], id: \.self) { hex in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(hex: hex))
                            .frame(width: 18, height: 32)
                    }
                }
                .cornerRadius(6)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: T.border), lineWidth: 1))

                VStack(alignment: .leading, spacing: 2) {
                    Text(preset.name)
                        .font(.subheadline.bold())
                        .foregroundColor(Color(hex: T.text))
                    Text(preset.isLight ? "Light" : "Dark")
                        .font(.caption2)
                        .foregroundColor(Color(hex: T.muted))
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(Color(hex: T.accent))
                        .font(.title3)
                } else {
                    Circle()
                        .stroke(Color(hex: T.border), lineWidth: 1.5)
                        .frame(width: 22, height: 22)
                }
            }
            .padding(12)
            .background(Color(hex: T.card))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color(hex: T.accent) : Color(hex: T.border), lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Color → Hex

extension Color {
    var hexString: String {
        let uiColor = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}
