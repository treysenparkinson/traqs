import SwiftUI

enum TasksViewMode { case list, cards }

struct TasksView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var searchText = ""
    @State private var filterStatus: JobStatus? = nil
    @State private var expandedJobIds: Set<String> = []
    @State private var showAddJob = false
    @State private var showFastTRAQS = false
    @State private var viewMode: TasksViewMode = .list

    var filteredJobs: [Job] {
        appState.jobs.filter { job in
            let matchSearch = searchText.isEmpty ||
                job.title.localizedCaseInsensitiveContains(searchText) ||
                (job.jobNumber ?? "").localizedCaseInsensitiveContains(searchText)
            let matchStatus = filterStatus == nil || job.status == filterStatus
            return matchSearch && matchStatus
        }
        .sorted { $0.start < $1.start }
    }

    // Group by shared base job number (strips -01 suffix), then by title, then solo
    var jobGroups: [JobGroup] {
        var byKey: [String: [Job]] = [:]
        var order: [String] = []

        for job in filteredJobs {
            let key = Self.groupKey(for: job)
            if byKey[key] == nil { order.append(key) }
            byKey[key, default: []].append(job)
        }

        return order.compactMap { key -> JobGroup? in
            guard let jobs = byKey[key] else { return nil }
            return JobGroup(key: key, jobs: jobs)
        }
    }

    /// Returns a stable grouping key: base job number (before any "-"), then title, then id
    static func groupKey(for job: Job) -> String {
        if let num = job.jobNumber, !num.isEmpty {
            // "401945-01" → "401945"
            if let dash = num.firstIndex(of: "-") {
                return String(num[..<dash])
            }
            return num
        }
        // No number: group by exact title
        return "title:\(job.title)"
    }

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
                            Text("Jobs")
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

                    // ── Sub-header: Ask TRAQS | View Toggle | Undo | Add ──
                    HStack(spacing: 10) {
                        if appState.isAdmin {
                            Button { showFastTRAQS = true } label: {
                                FastTRAQSPillButton()
                            }
                            .buttonStyle(.plain)
                        }

                        Button {
                            viewMode = viewMode == .list ? .cards : .list
                        } label: {
                            Image(systemName: viewMode == .cards ? "list.bullet" : "square.grid.2x2")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Color(hex: T.accent))
                                .frame(width: 32, height: 32)
                                .background(Color(hex: T.accent).opacity(0.12))
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                        }

                        Spacer()

                        if appState.isAdmin {
                            Button {
                                if appState.canUndo { appState.undo() }
                            } label: {
                                Image(systemName: "arrow.uturn.backward")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(appState.canUndo ? Color(hex: T.accent) : Color(hex: T.muted))
                                    .frame(width: 32, height: 32)
                                    .background(Color(hex: T.surface))
                                    .clipShape(Circle())
                                    .overlay(Circle().stroke(Color(hex: T.border), lineWidth: 1))
                            }
                            .disabled(!appState.canUndo)

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

                    // Engineering Queue — engineers and admins only
                    if appState.isEngineer && !appState.engineeringQueue.isEmpty {
                        EngineeringQueueSection()
                            .padding(.bottom, 8)
                    }

                    // Search bar
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(Color(hex: T.muted))
                        TextField("Search jobs…", text: $searchText)
                            .textFieldStyle(.plain)
                            .foregroundColor(Color(hex: T.text))
                        if !searchText.isEmpty {
                            Button { searchText = "" } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(10)
                    .background(Color(hex: T.surface))
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)

                    // Status filter chips
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            FilterChip(label: "All", isSelected: filterStatus == nil) {
                                filterStatus = nil
                            }
                            ForEach(JobStatus.allCases, id: \.self) { s in
                                FilterChip(label: s.rawValue, isSelected: filterStatus == s, color: s.color) {
                                    filterStatus = filterStatus == s ? nil : s
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 8)

                    // Job list or Cards view
                    if viewMode == .cards {
                        CardsView()
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(jobGroups) { group in
                                    GroupedJobRow(
                                        group: group,
                                        isExpanded: expandedJobIds.contains(group.id)
                                    ) {
                                        withAnimation(.easeInOut(duration: 0.22)) {
                                            if expandedJobIds.contains(group.id) {
                                                expandedJobIds.remove(group.id)
                                            } else {
                                                expandedJobIds.insert(group.id)
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                        }
                        .refreshable { await appState.loadAll() }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Job.self) { job in JobDetailView(job: job) }
            .sheet(isPresented: $showFastTRAQS) { FastTRAQSView() }
            .sheet(isPresented: $showAddJob) { JobEditView(job: nil) }
        }
    }
}

// MARK: - Job Group Model

struct JobGroup: Identifiable {
    var id: String { key }
    let key: String       // base job number or "title:XYZ"
    let jobs: [Job]

    var isMulti: Bool { jobs.count > 1 }
    var color: String { jobs.first?.color ?? "#3d7fff" }
    var overallStart: String { jobs.map(\.start).min() ?? "" }
    var overallEnd: String   { jobs.map(\.end).max() ?? "" }

    /// Display title shown in the group header
    var displayTitle: String {
        if key.hasPrefix("title:") { return String(key.dropFirst(6)) }
        return "Job #\(key)"
    }

    var overallStatus: JobStatus {
        let s = jobs.map(\.status)
        if s.contains(.inProgress) { return .inProgress }
        if s.contains(.onHold)     { return .onHold }
        if s.contains(.pending)    { return .pending }
        if s.contains(.notStarted) { return .notStarted }
        return .finished
    }
}

// MARK: - Grouped Job Row

struct GroupedJobRow: View {
    @Environment(AppState.self) private var appState
    let group: JobGroup
    let isExpanded: Bool
    let onTap: () -> Void

    var body: some View {
        VStack(spacing: 0) {

            // ── Header ──
            Button(action: onTap) {
                HStack(spacing: 0) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(hex: group.color))
                        .frame(width: 4)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            if group.isMulti {
                                Text(group.displayTitle)
                                    .font(.subheadline.bold())
                                    .foregroundColor(Color(hex: T.text))
                                    .lineLimit(1)
                                Text("\(group.jobs.count) jobs")
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color(hex: group.color).opacity(0.15))
                                    .foregroundColor(Color(hex: group.color))
                                    .cornerRadius(6)
                            } else {
                                let job = group.jobs[0]
                                Text(job.title)
                                    .font(.subheadline.bold())
                                    .foregroundColor(Color(hex: T.text))
                                    .lineLimit(1)
                                if let num = job.jobNumber {
                                    Text("#\(num)")
                                        .font(.caption)
                                        .foregroundColor(Color(hex: T.muted))
                                }
                            }
                            Spacer()
                            StatusBadge(status: group.overallStatus)
                        }
                        HStack(spacing: 8) {
                            Text(group.overallStart.shortDate + " → " + group.overallEnd.shortDate)
                                .font(.caption)
                                .foregroundColor(Color(hex: T.muted))
                            Spacer()
                            if !group.isMulti { PriorityDot(priority: group.jobs[0].pri) }
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

            // ── Expanded ──
            if isExpanded {
                if group.isMulti {
                    // Sub-job list
                    ForEach(group.jobs) { job in
                        Rectangle().fill(Color(hex: T.border)).frame(height: 1)
                        NavigationLink(value: job) {
                            HStack(spacing: 12) {
                                Circle()
                                    .fill(Color(hex: job.color))
                                    .frame(width: 8, height: 8)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(job.title)
                                        .font(.subheadline)
                                        .foregroundColor(Color(hex: T.text))
                                        .lineLimit(1)
                                    Text(job.start.shortDate + " → " + job.end.shortDate)
                                        .font(.caption2)
                                        .foregroundColor(Color(hex: T.muted))
                                }
                                Spacer()
                                StatusBadge(status: job.status)
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: T.muted))
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    // Single job — show detail inline
                    let job = group.jobs[0]
                    VStack(alignment: .leading, spacing: 12) {
                        Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                        HStack(spacing: 16) {
                            if let client = appState.clients.first(where: { $0.id == job.clientId }) {
                                Label(client.name, systemImage: "building.2")
                                    .font(.caption).foregroundColor(Color(hex: T.muted))
                            }
                            if let po = job.poNumber, !po.isEmpty {
                                Label("PO #\(po)", systemImage: "doc.text")
                                    .font(.caption).foregroundColor(Color(hex: T.muted))
                            }
                        }

                        if !job.team.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(job.team, id: \.self) { personId in
                                    if let person = appState.person(id: personId) {
                                        PersonAssignmentRow(person: person, job: job)
                                    }
                                }
                            }
                        }

                        NavigationLink(value: job) {
                            HStack {
                                Spacer()
                                Text("View Full Details")
                                    .font(.caption.bold())
                                    .foregroundColor(Color(hex: T.accent))
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundColor(Color(hex: T.accent))
                                Spacer()
                            }
                            .padding(.vertical, 6)
                            .background(Color(hex: T.accent).opacity(0.07))
                            .cornerRadius(8)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
                }
            }
        }
        .background(Color(hex: T.card))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
    }
}

// MARK: - Person Assignment Row

struct PersonAssignmentRow: View {
    let person: Person
    let job: Job

    var assignments: [(opTitle: String, dates: String)] {
        job.subs.flatMap { panel in
            panel.subs.filter { $0.team.contains(person.id) }.map { op in
                (opTitle: op.title, dates: op.start.shortDate + " – " + op.end.shortDate)
            }
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(Color(hex: person.color))
                .frame(width: 26, height: 26)
                .overlay(
                    Text(String(person.name.prefix(1)).uppercased())
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                )

            VStack(alignment: .leading, spacing: 3) {
                Text(person.name)
                    .font(.caption.bold())
                    .foregroundColor(Color(hex: T.text))

                if assignments.isEmpty {
                    Text(job.start.shortDate + " – " + job.end.shortDate)
                        .font(.caption2)
                        .foregroundColor(Color(hex: T.muted))
                } else {
                    ForEach(assignments, id: \.opTitle) { item in
                        HStack(spacing: 4) {
                            Text(item.opTitle)
                                .font(.caption2)
                                .foregroundColor(Color(hex: T.muted))
                                .lineLimit(1)
                            Text("·")
                                .font(.caption2)
                                .foregroundColor(Color(hex: T.border))
                            Text(item.dates)
                                .font(.caption2)
                                .foregroundColor(Color(hex: T.muted))
                        }
                    }
                }
            }
            Spacer()
        }
    }
}

// MARK: - Engineering Queue Section

struct EngineeringQueueSection: View {
    @Environment(AppState.self) private var appState
    @State private var isExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack {
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .foregroundColor(Color(hex: T.eng))
                    Text("Engineering Queue")
                        .font(.headline)
                        .foregroundColor(Color(hex: T.text))
                    Spacer()
                    Text("\(appState.engineeringQueue.count)")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color(hex: T.eng).opacity(0.2))
                        .foregroundColor(Color(hex: T.eng))
                        .cornerRadius(10)
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(Color(hex: T.muted))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)

            if isExpanded {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(appState.engineeringQueue, id: \.panel.id) { item in
                            EngineeringCard(job: item.job, panel: item.panel)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                }
            }
        }
        .background(Color(hex: T.surface))
        .overlay(
            Rectangle()
                .fill(Color(hex: T.border))
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

// MARK: - Engineering Card

struct EngineeringCard: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panel: Panel

    let steps: [EngStep] = [.designed, .verified, .sentToPerforex]

    var activeStepIndex: Int {
        let e = panel.engineering
        if e?.designed == nil { return 0 }
        if e?.verified == nil { return 1 }
        if e?.sentToPerforex == nil { return 2 }
        return 3
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(job.title)
                    .font(.caption)
                    .foregroundColor(Color(hex: T.muted))
                    .lineLimit(1)
                Text(panel.title)
                    .font(.subheadline.bold())
                    .foregroundColor(Color(hex: T.text))
                    .lineLimit(1)
            }

            // Steps progress
            HStack(spacing: 6) {
                ForEach(Array(steps.enumerated()), id: \.offset) { idx, step in
                    let done = idx < activeStepIndex
                    let active = idx == activeStepIndex
                    Circle()
                        .fill(done ? Color(hex: T.statusFinished) : active ? Color(hex: T.eng) : Color(hex: T.border))
                        .frame(width: 10, height: 10)
                        .overlay(
                            done ? Image(systemName: "checkmark").font(.system(size: 6)).foregroundColor(.white) : nil
                        )
                    if idx < steps.count - 1 {
                        Rectangle()
                            .fill(done ? Color(hex: T.statusFinished) : Color(hex: T.border))
                            .frame(height: 2)
                    }
                }
            }

            // Sign-off button for active step
            if activeStepIndex < 3, let step = EngStep.from(index: activeStepIndex),
               let person = appState.currentPerson {
                Button {
                    appState.signOff(
                        jobId: job.id,
                        panelId: panel.id,
                        step: step,
                        personId: person.id,
                        personName: person.name
                    )
                } label: {
                    Text("Sign Off: \(step.label)")
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color(hex: T.eng))
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .frame(width: 200)
        .background(Color(hex: T.card))
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
    }
}

// MARK: - Job Row

struct JobRow: View {
    let job: Job

    var body: some View {
        HStack(spacing: 0) {
            // Colored left accent bar
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: job.color))
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(job.title)
                        .font(.subheadline.bold())
                        .foregroundColor(Color(hex: T.text))
                        .lineLimit(1)
                    if let num = job.jobNumber {
                        Text("#\(num)")
                            .font(.caption)
                            .foregroundColor(Color(hex: T.muted))
                    }
                    Spacer()
                    StatusBadge(status: job.status)
                }
                HStack(spacing: 8) {
                    Text(job.start.shortDate + " → " + job.end.shortDate)
                        .font(.caption)
                        .foregroundColor(Color(hex: T.muted))
                    Spacer()
                    PriorityDot(priority: job.pri)
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

// MARK: - Cards View

struct CardsView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedDeptFilter: String? = nil
    @State private var collapsedJobs: Set<String> = []

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    private var deptOptions: [String] {
        Array(Set(appState.jobs.compactMap { $0.jobType })).sorted()
    }

    private var filteredQueue: [(job: Job, panel: Panel)] {
        let queue = appState.engineeringQueue
        guard let dept = selectedDeptFilter else { return queue }
        return queue.filter { $0.job.jobType == dept }
    }

    private var groupedByJob: [(job: Job, panels: [Panel])] {
        var byJob: [String: (Job, [Panel])] = [:]
        var order: [String] = []
        for item in filteredQueue {
            if byJob[item.job.id] == nil {
                order.append(item.job.id)
                byJob[item.job.id] = (item.job, [])
            }
            byJob[item.job.id]!.1.append(item.panel)
        }
        return order.compactMap { id in byJob[id].map { ($0.0, $0.1) } }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Dept filter chips
                if !deptOptions.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            FilterChip(label: "All", isSelected: selectedDeptFilter == nil) {
                                selectedDeptFilter = nil
                            }
                            ForEach(deptOptions, id: \.self) { dept in
                                FilterChip(label: dept, isSelected: selectedDeptFilter == dept) {
                                    selectedDeptFilter = selectedDeptFilter == dept ? nil : dept
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                }

                if groupedByJob.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "wrench.and.screwdriver")
                            .font(.system(size: 44))
                            .foregroundColor(Color(hex: T.border))
                        Text("No panels in the engineering queue")
                            .foregroundColor(Color(hex: T.muted))
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    .padding(.top, 60)
                } else {
                    ForEach(groupedByJob, id: \.job.id) { item in
                        VStack(alignment: .leading, spacing: 0) {
                            // Section header
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    if collapsedJobs.contains(item.job.id) {
                                        collapsedJobs.remove(item.job.id)
                                    } else {
                                        collapsedJobs.insert(item.job.id)
                                    }
                                }
                            } label: {
                                HStack(spacing: 10) {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Color(hex: item.job.color))
                                        .frame(width: 4, height: 30)
                                    Text(item.job.title)
                                        .font(.subheadline.bold())
                                        .foregroundColor(Color(hex: T.text))
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(item.panels.count)")
                                        .font(.caption2.bold())
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Color(hex: item.job.color).opacity(0.15))
                                        .foregroundColor(Color(hex: item.job.color))
                                        .cornerRadius(6)
                                    Image(systemName: collapsedJobs.contains(item.job.id) ? "chevron.down" : "chevron.up")
                                        .font(.caption2)
                                        .foregroundColor(Color(hex: T.muted))
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                            }
                            .buttonStyle(.plain)

                            if !collapsedJobs.contains(item.job.id) {
                                LazyVGrid(columns: columns, spacing: 12) {
                                    ForEach(item.panels) { panel in
                                        EngineeringCard(job: item.job, panel: panel)
                                    }
                                }
                                .padding(.horizontal, 12)
                                .padding(.bottom, 12)
                            }
                        }
                        .background(Color(hex: T.surface))
                        .cornerRadius(10)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .refreshable { await appState.loadAll() }
    }
}

// MARK: - Filter Chip

struct FilterChip: View {
    let label: String
    let isSelected: Bool
    var color: Color = Color(hex: T.accent)
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption.bold())
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? color.opacity(0.15) : Color(hex: T.surface))
                .foregroundColor(isSelected ? color : Color(hex: T.text).opacity(0.6))
                .cornerRadius(20)
                .overlay(Capsule().stroke(isSelected ? color : Color(hex: T.border), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let status: JobStatus

    var body: some View {
        Text(status.rawValue)
            .font(.caption2.bold())
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(status.color.opacity(0.13))
            .foregroundColor(status.color)
            .cornerRadius(6)
    }
}

// MARK: - Priority Dot

struct PriorityDot: View {
    let priority: Priority

    var body: some View {
        Circle()
            .fill(priority.color)
            .frame(width: 8, height: 8)
    }
}

// MARK: - Color Extensions

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
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}
