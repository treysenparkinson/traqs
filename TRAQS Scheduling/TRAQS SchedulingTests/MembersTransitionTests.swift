import Testing
@testable import TRAQS_Scheduling

// The members page vanished when a tap landed while it was still closing: the
// close's completion ran after the new open and hid it. Requests mid-transition
// are ignored now.
@Suite("Members page open/close never interleave")
struct MembersTransitionTests {

    @Test("a second open while opening is ignored")
    func doubleOpen() {
        var t = MembersTransition()
        let r1 = t.requestOpen()
        #expect(r1)
        let r2 = t.requestOpen()
        #expect(!r2)
    }

    @Test("close only once fully open")
    func closeWhileOpening() {
        var t = MembersTransition()
        _ = t.requestOpen()
        let r3 = t.requestClose()
        #expect(!r3)
        t.didOpen()
        let r4 = t.requestClose()
        #expect(r4)
    }

    @Test("an open while closing is ignored, so the close can't hide it")
    func openWhileClosing() {
        var t = MembersTransition()
        _ = t.requestOpen(); t.didOpen()
        _ = t.requestClose()
        let r5 = t.requestOpen()
        #expect(!r5)
        t.didClose()
        #expect(t.phase == .closed)
        let r6 = t.requestOpen()
        #expect(r6)
    }

    @Test("stale completions don't move the phase")
    func staleCompletions() {
        var t = MembersTransition()
        t.didOpen(); t.didClose()
        #expect(t.phase == .closed)
    }
}
