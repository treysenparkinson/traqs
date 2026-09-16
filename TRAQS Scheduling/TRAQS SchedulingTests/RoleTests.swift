import Testing
@testable import TRAQS_Scheduling

/// What each UI role is coloured, and that the four stay distinguishable.
///
/// Under test because the whole point of the table is that a reader can tell
/// which kind of thing they are looking at from its colour alone. Two roles
/// resolving to the same hex would not crash, would not warn, and would quietly
/// undo the feature — a job control and a calendar control would simply look
/// alike.
struct RoleTests {

    @Test func everyRoleDrawsFromTheAppIcon() {
        for hex in [Role.nav, Role.job, Role.calendar, Role.status] {
            #expect(LogoPalette.ordered.contains(hex))
        }
    }

    @Test func theFourRolesAreDistinct() {
        #expect(Set([Role.nav, Role.job, Role.calendar, Role.status]).count == 4)
    }

    @Test func rolesMapToTheIntendedBars() {
        #expect(Role.nav      == LogoPalette.sky)
        #expect(Role.job      == LogoPalette.amber)
        #expect(Role.calendar == LogoPalette.coral)
        #expect(Role.status   == LogoPalette.green)
    }

    /// `nav` is not an override — it IS the accent, named. If the shipped
    /// default ever moves off the icon's sky this assertion is the thing that
    /// says so, rather than the nav bar silently drifting away from the chrome
    /// colour the rest of the app assumes.
    @Test func navMatchesTheShippedDefaultAccent() {
        #expect(Role.nav == ThemeSettings.defaultAccent)
    }
}
