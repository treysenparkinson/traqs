import SwiftUI

struct TasksView: View {
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var searchText = ""
    @State private var filterStatus: JobStatus? = nil
    @State private var selectedJob: Job? = nil
    @State private var showAddJob = false
    @State private var showFastTRAQS = false

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

    var body: some View {
        NavigationSplitView {
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

                    // ── Sub-header: Ask TRAQS | Undo | Add ──
                    HStack(spacing: 10) {
                        Button { showFastTRAQS = true } label: {
                            FastTRAQSPillButton()
                        }
                        .buttonStyle(.plain)

                        Spacer()

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
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color(hex: T.surface))

                    // Engineering Queue
                    if !appState.engineeringQueue.isEmpty {
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

                    // Job list
                    List(filteredJobs, selection: $selectedJob) { job in
                        JobRow(job: job)
                            .tag(job)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .refreshable { await appState.loadAll() }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showFastTRAQS) { FastTRAQSView() }
        } detail: {
            if let job = selectedJob {
                JobDetailView(job: job)
            } else {
                ZStack {
                    Color(hex: T.bg).ignoresSafeArea()
                    ContentUnavailableView("Select a Job", systemImage: "checklist", description: Text("Choose a job from the list to view its details."))
                }
            }
        }
        .sheet(isPresented: $showAddJob) {
            JobEditView(job: nil)
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
