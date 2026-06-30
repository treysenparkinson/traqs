import SwiftUI

struct CustomizeView: View {
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var customAccentColor: Color = Color(hex: "#3d7fff")
    @State private var didSave = false

    private var presets: [BgPreset] { ThemeSettings.bgPresets }

    var body: some View {
        ZStack {
            AmbientBackground()

            ScrollView {
                VStack(spacing: 24) {

                    PageTitle(title: "Customize", subtitle: "Make TRAQS your own")
                        .padding(.bottom, 2)

                    // ── Accent Color ──
                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel("Accent Color")

                        VStack(alignment: .leading, spacing: 14) {
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 14) {
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
                                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1.5))
                                    .onChange(of: customAccentColor) { _, newColor in
                                        theme.setAccent(newColor.hexString)
                                    }
                            }
                        }
                        .padding(16)
                        .frostedCard(radius: T.cornerMd)
                        .padding(.horizontal, 16)
                    }

                    // ── Background ──
                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel("Background")
                        VStack(spacing: 0) {
                            ForEach(Array(presets.enumerated()), id: \.element.id) { index, preset in
                                BgPresetRow(preset: preset, isSelected: theme.bgPresetId == preset.id) {
                                    theme.setBgPreset(preset.id)
                                }
                                if index < presets.count - 1 {
                                    SLine().padding(.leading, 70)
                                }
                            }
                        }
                        .frostedCard(radius: T.cornerMd)
                        .padding(.horizontal, 16)
                    }

                    // ── Save ──
                    // Accent / background picks are a LIVE preview only
                    // (setAccent / setBgPreset mutate the in-memory theme
                    // without persisting). Save persists them and bumps
                    // `version`, which re-renders the whole app via the
                    // root's `.id(version)`. Backing out without Save reverts
                    // (see onDisappear).
                    GradientCTA {
                        didSave = true
                        theme.commitChanges()
                        dismiss()
                    } label: {
                        Text("Save")
                            .font(TTypo.smBold(15))
                    }
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
            theme.beginPreview()
        }
        .onDisappear {
            // Dismissed without tapping Save → discard the live preview.
            if !didSave { theme.cancelPreview() }
        }
    }

}

// MARK: - Subviews

// Uppercase, letter-spaced section label — matches the wireframe's
// "PREFERENCES" / "ACCOUNT" group headers.
private struct SectionLabel: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View {
        Text(title.uppercased())
            .font(TTypo.xsBold(11))
            .foregroundStyle(Color(hex: T.muted))
            .tLabel(tracking: 1.4)
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
                        .stroke(isSelected ? Color.white.opacity(0.6) : Color(hex: T.hair), lineWidth: isSelected ? 2 : 1)
                )
                .shadow(color: isSelected ? Color(hex: hex).opacity(T.skyShadowOpacity) : .clear,
                        radius: isSelected ? T.skyShadowRadius : 0, x: 0, y: isSelected ? T.skyShadowY : 0)
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
                            .frame(width: 8, height: 30)
                    }
                }
                .padding(5)
                .background(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous).fill(Color(hex: T.bg)))
                .overlay(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))

                VStack(alignment: .leading, spacing: 2) {
                    Text(preset.name)
                        .font(TTypo.smBold(15))
                        .foregroundColor(Color(hex: T.ink))
                    Text(preset.isLight ? "Light" : "Dark")
                        .font(TTypo.xs(12))
                        .foregroundColor(Color(hex: T.muted))
                }

                Spacer()

                if isSelected {
                    TIconView(icon: .check, size: 13, color: .white)
                        .padding(5)
                        .background(Circle().fill(T.brandGradient(start: .topLeading, end: .bottomTrailing)))
                        .shadow(color: Color(hex: T.ctaGlowColor).opacity(0.35), radius: 6, x: 0, y: 2)
                } else {
                    Circle()
                        .stroke(Color(hex: T.hair), lineWidth: 1.5)
                        .frame(width: 24, height: 24)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
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
