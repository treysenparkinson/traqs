import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

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
        applyAccentToT()
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
        applyAccentToT()
        applyBgToT(currentBgPreset)
    }

    /// Set `T.accent` AND the derived signature-gradient stops + glow tints so the
    /// whole gradient system stays coherent with whatever accent is chosen.
    /// Default accent → the wireframe indigo→magenta brand pair; any custom accent
    /// keeps its own start and derives an intentional end (hue +40°, +8% brightness).
    private func applyAccentToT() {
        T.accent = accent
        if accent.caseInsensitiveCompare(ThemeSettings.defaultAccent) == .orderedSame {
            T.accentGradientStart = T.brandGradStartDefault
            T.accentGradientEnd   = T.brandGradEndDefault
        } else {
            T.accentGradientStart = accent
            T.accentGradientEnd   = ThemeSettings.derivedEnd(from: accent)
        }
        T.glowBlob     = T.accentGradientEnd
        T.ctaGlowColor = T.accentGradientStart
    }

    private func applyBgToT(_ p: BgPreset) {
        T.bg = p.bg; T.surface = p.surface; T.card = p.card; T.border = p.border
        T.text = p.text; T.muted = p.muted
    }

    /// Derive a gradient end-stop from a custom accent: rotate hue +40° and lift
    /// brightness ~8% so a single-color accent still yields an intentional two-stop
    /// gradient. iOS-only (UIColor HSB); returns the input unchanged if conversion fails.
    static func derivedEnd(from hex: String) -> String {
        #if canImport(UIKit)
        let ui = UIColor(Color(hex: hex))
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard ui.getHue(&h, saturation: &s, brightness: &b, alpha: &a) else { return hex }
        h = (h + 40.0 / 360.0).truncatingRemainder(dividingBy: 1.0)
        b = min(1.0, b + 0.08)
        return Color(UIColor(hue: h, saturation: s, brightness: b, alpha: 1)).toHex() ?? hex
        #else
        return hex
        #endif
    }
}
