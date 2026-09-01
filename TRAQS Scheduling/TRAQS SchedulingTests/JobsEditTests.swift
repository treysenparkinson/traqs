import Testing
import Foundation
@testable import TRAQS_Scheduling

// `updTask(id, fields, pid)` — the Jobs grid's one write path, split into a path
// and a field. A wrong reach here silently rewrites the wrong operation, which is
// not something to discover from a screenshot.
@Suite("Jobs cell edits")
struct JobsEditTests {

    private var tree: Job {
        let data = try! JSONSerialization.data(withJSONObject: [
            "id": "j1", "title": "Job", "jobNumber": "1042",
            "start": "2026-03-01", "end": "2026-03-20", "dueDate": "2026-03-25",
            "status": "In Progress", "pri": "Medium",
            "subs": [
                ["id": "p1", "title": "Panel 1", "status": "Not Started", "pri": "Low",
                 "start": "2026-03-02", "end": "2026-03-05", "subs": [
                    ["id": "o1", "title": "Op 1", "status": "Not Started", "pri": "Low"],
                    ["id": "o2", "title": "Op 2", "status": "Not Started", "pri": "Low"],
                 ]],
                ["id": "p2", "title": "Panel 2", "subs": []],
            ],
        ])
        return try! JSONDecoder().decode(Job.self, from: data)
    }

    // MARK: The reach

    @Test func aJobEditTouchesOnlyTheJob() {
        let out = JobsEdit.apply(.title("Renamed"), at: .job, in: tree)
        #expect(out.title == "Renamed")
        #expect(out.subs[0].title == "Panel 1")
        #expect(out.subs[0].subs[0].title == "Op 1")
    }

    @Test func aPanelEditTouchesOnlyThatPanel() {
        let out = JobsEdit.apply(.title("Renamed"), at: .panel("p1"), in: tree)
        #expect(out.subs[0].title == "Renamed")
        #expect(out.subs[1].title == "Panel 2")
        #expect(out.title == "Job")
    }

    @Test func anOperationEditTouchesOnlyThatOperation() {
        let out = JobsEdit.apply(.status(.inProgress),
                                 at: .operation(panel: "p1", op: "o2"), in: tree)
        #expect(out.subs[0].subs[1].status == .inProgress)
        #expect(out.subs[0].subs[0].status == .notStarted)
        #expect(out.subs[0].status == .notStarted)
    }

    // A panel removed by an inbound sync between the click and the commit must not
    // take the rest of the tree with it.
    @Test func anUnresolvablePathLeavesTheJobUntouched() {
        #expect(JobsEdit.apply(.title("X"), at: .panel("gone"), in: tree) == tree)
        #expect(JobsEdit.apply(.title("X"),
                               at: .operation(panel: "p1", op: "gone"), in: tree) == tree)
        #expect(JobsEdit.apply(.title("X"),
                               at: .operation(panel: "gone", op: "o1"), in: tree) == tree)
    }

    // MARK: Fields that only a job has

    // The web stores "" and then prints "#" with nothing after it. `jobNumber` is
    // optional here, so an emptied field means absent.
    @Test func clearingTheJobNumberStoresNilNotAnEmptyString() {
        #expect(JobsEdit.apply(.jobNumber("   "), at: .job, in: tree).jobNumber == nil)
        #expect(JobsEdit.apply(.jobNumber(" 99 "), at: .job, in: tree).jobNumber == "99")
    }

    @Test func clearingTheDueDateStoresNil() {
        #expect(JobsEdit.apply(.dueDate(nil), at: .job, in: tree).dueDate == nil)
        #expect(JobsEdit.apply(.dueDate(""), at: .job, in: tree).dueDate == nil)
    }

    // A panel has no number and no due date. Ignored rather than written onto some
    // other field.
    @Test func aNumberOrDueDateAimedAtAPanelIsIgnored() {
        let out = JobsEdit.apply(.jobNumber("999"), at: .panel("p1"), in: tree)
        #expect(out == tree)
        #expect(out.jobNumber == "1042")
    }

    // MARK: Which cells are editable

    @Test func numberDueDateAndPriorityAreLevelZeroOnly() {
        for field in [JobsEdit.Field.jobNumber("1"), .dueDate("2026-01-01"), .priority(.high)] {
            #expect(JobsEdit.isEditable(field, atLevel: 0))
            #expect(!JobsEdit.isEditable(field, atLevel: 1))
            #expect(!JobsEdit.isEditable(field, atLevel: 2))
        }
    }

    @Test func titleStatusAndDatesAreEditableAtEveryLevel() {
        for field in [JobsEdit.Field.title("x"), .status(.onHold),
                      .start("2026-01-01"), .end("2026-01-02")] {
            for level in 0...2 { #expect(JobsEdit.isEditable(field, atLevel: level)) }
        }
    }

    // MARK: Cycling and the Finished guard

    @Test func priorityCyclesAndWraps() {
        #expect(JobsEdit.nextPriority(after: .low) == .medium)
        #expect(JobsEdit.nextPriority(after: .medium) == .high)
        #expect(JobsEdit.nextPriority(after: .high) == .low)
    }

    // The web routes EVERY move to Finished through "Request Completion", which
    // notifies the admins rather than closing the job. A grid that set Finished
    // directly would quietly skip an approval step somebody depends on.
    @Test func onlyFinishedNeedsACompletionRequest() {
        #expect(JobsEdit.needsCompletionRequest(.finished))
        for status in JobStatus.allCases where status != .finished {
            #expect(!JobsEdit.needsCompletionRequest(status))
        }
    }

    // MARK: Where a row sits

    @Test func aRowKnowsItsJobAndItsPathWithinIt() {
        let rows = JobGridRow.flatten([tree], expanded: ["j1", "p1"])
        #expect(rows.map(\.jobID) == ["j1", "j1", "j1", "j1", "j1"])
        #expect(rows[0].editPath == .job)
        #expect(rows[1].editPath == .panel("p1"))
        #expect(rows[2].editPath == .operation(panel: "p1", op: "o1"))
        #expect(rows[4].editPath == .panel("p2"))
    }
}

// `differs` cannot be `a != b`: Job's `==` is id-based so job arrays diff by
// identity, which makes it blind to a field change. A no-op edit that slipped
// through would push an undo entry that Cmd-Z then appears to ignore.
@Suite("Jobs edit change detection")
struct JobsEditDiffTests {

    private func job(_ title: String, status: JobStatus = .inProgress) -> Job {
        let data = try! JSONSerialization.data(withJSONObject: [
            "id": "j1", "title": title, "status": status.rawValue,
        ])
        return try! JSONDecoder().decode(Job.self, from: data)
    }

    @Test func identicalJobsDoNotDiffer() {
        #expect(!JobsEdit.differs(job("A"), job("A")))
    }

    @Test func aChangedFieldDiffersEvenThoughEqualityIsByID() {
        let a = job("A"), b = job("B")
        #expect(a == b)                      // same id — Job's own ==
        #expect(JobsEdit.differs(a, b))      // but the value changed
    }

    @Test func recommittingTheSameValueIsNotAChange() {
        let before = job("A", status: .onHold)
        let after = JobsEdit.apply(.status(.onHold), at: .job, in: before)
        #expect(!JobsEdit.differs(before, after))
    }

    @Test func aDeepEditIsSeen() {
        let data = try! JSONSerialization.data(withJSONObject: [
            "id": "j1", "title": "J",
            "subs": [["id": "p1", "title": "P", "subs": [["id": "o1", "title": "O"]]]],
        ])
        let before = try! JSONDecoder().decode(Job.self, from: data)
        let after = JobsEdit.apply(.title("Renamed"),
                                   at: .operation(panel: "p1", op: "o1"), in: before)
        #expect(JobsEdit.differs(before, after))
    }
}
