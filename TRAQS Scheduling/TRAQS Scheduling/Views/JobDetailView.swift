import SwiftUI

struct JobDetailView: View {
    @Environment(AppState.self) private var appState
    let job: Job
    /// When set (e.g. arrived via a Schedule block), highlight + auto-expand this panel.
    var highlightPanelId: String? = nil
    /// When set, highlight this op row inside the panel.
    var highlightOpId: String? = nil

    @State private var showEdit = false
    @State private var showDeleteConfirm = false

    var client: Client? { appState.client(for: job) }

    /// Department tag styling for this job, mapped to a bright revamp pill kind.
    private var dept: (label: String, kind: TagKind) {
        let key = (job.jobType ?? "").lowercased()
        if key.contains("repair") || key.contains("break") { return (job.jobType?.uppercased() ?? "REPAIR", .amber) }
        if key.contains("inspect") || key.contains("install") { return (job.jobType?.uppercased() ?? "INSTALL", .indigo) }
        if key.contains("layout")  { return ("LAYOUT", .magenta) }
        if key.contains("wire")    { return ("WIRE", .sky) }
        if key.contains("contract") { return ("CONTRACT", .green) }
        let label = (job.jobType?.uppercased()).flatMap { $0.isEmpty ? nil : $0 } ?? "JOB"
        return (label, .indigo)
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Hero card — dept pill, job title, address/number, progress context
                    let jobProgress = appState.jobPct(job)
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) {
                            TagPill(label: dept.label, kind: dept.kind)
                            Spacer()
                            StatusBadge(status: job.status)
                        }

                        Text(job.title)
                            .font(.custom(TFontName.bold.rawValue, size: 26))
                            .foregroundStyle(Color(hex: T.ink))

                        HStack(spacing: 8) {
                            if let num = job.jobNumber {
                                Text("Job #\(num)")
                                    .font(TTypo.mono(12)).tnum()
                                    .foregroundStyle(Color(hex: T.muted))
                            }
                            if let po = job.poNumber {
                                Text("PO: \(po)")
                                    .font(TTypo.mono(12)).tnum()
                                    .foregroundStyle(Color(hex: T.muted))
                            }
                            PriorityDot(priority: job.pri)
                            Text(job.pri.rawValue)
                                .font(TTypo.xsBold(11))
                                .foregroundStyle(job.pri.color)
                        }

                        // Hours-weighted progress: total logged ÷ total estimated
                        // across every op in the job. Matches the desktop Jobs page.
                        HStack(spacing: 10) {
                            Bar(pct: Double(jobProgress), height: 7, gradient: T.brandGradient())
                            Text("\(jobProgress)%")
                                .font(TTypo.monoBold(12)).tnum()
                                .foregroundStyle(Color(hex: T.accentGradientStart))
                        }
                        .padding(.top, 2)
                    }
                    .padding(18)
                    .frostedCard(radius: T.cornerHero)

                    // Info grid
                    infoGrid

                    // Panels
                    if !job.subs.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Panels (\(job.subs.count))")
                                .font(TTypo.h3(18))
                                .foregroundStyle(Color(hex: T.ink))
                            ForEach(job.subs) { panel in
                                PanelCard(job: job,
                                          panel: panel,
                                          highlighted: panel.id == highlightPanelId,
                                          highlightOpId: panel.id == highlightPanelId ? highlightOpId : nil)
                                    .id(panel.id)
                            }
                        }
                    }

                    // Notes
                    if !job.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Notes")
                                .font(TTypo.h3(18))
                                .foregroundStyle(Color(hex: T.ink))
                            Text(job.notes)
                                .font(TTypo.body(15))
                                .foregroundStyle(Color(hex: T.muted))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .frostedCard(radius: T.cornerMd)
                    }
                }
                .padding()
            }
            .onAppear {
                // Scroll the highlighted panel into view after the push animation lands.
                guard let pid = highlightPanelId else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    withAnimation(.easeInOut(duration: 0.32)) {
                        proxy.scrollTo(pid, anchor: .top)
                    }
                }
            }
            } // ScrollViewReader
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
                    .foregroundColor(Color(hex: T.accentGradientStart))
            }
            ToolbarItem {
                Button(role: .destructive) { showDeleteConfirm = true } label: {
                    Image(systemName: "trash")
                        .foregroundColor(Color(hex: T.red))
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

/// Matches the desktop's `pctColor`: green ≥ 80, amber ≥ 40, otherwise muted.
func progressFill(_ pct: Int) -> Color {
    if pct >= 80 { return Color(hex: T.statusFinished) }
    if pct >= 40 { return Color(hex: "#f59e0b") }
    return Color(hex: T.muted)
}

struct InfoCell: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 10) {
            // Rounded-square tinted icon chip (matches IconChip styling, but with
            // an SF Symbol since these glyphs aren't in the TIcon set).
            RoundedRectangle(cornerRadius: 34 * 0.30, style: .continuous)
                .fill(Color(hex: T.pillIndigoFg).opacity(0.14))
                .frame(width: 34, height: 34)
                .overlay(
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color(hex: T.pillIndigoFg))
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
                Text(value)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(12)
        .frostedCard(radius: T.cornerMd)
    }
}

// MARK: - Panel Card

struct PanelCard: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panel: Panel
    /// `true` when arrived via a Schedule tile that pointed at this panel.
    /// Drives the sky-tinted highlight + auto-expand on first appear.
    var highlighted: Bool = false
    /// When set, highlights the matching op row inside this panel.
    var highlightOpId: String? = nil

    @State private var isExpanded = false

    var eng: Engineering? { panel.engineering }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Panel header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(panel.title)
                                .font(TTypo.smBold(14))
                                .foregroundStyle(Color(hex: T.ink))
                            if highlighted {
                                TagPill(label: "YOU", kind: .sky)
                            }
                        }
                        HStack(spacing: 6) {
                            Text(panel.start.shortDate + " → " + panel.end.shortDate)
                                .font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
                            StatusBadge(status: panel.status)
                        }
                        // Hours-weighted panel progress: aggregate of child ops'
                        // logged vs. estimated hours.
                        let pPct = appState.panelPct(panel)
                        HStack(spacing: 6) {
                            Bar(pct: Double(pPct), height: 6, gradient: T.brandGradient())
                                .frame(maxWidth: 120)
                            Text("\(pPct)%")
                                .font(TTypo.monoBold(11)).tnum()
                                .foregroundStyle(Color(hex: T.accentGradientStart))
                        }
                        .padding(.top, 2)
                    }
                    Spacer()
                    // Engineering steps indicator
                    HStack(spacing: 4) {
                        ForEach([EngStep.designed, .verified, .sentToPerforex], id: \.self) { step in
                            Circle()
                                .fill(stepDone(step) ? Color(hex: T.statusFinished) : Color(hex: T.hair))
                                .frame(width: 8, height: 8)
                        }
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption).foregroundStyle(Color(hex: T.muted))
                }
                .padding(14)
            }
            .buttonStyle(.plain)

            if isExpanded {
                SLine()
                // Operations
                ForEach(panel.subs) { op in
                    OperationRow(op: op, job: job, panel: panel,
                                 highlighted: op.id == highlightOpId)
                }
                // Engineering sign-offs
                if appState.currentPerson?.isEngineer == true || appState.currentPerson?.isAdmin == true {
                    EngSignOffRow(job: job, panel: panel)
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                .fill(highlighted ? Color(hex: T.sky).opacity(0.06) : Color(hex: T.surface))
        )
        .clipShape(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).strokeBorder(
                highlighted
                    ? AnyShapeStyle(Color(hex: T.sky))
                    : AnyShapeStyle(LinearGradient(colors: [Color(hex: T.highlightStroke).opacity(0.55), .clear],
                                                   startPoint: .top, endPoint: .bottom)),
                lineWidth: highlighted ? 1.5 : 1)
        )
        .compositingGroup()
        .shadow(color: highlighted ? Color(hex: T.sky).opacity(T.skyShadowOpacity) : .black.opacity(T.ambientShadowOpacity),
                radius: highlighted ? T.skyShadowRadius : T.ambientShadowRadius,
                x: 0, y: highlighted ? T.skyShadowY : T.ambientShadowY)
        .onAppear {
            if highlighted { isExpanded = true }
        }
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
    var highlighted: Bool = false

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
                        Text(op.title)
                            .font(TTypo.sm(14))
                            .foregroundStyle(Color(hex: T.ink))
                        if depsBlocked {
                            Image(systemName: "lock.fill")
                                .font(.caption2)
                                .foregroundStyle(Color(hex: T.muted))
                        }
                        if op.pendingFinish == true {
                            TagPill(label: "Finish Requested", kind: .amber)
                        }
                    }
                    Text(op.start.shortDate + " → " + op.end.shortDate)
                        .font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
                    if !depTitles.isEmpty {
                        Text("After: " + depTitles.joined(separator: ", "))
                            .font(TTypo.xs(10))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    // Op-level hours-weighted progress (logged ÷ est.hpd).
                    let oPct = appState.opPct(op)
                    HStack(spacing: 6) {
                        Bar(pct: Double(oPct), height: 5, gradient: T.brandGradient())
                            .frame(maxWidth: 100)
                        Text("\(oPct)%")
                            .font(TTypo.monoBold(10)).tnum()
                            .foregroundStyle(Color(hex: T.accentGradientStart))
                    }
                    .padding(.top, 2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(op.team.compactMap { appState.person(id: $0)?.name }.joined(separator: ", "))
                        .font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                    if appState.clockedInPersonId != nil && op.pendingFinish != true {
                        Button {
                            Task {
                                await appState.timeclockFinishRequest(
                                    jobId: job.id, panelId: panel.id, opId: op.id)
                            }
                        } label: {
                            Text("Request Finish")
                                .font(TTypo.xsBold(11))
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Capsule().fill(Color(hex: T.accentGradientStart).opacity(0.12)))
                                .foregroundStyle(Color(hex: T.accentGradientStart))
                                .overlay(Capsule().stroke(Color(hex: T.accentGradientStart).opacity(0.3), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.trailing, 12)
            }
            .padding(.vertical, 10)
        }
        .background(highlighted ? Color(hex: T.sky).opacity(0.10) : Color.clear)
        .overlay(alignment: .leading) {
            // 3pt accent stripe down the leading edge of the user's task row.
            // The panel header already shows the "YOU" pill, so we don't repeat
            // it on every op row — just the subtle stripe + fill.
            if highlighted {
                Rectangle().fill(Color(hex: T.sky)).frame(width: 3)
            }
        }
        .opacity(depsBlocked ? 0.55 : 1.0)
    }
}

struct EngSignOffRow: View {
    @Environment(AppState.self) private var appState
    let job: Job
    let panel: Panel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SLine()
            Text("Engineering Sign-Off")
                .font(TTypo.xsBold(11))
                .tLabel(tracking: 0.8)
                .foregroundStyle(Color(hex: T.muted))
                .padding(.horizontal, 14)
            HStack(spacing: 8) {
                ForEach(EngStep.allCases, id: \.self) { step in
                    EngStepButton(job: job, panel: panel, step: step)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
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
                        .foregroundStyle(Color(hex: T.statusFinished))
                    Text(step.label).font(TTypo.xs(9)).foregroundStyle(Color(hex: T.muted))
                    Text(s.byName).font(TTypo.xsBold(9)).foregroundStyle(Color(hex: T.ink))
                }
                .frame(maxWidth: .infinity)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous).fill(Color(hex: T.statusFinished).opacity(0.1)))
                .overlay(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous).stroke(Color(hex: T.statusFinished).opacity(0.3), lineWidth: 1))

                Button("Undo") {
                    appState.revertSignOff(jobId: job.id, panelId: panel.id, step: step)
                }
                .font(TTypo.xs(9))
                .foregroundStyle(Color(hex: T.red))
            } else if previousDone, let person = appState.currentPerson {
                Button {
                    appState.signOff(jobId: job.id, panelId: panel.id, step: step, personId: person.id, personName: person.name)
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: "circle")
                            .foregroundStyle(Color(hex: T.eng))
                        Text(step.label).font(TTypo.xs(9)).foregroundStyle(Color(hex: T.ink))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous).fill(Color(hex: T.eng).opacity(0.1)))
                    .overlay(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous).stroke(Color(hex: T.eng).opacity(0.3), lineWidth: 1))
                }
                .buttonStyle(.plain)
            } else {
                VStack(spacing: 2) {
                    Image(systemName: "circle")
                        .foregroundStyle(Color(hex: T.muted))
                    Text(step.label).font(TTypo.xs(9)).foregroundStyle(Color(hex: T.muted))
                }
                .frame(maxWidth: .infinity)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous).fill(Color(hex: T.hair).opacity(0.3)))
            }
        }
    }
}
