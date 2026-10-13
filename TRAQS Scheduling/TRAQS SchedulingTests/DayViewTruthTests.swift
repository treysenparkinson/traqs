import Testing
import Foundation
@testable import TRAQS_Scheduling

// #252 and #365 — the day view telling the truth about today.
//
//   #252  A day off has to SHOW as a day off. The web tints the person's row (PTO green,
//         UTO amber) and still draws their work over it (#14: an empty row is a lie).
//         Which entries count is the web's `countsAsLeave`: no status, or "approved".
//   #365  Hours someone clocked on an op whose team they are not on are drawn on their
//         row as a record of the work, at the times it happened (the web's cross-row
//         bars). Without them, a worker covering someone else's op saw an empty day.

@Suite("Leave on the day view (#252)")
struct LeaveRuleTests {
    private func entry(_ start: String, _ end: String, type: String = "PTO", status: String?) throws -> TimeOffEntry {
        let statusJSON = status.map { #","status":"\#($0)""# } ?? ""
        let json = #"{"start":"\#(start)","end":"\#(end)","type":"\#(type)"\#(statusJSON)}"#
        return try JSONDecoder().decode(TimeOffEntry.self, from: Data(json.utf8))
    }

    @Test("approved, or no status at all, counts as leave — as the web's countsAsLeave")
    func countsLikeTheWeb() throws {
        #expect(LeaveRule.counts(try entry("2026-10-13", "2026-10-13", status: "approved")))
        #expect(LeaveRule.counts(try entry("2026-10-13", "2026-10-13", status: nil)))
        #expect(!LeaveRule.counts(try entry("2026-10-13", "2026-10-13", status: "pending")))
        #expect(!LeaveRule.counts(try entry("2026-10-13", "2026-10-13", status: "denied")))
    }

    @Test("the entry covering the day, inclusive of both ends")
    func coversTheDay() throws {
        let off = [try entry("2026-10-12", "2026-10-14", type: "UTO", status: "approved")]
        #expect(LeaveRule.leave(on: "2026-10-12", in: off)?.type == "UTO")
        #expect(LeaveRule.leave(on: "2026-10-14", in: off) != nil)
        #expect(LeaveRule.leave(on: "2026-10-15", in: off) == nil)
    }

    @Test("a pending request covering the day is not a day off")
    func pendingIsNotOff() throws {
        #expect(LeaveRule.leave(on: "2026-10-13", in: [try entry("2026-10-13", "2026-10-13", status: "pending")]) == nil)
    }
}

@Suite("Cross-row work on the day view (#365)")
struct CrossRowTests {
    let shop = ShopTime(zone: TimeZone(identifier: "America/Denver")!)
    private func at(_ iso: String) -> Date { Date.fromFlexibleISO8601(iso)! }
    /// I'm on op "mine" and not on "theirs".
    private let onTeam: (String) -> Bool = { $0 == "mine" }

    @Test("a session on an op I'm not on draws at the hours it happened")
    func offTeamSessionDraws() {
        // 09:00–11:30 Denver on Oct 13.
        let w = [GanttLayout.Worked(nodeId: "theirs", start: at("2026-10-13T15:00:00Z"), end: at("2026-10-13T17:30:00Z"))]
        let bars = GanttLayout.crossRow(w, onTeam: onTeam, day: "2026-10-13", shop: shop)
        #expect(bars == [GanttLayout.CrossRow(nodeId: "theirs", start: 9, end: 11.5)])
    }

    @Test("work on my own op is already a bar of mine — no second one")
    func onTeamWorkIsNotCrossRow() {
        let w = [GanttLayout.Worked(nodeId: "mine", start: at("2026-10-13T15:00:00Z"), end: at("2026-10-13T17:00:00Z"))]
        #expect(GanttLayout.crossRow(w, onTeam: onTeam, day: "2026-10-13", shop: shop).isEmpty)
    }

    @Test("two sessions on one op that day make one bar, first start to last end")
    func sessionsMerge() {
        let w = [GanttLayout.Worked(nodeId: "theirs", start: at("2026-10-13T20:00:00Z"), end: at("2026-10-13T21:00:00Z")),
                 GanttLayout.Worked(nodeId: "theirs", start: at("2026-10-13T15:00:00Z"), end: at("2026-10-13T16:00:00Z"))]
        #expect(GanttLayout.crossRow(w, onTeam: onTeam, day: "2026-10-13", shop: shop)
                == [GanttLayout.CrossRow(nodeId: "theirs", start: 9, end: 15)])
    }

    @Test("only the part on this shop day is drawn")
    func clippedToTheDay() {
        // 22:00 Oct 13 → 02:00 Oct 14, Denver.
        let w = [GanttLayout.Worked(nodeId: "theirs", start: at("2026-10-14T04:00:00Z"), end: at("2026-10-14T08:00:00Z"))]
        #expect(GanttLayout.crossRow(w, onTeam: onTeam, day: "2026-10-13", shop: shop)
                == [GanttLayout.CrossRow(nodeId: "theirs", start: 22, end: 24)])
        #expect(GanttLayout.crossRow(w, onTeam: onTeam, day: "2026-10-14", shop: shop)
                == [GanttLayout.CrossRow(nodeId: "theirs", start: 0, end: 2)])
        #expect(GanttLayout.crossRow(w, onTeam: onTeam, day: "2026-10-15", shop: shop).isEmpty)
    }
}
