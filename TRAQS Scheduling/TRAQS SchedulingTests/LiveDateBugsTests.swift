import Testing
import Foundation
@testable import TRAQS_Scheduling

// Chunk D's three live date bugs, fixed ahead of the #304 migration.
@Suite("Live date bugs")
struct LiveDateBugsTests {

    private func org(_ tz: String) -> OrgSettings {
        let json = #"{"workStart":"07:00","workEnd":"15:00","workDays":[1,2,3,4,5],"holidays":[],"timeZone":"\#(tz)"}"#
        return try! JSONDecoder().decode(OrgSettings.self, from: json.data(using: .utf8)!)
    }

    /// The chat time-off card read a stored day at UTC midnight and printed it in the device's
    /// zone, so anywhere west of UTC Oct 5–7 showed as "Oct 4 – Oct 6". A stored day names no
    /// instant; it must print as itself in every zone.
    @Test func timeOffRangePrintsTheStoredDays() {
        #expect(ShopTime.rangeLabel(start: "2026-10-05", end: "2026-10-07") == "Oct 5 – Oct 7")
        #expect(ShopTime.rangeLabel(start: "2026-01-01", end: "2026-01-01") == "Jan 1")
        #expect(ShopTime.label(day: "2026-03-08") == "Mar 8")   // a US DST day
        #expect(ShopTime.label(day: "not a day") == "not a day")
    }

    /// A date picked in the device's calendar is that calendar's day. ymd read it in UTC, so
    /// east of UTC a job picked for Oct 5 (local midnight = Oct 4, 22:00Z) saved as Oct 4.
    @Test func pickedDateIsTheDeviceDay() {
        for id in ["Europe/Berlin", "Asia/Tokyo", "America/New_York", "Pacific/Auckland"] {
            let zone = TimeZone(identifier: id)!
            var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
            let midnight = cal.date(from: DateComponents(year: 2026, month: 10, day: 5))!
            #expect(AppState.ymd(midnight, in: zone) == "2026-10-05", "\(id)")
            #expect(AppState.ymd(midnight.addingTimeInterval(86_399), in: zone) == "2026-10-05", "\(id)")
        }
    }

    /// The Basic Home "today" came from ymd's UTC day, so it turned over at 18:00 in Denver
    /// (17:00 under MST) and the card showed tomorrow's shifts all evening. It is the shop's day.
    @Test func basicHomeTodayIsTheShopDay() {
        let denver = org("America/Denver")
        let at = { (iso: String) in Date.fromFlexibleISO8601(iso)! }
        #expect(BasicShiftsCard.today(now: at("2026-10-06T00:30:00Z"), org: denver) == "2026-10-05")  // 18:30 MDT
        #expect(BasicShiftsCard.today(now: at("2026-10-06T05:59:00Z"), org: denver) == "2026-10-05")  // 23:59 MDT
        #expect(BasicShiftsCard.today(now: at("2026-10-06T06:00:00Z"), org: denver) == "2026-10-06")  // midnight MDT
        #expect(BasicShiftsCard.today(now: at("2026-12-01T06:30:00Z"), org: denver) == "2026-11-30")  // 23:30 MST
        // East of UTC the other way: 00:30 in Berlin is still yesterday in UTC.
        #expect(BasicShiftsCard.today(now: at("2026-10-05T22:30:00Z"), org: org("Europe/Berlin")) == "2026-10-06")
    }
}
