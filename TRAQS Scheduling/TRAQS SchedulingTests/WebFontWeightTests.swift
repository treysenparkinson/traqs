import Testing
@testable import TRAQS_Scheduling

// The web app asks for DM Sans by NUMBER (`fontWeight: 700`); the apps ship it as
// five named files. This is the one place that translation happens, so both apps
// resolve a given web weight to the same face.
@Suite("Web font weight → DM Sans face")
struct WebFontWeightTests {

    @Test func theFourShippedMidWeightsEachGetTheirOwnFace() {
        #expect(TFontName.face(forWebWeight: 400) == .regular)
        #expect(TFontName.face(forWebWeight: 500) == .medium)
        #expect(TFontName.face(forWebWeight: 600) == .semibold)
        #expect(TFontName.face(forWebWeight: 700) == .bold)
        #expect(TFontName.face(forWebWeight: 800) == .extrabold)
    }

    // index.html:16 loads `DM+Sans:wght@300;400;500;600;700;800`. 900 is NOT among
    // them, so `pageTitleStyle`'s `fontWeight: 900` (TRAQS.jsx:12714) is already
    // clamped by the browser to the heaviest face it has — 800. Copying what the web
    // RENDERS means ExtraBold; `.black` would overshoot the thing being copied.
    @Test func nineHundredClampsToExtraBoldTheWayTheBrowserDoes() {
        #expect(TFontName.face(forWebWeight: 900) == .extrabold)
    }

    // 300 (Light) IS loaded by the web but is not one of the five shipped faces.
    // Recorded as a deliberate approximation rather than left to chance: the moment a
    // ported screen actually uses 300, DMSans-Light gets added and this expectation
    // changes with it.
    @Test func lightFallsBackToRegularUntilThatFaceShips() {
        #expect(TFontName.face(forWebWeight: 300) == .regular)
    }

    @Test func nonsenseWeightsClampRatherThanCrash() {
        #expect(TFontName.face(forWebWeight: 0) == .regular)
        #expect(TFontName.face(forWebWeight: 10_000) == .extrabold)
    }

    // The Mac app's launch assertion iterates all five to check they registered.
    @Test func everyFaceIsEnumerable() {
        #expect(TFontName.allCases.count == 5)
    }
}
