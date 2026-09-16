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

    /// The shipped default reaches a fresh install. `fallback` is passed in so
    /// this cannot drift from `ThemeSettings.defaultAccentMode` — an earlier
    /// version hardcoded `.logoStagger` in the resolver, which meant moving the
    /// default would have changed the setting without changing what actually
    /// launched.
    @Test func noStoredModeTakesTheFallback() {
        #expect(AccentResolver.mode(storedMode: nil, fallback: .solid) == .solid)
        #expect(AccentResolver.mode(storedMode: nil, fallback: .logoStagger) == .logoStagger)
    }

    @Test func anExplicitStoredModeWinsOverTheFallback() {
        #expect(AccentResolver.mode(storedMode: "solid", fallback: .logoStagger) == .solid)
        #expect(AccentResolver.mode(storedMode: "logoStagger", fallback: .solid) == .logoStagger)
    }

    /// A raw value we do not recognise — a downgrade, or a corrupted default —
    /// must fall through to the fallback, not trap.
    @Test func anUnknownStoredModeTakesTheFallback() {
        #expect(AccentResolver.mode(storedMode: "rainbow", fallback: .solid) == .solid)
        #expect(AccentResolver.mode(storedMode: "", fallback: .logoStagger) == .logoStagger)
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
