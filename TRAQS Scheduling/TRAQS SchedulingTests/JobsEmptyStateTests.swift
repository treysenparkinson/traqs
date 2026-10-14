import Testing
@testable import TRAQS_Scheduling

// "It's quiet here..." is for a page with nothing on it. The check lived inside
// rangeContent and counted only that section's lists, which leave out the Today
// cards and the job you're clocked into (both drawn above it) — so a Mine page
// holding only those read as empty and said so under the card.
@Suite("Jobs empty state only when the page is empty")
struct JobsEmptyStateTests {

    @Test("working on your only job: not quiet")
    func working() {
        #expect(!TasksView.showsEmptyState(rangeItems: 0, todayCards: 0, inProgressCards: 1))
    }

    @Test("a job posted for you today: not quiet")
    func todayCard() {
        #expect(!TasksView.showsEmptyState(rangeItems: 0, todayCards: 1, inProgressCards: 0))
    }

    @Test("nothing anywhere: quiet")
    func empty() {
        #expect(TasksView.showsEmptyState(rangeItems: 0, todayCards: 0, inProgressCards: 0))
    }

    @Test("something in range: not quiet")
    func ranged() {
        #expect(!TasksView.showsEmptyState(rangeItems: 2, todayCards: 0, inProgressCards: 0))
    }
}
