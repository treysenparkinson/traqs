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
}
