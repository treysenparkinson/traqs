import Testing
@testable import TRAQS_Scheduling

/// The app icon's four colours, and which tab owns which.
///
/// Under test because both halves fail silently. A wrong hex just looks
/// slightly off-brand next to the springboard icon; a wrong `ordered` puts the
/// bars mark in the wrong sequence, which reads as a different logo. Neither
/// throws, neither logs.
struct LogoPaletteTests {

    @Test func hexesMatchTheShippedIconAsset() {
        #expect(LogoPalette.coral == "#FF826A")
        #expect(LogoPalette.amber == "#F4B61E")
        #expect(LogoPalette.sky   == "#41C9FA")
        #expect(LogoPalette.green == "#1E8D6F")
    }

    /// `TRAQSBarsMark` indexes `ordered` positionally, so this order IS the
    /// logo's geometry — top bar first, full-width sky bar third.
    @Test func orderedRunsTopToBottomAsTheIconDrawsThem() {
        #expect(LogoPalette.ordered == ["#FF826A", "#F4B61E", "#41C9FA", "#1E8D6F"])
        #expect(LogoPalette.ordered.count == 4)
        #expect(LogoPalette.ordered[2] == LogoPalette.sky)
    }

    // MARK: - bars(for:)

    @Test func theShippedAccentDrawsTheIconItself() {
        #expect(LogoPalette.bars(for: LogoPalette.sky) == LogoPalette.ordered)
    }

    /// The hex arrives from our literals, from `Color.hexString` (lowercase),
    /// and from whatever a user's saved `themeAccent` was written as. A raw
    /// string compare would miss the lowercase form and silently draw shades of
    /// sky instead of the icon.
    @Test func theDefaultIsRecognisedWhateverItsCasing() {
        #expect(LogoPalette.bars(for: "#41c9fa") == LogoPalette.ordered)
        #expect(LogoPalette.bars(for: "41C9FA")  == LogoPalette.ordered)
        #expect(LogoPalette.isDefaultAccent(" #41c9fa "))
    }

    @Test func anyOtherAccentGivesFourDistinctShades() {
        for accent in ["#7c3aed", "#10b981", "#f43f5e", "#FF1FB4"] {
            let bars = LogoPalette.bars(for: accent)
            #expect(bars.count == 4)
            #expect(Set(bars).count == 4, "\(accent) produced a duplicate bar")
            #expect(bars != LogoPalette.ordered)
        }
    }

    /// The full-width third bar is the mark's hero, so the colour the user
    /// actually picked belongs there untouched.
    @Test func theHeroBarIsTheAccentItself() {
        #expect(LogoPalette.bars(for: "#7c3aed")[2] == "#7c3aed")
    }

    /// Clamping is the whole reason the offsets are not applied blind: amber is
    /// bright enough that its lighter bars would blow out to white, and a
    /// near-black accent would crush its darkest bar to nothing. Both ends have
    /// to stay visible against BOTH background presets.
    @Test func extremeAccentsStayInsideTheVisibleBand() {
        for accent in ["#FFFFFF", "#000000", "#F4B61E", "#0B0B0C"] {
            let bars = LogoPalette.bars(for: accent)
            #expect(bars.count == 4)
            #expect(!bars.contains(""), "\(accent) produced an empty hex")
        }
        // White cannot step lighter, so its non-hero bars must still differ
        // from each other by going DOWN rather than collapsing into one value.
        let white = LogoPalette.bars(for: "#FFFFFF")
        #expect(white[3] != white[2], "the darkest bar collapsed into the hero")
    }
}
