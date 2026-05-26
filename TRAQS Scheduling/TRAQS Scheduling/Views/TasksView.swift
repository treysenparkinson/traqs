import SwiftUI

// MARK: - Jobs V1 (Today · card stack) · TRAQS Light
// Lives in TasksView.swift / struct TasksView for back-compat (MainTabView routes
// the Jobs tab to this view). Re-styled to the TRAQS Light language.

struct TasksView: View {
    @Environment(AppState.self) private var appState

    @State private var searchText = ""
    @State private var segment: JobsSegment = .today
    @State private var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    @State private var showAddJob = false
    @State private var showSearch = false
    @FocusState private var searchFocused: Bool

    enum JobsSegment: String, CaseIterable, Hashable { case today, week, month, year
        var label: String { rawValue.capitalized }
    }

    private let cal = Calendar.current

    /// Wrap segment changes so the content cross-fade animates with a known curve.
    /// When the user moves to Week / Month, also recenter `selectedDate` to today.
    private var segmentBinding: Binding<JobsSegment> {
        Binding(
            get: { segment },
            set: { new in
                withAnimation(.easeInOut(duration: 0.22)) {
                    segment = new
                    selectedDate = Calendar.current.startOfDay(for: Date())
                }
            }
        )
    }

    var body: some View {
        NavigationStack {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                // Sticky header — pinned outside the ScrollView so the menu
                // button, wordmark, and add button stay visible while the
                // content scrolls underneath.
                TRAQSNavHeader {
                    IconBtn(icon: .search, size: 18) {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            showSearch.toggle()
                            if !showSearch { searchText = "" }
                        }
                        if showSearch { searchFocused = true }
                    }
                    if appState.isAdmin {
                        IconBtn(icon: .plus, size: 18) { showAddJob = true }
                    }
                }
                .background(Color(hex: T.bg))

                // Search field — slides in when the search icon is tapped.
                if showSearch {
                    SearchBar(text: $searchText,
                              placeholder: "Search jobs, customers…",
                              focused: $searchFocused,
                              onCancel: {
                                  withAnimation(.easeInOut(duration: 0.18)) {
                                      showSearch = false
                                      searchText = ""
                                  }
                              })
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                ScrollView {
                    VStack(spacing: 0) {
                        HStack { Spacer()
                            Segmented(
                                options: JobsSegment.allCases,
                                labels: Dictionary(uniqueKeysWithValues: JobsSegment.allCases.map { ($0, $0.label) }),
                                selection: segmentBinding)
                            Spacer()
                        }
                        .padding(.bottom, 12)

                        // Cross-faded content per segment
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
                }
                .scrollIndicators(.hidden)
            }
            .sheet(isPresented: $showAddJob) { JobEditView(job: nil) }
            .navigationDestination(for: Job.self) { JobDetailView(job: $0) }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await appState.refreshOrgSettings() }
        }
    }

    // ── Today: original card stack ─────────────────────────────────────────

    private var todayView: some View {
        VStack(spacing: 0) {
            daySummaryLine(tasks: tasks(for: cal.startOfDay(for: Date())))
                .padding(.horizontal, 16).padding(.bottom, 8)

            taskList(for: cal.startOfDay(for: Date()))

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

            // Show tasks for the SELECTED day only — not the whole week.
            // Previously we rendered a day-grouped list of every populated
            // day in the week, which made the week view feel like an
            // information dump. Picking a pill now filters the list to
            // just that day, like a calendar app.
            daySummaryLine(tasks: tasks(for: selectedDate))
                .padding(.horizontal, 16).padding(.bottom, 8)
            taskList(for: selectedDate)
                .padding(.bottom, 24)
        }
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

            // Same pattern as the Week view: show tasks for the SELECTED
            // day only. Tapping a calendar cell filters the list below.
            daySummaryLine(tasks: tasks(for: selectedDate))
                .padding(.horizontal, 16).padding(.bottom, 8)
            taskList(for: selectedDate)
                .padding(.bottom, 24)
        }
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

            HStack {
                Text("UPCOMING")
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.4)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.bottom, 8)

            VStack(spacing: 12) {
                ForEach(upcomingTasks) { task in
                    NavigationLink(value: task.job) {
                        TaskCardV1(task: task)
                    }
                    .buttonStyle(.plain)
                }
                if upcomingTasks.isEmpty {
                    NoJobsPlaceholder(text: "No upcoming tasks")
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }

    // ── Shared row pieces ─────────────────────────────────────────────────

    private func daySummaryLine(tasks: [TaskAssignment]) -> some View {
        let df = DateFormatter(); df.dateFormat = "EEE · MMM d"
        let totalHours = tasks.reduce(0.0) { $0 + max($1.hpd, 0) }
        return HStack(alignment: .firstTextBaseline) {
            Text("\(df.string(from: selectedDate)) · \(tasks.count) task\(tasks.count == 1 ? "" : "s")")
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.4)
            Spacer()
            Text(String(format: "%.1f h", totalHours))
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
                .tnum()
        }
    }

    @ViewBuilder
    private func taskList(for day: Date) -> some View {
        let dayTasks = tasks(for: day)
        if dayTasks.isEmpty {
            VStack(spacing: 6) {
                NoJobsPlaceholder(text: "No jobs scheduled")
                diagnosticLine
            }
            .padding(.horizontal, 16).padding(.top, 8)
        } else {
            VStack(spacing: 12) {
                ForEach(dayTasks) { task in
                    NavigationLink(value: task.job) {
                        TaskCardV1(task: task)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
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
        for task in myTasks {
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

    /// Tasks whose date range includes `day`. Returns empty on non-work days
    /// so the Today view never lists work for a Saturday/Sunday when the org
    /// isn't scheduled to operate then.
    private func tasks(for day: Date) -> [TaskAssignment] {
        guard isWorkDay(day) else { return [] }
        let dayStart = cal.startOfDay(for: day)
        let dayEnd = cal.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
        return myTasks.filter {
            guard let s = $0.startDate, let e = $0.endDate else { return false }
            return s < dayEnd && e >= dayStart
        }
        .sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
    }

    /// Upcoming tasks (today and beyond), flat sorted list — Year tab.
    private var upcomingTasks: [TaskAssignment] {
        let today = cal.startOfDay(for: Date())
        return myTasks
            .filter { ($0.endDate ?? .distantPast) >= today }
            .sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
            .prefix(30)
            .map { $0 }
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

// MARK: - TaskAssignment
// One scheduled task — the canonical unit of work shown in the Jobs list.
// `op == nil` means the user is on `panel.team` but no specific op.

struct TaskAssignment: Identifiable {
    let job: Job
    let panel: Panel
    let op: Operation?

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

private struct TaskCardV1: View {
    @Environment(AppState.self) private var appState
    let task: TaskAssignment
    @State private var showLogConfirm = false
    @State private var isStopping = false
    @State private var isStarting = false
    @State private var isPausing = false

    private var isActive: Bool {
        guard let jc = appState.myActiveJobClock else { return false }
        if let opId = task.op?.id { return jc.opId == opId }
        return jc.opId == nil && jc.panelId == task.panel.id
    }

    /// This task is the active job clock AND that clock is paused (on
    /// break). Drives the amber card highlight + "Paused" badge.
    private var isPaused: Bool {
        isActive && (appState.myActiveJobClock?.isPaused == true)
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
        SBox(size: .lg, sky: isActive && !isPaused, amber: isPaused) {
            VStack(alignment: .leading, spacing: 0) {
                // Top row: dept tag + #ID  ·······  status badge
                HStack(spacing: 10) {
                    JobTypeTag(label: dept.label, color: dept.color)
                    if let n = task.job.jobNumber, !n.isEmpty {
                        Text("#\(n)")
                            .font(TTypo.mono(11))
                            .foregroundStyle(Color(hex: T.muted))
                            .tnum()
                    }
                    Spacer()
                    if isPaused {
                        Chip(label: "PAUSED",
                             fill: Color(hex: T.amber).opacity(0.12),
                             stroke: Color(hex: T.amber),
                             color: Color(hex: T.amber))
                    } else {
                        StatusBadge(status: task.status)
                    }
                }

                // Headline: TASK title — what the user is actually doing
                Text(task.title)
                    .font(TTypo.h3(20))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(2)
                    .padding(.top, 8)

                // Sub-line: customer + job title
                if !contextLine.isEmpty {
                    Text(contextLine)
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }

                // Panel + date row
                HStack(spacing: 6) {
                    if task.op != nil, !task.panel.title.isEmpty {
                        HStack(spacing: 4) {
                            Image(systemName: "square.stack.3d.up")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Color(hex: T.muted))
                            Text(task.panel.title)
                                .font(TTypo.xs(11))
                                .foregroundStyle(Color(hex: T.muted))
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    if !dateRange.isEmpty {
                        Text(dateRange)
                            .font(TTypo.mono(11))
                            .foregroundStyle(Color(hex: T.muted))
                            .tnum()
                    }
                }
                .padding(.top, 8)

                SLine().padding(.vertical, 12)

                if isActive { activeRow } else { queuedRow }
            }
            .padding(16)
        }
        .animation(.easeInOut(duration: 0.2), value: isActive)
        .animation(.easeInOut(duration: 0.25), value: isStarting)
        .animation(.easeInOut(duration: 0.25), value: isStopping)
        .animation(.easeInOut(duration: 0.25), value: isPausing)
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
    }

    @ViewBuilder
    private var activeRow: some View {
        let pct = task.op.map { Double(appState.opPct($0)) }
                  ?? Double(appState.panelPct(task.panel))
        // Read pause state from the live activeJobClock so the row
        // reflects the server's truth, not just local optimistic state.
        // `elapsedLabel` already subtracts pausedAt time so the timer
        // visibly freezes while on break.
        let isOnBreak = appState.myActiveJobClock?.isPaused == true
        let trackColor = isOnBreak ? Color(hex: T.amber) : Color(hex: T.sky)
        let trackLabel = isOnBreak ? "ON BREAK" : "TRACKING"

        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    HStack(spacing: 5) {
                        Circle().fill(trackColor).frame(width: 7, height: 7)
                        Text(trackLabel)
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(trackColor)
                            .tLabel(tracking: 1.0)
                    }
                    Spacer()
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text("\(elapsedLabel(at: context.date)) · \(Int(pct))%")
                            .font(TTypo.monoBold(13))
                            .foregroundStyle(trackColor)
                            .tnum()
                    }
                }
                Bar(pct: pct, height: 6, fill: trackColor)
            }

            // Break / End Break — compact circular amber button so it
            // fits beside the timer + STOP without crowding. Pauses the
            // job clock without ending payroll: the worker stays on the
            // clock for pay while on break.
            Button {
                guard !isPausing else { return }
                isPausing = true
                Task {
                    if isOnBreak {
                        await appState.jobResume()
                    } else {
                        await appState.jobPause()
                    }
                    isPausing = false
                }
            } label: {
                if isOnBreak {
                    // On break: a labeled "Resume" capsule — the timer is
                    // frozen so there's room, and the explicit word reads
                    // clearer than a bare play glyph.
                    HStack(spacing: 6) {
                        if isPausing {
                            ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(0.7)
                            Text("RESUMING…").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                        } else {
                            Image(systemName: "play.fill")
                            Text("RESUME").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Capsule().fill(Color(hex: T.amber)))
                    .shadow(color: Color(hex: T.amber).opacity(T.skyShadowOpacity),
                            radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                } else {
                    // Working: compact circular pause icon so the timer +
                    // STOP fit on one row without crowding.
                    Group {
                        if isPausing {
                            ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(0.7)
                        } else {
                            Image(systemName: "pause.fill").font(.system(size: 13, weight: .bold))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color(hex: T.amber)))
                    .shadow(color: Color(hex: T.amber).opacity(T.skyShadowOpacity),
                            radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                }
            }
            .buttonStyle(.plain)
            .disabled(isPausing || isStopping)

            // Stop — clocks out of the job entirely. Disabled while
            // paused so the user doesn't accidentally end the timer
            // when they meant to resume.
            Button {
                guard !isStopping else { return }
                isStopping = true
                Task {
                    await appState.jobClockOut()
                    isStopping = false
                }
            } label: {
                HStack(spacing: 6) {
                    if isStopping {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                            .scaleEffect(0.7)
                        Text("STOPPING…").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                    } else {
                        Image(systemName: "stop.fill")
                        Text("STOP").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Capsule().fill(Color(hex: T.sky)))
                .shadow(color: Color(hex: T.sky).opacity(T.skyShadowOpacity),
                        radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
            }
            .buttonStyle(.plain)
            .disabled(isStopping || isPausing)
        }
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
                        TIconView(icon: .pin, size: 11, color: Color(hex: T.muted))
                        Text(isStarting ? "STARTING…" : "PROGRESS")
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(Color(hex: T.muted))
                            .tLabel(tracking: 1.0)
                    }
                    Spacer()
                    Text("\(Int(pct))%")
                        .font(TTypo.monoBold(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                }
                Bar(pct: pct, height: 6, fill: dept.color)
            }
            Button {
                guard !isStarting else { return }
                showLogConfirm = true
            } label: {
                HStack(spacing: 6) {
                    if isStarting {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(Color(hex: T.ink))
                            .scaleEffect(0.7)
                        Text("STARTING…").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                    } else {
                        Image(systemName: "play.fill")
                        Text("LOG TIME").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                    }
                }
                .foregroundStyle(Color(hex: T.ink))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Capsule().fill(Color(hex: T.surface)))
                .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                        radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
            }
            .buttonStyle(.plain)
            .disabled(isStarting)
        }
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
        .background(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).fill(.clear))
        .overlay(
            RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .foregroundStyle(Color(hex: T.hair))
        )
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
            Color(hex: T.bg).ignoresSafeArea()

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
                .background(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).fill(Color(hex: T.surface)))
                .overlay(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
                .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                        radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
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

                    Button {
                        onConfirm()
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill")
                            Text("START TIMER")
                                .font(TTypo.xsBold(13))
                                .tLabel(tracking: 0.8)
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(Color(hex: T.sky)))
                        .shadow(color: Color(hex: T.sky).opacity(T.skyShadowOpacity),
                                radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                    }
                    .buttonStyle(.plain)
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
