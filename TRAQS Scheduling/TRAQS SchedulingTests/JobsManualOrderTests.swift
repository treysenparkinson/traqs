import Testing
import Foundation
@testable import TRAQS_Scheduling

// `taskOrder` / `orderedActive` — the order somebody sets by dragging job rows,
// applied on top of the filter and the column sort.
//
// Two functions, because the drag and the render ask different questions: one
// moves an id within the order, the other applies that order to a list that has
// since been filtered, sorted, added to and deleted from.
@Suite("Manual row order")
struct JobsManualOrderTests {

    private func job(_ id: String) -> Job {
        try! JSONDecoder().decode(Job.self, from:
            "{\"id\":\"\(id)\",\"title\":\"\(id)\",\"subs\":[]}".data(using: .utf8)!)
    }

    private var jobs: [Job] { ["a", "b", "c", "d"].map(job) }
    private var ids: [String] { ["a", "b", "c", "d"] }

    // MARK: Applying it

    @Test func noOrderLeavesTheSortAlone() {
        #expect(JobsQuery.applyingManualOrder(jobs, []).map(\.id) == ids)
    }

    @Test func namedIdsComeFirstInTheirOwnOrder() {
        #expect(JobsQuery.applyingManualOrder(jobs, ["c", "a"]).map(\.id)
                == ["c", "a", "b", "d"])
    }

    /// `taskOrder.map(...).filter(Boolean)` — an id for a job that has since been
    /// deleted is dropped rather than leaving a hole.
    @Test func anIdThatNoLongerExistsIsDropped() {
        #expect(JobsQuery.applyingManualOrder(jobs, ["z", "c"]).map(\.id)
                == ["c", "a", "b", "d"])
    }

    /// `.concat(rest)` — a job created since the drag goes to the END rather than
    /// jumping to the top.
    @Test func anUnrankedJobKeepsItsPlaceAtTheBack() {
        #expect(JobsQuery.applyingManualOrder(jobs, ["d", "c", "b"]).map(\.id)
                == ["d", "c", "b", "a"])
    }

    // MARK: Moving one

    /// `const base = prev.length ? prev : activeTasks.map(t => t.id)`. Without
    /// the seed the first drag would produce a two-element order and shuffle
    /// every other job to the end.
    @Test func theFirstDragSeedsFromWhatIsOnScreen() {
        #expect(JobsQuery.movingInManualOrder([], dragged: "a", onto: "c", current: ids)
                == ["b", "c", "a", "d"])
    }

    /// Dropping onto a row BELOW you lands after it; onto one ABOVE you takes its
    /// place and pushes it down. Both match the web's index arithmetic.
    @Test func directionDecidesWhichSideOfTheTargetYouLandOn() {
        #expect(JobsQuery.movingInManualOrder(ids, dragged: "a", onto: "c", current: ids)
                == ["b", "c", "a", "d"])
        #expect(JobsQuery.movingInManualOrder(ids, dragged: "d", onto: "b", current: ids)
                == ["a", "d", "b", "c"])
    }

    @Test func theEndsWork() {
        #expect(JobsQuery.movingInManualOrder(ids, dragged: "a", onto: "d", current: ids)
                == ["b", "c", "d", "a"])
        #expect(JobsQuery.movingInManualOrder(ids, dragged: "d", onto: "a", current: ids)
                == ["d", "a", "b", "c"])
    }

    @Test func aNoOpDropChangesNothing() {
        #expect(JobsQuery.movingInManualOrder(ids, dragged: "b", onto: "b", current: ids) == ids)
        #expect(JobsQuery.movingInManualOrder(ids, dragged: "z", onto: "a", current: ids) == ids)
    }

    // MARK: Together

    @Test func successiveDragsCompose() {
        var order = JobsQuery.movingInManualOrder([], dragged: "d", onto: "a", current: ids)
        #expect(JobsQuery.applyingManualOrder(jobs, order).map(\.id) == ["d", "a", "b", "c"])

        order = JobsQuery.movingInManualOrder(order, dragged: "b", onto: "d", current: ids)
        #expect(JobsQuery.applyingManualOrder(jobs, order).map(\.id) == ["b", "d", "a", "c"])
    }
}
