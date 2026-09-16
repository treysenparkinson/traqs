import Testing
@testable import TRAQS_Scheduling

/// The avatar fallback mark: the first two LETTERS of a name, uppercased.
///
/// Covers the change from first-and-last initials (which gave a single letter
/// for the single-word names most of the org is stored under) to a consistent
/// two-letter mark.
struct InitialsTests {

    @Test func singleWordNameGivesTwoLetters() {
        #expect(Initials.from("Caleb") == "CA")
        #expect(Initials.from("Quincy") == "QU")
        #expect(Initials.from("Max") == "MA")
    }

    /// The deliberate departure from first-and-last initials.
    @Test func twoWordNameTakesTheFirstTwoLettersNotTheInitials() {
        #expect(Initials.from("Caleb Smith") == "CA")
        #expect(Initials.from("Quincy Adams") == "QU")
    }

    @Test func emptyNameFallsBackToAQuestionMark() {
        #expect(Initials.from("") == "?")
        #expect(Initials.from("   ") == "?")
    }

    @Test func oneLetterNameGivesThatLetter() {
        #expect(Initials.from("A") == "A")
    }

    /// Thread titles and system rosters carry separators; the mark should be
    /// letters, never punctuation.
    @Test func punctuationAndLeadingSpaceAreSkipped() {
        #expect(Initials.from("  Trey") == "TR")
        #expect(Initials.from("· Trey") == "TR")
        #expect(Initials.from("(Max)") == "MA")
    }

    @Test func diacriticsSurvive() {
        #expect(Initials.from("Ángel") == "ÁN")
    }

    @Test func personConvenienceMatchesTheNameForm() {
        let p = Person(id: "u1", name: "Heston", role: "", email: "", cap: 8,
                       color: "#7C3AED", userRole: "user")
        #expect(Initials.from(p) == Initials.from("Heston"))
        #expect(Initials.from(p) == "HE")
    }
}
