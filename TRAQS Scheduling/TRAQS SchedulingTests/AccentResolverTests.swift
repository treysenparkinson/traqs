import Testing
@testable import TRAQS_Scheduling

/// Which accent is live, and which mode a launch starts in.
///
/// The launch rule is the one that matters: it decides whether an existing
/// user's chosen accent survives the update. Getting it wrong repaints the app
/// for people who already told us what they wanted, and there is no error to
/// notice — they just open TRAQS one morning and it is a different colour.
struct AccentResolverTests {

    // MARK: Launch mode

    @Test func freshInstallGetsTheStaggeredPalette() {
        #expect(AccentResolver.mode(storedMode: nil, hasSavedAccent: false) == .logoStagger)
    }

    /// The load-bearing case. `themeAccent` is written by `commitChanges()` and
    /// nowhere else, so its presence means this user has saved a theme at least
    /// once — they chose an accent, and it must survive.
    @Test func existingUserWithASavedAccentStaysSolid() {
        #expect(AccentResolver.mode(storedMode: nil, hasSavedAccent: true) == .solid)
    }

    @Test func anExplicitStoredModeWinsOverBothDefaults() {
        #expect(AccentResolver.mode(storedMode: "solid", hasSavedAccent: false) == .solid)
        #expect(AccentResolver.mode(storedMode: "logoStagger", hasSavedAccent: true) == .logoStagger)
    }

    /// A raw value we do not recognise — a downgrade, or a corrupted default —
    /// must fall through to the same rule as a missing key, not trap.
    @Test func anUnknownStoredModeFallsBackToTheKeyRule() {
        #expect(AccentResolver.mode(storedMode: "rainbow", hasSavedAccent: true) == .solid)
        #expect(AccentResolver.mode(storedMode: "", hasSavedAccent: false) == .logoStagger)
    }

    // MARK: Active accent

    @Test func solidModeIgnoresTheTabEntirely() {
        for tab in TTab.allCases {
            #expect(AccentResolver.activeAccent(mode: .solid,
                                                solidAccent: "#3B82F6",
                                                tab: tab) == "#3B82F6")
        }
    }

    @Test func staggerModeIgnoresTheSavedAccentEntirely() {
        #expect(AccentResolver.activeAccent(mode: .logoStagger,
                                            solidAccent: "#3B82F6",
                                            tab: .home) == LogoPalette.sky)
        #expect(AccentResolver.activeAccent(mode: .logoStagger,
                                            solidAccent: "#FF1FB4",
                                            tab: .hours) == LogoPalette.amber)
    }

    @Test func everyModeHasARawValueThatRoundTrips() {
        for mode in AccentMode.allCases {
            #expect(AccentMode(rawValue: mode.rawValue) == mode)
        }
    }
}
