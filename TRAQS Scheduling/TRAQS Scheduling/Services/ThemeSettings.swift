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

    // Accent presets
    static let accentPresets: [String] = [
        "#3d7fff", // Blue (default)
        "#7c3aed", // Purple
        "#10b981", // Green
        "#f59e0b", // Amber
        "#f43f5e", // Red
        "#ec4899", // Pink
        "#06b6d4", // Cyan
        "#8b5cf6", // Violet
    ]

    // Background presets — full palette stack per preset
    static let bgPresets: [BgPreset] = [
        // ── Dark ──
        BgPreset(id: 0, name: "Midnight", bg: "#080d18", surface: "#0d1424", card: "#111c30", border: "#1a2a45", text: "#e6ecf8", muted: "#64748b", isLight: false),
        BgPreset(id: 1, name: "Navy",     bg: "#060c1c", surface: "#0b1228", card: "#0f1934", border: "#182748", text: "#e6ecf8", muted: "#64748b", isLight: false),
        BgPreset(id: 2, name: "Charcoal", bg: "#0a0a0a", surface: "#141414", card: "#1c1c1c", border: "#2a2a2a", text: "#e8e8e8", muted: "#6b7280", isLight: false),
        BgPreset(id: 3, name: "Slate",    bg: "#0d1117", surface: "#161b22", card: "#1c2128", border: "#30363d", text: "#e6edf3", muted: "#8b949e", isLight: false),
        BgPreset(id: 4, name: "Forest",   bg: "#070f09", surface: "#0c1a0e", card: "#111f14", border: "#1a2e1c", text: "#e6f0e8", muted: "#6b8f72", isLight: false),
        // ── Light ──
        BgPreset(id: 5, name: "Frost",    bg: "#ffffff", surface: "#f8fafc", card: "#f1f5f9", border: "#e2e8f0", text: "#0f172a", muted: "#64748b", isLight: true),
        BgPreset(id: 6, name: "Pearl",    bg: "#fafaf9", surface: "#f5f5f4", card: "#e7e5e4", border: "#d6d3d1", text: "#1c1917", muted: "#78716c", isLight: true),
        BgPreset(id: 7, name: "Silver",   bg: "#f8f9fa", surface: "#f1f3f5", card: "#e9ecef", border: "#dee2e6", text: "#212529", muted: "#6c757d", isLight: true),
        BgPreset(id: 8, name: "Linen",    bg: "#faf7f2", surface: "#f5f0e8", card: "#ede8df", border: "#d9d0c5", text: "#1a1510", muted: "#7a6e62", isLight: true),
    ]

    var accent: String = "#3d7fff"
    var bgPresetId: Int = 0
    var version: Int = 0

    var currentBgPreset: BgPreset {
        ThemeSettings.bgPresets.first(where: { $0.id == bgPresetId }) ?? ThemeSettings.bgPresets[0]
    }

    var isLightTheme: Bool { currentBgPreset.isLight }

    init() {
        accent = UserDefaults.standard.string(forKey: "themeAccent") ?? "#3d7fff"
        bgPresetId = UserDefaults.standard.integer(forKey: "themeBgPreset")
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
        setAccent("#3d7fff")
        setBgPreset(0)
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
