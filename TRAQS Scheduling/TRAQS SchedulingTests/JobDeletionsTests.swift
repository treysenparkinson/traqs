import Testing
import Foundation
@testable import TRAQS_Scheduling

// #291. iOS saved jobs by POSTing the WHOLE array, and the server reads a bare array as the
// whole world: every stored job absent from it is tombstoned. A phone that loaded at 09:00
// and saved at 09:30 deleted every job anyone created in between. The save is now the delta
// envelope the web already sends (#339): every job as an upsert, plus the ids THIS DEVICE
// deleted. A job the phone never saw is simply not mentioned, and the server leaves it alone.
@Suite("Job deletions (#291)")
struct JobDeletionsTests {

    private func job(_ id: String) -> Job { Job(id: id, title: id, start: "2026-10-01", end: "2026-10-01") }

    @Test func aJobTheUserRemovedIsADeletionToSend() {
        var d = JobDeletions()
        d.record(from: [job("a"), job("b")], to: [job("a")])
        #expect(d.pending == ["b"])
    }

    @Test func aJobThisDeviceNeverHadIsNeverADeletion() {
        // The whole point: "x" was created elsewhere after this phone loaded. Nothing the
        // user does here can put it in the delete list.
        var d = JobDeletions()
        d.record(from: [job("a")], to: [job("a"), job("c")])
        d.record(from: [job("a"), job("c")], to: [job("c")])
        #expect(d.pending == ["a"])
        #expect(!d.pending.contains("x"))
    }

    @Test func aJobThatComesBackIsNoLongerDeleted() {
        // Undo, or a rollback after a failed save, restores it.
        var d = JobDeletions()
        d.record(from: [job("a"), job("b")], to: [job("a")])
        d.record(from: [job("a")], to: [job("a"), job("b")])
        #expect(d.pending.isEmpty)
    }

    @Test func aConfirmedSaveClearsOnlyWhatItSent() {
        var d = JobDeletions()
        d.record(from: [job("a"), job("b"), job("c")], to: [job("c")])
        d.confirm(["a"])
        #expect(d.pending == ["b"])
    }

    @Test func resetForgetsEverything() {
        // Logout clears the jobs list; that is not the user deleting every job.
        var d = JobDeletions()
        d.record(from: [job("a")], to: [])
        d.reset()
        #expect(d.pending.isEmpty)
    }

    @Test func theSaveIsTheDeltaEnvelopeNotABareArray() throws {
        let body = try JobsSaveEnvelope(upsert: [job("a")], delete: ["b"]).encoded()
        let obj = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect((obj["upsert"] as? [[String: Any]])?.first?["id"] as? String == "a")
        #expect(obj["delete"] as? [String] == ["b"])
        // A bare array is what made absence mean deletion on the server.
        #expect((try? JSONSerialization.jsonObject(with: body)) as? [Any] == nil)
    }

    @Test func anEnvelopeWithNoDeletionsStillSaysDelete() throws {
        // The server detects the envelope by shape: `upsert` or `delete` present.
        let body = try JobsSaveEnvelope(upsert: [], delete: []).encoded()
        let obj = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(obj["delete"] as? [String] == [])
        #expect(obj["upsert"] as? [Any] != nil)
    }
}
