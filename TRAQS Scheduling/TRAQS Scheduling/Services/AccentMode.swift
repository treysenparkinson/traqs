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
    /// The middle case is the whole point. `themeAccent` is written by
    /// `commitChanges()` and nowhere else, so its presence means this user has
    /// saved a theme at least once and therefore chose an accent; handing them
    /// the staggered palette would overwrite a real preference. A user with
    /// neither key has never expressed one, so they get the new default.
    ///
    /// An unrecognised raw value falls through to the same rule as a missing
    /// key rather than trapping — a downgrade or a corrupted default should
    /// degrade, not crash.
    static func mode(storedMode: String?, hasSavedAccent: Bool) -> AccentMode {
        if let storedMode, let known = AccentMode(rawValue: storedMode) { return known }
        return hasSavedAccent ? .solid : .logoStagger
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
