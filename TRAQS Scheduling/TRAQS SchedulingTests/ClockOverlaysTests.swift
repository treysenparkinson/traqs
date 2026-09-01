import Testing
import Foundation
@testable import TRAQS_Scheduling

/// Punched break / lunch spans, resolved for one day.
///
/// What these pin down is the part that is invisible on a rendered timeline:
/// whether a span is PRODUCED at all. "I've been on break 15 minutes and the
/// gantt shows nothing" has two possible causes — the pairing walk didn't emit a
/// span, or it emitted one that drew too faint to notice — and staring at the
/// screen cannot tell them apart. These cover the first.
///
/// The awkward cases are all about incomplete data: a break that has started and
/// not ended, the same punch arriving from three sources at once, and an end
/// punch whose start was lost.
struct ClockOverlaysTests {

    private var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    /// 2026-09-01 at h:m UTC.
    private func at(_ h: Int, _ m: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 9; c.day = 1
        c.hour = h; c.minute = m; c.second = 0
        c.timeZone = TimeZone(identifier: "UTC")
        return cal.date(from: c)!
    }

    private var day: Date { at(0, 0) }

    private func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: d)
    }

    /// TimeclockEntry has only a decoding init (it is a wire type), so build it
    /// the way the app does — from JSON.
    private func eventRow(person: String, type: String, at when: Date) -> TimeclockEntry {
        let data = try! JSONSerialization.data(withJSONObject: [
            "id": "\(type)-\(Int(when.timeIntervalSince1970))",
            "personId": person,
            "eventType": type,
            "timestamp": iso(when),
        ])
        return try! JSONDecoder().decode(TimeclockEntry.self, from: data)
    }

    private func spans(entries: [TimeclockEntry] = [],
                       live: [ClockEvent] = [],
                       activeBreak: ActiveBreak? = nil,
                       now: Date) -> [ClockOverlays.Span] {
        ClockOverlays.spans(day: day, personId: "me",
                            entries: entries, liveEvents: live,
                            activeBreak: activeBreak, now: now, calendar: cal)
    }

    // MARK: The reported case

    // The exact situation in the bug report: on break for 15 minutes, nothing
    // ended yet, and the ONLY record is the optimistic local flag — the server
    // has not written a breakStart row. A span still has to come out, running to
    // now, or the timeline has nothing to draw.
    @Test func anOpenBreakFromTheLocalFlagAloneStillProducesASpan() {
        let started = at(11, 30)
        let out = spans(activeBreak: ActiveBreak(startedAt: iso(started), durationMinutes: 15),
                        now: at(11, 45))
        #expect(out.count == 1)
        #expect(out[0].kind == .rest)
        #expect(out[0].isOpen)
        #expect(out[0].minutes == 15)
    }

    @Test func aClosedLunchPairsFromTheTimeclockHistory() {
        let out = spans(entries: [
            eventRow(person: "me", type: "lunchStart", at: at(12, 0)),
            eventRow(person: "me", type: "lunchEnd",   at: at(12, 30)),
        ], now: at(15, 0))
        #expect(out.count == 1)
        #expect(out[0].kind == .lunch)
        #expect(!out[0].isOpen)
        #expect(out[0].minutes == 30)
    }

    // MARK: Overlapping sources

    // The same punch legitimately arrives three ways at once: the history row,
    // the open shift's event list, and the optimistic flag. One span, not three.
    @Test func theSamePunchFromEverySourceCollapsesToOneSpan() {
        let started = at(9, 0)
        let out = spans(entries: [eventRow(person: "me", type: "breakStart", at: started)],
                        live: [ClockEvent(type: "breakStart", ts: iso(started))],
                        activeBreak: ActiveBreak(startedAt: iso(started), durationMinutes: 15),
                        now: at(9, 20))
        #expect(out.count == 1)
        #expect(out[0].minutes == 20)
    }

    // A live event can close a break whose START only the history knows about.
    @Test func aLiveEndClosesAHistoryStart() {
        let out = spans(entries: [eventRow(person: "me", type: "breakStart", at: at(9, 0))],
                        live: [ClockEvent(type: "breakEnd", ts: iso(at(9, 15)))],
                        now: at(11, 0))
        #expect(out.count == 1)
        #expect(!out[0].isOpen)
        #expect(out[0].minutes == 15)
    }

    // MARK: Scoping

    @Test func anotherPersonsPunchesAreIgnored() {
        let out = spans(entries: [
            eventRow(person: "someone-else", type: "lunchStart", at: at(12, 0)),
            eventRow(person: "someone-else", type: "lunchEnd",   at: at(12, 30)),
        ], now: at(15, 0))
        #expect(out.isEmpty)
    }

    @Test func punchesFromAnotherDayAreIgnored() {
        var c = DateComponents()
        c.year = 2026; c.month = 8; c.day = 28
        c.hour = 12; c.minute = 0; c.timeZone = TimeZone(identifier: "UTC")
        let lastWeek = cal.date(from: c)!
        let out = spans(entries: [eventRow(person: "me", type: "lunchStart", at: lastWeek)],
                        now: at(15, 0))
        #expect(out.isEmpty)
    }

    // MARK: Malformed punches

    // Lunch and break are tracked separately, so an interleaved pair cannot
    // close a lunch with a break's end punch.
    @Test func aBreakInsideALunchDoesNotStealItsEndPunch() {
        let out = spans(entries: [
            eventRow(person: "me", type: "lunchStart", at: at(12, 0)),
            eventRow(person: "me", type: "breakStart", at: at(12, 5)),
            eventRow(person: "me", type: "breakEnd",   at: at(12, 10)),
            eventRow(person: "me", type: "lunchEnd",   at: at(12, 30)),
        ], now: at(15, 0))
        #expect(out.count == 2)
        #expect(out.first(where: { $0.kind == .lunch })?.minutes == 30)
        #expect(out.first(where: { $0.kind == .rest })?.minutes == 5)
    }

    // A lost end punch must not swallow the next break. The first closes where
    // the second begins rather than either being dropped.
    @Test func aSecondStartClosesTheStrandedFirstOne() {
        let out = spans(entries: [
            eventRow(person: "me", type: "breakStart", at: at(9, 0)),
            eventRow(person: "me", type: "breakStart", at: at(9, 30)),
            eventRow(person: "me", type: "breakEnd",   at: at(9, 45)),
        ], now: at(11, 0))
        #expect(out.count == 2)
        #expect(out[0].minutes == 30)
        #expect(out[1].minutes == 15)
    }

    // An end with nothing open (its start was lost, or belongs to yesterday)
    // has no span to draw — and must not invent one from the top of the day.
    @Test func anEndWithNoStartDrawsNothing() {
        let out = spans(entries: [eventRow(person: "me", type: "breakEnd", at: at(9, 15))],
                        now: at(11, 0))
        #expect(out.isEmpty)
    }

    // A double-punch (in and straight back out) is a mistake, not a rest.
    @Test func aZeroLengthPunchIsDropped() {
        let out = spans(entries: [
            eventRow(person: "me", type: "breakStart", at: at(9, 0)),
            eventRow(person: "me", type: "breakEnd",   at: at(9, 0)),
        ], now: at(11, 0))
        #expect(out.isEmpty)
    }

    // A break left open on a PAST day must stop at that day's end, not stretch
    // to the present — otherwise last Tuesday's forgotten punch paints every
    // hour since.
    @Test func anOpenSpanOnAPastDayStopsAtThatDaysEnd() {
        let out = ClockOverlays.spans(
            day: day, personId: "me",
            entries: [eventRow(person: "me", type: "breakStart", at: at(9, 0))],
            liveEvents: [], activeBreak: nil,
            now: at(9, 0).addingTimeInterval(60 * 60 * 24 * 3),   // three days later
            calendar: cal)
        #expect(out.count == 1)
        #expect(out[0].isOpen)
        // 09:00 → 23:59:59 on the SAME day, not 72 hours.
        #expect(out[0].minutes == 15 * 60)
    }
}
