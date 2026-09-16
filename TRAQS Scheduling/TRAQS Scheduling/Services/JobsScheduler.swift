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
// DAY GRANULARITY, deliberately. The web tracks `startHour`/`endHour` so two
// short operations can share a day, and `isPersonFree` has a same-day hour
// comparison for it. That matters when rescheduling around existing part-days;
// it does not for a job being created, whose operations have no hours yet. Whole
// days here, and the field is left for the scheduler page to set — writing a
// half-considered `startHour` would be worse than writing none.
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
    /// `opDurBD` — `max(1, ceil(hpd / orgHpd))`. A 7.5-hour operation in a
    /// 7.5-hour day is one business day; a 40-hour one is six.
    let durationDays: Int
    /// `requiredDepartment`, already inferred — see `department(of:)`.
    let department: String
    /// The panel this belongs to, or nil when the panel IS the unit.
    let panelID: String
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

    /// `deptOfUnit` — the unit's own department, then its panel's, then the
    /// job's, and finally the unit's TITLE when that matches a known department
    /// name.
    ///
    /// The title fallback is not a nicety: FAST TRAQS imports leave
    /// `requiredDepartment` empty on operations whose titles ("Wire", "Cut",
    /// "Layout") are exactly the department names, and without it the scheduler
    /// ignores departments entirely on such a job.
    static func department(of unit: String, own: String, panel: String,
                           job: String, known: Set<String>) -> String {
        if !own.isEmpty { return own }
        if !panel.isEmpty { return panel }
        if !job.isEmpty { return job }
        let title = unit.trimmingCharacters(in: .whitespaces)
        return known.contains(title.lowercased()) ? title : ""
    }

    /// `opDurBD`.
    static func durationDays(hpd: Double, orgHpd: Double) -> Int {
        let perDay = orgHpd > 0 ? orgHpd : 7.5
        return max(1, Int((hpd / perDay).rounded(.up)))
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
    static func units(of job: Job, orgHpd: Double,
                      departmentNames: Set<String>) -> [SchedulableUnit] {
        let known = Set(departmentNames.map { $0.lowercased() })
        let jobDept = job.extras.text("requiredDepartment")

        return job.subs.flatMap { panel -> [SchedulableUnit] in
            let panelDept = panel.extras.text("requiredDepartment")
            let named = panel.subs.filter { !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }

            guard named.isEmpty else {
                return topologicallySorted(named).map { op in
                    SchedulableUnit(
                        id: op.id, title: op.title,
                        durationDays: durationDays(hpd: op.hpd, orgHpd: orgHpd),
                        department: department(of: op.title,
                                               own: op.extras.text("requiredDepartment"),
                                               panel: panelDept, job: jobDept, known: known),
                        panelID: panel.id)
                }
            }
            guard !panel.title.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
            return [SchedulableUnit(
                id: panel.id, title: panel.title,
                durationDays: durationDays(hpd: panel.hpd, orgHpd: orgHpd),
                // A panel that IS the unit has no parent to inherit from —
                // `_inferDept(panel, null)`.
                department: department(of: panel.title, own: panelDept,
                                       panel: "", job: jobDept, known: known),
                panelID: panel.id)]
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

    /// `personDeptMatch` — primary, then secondary, then no.
    ///
    /// `Person.role` IS the primary department — its decoder prefers the raw
    /// `department` key over the legacy `role`.
    static func departmentRank(_ person: Person, _ required: String) -> Int? {
        guard !required.isEmpty else { return 0 }
        if person.role == required { return 0 }
        if person.secondaryDepartment == required { return 1 }
        return nil
    }

    /// `crewForOp` — the department's people, primary matches first.
    ///
    /// FALLS BACK TO EVERYONE when nobody matches. The web's comment says why:
    /// otherwise a department with no members bails the whole schedule with "no
    /// windows" instead of placing the work somewhere.
    static func crew(for department: String, from all: [Person]) -> [Person] {
        guard !department.isEmpty else { return all }
        let matched = all.compactMap { person -> (Person, Int)? in
            departmentRank(person, department).map { (person, $0) }
        }
        guard !matched.isEmpty else { return all }
        return matched.sorted { $0.1 < $1.1 }.map(\.0)
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
        self.workDays = workDays.isEmpty ? [1, 2, 3, 4, 5] : Set(workDays)
        self.holidays = Set(holidays)
    }

    private static let calendar = Calendar(identifier: .gregorian)

    func isWorkDay(_ day: String) -> Bool {
        guard let date = JobsScheduler.date(from: day) else { return false }
        let weekday = Self.calendar.component(.weekday, from: date) - 1   // 0 = Sunday
        return workDays.contains(weekday) && !holidays.contains(day)
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
// `isPersonFree`. A person is booked by any unfinished assignment that OVERLAPS
// the range, and by any time-off that does.
//
// Ranges are compared as `yyyy-MM-dd` strings, which is correct for that format
// and avoids parsing two dates per person per candidate day — this runs inside
// the scan loop and is the hottest thing in the file.

extension JobsScheduler {

    /// One existing booking, flattened out of the job tree once.
    struct Booking: Equatable {
        let personID: String
        let start: String
        let end: String
    }

    /// Every unfinished, dated assignment in the org, plus time off.
    ///
    /// `excluding` is the job being scheduled: its own current dates must not
    /// make it look like its own people are busy. The web does the same with
    /// `if (ed.id && job.id === ed.id) continue`.
    ///
    /// A PANEL only counts when it has no operations — otherwise the operations
    /// are the real bookings and counting both double-books the panel's team.
    static func bookings(in jobs: [Job], people: [Person],
                         excluding jobID: String? = nil) -> [Booking] {
        var out: [Booking] = []

        for job in jobs where job.id != jobID {
            for panel in job.subs {
                if panel.subs.isEmpty, panel.status != .finished,
                   !panel.start.isEmpty, !panel.end.isEmpty {
                    for person in panel.team {
                        out.append(Booking(personID: person, start: panel.start, end: panel.end))
                    }
                }
                for op in panel.subs where op.status != .finished
                    && !op.start.isEmpty && !op.end.isEmpty {
                    for person in op.team {
                        out.append(Booking(personID: person, start: op.start, end: op.end))
                    }
                }
            }
        }

        for person in people {
            for off in person.timeOff where !off.start.isEmpty && !off.end.isEmpty {
                out.append(Booking(personID: person.id, start: off.start, end: off.end))
            }
        }
        return out
    }

    /// Bookings indexed by person, so the scan is a dictionary hit rather than a
    /// walk of every booking in the org per person per candidate day.
    static func bookingIndex(_ bookings: [Booking]) -> [String: [Booking]] {
        Dictionary(grouping: bookings, by: \.personID)
    }

    static func isFree(_ personID: String, from start: String, to end: String,
                       in index: [String: [Booking]]) -> Bool {
        guard let mine = index[personID] else { return true }
        // Overlap, not containment: `start <= theirEnd && end >= theirStart`.
        return !mine.contains { $0.start <= end && $0.end >= start }
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
        var bookings: [String: [Booking]] = [:]
        /// `TD` — today, as `yyyy-MM-dd`. Passed in rather than read, so a test
        /// can state the day.
        var today: String
        /// How many windows to offer. The web shows three.
        var wanted = 3
        /// `maxScan` — how many candidate days to try before giving up.
        var maxScan = 200
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

        for unit in request.units {
            let unitEnd = request.calendar.addingWorkDays(unit.durationDays - 1, to: cursor)
            let eligible = crew(for: unit.department, from: request.crew)
            let free = eligible.filter {
                isFree($0.id, from: cursor, to: unitEnd, in: request.bookings)
            }
            // Nobody can take this unit on these days, so this whole start day
            // fails — the web abandons the window the same way.
            guard !free.isEmpty else { return nil }

            placements.append(SchedulePlacement(
                unitID: unit.id, panelID: unit.panelID,
                start: cursor, end: unitEnd,
                // ONE person per unit, the first free and best-matched. The web
                // splits a batch across a crew when a panel is replicated; a job
                // being created has each unit once, so "who does this" has one
                // answer. `crew(for:)` has already put primary-department matches
                // ahead of secondary ones.
                team: [free[0].id]))

            totalDays += unit.durationDays
            cursor = request.calendar.addingWorkDays(unit.durationDays, to: cursor)
        }

        guard let last = placements.last else { return nil }

        // "Available" is measured against the FIRST unit's span, not the whole
        // run. The web's comment says why: requiring everyone to be free for a
        // batch that can be many days long pushed recommendations later than
        // they needed to be.
        let firstSpan = placements[0]
        let available = request.crew.filter {
            isFree($0.id, from: firstSpan.start, to: firstSpan.end, in: request.bookings)
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
