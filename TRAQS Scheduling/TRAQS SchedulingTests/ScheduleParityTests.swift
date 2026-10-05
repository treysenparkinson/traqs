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
            /// `durationMinutes` may be missing — the missing-lengths org (#264/#307).
            struct Break: Codable { let time: String, durationMinutes: Int? }
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
        /// A unit with its panel and job, and who may take it — raw JSON, decoded through the
        /// real models so department fields arrive through extras the way they do in the app.
        struct Candidates: Decodable {
            let op: JSONValue, panel: JSONValue, job: JSONValue
            let departments: [String]
            let candidates: [String]
        }
        struct Shop: Decodable { let tz: String; let day: String; let hour: Double; let ms: Double; let backDay: String; let backHour: Double }
        struct Session: Decodable {
            let org: Int; let tz: String; let name: String
            let clockInMs: Double; let clockOutMs: Double?; let pausedAt: String?; let frozenAtMs: Double?
            let totalPausedMs: Double; let autoPausedMs: Double; let nowMs: Double
            let hours: Double; let endMs: Double; let frozen: Bool; let unclosed: Bool
            let between: Double; let endOfDay: Double
        }
        struct Grid: Decodable { let workStartH: Double, workEndH: Double; let start: Int, end: Int }
        struct Paint: Decodable { let color: String, row: String, legible: String, done: String }
        struct PayPeriodCase: Decodable { let payDates: [Int]; let today: String; let offset: Int; let start: String, end: String; let periodNumber: Int }
        let payPeriods: [PayPeriodCase]
        let grids: [Grid]
        let paint: [Paint]
        let shop: [Shop]
        let sessions: [Session]
        let crew: JSONValue
        let candidates: [Candidates]
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
            "lunch": Self.breakDict(o.lunch),
            "breaks": o.breaks.map(Self.breakDict),
        ]
        return try JSONDecoder().decode(OrgSettings.self, from: JSONSerialization.data(withJSONObject: dict))
    }
    private static func breakDict(_ b: Fixture.Org.Break) -> [String: Any] {
        var d: [String: Any] = ["time": b.time]
        if let m = b.durationMinutes { d["durationMinutes"] = m }
        return d
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
        #expect(f.orgs.count >= 6)
        #expect(f.paint.contains { $0.legible != $0.color })
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

    // MARK: Hour grid (#257) and bar paint (#252, #253)

    @Test func hourGridsMatch() {
        for g in f.grids {
            let got = GanttLayout.hourGrid(workStart: g.workStartH, workEnd: g.workEndH)
            #expect(got.start == g.start && got.end == g.end, "\(g.workStartH)–\(g.workEndH): got \(got)")
        }
    }

    @Test func barPaintMatches() {
        for p in f.paint {
            #expect(BarPaint.legible(p.color) == p.legible, "legible \(p.color)")
            #expect(BarPaint.doneFill(p.legible, row: p.row) == p.done, "done \(p.legible) on \(p.row)")
        }
    }

    // MARK: Pay periods (iOS chunk D)

    /// `getPayPeriodFromDates` / `getPayPeriodAtOffsetFromDates` (src/payPeriod.js).
    @Test func payPeriodsMatch() {
        #expect(f.payPeriods.count >= 400)
        for c in f.payPeriods {
            let p = c.offset == 0 ? PayPeriod.fromDates(c.payDates, today: c.today)
                                  : PayPeriod.atOffset(c.payDates, today: c.today, offset: c.offset)
            #expect([p.start, p.end, String(p.periodNumber)] == [c.start, c.end, String(c.periodNumber)],
                    "\(c.payDates) \(c.today) \(c.offset)")
        }
    }

    // MARK: Shop time and session hours (#250)

    private func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
    private func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

    @Test func shopTimeMatches() {
        var bad = 0
        for c in f.shop {
            let shop = ShopTime(zone: TimeZone(identifier: c.tz)!)
            let at = shop.instant(c.day, hour: c.hour)
            let ok = ms(at) == c.ms && shop.day(date(c.ms)) == c.backDay && abs(shop.hour(date(c.ms)) - c.backHour) < 1e-9
            if !ok { bad += 1; if bad <= 5 { Issue.record("\(c.tz) \(c.day) \(c.hour): got \(ms(at)) \(shop.day(date(c.ms))) \(shop.hour(date(c.ms))) want \(c.ms) \(c.backDay) \(c.backHour)") } }
        }
        #expect(bad == 0)
    }

    @Test func sessionHoursMatch() throws {
        var bad = 0
        for c in f.sessions {
            let s = try settings(f.orgs[c.org])
            let shop = ShopTime(zone: TimeZone(identifier: c.tz)!)
            let day = WorkDayClock.day(from: s), cal = WorkCalendar(org: s)
            let r = SessionHours.worked(
                clockIn: date(c.clockInMs), clockOut: c.clockOutMs.map(date),
                pausedAt: c.pausedAt.flatMap { Date.fromFlexibleISO8601($0) }, frozenAt: c.frozenAtMs.map(date),
                totalPausedMs: c.totalPausedMs, autoPausedMs: c.autoPausedMs, now: date(c.nowMs),
                day: day, calendar: cal, shop: shop)
            let between = SessionHours.productiveHoursBetween(date(c.clockInMs), date(c.nowMs), day: day, calendar: cal, shop: shop)
            let eod = shop.endOfDay(clockIn: date(c.clockInMs), workEnd: day.workEnd, calendar: cal)
            let ok = near(r.hours, c.hours) && ms(r.end) == c.endMs && r.frozen == c.frozen && r.unclosed == c.unclosed
                && abs(between - c.between) < 1e-6 && ms(eod) == c.endOfDay
            if !ok { bad += 1; if bad <= 5 { Issue.record("\(f.orgs[c.org].name) \(c.tz) \(c.name): got \(r) between \(between) eod \(ms(eod)); want \(c.hours) end \(c.endMs) \(c.frozen)/\(c.unclosed) between \(c.between) eod \(c.endOfDay)") } }
        }
        #expect(bad == 0)
    }

    // MARK: Departments

    private func decode<T: Decodable>(_ v: JSONValue, as: T.Type, adding extra: [String: JSONValue] = [:]) throws -> T {
        var value = v
        if case .object(var o) = value { for (k, x) in extra where o[k] == nil { o[k] = x }; value = .object(o) }
        return try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
    }

    @Test func departmentsAndCandidatesMatch() throws {
        let crew = try decode(f.crew, as: [Person].self)
        #expect(crew.count == 6)
        var bad = 0
        for c in f.candidates {
            let op = try decode(c.op, as: Operation.self, adding: ["status": .string("Not Started")])
            let panel = try decode(c.panel, as: Panel.self, adding: ["subs": .array([])])
            let job = try decode(c.job, as: Job.self, adding: ["subs": .array([])])
            let depts = Departments.unit(op.extras, panel: panel.extras, job: job.extras)
            let who = Departments.candidates(team: op.team, departments: depts, crew: crew).map(\.id)
            if depts != c.departments || who != c.candidates {
                bad += 1
                if bad <= 5 { Issue.record("\(c.op): depts \(depts) want \(c.departments); who \(who) want \(c.candidates)") }
            }
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
