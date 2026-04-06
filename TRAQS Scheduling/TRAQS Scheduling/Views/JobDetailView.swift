import SwiftUI

struct JobDetailView: View {
    @Environment(AppState.self) private var appState
    let job: Job
    @State private var showEdit = false
    @State private var showDeleteConfirm = false

    var client: Client? { appState.client(for: job) }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header card
                    HStack(alignment: .top) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(hex: job.color))
                            .frame(width: 6, height: 60)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(job.title)
                                .font(.title2.bold())
                                .foregroundColor(Color(hex: T.text))
                            HStack(spacing: 8) {
                                if let num = job.jobNumber {
                                    Text("Job #\(num)").foregroundColor(Color(hex: T.muted))
                                }
                                if let po = job.poNumber {
                                    Text("PO: \(po)").foregroundColor(Color(hex: T.muted))
                                }
                                StatusBadge(status: job.status)
                                PriorityDot(priority: job.pri)
                                Text(job.pri.rawValue).font(.caption).foregroundColor(job.pri.color)
                            }
                            .font(.subheadline)
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color(hex: T.card))
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))

                    // Info grid
                    infoGrid

                    // Panels
                    if !job.subs.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Panels (\(job.subs.count))")
                                .font(.headline)
                                .foregroundColor(Color(hex: T.text))
                            ForEach(job.subs) { panel in
                                PanelCard(job: job, panel: panel)
                            }
                        }
                    }

                    // Notes
                    if !job.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Notes").font(.headline).foregroundColor(Color(hex: T.text))
                            Text(job.notes)
                                .font(.body)
                                .foregroundColor(Color(hex: T.muted))
                        }
                        .padding()
                        .background(Color(hex: T.card))
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                    }
                }
                .padding()
            }
        }
        .navigationTitle(job.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { showEdit = true }
                    .foregroundColor(Color(hex: T.accent))
            }
            ToolbarItem {
                Button(role: .destructive) { showDeleteConfirm = true } label: {
                    Image(systemName: "trash")
                        .foregroundColor(Color(hex: T.danger))
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            JobEditView(job: job)
        }
        .confirmationDialog("Delete \(job.title)?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete Job", role: .destructive) {
                appState.deleteJob(id: job.id)
            }
        }
    }

    @ViewBuilder
    private var infoGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            InfoCell(label: "Start", value: job.start.shortDate, icon: "calendar")
            InfoCell(label: "End", value: job.end.shortDate, icon: "calendar.badge.checkmark")
            if let due = job.dueDate {
                InfoCell(label: "Due", value: due.shortDate, icon: "exclamationmark.circle")
            }
            if let c = client {
                InfoCell(label: "Client", value: c.name, icon: "building.2")
            }
            InfoCell(label: "Panels", value: "\(job.subs.count)", icon: "rectangle.3.group")
            InfoCell(label: "Team", value: teamNames, icon: "person.2")
        }
    }

    private var teamNames: String {
        job.team.compactMap { appState.person(id: $0)?.name }.joined(separator: ", ")
    }
}

struct InfoCell: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundColor(Color(hex: T.muted))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundColor(Color(hex: T.muted))
                Text(value).font(.subheadline.bold()).foregroundColor(Color(hex: T.text))
            }
            Spacer()
        }
        .padding(10)
        .background(Color(hex: T.card))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
    }
}

// MARK: - Panel Card

struct PanelCard: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panel: Panel
    @State private var isExpanded = false

    var eng: Engineering? { panel.engineering }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Panel header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(panel.title).font(.subheadline.bold()).foregroundColor(Color(hex: T.text))
                        HStack(spacing: 6) {
                            Text(panel.start.shortDate + " → " + panel.end.shortDate)
                                .font(.caption).foregroundColor(Color(hex: T.muted))
                            StatusBadge(status: panel.status)
                        }
                    }
                    Spacer()
                    // Engineering steps indicator
                    HStack(spacing: 4) {
                        ForEach([EngStep.designed, .verified, .sentToPerforex], id: \.self) { step in
                            Circle()
                                .fill(stepDone(step) ? Color(hex: T.statusFinished) : Color(hex: T.border))
                                .frame(width: 8, height: 8)
                        }
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption).foregroundColor(Color(hex: T.muted))
                }
                .padding(12)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Rectangle()
                    .fill(Color(hex: T.border))
                    .frame(height: 1)
                // Operations
                ForEach(panel.subs) { op in
                    OperationRow(op: op, job: job, panel: panel)
                }
                // Engineering sign-offs
                if appState.currentPerson?.isEngineer == true || appState.currentPerson?.isAdmin == true {
                    EngSignOffRow(job: job, panel: panel)
                }
            }
        }
        .background(Color(hex: T.card))
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
    }

    private func stepDone(_ step: EngStep) -> Bool {
        switch step {
        case .designed: return eng?.designed != nil
        case .verified: return eng?.verified != nil
        case .sentToPerforex: return eng?.sentToPerforex != nil
        }
    }
}

struct OperationRow: View {
    @Environment(AppState.self) private var appState
    let op: Operation
    let job: Job
    let panel: Panel

    private var allOps: [Operation] { job.subs.flatMap { $0.subs } }

    private var depsBlocked: Bool {
        guard !op.deps.isEmpty else { return false }
        return op.deps.contains { depId in
            allOps.first(where: { $0.id == depId })?.status != .finished
        }
    }

    private var depTitles: [String] {
        op.deps.compactMap { depId in allOps.first(where: { $0.id == depId })?.title }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Circle()
                    .fill(op.status.color)
                    .frame(width: 8, height: 8)
                    .padding(.leading, 16)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(op.title).font(.subheadline).foregroundColor(Color(hex: T.text))
                        if depsBlocked {
                            Image(systemName: "lock.fill")
                                .font(.caption2)
                                .foregroundColor(Color(hex: T.muted))
                        }
                        if op.pendingFinish == true {
                            Text("Finish Requested")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.yellow.opacity(0.18))
                                .foregroundColor(.orange)
                                .cornerRadius(6)
                        }
                    }
                    Text(op.start.shortDate + " → " + op.end.shortDate)
                        .font(.caption).foregroundColor(Color(hex: T.muted))
                    if !depTitles.isEmpty {
                        Text("After: " + depTitles.joined(separator: ", "))
                            .font(.caption2)
                            .foregroundColor(Color(hex: T.muted))
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(op.team.compactMap { appState.person(id: $0)?.name }.joined(separator: ", "))
                        .font(.caption).foregroundColor(Color(hex: T.muted))
                        .lineLimit(1)
                    if appState.clockedInPersonId != nil && op.pendingFinish != true {
                        Button {
                            Task {
                                await appState.timeclockFinishRequest(
                                    jobId: job.id, panelId: panel.id, opId: op.id)
                            }
                        } label: {
                            Text("Request Finish")
                                .font(.caption2.bold())
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(Color(hex: T.accent).opacity(0.12))
                                .foregroundColor(Color(hex: T.accent))
                                .cornerRadius(6)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.trailing, 12)
            }
            .padding(.vertical, 8)
        }
        .background(Color(hex: T.card))
        .opacity(depsBlocked ? 0.55 : 1.0)
    }
}

struct EngSignOffRow: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panel: Panel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle()
                .fill(Color(hex: T.border))
                .frame(height: 1)
            Text("Engineering Sign-Off")
                .font(.caption.bold())
                .foregroundColor(Color(hex: T.muted))
                .padding(.horizontal, 12)
            HStack(spacing: 8) {
                ForEach(EngStep.allCases, id: \.self) { step in
                    EngStepButton(job: job, panel: panel, step: step)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
    }
}

struct EngStepButton: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panel: Panel
    let step: EngStep

    var signOff: EngineeringSignOff? {
        switch step {
        case .designed: return panel.engineering?.designed
        case .verified: return panel.engineering?.verified
        case .sentToPerforex: return panel.engineering?.sentToPerforex
        }
    }

    var previousDone: Bool {
        switch step {
        case .designed: return true
        case .verified: return panel.engineering?.designed != nil
        case .sentToPerforex: return panel.engineering?.verified != nil
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            if let s = signOff {
                VStack(spacing: 2) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(Color(hex: T.statusFinished))
                    Text(step.label).font(.system(size: 9)).foregroundColor(Color(hex: T.muted))
                    Text(s.byName).font(.system(size: 9).bold()).foregroundColor(Color(hex: T.text))
                }
                .frame(maxWidth: .infinity)
                .padding(6)
                .background(Color(hex: T.statusFinished).opacity(0.1))
                .cornerRadius(8)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: T.statusFinished).opacity(0.3), lineWidth: 1))

                Button("Undo") {
                    appState.revertSignOff(jobId: job.id, panelId: panel.id, step: step)
                }
                .font(.system(size: 9))
                .foregroundColor(Color(hex: T.danger))
            } else if previousDone, let person = appState.currentPerson {
                Button {
                    appState.signOff(jobId: job.id, panelId: panel.id, step: step, personId: person.id, personName: person.name)
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: "circle")
                            .foregroundColor(Color(hex: T.eng))
                        Text(step.label).font(.system(size: 9)).foregroundColor(Color(hex: T.text))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(6)
                    .background(Color(hex: T.eng).opacity(0.1))
                    .cornerRadius(8)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: T.eng).opacity(0.3), lineWidth: 1))
                }
                .buttonStyle(.plain)
            } else {
                VStack(spacing: 2) {
                    Image(systemName: "circle")
                        .foregroundColor(Color(hex: T.muted))
                    Text(step.label).font(.system(size: 9)).foregroundColor(Color(hex: T.muted))
                }
                .frame(maxWidth: .infinity)
                .padding(6)
                .background(Color(hex: T.border).opacity(0.3))
                .cornerRadius(8)
            }
        }
    }
}
