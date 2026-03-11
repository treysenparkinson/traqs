import SwiftUI

struct GanttView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings

    @State private var selectedDate = Calendar.current.startOfDay(for: Date())
    @State private var weekOffset = 0
    @State private var showMyTasks = false
    @State private var showFastTRAQS = false
    @State private var showAddJob = false

    private let cal = Calendar.current

    // MARK: - Computed

    var weekDates: [Date] {
        // Find Monday of the current week + offset
        let today = Date()
        let weekday = cal.component(.weekday, from: today)
        let daysToMonday = weekday == 1 ? -6 : -(weekday - 2)
        let thisMonday = cal.date(byAdding: .day, value: daysToMonday, to: today)!
        let weekStart = cal.date(byAdding: .weekOfYear, value: weekOffset, to: thisMonday)!
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: weekStart) }
    }

    var weekLabel: String {
        guard let first = weekDates.first, let last = weekDates.last else { return "" }
        let f = DateFormatter(); f.dateFormat = "MMM d"
        let g = DateFormatter(); g.dateFormat = "d, yyyy"
        let h = DateFormatter(); h.dateFormat = "MMM d, yyyy"
        if cal.component(.month, from: first) == cal.component(.month, from: last) {
            return "\(f.string(from: first))–\(g.string(from: last))"
        }
        return "\(f.string(from: first)) – \(h.string(from: last))"
    }

    var activeTasks: [(job: Job, panel: Panel, op: Operation)] {
        let all = appState.jobs.flatMap { job in
            job.subs.flatMap { panel in
                panel.subs.filter { op in
                    guard let s = op.start.asDate, let e = op.end.asDate else { return false }
                    return s <= selectedDate && e >= selectedDate
                }.map { (job: job, panel: panel, op: $0) }
            }
        }.sorted { $0.op.start < $1.op.start }

        if showMyTasks, let myId = appState.currentPersonId {
            return all.filter { $0.op.team.contains(myId) }
        }
        return all
    }

    var selectedDateLabel: String {
        let f = DateFormatter()
        f.dateFormat = "EEEE, MMM d"
        return f.string(from: selectedDate)
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

                VStack(spacing: 0) {

                    // ── Logo header ──
                    HStack {
                        Spacer()
                        VStack(spacing: 2) {
                            TRAQSNavLogo()
                            Text("Schedule")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(Color(hex: T.muted))
                                .kerning(0.8)
                                .textCase(.uppercase)
                        }
                        Spacer()
                    }
                    .padding(.top, 20)
                    .padding(.bottom, 14)
                    .background(Color(hex: T.surface))

                    Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                    // ── Sub-header: Ask TRAQS | All/My Tasks (centered) | Add ──
                    ZStack {
                        Picker("", selection: $showMyTasks) {
                            Text("All Tasks").tag(false)
                            Text("My Tasks").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 180)

                        HStack {
                            Button { showFastTRAQS = true } label: {
                                FastTRAQSPillButton()
                            }
                            .buttonStyle(.plain)

                            Spacer()

                            Button { showAddJob = true } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(Color(hex: T.accent))
                                    .frame(width: 32, height: 32)
                                    .background(Color(hex: T.accent).opacity(0.12))
                                    .clipShape(Circle())
                                    .overlay(Circle().stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color(hex: T.surface))

                    // ── Week navigation row ──
                    ZStack {
                        Text(weekLabel)
                            .font(.caption.bold())
                            .foregroundColor(Color(hex: T.muted))

                        HStack(spacing: 0) {
                            Button { weekOffset -= 1 } label: {
                                Image(systemName: "chevron.left")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(Color(hex: T.accent))
                                    .frame(width: 36, height: 36)
                            }

                            Spacer()

                            Button("Today") {
                                weekOffset = 0
                                selectedDate = cal.startOfDay(for: Date())
                            }
                            .font(.caption.bold())
                            .foregroundColor(Color(hex: T.accent))
                            .padding(.trailing, 4)

                            Button { weekOffset += 1 } label: {
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(Color(hex: T.accent))
                                    .frame(width: 36, height: 36)
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(hex: T.surface))

                    // ── Day strip ──
                    HStack(spacing: 2) {
                        ForEach(weekDates, id: \.self) { date in
                            DayCell(
                                date: date,
                                isSelected: cal.isDate(date, inSameDayAs: selectedDate),
                                isToday: cal.isDateInToday(date),
                                taskCount: taskCount(for: date)
                            ) {
                                selectedDate = cal.startOfDay(for: date)
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
                    .background(Color(hex: T.surface))

                    Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                    // ── Date header ──
                    HStack {
                        Text(selectedDateLabel)
                            .font(.subheadline.bold())
                            .foregroundColor(Color(hex: T.text))
                        Spacer()
                        Text("\(activeTasks.count) task\(activeTasks.count == 1 ? "" : "s")")
                            .font(.caption)
                            .foregroundColor(Color(hex: T.muted))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                    Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                    // ── Task list ──
                    if activeTasks.isEmpty {
                        Spacer()
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle")
                                .font(.system(size: 44))
                                .foregroundColor(Color(hex: T.border))
                            Text(showMyTasks ? "No tasks assigned to you today" : "No tasks scheduled for this day")
                                .foregroundColor(Color(hex: T.muted))
                                .font(.subheadline)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 40)
                        }
                        Spacer()
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(activeTasks, id: \.op.id) { item in
                                    ScheduleTaskRow(job: item.job, panel: item.panel, op: item.op)
                                }
                            }
                            .padding(16)
                        }
                        .refreshable { await appState.loadAll() }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showFastTRAQS) { FastTRAQSView() }
            .sheet(isPresented: $showAddJob) { JobEditView(job: nil) }
        }
    }

    private func taskCount(for date: Date) -> Int {
        appState.jobs.flatMap { $0.subs }.flatMap { $0.subs }.filter { op in
            guard let s = op.start.asDate, let e = op.end.asDate else { return false }
            let d = cal.startOfDay(for: date)
            return s <= d && e >= d
        }.count
    }
}

// MARK: - Day Cell

struct DayCell: View {
    let date: Date
    let isSelected: Bool
    let isToday: Bool
    let taskCount: Int
    let action: () -> Void

    private let cal = Calendar.current

    var isWeekend: Bool {
        let w = cal.component(.weekday, from: date); return w == 1 || w == 7
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Text(String(date.dayOfWeek.prefix(1)))
                    .font(.system(size: 11))
                    .foregroundColor(
                        isSelected ? Color(hex: T.accent) :
                        isWeekend ? Color(hex: T.danger) :
                        Color(hex: T.muted)
                    )

                ZStack {
                    Circle()
                        .fill(isSelected ? Color(hex: T.accent) : Color.clear)
                        .frame(width: 34, height: 34)

                    if isToday && !isSelected {
                        Circle()
                            .stroke(Color(hex: T.accent), lineWidth: 1.5)
                            .frame(width: 34, height: 34)
                    }

                    Text(date.dayNumber)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(
                            isSelected ? .white :
                            isToday ? Color(hex: T.accent) :
                            isWeekend ? Color(hex: T.danger) :
                            Color(hex: T.text)
                        )
                }

                // Task dot indicator
                Circle()
                    .fill(taskCount > 0 ? (isSelected ? Color.white.opacity(0.7) : Color(hex: T.accent)) : Color.clear)
                    .frame(width: 4, height: 4)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Schedule Task Row

struct ScheduleTaskRow: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panel: Panel
    let op: Operation

    var body: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: job.color))
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(op.title)
                        .font(.subheadline.bold())
                        .foregroundColor(Color(hex: T.text))
                        .lineLimit(1)
                    Spacer()
                    StatusBadge(status: op.status)
                }

                Text("\(job.title)  ›  \(panel.title)")
                    .font(.caption)
                    .foregroundColor(Color(hex: T.muted))
                    .lineLimit(1)

                HStack(spacing: 6) {
                    HStack(spacing: -6) {
                        ForEach(op.team.prefix(4), id: \.self) { id in
                            if let person = appState.person(id: id) {
                                Circle()
                                    .fill(Color(hex: person.color))
                                    .frame(width: 20, height: 20)
                                    .overlay(
                                        Text(String(person.name.prefix(1)))
                                            .font(.system(size: 9, weight: .bold))
                                            .foregroundColor(.white)
                                    )
                                    .overlay(Circle().stroke(Color(hex: T.card), lineWidth: 1))
                            }
                        }
                    }
                    if op.team.count > 4 {
                        Text("+\(op.team.count - 4)").font(.caption2).foregroundColor(Color(hex: T.muted))
                    }
                    Spacer()
                    PriorityDot(priority: op.pri)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(Color(hex: T.card))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
    }
}

// MARK: - Date Extensions

extension Date {
    var dayOfWeek: String {
        let f = DateFormatter(); f.dateFormat = "E"; return f.string(from: self)
    }
    var dayNumber: String {
        let f = DateFormatter(); f.dateFormat = "d"; return f.string(from: self)
    }
    var isWeekend: Bool {
        let w = Calendar.current.component(.weekday, from: self); return w == 1 || w == 7
    }
}
