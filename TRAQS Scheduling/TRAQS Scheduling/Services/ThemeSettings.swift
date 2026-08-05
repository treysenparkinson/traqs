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
    /// Unfilled part of a progress ring or bar. Per-preset rather than one fixed
    /// grey: on glass, a mid-grey track reads as a dirty smudge on a light
    /// surface and disappears entirely on a dark one.
    ///
    /// Each preset pushes AWAY from mid-grey, toward its own extreme — near-white
    /// on White, near-black on Charcoal. On Charcoal that puts the track *below*
    /// the surface value, so it reads as a recessed groove rather than a raised
    /// grey band.
    let track: String
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
                 text: "#0B0B0C", muted: "#6E6E73", track: "#F7F9FD", isLight: true),
        BgPreset(id: 11,  name: "Charcoal",
                 bg: "#1F1F1F", surface: "#2A2A2A", card: "#333333", border: "#3F3F3F",
                 text: "#E8E8E8", muted: "#9CA3AF", track: "#202023", isLight: false),
    ]

    static let defaultBgPresetId: Int = 100
    static let defaultAccent: String = "#3B82F6"
    /// On by default — the liquid wash IS the intended look of the app; the
    /// static canvas is the opt-out.
    static let defaultLiquidBackground: Bool = true

    var accent: String = ThemeSettings.defaultAccent
    var bgPresetId: Int = ThemeSettings.defaultBgPresetId
    /// Whether pages render the drifting liquid wash (`PageBackground`) instead
    /// of the static ambient canvas. Unlike accent/preset this feeds no T.*
    /// token — views read it directly — so it has no `applyToT` counterpart.
    var liquidBackground: Bool = ThemeSettings.defaultLiquidBackground
    var version: Int = 0

    // Last *saved* theme, captured when the customizer opens (`beginPreview`).
    // Live edits change `accent`/`bgPresetId`/`liquidBackground` for an immediate
    // preview without persisting; Save commits them, backing out reverts to
    // these snapshots.
    private var savedAccent: String = ThemeSettings.defaultAccent
    private var savedBgPresetId: Int = ThemeSettings.defaultBgPresetId
    private var savedLiquidBackground: Bool = ThemeSettings.defaultLiquidBackground

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
        // `object(forKey:) as? Bool`, NOT `bool(forKey:)` — the latter returns
        // false for a key that was never written, which would silently ship the
        // liquid wash OFF for every existing user.
        liquidBackground = (UserDefaults.standard.object(forKey: "themeLiquidBackground") as? Bool)
            ?? ThemeSettings.defaultLiquidBackground
        savedAccent = accent
        savedBgPresetId = bgPresetId
        savedLiquidBackground = liquidBackground
        applyToT()
    }

    /// Live preview only: update the in-memory accent + T tokens so the
    /// customizer reflects the change immediately. Does NOT persist — call
    /// `commitChanges()` (Save) to keep it, or `cancelPreview()` to revert.
    func setAccent(_ hex: String) {
        accent = hex
        applyAccentToT()
    }

    /// Live preview only (see `setAccent`). Persists on `commitChanges()`.
    func setBgPreset(_ id: Int) {
        bgPresetId = id
        applyBgToT(currentBgPreset)
    }

    /// Live preview only (see `setAccent`). Persists on `commitChanges()`. No
    /// `applyToT` call — this flag isn't part of the token table.
    func setLiquidBackground(_ on: Bool) {
        liquidBackground = on
    }

    func reset() {
        setAccent(ThemeSettings.defaultAccent)
        setBgPreset(ThemeSettings.defaultBgPresetId)
        setLiquidBackground(ThemeSettings.defaultLiquidBackground)
        commitChanges()
    }

    /// Snapshot the saved theme before a live-preview session so an
    /// un-saved exit can be reverted.
    func beginPreview() {
        savedAccent = accent
        savedBgPresetId = bgPresetId
        savedLiquidBackground = liquidBackground
    }

    /// Revert a live preview back to the last saved theme (customizer closed
    /// without Save).
    func cancelPreview() {
        accent = savedAccent
        bgPresetId = savedBgPresetId
        liquidBackground = savedLiquidBackground
        applyToT()
    }

    /// Save: persist the previewed accent + background, then bump `version`
    /// so the whole app re-renders with the new T.* values.
    func commitChanges() {
        UserDefaults.standard.set(accent, forKey: "themeAccent")
        UserDefaults.standard.set(bgPresetId, forKey: "themeBgPreset")
        UserDefaults.standard.set(liquidBackground, forKey: "themeLiquidBackground")
        savedAccent = accent
        savedBgPresetId = bgPresetId
        savedLiquidBackground = liquidBackground
        version += 1
    }

    private func applyToT() {
        applyAccentToT()
        applyBgToT(currentBgPreset)
    }

    /// Set `T.accent` AND the derived signature-gradient stops + glow tints so the
    /// whole gradient system stays coherent with whatever accent is chosen.
    /// EVERY accent — including the default — yields a SAME-HUE two-stop gradient
    /// (the chosen color → a deeper shade of it), so buttons/CTAs are always a
    /// gradient of the exact color chosen, never an off-hue end that reads as a
    /// completely different color.
    private func applyAccentToT() {
        T.accent = accent
        T.accentGradientStart = accent
        T.accentGradientEnd   = ThemeSettings.derivedEnd(from: accent)
        T.glowBlob     = T.accentGradientEnd
        T.ctaGlowColor = T.accentGradientStart
    }

    private func applyBgToT(_ p: BgPreset) {
        T.bg = p.bg; T.surface = p.surface; T.card = p.card; T.border = p.border
        T.text = p.text; T.muted = p.muted
        T.progressTrack = p.track
    }

    /// Derive a gradient end-stop from the chosen accent: KEEP the hue (no
    /// rotation — that produced an off-hue end that read as a different color),
    /// deepen it into a richer shade (a little more saturation, ~22% less
    /// brightness) so a single color still yields a coherent same-hue two-stop
    /// gradient. iOS-only (UIColor HSB); returns the input unchanged on failure.
    static func derivedEnd(from hex: String) -> String {
        #if canImport(UIKit)
        let ui = UIColor(Color(hex: hex))
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard ui.getHue(&h, saturation: &s, brightness: &b, alpha: &a) else { return hex }
        s = min(1.0, s + 0.10)
        b = max(0.0, b - 0.22)
        return Color(UIColor(hue: h, saturation: s, brightness: b, alpha: 1)).toHex() ?? hex
        #else
        return hex
        #endif
    }
}
