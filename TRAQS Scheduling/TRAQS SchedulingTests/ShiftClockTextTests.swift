import Testing
@testable import TRAQS_Scheduling

// d9cc596, kept through the Liquid Glass arrangement: Home's shift clock is the
// Time Clock hero's number — today's hours, frozen on lunch, held after clock-out —
// not the open lunch/break's own count-up.
@Suite("Home shift clock reads today's hours")
struct ShiftClockTextTests {

    @Test("on lunch or break the clock holds today's hours; the pause shows in the title")
    func pausedHoldsToday() {
        #expect(ShiftClockText.value(status: .lunch, todayHours: 4, pauseSeconds: 90) == "4:00:00")
        #expect(ShiftClockText.value(status: .onBreak, todayHours: 4.5, pauseSeconds: 30) == "4:30:00")
        #expect(ShiftClockText.title(status: .lunch, pauseSeconds: 12 * 60) == "On lunch · 12m")
        #expect(ShiftClockText.title(status: .onBreak, pauseSeconds: 75 * 60) == "On break · 1h 15m")
    }

    @Test("after clock-out the day's hours stay up; dashes only with nothing clocked today")
    func offlineHoldsTheDay() {
        #expect(ShiftClockText.value(status: .offline, todayHours: 7.25, pauseSeconds: 0) == "7:15:00")
        #expect(!ShiftClockText.isIdle(status: .offline, todayHours: 7.25))
        #expect(ShiftClockText.value(status: .offline, todayHours: 0, pauseSeconds: 0) == "--:--:--")
        #expect(ShiftClockText.isIdle(status: .offline, todayHours: 0))
    }

    @Test("working: today's hours, titled This shift")
    func working() {
        #expect(ShiftClockText.value(status: .clockedIn, todayHours: 2, pauseSeconds: 0) == "2:00:00")
        #expect(ShiftClockText.title(status: .clockedIn, pauseSeconds: 0) == "This shift")
    }
}
