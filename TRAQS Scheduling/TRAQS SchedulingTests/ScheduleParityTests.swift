import Testing
import Foundation
@testable import TRAQS_Scheduling

// The web's schedule rules, as computed by the REAL web code — fixtures/schedule-parity.json,
// written by scripts/schedule-parity-test.mjs from src/statsMath.js and src/scheduleRules.js.
// Nobody types these expected values. The JS suite fails if the web drifts from the file;
// this one fails if a Swift port drifts from it. A deliberate rule change regenerates the file
// (`--write`) and this suite then stays red until the port follows.
//
// Ports covered: WorkDayClock (buildDayWindows, walkProductiveHours, productiveClockHours),
// OrgSettings.productiveHoursPerDay, WorkCalendar (workCalendar), OverlapRule (personShareHours,
// opDaySegments) and GanttLayout (isAssignedHere, dayViewBlocks).
@Suite("Schedule parity with the web")
struct ScheduleParityTests {

    // MARK: The file

    struct Fixture: Decodable {
        struct Org: Decodable {
            struct Windows: Decodable {
                let workStartH: Double, workEndH: Double
                let dead: [Dead]
            }
            struct Dead: Decodable { let start: Double, duration: Double }
            struct Break: Codable { let time: String, durationMinutes: Int }
            let name: String
            let workStart: String, workEnd: String
            let workDays: [Int], holidays: [String]
            let lunch: Break, breaks: [Break]
            let windows: Windows
            let productiveHoursPerDay: Double
        }
        struct Walk: Decodable { let org: Int; let startH: Double, hours: Double; let days: Int; let endHour: Double, columns: Double }
        struct ClockHours: Decodable { let org: Int; let from: Double, to: Double, hours: Double }
        struct Day: Decodable { let org: Int; let day: String; let isWorkDay: Bool }
        struct Share: Decodable { let hpd: Double; let teamCount: Int; let productiveHoursPerDay: Double, hours: Double }
        struct Unit: Decodable {
            let id: String, start: String, end: String
            let startHour: Double?
            let hpd: Double
            let team: [String]
            var rule: OverlapRule.Unit {
                OverlapRule.Unit(id: id, start: start, end: end, startHour: startHour, hpd: hpd, team: team)
            }
        }
        struct Seg: Decodable { let day: String; let start: Double, end: Double }
        struct Segments: Decodable { let org: Int; let unit: Unit; let segments: [Seg] }
        struct Block: Decodable { let index: Int; let start: Double, end: Double; let isFirst: Bool, isLast: Bool }
        struct DayView: Decodable { let org: Int; let day: String; let business: Bool; let units: [Unit]; let blocks: [Block] }
        struct Assigned: Decodable {
            struct Node: Decodable {
                struct Child: Decodable { let team: [String]; let deletedAt: String? }
                let team: [String]
                let subs: [Child]?
            }
            let name: String
            let node: Node
            let assigned: Bool
        }
        let orgs: [Org]
        let walks: [Walk]
        let clockHours: [ClockHours]
        let calendar: [Day]
        let shares: [Share]
        let segments: [Segments]
        let dayView: [DayView]
        let assigned: [Assigned]
    }

    /// Repo-relative, from this file: TRAQS Scheduling/TRAQS SchedulingTests → ../../fixtures.
    static let fixture: Fixture = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("fixtures/schedule-parity.json")
        let data = try! Data(contentsOf: url)
        return try! JSONDecoder().decode(Fixture.self, from: data)
    }()

    private var f: Fixture { Self.fixture }

    /// The org as iOS receives it, decoded through the real OrgSettings decoder.
    private func settings(_ o: Fixture.Org) throws -> OrgSettings {
        let dict: [String: Any] = [
            "workStart": o.workStart, "workEnd": o.workEnd, "workDays": o.workDays, "holidays": o.holidays,
            "lunch": ["time": o.lunch.time, "durationMinutes": o.lunch.durationMinutes],
            "breaks": o.breaks.map { ["time": $0.time, "durationMinutes": $0.durationMinutes] },
        ]
        return try JSONDecoder().decode(OrgSettings.self, from: JSONSerialization.data(withJSONObject: dict))
    }
    private func day(_ i: Int) throws -> DayWindow { WorkDayClock.day(from: try settings(f.orgs[i])) }
    private func context(_ i: Int) throws -> OverlapRule.Context {
        let s = try settings(f.orgs[i])
        return OverlapRule.Context(day: WorkDayClock.day(from: s), calendar: WorkCalendar(org: s), today: nil)
    }

    private static let eps = 1e-9
    private func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) < Self.eps }

    // MARK: Guard the input

    /// A fixture that decoded to nothing would pass every loop below.
    @Test func theFixtureIsThere() {
        #expect(f.orgs.count >= 5)
        #expect(f.walks.count >= 300)
        #expect(f.dayView.filter { !$0.blocks.isEmpty }.count >= 250)
        #expect(f.segments.filter { $0.segments.count > 1 }.count >= 10)
        #expect(f.assigned.count >= 7)
    }

    // MARK: The working day

    @Test func dayWindowsMatch() throws {
        for (i, o) in f.orgs.enumerated() {
            let d = try day(i)
            #expect(near(d.workStart, o.windows.workStartH) && near(d.workEnd, o.windows.workEndH), "\(o.name)")
            #expect(d.dead.count == o.windows.dead.count, "\(o.name) dead windows")
            for (a, b) in zip(d.dead, o.windows.dead) {
                #expect(near(a.start, b.start) && near(a.duration, b.duration), "\(o.name) dead \(b)")
            }
        }
    }

    /// One day length (#246): the org's own figure is the windows' figure, not a flat
    /// workEnd − workStart − lunch − every break.
    @Test func productiveHoursPerDayMatches() throws {
        for (i, o) in f.orgs.enumerated() {
            let s = try settings(o)
            #expect(near(s.productiveHoursPerDay, o.productiveHoursPerDay), "\(o.name): OrgSettings")
            #expect(near(try day(i).productiveHours, o.productiveHoursPerDay), "\(o.name): DayWindow")
        }
    }

    @Test func walksMatch() throws {
        let days = try f.orgs.indices.map(day)
        var bad = 0
        for w in f.walks {
            let got = WorkDayClock.walk(from: w.startH, hours: w.hours, in: days[w.org])
            if got.days != w.days || !near(got.endHour, w.endHour) || !near(got.columns, w.columns) {
                bad += 1
                if bad <= 5 { Issue.record("walk \(w): got \(got)") }
            }
        }
        #expect(bad == 0)
    }

    @Test func clockHoursMatch() throws {
        for c in f.clockHours {
            #expect(near(WorkDayClock.productiveHours(from: c.from, to: c.to, in: try day(c.org)), c.hours), "\(c)")
        }
    }

    @Test func calendarMatches() throws {
        for c in f.calendar {
            #expect(WorkCalendar(org: try settings(f.orgs[c.org])).isWorkDay(c.day) == c.isWorkDay, "\(f.orgs[c.org].name) \(c.day)")
        }
    }

    // MARK: hpd

    @Test func sharesMatch() {
        for s in f.shares {
            #expect(near(OverlapRule.shareHours(hpd: s.hpd, teamCount: s.teamCount,
                                                productiveHoursPerDay: s.productiveHoursPerDay), s.hours), "\(s)")
            #expect(near(JobShifts.share(hpd: s.hpd, teamCount: s.teamCount,
                                         day: DayWindow(workStart: 0, workEnd: s.productiveHoursPerDay, dead: [])),
                         s.hours), "JobShifts \(s)")
        }
    }

    // MARK: Units on days

    @Test func opDaySegmentsMatch() throws {
        var bad = 0
        for c in f.segments {
            let ctx = try context(c.org)
            let u = c.unit.rule
            let got = OverlapRule.blocks(of: u, context: ctx)
            let same = got.count == c.segments.count && zip(got, c.segments).allSatisfy {
                $0.day == $1.day && near($0.start, $1.start) && near($0.end, $1.end)
            }
            if !same { bad += 1; if bad <= 5 { Issue.record("\(f.orgs[c.org].name) \(c.unit.id): got \(got) want \(c.segments)") } }
        }
        #expect(bad == 0)
    }

    @Test func dayViewMatches() throws {
        var bad = 0
        for c in f.dayView {
            let got = GanttLayout.dayBlocks(c.units.map(\.rule), on: c.day, context: try context(c.org), business: c.business)
            let same = got.count == c.blocks.count && zip(got, c.blocks).allSatisfy {
                $0.index == $1.index && near($0.start, $1.start) && near($0.end, $1.end)
                    && $0.isFirst == $1.isFirst && $0.isLast == $1.isLast
            }
            if !same { bad += 1; if bad <= 5 { Issue.record("\(f.orgs[c.org].name) \(c.day) business=\(c.business): got \(got) want \(c.blocks)") } }
        }
        #expect(bad == 0)
    }

    @Test func isAssignedHereMatches() {
        for c in f.assigned {
            let live = (c.node.subs ?? []).filter { $0.deletedAt == nil }.count
            #expect(GanttLayout.isAssignedHere(team: c.node.team, liveChildren: live, person: "a") == c.assigned, "\(c.name)")
        }
    }
}
