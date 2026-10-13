import Testing
import Foundation
@testable import TRAQS_Scheduling

// #302 — crew scheduling. The New Job wizard's scheduler put ONE person on every unit and
// sized it for one, overwriting a multi-person team from the form. Built on three rulings
// (Trey, 2026-10-13):
//
//   1. HOURS SPLIT EVENLY. `hpd` is the op's total for the whole team (#212, root cause 5):
//      two people on a 15h op is 7.5h each, and the span is sized to that share.
//   2. EVERYONE IN THE CREW MATCHES THE DEPARTMENT. The requirement is about who may do the
//      work, not who leads it — one out-of-department member is the same violation as a
//      single out-of-department assignee.
//   3. PLACE WHO'S FREE, REPORT WHO WASN'T. One booked person does not refuse the crew, and
//      nobody the form named is dropped without a reason.
@Suite("Crew scheduling (#302)")
struct CrewSchedulingTests {
    private func job(_ json: String) -> Job {
        try! JSONDecoder().decode(Job.self, from: json.data(using: .utf8)!)
    }
    private func person(_ json: String) -> Person {
        try! JSONDecoder().decode(Person.self, from: json.data(using: .utf8)!)
    }

    /// 2026-03-02 is a Monday.
    private let monday = "2026-03-02"
    private var crew: [Person] {
        [person(#"{"id":"u1","name":"Ada","department":"Wire","userRole":"user"}"#),
         person(#"{"id":"u2","name":"Bob","department":"Fab","secondaryDepartment":"Wire","userRole":"user"}"#),
         person(#"{"id":"u3","name":"Cy","department":"Cut","userRole":"user"}"#)]
    }

    /// One op (15 hours unless said) in a 7.5-hour productive day, with whatever team and
    /// department.
    private func units(team: [String], department: String? = nil, hpd: Double = 15) -> [SchedulableUnit] {
        let teamJSON = team.map { "\"\($0)\"" }.joined(separator: ",")
        let dept = department.map { #","requiredDepartment":"\#($0)""# } ?? ""
        return JobsScheduler.units(of: job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"o","title":"Op","hpd":\#(hpd),"team":[\#(teamJSON)]\#(dept)}]}]}
        """#), productiveHoursPerDay: 7.5)
    }

    private func first(_ units: [SchedulableUnit], bookings: [Job] = []) -> ScheduleWindow? {
        var request = JobsScheduler.Request(units: units, crew: crew, today: monday)
        request.bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: bookings, people: [], context: request.rule))
        return JobsScheduler.windows(request).first
    }

    // MARK: 1 — hours split evenly

    @Test("the form's crew is placed together, sized to each person's share")
    func crewPlacedTogether() throws {
        let place = try #require(first(units(team: ["u1", "u2"]))?.placements.first)
        #expect(place.team == ["u1", "u2"])
        // 15h ÷ 2 = 7.5h each: one productive day, not the two one person needs.
        #expect(place.start == monday && place.end == monday)
        #expect(place.left.isEmpty)
    }

    @Test("each member HOLDS only their share of the day, not the whole op")
    func eachHoldsTheirShare() throws {
        // Ada is already booked 13:00–14:00 Monday. A crew of two on a 7.5h op each holds
        // ~3.75h from the start of the day, clear of it; holding the whole 7.5h would not be.
        let afternoon = job(#"""
        {"id":"other","title":"Other","subs":[{"id":"bp","title":"BP","subs":[
         {"id":"bo","title":"Busy","start":"2026-03-02","end":"2026-03-02","startHour":13,
          "team":["u1"],"status":"In Progress","hpd":1}]}]}
        """#)
        let window = try #require(first(units(team: ["u1", "u2"], hpd: 7.5), bookings: [afternoon]))
        #expect(window.start == monday)
        #expect(window.placements.first?.team == ["u1", "u2"])
        #expect(window.placements.first?.left == [])
    }

    @Test("with no crew on the form it is still one person, sized for one")
    func noCrewIsOnePerson() throws {
        let place = try #require(first(units(team: []))?.placements.first)
        #expect(place.team.count == 1)
        #expect(place.end == "2026-03-03")
    }

    // MARK: 2 — everyone matches the department

    @Test("a crew member outside the op's department is not placed, and is named")
    func outOfDepartmentIsLeftAndNamed() throws {
        let place = try #require(first(units(team: ["u1", "u3"], department: "Wire"))?.placements.first)
        #expect(place.team == ["u1"])
        #expect(place.left == [CrewGap(personID: "u3", reason: .department)])
        // Sized for the one who is on it.
        #expect(place.end == "2026-03-03")
    }

    @Test("a secondary department counts")
    func secondaryCounts() throws {
        let place = try #require(first(units(team: ["u1", "u2"], department: "Wire"))?.placements.first)
        #expect(place.team == ["u1", "u2"])
    }

    @Test("a crew none of whom match is unstaffable — named, not placed")
    func nobodyMatches() {
        let u = units(team: ["u3"], department: "Wire")
        #expect(JobsScheduler.unstaffable(u, crew: crew).map(\.id) == ["o"])
        #expect(first(u) == nil)
    }

    // MARK: 3 — place who's free, report who wasn't

    @Test("one booked member does not refuse the crew: the free one is placed, the busy one named")
    func partialAvailability() throws {
        let booked = job(#"""
        {"id":"other","title":"Other","subs":[{"id":"bp","title":"BP","subs":[
         {"id":"bo","title":"Busy","start":"2026-03-02","end":"2026-03-04",
          "team":["u2"],"status":"In Progress","hpd":60}]}]}
        """#)
        let window = try #require(first(units(team: ["u1", "u2"]), bookings: [booked]))
        let place = try #require(window.placements.first)
        #expect(window.start == monday)
        #expect(place.team == ["u1"])
        #expect(place.left == [CrewGap(personID: "u2", reason: .busy)])
        // Resized: Ada carries the whole 15h alone.
        #expect(place.end == "2026-03-03")
    }

    @Test("a crew member who isn't on the schedulable roster is named, not silently dropped")
    func offRosterIsNamed() throws {
        let place = try #require(first(units(team: ["u1", "gone"]))?.placements.first)
        #expect(place.team == ["u1"])
        #expect(place.left == [CrewGap(personID: "gone", reason: .notSchedulable)])
    }

    // MARK: Applying

    @Test("Use This Schedule writes the whole crew onto the op")
    func applyingWritesTheCrew() throws {
        let window = try #require(first(units(team: ["u1", "u2"])))
        let target = job(#"""
        {"id":"j","title":"J","subs":[{"id":"p","title":"P","subs":[
         {"id":"o","title":"Op","hpd":15,"team":["u1","u2"]}]}]}
        """#)
        let applied = JobsScheduler.applying(window, to: target)
        #expect(applied.subs[0].subs[0].team == ["u1", "u2"])
        #expect(applied.subs[0].subs[0].hpd == 15)   // the total stays the total
    }
}
