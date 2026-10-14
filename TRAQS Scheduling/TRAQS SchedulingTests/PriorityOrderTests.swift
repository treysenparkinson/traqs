import Testing
import Foundation
@testable import TRAQS_Scheduling

// #542. The Jobs grid sorts priority by the ORG's order (`PRIORITIES`, from
// `orgSettings.priOpts`), as the web's `sortTasks` does — not by the three-case enum,
// under which every org priority read as `.medium` and tied in Medium's slot.
@Suite("Priority sorts by the org's list (#542)")
struct PriorityOrderTests {

    static func settings(_ json: String) throws -> OrgSettings {
        try JSONDecoder().decode(OrgSettings.self, from: Data(json.utf8))
    }

    static func job(_ id: String, pri: String) throws -> Job {
        let arr = try JSONDecoder().decode([Job].self, from: Data("""
        [{"id":"\(id)","title":"\(id)","start":"2026-10-01","end":"2026-10-09",
          "status":"In Progress","pri":"\(pri)","team":[],"color":"#123456","hpd":0,"subs":[]}]
        """.utf8))
        return try #require(arr.first)
    }

    @Test("the org's priOpts names, in order; the web's three defaults when unset")
    func names() throws {
        let s = try Self.settings(##"{"priOpts":[{"name":"Late","color":"#f00"},{"name":"On time"},{"name":"High"}]}"##)
        #expect(s.priorityNames == ["Late", "On time", "High"])
        #expect(try Self.settings("{}").priorityNames == ["Low", "Medium", "High"])
        #expect(try Self.settings(#"{"priOpts":[]}"#).priorityNames == ["Low", "Medium", "High"])
    }

    @Test("sorting by priority follows the org's order, including values the enum lacks")
    func sortsByOrgOrder() throws {
        let jobs = [try Self.job("a", pri: "High"), try Self.job("b", pri: "On time"),
                    try Self.job("c", pri: "Late")]
        let ctx = JobsQuery.Context(today: "2026-10-14", priorityOrder: ["Late", "On time", "High"])
        let asc = JobsQuery.sorted(jobs, by: JobsSort(column: .pri, ascending: true), context: ctx)
        #expect(asc.map(\.id) == ["c", "b", "a"])
        let desc = JobsQuery.sorted(jobs, by: JobsSort(column: .pri, ascending: false), context: ctx)
        #expect(desc.map(\.id) == ["a", "b", "c"])
    }

    @Test("with no org list the order is the web's default, Low before Medium before High")
    func defaultOrder() throws {
        let jobs = [try Self.job("h", pri: "High"), try Self.job("l", pri: "Low"),
                    try Self.job("m", pri: "Medium")]
        let asc = JobsQuery.sorted(jobs, by: JobsSort(column: .pri, ascending: true),
                                   context: JobsQuery.Context(today: "2026-10-14"))
        #expect(asc.map(\.id) == ["l", "m", "h"])
    }
}
