import Testing
import Foundation
@testable import TRAQS_Scheduling

// #523. Job, Panel and Operation already keep the keys they don't model (JSONExtras), but
// the structs NESTED inside them did not: an engineering sign-off, a move-log entry, a
// panel attachment, a finish-request stamp and history entry each decoded a fixed key set
// and re-encoded only that — and `saveJobs` / `saveGroups` POST the whole array. Each
// key below is one iOS doesn't model, at the level where it lives.
@Suite("Nested job-tree and group fields survive an iOS round-trip")
struct NestedPassthroughTests {
    static let stamp = #"{"requestId":"r1","by":"7","byName":"Caleb","at":"2026-10-01","hours":3.5}"#
    static let entries = #"[{"id":"r1","by":"7","byName":"Caleb","at":"2026-10-01","status":"pending","reqHours":2}]"#
    static let move = #"[{"fromStart":"2026-10-01","fromEnd":"2026-10-02","toStart":"2026-10-03","toEnd":"2026-10-04","date":"2026-10-01","movedBy":"Trey","fromStartHour":9,"toTeam":["7"]}]"#

    static let json = """
    [{"id":"j1","title":"Job","start":"2026-10-01","end":"2026-10-09","status":"In Progress","pri":"High","team":[],"hpd":0,
      "moveLog":\(move),"finishRequest":\(stamp),"finishRequests":\(entries),
      "subs":[{"id":"p1","title":"Panel","start":"2026-10-01","end":"2026-10-09","status":"In Progress","pri":"High","team":[],"hpd":0,
               "engineering":{"designed":{"by":"7","byName":"Caleb","at":"2026-10-01","note":"ok"},"reviewer":"Max"},
               "attachments":[{"key":"k1","filename":"a.pdf","thumbKey":"t1"}],
               "finishRequest":\(stamp),"finishRequests":\(entries),
               "subs":[{"id":"o1","title":"Op","start":"2026-10-01","end":"2026-10-02","status":"In Progress","pri":"High","team":[],"hpd":4,
                        "moveLog":\(move),"finishRequest":\(stamp),"finishRequests":\(entries)}]}]}]
    """

    static func roundTrip() throws -> (job: [String: Any], panel: [String: Any], op: [String: Any]) {
        let jobs = try JSONDecoder().decode([Job].self, from: Data(json.utf8))
        let out = try JSONSerialization.jsonObject(with: try JSONEncoder().encode(jobs)) as? [[String: Any]]
        let job = try #require(out?.first)
        let panel = try #require((job["subs"] as? [[String: Any]])?.first)
        let op = try #require((panel["subs"] as? [[String: Any]])?.first)
        return (job, panel, op)
    }

    static func first(_ node: [String: Any], _ key: String) -> [String: Any]? {
        (node[key] as? [[String: Any]])?.first
    }

    @Test("move-log entries keep the fields iOS doesn't model (job and op)")
    func moveLog() throws {
        let t = try Self.roundTrip()
        for (level, node) in [("job", t.job), ("op", t.op)] {
            let e = Self.first(node, "moveLog")
            #expect(e?["fromStartHour"] as? Double == 9, "\(level)")
            #expect(e?["toTeam"] as? [String] == ["7"], "\(level)")
        }
    }

    @Test("finish-request stamps and history keep the fields iOS doesn't model (all three levels)")
    func finishRequests() throws {
        let t = try Self.roundTrip()
        for (level, node) in [("job", t.job), ("panel", t.panel), ("op", t.op)] {
            #expect((node["finishRequest"] as? [String: Any])?["hours"] as? Double == 3.5, "\(level) stamp")
            #expect(Self.first(node, "finishRequests")?["reqHours"] as? Double == 2, "\(level) history")
        }
    }

    @Test("engineering keeps its unmodelled keys, and so does each sign-off")
    func engineering() throws {
        let eng = try #require(try Self.roundTrip().panel["engineering"] as? [String: Any])
        #expect(eng["reviewer"] as? String == "Max")
        #expect((eng["designed"] as? [String: Any])?["note"] as? String == "ok")
    }

    @Test("panel attachments keep the fields iOS doesn't model")
    func attachments() throws {
        #expect(Self.first(try Self.roundTrip().panel, "attachments")?["thumbKey"] as? String == "t1")
    }

    @Test("a chat group keeps the fields iOS doesn't model")
    func chatGroup() throws {
        let json = #"[{"id":"g1","name":"Crew","memberIds":["7","9"],"createdBy":"7","pinned":true}]"#
        let groups = try JSONDecoder().decode([ChatGroup].self, from: Data(json.utf8))
        let out = try JSONSerialization.jsonObject(with: try JSONEncoder().encode(groups)) as? [[String: Any]]
        #expect(out?.first?["pinned"] as? Bool == true)
        #expect(out?.first?["memberIds"] as? [String] == ["7", "9"])
    }
}
