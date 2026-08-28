import SwiftUI

// MARK: - The theme, by environment
//
// Screens read `@Environment(\.tqTheme)` rather than taking a `theme:` parameter.
// Threading it by hand works for one view and becomes a chore the moment a screen
// has depth — the Jobs page is a queue, a list, a detail panel and the cards
// inside each, and not one of them should need a colour handed to it.
//
// Written as an explicit EnvironmentKey rather than with the `@Entry` macro: this
// target is on Swift 5 language mode to match the iOS target (the shared files
// were written under it), and an EnvironmentKey works everywhere regardless.

private struct TQThemeKey: EnvironmentKey {
    /// Matches `ThemeSettings.defaultBgPresetId`, which is the light preset.
    static let defaultValue: TTheme = .frost
}

extension EnvironmentValues {
    var tqTheme: TTheme {
        get { self[TQThemeKey.self] }
        set { self[TQThemeKey.self] = newValue }
    }
}

// MARK: - Which theme
//
// TODO: follow the web app's own theme list. `THEMES` in TRAQS.jsx (:2399-2401)
// carries Dark, Obsidian and White, and the web has a picker for them. Deriving
// the theme from the iOS app's two presets maps onto two of the three, so
// OBSIDIAN IS CURRENTLY UNREACHABLE. Whether the Mac gets its own picker or
// follows a shared setting is a decision for when a ported screen makes the
// answer obvious; it is written down here rather than left implied.
enum MacTheme {
    static func current(isLight: Bool) -> TTheme { isLight ? .frost : .midnight }
}
