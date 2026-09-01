import SwiftUI
import Combine

// MARK: - Schedule V1 (Day timeline) · TRAQS Light
// Lives in GanttView.swift / struct GanttView for back-compat (MainTabView routes
// the Schedule tab to this view). Re-styled to the TRAQS Light language —
// 7AM–6PM vertical hour grid, department-stripe blocks, sky NOW line.

struct GanttView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav

    @State private var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    @State private var segment: ScheduleSegment = .day
    @State private var now: Date = Date()
    /// Tapping a timeline block sets this, which presents the job-detail popup.
    @State private var selectedBlock: ScheduleBlock?
    private let cal = Calendar.current
    /// `@State`, NOT `let` — a stored publisher is a new object on every rebuild,
    /// which makes SwiftUI re-evaluate this whole body whenever the parent
    /// re-renders. See the same note in TimeClockView.
    @State private var nowTimer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    enum ScheduleSegment: String, CaseIterable, Hashable { case day, week
        var label: String { rawValue.capitalized }
    }

    // Body is just the scrollable timeline content — the Jobs hub (JobsHubView)
    // supplies the surrounding NavigationStack, header and add-job sheet.
    // Tapping a block opens ScheduleJobSheet (a popup) rather than pushing.
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {

            // Scrolls with the timeline, and through the SAME view the list mode
            // uses — the two modes must not grow separate titles.
            // Title and Day/Week share ONE row. The toggle had a row of its
            // own, which spent a whole band of page on a control that fits
            // beside the title — and pushed the timeline, the thing you came
            // here to read, that much further down.
            //
            // `JobsHeaderBar` is untouched and still carries its own 16pt
            // gutters: it is the SAME view the jobs list draws, so the two
            // modes cannot grow different titles. Only the composition around
            // it differs here.
            HStack(alignment: .center, spacing: 0) {
                JobsHeaderBar()
                GlassSegmented(
                    options: ScheduleSegment.allCases,
                    labels: Dictionary(uniqueKeysWithValues: ScheduleSegment.allCases.map { ($0, $0.label) }),
                    selection: $segment)
                    // Fixed, and narrow enough to leave the 56pt title its
                    // width on a small phone — the title has no shrink-to-fit,
                    // so whatever this takes, it takes for good.
                    .frame(width: 168)
                    .padding(.trailing, 16)
            }
            .padding(.top, pageTitleTopInset)
            .padding(.bottom, 8)

            Group {
                if segment == .day {
                    dayContent
                } else {
                    weekContent
                }
            }
            // Scoped to the swapped branches rather than sitting on the ScrollView,
            // so flipping Day/Week doesn't animate the segmented control and stat
            // strip along with the timeline.
            .animation(.easeInOut(duration: 0.18), value: segment)
            }
            .padding(.top, 2)
        }
        .scrollIndicators(.visible)
        // Tick only while the gantt is the mode actually on screen. JobsHubView keeps
        // BOTH this and TasksView mounted and crossfades them by opacity, so without
        // the jobsMode check this timer kept re-running the packer behind the jobs
        // list, where none of its output can be seen.
        .onReceive(nowTimer) { _ in if appNav.selected == .jobs && appNav.jobsMode == .gantt { now = Date() } }
        .sheet(item: $selectedBlock) { block in
            ScheduleJobSheet(block: block)
        }
    }

    /// Whether the gantt is the mode currently showing. JobsHubView mounts this view
    /// permanently at `opacity 0` when the jobs LIST is showing, so `body` runs
    /// regardless — this gates the expensive packing so an invisible timeline costs
    /// nothing, and the list↔gantt crossfade isn't competing with a full repack.
    private var isShowing: Bool { appNav.jobsMode == .gantt }

    // MARK: Day / Week content
    //
    // Both branches compute their schedule blocks EXACTLY ONCE per render and pass
    // concrete arrays down. Two earlier rounds of jank came from not doing that:
    // first the week branch handed a recomputing `blocks(for:)` closure to WeekGrid,
    // whose `endHour`/`height` and per-column/legend reads re-ran that
    // O(jobs×panels×ops) work 50–100+ times per render; then `weekBlocksByDate()`
    // still called a per-day packer once per column, each re-walking every job.
    // `packedBlocks` now collects the task list once and walks days over it, so a
    // week costs about what one day used to — and `isShowing` skips the work
    // entirely while the jobs LIST is the visible mode.

    @ViewBuilder
    private var dayContent: some View {
        let day = cal.startOfDay(for: selectedDate)
        let dayBlocks = isShowing ? (packedBlocks(for: [day])[day] ?? []) : []
        DateSelector(date: $selectedDate)
            .padding(.bottom, 10)
        DayTimeline(date: selectedDate,
                    now: now,
                    blocks: dayBlocks,
                    spans: isShowing ? clockSpans(on: day) : [],
                    workStart: appState.orgSettings.workStartHour,
                    workEnd: appState.orgSettings.workEndHour,
                    lunchStart: appState.orgSettings.lunchStartHour,
                    lunchDurationH: Double(appState.orgSettings.lunch.durationMinutes) / 60,
                    onSelect: { selectedBlock = $0 })
            .transition(.opacity)
    }

    @ViewBuilder
    private var weekContent: some View {
        let byDate = isShowing ? packedBlocks(for: weekDates) : [:]
        let allWeek = weekDates.flatMap { byDate[$0] ?? [] }
        WeekHeaderBar(weekDates: weekDates, selected: $selectedDate)
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        WeekGrid(weekDates: weekDates,
                 today: cal.startOfDay(for: Date()),
                 now: now,
                 workStart: appState.orgSettings.workStartHour,
                 workEnd: appState.orgSettings.workEndHour,
                 blocksByDate: byDate,
                 spansByDate: isShowing ? spansByDate(weekDates) : [:],
                 onSelect: { selectedBlock = $0 })
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        WeekLegendRow(blocks: allWeek)
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .transition(.opacity)
    }

    // MARK: Punched break / lunch spans
    //
    // The scheduled lunch (LunchGhostBlock) is a PLAN — same hour every day,
    // whether or not anyone punched. These are the spans actually taken, drawn
    // over the timeline where they happened. The pairing walk lives in
    // `ClockOverlays` (pure, testable); this just supplies the three sources.
    //
    // No extra fetch: `timeclockEntries` is already warmed by loadAll, and a
    // punch made seconds ago shows immediately because `activeClockIn.events`
    // and `activeBreak` are updated optimistically by the clock actions.

    private func clockSpans(on day: Date) -> [ClockOverlays.Span] {
        ClockOverlays.spans(
            day: day,
            personId: appState.currentPersonId,
            entries: appState.timeclockEntries,
            liveEvents: appState.currentPerson?.activeClockIn?.events ?? [],
            activeBreak: appState.myActiveBreak,
            now: now,
            calendar: cal)
    }

    private func spansByDate(_ days: [Date]) -> [Date: [ClockOverlays.Span]] {
        var out: [Date: [ClockOverlays.Span]] = [:]
        for d in days {
            let list = clockSpans(on: d)
            if !list.isEmpty { out[cal.startOfDay(for: d)] = list }
        }
        return out
    }

    // MARK: Week dates (Mon→Sun around selectedDate, filtered to work days)

    /// Mirrors the desktop's `isWorkDay`. orgSettings.workDays uses
    /// JS day-of-week (0=Sun…6=Sat); Calendar uses 1=Sun…7=Sat.
    private func isWorkDay(_ date: Date) -> Bool {
        let jsDay = cal.component(.weekday, from: date) - 1
        return appState.orgSettings.workDays.contains(jsDay)
    }

    private var weekDates: [Date] {
        let weekday = cal.component(.weekday, from: selectedDate)
        let toMon = weekday == 1 ? -6 : -(weekday - 2)
        guard let mon = cal.date(byAdding: .day, value: toMon, to: cal.startOfDay(for: selectedDate))
        else { return [] }
        let allSeven = (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: mon) }
        // Hide non-work days from the week grid — the user's org setting
        // says Mon–Fri only, so Sat/Sun columns shouldn't even appear.
        // If somehow workDays is empty (mis-saved config), fall back to
        // showing all 7 so the view never collapses to nothing.
        let filtered = allSeven.filter(isWorkDay)
        return filtered.isEmpty ? allSeven : filtered
    }

    // MARK: Data → schedule blocks
    //
    // Our schema doesn't carry time-of-day on panels/ops, so work is PACKED
    // sequentially from workStart, each task sized by its hpd, with lunch reserved.
    //
    // A day absorbs only `paidHoursPerDay` — workStart→workEnd MINUS lunch, the
    // org's real schedulable capacity. Not `hpd`, which takes no account of lunch
    // (see OrgSettings.paidHoursPerDay: a 07:00–15:00 shop with a 1h lunch has hpd
    // 8 but only 7 schedulable hours), so a single full-day task used to spill past
    // workEnd entirely on its own.
    //
    // Whatever doesn't fit ROLLS FORWARD onto the next work day instead of
    // stretching the lane into the evening. Nothing is dropped — the original
    // "missing jobs" bug was a hard cap that DISCARDED overflow, and the fix for it
    // (growing the timeline to fit) traded that for a day that scrolled past
    // midnight. Deferring the overflow keeps every task visible AND keeps the lane
    // inside org hours; an over-allocated week now shows its slip as later days
    // filling up, which is the thing worth seeing.

    /// How many hours of real work one day can absorb. Floored so a mis-saved
    /// shift window (workEnd ≤ workStart) can't produce a zero-capacity day and
    /// spin the roll-forward walk.
    private var dayCapacity: Double { max(0.5, appState.orgSettings.paidHoursPerDay) }

    /// How far back the roll-forward walk may start. The walk has to begin at the
    /// earliest task it's carrying, because what lands on Wednesday depends on what
    /// spilled out of Monday — but it can't walk from the beginning of time, so
    /// tasks older than this are treated as starting at the floor.
    private static let maxLookbackDays = 60

    /// One task's slice of a single day: the hours it gets, plus how many of its own
    /// hours already landed on earlier days. `placedBefore` is what lets the worked
    /// stripe pour front-to-back across the whole task instead of restarting daily.
    private struct _DayAllocation {
        let item: _ScheduleItem
        let hours: Double
        let placedBefore: Double
    }

    /// Packed blocks for every requested day, computed in ONE pass.
    ///
    /// The day and week branches both call this. The week view used to call a
    /// per-day packer 5–7 times, each re-walking every job/panel/op; this collects
    /// the task list once and walks days over it, so a week costs about what a
    /// single day used to.
    private func packedBlocks(for days: [Date]) -> [Date: [ScheduleBlock]] {
        let allocs = allocations(forVisible: days)
        var out: [Date: [ScheduleBlock]] = [:]
        for (day, list) in allocs { out[day] = blocks(on: day, allocations: list) }
        return out
    }

    /// Walk work days from the earliest carried task up to the last visible day,
    /// handing each day out to the queue until capacity runs out. Only days the
    /// caller asked for are retained; the earlier ones exist to establish what has
    /// already rolled forward into view.
    ///
    /// The walk itself lives in `SchedulePacker` — pure, and unit-tested there.
    private func allocations(forVisible days: [Date]) -> [Date: [_DayAllocation]] {
        let wanted = Set(days.map { cal.startOfDay(for: $0) })
        guard let firstVisible = wanted.min(), let lastVisible = wanted.max() else { return [:] }

        let lookbackFloor = cal.date(byAdding: .day, value: -Self.maxLookbackDays, to: firstVisible) ?? firstVisible
        let items = scheduleItems(from: lookbackFloor, to: lastVisible)
        guard !items.isEmpty else { return [:] }

        // A task can't start before its own start date — nor before the lookback
        // floor, which is as far back as the walk reaches.
        let tasks = items.map { item in
            SchedulePacker.Task(
                hpd: item.hpd,
                totalHours: item.totalHours,
                earliest: max(lookbackFloor, item.taskStart.map { cal.startOfDay(for: $0) } ?? lookbackFloor))
        }

        let sliced = SchedulePacker.allocate(
            tasks: tasks,
            from: tasks.map(\.earliest).min() ?? firstVisible,
            through: lastVisible,
            keep: wanted,
            capacity: dayCapacity,
            isWorkDay: { isWorkDay($0) },
            nextDay: { cal.date(byAdding: .day, value: 1, to: $0) },
            // Belt-and-braces bound: the lookback plus a generous visible span, so
            // a corrupt date can never turn the walk into an unbounded loop.
            maxDays: Self.maxLookbackDays + 400)

        var out: [Date: [_DayAllocation]] = [:]
        for (day, slices) in sliced {
            out[day] = slices.map {
                _DayAllocation(item: items[$0.taskIndex], hours: $0.hours, placedBefore: $0.placedBefore)
            }
        }
        return out
    }

    /// Every task assigned to the current user that overlaps the walk window, in
    /// queue order.
    private func scheduleItems(from horizonStart: Date, to horizonEnd: Date) -> [_ScheduleItem] {
        // No resolved identity → NOTHING, not everything.
        //
        // `me` used to be an Optional that every membership test below waved
        // through (`me == nil || op.team.contains(me!)`), so a launch that
        // hadn't matched the roster yet packed the WHOLE ORG's work onto this
        // timeline — the "wrong job shows" half of the report, and the reason
        // the gantt could disagree with the list for the same person.
        // TasksView.myTasks has always guarded this way; the two views have to
        // agree on what "mine" means.
        guard let me = appState.currentPersonId else { return [] }
        let rangeStart = cal.startOfDay(for: horizonStart)
        let rangeEnd = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: horizonEnd)) ?? horizonEnd
        var items: [_ScheduleItem] = []

        for job in appState.jobs {
            // Finished work is not schedulable, and leaving it in was the "no
            // job shows" half of the report: the roll-forward walk reaches 60
            // days back, so a job completed weeks ago still claimed its full
            // hpd × span budget, ate the capacity of every day between, and
            // pushed today's live task off the visible day. Dropping finished
            // jobs also matches TasksView.myTasks.
            if job.status == .finished { continue }
            for panel in job.subs {
                if panel.status == .finished { continue }
                guard panel.start.asDate.map({ $0 < rangeEnd }) ?? false,
                      panel.end.asDate.map({ $0 >= rangeStart }) ?? false
                else { continue }

                let myOps = panel.subs.filter { op in
                    guard op.status != .finished else { return false }
                    guard op.start.asDate.map({ $0 < rangeEnd }) ?? false,
                          op.end.asDate.map({ $0 >= rangeStart }) ?? false
                    else { return false }
                    return op.team.contains(me)
                }

                if !myOps.isEmpty {
                    for op in myOps {
                        let (lbl, col) = deptForOp(op, fallback: deptColor(for: job, panel: panel))
                        items.append(makeItem(job: job, panel: panel, op: op,
                                              title: op.title.isEmpty ? panel.title : op.title,
                                              color: col, typeLabel: lbl,
                                              hpd: max(op.hpd > 0 ? op.hpd : panel.hpd, 0.5)))
                    }
                } else if panel.team.contains(me),
                          // The panel fallback is for panels I'm on where I have
                          // no op of my own — NOT for panels whose ops are mine
                          // and merely finished. Without this second test,
                          // filtering finished ops above would resurrect the
                          // completed work as one full-panel bar.
                          !panel.subs.contains(where: { $0.team.contains(me) }) {
                    // NB: intentionally NOT falling back to job.team here.
                    // Job-level membership (typical for admins/watchers with no
                    // actual panel/op assignment) isn't scheduled work; including
                    // it packed every panel of every job they're loosely attached
                    // to into their timeline — the same inflation TasksView.myTasks
                    // was fixed to avoid. Keep the two views consistent.
                    items.append(makeItem(job: job, panel: panel, op: nil,
                                          title: panel.title.isEmpty ? job.title : panel.title,
                                          color: deptColor(for: job, panel: panel),
                                          typeLabel: deptLabel(for: job, panel: panel),
                                          hpd: max(panel.hpd > 0 ? panel.hpd : 1.0, 0.5)))
                }
            }
        }

        // Queue order: earliest task first — with work rolling forward, whoever
        // started first has the prior claim on a day. The old (jobNumber, panelId)
        // key stays as the tie-break so packing is stable across renders.
        items.sort {
            let a = $0.taskStart ?? .distantFuture
            let b = $1.taskStart ?? .distantFuture
            if a != b { return a < b }
            return ($0.job.jobNumber ?? "") + $0.panel.id < ($1.job.jobNumber ?? "") + $1.panel.id
        }
        return items
    }

    private func makeItem(job: Job, panel: Panel, op: Operation?, title: String,
                          color: Color, typeLabel: String, hpd: Double) -> _ScheduleItem {
        let tStart = (op?.start ?? panel.start).asDate
        let tEnd   = (op?.end   ?? panel.end  ).asDate
        let span   = businessDaySpan(from: tStart, to: tEnd)
        return _ScheduleItem(job: job, panel: panel, op: op,
                             title: title,
                             color: color, typeLabel: typeLabel, hpd: hpd,
                             taskStart: tStart, taskEnd: tEnd,
                             totalHours: hpd * Double(max(1, span)))
    }

    /// Lay one day's allocations onto the clock, starting at workStart and stepping
    /// around lunch. Capacity is workStart→workEnd minus lunch, so the last block
    /// lands on workEnd exactly — the lane never runs past org hours.
    private func blocks(on day: Date, allocations: [_DayAllocation]) -> [ScheduleBlock] {
        let s = appState.orgSettings
        let workStart:  Double = s.workStartHour
        let lunchStart: Double = s.lunchStartHour
        let lunchEnd:   Double = s.lunchStartHour + Double(s.lunch.durationMinutes) / 60

        var cursor = workStart
        var out: [ScheduleBlock] = []
        for alloc in allocations {
            var remaining = alloc.hours
            // Hours logged against this op across its whole life, plus any live
            // session on this day. Compared against `placedBefore` so the fill
            // pours front-to-back over the task's entire run.
            let workedTotal = workedHours(for: alloc.item, on: day)
            var workedPacked: Double = 0   // hours of this alloc already emitted today

            // Skip past lunch if the cursor lands inside it.
            if cursor >= lunchStart && cursor < lunchEnd { cursor = lunchEnd }

            // First chunk: up to lunchStart (if we're before lunch) or unbounded.
            let firstCapEdge = cursor < lunchStart ? lunchStart : .infinity
            let firstChunk = min(remaining, firstCapEdge - cursor)
            if firstChunk > 0.01 {
                out.append(makeBlock(alloc, on: day, start: cursor, end: cursor + firstChunk,
                                     workedBefore: workedPacked, workedTotal: workedTotal))
                cursor += firstChunk
                remaining -= firstChunk
                workedPacked += firstChunk
            }
            // Second chunk: anything left after lunch.
            if remaining > 0.01, cursor >= lunchStart, cursor <= lunchEnd {
                cursor = lunchEnd
                out.append(makeBlock(alloc, on: day, start: cursor, end: cursor + remaining,
                                     workedBefore: workedPacked, workedTotal: workedTotal))
                cursor += remaining
                workedPacked += remaining
            }
        }
        return out
    }

    /// Worked hours to pour into a task's blocks. A finished op fills everything;
    /// otherwise it's the logged total plus any session running on this day, so a
    /// worker's current hour shows on today's bar right away.
    private func workedHours(for item: _ScheduleItem, on day: Date) -> Double {
        guard let op = item.op else { return 0 }
        if op.status == .finished { return .greatestFiniteMagnitude }
        // Greater of the counter and the job-clock session rows, matching
        // AppState.opHoursPair — otherwise a timeline stripe and the same op's
        // percentage elsewhere in the app disagree.
        return max(op.loggedHours ?? 0, appState.producedFor(op: op))
            + appState.liveHours(forOp: op, on: day)
    }

    private func makeBlock(_ alloc: _DayAllocation, on day: Date,
                           start: Double, end: Double,
                           workedBefore: Double, workedTotal: Double) -> ScheduleBlock {
        let it = alloc.item
        let clientName = it.job.clientId
            .flatMap { cid in appState.clients.first(where: { $0.id == cid })?.name }
            .flatMap { $0.isEmpty ? nil : $0 }
        // This chunk's share of the task's worked hours. `placedBefore` covers
        // earlier DAYS, `workedBefore` covers earlier chunks of THIS day, so the
        // fill flows continuously across a lunch split and across a roll-forward.
        let chunkHours = max(0.0001, end - start)
        let consumedBefore = alloc.placedBefore + workedBefore
        let workedInChunk = min(max(0, workedTotal - consumedBefore), chunkHours)
        let workedFraction = workedInChunk / chunkHours
        return ScheduleBlock(
            // Day is part of the id: with work rolling forward, one task legitimately
            // appears on several days, and the week grid flattens every day's blocks
            // into one legend.
            id: "\(Int(day.timeIntervalSince1970))/\(it.panel.id)/\(it.op?.id ?? "panel")/\(Int(start * 60))",
            job: it.job,
            jobId: it.job.id,
            jobNumber: it.job.jobNumber ?? "",
            panelId: it.panel.id,
            opId: it.op?.id,
            // Headline = customer when we have one, else the job title. The
            // line under it carries the task and, beside it, the subtask.
            title: clientName ?? it.job.title,
            taskTitle: it.panel.title,
            subtaskTitle: it.op?.title,
            color: it.color,
            typeLabel: it.typeLabel,
            start: start, end: end,
            taskStart: it.taskStart,
            taskEnd: it.taskEnd,
            totalHours: it.totalHours,
            workedFraction: workedFraction)
    }

    /// Inclusive count of business days (per orgSettings.workDays) between two dates.
    /// Returns 0 if either date is nil. Used for each task's total hour budget.
    private func businessDaySpan(from start: Date?, to end: Date?) -> Int {
        guard let s = start, let e = end, s <= e else { return 0 }
        let workDays = Set(appState.orgSettings.workDays)
        var count = 0
        var d = cal.startOfDay(for: s)
        let stop = cal.startOfDay(for: e)
        while d <= stop {
            // Calendar.weekday: Sun=1 ... Sat=7. orgSettings.workDays uses Sun=0 ... Sat=6.
            let dow = cal.component(.weekday, from: d) - 1
            if workDays.contains(dow) { count += 1 }
            guard let next = cal.date(byAdding: .day, value: 1, to: d) else { break }
            d = next
        }
        return count
    }

    private func deptForOp(_ op: Operation, fallback: Color) -> (String, Color) {
        let key = op.title.lowercased()
        switch key {
        case _ where key.contains("layout"):  return ("LAYOUT",  Color(hex: T.magenta))
        case _ where key.contains("wire"):    return ("WIRE",    Color(hex: T.cyan))
        case _ where key.contains("cut"):     return ("CUT",     Color(hex: T.yellow))
        case _ where key.contains("inspect"): return ("INSPECT", Color(hex: T.lavender))
        case _ where key.contains("repair"):  return ("REPAIR",  Color(hex: T.amber))
        case _ where key.contains("install"): return ("INSTALL", Color(hex: T.magenta))
        case _ where key.contains("callback"):return ("CALLBACK", Color(hex: T.red))
        case _ where key.contains("contract"):return ("CONTRACT", Color(hex: T.green))
        default: return (op.title.uppercased(), fallback)
        }
    }

    private func deptColor(for job: Job, panel: Panel) -> Color {
        let key = (job.jobType ?? panel.title).lowercased()
        switch key {
        case _ where key.contains("layout"):  return Color(hex: T.magenta)
        case _ where key.contains("wire"):    return Color(hex: T.cyan)
        case _ where key.contains("cut"):     return Color(hex: T.yellow)
        case _ where key.contains("inspect"): return Color(hex: T.lavender)
        case _ where key.contains("repair"):  return Color(hex: T.amber)
        case _ where key.contains("install"): return Color(hex: T.magenta)
        case _ where key.contains("callback"):return Color(hex: T.red)
        case _ where key.contains("contract"):return Color(hex: T.green)
        default:                              return Color(hex: job.color)
        }
    }

    private func deptLabel(for job: Job, panel: Panel) -> String {
        if let t = job.jobType, !t.isEmpty { return t.uppercased() }
        if !panel.title.isEmpty { return panel.title.uppercased() }
        return "JOB"
    }
}

// One schedulable task, resolved once per render and then fed to the
// roll-forward walk. `totalHours` is the task's whole budget (hpd × business-day
// span); `hpd` stays its per-DAY ceiling, which is what keeps a normally-loaded
// day packed exactly as it was before overflow started rolling forward.
private struct _ScheduleItem {
    let job: Job
    let panel: Panel
    let op: Operation?
    let title: String
    let color: Color
    let typeLabel: String
    let hpd: Double
    let taskStart: Date?
    let taskEnd: Date?
    let totalHours: Double
}

// MARK: - Schedule block model

struct ScheduleBlock: Identifiable, Equatable {
    let id: String
    let job: Job              // full reference so tapping a block can push the detail view
    let jobId: String
    let jobNumber: String
    let panelId: String       // panel this block represents
    let opId: String?         // op within the panel, when the user is on an op's team
    /// The JOB — customer name when we have one, else the job's title. The bold
    /// line on the bar.
    let title: String
    /// The panel ("task") this block belongs to.
    let taskTitle: String
    /// The operation ("subtask") within it, when the block is op-level. nil when
    /// the user is on the panel's team with no op of their own.
    let subtaskTitle: String?
    let color: Color
    let typeLabel: String
    let start: Double         // hours-of-day, e.g. 8.5
    let end: Double
    let taskStart: Date?      // op.start (or panel.start when no op) — the task's calendar start
    let taskEnd: Date?        // op.end (or panel.end when no op) — the task's calendar end
    let totalHours: Double    // hpd × business-day span of the task
    let workedFraction: Double // 0...1 of the op's estimate logged so far (0 for panel-level blocks)

    static func == (lhs: ScheduleBlock, rhs: ScheduleBlock) -> Bool { lhs.id == rhs.id }
}

/// Carrier used by NavigationLink → JobDetailView so the detail view knows
/// which panel / op to highlight + auto-expand.
struct ScheduleFocus: Hashable {
    let job: Job
    let panelId: String?
    let opId: String?
}

// MARK: - Date selector (◂ DATE ▸) + Today pill

private struct DateSelector: View {
    @Binding var date: Date
    private let cal = Calendar.current

    private var subTitle: String {
        cal.isDateInToday(date) ? "Today"
            : cal.isDateInTomorrow(date) ? "Tomorrow"
            : cal.isDateInYesterday(date) ? "Yesterday"
            : DateFormatter.dayShort.string(from: date).uppercased()
    }
    private var mainTitle: String {
        DateFormatter.dayFull.string(from: date)
    }

    var body: some View {
        // ONE centred cluster: ‹ · date · › · TODAY. These used to sit at
        // opposite ends of the row with a Spacer between them, which read as two
        // unrelated controls rather than one date picker.
        HStack(alignment: .center, spacing: 8) {
            Spacer(minLength: 0)
            // Left: chevron · date · chevron
            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    date = cal.date(byAdding: .day, value: -1, to: date) ?? date
                }
            } label: {
                TIconView(icon: .chev, size: 11, color: Color(hex: T.ink))
                    .scaleEffect(x: -1)
                    .padding(6)
                    .background(Circle().fill(Color(hex: T.surface)))
                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
            }
            .buttonStyle(.plain)

            // FIXED width. The date's own width changes as you page through
            // days ("Tue · Sep 1" vs "Wed · Sep 10"), and in a centred cluster
            // that would slide the chevrons and TODAY sideways under your
            // thumb. Wide enough for the longest form.
            VStack(alignment: .center, spacing: 0) {
                Text(subTitle)
                    .font(.custom(TFontName.bold.rawValue, size: 9))
                    .kerning(1.3)
                    .textCase(.uppercase)
                    .foregroundStyle(Color(hex: T.muted))
                    .lineLimit(1)
                Text(mainTitle)
                    .font(.custom(TFontName.bold.rawValue, size: 14))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .frame(width: 108)

            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    date = cal.date(byAdding: .day, value: 1, to: date) ?? date
                }
            } label: {
                TIconView(icon: .chev, size: 11, color: Color(hex: T.ink))
                    .padding(6)
                    .background(Circle().fill(Color(hex: T.surface)))
                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
            }
            .buttonStyle(.plain)

            // TODAY sits WITH the arrows now, not across the row from them —
            // it is the third way of moving the same date.
            PillBtn("TODAY", compact: true) {
                withAnimation(.easeInOut(duration: 0.22)) {
                    date = cal.startOfDay(for: Date())
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Day timeline

private struct DayTimeline: View {
    let date: Date
    let now: Date
    let blocks: [ScheduleBlock]
    /// Break / lunch actually punched on this day — drawn OVER the blocks.
    let spans: [ClockOverlays.Span]
    /// Org-aware shift window (overrides the previously hardcoded 8a–5p / 12–1 lunch).
    let workStart: Double
    let workEnd: Double
    let lunchStart: Double
    let lunchDurationH: Double
    let onSelect: (ScheduleBlock) -> Void
    private let pxPerHour: CGFloat = 56
    private let cal = Calendar.current

    private var startHour: Double { workStart }

    /// The lane runs workStart→workEnd, full stop. The packer now caps each day at
    /// the org's schedulable capacity and rolls the remainder onto the next work
    /// day, so nothing is placed past workEnd and nothing needs hiding — this used
    /// to grow to `max(workEnd, lastBlockEnd)`, which is how an overbooked day
    /// turned into a timeline scrolling past midnight.
    ///
    /// The max() is a floor guard only: it keeps a block visible if a rounding
    /// remainder ever lands a hair past workEnd, and is capped at midnight so no
    /// data shape can stretch the lane into a second day.
    private var endHour: Double {
        let lastBlockEnd = blocks.map(\.end).max() ?? workEnd
        return min(24, max(workEnd, lastBlockEnd.rounded(.up)))
    }

    var body: some View {
        let totalH = endHour - startHour
        let height = CGFloat(totalH + 1) * pxPerHour

        return HStack(alignment: .top, spacing: 8) {
            // Hour labels
            VStack(alignment: .leading, spacing: 0) {
                ForEach(0...Int(totalH), id: \.self) { i in
                    // % 24 first: without it hour 25 rendered "1 PM" and hour 48
                    // "12 PM", so an overbooked lane showed the same afternoon over
                    // and over. endHour is bounded now, but the label math should
                    // still be correct on its own.
                    let h = (Int(startHour) + i) % 24
                    let ampm = h < 12 ? "AM" : "PM"
                    let display = ((h + 11) % 12) + 1
                    Text("\(display) \(ampm)")
                        .font(TTypo.mono(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                        .frame(height: pxPerHour, alignment: .topLeading)
                }
            }
            .frame(width: 42)

            // Lane
            ZStack(alignment: .topLeading) {
                // Hour rules
                VStack(spacing: 0) {
                    ForEach(0...Int(totalH), id: \.self) { _ in
                        VStack(spacing: 0) {
                            Rectangle().fill(Color(hex: T.hair)).frame(height: 1)
                            Spacer().frame(height: pxPerHour - 1)
                        }
                    }
                }
                .frame(height: height, alignment: .top)

                // Lunch ghost block (dashed, muted) — driven by orgSettings.lunch
                let lunchTop = CGFloat(lunchStart - startHour) * pxPerHour + 2
                let lunchHeight = CGFloat(lunchDurationH) * pxPerHour - 4
                LunchGhostBlock(height: max(20, lunchHeight))
                    .padding(.horizontal, 6)
                    .offset(y: lunchTop)

                // Blocks — tap to open the job-detail popup. The packer keeps every
                // block inside workStart…workEnd, so the filter/clamp below are a
                // safety net rather than the thing deciding what's visible;
                // overflow is deferred to the next work day, not clipped here.
                ForEach(blocks.filter { $0.start < endHour }) { b in
                    let clampedEnd = min(b.end, endHour)
                    let top = CGFloat(b.start - startHour) * pxPerHour + 2
                    let h = max(20, CGFloat(clampedEnd - b.start) * pxPerHour - 4)
                    Button { onSelect(b) } label: {
                        ScheduleBlockView(block: b, height: h)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 6)
                    .offset(y: top)
                }

                // Punched break / lunch, over the blocks. Translucent on
                // purpose — the bar underneath has to stay readable, since the
                // point of the overlay is showing WHICH task the rest
                // interrupted. Never interactive: tapping through to the block
                // is the behaviour you want.
                ForEach(spans) { span in
                    let s0 = max(startHour, hourOfDay(span.start))
                    let e0 = min(endHour, hourOfDay(span.end))
                    if e0 > s0 {
                        ClockSpanBand(span: span,
                                      height: max(18, CGFloat(e0 - s0) * pxPerHour),
                                      compact: false)
                            .padding(.horizontal, 6)
                            .offset(y: CGFloat(s0 - startHour) * pxPerHour)
                            .allowsHitTesting(false)
                    }
                }

                // NOW line — only on today.
                // Pill sits INSIDE the lane (no longer in the hour-label gutter),
                // so it can't collide with the hour label at the same row.
                if cal.isDateInToday(date) {
                    let nowHour = hourOfDay(now)
                    if nowHour >= startHour, nowHour <= endHour {
                        let y = CGFloat(nowHour - startHour) * pxPerHour
                        ZStack(alignment: .leading) {
                            Rectangle()
                                .fill(Color(hex: T.sky).opacity(0.55))
                                .frame(height: 1)
                            Text("NOW")
                                .font(.custom(TFontName.bold.rawValue, size: 9))
                                .kerning(0.6)
                                .foregroundStyle(T.onAccent)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Capsule().fill(Color(hex: T.sky)))
                                .offset(y: -1)
                                .padding(.leading, 4)
                        }
                        .offset(y: y)
                        .allowsHitTesting(false)
                    }
                }
            }
            .frame(height: height, alignment: .top)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 32)
    }

    private func hourOfDay(_ d: Date) -> Double {
        let comps = cal.dateComponents([.hour, .minute], from: d)
        return Double(comps.hour ?? 0) + Double(comps.minute ?? 0) / 60
    }
}

private struct LunchGhostBlock: View {
    let height: CGFloat
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "fork.knife")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color(hex: T.muted))
            Text("Lunch")
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.0)
            Spacer()
        }
        .frame(height: height, alignment: .center)
        .padding(.horizontal, 12)
        .background(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous).fill(.clear))
        .overlay(
            RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .foregroundStyle(Color(hex: T.hair))
        )
    }
}

// MARK: - Punched break / lunch band
//
// A YELLOW filler from the punch-in to the punch-out, laid OVER the schedule
// bars and labelled with which rest it was and how long. Over, never instead of:
// the useful reading is "this break interrupted THAT task", which needs both
// visible at once — so the fill is translucent and the edges carry the colour.
//
// Break and lunch share one yellow deliberately; the LABEL is what tells them
// apart. Two similar yellows would have to be told apart by hue at a glance,
// which is exactly the job a word does better.
//
// Distinct from `LunchGhostBlock`, which is the org's SCHEDULED lunch window —
// a dashed outline in the same lane. Plan is an outline, record is a fill; on a
// day where the two agree they sit on top of each other and read as one.
private struct ClockSpanBand: View {
    let span: ClockOverlays.Span
    let height: CGFloat
    /// Week columns are ~40pt wide — no room for the label pill.
    let compact: Bool

    private var tint: Color { Color(hex: T.yellow) }

    /// "BREAK · 15m", or "BREAK · 15m…" while the punch is still open.
    private var label: String {
        "\(span.kind.label) · \(span.minutes)m\(span.isOpen ? "…" : "")"
    }

    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous)
                .fill(tint.opacity(0.38))
                // Solid leading rail + top/bottom rules. The bottom rule fades
                // on an OPEN span: that edge is still moving, and a hard line
                // would read as a rest that happens to end at this minute.
                .overlay(alignment: .top) {
                    Rectangle().fill(tint.opacity(0.95)).frame(height: 1)
                }
                .overlay(alignment: .bottom) {
                    Rectangle().fill(tint.opacity(span.isOpen ? 0.25 : 0.95)).frame(height: 1)
                }
                .overlay(alignment: .leading) {
                    Rectangle().fill(tint.opacity(0.95)).frame(width: compact ? 2 : 4)
                }
                .clipShape(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous))
                .frame(height: height)

            // ALWAYS labelled, at any height. A 15-minute break is only ~14pt
            // tall at this scale, so gating the label on the band being tall
            // enough to contain it meant the short rests — the common ones —
            // were unlabelled stripes. The pill is centred and allowed to
            // overhang a thin band instead, which stays readable.
            if !compact {
                HStack(spacing: 5) {
                    Image(systemName: span.kind == .lunch ? "fork.knife" : "cup.and.saucer.fill")
                        .font(.system(size: 9, weight: .bold))
                    Text(label)
                        .font(TTypo.xsBold(10))
                        .tLabel(tracking: 0.8)
                        .lineLimit(1)
                }
                .foregroundStyle(tint.readableText)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(tint))
                .padding(.leading, 8)
            }
        }
        // NOT clipped: the label pill is allowed to overhang a short band.
        .frame(height: height, alignment: .center)
    }
}

/// Diagonal hatch + wash that marks the worked / logged portion of a schedule
/// bar — the iOS analog of the web app's `WORKED_STRIPE` overlay. It both
/// "lines" the region (diagonal hatch) and "greys it out" (a translucent wash),
/// so a fully-worked bar reads as done at a glance. Tint adapts to the bar it
/// sits on: light surface cards (Day view) get a dark hatch; saturated color
/// tiles (Week view) get a light one. Purely decorative — never interactive.
/// Always anchored to the top, so its bottom edge is the worked/remaining line;
/// only the top corners are rounded (the outer bar clips the bottom).
private struct WorkedStripe: View {
    var cornerRadius: CGFloat = 0
    var onLight: Bool = false

    var body: some View {
        let wash: Color = onLight ? Color.black.opacity(0.10) : Color.black.opacity(0.24)
        let line: Color = onLight ? Color.black.opacity(0.30) : Color.white.opacity(0.34)
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(wash))
            let gap: CGFloat = 7
            let h = size.height
            var x: CGFloat = -h
            while x < size.width {
                var p = Path()
                p.move(to: CGPoint(x: x, y: 0))
                p.addLine(to: CGPoint(x: x + h, y: h))
                ctx.stroke(p, with: .color(line), lineWidth: 1.5)
                x += gap
            }
        }
        .clipShape(UnevenRoundedRectangle(
            topLeadingRadius: cornerRadius,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: cornerRadius,
            style: .continuous))
        .allowsHitTesting(false)
    }
}

private struct ScheduleBlockView: View {
    let block: ScheduleBlock
    let height: CGFloat

    /// Density tiers — keeps short blocks readable without spilling over their bounds.
    private var density: Density {
        if height < 36 { return .tiny }       // ½-hour slots: one tight row
        if height < 64 { return .compact }    // ~1-hour: job + one line of task
        return .full                          // larger: job + task on up to two lines
    }
    private enum Density { case tiny, compact, full }

    var body: some View {
        HStack(spacing: 0) {
            // Dept rail — vertical gradient of the department color so the bar
            // reads as belonging to its department in the revamp language.
            Rectangle()
                .fill(LinearGradient(colors: [block.color, block.color.opacity(0.65)],
                                     startPoint: .top, endPoint: .bottom))
                .frame(width: 5)
            content
                .padding(.horizontal, 10)
                .padding(.vertical, density == .tiny ? 4 : 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: height, alignment: .top)
        .background(
            // White surface with a faint diagonal dept-color wash + a top-anchored
            // worked stripe behind the content, so the rail and labels stay legible.
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous)
                    .fill(Color(hex: T.surface))
                RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous)
                    .fill(LinearGradient(colors: [block.color.opacity(0.10), block.color.opacity(0.02)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                if block.workedFraction > 0.001 {
                    WorkedStripe(cornerRadius: T.cornerBlock, onLight: true)
                        .frame(height: max(0, height * block.workedFraction))
                }
            }
        )
        // Soft dept-tinted hairline instead of the neutral one — ties the bar to
        // its department color while staying subtle.
        .overlay(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous)
            .stroke(block.color.opacity(0.28), lineWidth: 1))
        // Diffuse ambient lift so blocks float on the ambient canvas like the
        // revamp's frosted cards.
        .compositingGroup()
        .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
        // Clip so any subview that doesn't measure exactly to height can't bleed
        // into the row below.
        .clipShape(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous))
    }

    /// "Data Encryption (2) · Wire" — the task, and the subtask beside it.
    ///
    /// De-duplicated: an op with no title of its own inherits the panel's, and
    /// printing the same name twice with a separator between reads as a bug.
    private var detailLine: String {
        var parts: [String] = []
        for candidate in [block.taskTitle, block.subtaskTitle ?? ""] where !candidate.isEmpty {
            if !parts.contains(where: { $0.caseInsensitiveCompare(candidate) == .orderedSame }) {
                parts.append(candidate)
            }
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var content: some View {
        switch density {
        case .tiny:
            // One row: the job, then as much of the task as fits.
            HStack(spacing: 6) {
                Circle().fill(block.color).frame(width: 6, height: 6)
                Text(block.title)
                    .font(TTypo.smBold(12))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                if !detailLine.isEmpty {
                    Text(detailLine)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        case .compact, .full:
            VStack(alignment: .leading, spacing: 3) {
                Text(block.title)
                    .font(TTypo.smBold(13))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                if !detailLine.isEmpty {
                    Text(detailLine)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(density == .full ? 2 : 1)
                }
            }
        }
    }
}

// MARK: - Week view (7-column grid) · matches wireframe V2

private struct WeekHeaderBar: View {
    let weekDates: [Date]
    @Binding var selected: Date
    private let cal = Calendar.current

    private var rangeLabel: String {
        let f = DateFormatter.display("MMM d")
        guard let first = weekDates.first, let last = weekDates.last else { return "" }
        return "\(f.string(from: first)) – \(f.string(from: last))"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(rangeLabel)
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.4)
            Spacer()
            PillBtn("TODAY", compact: true) {
                withAnimation(.easeInOut(duration: 0.22)) {
                    selected = cal.startOfDay(for: Date())
                }
            }
        }
    }
}

private struct WeekGrid: View {
    let weekDates: [Date]
    let today: Date
    let now: Date
    let workStart: Double
    let workEnd: Double
    /// Precomputed blocks per visible day — built ONCE by GanttView so the
    /// grid's repeated `endHour`/`height`/column reads iterate ready arrays
    /// instead of re-running the expensive block packer.
    let blocksByDate: [Date: [ScheduleBlock]]
    /// Break / lunch actually punched, per visible day. Same precompute-once
    /// discipline as `blocksByDate` — a column must not resolve its own.
    let spansByDate: [Date: [ClockOverlays.Span]]
    let onSelect: (ScheduleBlock) -> Void

    private var startHour: Double { workStart }
    private let pxPerHour: CGFloat = 36
    private let gutter:    CGFloat = 24
    private let cal = Calendar.current

    /// Runs workStart→workEnd for every column. Overflow rolls onto later days
    /// instead of stretching the grid, so a busy week no longer makes all seven
    /// columns as tall as its worst day. Floor-guarded and midnight-capped for the
    /// same reason as DayTimeline.
    private var endHour: Double {
        let maxEnd = blocksByDate.values.flatMap { $0 }.map(\.end).max() ?? workEnd
        return min(24, max(workEnd, maxEnd.rounded(.up)))
    }

    var body: some View {
        VStack(spacing: 0) {
            headerRow.padding(.bottom, 4)
            gridRow
        }
    }

    private var height: CGFloat { CGFloat(endHour - startHour) * pxPerHour }
    private var hourCount: Int { Int(endHour - startHour) }

    private var headerRow: some View {
        HStack(spacing: 2) {
            Spacer().frame(width: gutter)
            ForEach(weekDates, id: \.self) { d in
                DayHeaderCell(day: d, isToday: cal.isDateInToday(d))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var gridRow: some View {
        HStack(alignment: .top, spacing: 2) {
            timeGutter
            ForEach(weekDates, id: \.self) { d in
                WeekDayColumn(
                    day: d,
                    height: height,
                    startHour: startHour,
                    endHour: endHour,
                    pxPerHour: pxPerHour,
                    isToday: cal.isDateInToday(d),
                    now: now,
                    blocks: blocksByDate[d] ?? [],
                    spans: spansByDate[d] ?? [],
                    onSelect: onSelect)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var timeGutter: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<hourCount, id: \.self) { i in
                Text("\((((Int(startHour) + i) % 24 + 11) % 12) + 1)")
                    .font(TTypo.mono(9))
                    .foregroundStyle(Color(hex: T.muted))
                    .tnum()
                    .frame(height: pxPerHour, alignment: .topLeading)
            }
        }
        .frame(width: gutter, height: height, alignment: .topLeading)
    }
}

private struct DayHeaderCell: View {
    let day: Date
    let isToday: Bool
    private let cal = Calendar.current

    private var dow: String {
        let f = DateFormatter.display("EEE")
        return String(f.string(from: day).prefix(1))
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(dow)
                .font(TTypo.xsBold(11))
                .foregroundStyle(isToday ? T.onAccent : Color(hex: T.ink))
            Text("\(cal.component(.day, from: day))")
                .font(TTypo.xs(11))
                .foregroundStyle(isToday ? T.onAccent.opacity(0.85) : Color(hex: T.muted))
                .tnum()
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background(
            UnevenRoundedRectangle(
                cornerRadii: .init(topLeading: 8, bottomLeading: 0, bottomTrailing: 0, topTrailing: 8),
                style: .continuous)
                .fill(isToday ? Color(hex: T.sky) : .clear)
        )
    }
}

private struct WeekDayColumn: View {
    let day: Date
    let height: CGFloat
    let startHour: Double
    let endHour: Double
    let pxPerHour: CGFloat
    let isToday: Bool
    let now: Date
    let blocks: [ScheduleBlock]
    let spans: [ClockOverlays.Span]
    let onSelect: (ScheduleBlock) -> Void
    private let cal = Calendar.current

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Day column background: faint sky tint on today
            Rectangle()
                .fill(isToday ? Color(hex: T.sky).opacity(0.07) : .clear)

            // Hour rules (every 2 hours visible to keep the column readable at this scale)
            VStack(spacing: 0) {
                ForEach(0..<Int(endHour - startHour), id: \.self) { i in
                    VStack(spacing: 0) {
                        Rectangle()
                            .fill(Color(hex: T.hair).opacity(i % 2 == 0 ? 1.0 : 0.5))
                            .frame(height: 1)
                        Spacer().frame(height: pxPerHour - 1)
                    }
                }
            }

            // Event rectangles painted by time range — clamped to endHour so
            // blocks never bleed past the configured shift.
            ForEach(blocks.filter { $0.start < endHour }) { b in
                let clampedEnd = min(b.end, endHour)
                let top = CGFloat(b.start - startHour) * pxPerHour + 1
                let h = max(2, CGFloat(clampedEnd - b.start) * pxPerHour - 2)
                Button { onSelect(b) } label: {
                    WeekBlockTile(block: b, height: h)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 2)
                .offset(y: top)
            }

            // Punched break / lunch. Unlabelled at this scale — the column is
            // too narrow for the pill the Day view carries, so the band and its
            // edge rules do the whole job.
            ForEach(spans) { span in
                let s0 = max(startHour, hourOfDay(span.start))
                let e0 = min(endHour, hourOfDay(span.end))
                if e0 > s0 {
                    ClockSpanBand(span: span,
                                  height: max(4, CGFloat(e0 - s0) * pxPerHour),
                                  compact: true)
                        .padding(.horizontal, 2)
                        .offset(y: CGFloat(s0 - startHour) * pxPerHour)
                        .allowsHitTesting(false)
                }
            }

            // NOW line on today
            if isToday {
                let nowHour = hourOfDay(now)
                if nowHour >= startHour, nowHour <= endHour {
                    let y = CGFloat(nowHour - startHour) * pxPerHour
                    HStack(spacing: 0) {
                        Circle().fill(Color(hex: T.ink)).frame(width: 6, height: 6)
                            .offset(y: -3)
                        Rectangle().fill(Color(hex: T.ink)).frame(height: 1.5)
                    }
                    .offset(y: y)
                    .allowsHitTesting(false)
                }
            }
        }
        .frame(height: height)
        .overlay(
            Rectangle().fill(Color(hex: T.hair)).frame(width: 1),
            alignment: .leading
        )
        .clipped()
    }

    private func hourOfDay(_ d: Date) -> Double {
        let comps = cal.dateComponents([.hour, .minute], from: d)
        return Double(comps.hour ?? 0) + Double(comps.minute ?? 0) / 60
    }
}

/// Inline week-grid tile. Shows as much info as the slot height allows:
///   • ≥ 26pt: dept label (e.g. "WIRE")
///   • ≥ 44pt: + job number
///   • ≥ 64pt: + customer / job title
/// Below the threshold it's a clean colored bar so the column stays readable.
private struct WeekBlockTile: View {
    let block: ScheduleBlock
    let height: CGFloat

    private var showLabel:  Bool { height >= 26 }
    private var showJobNum: Bool { height >= 44 && !block.jobNumber.isEmpty }
    private var showTitle:  Bool { height >= 64 }

    /// White text reads well over magenta/cyan/yellow/etc.; for the soft
    /// lavender swatch we fall back to ink so it's not washed out.
    private var textColor: Color {
        // Heuristic: yellow is the lone "light" swatch — flip to ink there.
        block.color.readableText
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if showLabel {
                Text(block.typeLabel)
                    .font(.custom(TFontName.bold.rawValue, size: 9))
                    .kerning(0.6)
                    .lineLimit(1)
                    .foregroundStyle(textColor)
            }
            if showJobNum {
                Text("#\(block.jobNumber)")
                    .font(.custom(TFontName.medium.rawValue, size: 9))
                    .lineLimit(1)
                    .foregroundStyle(textColor.opacity(0.85))
            }
            if showTitle {
                Text(block.title)
                    .font(.custom(TFontName.bold.rawValue, size: 10))
                    .lineLimit(2)
                    .foregroundStyle(textColor)
            }
        }
        .padding(.horizontal, showLabel ? 4 : 0)
        .padding(.vertical, showLabel ? 3 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .frame(height: height)
        .background(
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(LinearGradient(colors: [block.color, block.color.opacity(0.78)],
                                         startPoint: .top, endPoint: .bottom))
                if block.workedFraction > 0.001 {
                    WorkedStripe(cornerRadius: 2, onLight: false)
                        .frame(height: max(0, height * block.workedFraction))
                }
            }
        )
        .contentShape(Rectangle())
    }
}

private struct WeekLegendRow: View {
    let blocks: [ScheduleBlock]

    /// Distinct (color, label) pairs across the week.
    private var entries: [(label: String, color: Color)] {
        var seen = Set<String>()
        var out: [(String, Color)] = []
        for b in blocks where !seen.contains(b.typeLabel) {
            seen.insert(b.typeLabel)
            out.append((b.typeLabel, b.color))
        }
        return out.sorted { $0.0 < $1.0 }
    }

    var body: some View {
        if entries.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: 10) {
                ForEach(entries, id: \.label) { e in
                    JobTypeTag(label: e.label, color: e.color)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - DatePickerSheet — jump to any day from the calendar header icon

private struct DatePickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: Date

    var body: some View {
        ZStack {
            PageBackground()
            VStack(spacing: 16) {
                Text("Jump to date")
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.4)
                    .padding(.top, 18)

                DatePicker("", selection: $selection, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                    .tint(Color(hex: T.sky))
                    .padding(.horizontal, T.insetLg)
                    .frostedCard(radius: T.cornerLg)
                    .padding(.horizontal, 16)

                GradientCTA(action: { dismiss() }) {
                    Text("DONE")
                        .font(TTypo.xsBold(13))
                        .tLabel(tracking: 0.8)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
    }
}

// MARK: - DateFormatter helpers

private extension DateFormatter {
    static let dayShort: DateFormatter = {
        let f = DateFormatter.display("EEE · MMM d"); return f
    }()
    static let dayFull: DateFormatter = {
        let f = DateFormatter.display("EEE · MMM d"); return f
    }()
}

// MARK: - String → Date helper (already used elsewhere in the codebase)
// (Kept here as a typed-key convenience; the canonical extension lives in AppState.swift.)
