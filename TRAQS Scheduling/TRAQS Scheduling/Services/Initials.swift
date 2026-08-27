import Foundation

// MARK: - Avatar initials
//
// The mark an Avatar falls back to when there is no photo. ONE rule, in one
// place, because there were thirteen copies of it: `TeamView` had two, the
// messages inbox had six, and Settings, Admin, Availability and Clients each
// had their own. They had already drifted — some padded an empty name to "?",
// some rendered a blank circle; some took one letter, some took two.
//
// The rule: the FIRST TWO LETTERS of the name, uppercased. Not first-and-last
// initials — "Caleb Smith" reads CA, not CS. Most people in the org are stored
// under a single name, and one-letter marks looked unfinished next to the
// photos they sit beside.
enum Initials {

    /// Two letters for `name`, or "?" when there is nothing to take them from.
    ///
    /// Reads across the whole string, spaces and all — so a one-word name yields
    /// two letters rather than one, which is the entire point of the rule. A
    /// name with a single character yields that character.
    ///
    /// Non-letters are skipped rather than shown: a name arriving as "· Trey" or
    /// "(Max)" should mark as TR and MA, not as punctuation. Diacritics survive,
    /// so "Ángel" is ÁN.
    static func from(_ name: String) -> String {
        let letters = name.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        guard !letters.isEmpty else { return "?" }
        return String(String.UnicodeScalarView(letters.prefix(2))).uppercased()
    }

    /// Convenience for the common case.
    static func from(_ person: Person) -> String { from(person.name) }
}
