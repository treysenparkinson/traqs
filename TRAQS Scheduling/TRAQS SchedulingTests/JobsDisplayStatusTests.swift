import Testing
import Foundation
@testable import TRAQS_Scheduling

// What the grid's Status pill SHOWS, which is not always what the row stores —
// `getOpDisplayStatus` / `getPanelDisplayStatus`.
//
// This suite exists because of a bug report: "pressing the dropdown options
// aren't changing when clicked". The write was landing; the pill could not move,
// because the derivation outranked the stored status on every panel and on every
// operation with hours against it. The web has the same order and the same dead
// control. The rule here deliberately does not — see `JobsStatusRollup.display`.
//
// So half of these are parity tests and half pin the divergence. They are marked.
@Suite("Displayed status")
struct JobsDisplayStatusTests {

    private func job(_ json: String) -> Job {
        try! JSONDecoder().decode(Job.self, from: json.data(using: .utf8)!)
    }

    /// What the pill reads for one row id.
    private func shown(_ job: Job, _ id: String,
                       clocked: Set<String> = []) -> String {
        let index = JobsDisplayStatus.index(
            for: [job],
            logged: { $0.loggedHours ?? 0 },
            clockedOn: { clocked.contains($0) })
        return index.status(id, fallback: stored(job, id)).label
    }

    private func stored(_ job: Job, _ id: String) -> JobStatus {
        if job.id == id { return job.status }
        for panel in job.subs {
            if panel.id == id { return panel.status }
            for op in panel.subs where op.id == id { return op.status }
        }
        return .notStarted
    }

    /// One panel, two operations, one of which has hours banked against it and
    /// nobody on it — the shape the report was about.
    private var tree: Job {
        job("""
        {"id":"j1","title":"Job","status":"Not Started","subs":[
          {"id":"p1","title":"Panel","status":"Not Started","subs":[
            {"id":"o1","title":"Op 1","status":"Not Started","loggedHours":3},
            {"id":"o2","title":"Op 2","status":"Not Started"}]}]}
        """)
    }

    // MARK: The derivation — parity with the web

    @Test func hoursWithNobodyOnItReadPaused() {
        #expect(shown(tree, "o1") == "Paused")
        #expect(shown(tree, "o2") == "Not Started")
    }

    @Test func aLiveClockReadsInProgress() {
        #expect(shown(tree, "o1", clocked: ["o1"]) == "In Progress")
    }

    @Test func aPanelWithNoPickRollsUpItsOperations() {
        let mixed = job("""
        {"id":"j","title":"J","status":"Not Started","subs":[
          {"id":"p1","title":"P","status":"Not Started","subs":[
            {"id":"o1","title":"A","status":"Finished"},
            {"id":"o2","title":"B","status":"On Hold"}]}]}
        """)
        #expect(shown(mixed, "p1") == "On Hold")
    }

    // Objective, and first in the order: a finished operation with hours on it is
    // not "Paused", and a panel whose operations are all done is done.
    @Test func finishedOutranksEverything() {
        let done = job("""
        {"id":"j","title":"J","status":"Not Started","subs":[
          {"id":"p1","title":"P","status":"In Progress","subs":[
            {"id":"o1","title":"A","status":"Finished","loggedHours":4},
            {"id":"o2","title":"B","status":"Finished"}]}]}
        """)
        #expect(shown(done, "o1") == "Finished")
        // Even though somebody left the panel on "In Progress".
        #expect(shown(done, "p1") == "Finished")
    }

    // MARK: A picked status is visible — THE DIVERGENCE
    //
    // The web's order is `Finished > (logged > 0 ? clocked : Paused) > stored` for
    // an operation, and for a panel with operations it ignores `panel.status`
    // outright. Both make the grid's status dropdown write a value nothing ever
    // displays. These four are the reason the rule differs.

    @Test func pickingAStatusOnAWorkedOperationShows() {
        #expect(shown(tree, "o1") == "Paused")
        let picked = JobsEdit.apply(.status(.onHold),
                                    at: .operation(panel: "p1", op: "o1"), in: tree)
        #expect(shown(picked, "o1") == "On Hold")   // the web still says "Paused"
    }

    @Test func pickingAStatusOnAPanelShows() {
        #expect(shown(tree, "p1") == "Paused")
        let picked = JobsEdit.apply(.status(.inProgress), at: .panel("p1"), in: tree)
        #expect(shown(picked, "p1") == "In Progress")  // the web still rolls up
    }

    @Test func aJobAlwaysShowsWhatItStores() {
        let picked = JobsEdit.apply(.status(.onHold), at: .job, in: tree)
        #expect(shown(picked, "j1") == "On Hold")
    }

    /// A clock is fact about right now and outranks an intention.
    @Test func aLiveClockStillBeatsAPickedStatus() {
        let picked = JobsEdit.apply(.status(.onHold),
                                    at: .operation(panel: "p1", op: "o1"), in: tree)
        #expect(shown(picked, "o1", clocked: ["o1"]) == "In Progress")
    }

    /// A clock naming the PANEL rather than one of its operations. The web drops
    /// this case: with operations present it rolls them up and never consults the
    /// panel's own clock, so a panel being worked directly reads "Paused".
    @Test func aPanelLevelClockMarksThePanel() {
        #expect(shown(tree, "p1", clocked: ["p1"]) == "In Progress")
    }

    // MARK: Paused is display-only

    /// It is not in `STATUSES`, nothing writes it, and it must never appear in a
    /// picker — which is why it is not a `JobStatus` case.
    @Test func pausedIsNotAStatusAnybodyCanPick() {
        #expect(!JobStatus.allCases.contains { $0.rawValue == "Paused" })
        #expect(JobsDisplayStatus.paused.stored == nil)
        // `DEFAULT_STA_C` / `DEFAULT_STA_ICON` give it On Hold's amber and glyph.
        #expect(JobsDisplayStatus.paused.hex == "#f59e0b")
        #expect(JobsDisplayStatus.paused.label == "Paused")
    }

    /// A row the walk never reached reads its own stored status rather than a
    /// default — an id from another page, or one that has gone away since.
    @Test func anUnknownRowFallsBackToItsStoredStatus() {
        let index = JobsDisplayStatus.Index()
        #expect(index.status("nope", fallback: .onHold) == .stored(.onHold))
    }
}
