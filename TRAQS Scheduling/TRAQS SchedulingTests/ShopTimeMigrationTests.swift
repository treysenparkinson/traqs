import Testing
import Foundation
@testable import TRAQS_Scheduling

// #304: schedule questions in the SHOP's time, not the device's. Written red-first against a
// New York device looking at a Denver shop:
//
//   xcodebuild test … TEST_RUNNER_TZ=America/New_York
//
// TEST_RUNNER_TZ sets the test host's zone, so `Calendar.current` is New York's — the device
// the bug lives on. The shop is pinned per test through `ShopTime.$override`, never through the
// app's stored shop, so no other suite sees it. On a Denver machine without the variable these
// still pass, but cannot fail: the device and the shop agree.
//
// The instant most of these turn on, 2026-10-05T05:00Z, is 01:00 on Monday Oct 5 in New York
// and 23:00 on Sunday Oct 4 in Denver: same moment, different day.
@Suite("Shop time, not the device's (#304)") @MainActor
struct ShopTimeMigrationTests {

    static let denver = ShopTime(zone: TimeZone(identifier: "America/Denver")!)
    private func inDenver<T>(_ body: () throws -> T) rethrows -> T {
        try ShopTime.$override.withValue(Self.denver) { try body() }
    }
    private func at(_ iso: String) -> Date { Date.fromFlexibleISO8601(iso)! }
    private var lateSunday: Date { at("2026-10-05T05:00:00Z") }

    // MARK: The helpers

    @Test func theOverrideIsTheShop() {
        inDenver {
            #expect(ShopTime.current.zone.identifier == "America/Denver")
            #expect(ShopTime.current.startOfToday(lateSunday) == at("2026-10-04T06:00:00Z"))
            #expect(ShopTime.current.formatter("EEE MMM d").string(from: lateSunday) == "Sun Oct 4")
            #expect(ShopTime.current.date(ofDay: "2026-10-05") == at("2026-10-05T06:00:00Z"))
            #expect(ShopTime.current.date(ofDay: "2026-03-08") == at("2026-03-08T07:00:00Z"))   // MST
            #expect(ShopTime.current.date(ofDay: "nope") == nil)
            #expect(ShopTime.current.ymd(at("2026-10-05T06:00:00Z")) == "2026-10-05")
        }
    }

    // MARK: Schedule days

    /// Every schedule view compares parsed days with the shop's calendar, so a stored day is
    /// the shop's midnight. Parsed at the device's, a NY viewer's days began two hours early.
    @Test func aScheduleDayIsTheShopsMidnight() {
        inDenver {
            #expect("2026-10-05".asDate == at("2026-10-05T06:00:00Z"))
            #expect("2026-12-01".asDate == at("2026-12-01T07:00:00Z"))
            #expect(ShopTime.current.calendar.isDate("2026-10-04".asDate!, inSameDayAs: lateSunday))
        }
    }

    // MARK: Pay periods and hours (rulings 3 and 4)

    /// Late Sunday in Denver is still the period that ends Oct 4 — on a NY device it had
    /// already rolled into Oct 5–19.
    @Test func thePayPeriodIsTheShops() {
        inDenver {
            let w = PayPeriod.window(org: .default, now: lateSunday)
            #expect(w.start == at("2026-09-20T06:00:00Z"))
            #expect(w.end == at("2026-10-04T06:00:00Z"))
        }
    }

    /// `personId` is whoever the test host is signed in as — writing `currentPersonId` would
    /// persist into the simulator app's defaults.
    private func entry(_ clockIn: String, hours: Double, person: String) -> TimeclockEntry {
        let json = #"{"id":"\#(clockIn)","personId":"\#(person)","clockIn":"\#(clockIn)","clockOut":"\#(clockIn)","hours":\#(hours)}"#
        return try! JSONDecoder().decode(TimeclockEntry.self, from: json.data(using: .utf8)!)
    }

    /// Hours today bucket by the shop's day, as the server's rows do: a shift at 22:30 on
    /// Sunday in Denver is Sunday's, though it is 00:30 Monday in New York.
    @Test func hoursTodayAreTheShopsDay() {
        inDenver {
            let app = AppState()
            let me = app.currentPersonId ?? "7"
            app.timeclockEntries = [entry("2026-10-04T15:00:00Z", hours: 3, person: me),    // Sun 09:00 Denver
                                    entry("2026-10-05T04:30:00Z", hours: 1, person: me),    // Sun 22:30 Denver
                                    entry("2026-10-05T15:00:00Z", hours: 8, person: me)]    // Mon 09:00 Denver
            #expect(app.hoursToday(now: lateSunday) == 4)
            // Sep 20 – Oct 4: both Sunday shifts, not Monday's.
            #expect(app.payPeriodHours(now: lateSunday) == 4)
        }
    }

    // MARK: Availability

    /// "Never look in the past" floors at the shop's today: late Tuesday in Denver, Tuesday is
    /// still bookable — on a NY device it was already Wednesday.
    @Test func availabilityStartsOnTheShopsToday() throws {
        try inDenver {
            let person = try JSONDecoder().decode(Person.self, from: #"{"id":"7","name":"W","userRole":"user"}"#.data(using: .utf8)!)
            let r = AvailabilityEngine.compute(people: [person], jobs: [], org: .default,
                                               from: at("2026-10-01T06:00:00Z"), to: at("2026-10-31T06:00:00Z"),
                                               hours: 4, now: at("2026-10-07T05:00:00Z"))
            #expect(r.start == "2026-10-06")
            #expect(r.windowFrom == "2026-10-01")
        }
    }
}
