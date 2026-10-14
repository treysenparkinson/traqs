import Testing
import Foundation
@testable import TRAQS_Scheduling

// #544. The Mac grid's status popover offers the ORG's list — all seventeen at
// Matrix — and writes whichever name is picked, as stored. It offered the five
// `JobStatus` names, so `MTX FAT` was not on it and a job could only be moved to
// one of the five.
@Suite("Status picker offers the org's list (#544)")
struct StatusPickerTests {

    static func settings(_ json: String) throws -> OrgSettings {
        try JSONDecoder().decode(OrgSettings.self, from: Data(json.utf8))
    }

    static let matrixish = ##"""
    {"statusOpts":[{"name":"Not Started","color":"#94a3b8","icon":"○"},
                   {"name":"In Progress"},{"name":"MTX FAT","color":"#123456","icon":"◆"},
                   {"name":"Finished"},{"name":"Shipped/ invoiced"}]}
    """##

    @Test("the org's list, in its order, with its colours and glyphs")
    func orgList() throws {
        let c = try Self.settings(Self.matrixish).statusChoices
        #expect(c.map(\.name) == ["Not Started", "In Progress", "MTX FAT", "Finished", "Shipped/ invoiced"])
        #expect(c[2].color == "#123456")
        #expect(c[2].icon == "◆")
        #expect(c[1].color == nil)
    }

    @Test("no list (or an empty one) offers the web's five defaults")
    func defaults() throws {
        let five = ["Not Started", "Pending", "In Progress", "On Hold", "Finished"]
        #expect(try Self.settings("{}").statusChoices.map(\.name) == five)
        #expect(try Self.settings(#"{"statusOpts":[]}"#).statusChoices.map(\.name) == five)
    }

    @Test("picking an org status writes it as stored, at every level")
    func writesTheName() throws {
        let job = try #require(try JSONDecoder().decode([Job].self, from: Data("""
        [{"id":"j1","title":"J","start":"2026-10-01","end":"2026-10-09","status":"In Progress",
          "pri":"Medium","team":[],"color":"#123456","hpd":0,
          "subs":[{"id":"p1","title":"P","start":"2026-10-01","end":"2026-10-09",
                   "status":"In Progress","pri":"Medium","team":[],"hpd":0,
                   "subs":[{"id":"o1","title":"O","start":"2026-10-01","end":"2026-10-02",
                            "status":"In Progress","pri":"Medium","team":[],"hpd":4}]}]}]
        """.utf8)).first)
        #expect(JobsEdit.apply(.status("MTX FAT"), at: .job, in: job).statusRaw == "MTX FAT")
        let rows = JobGridRow.flatten([job], expanded: ["j1", "p1"])
        let op = try #require(rows.last)
        let out = JobsEdit.apply(.status("Shipped/ invoiced"), at: op.editPath, in: job)
        #expect(out.subs[0].subs[0].statusRaw == "Shipped/ invoiced")
        #expect(op.statusRaw == "In Progress")
    }

    @Test("the completion gate asks what the pick MEANS: a renamed finished needs a request")
    func gateReadsMeaning() {
        let renamed = StatusMeaning(statusOpts: [
            .object(["name": .string("Complete"), "isFinished": .bool(true)]),
            .object(["name": .string("Finished")]),
        ])
        StatusMeaning.$override.withValue(renamed) {
            #expect(JobsEdit.needsCompletionRequest("Complete", isAdmin: false))
            #expect(!JobsEdit.needsCompletionRequest("Finished", isAdmin: false))
            #expect(!JobsEdit.needsCompletionRequest("Complete", isAdmin: true))
        }
        StatusMeaning.$override.withValue(.byName) {
            #expect(JobsEdit.needsCompletionRequest("finished", isAdmin: false))
            #expect(!JobsEdit.needsCompletionRequest("MTX FAT", isAdmin: false))
        }
    }
}
