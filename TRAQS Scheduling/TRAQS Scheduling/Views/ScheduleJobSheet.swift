import SwiftUI

// MARK: - Schedule Job Sheet
// Popped up when a block is tapped in the Schedule (gantt) view. A clean,
// modern job detail rendered entirely in the TRAQS Light type system:
//   • Top: the tapped task as a log-time hero (reuses TaskCardV1 so clock
//     in / out / break / end-photo all behave exactly like the Jobs list).
//   • Details: job title, customer, PO #, dates, team.
//   • Tasks: every panel and its operations, with live progress.

struct ScheduleJobSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let block: ScheduleBlock

    // Prefer the live job from app state so progress / clock changes reflect
    // immediately; fall back to the block's captured snapshot if it's gone.
    private var job: Job {
        appState.jobs.first(where: { $0.id == block.jobId }) ?? block.job
    }
    private var panel: Panel? { job.subs.first(where: { $0.id == block.panelId }) }
    private var op: Operation? {
        guard let oid = block.opId, let panel else { return nil }
        return panel.subs.first(where: { $0.id == oid })
    }
    private var task: TaskAssignment? {
        guard let panel else { return nil }
        return TaskAssignment(job: job, panel: panel, op: op)
    }
    private var clientName: String? {
        let n = appState.client(for: job)?.name
        return (n?.isEmpty == false) ? n : nil
    }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let task {
                            // Log-time hero: job/task name, progress, LOG TIME.
                            TaskCardV1(task: task)
                        }
                        detailsCard
                        tasksSection
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 28)
                }
                .scrollIndicators(.hidden)
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Top bar
    // A TRAQS-styled bar instead of the system nav bar, so the font stays
    // on-brand. Left: eyebrow + job number. Right: a circular close button.

    private var topBar: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text("JOB DETAILS")
                    .font(TTypo.xsBold(10))
                    .tLabel(tracking: 1.4)
                    .foregroundStyle(Color(hex: T.muted))
                if let n = job.jobNumber, !n.isEmpty {
                    Text("#\(n)")
                        .font(TTypo.mono(13))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                }
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(hex: T.muted))
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Color(hex: T.surface)))
                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 10)
    }

    // MARK: Details

    private var detailItems: [(String, String)] {
        var items: [(String, String)] = [("Job", job.title)]
        if let c = clientName { items.append(("Customer", c)) }
        if let po = job.poNumber, !po.isEmpty { items.append(("PO #", po)) }
        items.append(("Start", job.start.shortDate))
        items.append(("End", job.end.shortDate))
        if let due = job.dueDate, !due.isEmpty { items.append(("Due", due.shortDate)) }
        if !teamNames.isEmpty { items.append(("Team", teamNames)) }
        return items
    }

    private var teamNames: String {
        job.team.compactMap { appState.person(id: $0)?.name }.joined(separator: ", ")
    }

    private var detailsCard: some View {
        SBox(size: .lg) {
            VStack(alignment: .leading, spacing: 0) {
                sectionLabel("DETAILS")
                    .padding(.bottom, 6)
                ForEach(Array(detailItems.enumerated()), id: \.offset) { idx, item in
                    if idx > 0 { SLine() }
                    HStack(alignment: .top, spacing: 12) {
                        Text(item.0.uppercased())
                            .font(TTypo.xsBold(10))
                            .tLabel(tracking: 0.8)
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(width: 78, alignment: .leading)
                        Text(item.1)
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.ink))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 10)
                }
            }
            .padding(16)
        }
    }

    // MARK: Tasks

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                sectionLabel("TASKS")
                Spacer()
                Text("\(job.subs.count) panel\(job.subs.count == 1 ? "" : "s")")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }
            .padding(.horizontal, 2)

            if job.subs.isEmpty {
                Text("No tasks on this job.")
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
                    .padding(.vertical, 8)
            } else {
                ForEach(job.subs) { panel in
                    panelCard(panel)
                }
            }
        }
    }

    private func panelCard(_ panel: Panel) -> some View {
        let pPct = appState.panelPct(panel)
        let isTappedPanel = panel.id == block.panelId && block.opId == nil
        return SBox(size: .md, sky: isTappedPanel) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(panel.title)
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                    Spacer()
                    StatusBadge(status: panel.status)
                }
                HStack(spacing: 8) {
                    Bar(pct: Double(pPct), height: 5, fill: progressFill(pPct))
                    Text("\(pPct)%")
                        .font(TTypo.monoBold(11))
                        .foregroundStyle(progressFill(pPct))
                        .tnum()
                }
                if !panel.subs.isEmpty {
                    SLine().padding(.vertical, 2)
                    VStack(spacing: 0) {
                        ForEach(panel.subs) { op in
                            opRow(op, panel: panel)
                        }
                    }
                }
            }
            .padding(14)
        }
    }

    @ViewBuilder
    private func opRow(_ op: Operation, panel: Panel) -> some View {
        let oPct = appState.opPct(op)
        let isTapped = panel.id == block.panelId && op.id == block.opId
        HStack(spacing: 10) {
            Circle().fill(op.status.color).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 2) {
                Text(op.title.isEmpty ? panel.title : op.title)
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                Text(op.start.shortDate + " → " + op.end.shortDate)
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }
            Spacer(minLength: 8)
            Text("\(oPct)%")
                .font(TTypo.monoBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tnum()
        }
        .padding(.vertical, 7)
        .padding(.horizontal, isTapped ? 8 : 0)
        .background {
            if isTapped {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(hex: T.sky).opacity(0.08))
            }
        }
    }

    private func sectionLabel(_ s: String) -> some View {
        Text(s)
            .font(TTypo.xsBold(11))
            .tLabel(tracking: 1.2)
            .foregroundStyle(Color(hex: T.muted))
    }
}
