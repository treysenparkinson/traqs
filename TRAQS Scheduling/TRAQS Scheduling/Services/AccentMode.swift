import Foundation

/// How the live accent is decided.
///
/// `.solid` is the app's original behaviour: one hex, chosen in Customize,
/// everywhere. `.logoStagger` derives it from the selected tab instead, so the
/// icon's four colours are distributed across the app one per tab.
///
/// Only ONE accent is live at any instant either way — which is why every
/// `T.accent*` read site works unchanged under both modes. The value moves
/// under them; the contract does not change.
enum AccentMode: String, CaseIterable {
    case solid
    case logoStagger
}

// MARK: - The resolution rules
//
// Pure statics with every dependency passed in, per the Services convention.
// ThemeSettings owns the state and the UserDefaults access; this decides what
// that state MEANS, and that decision is the part worth a test.

enum AccentResolver {

    /// Which mode a launch starts in.
    ///
    /// `fallback` is passed in rather than hardcoded, and that is the point: the
    /// shipped default lives in exactly one place (`ThemeSettings
    /// .defaultAccentMode`). An earlier version named `.logoStagger` here
    /// directly, so moving the default would have changed the SETTING without
    /// changing what a fresh install actually launched as — the two could
    /// disagree silently.
    ///
    /// This used to take a `hasSavedAccent` flag too, to keep an existing user
    /// off the staggered palette while stagger was the default. With `.solid`
    /// the default again, both arms of that rule returned `.solid` and the flag
    /// stopped deciding anything, so it is gone: a user with no stored mode gets
    /// the default, and their saved `accent` is untouched either way.
    ///
    /// An unrecognised raw value falls through to `fallback` rather than
    /// trapping — a downgrade or a corrupted default should degrade, not crash.
    static func mode(storedMode: String?, fallback: AccentMode) -> AccentMode {
        if let storedMode, let known = AccentMode(rawValue: storedMode) { return known }
        return fallback
    }

    /// The hex that feeds `applyAccentToT()`.
    ///
    /// `solidAccent` is the user's SAVED choice and is passed through untouched
    /// in `.solid`; stagger ignores it rather than overwriting it, which is what
    /// lets a user flip to stagger and back and land on the colour they had.
    static func activeAccent(mode: AccentMode, solidAccent: String, tab: TTab) -> String {
        switch mode {
        case .solid:       return solidAccent
        case .logoStagger: return LogoPalette.accent(for: tab)
        }
    }
}
