import Testing
import Foundation
@testable import TRAQS_Scheduling

// `suggestSchedule` and the confirm behind "Use This Schedule" — step 3 of the
// New Job wizard.
//
// Covered heavily because the failure mode is silent and expensive: it assigns
// real people to real weeks, and a wrong answer looks exactly like a right one
// until somebody turns up to a job that is not theirs.
@Suite("Schedule & Assign")
struct JobsSchedulerTests {

    private func job(_ json: String) -> Job {
        try! JSONDecoder().decode(Job.self, from: json.data(using: .utf8)!)
    }
    private func person(_ json: String) -> Person {
        try! JSONDecoder().decode(Person.self, from: json.data(using: .utf8)!)
    }

    /// 2026-03-02 is a Monday. Every date here is relative to it.
    private let monday = "2026-03-02"
    private let calendar = WorkCalendar()

    private var crew: [Person] {
        [person(#"{"id":"u1","name":"Ada","department":"Wire","userRole":"user"}"#),
         person(#"{"id":"u2","name":"Bob","department":"Fab","secondaryDepartment":"Wire","userRole":"user"}"#)]
    }

    private var twoOps: [SchedulableUnit] {
        JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"o1","title":"One","hpd":7.5},{"id":"o2","title":"Two","hpd":7.5}]}]}
        """#), productiveHoursPerDay: 7.5)
    }

    // MARK: Business days

    @Test func workDaysSkipWeekendsAndHolidays() {
        #expect(calendar.addingWorkDays(1, to: monday) == "2026-03-03")
        #expect(calendar.addingWorkDays(1, to: "2026-03-06") == "2026-03-09")   // Fri → Mon
        #expect(calendar.addingWorkDays(5, to: monday) == "2026-03-09")
        #expect(calendar.nextWorkDay(from: "2026-03-07") == "2026-03-09")       // Sat → Mon
        #expect(calendar.nextWorkDay(from: monday) == monday)

        let withHoliday = WorkCalendar(workDays: [1, 2, 3, 4, 5], holidays: ["2026-03-03"])
        #expect(withHoliday.addingWorkDays(1, to: monday) == "2026-03-04")
    }

    /// An org that somehow saves an empty `workDays` must not hang the walk.
    @Test func anEmptyWorkWeekCannotHang() {
        let broken = WorkCalendar(workDays: [], holidays: [])
        #expect(broken.addingWorkDays(1, to: monday) == "2026-03-03")
    }

    // MARK: Reading the form

    @Test func durationIsWholeBusinessDays() {
        #expect(JobsScheduler.durationDays(hpd: 7.5, teamSize: 1, productiveHoursPerDay: 7.5) == 1)
        #expect(JobsScheduler.durationDays(hpd: 15, teamSize: 1, productiveHoursPerDay: 7.5) == 2)
        #expect(JobsScheduler.durationDays(hpd: 40, teamSize: 1, productiveHoursPerDay: 7.5) == 6)
        // Never zero — a unit always occupies a day.
        #expect(JobsScheduler.durationDays(hpd: 0, teamSize: 1, productiveHoursPerDay: 7.5) == 1)
    }

    /// `hpd` is the whole team's total, so each person carries their share of it
    /// through a PRODUCTIVE day — not a day of the org's gross `hpd`.
    @Test func durationIsEachPersonsShareOverAProductiveDay() {
        // 30h across two people is 15h each — two 7.5h days, not four.
        #expect(JobsScheduler.durationDays(hpd: 30, teamSize: 2, productiveHoursPerDay: 7.5) == 2)
        // 16h / 2 = 8h each: just over one productive day, so two.
        #expect(JobsScheduler.durationDays(hpd: 16, teamSize: 2, productiveHoursPerDay: 7.5) == 2)
        // A team of 0 is read as one person, never a divide by zero.
        #expect(JobsScheduler.durationDays(hpd: 15, teamSize: 0, productiveHoursPerDay: 7.5) == 2)
        // Unestimated is one day whatever the team.
        #expect(JobsScheduler.durationDays(hpd: 0, teamSize: 3, productiveHoursPerDay: 7.5) == 1)
    }

    /// "Panels with sub-ops → sub-ops are assignable. Panels without → the panel
    /// itself is." Untitled rows are skipped.
    @Test func assignableUnitsAreTheLeaves() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[
         {"id":"p1","title":"Panel","subs":[{"id":"o1","title":"Wire","hpd":7.5}]},
         {"id":"p2","title":"Leaf","hpd":7.5,"subs":[]},
         {"id":"p3","title":"","subs":[]}]}
        """#), productiveHoursPerDay: 7.5)
        #expect(units.map(\.id) == ["o1", "p2"])
    }

    /// #242: a panel is a unit only when it has no LIVE ops — `isAssignedHere`, the rule the
    /// gantt and the overlap rule use. Deleted ops don't make a panel a parent; untitled live
    /// ops are skipped as the web skips them, and do NOT turn the panel back into a unit.
    @Test func aPanelIsAUnitOnlyWithNoLiveOps() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[
         {"id":"p1","title":"Gone","hpd":4,"subs":[{"id":"o1","title":"Wire","hpd":2,"deletedAt":"2026-09-01"}]},
         {"id":"p2","title":"Untitled","hpd":4,"subs":[{"id":"o2","title":"  ","hpd":2}]}]}
        """#), productiveHoursPerDay: 7.5)
        #expect(units.map(\.id) == ["p1"])
    }

    /// The web dropped the title heuristic (4ee9598): an op titled "Wire" with no stated
    /// department may be done by ANYONE. Departments are the nearest level that states any,
    /// as a set.
    @Test func noStatedDepartmentMeansAnyoneWhateverTheTitle() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","requiredDepartment":"Layout","subs":[{"id":"p","title":"P","subs":[
         {"id":"a","title":"Wire","hpd":2},
         {"id":"b","title":"Cut","hpd":2,"requiredDepartments":["Cut","Wire"],"requiredDepartment":"Cut"}]},
         {"id":"q","title":"Q","subs":[{"id":"c","title":"Wire","hpd":2}]}]}
        """#), productiveHoursPerDay: 7.5)
        #expect(units.map(\.departments) == [["Layout"], ["Cut", "Wire"], ["Layout"]])
        let bare = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[{"id":"a","title":"Wire","hpd":2}]}]}
        """#), productiveHoursPerDay: 7.5)
        #expect(bare.map(\.departments) == [[]])
    }

    @Test func dependenciesAreWorkedFirst() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"c","title":"C","deps":["b"]},
         {"id":"b","title":"B","deps":["a"]},
         {"id":"a","title":"A"}]}]}
        """#), productiveHoursPerDay: 7.5)
        #expect(units.map(\.id) == ["a", "b", "c"])
    }

    /// A cycle in `deps` must not recurse forever — `visited` is marked on the
    /// way in.
    @Test func aDependencyCycleTerminates() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"x","title":"X","deps":["y"]},{"id":"y","title":"Y","deps":["x"]}]}]}
        """#), productiveHoursPerDay: 7.5)
        #expect(units.count == 2)
    }

    // MARK: Crew

    @Test func onlySchedulableCrewIsConsidered() {
        let all = [
            person(#"{"id":"u1","name":"A","userRole":"user"}"#),
            person(#"{"id":"u2","name":"B","userRole":"user","noAutoSchedule":true}"#),
            person(#"{"id":"u3","name":"C","userRole":"user","autoSchedule":false}"#),
            person(#"{"id":"u4","name":"D","userRole":"viewer"}"#),
        ]
        // Excluded by EITHER convention — the desktop writes `noAutoSchedule`,
        // iOS writes `autoSchedule: false`.
        #expect(JobsScheduler.schedulableCrew(all).map(\.id) == ["u1"])
    }

    /// A department is matched as a set, case-insensitively, against a person's department
    /// and secondary department — no primary-before-secondary ranking (4ee9598).
    @Test func aDepartmentMatchesEitherOfAPersonsDepartments() {
        #expect(Departments.candidates(team: [], departments: ["wire"], crew: crew).map(\.id) == ["u1", "u2"])
        #expect(Departments.candidates(team: [], departments: ["Fab"], crew: crew).map(\.id) == ["u2"])
        #expect(Departments.candidates(team: [], departments: [], crew: crew).map(\.id) == ["u1", "u2"])
    }

    /// No fallback to all crew: an op whose department has nobody is unstaffable and is
    /// reported, never handed to whoever is free. The fallback is the funnel that put 71 ops
    /// on one person on the web.
    @Test func anUnstaffedDepartmentIsNobody() {
        #expect(Departments.candidates(team: [], departments: ["Nobody"], crew: crew).isEmpty)
    }

    /// An existing team wins outright — unless none of it is on the roster any more.
    @Test func anExistingTeamWinsOutright() {
        #expect(Departments.candidates(team: ["u2"], departments: ["Wire"], crew: crew).map(\.id) == ["u2"])
        #expect(Departments.candidates(team: ["gone"], departments: ["Fab"], crew: crew).map(\.id) == ["u2"])
    }

    /// An unstaffable unit fails every window, and `unstaffable` names it, so the sheet can
    /// say why instead of "nobody is free for 200 days".
    @Test func anUnstaffableUnitIsNamedNotScheduled() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"a","title":"A","hpd":2,"requiredDepartment":"Engineering"},{"id":"b","title":"B","hpd":2}]}]}
        """#), productiveHoursPerDay: 7.5)
        #expect(JobsScheduler.unstaffable(units, crew: crew).map(\.id) == ["a"])
        #expect(JobsScheduler.windows(.init(units: units, crew: crew, calendar: calendar, today: monday)).isEmpty)
    }

    // MARK: Windows

    @Test func windowsRunSequentiallyFromTheSoonestWorkDay() {
        let found = JobsScheduler.windows(.init(units: twoOps, crew: crew, today: monday))
        #expect(found.count == 3)
        #expect(found[0].start == monday)
        #expect(found[0].end == "2026-03-03")     // two 1-day units, back to back
        #expect(found[0].totalDays == 2)
        #expect(found[1].start == "2026-03-03")   // next candidate day
    }

    @Test func anExistingBookingPushesTheWindowOut() {
        let booked = job(#"""
        {"id":"other","title":"Other","subs":[{"id":"bp","title":"BP","subs":[
         {"id":"bo","title":"Busy","start":"2026-03-02","end":"2026-03-04",
          "team":["u1","u2"],"status":"In Progress","hpd":60}]}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [booked], people: [], context: request.rule))
        #expect(JobsScheduler.windows(request)[0].start == "2026-03-05")
    }

    @Test func finishedWorkBooksNobody() {
        let done = job(#"""
        {"id":"other","title":"Other","subs":[{"id":"bp","title":"BP","subs":[
         {"id":"bo","title":"Done","start":"2026-03-02","end":"2026-03-04",
          "team":["u1","u2"],"status":"Finished"}]}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [done], people: [], context: request.rule))
        #expect(JobsScheduler.windows(request)[0].start == monday)
    }

    /// `if (ed.id && job.id === ed.id) continue` — a job must not make its own
    /// people look busy while it is being rescheduled.
    @Test func theJobBeingScheduledDoesNotBlockItself() {
        let booked = job(#"""
        {"id":"other","title":"Other","subs":[{"id":"bp","title":"BP","subs":[
         {"id":"bo","title":"Busy","start":"2026-03-02","end":"2026-03-04",
          "team":["u1","u2"],"status":"In Progress","hpd":60}]}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [booked], people: [], context: request.rule,
                                   excluding: "other"))
        #expect(JobsScheduler.windows(request)[0].start == monday)
    }

    @Test func timeOffBooksAPerson() {
        let away = person(#"""
        {"id":"u1","name":"Ada","department":"Wire","userRole":"user",
         "timeOff":[{"start":"2026-03-02","end":"2026-03-06","type":"PTO"}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [], people: [away], context: request.rule))
        let found = JobsScheduler.windows(request)
        #expect(found[0].start == monday)          // Bob can still take it
        #expect(found[0].busy == ["u1"])
    }

    /// Busy is the shared overlap rule, on hours: an unestimated booking holds
    /// ONE productive day per person, however many dates it spans — so a
    /// three-date booking with no `hpd` only blocks its first day.
    @Test func aBookingHoldsItsHoursNotItsDates() {
        let booked = job(#"""
        {"id":"other","title":"Other","subs":[{"id":"bp","title":"BP","subs":[
         {"id":"bo","title":"Busy","start":"2026-03-02","end":"2026-03-04",
          "team":["u1","u2"],"status":"In Progress"}]}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [booked], people: [], context: request.rule))
        #expect(JobsScheduler.windows(request)[0].start == "2026-03-03")
    }

    /// The run's own placements count. One person, two units over the same
    /// candidate range: they land on different days, never both on one.
    @Test func oneRunNeverDoubleBooksItsOwnPerson() {
        let found = JobsScheduler.windows(.init(units: twoOps, crew: [crew[0]], today: monday))
        let placed = found[0].placements
        #expect(placed.map(\.team) == [["u1"], ["u1"]])
        #expect(placed[0].start == monday)
        #expect(placed[1].start == "2026-03-03")
        // And by the shared rule itself, the two do not overlap.
        let rule = JobsScheduler.Request(units: [], crew: [], today: monday).rule
        let units = placed.map {
            OverlapRule.Unit(id: $0.unitID, start: $0.start, end: $0.end, startHour: nil,
                             hpd: 7.5, team: $0.team)
        }
        #expect(OverlapRule.overlaps(units[1], with: [units[0]], context: rule).isEmpty)
    }

    @Test func nothingToScheduleOffersNothing() {
        #expect(JobsScheduler.windows(.init(units: [], crew: crew, today: monday)).isEmpty)
        #expect(JobsScheduler.windows(.init(units: twoOps, crew: [], today: monday)).isEmpty)
    }

    // MARK: Applying

    @Test func applyingAWindowDatesAndAssignsEverything() {
        var target = job(#"""
        {"id":"j","title":"J","scheduledLater":true,"subs":[{"id":"p","title":"P","subs":[
         {"id":"o1","title":"One","hpd":7.5},{"id":"o2","title":"Two","hpd":7.5}]}]}
        """#)
        let window = JobsScheduler.windows(.init(units: twoOps, crew: crew, today: monday))[0]
        target = JobsScheduler.applying(window, to: target)

        #expect(target.subs[0].subs[0].start == monday)
        #expect(target.subs[0].subs[1].start == "2026-03-03")
        #expect(target.subs[0].subs.allSatisfy { $0.team.count == 1 })
        // A panel with operations takes THEIR outer span, so the grid's panel row
        // agrees with its children.
        #expect(target.subs[0].start == monday && target.subs[0].end == "2026-03-03")
        #expect(target.start == monday && target.end == "2026-03-03")
        // It has left TRAQS Cloud. Removed, not written false — the list tests
        // the key's truthiness.
        #expect(target.extras["scheduledLater"] == nil)
        #expect(!target.team.isEmpty)
    }

    /// THE ID-DRIFT BUG. `expandedPanels` mints a fresh id for every quantity
    /// copy after the first, so the job the windows were computed against and a
    /// second `build()` do not share operation ids. Applying to the second one
    /// dated the first copy and left the rest blank — a `qty: 12` job came out
    /// with one panel scheduled and eleven empty.
    @Test func placementsOnlyApplyToTheJobTheyWereComputedFor() {
        func makeJob() -> Job {
            var j = job(#"{"id":"j","title":"J","subs":[]}"#)
            for i in 0..<2 {
                var panel = Panel.empty(id: i == 0 ? "p-stable" : UUID().uuidString,
                                        title: "Bay-\(i)", hpd: 7.5)
                panel.subs = [Operation.empty(id: i == 0 ? "o-stable" : UUID().uuidString,
                                              title: "Op", hpd: 7.5)]
                j.subs.append(panel)
            }
            return j
        }
        let checked = makeJob()
        let window = JobsScheduler.windows(.init(
            units: JobsScheduler.units(of: checked, productiveHoursPerDay: 7.5),
            crew: crew, today: monday))[0]
        #expect(window.placements.count == 2)

        let dated = { (j: Job) in j.subs.flatMap { $0.subs }.filter { !$0.start.isEmpty }.count }
        #expect(dated(JobsScheduler.applying(window, to: makeJob())) == 1)   // the bug
        #expect(dated(JobsScheduler.applying(window, to: checked)) == 2)     // the fix
    }
}
