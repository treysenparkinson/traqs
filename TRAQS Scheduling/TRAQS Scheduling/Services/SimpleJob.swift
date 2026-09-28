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
// `hpd` is PRODUCTIVE hours per day, never a clock span: the web walks it with
// walkProductiveHours, so an 8–4 day written as hpd 8 overruns lunch and spills
// the bar into the next day.

enum SimpleJob {

    /// A multi-day task is assumed to fill each day it covers.
    static let fullDayHours = 7.5

    /// What the form hands over. `startHour`/`endHour` are wall-clock hours
    /// (13.5 = 1:30pm) and only mean anything when `start == end`.
    struct Draft {
        var title: String
        var team: [String]
        var start: String           // yyyy-MM-dd
        var end: String             // yyyy-MM-dd
        var startHour: Double
        var endHour: Double

        var isOneDay: Bool { start == end }
    }

    /// Productive hours a day of this task takes. One day: what the chosen
    /// window actually holds once lunch and breaks come out (web floors it at a
    /// quarter hour). Several days: a full day each.
    static func hoursPerDay(_ d: Draft, day: DayWindow) -> Double {
        guard d.isOneDay else { return fullDayHours }
        return max(0.25, WorkDayClock.productiveHours(from: d.startHour, to: d.endHour, in: day))
    }

    /// Where the bar starts on its first day. A multi-day task has no time
    /// picked, so it starts when the shop does.
    static func startHour(_ d: Draft, day: DayWindow) -> Double {
        d.isOneDay ? d.startHour : day.workStart
    }

    static func makeJob(_ d: Draft, day: DayWindow, color: String,
                        createdBy personId: String?,
                        newId: () -> String = SimpleJob.newId) -> Job {
        let title = d.title.trimmingCharacters(in: .whitespacesAndNewlines)

        var sub = Panel.empty(id: newId(), title: title, hpd: hoursPerDay(d, day: day))
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
