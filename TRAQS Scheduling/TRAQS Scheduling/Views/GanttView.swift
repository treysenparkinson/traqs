import SwiftUI

struct GanttView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings

    @State private var selectedDate = Calendar.current.startOfDay(for: Date())
    @State private var weekOffset = 0
    @State private var showMyTasks = true
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

    // Group activeTasks by job for condensed display
    var activeJobGroups: [DayJobGroup] {
        var byJob: [String: [(panel: Panel, op: Operation)]] = [:]
        var order: [String] = []
        for item in activeTasks {
            if byJob[item.job.id] == nil { order.append(item.job.id) }
            byJob[item.job.id, default: []].append((item.panel, item.op))
        }
        return order.compactMap { id -> DayJobGroup? in
            guard let ops = byJob[id],
                  let job = appState.jobs.first(where: { $0.id == id }) else { return nil }
            return DayJobGroup(job: job, ops: ops)
        }
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
                            if appState.isAdmin {
                                Button { showFastTRAQS = true } label: {
                                    FastTRAQSPillButton()
                                }
                                .buttonStyle(.plain)
                            }

                            Spacer()

                            if appState.isAdmin {
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
                        if appState.isLoading {
                            ProgressView()
                                .scaleEffect(0.75)
                                .tint(Color(hex: T.accent))
                        } else {
                            Text("\(activeJobGroups.count) job\(activeJobGroups.count == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundColor(Color(hex: T.muted))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                    Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                    // ── Task list ──
                    if activeJobGroups.isEmpty {
                        Spacer()
                        VStack(spacing: 12) {
                            if let err = appState.errorMessage {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 44))
                                    .foregroundColor(Color(hex: T.danger))
                                Text(err)
                                    .foregroundColor(Color(hex: T.danger))
                                    .font(.caption)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal, 40)
                            } else {
                                Image(systemName: "checkmark.circle")
                                    .font(.system(size: 44))
                                    .foregroundColor(Color(hex: T.border))
                                Text(showMyTasks ? "No tasks assigned to you today" : "No tasks scheduled for this day")
                                    .foregroundColor(Color(hex: T.muted))
                                    .font(.subheadline)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal, 40)
                            }
                        }
                        Spacer()
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(activeJobGroups) { group in
                                    JobDayRow(group: group)
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

// MARK: - Day Job Group

struct DayJobGroup: Identifiable {
    var id: String { job.id }
    let job: Job
    let ops: [(panel: Panel, op: Operation)]

    var worstStatus: JobStatus {
        let s = ops.map(\.op.status)
        if s.contains(.inProgress) { return .inProgress }
        if s.contains(.onHold)     { return .onHold }
        if s.contains(.pending)    { return .pending }
        if s.contains(.notStarted) { return .notStarted }
        return .finished
    }
    var allTeamIds: [String] {
        Array(Set(ops.flatMap(\.op.team)))
    }
}

// MARK: - Job Day Row

struct JobDayRow: View {
    @Environment(AppState.self) private var appState
    let group: DayJobGroup
    @State private var isExpanded = false

    var body: some View {
        VStack(spacing: 0) {

            // ── Header ──
            Button {
                withAnimation(.easeInOut(duration: 0.22)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 0) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(hex: group.job.color))
                        .frame(width: 4)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(group.job.title)
                                .font(.subheadline.bold())
                                .foregroundColor(Color(hex: T.text))
                                .lineLimit(1)
                            if let num = group.job.jobNumber {
                                Text("#\(num)")
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            Spacer()
                            if group.ops.count > 1 {
                                Text("\(group.ops.count) ops")
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 5).padding(.vertical, 2)
                                    .background(Color(hex: group.job.color).opacity(0.15))
                                    .foregroundColor(Color(hex: group.job.color))
                                    .cornerRadius(5)
                            }
                            StatusBadge(status: group.worstStatus)
                        }

                        HStack(spacing: 6) {
                            // Team avatars
                            HStack(spacing: -6) {
                                ForEach(group.allTeamIds.prefix(4), id: \.self) { id in
                                    if let person = appState.person(id: id) {
                                        Circle()
                                            .fill(Color(hex: person.color))
                                            .frame(width: 20, height: 20)
                                            .overlay(Text(String(person.name.prefix(1)))
                                                .font(.system(size: 9, weight: .bold))
                                                .foregroundColor(.white))
                                            .overlay(Circle().stroke(Color(hex: T.card), lineWidth: 1))
                                    }
                                }
                            }
                            if group.allTeamIds.count > 4 {
                                Text("+\(group.allTeamIds.count - 4)")
                                    .font(.caption2).foregroundColor(Color(hex: T.muted))
                            }
                            Spacer()
                            PriorityDot(priority: group.job.pri)
                            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                                .font(.caption2)
                                .foregroundColor(Color(hex: T.muted))
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // ── Expanded: operation list ──
            if isExpanded {
                VStack(spacing: 0) {
                    ForEach(group.ops, id: \.op.id) { item in
                        Rectangle().fill(Color(hex: T.border)).frame(height: 1)
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Text(item.op.title)
                                    .font(.subheadline)
                                    .foregroundColor(Color(hex: T.text))
                                Text("›")
                                    .foregroundColor(Color(hex: T.muted))
                                    .font(.caption)
                                Text(item.panel.title)
                                    .font(.caption)
                                    .foregroundColor(Color(hex: T.muted))
                                Spacer()
                                StatusBadge(status: item.op.status)
                            }
                            HStack(spacing: 10) {
                                Label(String(format: "%.4gh/day", item.op.hpd), systemImage: "clock")
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: T.muted))
                                Label(item.op.start.shortDate + " – " + item.op.end.shortDate, systemImage: "calendar")
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            if !item.op.team.isEmpty {
                                HStack(spacing: 6) {
                                    HStack(spacing: -5) {
                                        ForEach(item.op.team.prefix(5), id: \.self) { id in
                                            if let person = appState.person(id: id) {
                                                Circle()
                                                    .fill(Color(hex: person.color))
                                                    .frame(width: 22, height: 22)
                                                    .overlay(Text(String(person.name.prefix(1)))
                                                        .font(.system(size: 9, weight: .bold))
                                                        .foregroundColor(.white))
                                                    .overlay(Circle().stroke(Color(hex: T.card), lineWidth: 1))
                                            }
                                        }
                                    }
                                    ForEach(item.op.team.prefix(3), id: \.self) { id in
                                        if let person = appState.person(id: id) {
                                            Text(person.name.components(separatedBy: " ").first ?? person.name)
                                                .font(.caption2)
                                                .foregroundColor(Color(hex: T.muted))
                                        }
                                    }
                                    if item.op.team.count > 3 {
                                        Text("+\(item.op.team.count - 3) more")
                                            .font(.caption2)
                                            .foregroundColor(Color(hex: T.muted))
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                    }
                }
            }
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
