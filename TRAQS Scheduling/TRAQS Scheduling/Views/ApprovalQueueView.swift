import SwiftUI

// MARK: - Approval Queue
// Full-page queue of panels awaiting an engineering sign-off step, presented
// from the Jobs tab's checkmark button (approvers only). Items are grouped by
// the step they're blocked on (Designed → Verified → Sent to Perforex),
// searchable, and approved in place — approving mutates appState.jobs
// optimistically (via signOff), so the item re-buckets/clears instantly and the
// Jobs-tab badge updates without a refetch. Mirrors the desktop approval queue.

/// One panel awaiting an engineering sign-off step.
struct ApprovalItem: Identifiable {
    let job: Job
    let panel: Panel
    let pendingStep: EngStep
    var id: String { "\(job.id)-\(panel.id)" }
}

struct ApprovalQueueView: View {
    @Environment(AppState.self) private var appState
    /// Drives the presenting `.fullScreenCover`. We dismiss by flipping this
    /// binding rather than `@Environment(\.dismiss)`: this view hosts its own
    /// NavigationStack, so at the root `\.dismiss` is ambiguous (it can resolve
    /// to a no-op "pop empty stack" instead of "dismiss the cover"), which made
    /// the back button work only intermittently.
    @Binding var isPresented: Bool
    @State private var path: [Job] = []
    @State private var search = ""
    @FocusState private var searchFocused: Bool

    // MARK: Derived data

    /// Every panel with an engineering block whose chain isn't fully signed off,
    /// tagged with the first step it's blocked on.
    private var items: [ApprovalItem] {
        var out: [ApprovalItem] = []
        for job in appState.jobs {
            for panel in job.subs {
                guard let eng = panel.engineering else { continue }
                let step: EngStep?
                if eng.designed == nil { step = .designed }
                else if eng.verified == nil { step = .verified }
                else if eng.sentToPerforex == nil { step = .sentToPerforex }
                else { step = nil }
                if let step { out.append(ApprovalItem(job: job, panel: panel, pendingStep: step)) }
            }
        }
        return out
    }

    private func clientName(_ job: Job) -> String {
        guard let cid = job.clientId else { return "" }
        return appState.clients.first(where: { $0.id == cid })?.name ?? ""
    }

    private var filtered: [ApprovalItem] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter {
            ($0.job.jobNumber ?? "").lowercased().contains(q)
                || $0.job.title.lowercased().contains(q)
                || $0.panel.title.lowercased().contains(q)
                || clientName($0.job).lowercased().contains(q)
        }
    }

    private func items(for step: EngStep) -> [ApprovalItem] {
        filtered.filter { $0.pendingStep == step }
    }

    // MARK: Body

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                AmbientBackground()
                VStack(spacing: 0) {
                    header
                    PageTitle(title: "Approval Queue", size: 34, tracking: -2)   // smaller, one line, slightly looser letters
                        .padding(.horizontal, 16)
                        .padding(.bottom, 6)
                    SearchBar(text: $search,
                              placeholder: "Search jobs, panels, customers…",
                              focused: $searchFocused,
                              onCancel: { search = "" })
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                    content
                }
            }
            .navigationDestination(for: Job.self) { JobDetailView(job: $0) }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    /// Close (left) + undo / forward liquid-glass buttons (top-right). Undo and
    /// redo drive the app's job undo stack, which a sign-off pushes onto — so undo
    /// reverts the last approval and forward re-applies it. Disabled (dimmed) when
    /// there's nothing to undo/redo.
    private var header: some View {
        HStack(spacing: 10) {
            glassButton("chevron.left", enabled: true) { isPresented = false }
            Spacer()
            glassButton("arrow.uturn.backward", enabled: appState.canUndo) { appState.undo() }
            glassButton("arrow.uturn.forward", enabled: appState.canRedo) { appState.redo() }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    /// Circular Apple "liquid glass" icon button.
    private func glassButton(_ systemName: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(hex: enabled ? T.ink : T.muted))
                .frame(width: 38, height: 38)
                .glassEffect(.regular.interactive(), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }

    @ViewBuilder private var content: some View {
        if filtered.isEmpty {
            emptyState
        } else {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(EngStep.allCases, id: \.self) { step in
                        let bucket = items(for: step)
                        if !bucket.isEmpty {
                            TSectionTitle(title: step.label, action: "\(bucket.count) PENDING")
                            VStack(spacing: 12) {
                                ForEach(bucket) { item in row(item) }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
                .padding(.bottom, 40)
            }
            .scrollIndicators(.visible)
            .topFadeMask()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            TIconView(icon: .select, size: 44, color: Color(hex: T.hair))
            Text(search.isEmpty ? "No approvals pending" : "No matches")
                .font(TTypo.h3(18))
                .foregroundStyle(Color(hex: T.ink))
            if search.isEmpty {
                Text("Panels awaiting a sign-off step will appear here.")
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }

    // MARK: Row

    private func row(_ item: ApprovalItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            // Info — tapping opens the full job detail (also where Undo lives).
            Button { path.append(item.job) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(item.panel.title)
                            .font(TTypo.smBold(15))
                            .foregroundStyle(Color(hex: T.ink))
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        TagPill(label: item.pendingStep.label, kind: .indigo, dot: true)
                    }
                    Text(jobLine(item.job))
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // The three steps as chips: done (green), pending (eng), not-yet (muted).
            HStack(spacing: 6) {
                ForEach(EngStep.allCases, id: \.self) { s in
                    stepChip(s, done: isDone(item.panel, s), pending: s == item.pendingStep)
                }
                Spacer(minLength: 8)
            }

            // Approve the pending step (optimistic + persists via signOff).
            Button { approve(item) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .bold))
                    Text("Approve \(item.pendingStep.label)").font(TTypo.smBold(14))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous).fill(T.brandGradient()))
            }
            .buttonStyle(.plain)
            .disabled(appState.currentPerson == nil)
            .opacity(appState.currentPerson == nil ? 0.5 : 1)
        }
        .padding(14)
        .frostedCard(radius: T.cornerHero)   // even rounder card edges (matches Jobs hero cards)
    }

    private func jobLine(_ job: Job) -> String {
        let num = job.jobNumber.map { "#\($0) · " } ?? ""
        let client = clientName(job)
        let tail = client.isEmpty ? "" : " · \(client)"
        return "\(num)\(job.title)\(tail)"
    }

    private func isDone(_ panel: Panel, _ step: EngStep) -> Bool {
        switch step {
        case .designed:       return panel.engineering?.designed != nil
        case .verified:       return panel.engineering?.verified != nil
        case .sentToPerforex: return panel.engineering?.sentToPerforex != nil
        }
    }

    private func stepChip(_ step: EngStep, done: Bool, pending: Bool) -> some View {
        let color = done ? Color(hex: T.statusFinished)
                         : (pending ? Color(hex: T.eng) : Color(hex: T.muted))
        return HStack(spacing: 3) {
            Image(systemName: done ? "checkmark.circle.fill" : (pending ? "circle" : "circle.dotted"))
                .font(.system(size: 10, weight: .bold))
            Text(step.label).font(TTypo.xs(9))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Capsule().fill(color.opacity(0.12)))
    }

    private func approve(_ item: ApprovalItem) {
        guard let me = appState.currentPerson else { return }
        appState.signOff(jobId: item.job.id, panelId: item.panel.id,
                         step: item.pendingStep, personId: me.id, personName: me.name)
    }
}
