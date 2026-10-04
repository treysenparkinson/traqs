import Foundation

// MARK: - Schedule & Assign
//
// `suggestSchedule` (TRAQS.jsx:22414) and the confirm path behind "Use This
// Schedule" (:23440). Step 3 of the New Job wizard.
//
// It reads like an AI feature and is not one: `suggestSchedule` is a
// `setTimeout` around local arithmetic. Nothing is posted, and the `ai-schedule`
// function is a different feature (FAST TRAQS). So all of it ports.
//
// WHAT IT DOES. Every assignable unit — a panel's operations, or the panel
// itself when it has none — is reduced to a duration in business days and a
// required department. It then walks forward from today, and for each candidate
// start date asks whether a crew exists for every unit in sequence. The first
// three dates that work become the offered windows, each carrying who is free
// and who is not.
//
// CANDIDATE DAYS ARE WHOLE DAYS, deliberately: a unit is offered from the start
// of a working day and no `startHour` is written — the field is left for the
// scheduler page to set, and writing a half-considered one would be worse than
// writing none. But whether a person is FREE is the shared hour-level rule
// (OverlapRule), the same one the web and the server enforce, so a unit that
// only takes the morning of an existing booking's day is placed around it
// exactly as the web would judge it.
//
// Pure: no AppState, no `Date()`, no Calendar captured from the environment.
// Everything the walk needs is passed in, which is what makes a scheduler
// testable at all — its failure mode is "assigns the wrong person to the wrong
// week", and that is not something to discover from a screenshot.

// MARK: What is being scheduled

/// One assignable unit, reduced to what the walk needs.
struct SchedulableUnit: Equatable {
    /// Which operation this is, so the result can be written back.
    let id: String
    let title: String
    /// Business days the unit's crew needs: each person's share of `hpd` (the
    /// unit's total for the whole team) over a productive day, at least one. A
    /// 15-hour operation for two people in a 7.5-hour day is one business day;
    /// a 40-hour one for one person is six.
    let durationDays: Int
    /// The departments that may do it — `unitDepartments`: the nearest of op, panel, job
    /// that states any, as a set. [] is anyone. Never inferred from the title.
    let departments: [String]
    /// The team already on it. `candidatesFor`: an existing team wins outright.
    var team: [String] = []
    /// The panel this belongs to, or nil when the panel IS the unit.
    let panelID: String
    /// The one assignee's productive hours on it — the whole `hpd`, since the
    /// scheduler puts one person on each unit. 0 is unestimated, which the
    /// overlap rule reads as one productive day.
    var hours: Double = 0
}

/// One offered start date.
struct ScheduleWindow: Equatable, Identifiable {
    let start: String
    let end: String
    /// Who is free for the first unit's span. The web shows these as "Available".
    let available: [String]
    /// Who is not. Shown struck through.
    let busy: [String]
    /// Business days the whole sequence occupies.
    let totalDays: Int
    /// The per-unit placement this window implies — what "Use This Schedule"
    /// writes. Computed with the window rather than re-derived on confirm, so
    /// what is shown and what is applied cannot drift.
    let placements: [SchedulePlacement]

    var id: String { start }
}

/// Where one unit landed, and who is on it.
struct SchedulePlacement: Equatable {
    let unitID: String
    let panelID: String
    let start: String
    let end: String
    let team: [String]
}

enum JobsScheduler {

    // MARK: Reading the form

    /// `opDurBD`, per person: `ceil((hpd / teamSize) / productiveHoursPerDay)`,
    /// min 1. Unestimated (hpd 0) is one day — never a made-up estimate. Not ÷
    /// the org `hpd`, which is a stale gross day that counts lunch.
    static func durationDays(hpd: Double, teamSize: Int, productiveHoursPerDay: Double) -> Int {
        guard hpd > 0, productiveHoursPerDay > 0 else { return 1 }
        let share = hpd / Double(max(1, teamSize))
        return max(1, Int((share / productiveHoursPerDay).rounded(.up)))
    }

    /// `topoSort` — dependencies first, then declaration order.
    ///
    /// A cycle cannot hang this: `visited` is marked on the way IN, so a unit
    /// already being visited is skipped rather than recursed into. The web does
    /// the same and gets the same tolerance for free.
    static func topologicallySorted(_ operations: [Operation]) -> [Operation] {
        var result: [Operation] = []
        var visited = Set<String>()
        let byID = Dictionary(operations.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        func visit(_ op: Operation) {
            guard visited.insert(op.id).inserted else { return }
            for dep in op.deps {
                if let next = byID[dep] { visit(next) }
            }
            result.append(op)
        }
        for op in operations { visit(op) }
        return result
    }

    /// Every assignable unit in a job, in the order they must be worked.
    ///
    /// "Panels with sub-ops → sub-ops are assignable. Panels without sub-ops →
    /// the panel itself is assignable." Untitled units are skipped, as the web
    /// skips `o.title?.trim()`.
    static func units(of job: Job, productiveHoursPerDay: Double) -> [SchedulableUnit] {
        // ONE person per unit: `place` writes a single assignee over whatever
        // team the form had, so that one person does the whole `hpd`. Sizing by
        // the form's team would book a two-person op for half the days its one
        // real assignee needs.
        let crewSize = 1

        return job.subs.flatMap { panel -> [SchedulableUnit] in
            // #242: a panel is the unit only when it has no LIVE ops — `isAssignedHere`, the
            // rule the gantt and the overlap rule use. Untitled live ops are skipped, as the
            // web skips them, without turning their panel back into a unit.
            let live = panel.subs.filter { !OverlapRule.isTombstoned($0.extras) }
            guard live.isEmpty else {
                let named = live.filter { !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }
                return topologicallySorted(named).map { op in
                    SchedulableUnit(
                        id: op.id, title: op.title,
                        durationDays: durationDays(hpd: op.hpd, teamSize: crewSize,
                                                   productiveHoursPerDay: productiveHoursPerDay),
                        departments: Departments.unit(op.extras, panel: panel.extras, job: job.extras),
                        team: op.team,
                        panelID: panel.id,
                        hours: op.hpd > 0 ? op.hpd / Double(crewSize) : 0)
                }
            }
            guard !panel.title.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
            return [SchedulableUnit(
                id: panel.id, title: panel.title,
                durationDays: durationDays(hpd: panel.hpd, teamSize: crewSize,
                                           productiveHoursPerDay: productiveHoursPerDay),
                // A panel that IS the unit has no parent panel — `unitDepartments(panel, null, job)`.
                departments: Departments.unit(panel.extras, panel: nil, job: job.extras),
                team: panel.team,
                panelID: panel.id,
                hours: panel.hpd > 0 ? panel.hpd / Double(crewSize) : 0)]
        }
    }

    // MARK: Who can take it

    /// `allCrew` — real users who have not opted out of auto-scheduling.
    ///
    /// `noAutoSchedule` is the desktop's canonical flag and `autoSchedule` is
    /// iOS's inverse of it; either being set to exclude wins, which is what
    /// stops a person opted out on one platform being scheduled from the other.
    static func schedulableCrew(_ people: [Person]) -> [Person] {
        people.filter { person in
            guard person.userRole == "user" || person.userRole == "admin" else { return false }
            if person.noAutoSchedule == true { return false }
            if person.autoSchedule == false { return false }
            return true
        }
    }

    /// The units nobody on `crew` may take — a stated department with no one in it, or a
    /// team none of whom is on the roster. They fail every window; the sheet names them
    /// instead of reporting that nobody is free for 200 days.
    static func unstaffable(_ units: [SchedulableUnit], crew: [Person]) -> [SchedulableUnit] {
        units.filter { Departments.candidates(team: $0.team, departments: $0.departments, crew: crew).isEmpty }
    }
}

// MARK: - Business days
//
// `addBD` / `nextBD` (TRAQS.jsx:551). Both parse at NOON, as every date helper in
// this app does, so a DST transition cannot shift the answer by a day.

struct WorkCalendar {
    /// `workDays` — 0 = Sunday. The org's, defaulting to Mon–Fri.
    var workDays: Set<Int> = [1, 2, 3, 4, 5]
    /// `holidays` — `yyyy-MM-dd`, treated exactly like a weekend.
    var holidays: Set<String> = []

    init(workDays: [Int] = [1, 2, 3, 4, 5], holidays: [String] = []) {
        // `workCalendar` (scheduleRules.js): out-of-range entries are dropped, and
        // a week left with none is Mon–Fri — never a calendar with no working day.
        let valid = workDays.filter { (0...6).contains($0) }
        self.workDays = valid.isEmpty ? [1, 2, 3, 4, 5] : Set(valid)
        self.holidays = Set(holidays.map { String($0.prefix(10)) })
    }

    /// The org's calendar — its `workDays` AND its `holidays`. Every "is this a
    /// working day" question on iOS goes through here, so a holiday can't be a
    /// weekend on one screen and a working day on the next.
    init(org: OrgSettings) {
        self.init(workDays: org.workDays, holidays: org.holidays)
    }

    private static let calendar = Calendar(identifier: .gregorian)

    func isWorkDay(_ day: String) -> Bool {
        guard let date = JobsScheduler.date(from: day) else { return false }
        let weekday = Self.calendar.component(.weekday, from: date) - 1   // 0 = Sunday
        return workDays.contains(weekday) && !holidays.contains(day)
    }

    /// The same question for a `Date` — the day it falls on in `calendar`, which
    /// is the calendar the caller laid its columns out in.
    func isWorkDay(_ date: Date, in calendar: Calendar) -> Bool {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        guard let y = c.year, let m = c.month, let d = c.day else { return false }
        return isWorkDay(String(format: "%04d-%02d-%02d", y, m, d))
    }

    /// `span` — working days from `start` through `end`, both inclusive.
    func workDaysInclusive(from start: String, through end: String) -> Int {
        var n = 0
        var current = start
        for _ in 0..<4000 where current <= end {
            if isWorkDay(current) { n += 1 }
            current = JobsScheduler.adding(days: 1, to: current)
        }
        return n
    }

    /// `countForward` — the day on which the `count`th working day is reached,
    /// counting `start` itself when it works. `start` for a count below 1.
    func dayCountingForward(_ count: Int, from start: String) -> String {
        guard count > 0 else { return start }
        var current = start
        var seen = 0
        for _ in 0..<4000 {
            if isWorkDay(current) { seen += 1; if seen >= count { break } }
            current = JobsScheduler.adding(days: 1, to: current)
        }
        return current
    }

    /// `nextBD` — `day` itself when it already works, else the next one that does.
    func nextWorkDay(from day: String) -> String {
        var current = day
        // Bounded. A `while true` here hangs the app if an org ever saves an
        // empty `workDays`, which the initialiser guards but the holidays list
        // does not — 400 days is past any plausible run of them.
        for _ in 0..<400 {
            if isWorkDay(current) { return current }
            current = JobsScheduler.adding(days: 1, to: current)
        }
        return current
    }

    /// `addBD` — `n` WORKING days after `day`, skipping weekends and holidays.
    func addingWorkDays(_ n: Int, to day: String) -> String {
        guard n != 0 else { return day }
        var current = day
        var remaining = abs(n)
        let step = n > 0 ? 1 : -1
        var guardCount = 0
        while remaining > 0 && guardCount < 4000 {
            current = JobsScheduler.adding(days: step, to: current)
            if isWorkDay(current) { remaining -= 1 }
            guardCount += 1
        }
        return current
    }
}

extension WorkCalendar {

    /// A range pulled forward with the rest of its tree, keeping its WORKING-day
    /// length — `shiftRangeForward` with a calendar (statsMath.js). `anchor` is the
    /// tree's earliest day and `target` the working day it moves to. The range
    /// starts as many working days after `target` as it started after `anchor`, and
    /// ends on the day its original working-day count (inclusive) is reached. A
    /// shift by calendar days kept that only for multiples of a week: a Mon–Fri
    /// range moved to a Wednesday ended on a Sunday, three working days long.
    ///
    /// Either end may be empty (unscheduled) and stays so; a lone end moves as a
    /// one-day range.
    func shiftingRange(start: String, end: String,
                       from anchor: String, to target: String) -> (start: String, end: String) {
        func moved(_ day: String) -> String {
            let offset = day > anchor
                ? workDaysInclusive(from: JobsScheduler.adding(days: 1, to: anchor), through: day)
                : 0
            return addingWorkDays(offset, to: nextWorkDay(from: target))
        }
        guard !start.isEmpty else { return (start, end.isEmpty ? end : moved(end)) }
        let newStart = moved(start)
        guard !end.isEmpty else { return (newStart, end) }
        let count = max(1, workDaysInclusive(from: start, through: end))
        return (newStart, dayCountingForward(count, from: newStart))
    }
}

extension JobsScheduler {

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static let noonFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static func date(from day: String) -> Date? {
        guard !day.isEmpty else { return nil }
        return noonFormatter.date(from: day + "T12:00:00")
    }

    static func adding(days: Int, to day: String) -> String {
        guard let date = date(from: day),
              let moved = Calendar(identifier: .gregorian)
                .date(byAdding: .day, value: days, to: date)
        else { return day }
        return dayFormatter.string(from: moved)
    }
}

// MARK: - Who is already busy
//
// `isPersonFree`, on the shared overlap rule. A person is booked by any unit
// that takes part (OverlapRule.takesPart) whose hours on some day intersect the
// candidate's — half-open, so back to back is free — and by any time off that
// touches the candidate's dates, which books whole days.
//
// The org's bookings are flattened and their blocks walked ONCE, then indexed by
// person: the scan below asks "is this person free" per person per candidate
// day, and is the hottest thing in the file.

extension JobsScheduler {

    /// One existing booking, flattened out of the job tree once.
    struct Booking: Equatable {
        let personID: String
        let start: String
        let end: String
        /// The hours it holds on each day, for its one person — the shared
        /// rule's blocks. Nil for time off, which holds its dates whole.
        let blocks: [OverlapRule.Block]?
    }

    /// Every unit in the org that takes part in the overlap rule, per assignee,
    /// plus time off.
    ///
    /// `excluding` is the job being scheduled: its own current dates must not
    /// make it look like its own people are busy. The web does the same with
    /// `if (ed.id && job.id === ed.id) continue`.
    ///
    /// A PANEL only counts when it has no live operations — otherwise the
    /// operations are the real bookings and counting both double-books the
    /// panel's team (`occupyingUnits`).
    static func bookings(in jobs: [Job], people: [Person], context: OverlapRule.Context,
                         excluding jobID: String? = nil) -> [Booking] {
        var out: [Booking] = []

        for unit in OverlapRule.occupyingUnits(in: jobs, context: context, excludingJob: jobID) {
            let blocks = OverlapRule.blocks(of: unit, context: context)
            // No hours from today on: nothing left to collide with.
            guard !blocks.isEmpty else { continue }
            for person in Set(unit.team) {
                out.append(Booking(personID: person, start: unit.start,
                                   end: unit.end.isEmpty ? unit.start : unit.end, blocks: blocks))
            }
        }

        for person in people {
            for off in person.timeOff where !off.start.isEmpty && !off.end.isEmpty {
                out.append(Booking(personID: person.id, start: off.start, end: off.end, blocks: nil))
            }
        }
        return out
    }

    /// Bookings indexed by person, so the scan is a dictionary hit rather than a
    /// walk of every booking in the org per person per candidate day.
    static func bookingIndex(_ bookings: [Booking]) -> [String: [Booking]] {
        Dictionary(grouping: bookings, by: \.personID)
    }

    /// Whether `personID` can take a unit holding `blocks` over `start`...`end`.
    static func isFree(_ personID: String, blocks: [OverlapRule.Block],
                       from start: String, to end: String,
                       in index: [String: [Booking]]) -> Bool {
        guard let mine = index[personID] else { return true }
        return !mine.contains { booking in
            if let theirs = booking.blocks {
                return OverlapRule.blocksOverlap(blocks, theirs) != nil
            }
            // Time off: date overlap, not containment.
            return booking.start <= end && booking.end >= start
        }
    }
}

// MARK: - Finding the windows
//
// `findWindows`. Walk candidate start days forward from today; for each, try to
// place every unit in sequence. A day where some unit has no free crew is
// abandoned and the next is tried. The first three that place cleanly are the
// offered windows.

extension JobsScheduler {

    struct Request {
        var units: [SchedulableUnit]
        var crew: [Person]
        var calendar = WorkCalendar()
        /// The org's working day, lunch and breaks placed — what a unit's hours
        /// are walked through to find the block it holds on each day.
        var day = WorkDayClock.day(from: OrgSettings.default)
        var bookings: [String: [Booking]] = [:]
        /// `TD` — today, as `yyyy-MM-dd`. Passed in rather than read, so a test
        /// can state the day.
        var today: String
        /// How many windows to offer. The web shows three.
        var wanted = 3
        /// `maxScan` — how many candidate days to try before giving up.
        var maxScan = 200

        /// The overlap rule's inputs, from the same calendar and day.
        var rule: OverlapRule.Context {
            OverlapRule.Context(day: day, calendar: calendar, today: today)
        }
    }

    /// The offered windows, best (soonest) first. Empty means nothing fits
    /// within `maxScan` days, which the UI reports rather than pretending.
    static func windows(_ request: Request) -> [ScheduleWindow] {
        guard !request.units.isEmpty, !request.crew.isEmpty else { return [] }

        var results: [ScheduleWindow] = []
        var candidate = request.calendar.nextWorkDay(from: request.today)
        var scanned = 0

        while scanned < request.maxScan && results.count < request.wanted {
            scanned += 1
            if let window = place(request, startingOn: candidate) {
                results.append(window)
            }
            candidate = request.calendar.addingWorkDays(1, to: candidate)
        }
        return results
    }

    /// Try to lay the whole sequence out from one start day.
    ///
    /// Units run BACK TO BACK, in the order `units` gives them — which is
    /// already topologically sorted, so a dependency is finished before the unit
    /// that needs it starts. Each takes the crew free for its own span.
    private static func place(_ request: Request,
                              startingOn start: String) -> ScheduleWindow? {
        var placements: [SchedulePlacement] = []
        var cursor = start
        var totalDays = 0
        let rule = request.rule
        // What this run has placed so far counts as booked. A free check that
        // looked only at the org — ignoring the job being scheduled — is what
        // produced real double-bookings on the web.
        var booked = request.bookings
        var firstBlocks: [OverlapRule.Block] = []

        for unit in request.units {
            let unitEnd = request.calendar.addingWorkDays(unit.durationDays - 1, to: cursor)
            // From the start of the day: no `startHour` is written (see the top).
            let blocks = OverlapRule.blocks(start: cursor, end: unitEnd, startHour: nil,
                                            hours: unit.hours, context: rule)
            if placements.isEmpty { firstBlocks = blocks }
            // `candidatesFor`: the existing team, else the department set, else anyone — and
            // NOBODY when a stated department has no one. No fallback to all crew (4ee9598).
            let eligible = Departments.candidates(team: unit.team, departments: unit.departments,
                                                  crew: request.crew)
            let free = eligible.filter {
                isFree($0.id, blocks: blocks, from: cursor, to: unitEnd, in: booked)
            }
            // Nobody can take this unit on these days, so this whole start day
            // fails — the web abandons the window the same way.
            guard !free.isEmpty else { return nil }
            booked[free[0].id, default: []].append(Booking(
                personID: free[0].id, start: cursor, end: unitEnd, blocks: blocks))

            placements.append(SchedulePlacement(
                unitID: unit.id, panelID: unit.panelID,
                start: cursor, end: unitEnd,
                // ONE person per unit, the first free and best-matched. The web
                // splits a batch across a crew when a panel is replicated; a job
                // being created has each unit once, so "who does this" has one
                // answer: the first free candidate, in roster order.
                team: [free[0].id]))

            totalDays += unit.durationDays
            cursor = request.calendar.addingWorkDays(unit.durationDays, to: cursor)
        }

        guard let last = placements.last else { return nil }

        // "Available" is measured against the FIRST unit's span, not the whole
        // run. The web's comment says why: requiring everyone to be free for a
        // batch that can be many days long pushed recommendations later than
        // they needed to be.
        // Against the org only: the run's own first placement would otherwise
        // make its assignee look busy for their own unit.
        let firstSpan = placements[0]
        let available = request.crew.filter {
            isFree($0.id, blocks: firstBlocks, from: firstSpan.start, to: firstSpan.end,
                   in: request.bookings)
        }
        guard !available.isEmpty else { return nil }
        let busy = request.crew.filter { person in
            !available.contains { $0.id == person.id }
        }

        return ScheduleWindow(start: start, end: last.end,
                              available: available.map(\.id),
                              busy: busy.map(\.id),
                              totalDays: totalDays,
                              placements: placements)
    }

    // MARK: Applying one

    /// The job with a window's placements written onto it.
    ///
    /// Sets each unit's dates and team, rolls the job's own span up from what
    /// actually landed, and clears `scheduledLater` — the job has left TRAQS
    /// Cloud. A panel that owns operations takes their outer span rather than a
    /// date of its own, so the grid's panel row agrees with its children.
    static func applying(_ window: ScheduleWindow, to job: Job) -> Job {
        var job = job
        let byUnit = Dictionary(window.placements.map { ($0.unitID, $0) },
                                uniquingKeysWith: { a, _ in a })

        for p in job.subs.indices {
            for o in job.subs[p].subs.indices {
                guard let place = byUnit[job.subs[p].subs[o].id] else { continue }
                job.subs[p].subs[o].start = place.start
                job.subs[p].subs[o].end = place.end
                job.subs[p].subs[o].team = place.team
            }

            if job.subs[p].subs.isEmpty {
                if let place = byUnit[job.subs[p].id] {
                    job.subs[p].start = place.start
                    job.subs[p].end = place.end
                    job.subs[p].team = place.team
                }
            } else {
                let starts = job.subs[p].subs.map(\.start).filter { !$0.isEmpty }
                let ends = job.subs[p].subs.map(\.end).filter { !$0.isEmpty }
                if let first = starts.min() { job.subs[p].start = first }
                if let last = ends.max() { job.subs[p].end = last }
            }
        }

        let starts = job.subs.map(\.start).filter { !$0.isEmpty }
        let ends = job.subs.map(\.end).filter { !$0.isEmpty }
        job.start = starts.min() ?? window.start
        job.end = ends.max() ?? window.end
        // `updated.scheduledLater = false` — and REMOVED rather than written
        // false, because the Cloud list tests the key's truthiness.
        job.extras.set("scheduledLater", nil)
        // The job's own team is everyone who ended up on it, which is what the
        // grid's level-0 Team column reads.
        var seen = Set<String>()
        job.team = job.subs.flatMap { panel in
            panel.subs.isEmpty ? panel.team : panel.subs.flatMap(\.team)
        }.filter { seen.insert($0).inserted }
        return job
    }
}
