import Foundation
import Testing
@testable import TRAQS_Scheduling

/// The 10 second hold on the Delete Account confirmation: the destructive
/// button stays disabled and counts down so nobody removes themselves from the
/// org on a mis-tap.
struct DeleteAccountCountdownTests {

    private let start = Date(timeIntervalSince1970: 1_000_000)

    @Test func startsAtTenSeconds() {
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start) == 10)
    }

    @Test func countsDownOneSecondAtATime() {
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(1)) == 9)
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(4)) == 6)
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(9)) == 1)
    }

    /// A partial second still owes the user the rest of that second, so the
    /// count only drops once the whole second has elapsed.
    @Test func partialSecondDoesNotAdvanceTheCount() {
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(0.9)) == 10)
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(1.5)) == 9)
    }

    @Test func reachesZeroAndStaysThere() {
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(10)) == 0)
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(600)) == 0)
    }

    /// A clock that jumps backwards (NTP correction, timezone churn) must never
    /// hand out more than the full hold.
    @Test func clockGoingBackwardsIsClampedToTheFullHold() {
        #expect(DeleteAccountCountdown.remaining(startedAt: start, now: start.addingTimeInterval(-30)) == 10)
    }

    @Test func buttonIsArmedOnlyOnceTheCountHitsZero() {
        #expect(DeleteAccountCountdown.isArmed(startedAt: start, now: start) == false)
        #expect(DeleteAccountCountdown.isArmed(startedAt: start, now: start.addingTimeInterval(9.5)) == false)
        #expect(DeleteAccountCountdown.isArmed(startedAt: start, now: start.addingTimeInterval(10)) == true)
    }

    @Test func labelShowsTheCountWhileWaitingAndDropsItWhenArmed() {
        #expect(DeleteAccountCountdown.label(remaining: 10) == "Delete Account (10)")
        #expect(DeleteAccountCountdown.label(remaining: 1) == "Delete Account (1)")
        #expect(DeleteAccountCountdown.label(remaining: 0) == "Delete Account")
    }
}
