import Testing
import Foundation
@testable import TRAQS_Scheduling

// #522. An iOS roster save (`savePeople`: the Team editor, and the push-token path's
// fallback) POSTs every person, and people.js stores what arrives except for the few
// fields it pins (PIN, clock state, push token, reqId-linked PTO). So a person decoded
// into something narrower than the stored record loses the rest for every client.
// These decode a stored person, encode it again, and require what iOS didn't change to
// come back as it went in.
@Suite("Person survives an iOS roster round-trip")
struct PersonRoundTripTests {
    /// A record as the web stores it: role and department DIFFERENT (an org-chart drag
    /// writes role only), a field iOS doesn't model, both newer timeclock permissions,
    /// and a PTO entry carrying fields iOS doesn't model.
    static let json = """
    [{"id":"7","name":"Caleb","role":"Welder","department":"Assembly","email":"c@x.com",
      "cap":8,"color":"#123456","userRole":"admin","shirtSize":"L",
      "adminPerms":{"editJobs":true,"moveJobs":true,"reassign":true,"manageTeam":true,
                    "manageClients":true,"undoHistory":true,"orgSettings":true,
                    "approveCompletions":true,"approveTimeOff":true,
                    "manageTimeclock":true,"confirmTimesheet":true},
      "timeOff":[{"start":"2026-11-02","end":"2026-11-03","type":"PTO",
                  "status":"approved","note":"Hunting"}]}]
    """

    static func decode() throws -> Person {
        try #require(try JSONDecoder().decode([Person].self, from: Data(json.utf8)).first)
    }

    static func encode(_ p: Person) throws -> [String: Any] {
        let out = try JSONEncoder().encode([p])
        let arr = try #require(try JSONSerialization.jsonObject(with: out) as? [[String: Any]])
        return try #require(arr.first)
    }

    @Test("iOS still reads the department as the person's role")
    func readsDepartmentFirst() throws {
        #expect(try Self.decode().role == "Assembly")
    }

    @Test("a field iOS doesn't model is written back")
    func unmodelledFieldSurvives() throws {
        #expect(try Self.encode(Self.decode())["shirtSize"] as? String == "L")
    }

    @Test("role and department go back as stored when iOS didn't change them")
    func roleAndDepartmentUntouched() throws {
        let out = try Self.encode(Self.decode())
        #expect(out["role"] as? String == "Welder")
        #expect(out["department"] as? String == "Assembly")
    }

    @Test("an iOS department edit writes both role and department")
    func iosEditWritesBoth() throws {
        var p = try Self.decode()
        p.role = "Paint"
        let out = try Self.encode(p)
        #expect(out["role"] as? String == "Paint")
        #expect(out["department"] as? String == "Paint")
    }

    @Test("permissions iOS doesn't model are not revoked")
    func newerPermissionsSurvive() throws {
        let perms = try #require(try Self.encode(Self.decode())["adminPerms"] as? [String: Any])
        #expect(perms["manageTimeclock"] as? Bool == true)
        #expect(perms["confirmTimesheet"] as? Bool == true)
        #expect(perms["editJobs"] as? Bool == true)
    }

    @Test("an ABSENT approval key stays absent and reads as not granted, as can() does")
    func absentPermissionIsNotGranted() throws {
        let json = #"[{"id":"9","name":"Max","role":"","userRole":"admin","adminPerms":{"editJobs":true}}]"#
        let p = try #require(try JSONDecoder().decode([Person].self, from: Data(json.utf8)).first)
        #expect(p.adminPerms?.approveTimeOff == false)
        #expect(p.adminPerms?.approveCompletions == false)
        let perms = try #require(try Self.encode(p)["adminPerms"] as? [String: Any])
        #expect(perms["approveTimeOff"] == nil)
        #expect(perms["approveCompletions"] == nil)
    }

    // #149 — the web can only start giving time-off entries ids once a native roster
    // save carries them back. `id` is the risky key: the Swift type has a COMPUTED `id`
    // (Identifiable), so a model that named it would read the span and write that.
    @Test("#149 a time-off entry's stored id survives a roster save, and is its identity")
    func timeOffIdSurvives() throws {
        let json = #"[{"id":"7","name":"W","role":"","timeOff":[{"id":"to_a","start":"2026-11-02","end":"2026-11-02","type":"PTO"},{"id":"to_b","start":"2026-11-02","end":"2026-11-02","type":"PTO"},{"start":"2026-12-01","end":"2026-12-02","type":"UTO"}]}]"#
        let p = try #require(try JSONDecoder().decode([Person].self, from: Data(json.utf8)).first)
        #expect(p.timeOff.map(\.id) == ["to_a", "to_b", "2026-12-01-2026-12-02-UTO"])
        let out = try #require(Self.encode(p)["timeOff"] as? [[String: Any]])
        #expect(out.map { $0["id"] as? String } == ["to_a", "to_b", nil])
        #expect(out.first?["start"] as? String == "2026-11-02")
    }

    @Test("a PTO entry keeps the fields iOS doesn't model")
    func timeOffEntrySurvives() throws {
        let off = try #require((try Self.encode(Self.decode())["timeOff"] as? [[String: Any]])?.first)
        #expect(off["status"] as? String == "approved")
        #expect(off["note"] as? String == "Hunting")
        #expect(off["start"] as? String == "2026-11-02")
    }
}
