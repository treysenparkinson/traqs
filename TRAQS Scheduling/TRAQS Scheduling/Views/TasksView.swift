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

            ScrollView {
                VStack(spacing: 0) {
                    TRAQSNavHeader {
                        IconBtn(icon: .search, size: 18)
                        if appState.isAdmin {
                            IconBtn(icon: .plus, size: 18) { showAddJob = true }
                        }
                    }

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
            .sheet(isPresented: $showAddJob) { JobEditView(job: nil) }
            .navigationDestination(for: Job.self) { JobDetailView(job: $0) }
        }
        .toolbar(.hidden, for: .navigationBar)
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
        let days = weekDates(around: selectedDate)
        let byDay = tasksByStartDay(in: days)
        return VStack(spacing: 0) {
            WeekStrip(
                days: days,
                selected: selectedDate,
                countFor: { counts[cal.startOfDay(for: $0)] ?? 0 },
                onPick: { day in withAnimation(.easeInOut(duration: 0.18)) { selectedDate = day } }
            )
            .padding(.horizontal, 16).padding(.bottom, 14)

            DayGroupedTaskList(days: days, tasksByDay: byDay)
                .padding(.bottom, 24)
        }
    }

    // ── Month: calendar grid + every TASK this month, placed under start day ─

    private var monthView: some View {
        let counts = dayCountMap
        let monthDates = monthDays(of: selectedDate)
        let byDay = tasksByStartDay(in: monthDates)
        return VStack(spacing: 0) {
            MonthCalendar(
                month: selectedDate,
                selected: selectedDate,
                countFor: { counts[cal.startOfDay(for: $0)] ?? 0 },
                onPick: { day in withAnimation(.easeInOut(duration: 0.18)) { selectedDate = day } }
            )
            .padding(.horizontal, 16).padding(.bottom, 14)

            DayGroupedTaskList(days: monthDates, tasksByDay: byDay)
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
                NoJobsPlaceholder(text: "No tasks on this day")
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
    /// panel-level assignment for that panel.
    /// If the user is on `job.team` only (with no panel/op membership),
    /// surface every panel of that job as a panel-level assignment so
    /// they at least see what they were assigned to.
    private var myTasks: [TaskAssignment] {
        guard let me = appState.currentPersonId else { return [] }
        var out: [TaskAssignment] = []
        for job in appState.jobs {
            if !searchText.isEmpty {
                let q = searchText.lowercased()
                let hay = (job.title + " " + (job.jobNumber ?? "")).lowercased()
                if !hay.contains(q) { continue }
            }

            var addedAny = false
            for panel in job.subs {
                let myOps = panel.subs.filter { $0.team.contains(me) }
                if !myOps.isEmpty {
                    for op in myOps {
                        out.append(TaskAssignment(job: job, panel: panel, op: op))
                    }
                    addedAny = true
                } else if panel.team.contains(me) {
                    out.append(TaskAssignment(job: job, panel: panel, op: nil))
                    addedAny = true
                }
            }
            // Fallback: user on job.team only → list every panel so the job is visible.
            if !addedAny, job.team.contains(me) {
                for panel in job.subs {
                    out.append(TaskAssignment(job: job, panel: panel, op: nil))
                }
            }
        }
        return out
    }

    /// Pre-computed map of `startOfDay → task count`. One pass through
    /// `myTasks`, then every Week/Month/Year cell does an O(1) lookup.
    private var dayCountMap: [Date: Int] {
        var map: [Date: Int] = [:]
        for task in myTasks {
            guard let s = task.startDate, let e = task.endDate, e >= s else { continue }
            var day = cal.startOfDay(for: s)
            let end = cal.startOfDay(for: e)
            while day <= end {
                map[day, default: 0] += 1
                guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
            }
        }
        return map
    }

    /// Tasks whose date range includes `day`.
    private func tasks(for day: Date) -> [TaskAssignment] {
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

            let placement = max(taskStart, wStart)
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
                if bounds.contains(day) {
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
                NoJobsPlaceholder(text: "No tasks in this range")
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
    private let cal = Calendar.current

    var body: some View {
        HStack(spacing: 6) {
            ForEach(days, id: \.self) { d in
                let isSelected = cal.isDate(d, inSameDayAs: selected)
                let isToday = cal.isDateInToday(d)
                let count = countFor(d)

                Button { onPick(d) } label: {
                    VStack(spacing: 4) {
                        Text(dowChar(d))
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(isSelected ? Color(hex: T.sky) : Color(hex: T.muted))
                            .tLabel(tracking: 0.6)
                        Text("\(cal.component(.day, from: d))")
                            .font(TTypo.smBold(15))
                            .foregroundStyle(Color(hex: T.ink))
                            .tnum()
                        // Up to 4 magenta dots; hollow for zero
                        HStack(spacing: 2) {
                            if count == 0 {
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
                }
                .buttonStyle(.plain)
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

    private var isActive: Bool {
        guard let jc = appState.myActiveJobClock else { return false }
        if let opId = task.op?.id { return jc.opId == opId }
        return jc.opId == nil && jc.panelId == task.panel.id
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

    private var liveElapsed: String {
        guard let jc = appState.myActiveJobClock,
              let started = ISO8601DateFormatter().date(from: jc.clockIn) else { return "—" }
        var ms = Date().timeIntervalSince(started) * 1000
        ms -= (jc.totalPausedMs ?? 0)
        if let p = jc.pausedAt, let pStart = ISO8601DateFormatter().date(from: p) {
            ms -= Date().timeIntervalSince(pStart) * 1000
        }
        let secs = max(0, Int(ms / 1000))
        return String(format: "%d:%02d", secs / 3600, (secs % 3600) / 60)
    }

    var body: some View {
        SBox(size: .lg, sky: isActive) {
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
                    StatusBadge(status: task.status)
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
        .sheet(isPresented: $showLogConfirm) {
            LogTimeConfirmSheet(task: task,
                                deptLabel: dept.label,
                                deptColor: dept.color,
                                customer: clientName,
                                onConfirm: {
                                    Task {
                                        await appState.jobClockIn(
                                            jobId: task.job.id,
                                            panelId: task.panel.id,
                                            opId: task.op?.id,
                                            jobTitle: task.job.title,
                                            panelTitle: task.panel.title,
                                            opTitle: task.op?.title)
                                    }
                                })
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder
    private var activeRow: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    HStack(spacing: 5) {
                        Circle().fill(Color(hex: T.sky)).frame(width: 7, height: 7)
                        Text("TRACKING")
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(Color(hex: T.sky))
                            .tLabel(tracking: 1.0)
                    }
                    Spacer()
                    Text(liveElapsed)
                        .font(TTypo.mono(11))
                        .foregroundStyle(Color(hex: T.sky))
                        .tnum()
                }
                Bar(pct: 50, height: 6, fill: Color(hex: T.sky))
            }
            Button {
                Task { await appState.jobClockOut() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "stop.fill")
                    Text("STOP").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Color(hex: T.sky)))
                .shadow(color: Color(hex: T.sky).opacity(T.skyShadowOpacity),
                        radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var queuedRow: some View {
        HStack {
            HStack(spacing: 6) {
                TIconView(icon: .pin, size: 12, color: Color(hex: T.muted))
                Text("Queued")
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.0)
            }
            Spacer()
            Button {
                showLogConfirm = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill")
                    Text("LOG TIME").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                }
                .foregroundStyle(Color(hex: T.ink))
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Capsule().fill(Color(hex: T.surface)))
                .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                        radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
            }
            .buttonStyle(.plain)
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

                    metricRow("This task",  String(format: "%.2f h", loggedOnOp),  sub: String(format: "of %.1f h/day est.", estimate))
                    metricRow("This job",   String(format: "%.2f h", loggedOnJob), sub: nil)
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
