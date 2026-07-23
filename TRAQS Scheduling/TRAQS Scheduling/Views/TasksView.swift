import SwiftUI

// MARK: - Jobs V1 (Today · card stack) · TRAQS Light
// Lives in TasksView.swift / struct TasksView for back-compat (MainTabView routes
// the Jobs tab to this view). Re-styled to the TRAQS Light language.

struct TasksView: View {
    @Environment(AppState.self) private var appState

    /// Search query. Owned by the Jobs hub header (JobsHubView) and passed in
    /// so the list can filter; the hub also owns the search field itself.
    var searchText: String = ""

    /// Selected range. Owned by the Jobs hub (JobsHubView) so the calendar
    /// picker can live in the title row; passed in here.
    @Binding var segment: JobsSegment
    /// Opens a job's detail — owned by JobsHubView (appends to its NavigationStack
    /// path) so the card's 3-dot "Information" action can navigate.
    var onOpenJob: (Job) -> Void = { _ in }
    @State private var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    /// Bumped on every data rehydrate (via .onReceive below). A @State change
    /// unconditionally re-runs this view's body, which then reads the freshly
    /// synced appState.jobs — the reliable live-refresh path when @Observable
    /// auto-tracking doesn't re-render the idle on-screen list.
    @State private var liveRefresh = 0

    enum JobsSegment: String, CaseIterable, Hashable { case today, week, month, year
        var label: String { rawValue.capitalized }
    }

    private let cal = Calendar.current

    // Body is just the scrollable content — the Jobs hub (JobsHubView) supplies
    // the surrounding NavigationStack, header, title + range picker, and sheets.
    var body: some View {
        // Read liveRefresh + appState.jobs DIRECTLY in body. This establishes the
        // @Observable dependency at the body level (not only inside the myTasks
        // computed property, whose reads SwiftUI wasn't tracking) so a live data
        // sync re-runs the list. liveRefresh (bumped by .onReceive on rehydrate)
        // is a belt-and-suspenders re-render trigger for the same reason.
        let _ = liveRefresh
        let _ = appState.jobs.count
        return ScrollView {
            VStack(spacing: 0) {
                // ("Jobs" title is rendered statically by JobsHubView above.)

                // The job being worked on right now sits at the top as a pinned
                // hero; excluded from the lists below so it isn't shown twice.
                if let activeTask {
                    NavigationLink(value: activeTask.job) {
                        TaskCardV1(task: activeTask, onOpen: { onOpenJob(activeTask.job) })
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                    // Slide UP into the hero slot when a job is logged into
                    // (and slide back down on clock-out); the list below closes
                    // the gap in the same ease-in-out beat.
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(1)
                }

                // Cross-faded content per segment (range chosen via the title FAB).
                Group {
                    switch segment {
                    case .today: todayView
                    case .week:  weekView
                    case .month: monthView
                    case .year:  yearView
                    }
                }
                .id(segment)
                .transition(.opacity)
            }
            .padding(.top, 2)
            .padding(.bottom, 96)   // clear the bottom-right calendar FAB
            // Smooth slow→fast→slow reorder when the active job changes (pinned
            // to the top). Keyed on the active task so logging in/out animates
            // instead of hard-clipping into place.
            .animation(.easeInOut(duration: 0.42), value: activeTaskId)
        }
        .scrollIndicators(.visible)
        .topFadeMask()   // app-wide soft fading header
        .animation(.easeInOut(duration: 0.22), value: segment)
        // Recenter the week/month/year picker to today when the range changes.
        .onChange(of: segment) { _, _ in
            selectedDate = Calendar.current.startOfDay(for: Date())
        }
        // Force a body re-run whenever live sync rehydrates data. A @State bump
        // reliably re-renders the on-screen list even when @Observable tracking of
        // appState.jobs doesn't fire for an idle view (the "only updates after a
        // tab switch" bug).
        .onReceive(NotificationCenter.default.publisher(for: .traqsDataRehydrated)) { _ in
            liveRefresh &+= 1
        }
    }

    /// The task the current user is actively clocked into, resolved to a
    /// TaskAssignment so it can render as the pinned hero above the toggle.
    private var activeTask: TaskAssignment? {
        guard let jc = appState.myActiveJobClock,
              let job = appState.jobs.first(where: { $0.id == jc.jobId }),
              let panel = job.subs.first(where: { $0.id == jc.panelId }) else { return nil }
        let op = jc.opId.flatMap { oid in panel.subs.first(where: { $0.id == oid }) }
        return TaskAssignment(job: job, panel: panel, op: op)
    }
    private var activeTaskId: String? { activeTask?.id }

    // ── Today: original card stack ─────────────────────────────────────────

    private var todayView: some View {
        let df = DateFormatter(); df.dateFormat = "EEE · MMM d"
        return VStack(spacing: 0) {
            rangeContent(activeRange, label: df.string(from: Date()))

            EndOfDayPlaceholder()
                .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 24)
        }
    }

    // ── Week: 7-day strip + every TASK across the week, placed under start day ─

    private var weekView: some View {
        let counts = dayCountMap
        // Show only work days in the week strip. The user's earlier choice
        // of "show muted" left weekend pills at 38% opacity, which on
        // device wasn't reading as clearly muted — so we now literally
        // omit non-work days.
        let allDays = weekDates(around: selectedDate)
        let days = allDays.filter(isWorkDay)
        return VStack(spacing: 0) {
            WeekStrip(
                days: days,
                selected: selectedDate,
                countFor: { counts[cal.startOfDay(for: $0)] ?? 0 },
                onPick: { day in withAnimation(.easeInOut(duration: 0.18)) { selectedDate = day } },
                isWorkDay: isWorkDay
            )
            .padding(.horizontal, 16).padding(.bottom, 14)

            // Show every job scheduled across the WHOLE week — the strip above
            // is for navigation/at-a-glance counts, but the list is bounded to
            // the full week span, not a single picked day.
            rangeContent(activeRange, label: weekLabel)
                .padding(.bottom, 24)
        }
    }

    private var weekLabel: String {
        let days = weekDates(around: selectedDate).filter(isWorkDay)
        let f = DateFormatter(); f.dateFormat = "MMM d"
        guard let first = days.first, let last = days.last else { return "" }
        return "\(f.string(from: first)) – \(f.string(from: last))"
    }

    // ── Month: calendar grid + every TASK this month, placed under start day ─

    private var monthView: some View {
        let counts = dayCountMap
        return VStack(spacing: 0) {
            MonthCalendar(
                month: selectedDate,
                selected: selectedDate,
                countFor: { counts[cal.startOfDay(for: $0)] ?? 0 },
                onPick: { day in withAnimation(.easeInOut(duration: 0.18)) { selectedDate = day } }
            )
            .padding(.horizontal, 16).padding(.bottom, 14)

            // Show every job scheduled across the WHOLE month.
            rangeContent(activeRange, label: monthLabel)
                .padding(.bottom, 24)
        }
    }

    private var monthLabel: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"
        return f.string(from: selectedDate)
    }

    // ── Year: heatmap + upcoming list ──────────────────────────────────────

    private var yearView: some View {
        let counts = dayCountMap
        return VStack(spacing: 0) {
            YearHeatmap(
                year: cal.component(.year, from: Date()),
                countFor: { counts[cal.startOfDay(for: $0)] ?? 0 }
            )
            .padding(.horizontal, 16).padding(.bottom, 14)

            // Every job scheduled anywhere in the selected year.
            rangeContent(activeRange, label: yearLabel)
                .padding(.bottom, 24)
        }
    }

    private var yearLabel: String {
        let f = DateFormatter(); f.dateFormat = "yyyy"
        return f.string(from: selectedDate)
    }

    // ── Shared row pieces ─────────────────────────────────────────────────

    /// Centered, black section divider — flanked by hairlines so YOUR TASKS and
    /// ALL JOBS read as two clearly separated groups.
    private func sectionHeader(_ title: String) -> some View {
        HStack(spacing: 12) {
            Rectangle().fill(Color(hex: T.hair)).frame(height: 1)
            Text(title)
                .font(TTypo.xsBold(12))
                .foregroundStyle(Color(hex: T.ink))
                .tLabel(tracking: 1.6)
                .fixedSize()
            Rectangle().fill(Color(hex: T.hair)).frame(height: 1)
        }
    }

    /// The body shared by every segment: the user's own scheduled work
    /// (YOUR TASKS) followed by every other job scheduled in the same span
    /// (ALL JOBS) as collapsible parent cards. The list is bounded to `range` —
    /// the active day/week/month/year window. Section headers only appear when
    /// there are other jobs, so a fully-personal view keeps its old look.
    @ViewBuilder
    private func rangeContent(_ range: Range<Date>, label: String) -> some View {
        // Your assigned, non-finished work — grouped so nothing ever vanishes:
        //   • Today: scheduled to overlap the window
        //   • In Progress: started (any date, until complete)
        //   • Upcoming: assigned but not in the window and not started
        // Then every OTHER non-finished job as a collapsible "All Jobs" card.
        let mine = myActiveTasks
        let inProgress = mine.filter { $0.status == .inProgress }
        let notStarted = mine.filter { $0.status != .inProgress }
        let today = notStarted.filter { overlapsRange($0, range) }
        let upcoming = notStarted.filter { !overlapsRange($0, range) }
        let others = allJobsList
        return VStack(spacing: 16) {
            if mine.isEmpty && others.isEmpty {
                VStack(spacing: 6) {
                    NoJobsPlaceholder(text: "No jobs scheduled")
                    diagnosticLine
                }
                .padding(.horizontal, 16).padding(.top, 8)
            }
            if !today.isEmpty {
                sectionHeader(windowLabel).padding(.horizontal, 16)
                cardStack(today)
            }
            if !inProgress.isEmpty {
                sectionHeader("In Progress").padding(.horizontal, 16)
                cardStack(inProgress)
            }
            if !upcoming.isEmpty {
                sectionHeader("Upcoming").padding(.horizontal, 16)
                cardStack(upcoming)
            }
            if !others.isEmpty {
                sectionHeader("All Jobs").padding(.horizontal, 16)
                VStack(spacing: 12) {
                    ForEach(others) { job in
                        AllJobsCard(job: job, panels: panelsFor(job))
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    /// Every non-finished job the user is NOT assigned to (search-filtered),
    /// shown in the "All Jobs" browse section regardless of date.
    private var allJobsList: [Job] {
        let q = searchText.lowercased()
        return appState.jobs.filter { job in
            if job.status == .finished { return false }
            if isMineJob(job) { return false }
            if !q.isEmpty {
                let hay = (job.title + " " + (job.jobNumber ?? "")).lowercased()
                if !hay.contains(q) { return false }
            }
            return true
        }
        .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    /// A job's panels as TaskAssignments (not the current user's) for the
    /// collapsible All Jobs card.
    private func panelsFor(_ job: Job) -> [TaskAssignment] {
        job.subs.map { TaskAssignment(job: job, panel: $0, op: nil, isMine: false) }
    }

    /// Header label for the top (scheduled-window) section.
    private var windowLabel: String {
        switch segment {
        case .today: return "Today"
        case .week:  return "This Week"
        case .month: return "This Month"
        case .year:  return "This Year"
        }
    }

    @ViewBuilder
    private func cardStack(_ items: [TaskAssignment]) -> some View {
        VStack(spacing: 12) {
            ForEach(items) { task in
                NavigationLink(value: task.job) {
                    TaskCardV1(task: task, onOpen: { onOpenJob(task.job) })
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
    }

    /// Surfaces what the iOS app actually has in `appState.jobs` and how it's
    /// interpreting the current user. Quick way to spot whether data is missing,
    /// `currentPersonId` is unset, or your team membership simply doesn't match.
    private var diagnosticLine: some View {
        let me = appState.currentPersonId ?? "—"
        let total = appState.jobs.count
        let assignedJobs = appState.jobs.filter { j in
            guard let m = appState.currentPersonId else { return false }
            return j.team.contains(m)
                || j.subs.contains { p in p.team.contains(m) || p.subs.contains { $0.team.contains(m) } }
        }.count
        return Text("\(total) jobs loaded · \(assignedJobs) assigned · me=\(me)")
            .font(TTypo.mono(10))
            .foregroundStyle(Color(hex: T.muted))
            .tnum()
    }

    // ── Data helpers ──────────────────────────────────────────────────────

    /// Every (job → panel → op) where the current user is on the op's team.
    /// If the user is on `panel.team` but no specific op, surface a single
    /// panel-level assignment for that panel. Job-level `team` membership
    /// alone does NOT surface assignments — being listed on a job's team
    /// (typical for admins/watchers) without an actual panel or op
    /// assignment isn't "scheduled work", and inflating it to one entry
    /// per panel turned every admin's tasks view into the whole company's
    /// schedule.
    private var myTasks: [TaskAssignment] {
        guard let me = appState.currentPersonId else { return [] }
        var out: [TaskAssignment] = []
        for job in appState.jobs {
            // Completed jobs drop off the list (approving a completion request
            // marks the whole job Finished).
            if job.status == .finished { continue }
            if !searchText.isEmpty {
                let q = searchText.lowercased()
                let hay = (job.title + " " + (job.jobNumber ?? "")).lowercased()
                if !hay.contains(q) { continue }
            }

            for panel in job.subs {
                let myOps = panel.subs.filter { $0.team.contains(me) }
                if !myOps.isEmpty {
                    for op in myOps {
                        out.append(TaskAssignment(job: job, panel: panel, op: op))
                    }
                } else if panel.team.contains(me) {
                    out.append(TaskAssignment(job: job, panel: panel, op: nil))
                }
            }
        }
        return out
    }

    /// True if the current user is scheduled to this job anywhere — on the job's
    /// team, any panel's team, or any op's team. A job that is "mine" by this
    /// test lives in YOUR TASKS and is excluded from the ALL JOBS section so it
    /// never appears twice.
    private func isMineJob(_ job: Job) -> Bool {
        guard let me = appState.currentPersonId else { return false }
        return job.team.contains(me)
            || job.subs.contains { p in p.team.contains(me) || p.subs.contains { $0.team.contains(me) } }
    }

    /// The visible date window for the current segment. Day = just today;
    /// Week = the work-week around the selected date; Month / Year = the
    /// calendar month or year containing it. The whole list (YOUR TASKS +
    /// ALL JOBS) is bounded to this half-open [start, end) span.
    private var activeRange: Range<Date> {
        let s: Date
        let e: Date
        switch segment {
        case .today:
            s = cal.startOfDay(for: Date())
            e = cal.date(byAdding: .day, value: 1, to: s) ?? s
        case .week:
            let days = weekDates(around: selectedDate)
            let first = cal.startOfDay(for: days.first ?? selectedDate)
            let last = cal.startOfDay(for: days.last ?? selectedDate)
            s = first
            e = cal.date(byAdding: .day, value: 1, to: last) ?? last
        case .month:
            s = cal.date(from: cal.dateComponents([.year, .month], from: selectedDate))
                ?? cal.startOfDay(for: selectedDate)
            e = cal.date(byAdding: .month, value: 1, to: s) ?? s
        case .year:
            s = cal.date(from: cal.dateComponents([.year], from: selectedDate))
                ?? cal.startOfDay(for: selectedDate)
            e = cal.date(byAdding: .year, value: 1, to: s) ?? s
        }
        return s..<e
    }

    /// Does a panel's [start, end] overlap the half-open `range`?
    private func overlaps(_ panel: Panel, _ range: Range<Date>) -> Bool {
        guard let s = panel.start.asDate, let e = panel.end.asDate else { return false }
        return s < range.upperBound && e >= range.lowerBound
    }

    /// All of the current user's assigned, non-finished work (the active clock
    /// task is pinned as the hero, so it's dropped here). Nothing is hidden by
    /// date — the date grouping happens in rangeContent so a rescheduled job
    /// moves between sections instead of vanishing.
    private var myActiveTasks: [TaskAssignment] {
        myTasks
            .filter { $0.status != .finished && $0.id != activeTaskId }
            .sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
    }

    private func overlapsRange(_ t: TaskAssignment, _ range: Range<Date>) -> Bool {
        guard let s = t.startDate, let e = t.endDate else { return false }
        return s < range.upperBound && e >= range.lowerBound
    }

    /// Parent jobs the user is NOT assigned to that have at least one panel
    /// overlapping `range`. The day/week/month/year filter bounds this set — only
    /// jobs scheduled in the span appear. Search (title + jobNumber) applies.
    private func otherJobs(in range: Range<Date>) -> [Job] {
        let q = searchText.lowercased()
        return appState.jobs.filter { job in
            if job.status == .finished { return false }
            if isMineJob(job) { return false }
            if !q.isEmpty {
                let hay = (job.title + " " + (job.jobNumber ?? "")).lowercased()
                if !hay.contains(q) { return false }
            }
            return job.subs.contains { overlaps($0, range) }
        }
        .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    /// Panels of `job` overlapping `range` — the rows revealed when an ALL JOBS
    /// card is expanded. Each is a panel-level (op == nil), not-mine assignment
    /// so the existing TaskCardV1 / LOG TIME flow logs time at panel level.
    private func panelsInWindow(_ job: Job, in range: Range<Date>) -> [TaskAssignment] {
        job.subs
            .filter { overlaps($0, range) }
            .map { TaskAssignment(job: job, panel: $0, op: nil, isMine: false) }
    }

    /// Merged universe used only by the COUNTS (pills/heatmap) and the Year
    /// UPCOMING list: every "mine" assignment plus one panel-level entry per
    /// panel of every not-mine job. Date bounding happens in the consumers.
    private var allTasks: [TaskAssignment] {
        var out = myTasks
        for job in appState.jobs where !isMineJob(job) {
            for panel in job.subs {
                out.append(TaskAssignment(job: job, panel: panel, op: nil, isMine: false))
            }
        }
        return out
    }

    /// Mirrors the desktop's `isWorkDay`: a date is a work day iff its weekday
    /// (0=Sun … 6=Sat) is in `orgSettings.workDays`. Calendar reports weekday
    /// 1=Sun … 7=Sat, so subtract 1 to align with the JS convention the org
    /// settings use.
    private func isWorkDay(_ day: Date) -> Bool {
        let jsDay = cal.component(.weekday, from: day) - 1
        return appState.orgSettings.workDays.contains(jsDay)
    }

    /// Pre-computed map of `startOfDay → task count`. One pass through
    /// `myTasks`, then every Week/Month/Year cell does an O(1) lookup.
    /// Non-work days are never counted — matches desktop where bars are
    /// clipped to `orgSettings.workDays`.
    private var dayCountMap: [Date: Int] {
        var map: [Date: Int] = [:]
        for task in allTasks {
            guard let s = task.startDate, let e = task.endDate, e >= s else { continue }
            var day = cal.startOfDay(for: s)
            let end = cal.startOfDay(for: e)
            while day <= end {
                if isWorkDay(day) {
                    map[day, default: 0] += 1
                }
                guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
            }
        }
        return map
    }

    /// Place every TaskAssignment under its start-day within the window.
    /// - Tasks that start before the window but continue into it are pinned
    ///   to the window's first day (so workers see "you're continuing this"
    ///   at the top).
    /// - Tasks that start mid-window appear under their actual start day.
    /// - Each task is inserted exactly ONCE — no per-day duplicates for
    ///   multi-day tasks.
    private func tasksByStartDay(in window: [Date]) -> [Date: [TaskAssignment]] {
        guard let first = window.first, let last = window.last else { return [:] }
        let wStart = cal.startOfDay(for: first)
        let wEnd = cal.startOfDay(for: last)

        var map: [Date: [TaskAssignment]] = [:]
        for task in myTasks {
            guard let s = task.startDate, let e = task.endDate, e >= s else { continue }
            let taskStart = cal.startOfDay(for: s)
            let taskEnd = cal.startOfDay(for: e)
            if taskEnd < wStart || taskStart > wEnd { continue }

            // Place the task on its actual start day clamped to the window —
            // but shift forward to the next work day if that lands on a
            // non-work day (Sat/Sun for default workDays). Mirrors the desktop
            // gantt's behavior of clipping bars to work days only.
            var placement = max(taskStart, wStart)
            while placement <= wEnd && placement <= taskEnd && !isWorkDay(placement) {
                guard let next = cal.date(byAdding: .day, value: 1, to: placement) else { break }
                placement = next
            }
            if placement > wEnd || placement > taskEnd { continue }
            map[placement, default: []].append(task)
        }
        for (k, v) in map {
            map[k] = v.sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
        }
        return map
    }

    /// The 7 Mon→Sun dates around the given date.
    private func weekDates(around date: Date) -> [Date] {
        let weekday = cal.component(.weekday, from: date)
        let toMon = weekday == 1 ? -6 : -(weekday - 2)
        guard let mon = cal.date(byAdding: .day, value: toMon, to: cal.startOfDay(for: date)) else { return [] }
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: mon) }
    }

    /// All days in the calendar month containing `date`.
    private func monthDays(of date: Date) -> [Date] {
        guard let first = cal.date(from: cal.dateComponents([.year, .month], from: date)),
              let range = cal.range(of: .day, in: .month, for: first) else { return [] }
        return range.compactMap { cal.date(byAdding: .day, value: $0 - 1, to: first) }
    }

    /// Group every TaskAssignment by each day it covers within the given window.
    /// One iteration over `myTasks` → keyed lookups by day after that.
    private func tasksByDay(in window: [Date]) -> [Date: [TaskAssignment]] {
        guard !window.isEmpty else { return [:] }
        let bounds = Set(window.map(cal.startOfDay(for:)))
        var map: [Date: [TaskAssignment]] = [:]
        for task in myTasks {
            guard let s = task.startDate, let e = task.endDate, e >= s else { continue }
            var day = cal.startOfDay(for: s)
            let end = cal.startOfDay(for: e)
            while day <= end {
                if bounds.contains(day) && isWorkDay(day) {
                    map[day, default: []].append(task)
                }
                guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
            }
        }
        // Sort each day's bucket so the list is stable
        for (k, v) in map {
            map[k] = v.sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
        }
        return map
    }
}

// MARK: - Day-grouped TASK list (used by Week + Month)
// Each task is placed under its start day (or the first day of the window
// if it started earlier). Multi-day tasks appear exactly once.

private struct DayGroupedTaskList: View {
    let days: [Date]
    let tasksByDay: [Date: [TaskAssignment]]
    private let cal = Calendar.current

    var body: some View {
        let populated = days.filter { (tasksByDay[cal.startOfDay(for: $0)]?.isEmpty == false) }
        VStack(spacing: 18) {
            ForEach(populated, id: \.self) { day in
                let dayTasks = tasksByDay[cal.startOfDay(for: day)] ?? []
                VStack(alignment: .leading, spacing: 8) {
                    DayHeader(day: day, count: dayTasks.count)
                    VStack(spacing: 12) {
                        ForEach(dayTasks) { task in
                            NavigationLink(value: task.job) {
                                TaskCardV1(task: task)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            if populated.isEmpty {
                NoJobsPlaceholder(text: "No jobs scheduled in this range")
                    .padding(.horizontal, 16)
            }
        }
        .padding(.horizontal, 16)
    }
}

private struct DayHeader: View {
    let day: Date
    let count: Int

    private var label: String {
        let f = DateFormatter(); f.dateFormat = "EEE · MMM d"
        return f.string(from: day)
    }
    private var isToday: Bool { Calendar.current.isDateInToday(day) }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            HStack(spacing: 6) {
                if isToday {
                    Circle().fill(Color(hex: T.sky)).frame(width: 6, height: 6)
                }
                Text(label)
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(isToday ? Color(hex: T.sky) : Color(hex: T.muted))
                    .tLabel(tracking: 1.4)
            }
            Spacer()
            Text("\(count) task\(count == 1 ? "" : "s")")
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
                .tnum()
        }
    }
}

// MARK: - Week strip

private struct WeekStrip: View {
    let days: [Date]
    let selected: Date
    let countFor: (Date) -> Int
    let onPick: (Date) -> Void
    /// Returns true when the date is part of `orgSettings.workDays`. Non-work
    /// days are shown muted and aren't tappable (and never display dots).
    let isWorkDay: (Date) -> Bool
    private let cal = Calendar.current

    var body: some View {
        HStack(spacing: 6) {
            ForEach(days, id: \.self) { d in
                let isSelected = cal.isDate(d, inSameDayAs: selected)
                let isToday = cal.isDateInToday(d)
                let workDay = isWorkDay(d)
                let count = workDay ? countFor(d) : 0

                Button { if workDay { onPick(d) } } label: {
                    VStack(spacing: 4) {
                        Text(dowChar(d))
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(isSelected ? Color(hex: T.sky) : Color(hex: T.muted))
                            .tLabel(tracking: 0.6)
                        Text("\(cal.component(.day, from: d))")
                            .font(TTypo.smBold(15))
                            .foregroundStyle(Color(hex: T.ink))
                            .tnum()
                        // Up to 4 magenta dots on work days; hollow for zero.
                        // Non-work days draw nothing so the cell reads clearly
                        // as "no work happens here".
                        HStack(spacing: 2) {
                            if !workDay {
                                Color.clear.frame(width: 4, height: 4)
                            } else if count == 0 {
                                Circle().fill(.clear).frame(width: 4, height: 4)
                                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
                            } else {
                                ForEach(0..<min(count, 4), id: \.self) { _ in
                                    Circle().fill(Color(hex: T.magenta)).frame(width: 4, height: 4)
                                }
                            }
                        }
                        .frame(height: 6)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                        .fill(isSelected ? Color(hex: T.sky).opacity(0.14) : Color(hex: T.surface)))
                    .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                        .stroke(isSelected ? Color(hex: T.sky) : (isToday ? Color(hex: T.ink).opacity(0.25) : Color(hex: T.hair)),
                                lineWidth: 1))
                    .opacity(workDay ? 1.0 : 0.38)
                }
                .buttonStyle(.plain)
                .disabled(!workDay)
            }
        }
    }

    private func dowChar(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "EEE"
        return String(f.string(from: d).prefix(1))
    }
}

// MARK: - Month calendar

private struct MonthCalendar: View {
    let month: Date          // any date within the month to display
    let selected: Date
    let countFor: (Date) -> Int
    let onPick: (Date) -> Void
    private let cal = Calendar.current

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(monthLabel)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                Spacer()
            }
            // Day-of-week header
            HStack(spacing: 4) {
                ForEach(["M","T","W","T","F","S","S"], id: \.self) { d in
                    Text(d)
                        .font(TTypo.xsBold(10))
                        .foregroundStyle(Color(hex: T.muted))
                        .frame(maxWidth: .infinity)
                }
            }

            // Grid of weeks
            VStack(spacing: 4) {
                ForEach(weeksOfMonth, id: \.self) { week in
                    HStack(spacing: 4) {
                        ForEach(week, id: \.self) { day in
                            DayCell(day: day, monthAnchor: month, selected: selected, countFor: countFor, onPick: onPick)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).fill(Color(hex: T.surface)))
        .overlay(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
        .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
    }

    private var monthLabel: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"
        return f.string(from: month)
    }

    /// Build a 2-D array of dates for the calendar grid (Mon → Sun, including
    /// neighboring-month dates for visual continuity).
    private var weeksOfMonth: [[Date]] {
        guard let firstOfMonth = cal.date(from: cal.dateComponents([.year, .month], from: month)) else { return [] }
        // weekday Sun=1 ... Mon=2; we render Mon-first.
        let weekday = cal.component(.weekday, from: firstOfMonth)
        let toMon = weekday == 1 ? -6 : -(weekday - 2)
        guard let gridStart = cal.date(byAdding: .day, value: toMon, to: firstOfMonth) else { return [] }
        var weeks: [[Date]] = []
        for w in 0..<6 {
            var row: [Date] = []
            for d in 0..<7 {
                if let day = cal.date(byAdding: .day, value: w*7 + d, to: gridStart) {
                    row.append(day)
                }
            }
            weeks.append(row)
        }
        return weeks
    }

    private struct DayCell: View {
        let day: Date
        let monthAnchor: Date
        let selected: Date
        let countFor: (Date) -> Int
        let onPick: (Date) -> Void
        private let cal = Calendar.current

        var body: some View {
            let inMonth = cal.component(.month, from: day) == cal.component(.month, from: monthAnchor)
            let isSelected = cal.isDate(day, inSameDayAs: selected)
            let isToday = cal.isDateInToday(day)
            let count = countFor(day)

            Button { onPick(day) } label: {
                VStack(spacing: 2) {
                    Text("\(cal.component(.day, from: day))")
                        .font(TTypo.smBold(13))
                        .foregroundStyle(
                            isSelected ? Color(hex: T.sky)
                                       : (!inMonth ? Color(hex: T.muted).opacity(0.45) : Color(hex: T.ink))
                        )
                        .tnum()
                    if count > 0 {
                        Circle().fill(Color(hex: T.magenta)).frame(width: 4, height: 4)
                    } else {
                        Spacer().frame(height: 4)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .background(
                    RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous)
                        .fill(isSelected ? Color(hex: T.sky).opacity(0.16) : .clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous)
                        .stroke(isSelected ? Color(hex: T.sky)
                                : (isToday ? Color(hex: T.ink).opacity(0.5) : .clear),
                                lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Year heatmap

private struct YearHeatmap: View {
    let year: Int
    let countFor: (Date) -> Int
    private let cal = Calendar.current
    private let months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]

    private var palette: [Color] {
        [
            Color(hex: T.ink).opacity(0.05),
            Color(hex: T.magenta).opacity(0.30),
            Color(hex: T.magenta).opacity(0.60),
            Color(hex: T.magenta),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(year) · jobs by day")
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.2)
                Spacer()
                HStack(spacing: 4) {
                    Text("less")
                        .font(TTypo.xs(10))
                        .foregroundStyle(Color(hex: T.muted))
                    ForEach(0..<palette.count, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(palette[i])
                            .frame(width: 10, height: 10)
                            .overlay(RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .stroke(Color(hex: T.hair), lineWidth: 0.5))
                    }
                    Text("more")
                        .font(TTypo.xs(10))
                        .foregroundStyle(Color(hex: T.muted))
                }
            }

            // Grid: one row per month, 31 cells wide
            VStack(spacing: 4) {
                ForEach(0..<12, id: \.self) { m in
                    HStack(spacing: 6) {
                        Text(months[m])
                            .font(TTypo.xs(10))
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(width: 28, alignment: .leading)
                        HStack(spacing: 2) {
                            ForEach(1...31, id: \.self) { d in
                                cellFor(month: m + 1, day: d)
                            }
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).fill(Color(hex: T.surface)))
        .overlay(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
        .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
    }

    @ViewBuilder
    private func cellFor(month: Int, day: Int) -> some View {
        let comps = DateComponents(year: year, month: month, day: day)
        if let date = cal.date(from: comps),
           cal.component(.month, from: date) == month {
            let count = countFor(date)
            let isToday = cal.isDateInToday(date)
            let idx = min(palette.count - 1, count == 0 ? 0 : count == 1 ? 1 : count <= 3 ? 2 : 3)
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(palette[idx])
                .frame(maxWidth: .infinity)
                .frame(height: 10)
                .overlay(
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .stroke(isToday ? Color(hex: T.ink) : .clear, lineWidth: 1.5)
                )
        } else {
            // Phantom cell so each row has a consistent grid width
            Color.clear.frame(maxWidth: .infinity).frame(height: 10)
        }
    }
}

// MARK: - "No jobs" placeholder (dashed)

private struct NoJobsPlaceholder: View {
    let text: String
    var body: some View {
        HStack(spacing: 8) {
            TIconView(icon: .check, size: 14, color: Color(hex: T.muted))
            Text(text)
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.muted))
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).fill(.clear))
        .overlay(
            RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .foregroundStyle(Color(hex: T.hair))
        )
    }
}

// MARK: - JobsHeaderBar
// The Jobs title row: big "Jobs" wordmark on the left, a calendar button on the
// right (list mode only). Tapping the button slides the four range options out
// horizontally from the right edge, one-by-one, lined up under the title.

struct JobsHeaderBar: View {
    var body: some View {
        // Use the shared PageTitle so the Jobs wordmark matches every other
        // page (left, solid ink, tight tracking, same size).
        PageTitle(title: "Jobs")
    }
}

// MARK: - TaskAssignment
// One scheduled task — the canonical unit of work shown in the Jobs list.
// `op == nil` means the user is on `panel.team` but no specific op.

struct TaskAssignment: Identifiable {
    let job: Job
    let panel: Panel
    let op: Operation?
    /// Whether the current user is actually scheduled to this work. Defaults to
    /// true so existing "my tasks" call sites are unchanged; the ALL JOBS section
    /// passes `false` for jobs the user isn't assigned to.
    var isMine: Bool = true

    var id: String { "\(job.id)/\(panel.id)/\(op?.id ?? "panel")" }

    var title: String { op?.title.isEmpty == false ? op!.title : panel.title }
    var status: JobStatus { op?.status ?? panel.status }
    var hpd: Double { op?.hpd ?? panel.hpd }
    var startDate: Date? { (op?.start ?? panel.start).asDate }
    var endDate: Date? { (op?.end ?? panel.end).asDate }
}

// MARK: - TaskCardV1
// Task-prominent card. Top row carries the task's department tag + job ID +
// status. Headline is the TASK title. Subline gives the job/customer context.

// Internal (not private) so the Schedule tab's job-detail popup
// (ScheduleJobSheet) can reuse it as the log-time hero.
struct TaskCardV1: View {
    @Environment(AppState.self) private var appState
    let task: TaskAssignment
    /// Menu "Information" action — open the job's detail (default no-op for the
    /// dead AllJobsCard call site, which still wraps the card in a NavigationLink).
    var onOpen: () -> Void = {}
    /// Request Completion send-feedback phase: 0 idle · 1 sending · 2 sent.
    @State private var reqPhase = 0
    @State private var showLogConfirm = false
    @State private var showClockInRequired = false
    @State private var isStopping = false
    @State private var isStarting = false
    @State private var isBreakBusy = false
    @State private var showBreakConfirm = false
    /// Set when the worker taps STOP — drives the end-job photo overlay, which
    /// attaches the photo and THEN clocks out. Presented as a fullScreenCover
    /// (with a clear background) so it fades in over the jobs list rather than
    /// taking the whole screen, and doesn't collide with the LOG TIME sheet.
    @State private var endJobTarget: PanelPhotoTarget?

    private var isActive: Bool {
        guard let jc = appState.myActiveJobClock else { return false }
        if let opId = task.op?.id { return jc.opId == opId }
        return jc.opId == nil && jc.panelId == task.panel.id
    }

    /// Another person (not me) currently clocked into this same work. For an
    /// op-level card we match the exact op; for a panel-level card we match
    /// anyone working anywhere in the panel (any op or the panel itself).
    private var busyBy: Person? {
        appState.people.first { p in
            guard p.id != appState.currentPersonId,
                  let jc = p.activeJobClock,
                  jc.jobId == task.job.id else { return false }
            if let opId = task.op?.id { return jc.opId == opId }
            return jc.panelId == task.panel.id
        }
    }

    /// True when someone else is on this task and I'm not — the task is "in
    /// progress" by another worker, so logging time is blocked.
    private var busyByOther: Bool { !isActive && busyBy != nil }

    /// First name (or full name) of whoever currently has this task, for the
    /// greyed in-progress chip. Falls back to "IN USE" if unknown.
    private var busyByFirstName: String {
        guard let n = busyBy?.name, !n.isEmpty else { return "IN USE" }
        return n.split(separator: " ").first.map(String.init) ?? n
    }


    private var dept: (label: String, color: Color) {
        let title = task.title
        let key = title.lowercased()
        switch key {
        case _ where key.contains("layout"):   return ("LAYOUT",  Color(hex: T.magenta))
        case _ where key.contains("wire"):     return ("WIRE",    Color(hex: T.cyan))
        case _ where key.contains("cut"):      return ("CUT",     Color(hex: T.yellow))
        case _ where key.contains("inspect"):  return ("INSPECT", Color(hex: T.lavender))
        case _ where key.contains("repair"):   return ("REPAIR",  Color(hex: T.amber))
        case _ where key.contains("install"):  return ("INSTALL", Color(hex: T.magenta))
        case _ where key.contains("callback"): return ("CALLBACK", Color(hex: T.red))
        case _ where key.contains("contract"): return ("CONTRACT", Color(hex: T.green))
        default: return (title.uppercased(), Color(hex: task.job.color))
        }
    }

    private var clientName: String? {
        guard let cid = task.job.clientId else { return nil }
        let n = appState.clients.first(where: { $0.id == cid })?.name
        return (n?.isEmpty == false) ? n : nil
    }

    /// Sub-line under the task title: "Customer · Job Title" when both exist,
    /// otherwise whichever is available.
    private var contextLine: String {
        var parts: [String] = []
        if let c = clientName { parts.append(c) }
        if !task.job.title.isEmpty, task.job.title != clientName { parts.append(task.job.title) }
        return parts.joined(separator: " · ")
    }

    private var dateRange: String {
        let f = DateFormatter(); f.dateFormat = "MMM d"
        guard let s = task.startDate else { return "" }
        guard let e = task.endDate, !Calendar.current.isDate(s, inSameDayAs: e) else {
            return f.string(from: s)
        }
        return "\(f.string(from: s)) – \(f.string(from: e))"
    }

    // Wireframe-style card pieces: a big NAME headline, the task as subline, a
    // bright type pill, and a bright status pill.
    private var headline: String {
        clientName ?? (task.job.title.isEmpty ? task.title : task.job.title)
    }

    private var subline: String {
        var parts: [String] = []
        if !task.title.isEmpty { parts.append(task.title) }
        if clientName != nil, !task.job.title.isEmpty, task.job.title != task.title {
            parts.append(task.job.title)
        }
        if task.op != nil, !task.panel.title.isEmpty { parts.append(task.panel.title) }
        return parts.joined(separator: " · ")
    }

    /// Maps the dept label onto a bright TagPill color family.
    private var deptKind: TagKind {
        let k = dept.label.lowercased()
        if k.contains("repair") || k.contains("cut") { return .amber }
        if k.contains("inspect") || k.contains("wire") { return .sky }
        if k.contains("callback") { return .magenta }
        if k.contains("contract") { return .green }
        return .indigo   // install / layout / default
    }

    @ViewBuilder private var statusPill: some View {
        if busyByOther {
            TagPill(label: "In progress", kind: .amber, dot: true)
        } else {
            switch task.status {
            case .notStarted: TagPill(label: "Up next", kind: .green)
            case .pending:    TagPill(label: "Pending", kind: .neutral)
            case .inProgress: TagPill(label: "Active", kind: .indigo, dot: true)
            case .onHold:     TagPill(label: "On hold", kind: .amber)
            case .finished:   TagPill(label: "Done", kind: .green)
            }
        }
    }

    /// Format the elapsed time against the active job clock at the given
    /// reference date. Returns "—" if no clock is running. Format is
    /// "0h 0m 5s" — explicit unit letters so the user can read it at a glance.
    private func elapsedLabel(at ref: Date) -> String {
        guard let jc = appState.myActiveJobClock,
              let started = Date.fromFlexibleISO8601(jc.clockIn) else { return "—" }
        var ms = ref.timeIntervalSince(started) * 1000
        ms -= (jc.totalPausedMs ?? 0)
        if let p = jc.pausedAt, let pStart = Date.fromFlexibleISO8601(p) {
            ms -= ref.timeIntervalSince(pStart) * 1000
        }
        let secs = max(0, Int(ms / 1000))
        return String(format: "%dh %dm %ds", secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    var body: some View {
        // Keep the rectangular "square" card footprint but round the corners
        // a lot more so it reads as a soft rounded-square, not a boxy panel.
        // Uses the shared hero radius so every page's cards match.
        SBox(size: .lg, radius: T.cornerHero, active: isActive, frosted: true, liveSheen: task.isMine) {
            VStack(alignment: .leading, spacing: 0) {
                // Top row: bright type + status pills ···· date · chevron
                HStack(spacing: 6) {
                    TagPill(label: dept.label, kind: deptKind)
                    if !task.isMine {
                        TagPill(label: "NOT ASSIGNED", kind: .neutral)
                    } else {
                        statusPill
                    }
                    Spacer(minLength: 6)
                    // 3-dot Liquid-Glass menu (replaces the old date + chevron).
                    Menu {
                        Button { onOpen() } label: { Label("Job Details", systemImage: "info.circle") }
                        Divider()
                        Button { requestCompletion() } label: { Label("Request Completion", systemImage: "checkmark.seal") }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(width: 30, height: 30)
                            .glassEffect(.regular.interactive(), in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                }

                // Headline: customer / job name (big, like the wireframe).
                Text(headline)
                    .font(.custom(TFontName.bold.rawValue, size: 22))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                    .padding(.top, 10)

                // Sub-line: the specific task (+ panel).
                if !subline.isEmpty {
                    Text(subline)
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                        .padding(.top, 1)
                }

                // Soft divider: a hairline that fades out toward the right so
                // it reads as a gentle separator melting away from the title,
                // instead of a hard full-width rule. Same height + spacing as
                // the old SLine, so nothing else shifts.
                LinearGradient(
                    colors: [Color(hex: T.hair), Color(hex: T.hair).opacity(0)],
                    startPoint: .leading, endPoint: .trailing)
                    .frame(height: 1)
                    .padding(.vertical, 12)

                if isActive { activeRow } else { queuedRow }
            }
            .padding(16)
        }
        .animation(.easeInOut(duration: 0.2), value: isActive)
        .animation(.easeInOut(duration: 0.25), value: isStarting)
        .animation(.easeInOut(duration: 0.25), value: isStopping)
        .sheet(isPresented: $showLogConfirm) {
            LogTimeConfirmSheet(task: task,
                                deptLabel: dept.label,
                                deptColor: dept.color,
                                customer: clientName,
                                onConfirm: {
                                    // Set isStarting BEFORE the sheet
                                    // dismisses so the queued row's button
                                    // immediately shows STARTING… instead
                                    // of LOG TIME. Without this, the user
                                    // saw a frozen LOG TIME button and
                                    // tapped it repeatedly — which is how
                                    // they triggered the 409 "already
                                    // clocked in" race.
                                    isStarting = true
                                    Task {
                                        await appState.jobClockIn(
                                            jobId: task.job.id,
                                            panelId: task.panel.id,
                                            opId: task.op?.id,
                                            jobTitle: task.job.title,
                                            panelTitle: task.panel.title,
                                            opTitle: task.op?.title)
                                        isStarting = false
                                    }
                                })
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .alert("Clock in first", isPresented: $showClockInRequired) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("You need to clock in on the Hours page before you can work on a job.")
        }
        .fullScreenCover(item: $endJobTarget) { target in
            EndJobPhotoOverlay(target: target) { clockOut in
                // Dismiss by clearing the item binding (reliable), then clock
                // out on the app-level state — which outlives this card view,
                // so the job still ends even if the card re-renders away.
                endJobTarget = nil
                if clockOut {
                    // Drive the STOP button's "STOPPING…" spinner while the
                    // clock-out is in flight (set after the overlay closes so
                    // the indicator is visible on the card underneath).
                    isStopping = true
                    Task {
                        await appState.jobClockOut()
                        isStopping = false
                    }
                }
            }
        }
        .alert(appState.myActiveBreak != nil ? "End your break?" : "Start a break?",
               isPresented: $showBreakConfirm) {
            Button("Cancel", role: .cancel) {}
            Button(appState.myActiveBreak != nil ? "End Break" : "Start Break") {
                guard !isBreakBusy else { return }
                isBreakBusy = true
                Task {
                    if appState.myActiveBreak != nil { await appState.endBreak() }
                    else { await appState.startBreak() }
                    isBreakBusy = false
                }
            }
        } message: {
            Text(appState.myActiveBreak != nil
                 ? "You'll go back to working on the job."
                 : "Your job timer keeps running while you're on break.")
        }
        // Request Completion send feedback — Sending… then an animated Sent ✓.
        .overlay {
            if reqPhase != 0 {
                ZStack {
                    RoundedRectangle(cornerRadius: T.cornerHero).fill(.ultraThinMaterial)
                    VStack(spacing: 10) {
                        if reqPhase == 1 {
                            ProgressView().controlSize(.large)
                            Text("Sending…").font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.muted))
                        } else {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 42, weight: .semibold))
                                .foregroundStyle(Color(hex: "#10b981"))
                                .transition(.scale.combined(with: .opacity))
                            Text("Sent").font(TTypo.smBold(15)).foregroundStyle(Color(hex: T.ink))
                        }
                    }
                }
                .transition(.opacity)
            }
        }
    }

    private func requestCompletion() {
        guard reqPhase == 0 else { return }
        withAnimation(.easeOut(duration: 0.2)) { reqPhase = 1 }
        Task {
            await appState.requestTaskCompletion(
                jobId: task.job.id,
                panelId: task.panel.id,
                opId: task.op?.id,
                panelTitle: task.panel.title,
                opTitle: task.op?.title)
            await MainActor.run { withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) { reqPhase = 2 } }
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            await MainActor.run { withAnimation(.easeInOut(duration: 0.25)) { reqPhase = 0 } }
        }
    }

    @ViewBuilder
    private var activeRow: some View {
        let pct = task.op.map { Double(appState.opPct($0)) }
                  ?? Double(appState.panelPct(task.panel))
        let onBreak = appState.myActiveBreak != nil
        VStack(spacing: 12) {
            // Status label + live timer
            HStack {
                HStack(spacing: 5) {
                    Circle().fill(Color(hex: onBreak ? T.amber : T.sky)).frame(width: 7, height: 7)
                    Text(onBreak ? "ON BREAK" : "TRACKING")
                        .font(TTypo.xsBold(11))
                        .foregroundStyle(Color(hex: onBreak ? T.amber : T.sky))
                        .tLabel(tracking: 1.0)
                    if onBreak, let brk = appState.myActiveBreak {
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in
                            Text(breakCountdown(brk, at: ctx.date))
                                .font(TTypo.monoBold(11))
                                .foregroundStyle(Color(hex: T.amber))
                                .tnum()
                        }
                    }
                }
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text("\(elapsedLabel(at: context.date)) · \(Int(pct))%")
                        .font(TTypo.monoBold(13))
                        .foregroundStyle(Color(hex: T.sky))
                        .tnum()
                }
            }

            // Progress
            Bar(pct: pct, height: 7, gradient: T.brandGradient())

            // Break + Stop, side by side under the bar. Each opens a
            // confirmation to guard against accidental taps.
            HStack(spacing: 8) {
                Button { showBreakConfirm = true } label: {
                    HStack(spacing: 6) {
                        if isBreakBusy {
                            ProgressView().progressViewStyle(.circular).tint(T.onColor(T.amber)).scaleEffect(0.7)
                        } else {
                            Image(systemName: onBreak ? "play.fill" : "pause.fill")
                            Text(onBreak ? "END BREAK" : "BREAK").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                        }
                    }
                    .foregroundStyle(T.onColor(T.amber))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color(hex: T.amber)))
                    .shadow(color: Color(hex: T.amber).opacity(T.skyShadowOpacity),
                            radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                }
                .buttonStyle(.plain)
                .disabled(isBreakBusy || isStopping)

                // STOP → opens the end-job photo step (which performs the actual
                // clock-out). Restyled to the signature gradient CTA; the action,
                // STOPPING… spinner, and mutual lockout are unchanged.
                GradientCTA(disabled: isStopping || isBreakBusy,
                            dimmed: false,
                            verticalPadding: 10,
                            action: {
                                endJobTarget = PanelPhotoTarget(
                                    jobId: task.job.id,
                                    panelId: task.panel.id,
                                    panelTitle: task.panel.title,
                                    opId: task.op?.id)
                            }) {
                    HStack(spacing: 6) {
                        if isStopping {
                            ProgressView().progressViewStyle(.circular).tint(T.onGradient).scaleEffect(0.7)
                            Text("STOPPING…").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                        } else {
                            Image(systemName: "stop.fill")
                            Text("STOP").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                        }
                    }
                }
            }
        }
    }

    /// "MM:SS left" while under the configured break duration, "over by
    /// MM:SS" once past it. Used by the on-break label on the active card.
    private func breakCountdown(_ brk: ActiveBreak, at now: Date) -> String {
        let left = brk.secondsLeft(at: now) ?? 0
        if left >= 0 { return String(format: "%d:%02d left", left / 60, left % 60) }
        let over = -left
        return String(format: "over by %d:%02d", over / 60, over % 60)
    }

    @ViewBuilder
    private var queuedRow: some View {
        // Show the job's current progress even when not clocked in, so the
        // card communicates how far along the work is at a glance. Same
        // pct source as the active row (op % when this is an op, else the
        // panel's rolled-up %). Rendered in the dept color (vs the active
        // sky/amber) so it reads as "not currently tracking".
        let pct = task.op.map { Double(appState.opPct($0)) }
                  ?? Double(appState.panelPct(task.panel))
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    HStack(spacing: 5) {
                        TIconView(icon: .pin, size: 11,
                                  color: Color(hex: busyByOther ? T.statusInProgress : T.muted))
                        Text(busyByOther ? "IN PROGRESS" : (isStarting ? "STARTING…" : "PROGRESS"))
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(Color(hex: busyByOther ? T.statusInProgress : T.muted))
                            .tLabel(tracking: 1.0)
                    }
                    Spacer()
                    Text("\(Int(pct))%")
                        .font(TTypo.monoBold(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                }
                Bar(pct: pct, height: 7, fill: busyByOther ? Color(hex: T.statusInProgress) : dept.color)
            }
            if busyByOther {
                // Someone else is clocked into this work — block logging and
                // show who has it, greyed out so it clearly can't be tapped.
                HStack(spacing: 6) {
                    Image(systemName: "person.fill.checkmark")
                    Text(busyByFirstName).font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                }
                .foregroundStyle(Color(hex: T.muted))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Capsule().fill(Color(hex: T.surface)))
                .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                .opacity(0.55)
            } else {
                // Purple-gradient "Start" CTA. Action / race-guard unchanged.
                GradientCTA(disabled: isStarting, dimmed: false, fullWidth: false,
                            verticalPadding: 9, action: {
                                guard !isStarting else { return }
                                // You can only work on a job while clocked in.
                                if appState.canWorkOnJobs { showLogConfirm = true }
                                else { showClockInRequired = true }
                            }) {
                    HStack(spacing: 6) {
                        if isStarting {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(T.onGradient)
                                .scaleEffect(0.7)
                            Text("Starting…").font(TTypo.smBold(14))
                        } else {
                            Image(systemName: "play.fill")
                            Text("Start").font(TTypo.smBold(14))
                        }
                    }
                }
                .fixedSize()
            }
        }
    }
}


// MARK: - AllJobsCard (collapsible parent job — ALL JOBS section)
// A job the current user is NOT assigned to. Collapsed, it shows the job
// summary; tapping it drops down to reveal the job's panels (those scheduled
// in the active window) as standard task cards, so the user can LOG TIME
// against any of them. Modeled on the expandable panel card in JobDetailView.

private struct AllJobsCard: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panels: [TaskAssignment]
    @State private var isExpanded = false

    private var clientName: String? {
        guard let cid = job.clientId else { return nil }
        let n = appState.clients.first(where: { $0.id == cid })?.name
        return (n?.isEmpty == false) ? n : nil
    }

    var body: some View {
        VStack(spacing: 12) {
            // Collapsed, tappable job header — kept deliberately THIN so the
            // ALL JOBS section reads as a compact browseable list, not a wall
            // of full-size cards. The full-size cards are reserved for work the
            // user is actually assigned to (YOUR TASKS) and for the panels
            // revealed on expand (which carry the LOG TIME action).
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                SBox(size: .md) {
                    HStack(spacing: 10) {
                        Circle().fill(Color(hex: job.color)).frame(width: 7, height: 7)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(job.title)
                                .font(TTypo.smBold(14))
                                .foregroundStyle(Color(hex: T.ink))
                                .lineLimit(1)

                            HStack(spacing: 6) {
                                if let n = job.jobNumber, !n.isEmpty {
                                    Text("#\(n)")
                                        .font(TTypo.mono(10))
                                        .foregroundStyle(Color(hex: T.muted))
                                        .tnum()
                                }
                                if let c = clientName {
                                    Text(c)
                                        .font(TTypo.xs(11))
                                        .foregroundStyle(Color(hex: T.muted))
                                        .lineLimit(1)
                                }
                                Text("· \(panels.count) panel\(panels.count == 1 ? "" : "s")")
                                    .font(TTypo.xs(11))
                                    .foregroundStyle(Color(hex: T.muted))
                            }
                        }

                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                }
            }
            .buttonStyle(.plain)

            // Expanded: each panel as a full task card with its own LOG TIME.
            if isExpanded {
                if panels.isEmpty {
                    NoJobsPlaceholder(text: "No panels scheduled")
                } else {
                    ForEach(panels) { task in
                        NavigationLink(value: task.job) {
                            TaskCardV1(task: task)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: isExpanded)
    }
}

// MARK: - End-of-day placeholder (dashed)

private struct EndOfDayPlaceholder: View {
    var body: some View {
        HStack(spacing: 8) {
            TIconView(icon: .check, size: 14, color: Color(hex: T.muted))
            Text("End of today · 0 unassigned")
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.muted))
        }
        .padding(14)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - LogTimeConfirmSheet
// Modal that pops up when the user taps LOG TIME on a task card. Shows what
// they're about to start tracking and how much time has already been logged.

private struct LogTimeConfirmSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let task: TaskAssignment
    let deptLabel: String
    let deptColor: Color
    let customer: String?
    let onConfirm: () -> Void

    private var loggedOnOp: Double {
        task.op?.loggedHours ?? 0
    }
    private var loggedOnJob: Double {
        task.job.loggedHours ?? 0
    }
    private var estimate: Double {
        max(task.hpd, 0.5)
    }
    /// Hours-weighted percent for the task (op if specific, otherwise the panel).
    private var taskPct: Int {
        task.op.map { appState.opPct($0) } ?? appState.panelPct(task.panel)
    }
    private var jobPct: Int { appState.jobPct(task.job) }
    private var dateRange: String {
        let f = DateFormatter(); f.dateFormat = "MMM d"
        guard let s = task.startDate else { return "" }
        guard let e = task.endDate, !Calendar.current.isDate(s, inSameDayAs: e) else {
            return f.string(from: s)
        }
        return "\(f.string(from: s)) – \(f.string(from: e))"
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 24)

                // Summary card
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        JobTypeTag(label: deptLabel, color: deptColor)
                        if let n = task.job.jobNumber, !n.isEmpty {
                            Text("#\(n)")
                                .font(TTypo.mono(11))
                                .foregroundStyle(Color(hex: T.muted))
                                .tnum()
                        }
                        Spacer()
                        StatusBadge(status: task.status)
                    }
                    Text(task.title)
                        .font(.custom(TFontName.bold.rawValue, size: 20))
                        .foregroundStyle(Color(hex: T.ink))
                    if let customer, !customer.isEmpty {
                        Text(customer)
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    if !task.job.title.isEmpty, task.job.title != customer {
                        Text(task.job.title)
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.muted))
                    }

                    SLine().padding(.vertical, 4)

                    metricRow("This task",
                              String(format: "%.2f h · %d%%", loggedOnOp, taskPct),
                              sub: String(format: "of %.1f h/day est.", estimate))
                    metricRow("This job",
                              String(format: "%.2f h · %d%%", loggedOnJob, jobPct),
                              sub: nil)
                    if !task.panel.title.isEmpty {
                        metricRow("Panel",  task.panel.title, sub: nil)
                    }
                    if !dateRange.isEmpty {
                        metricRow("Window", dateRange, sub: nil)
                    }
                }
                .padding(18)
                .frostedCard(radius: T.cornerHero)
                .padding(.horizontal, 24)

                Spacer(minLength: 0)

                // Actions
                HStack(spacing: 10) {
                    Button { dismiss() } label: {
                        Text("CANCEL")
                            .font(TTypo.xsBold(13))
                            .tLabel(tracking: 0.8)
                            .foregroundStyle(Color(hex: T.ink))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Capsule().fill(Color(hex: T.surface)))
                            .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    GradientCTA(verticalPadding: 14, action: {
                        onConfirm()
                        dismiss()
                    }) {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill")
                            Text("START TIMER")
                                .font(TTypo.xsBold(13))
                                .tLabel(tracking: 0.8)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 28)
                .padding(.top, 18)
            }
        }
    }

    @ViewBuilder
    private func metricRow(_ label: String, _ value: String, sub: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.2)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(value)
                    .font(.custom(TFontName.bold.rawValue, size: 14))
                    .foregroundStyle(Color(hex: T.ink))
                    .tnum()
                if let sub {
                    Text(sub)
                        .font(TTypo.xs(10))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                }
            }
        }
    }
}

// MARK: - JobRow (compact, used by ClientsView's job list)

struct JobRow: View {
    let job: Job
    var body: some View {
        HStack(spacing: 10) {
            Rectangle().fill(Color(hex: job.color)).frame(width: 4, height: 32).cornerRadius(2)
            VStack(alignment: .leading, spacing: 2) {
                Text(job.title)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                if let n = job.jobNumber, !n.isEmpty {
                    Text("#\(n)")
                        .font(TTypo.mono(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                }
            }
            Spacer()
            Text(job.status.rawValue)
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 0.8)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).fill(Color(hex: T.surface)))
        .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
    }
}

// MARK: - StatusBadge / PriorityDot (used by JobDetailView)

struct StatusBadge: View {
    let status: JobStatus
    var body: some View {
        Text(status.rawValue)
            .font(TTypo.xsBold(11))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(status.color.opacity(0.13)))
            .overlay(Capsule().stroke(status.color.opacity(0.3), lineWidth: 1))
            .foregroundStyle(status.color)
    }
}

struct PriorityDot: View {
    let priority: Priority
    var body: some View {
        Circle().fill(priority.color).frame(width: 8, height: 8)
    }
}

// MARK: - JobStatus / Priority color extensions (shared)

extension JobStatus {
    var color: Color {
        switch self {
        case .notStarted: return Color(hex: T.statusNotStarted)
        case .pending:    return Color(hex: T.statusPending)
        case .inProgress: return Color(hex: T.statusInProgress)
        case .onHold:     return Color(hex: T.statusOnHold)
        case .finished:   return Color(hex: T.statusFinished)
        }
    }
}

extension Priority {
    var color: Color {
        switch self {
        case .low:    return Color(hex: T.priLow)
        case .medium: return Color(hex: T.priMedium)
        case .high:   return Color(hex: T.priHigh)
        }
    }
}

extension String {
    var shortDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: self) else { return self }
        formatter.dateStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Department mapping (shared with Schedule)

func deptForJob(_ job: Job) -> (label: String, color: Color) {
    let key = (job.jobType ?? "").lowercased()
    switch key {
    case _ where key.contains("layout"):  return ("LAYOUT",  Color(hex: T.magenta))
    case _ where key.contains("wire"):    return ("WIRE",    Color(hex: T.cyan))
    case _ where key.contains("cut"):     return ("CUT",     Color(hex: T.yellow))
    case _ where key.contains("inspect"): return ("INSPECT", Color(hex: T.lavender))
    case _ where key.contains("repair"):  return ("REPAIR",  Color(hex: T.amber))
    case _ where key.contains("install"): return ("INSTALL", Color(hex: T.magenta))
    case _ where key.contains("callback"):return ("CALLBACK",Color(hex: T.red))
    case _ where key.contains("contract"):return ("CONTRACT",Color(hex: T.green))
    default:
        let label = (job.jobType?.uppercased()).flatMap { $0.isEmpty ? nil : $0 } ?? "JOB"
        return (label, Color(hex: job.color))
    }
}
