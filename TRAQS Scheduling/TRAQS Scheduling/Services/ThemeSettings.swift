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

    // Background presets — TRAQS Light is the canonical theme; the rest are kept for power-users.
    static let bgPresets: [BgPreset] = [
        // ── Canonical TRAQS Light ──
        BgPreset(id: 100, name: "TRAQS Light",
                 bg: "#F4F6FA", surface: "#FFFFFF", card: "#FFFFFF", border: "#E6E8EE",
                 text: "#0B0B0C", muted: "#6E6E73", isLight: true),
        // ── Dark legacy ──
        BgPreset(id: 0, name: "Midnight", bg: "#080d18", surface: "#0d1424", card: "#111c30", border: "#1a2a45", text: "#e6ecf8", muted: "#64748b", isLight: false),
        BgPreset(id: 1, name: "Navy",     bg: "#060c1c", surface: "#0b1228", card: "#0f1934", border: "#182748", text: "#e6ecf8", muted: "#64748b", isLight: false),
        BgPreset(id: 2, name: "Charcoal", bg: "#0a0a0a", surface: "#141414", card: "#1c1c1c", border: "#2a2a2a", text: "#e8e8e8", muted: "#6b7280", isLight: false),
        BgPreset(id: 3, name: "Slate",    bg: "#0d1117", surface: "#161b22", card: "#1c2128", border: "#30363d", text: "#e6edf3", muted: "#8b949e", isLight: false),
        BgPreset(id: 4, name: "Forest",   bg: "#070f09", surface: "#0c1a0e", card: "#111f14", border: "#1a2e1c", text: "#e6f0e8", muted: "#6b8f72", isLight: false),
        // ── Other light presets ──
        BgPreset(id: 5, name: "Frost",    bg: "#ffffff", surface: "#f8fafc", card: "#f1f5f9", border: "#e2e8f0", text: "#0f172a", muted: "#64748b", isLight: true),
        BgPreset(id: 6, name: "Pearl",    bg: "#fafaf9", surface: "#f5f5f4", card: "#e7e5e4", border: "#d6d3d1", text: "#1c1917", muted: "#78716c", isLight: true),
        BgPreset(id: 7, name: "Silver",   bg: "#f8f9fa", surface: "#f1f3f5", card: "#e9ecef", border: "#dee2e6", text: "#212529", muted: "#6c757d", isLight: true),
        BgPreset(id: 8, name: "Linen",    bg: "#faf7f2", surface: "#f5f0e8", card: "#ede8df", border: "#d9d0c5", text: "#1a1510", muted: "#7a6e62", isLight: true),
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
        if let savedId = UserDefaults.standard.object(forKey: "themeBgPreset") as? Int,
           ThemeSettings.bgPresets.contains(where: { $0.id == savedId }) {
            // One-time migration: existing users on legacy dark presets (0–4) get
            // upgraded to the new TRAQS Light. Anything else (existing light pick or
            // explicit TRAQS Light) is honored.
            bgPresetId = (0...4).contains(savedId) ? ThemeSettings.defaultBgPresetId : savedId
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
