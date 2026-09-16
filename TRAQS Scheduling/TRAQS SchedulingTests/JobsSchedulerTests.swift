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
        """#), orgHpd: 7.5, departmentNames: [])
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
        #expect(JobsScheduler.durationDays(hpd: 7.5, orgHpd: 7.5) == 1)
        #expect(JobsScheduler.durationDays(hpd: 15, orgHpd: 7.5) == 2)
        #expect(JobsScheduler.durationDays(hpd: 40, orgHpd: 7.5) == 6)
        // Never zero — a unit always occupies a day.
        #expect(JobsScheduler.durationDays(hpd: 0, orgHpd: 7.5) == 1)
    }

    /// "Panels with sub-ops → sub-ops are assignable. Panels without → the panel
    /// itself is." Untitled rows are skipped.
    @Test func assignableUnitsAreTheLeaves() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[
         {"id":"p1","title":"Panel","subs":[{"id":"o1","title":"Wire","hpd":7.5}]},
         {"id":"p2","title":"Leaf","hpd":7.5,"subs":[]},
         {"id":"p3","title":"","subs":[]}]}
        """#), orgHpd: 7.5, departmentNames: [])
        #expect(units.map(\.id) == ["o1", "p2"])
    }

    /// `deptOfUnit` — own, then panel's, then job's, then the TITLE when it
    /// names a known department. The title fallback is what makes FAST TRAQS
    /// imports schedule by department at all.
    @Test func departmentFallsBackThroughToTheTitle() {
        let known: Set<String> = ["wire", "fab"]
        #expect(JobsScheduler.department(of: "Wire", own: "Own", panel: "P",
                                         job: "J", known: known) == "Own")
        #expect(JobsScheduler.department(of: "Wire", own: "", panel: "P",
                                         job: "J", known: known) == "P")
        #expect(JobsScheduler.department(of: "Wire", own: "", panel: "",
                                         job: "J", known: known) == "J")
        #expect(JobsScheduler.department(of: "Wire", own: "", panel: "",
                                         job: "", known: known) == "Wire")
        #expect(JobsScheduler.department(of: "Nonsense", own: "", panel: "",
                                         job: "", known: known) == "")
    }

    @Test func dependenciesAreWorkedFirst() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"c","title":"C","deps":["b"]},
         {"id":"b","title":"B","deps":["a"]},
         {"id":"a","title":"A"}]}]}
        """#), orgHpd: 7.5, departmentNames: [])
        #expect(units.map(\.id) == ["a", "b", "c"])
    }

    /// A cycle in `deps` must not recurse forever — `visited` is marked on the
    /// way in.
    @Test func aDependencyCycleTerminates() {
        let units = JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"x","title":"X","deps":["y"]},{"id":"y","title":"Y","deps":["x"]}]}]}
        """#), orgHpd: 7.5, departmentNames: [])
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

    @Test func primaryDepartmentOutranksSecondary() {
        #expect(JobsScheduler.crew(for: "Wire", from: crew).map(\.id) == ["u1", "u2"])
        #expect(JobsScheduler.crew(for: "Fab", from: crew).map(\.id) == ["u2"])
    }

    /// "If nobody matches, fall back to ALL crew so the scheduler can still place
    /// the work somewhere instead of bailing with no windows."
    @Test func anUnstaffedDepartmentFallsBackToEveryone() {
        #expect(JobsScheduler.crew(for: "Nobody", from: crew).map(\.id) == ["u1", "u2"])
        #expect(JobsScheduler.crew(for: "", from: crew).map(\.id) == ["u1", "u2"])
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
          "team":["u1","u2"],"status":"In Progress"}]}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [booked], people: []))
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
            JobsScheduler.bookings(in: [done], people: []))
        #expect(JobsScheduler.windows(request)[0].start == monday)
    }

    /// `if (ed.id && job.id === ed.id) continue` — a job must not make its own
    /// people look busy while it is being rescheduled.
    @Test func theJobBeingScheduledDoesNotBlockItself() {
        let booked = job(#"""
        {"id":"other","title":"Other","subs":[{"id":"bp","title":"BP","subs":[
         {"id":"bo","title":"Busy","start":"2026-03-02","end":"2026-03-04",
          "team":["u1","u2"],"status":"In Progress"}]}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [booked], people: [], excluding: "other"))
        #expect(JobsScheduler.windows(request)[0].start == monday)
    }

    @Test func timeOffBooksAPerson() {
        let away = person(#"""
        {"id":"u1","name":"Ada","department":"Wire","userRole":"user",
         "timeOff":[{"start":"2026-03-02","end":"2026-03-06","type":"PTO"}]}
        """#)
        var request = JobsScheduler.Request(units: twoOps, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: [], people: [away]))
        let found = JobsScheduler.windows(request)
        #expect(found[0].start == monday)          // Bob can still take it
        #expect(found[0].busy == ["u1"])
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
            units: JobsScheduler.units(of: checked, orgHpd: 7.5, departmentNames: []),
            crew: crew, today: monday))[0]
        #expect(window.placements.count == 2)

        let dated = { (j: Job) in j.subs.flatMap { $0.subs }.filter { !$0.start.isEmpty }.count }
        #expect(dated(JobsScheduler.applying(window, to: makeJob())) == 1)   // the bug
        #expect(dated(JobsScheduler.applying(window, to: checked)) == 2)     // the fix
    }
}
