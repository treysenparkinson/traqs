import Foundation

// MARK: - A simple job
//
// The web's one-step "New Job" (renderSimpleJobModal, TRAQS.jsx): a name, who's
// on it, and when. No panels, no ops, no wizard.
//
// SHAPE, and why it has to be exactly this: a `jobType: "general"` job whose one
// flat sub IS the schedulable leaf. The web's getPersonBars draws a general job's
// `subs` directly as assignments, and a job with `subs: []` draws nothing at all
// — the deepest-node rule needs an actual node at that depth. iOS reads the same
// sub as a panel with no ops, which `myAssignments` already turns into a task.
//
// `hpd` is the task's TOTAL estimated PRODUCTIVE hours for the whole team — not
// a per-day rate and never a clock span. Each person's share (hpd ÷ team) is
// walked with walkProductiveHours, so an 8–4 day written as 8 each overruns lunch
// and spills the bar into the next day.

enum SimpleJob {

    /// What the form hands over. `startHour`/`endHour` are wall-clock hours
    /// (13.5 = 1:30pm) and only mean anything for a one-day task.
    struct Draft {
        var title: String
        var team: [String]
        var start: String           // yyyy-MM-dd
        var end: String             // yyyy-MM-dd
        var startHour: Double
        var endHour: Double
        /// The form's "One day" toggle turned OFF: full days, no times — even
        /// if the two dates happen to be the same day.
        var fullDays: Bool = false

        var isOneDay: Bool { !fullDays && start == end }
    }

    /// The task's `hpd`: total productive hours for everyone on it. One day:
    /// what the chosen window actually holds once lunch and breaks come out (web
    /// floors it at a quarter hour). Several days: a full productive day on each
    /// working day of the span. Either way × the assignees, each of whom works it.
    static func totalHours(_ d: Draft, day: DayWindow, calendar: WorkCalendar) -> Double {
        let people = Double(max(1, d.team.count))
        guard d.isOneDay else {
            return Double(workingDays(from: d.start, to: d.end, in: calendar)) * day.productiveHours * people
        }
        return max(0.25, WorkDayClock.productiveHours(from: d.startHour, to: d.endHour, in: day)) * people
    }

    /// Working days in `start…end`, inclusive. Never below 1 — a run that is all
    /// weekend still books the day it was put on.
    static func workingDays(from start: String, to end: String, in calendar: WorkCalendar) -> Int {
        guard JobsScheduler.date(from: start) != nil, end >= start else { return 1 }
        var count = 0, current = start, steps = 0
        // Bounded, like every other walk over the calendar.
        while current <= end && steps < 4000 {
            if calendar.isWorkDay(current) { count += 1 }
            current = JobsScheduler.adding(days: 1, to: current)
            steps += 1
        }
        return max(1, count)
    }

    /// Where the bar starts on its first day. A multi-day task has no time
    /// picked, so it starts when the shop does.
    static func startHour(_ d: Draft, day: DayWindow) -> Double {
        d.isOneDay ? d.startHour : day.workStart
    }

    static func makeJob(_ d: Draft, day: DayWindow, calendar: WorkCalendar = WorkCalendar(),
                        color: String,
                        createdBy personId: String?,
                        newId: () -> String = SimpleJob.newId) -> Job {
        let title = d.title.trimmingCharacters(in: .whitespacesAndNewlines)

        var sub = Panel.empty(id: newId(), title: title,
                              hpd: totalHours(d, day: day, calendar: calendar))
        sub.start = d.start
        sub.end = d.end
        sub.team = d.team
        sub.extras.set("startHour", .number(startHour(d, day: day)))
        sub.extras.set("color", .string(color))

        return Job(id: newId(), title: title,
                   start: d.start, end: d.end,
                   status: .notStarted, pri: .medium,
                   color: color,
                   subs: [sub],
                   jobType: "general",
                   projectManagerId: personId)
    }

    /// The web's `uid()` shape: "t" + 8 base-36 characters.
    static func newId() -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return "t" + String((0..<8).map { _ in chars.randomElement()! })
    }
}
