import Testing
@testable import TRAQS_Scheduling

// #360. Multi-day units sit on the day view at their own walked segment, ignoring the
// shared cursor — so two of them on one day overlap, and one card hid the other entirely
// (measured: Quincy, week of 2026-10-05, tvi2a06na and tst5cu0x3 both 08:00–17:00 on
// Oct 6). Placement is right (it is the unit's own hours, held to the web by the parity
// fixture); the PRESENTATION was wrong. Overlapping blocks now share the row in lanes,
// side by side — the web's `barLanes`, which it already uses for Basic.
@Suite("Day-view lanes for overlapping blocks (#360)")
struct DayLanesTests {
    private func lanes(_ spans: [(Double, Double)]) -> [GanttLayout.Lane] {
        GanttLayout.lanes(spans.map { (start: $0.0, end: $0.1) })
    }

    @Test("blocks that don't overlap all take the full row")
    func noOverlap() {
        #expect(lanes([(8, 10), (10, 12), (13, 15)]) == Array(repeating: GanttLayout.Lane(lane: 0, of: 1), count: 3))
    }

    @Test("two units over the same hours share the row — neither hides the other")
    func quincysDay() {
        #expect(lanes([(8, 17), (8, 17)]) == [GanttLayout.Lane(lane: 0, of: 2), GanttLayout.Lane(lane: 1, of: 2)])
    }

    @Test("a chain takes as many lanes as its busiest moment, and reuses a freed lane")
    func chain() {
        // A 8–11, B 10–14, C 12–16: A and C never meet, so C takes A's lane.
        #expect(lanes([(8, 11), (10, 14), (12, 16)])
                == [GanttLayout.Lane(lane: 0, of: 2), GanttLayout.Lane(lane: 1, of: 2), GanttLayout.Lane(lane: 0, of: 2)])
    }

    @Test("an end that touches a start is not an overlap")
    func touching() {
        #expect(lanes([(8, 12), (12, 16)]) == [GanttLayout.Lane(lane: 0, of: 1), GanttLayout.Lane(lane: 0, of: 1)])
    }

    @Test("separate clusters size their lanes independently")
    func clusters() {
        // A busy morning (two lanes) doesn't narrow a lone afternoon block.
        #expect(lanes([(8, 12), (9, 11), (14, 16)])
                == [GanttLayout.Lane(lane: 0, of: 2), GanttLayout.Lane(lane: 1, of: 2), GanttLayout.Lane(lane: 0, of: 1)])
    }
}
