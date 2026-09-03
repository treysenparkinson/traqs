import SwiftUI

struct CustomizeView: View {
    @Environment(ThemeSettings.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var customAccentColor: Color = Color(hex: "#3d7fff")
    @State private var didSave = false

    private var presets: [BgPreset] { ThemeSettings.bgPresets }

    var body: some View {
        ZStack {
            PageBackground()

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

                            // The wash layers OVER whichever preset is picked
                            // rather than replacing it, so it belongs in this
                            // card rather than as a third preset row.
                            SLine().padding(.leading, 70)
                            ToggleRow(title: "Liquid Motion",
                                      isOn: theme.liquidBackground) { on in
                                theme.setLiquidBackground(on)
                            }

                            SLine().padding(.leading, 70)
                            ToggleRow(title: "Frosted Glass",
                                      subtitle: "*Off flattens cards, panels and prompts; buttons and the nav bar stay glass",
                                      isOn: theme.frostedGlass) { on in
                                theme.setFrostedGlass(on)
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
                    GradientCTA(glass: true) {
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
                            .foregroundColor(Color(hex: hex).readableText)
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

// A look toggle. Same padding as BgPresetRow so it reads as another row of the
// same card. Previews live and is committed or reverted by the card's Save /
// back-out paths, exactly like the presets.
private struct ToggleRow: View {
    let title: String
    /// Optional — most rows are self-explanatory from the title alone.
    var subtitle: String? = nil
    let isOn: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TTypo.smBold(15))
                    .foregroundColor(Color(hex: T.ink))
                if let subtitle {
                    Text(subtitle)
                        .font(TTypo.xs(12))
                        .foregroundColor(Color(hex: T.muted))
                }
            }

            Spacer()

            Toggle("", isOn: Binding(get: { isOn }, set: { onChange($0) }))
                .labelsHidden()
                .tint(Color(hex: T.accent))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
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
                    TIconView(icon: .check, size: 13, color: T.onGradient)
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
        // Clamp to 0…1 before scaling: a wide-gamut (P3) color from the picker can
        // return components outside 0…1, which made Int(r*255) exceed 255 (or go
        // negative) and produced a malformed hex like "#115…".
        let clamp = { (v: CGFloat) in Int((max(0, min(1, v)) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", clamp(r), clamp(g), clamp(b))
    }
}
