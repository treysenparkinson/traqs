import SwiftUI

// MARK: - Background Presets

struct BgPreset: Identifiable {
    let id: Int
    let name: String
    let bg: String
    let surface: String
    let card: String
    let border: String
    let text: String
    let muted: String
    let isLight: Bool
}

// MARK: - ThemeSettings

@Observable
final class ThemeSettings {

    // Accent presets (sky is the canonical TRAQS interactive color)
    static let accentPresets: [String] = [
        "#3B82F6", // Sky (default) — TRAQS Light
        "#7c3aed", // Purple
        "#10b981", // Green
        "#f59e0b", // Amber
        "#f43f5e", // Red
        "#FF1FB4", // Magenta
        "#06b6d4", // Cyan
        "#8b5cf6", // Violet
    ]

    // Background presets — neutrals only. Accent is what users customize
    // for color; the background stays out of the way as a neutral canvas.
    static let bgPresets: [BgPreset] = [
        BgPreset(id: 100, name: "White",
                 bg: "#F4F6FA", surface: "#FFFFFF", card: "#FFFFFF", border: "#E6E8EE",
                 text: "#0B0B0C", muted: "#6E6E73", isLight: true),
        BgPreset(id: 10,  name: "Grey",
                 bg: "#E5E7EB", surface: "#F3F4F6", card: "#FFFFFF", border: "#D1D5DB",
                 text: "#111827", muted: "#6B7280", isLight: true),
        BgPreset(id: 11,  name: "Charcoal",
                 bg: "#1F1F1F", surface: "#2A2A2A", card: "#333333", border: "#3F3F3F",
                 text: "#E8E8E8", muted: "#9CA3AF", isLight: false),
        BgPreset(id: 12,  name: "Black",
                 bg: "#000000", surface: "#0A0A0A", card: "#141414", border: "#1F1F1F",
                 text: "#F5F5F5", muted: "#6B7280", isLight: false),
    ]

    static let defaultBgPresetId: Int = 100
    static let defaultAccent: String = "#3B82F6"

    var accent: String = ThemeSettings.defaultAccent
    var bgPresetId: Int = ThemeSettings.defaultBgPresetId
    var version: Int = 0

    var currentBgPreset: BgPreset {
        ThemeSettings.bgPresets.first(where: { $0.id == bgPresetId }) ?? ThemeSettings.bgPresets[0]
    }

    var isLightTheme: Bool { currentBgPreset.isLight }

    init() {
        accent = UserDefaults.standard.string(forKey: "themeAccent") ?? ThemeSettings.defaultAccent
        // Any preset id that isn't one of the four current neutrals falls
        // back to White. Covers existing users who were on the older
        // tinted presets (Midnight, Navy, Slate, Forest, Frost, Pearl,
        // Silver, Linen) before we trimmed the list.
        if let savedId = UserDefaults.standard.object(forKey: "themeBgPreset") as? Int,
           ThemeSettings.bgPresets.contains(where: { $0.id == savedId }) {
            bgPresetId = savedId
        } else {
            bgPresetId = ThemeSettings.defaultBgPresetId
        }
        applyToT()
    }

    func setAccent(_ hex: String) {
        accent = hex
        UserDefaults.standard.set(hex, forKey: "themeAccent")
        T.accent = hex
    }

    func setBgPreset(_ id: Int) {
        bgPresetId = id
        UserDefaults.standard.set(id, forKey: "themeBgPreset")
        applyBgToT(currentBgPreset)
    }

    func reset() {
        setAccent(ThemeSettings.defaultAccent)
        setBgPreset(ThemeSettings.defaultBgPresetId)
    }

    /// Call when leaving CustomizeView to force the whole app to re-render with new T.* values.
    func commitChanges() {
        version += 1
    }

    private func applyToT() {
        T.accent = accent
        applyBgToT(currentBgPreset)
    }

    private func applyBgToT(_ p: BgPreset) {
        T.bg = p.bg; T.surface = p.surface; T.card = p.card; T.border = p.border
        T.text = p.text; T.muted = p.muted
    }
}
