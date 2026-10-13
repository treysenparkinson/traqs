import Testing
import Foundation
@testable import TRAQS_Scheduling

// #447 / #458 / #518. `saveJobs` re-encodes the WHOLE job array and POSTs it, so any
// field a model decodes into something narrower than the data — an enum with a
// fallback — is rewritten for every client by every iOS or Mac save. These decode a
// real job tree, encode it again, and require each such field to come back as it
// went in, at all three levels.
@Suite("Job tree survives an iOS round-trip")
struct NarrowFieldRoundTripTests {
    /// Org-editable values iOS's enums have no case for.
    static let status = "MTX FAT"
    static let pri = "On time"

    static let json = """
    [{"id":"j1","title":"Job","start":"2026-10-01","end":"2026-10-09",
      "status":"\(status)","pri":"\(pri)","team":["7"],"color":"#123456","hpd":0,
      "subs":[{"id":"p1","title":"Panel","start":"2026-10-01","end":"2026-10-09",
               "status":"\(status)","pri":"\(pri)","team":["7"],"hpd":0,
               "subs":[{"id":"o1","title":"Op","start":"2026-10-01","end":"2026-10-02",
                        "status":"\(status)","pri":"\(pri)","team":["7"],"hpd":4}]}]}]
    """

    /// Decode, encode, and read the result back as plain JSON.
    static func roundTrip() throws -> [String: Any] {
        let jobs = try JSONDecoder().decode([Job].self, from: Data(json.utf8))
        let out = try JSONEncoder().encode(jobs)
        let arr = try #require(try JSONSerialization.jsonObject(with: out) as? [[String: Any]])
        return try #require(arr.first)
    }

    static func levels(_ job: [String: Any]) throws -> [(String, [String: Any])] {
        let panel = try #require((job["subs"] as? [[String: Any]])?.first)
        let op = try #require((panel["subs"] as? [[String: Any]])?.first)
        return [("job", job), ("panel", panel), ("op", op)]
    }

    @Test("status the enum has no case for is written back unchanged (#447)")
    func statusSurvives() throws {
        for (level, node) in try Self.levels(Self.roundTrip()) {
            #expect(node["status"] as? String == Self.status, "\(level) status")
        }
    }

    @Test("priority the enum has no case for is written back unchanged (#518)")
    func priSurvives() throws {
        for (level, node) in try Self.levels(Self.roundTrip()) {
            #expect(node["pri"] as? String == Self.pri, "\(level) pri")
        }
    }
}
