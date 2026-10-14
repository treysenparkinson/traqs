import Testing
import Foundation
@testable import TRAQS_Scheduling

// #504's iOS half. What a status MEANS (finished / in progress) comes from the org's
// `statusOpts` flags, not from `JobStatus(rawValue:)`'s spelling — so a renamed "Finished"
// is still finished on the phone, and every `status == .finished` follows it.
@Suite("Status meaning follows the org's list (#504)")
struct StatusMeaningTests {

    static func opts(_ json: String) -> [JSONValue] {
        (try? JSONDecoder().decode([JSONValue].self, from: Data(json.utf8))) ?? []
    }

    /// An org that renamed both rows, and kept a plain "Finished" that no longer means it.
    static let renamed = StatusMeaning(statusOpts: opts("""
    [{"name":"Not Started"},{"name":"Working","isActive":true},
     {"name":"Complete","isFinished":true},{"name":"Finished"},{"name":"In Progress"}]
    """))

    /// Every org's list today: no flags, so the names decide — normalised.
    static let unflagged = StatusMeaning(statusOpts: opts("""
    [{"name":"Not Started"},{"name":"In Progress"},{"name":"Finished"},{"name":"finished"},
     {"name":"Boxed up "}]
    """))

    static func op(_ status: String) throws -> TRAQS_Scheduling.Operation {
        try JSONDecoder().decode(TRAQS_Scheduling.Operation.self, from: Data("""
        {"id":"o1","title":"Op","start":"2026-10-01","end":"2026-10-02",
         "status":"\(status)","pri":"Medium","team":[],"hpd":4}
        """.utf8))
    }

    static func job(_ status: String) throws -> Job {
        let arr = try JSONDecoder().decode([Job].self, from: Data("""
        [{"id":"j1","title":"Job","start":"2026-10-01","end":"2026-10-09","status":"\(status)",
          "pri":"Medium","team":[],"color":"#123456","hpd":0,
          "subs":[{"id":"p1","title":"Panel","start":"2026-10-01","end":"2026-10-09",
                   "status":"\(status)","pri":"Medium","team":[],"hpd":0,"subs":[]}]}]
        """.utf8))
        return try #require(arr.first)
    }

    // MARK: The pure reader

    @Test("flags decide when the list carries them; the old spelling no longer means it")
    func flagsWin() {
        let m = Self.renamed
        #expect(m.isFinished("Complete"))
        #expect(!m.isFinished("Finished"))
        #expect(m.isActive("Working"))
        #expect(!m.isActive("In Progress"))
        #expect(m.finishedName == "Complete")
        #expect(m.activeName == "Working")
    }

    @Test("an unflagged list reads meaning from the normalised name")
    func byNameNormalised() {
        let m = Self.unflagged
        #expect(m.isFinished("finished"))
        #expect(m.isFinished("  Finished "))
        #expect(m.isActive("in  progress"))
        #expect(!m.isFinished("Boxed up"))
        #expect(m.finishedName == "Finished")
    }

    @Test("a status outside the list is decided by its name; no list writes the defaults")
    func outsideTheList() {
        #expect(Self.renamed.isFinished("FINISHED") == false)   // in the list (normalised), unflagged
        #expect(Self.renamed.isFinished("Shipped") == false)
        #expect(StatusMeaning.byName.isFinished("Finished"))
        #expect(StatusMeaning.byName.finishedName == "Finished")
        #expect(StatusMeaning.byName.activeName == "In Progress")
    }

    @Test("OrgSettings reads statusOpts out of the passthrough, and writes it back untouched")
    func orgSettingsCarriesTheList() throws {
        let json = ##"{"hpd":8,"statusOpts":[{"name":"Complete","color":"#0f0","isFinished":true}]}"##
        let s = try JSONDecoder().decode(OrgSettings.self, from: Data(json.utf8))
        #expect(StatusMeaning(statusOpts: s.statusOpts).finishedName == "Complete")
        let out = try JSONSerialization.jsonObject(with: JSONEncoder().encode(s)) as? [String: Any]
        let opts = try #require(out?["statusOpts"] as? [[String: Any]])
        #expect(opts.first?["isFinished"] as? Bool == true)
        #expect(opts.first?["color"] as? String == "#0f0")
    }

    /// The app installs the org's list when its settings arrive. Uses an UNFLAGGED list of the
    /// default names, which means exactly what "by name" means, so a suite running alongside on
    /// the shared store reads every status the same either way.
    @MainActor @Test("AppState installs the org's list whenever its settings change")
    func appStateInstalls() throws {
        let json = #"{"statusOpts":[{"name":"Finished"},{"name":"In Progress"}]}"#
        let s = try JSONDecoder().decode(OrgSettings.self, from: Data(json.utf8))
        let app = AppState()
        app.orgSettings = s
        #expect(StatusMeaning.current.entries.map(\.name) == ["Finished", "In Progress"])
        app.orgSettings = .default
        #expect(StatusMeaning.current.entries.isEmpty)
    }

    // MARK: The models read through it

    @Test("Operation.status reads the org's meaning, at every renamed spelling")
    func operationReads() throws {
        let complete = try Self.op("Complete"), working = try Self.op("Working")
        let finished = try Self.op("Finished"), lower = try Self.op("finished")
        StatusMeaning.$override.withValue(Self.renamed) {
            #expect(complete.status == .finished)
            #expect(working.status == .inProgress)
            #expect(finished.status != .finished)
            #expect(finished.statusKnown == nil)
        }
        StatusMeaning.$override.withValue(Self.unflagged) {
            #expect(lower.status == .finished)
        }
    }

    @Test("Job and Panel read it too")
    func jobAndPanelRead() throws {
        let j = try Self.job("Complete")
        StatusMeaning.$override.withValue(Self.renamed) {
            #expect(j.status == .finished)
            #expect(j.subs.first?.status == .finished)
        }
    }

    @Test("writing a meaning stores the org's name for it")
    func writesTheOrgsName() throws {
        let blank = try Self.op("Not Started"), working = try Self.job("Working")
        StatusMeaning.$override.withValue(Self.renamed) {
            var o = blank
            o.status = .finished
            #expect(o.statusRaw == "Complete")
            o.status = .inProgress
            #expect(o.statusRaw == "Working")
            o.status = .onHold
            #expect(o.statusRaw == "On Hold")
            var j = working
            j.status = .finished
            #expect(j.statusRaw == "Complete")
        }
        var o = try Self.op("Not Started")
        o.status = .finished
        #expect(o.statusRaw == "Finished")
    }

    @Test("a consumer follows: a renamed-finished op is finished to the overlap rule")
    func consumerFollows() throws {
        let complete = try Self.op("Complete"), finished = try Self.op("Finished")
        StatusMeaning.$override.withValue(Self.renamed) {
            #expect(OverlapRule.Unit(complete).finished)
            #expect(!OverlapRule.Unit(finished).finished)
        }
    }
}
