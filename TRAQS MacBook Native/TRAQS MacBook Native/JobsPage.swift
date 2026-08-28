import SwiftUI

// MARK: - Jobs
//
// `renderTasks()` (TRAQS.jsx:11316), the "list" sub-view. The page's own header
// bar is a four-column grid there — `auto 1fr auto 1fr`: the title, the tool
// cluster, a spacer, and the actions — which is TPage's title plus a `right`
// holding both clusters with a Spacer between them.
//
// The web has three sub-views in this code (`taskSubView`: cards / list / gantt)
// but only ONE is reachable: `taskSubView` is written in exactly two places, its
// initialiser at :4501 and a reset at :3937, and both write "list". Cards and
// Gantt are dead branches, so nothing here switches on a sub-view.
//
// NOT ported in this pass, and each is its own piece of work rather than a
// detail: column reorder / resize / rename, the "+" column picker and custom
// columns, conditional formatting, inline cell editing, grouping, the export
// modal, row drag-reordering, the engineering and sign-off queues that sit above
// the grid, and the separate Finished section. The buttons those live behind are
// drawn — the toolbar is what the page looks like — and disabled with a tooltip
// saying so, rather than left live and silently doing nothing.

struct JobsPage: View {
    @Environment(\.tqTheme) private var theme
    @Environment(AppState.self) private var appState

    @State private var filter = JobsFilter()
    @State private var sort = JobsSort()
    @State private var cellAlign: JobColumn.Align = .leading
    @State private var expanded: Set<String> = []
    /// `pmSectionsCollapsed` — keyed by section id, so a collapse survives the
    /// list being re-sorted or re-filtered under it.
    @State private var collapsed: Set<String> = []

    // `jobSelectMode` / `selJobs`
    @State private var selectMode = false
    @State private var selected: Set<String> = []

    @State private var filterOpen = false

    /// `gap: 6` inside the tool cluster, `PAGE_ACTION_GAP = 10` between actions.
    private let toolGap: CGFloat = 6
    private let actionGap: CGFloat = 10

    var body: some View {
        // Filtered and sorted ONCE per render, then handed down. As a computed
        // property it was re-run by every reader — the toolbar alone asks three
        // times, for the row count and the All/None set — and each read is a
        // filter plus a sort over every job.
        let visible = JobsQuery.activeRows(appState.jobs, filter: filter,
                                           sort: sort, context: queryContext)
        let finished = JobsQuery.finishedRows(appState.jobs, sort: sort, context: queryContext)
        return TPage("Jobs", right: { toolbar(visible) }) {
            if appState.jobs.isEmpty {
                emptyState
            } else {
                // `marginBottom: 20` between sections.
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(JobsQuery.managerSections(visible)) { section in
                        JobsSection(sectionID: section.id, jobs: section.jobs,
                                    columns: JobColumn.allCases, align: cellAlign,
                                    sort: $sort, expanded: $expanded,
                                    collapsed: $collapsed,
                                    selectMode: selectMode, selected: $selected) {
                            managerHeader(section)
                        }
                    }

                    if !finished.isEmpty { finishedSection(finished) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: The list

    /// Everything the query needs that is not on a Job. `percentComplete` goes
    /// through AppState because the real figure reads logged hours and live job
    /// clocks, which is not something to reproduce in a pure rule.
    private var queryContext: JobsQuery.Context {
        JobsQuery.Context(
            today: JobsDate.todayKey,
            clientName: { [clients = appState.clients] id in
                guard let id else { return "" }
                return clients.first { $0.id == id }?.name ?? ""
            },
            personName: { [people = appState.people] id in
                people.first { $0.id == id }?.name ?? ""
            },
            percentComplete: { [appState] job in appState.jobPct(job) })
    }

    // MARK: Section headers

    /// The manager's avatar and name, or just "Unassigned" — a job with no
    /// project manager has no face to show.
    @ViewBuilder
    private func managerHeader(_ section: JobsQuery.ManagerSection) -> some View {
        let manager = section.managerID.flatMap { id in
            appState.people.first { $0.id == id }
        }
        if let manager {
            JobsAvatar(person: manager, size: 22)
            Text(manager.name)
                .font(TFont.body(13, 700))
                .foregroundStyle(theme.text)
        } else {
            Text("Unassigned")
                .font(TFont.body(13, 700))
                .foregroundStyle(theme.text)
        }
    }

    /// Its own section under the working list, in green, with a green-ringed card.
    /// Built from the UNFILTERED jobs — see `JobsQuery.finishedRows`.
    private func finishedSection(_ finished: [Job]) -> some View {
        JobsSection(sectionID: "__finished__", jobs: finished,
                    columns: JobColumn.allCases, align: cellAlign,
                    accent: Color.hex("#10b981"),
                    sort: $sort, expanded: $expanded, collapsed: $collapsed,
                    selectMode: false, selected: $selected) {
            Text("\u{2713} Finished")
                .font(TFont.body(13, 700))
                .foregroundStyle(Color.hex("#10b981"))
        }
    }

    // MARK: The header bar

    /// THREE containers, never one, and never nested. The toggle brief's scope
    /// rule: a cluster owns its own container, and nesting one inside another
    /// leaves the inner shapes matched-geometrying against the outer's.
    private func toolbar(_ visible: [Job]) -> some View {
        HStack(spacing: toolGap) {
            selectCluster(visible)
            JobsToolDivider().padding(.leading, 9)
            GlassEffectContainer(spacing: glassFuse) { tools }
            Spacer(minLength: 12)
            GlassEffectContainer(spacing: glassFuse) { actions }
        }
    }

    /// `GlassEffectContainer(spacing:)` melts shapes closer together than this, so
    /// it has to sit BELOW the resting gap or the cluster welds into one permanent
    /// blob — the ordering `TGlassMetrics` documents.
    ///
    /// 4, not `TGlassMetrics.fuseDistance` (10). That 10 was chosen against iOS's
    /// 14pt header gap; this toolbar's gap is the web's `gap: 6`, which 10 would
    /// swallow whole. The filter, grouping and align buttons are three separate
    /// circles on the site, so they must stay three shapes.
    private let glassFuse: CGFloat = 4

    // MARK: Select / All / Delete
    //
    // Three controls that reveal one another left to right, and each one MELTS
    // OUT of the one before it rather than fading in beside it — see `JobsEmerge`
    // and the toggle brief it implements.
    //
    // The cluster has its OWN GlassEffectContainer, per that brief's scope rules.
    // `glassFuse` below the 6pt gap is what lets the emerging control read as part
    // of its neighbour while it is still close, and as its own shape once settled.

    private func selectCluster(_ visible: [Job]) -> some View {
        GlassEffectContainer(spacing: glassFuse) {
            HStack(spacing: toolGap) {
                JobsPillButton(label: selectMode ? "Done" : "Select",
                               style: .filled,
                               minWidth: selectMinWidth,
                               help: selectMode ? "Leave select mode" : "Select jobs") {
                    // A BARE withAnimation. The keyframe tracks supply the real
                    // timing, and a spring named here would fight them — the
                    // brief's note on the toggle's own tap handler.
                    withAnimation {
                        selectMode.toggle()
                        selected = []
                    }
                }

                if selectMode {
                    // `subtle-all-btn` — OUTLINED accent, one of the two places
                    // the web does not use its gradient fill.
                    JobsEmerge(distance: selectMinWidth + toolGap) {
                        JobsPillButton(label: selected.count == visible.count ? "None" : "All",
                                       style: .outlined(theme.accent),
                                       minWidth: allMinWidth,
                                       help: "Select all or none") {
                            withAnimation {
                                selected = selected.count == visible.count
                                    ? [] : Set(visible.map(\.id))
                            }
                        }
                    }

                    if !selected.isEmpty {
                        JobsEmerge(distance: allMinWidth + toolGap) {
                            HStack(spacing: 8) {
                                Text("\(selected.count) selected")
                                    .font(TFont.body(12, 700))
                                    .foregroundStyle(theme.accent)
                                    .fixedSize()
                                // Disabled like the other unported actions rather
                                // than opening a confirm that then refuses:
                                // deleting needs the bulk endpoint and an undo
                                // entry, and half of that is worse than none.
                                JobsPillButton(label: "Delete",
                                               style: .outlined(theme.danger),
                                               minWidth: 78,
                                               help: "Delete the selected jobs — not ported yet",
                                               enabled: false) { }
                            }
                        }
                    }
                }
            }
        }
    }

    /// `minWidth: 78` on Select, 56 on All. Pinned on the web so the label
    /// swapping to "Done" cannot resize the button and shift the toolbar — and
    /// here they are also the travel distances `JobsEmerge` needs.
    private let selectMinWidth: CGFloat = 78
    private let allMinWidth: CGFloat = 56

    // MARK: Filter / Grouping / Search / Align

    private var tools: some View {
        HStack(spacing: toolGap) {
            JobsIconButton(glyph: WebIcon.filter,
                           style: .tool(active: filter.activeCount > 0),
                           badge: filter.activeCount,
                           help: "Filter") {
                withAnimation(.smooth(duration: 0.28)) { filterOpen.toggle() }
            }
            .popover(isPresented: $filterOpen, arrowEdge: .bottom) {
                JobsFilterPopover(filter: $filter)
            }

            JobsIconButton(glyph: WebIcon.grouping,
                           style: .tool(active: false),
                           help: "Group jobs — not ported yet",
                           enabled: false) { }

            JobsSearchField(text: $filter.search)

            JobsIconButton(glyph: alignGlyph,
                           style: .tool(active: cellAlign != .leading),
                           help: "Align: \(alignName) (click to cycle)") {
                withAnimation(.easeOut(duration: 0.15)) { cellAlign = nextAlign }
            }
        }
    }

    /// One button cycling three states, as the web does, rather than three
    /// buttons — the toolbar has no room for a segmented control and the state is
    /// legible from the glyph.
    private var nextAlign: JobColumn.Align {
        switch cellAlign {
        case .leading:  return .center
        case .center:   return .trailing
        case .trailing: return .leading
        }
    }

    private var alignGlyph: GlyphSpec {
        switch cellAlign {
        case .leading:  return WebIcon.alignLeft
        case .center:   return WebIcon.alignCenter
        case .trailing: return WebIcon.alignRight
        }
    }

    private var alignName: String {
        switch cellAlign {
        case .leading:  return "left"
        case .center:   return "center"
        case .trailing: return "right"
        }
    }

    // MARK: Export / FAST TRAQS / New Job

    private var actions: some View {
        HStack(spacing: actionGap) {
            JobsPillButton(label: "Export", glyph: WebIcon.export, glyphSize: 14,
                           style: .filled,
                           help: "Export jobs to PDF, CSV or Word — not ported yet",
                           enabled: false) { }

            JobsToolDivider().padding(.horizontal, 3)

            JobsIconButton(glyph: WebIcon.cloud, glyphSize: 16,
                           style: .filled,
                           help: "FAST TRAQS import — not ported yet",
                           enabled: false) { }

            JobsPillButton(label: "+ New Job", style: .filled,
                           help: "Create a job — not ported yet",
                           enabled: false) { }
        }
    }

    // MARK: Empty

    private var emptyState: some View {
        VStack(spacing: 12) {
            WebGlyph(spec: WebIcon.emptyJobs, size: 40, color: theme.text)
                .opacity(0.3)
            Text("No jobs yet")
                .font(TFont.body(15, 700))
                .foregroundStyle(theme.text)
            Text("Create a job or use FAST TRAQS to import")
                .font(TFont.body(13))
                .foregroundStyle(theme.textDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
        .padding(.horizontal, 16)
    }
}

// MARK: - The filter popover
//
// `taskFilterOpen`'s dropdown (TRAQS.jsx:11428): 250 wide, 14 of padding, three
// sections of chips at 10pt/700 uppercase headers.
//
// The web's own dropdown is a positioned div; this is a `.popover`, which on
// macOS gives the arrow and the click-away for free. People, Client, Role and
// Hours-per-day sections are not here — they filter on state this page does not
// hold yet.

private struct JobsFilterPopover: View {
    @Environment(\.tqTheme) private var theme
    @Binding var filter: JobsFilter

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            section("Filter Status") {
                chipRow {
                    // "All" CLEARS the set rather than selecting every status —
                    // so it stays lit while nothing is chosen.
                    chip("All", on: filter.statuses.isEmpty) { filter.statuses = [] }
                    ForEach(JobStatus.allCases, id: \.self) { status in
                        chip(status.rawValue, on: filter.statuses.contains(status)) {
                            if filter.statuses.contains(status) { filter.statuses.remove(status) }
                            else { filter.statuses.insert(status) }
                        }
                    }
                }
            }

            section("Time Period") {
                chipRow {
                    ForEach(JobTimePeriod.allCases) { period in
                        chip(period.label, on: filter.timePeriods.contains(period)) {
                            if filter.timePeriods.contains(period) {
                                filter.timePeriods.remove(period)
                            } else {
                                filter.timePeriods.insert(period)
                            }
                        }
                    }
                }
            }

            section("Job #") {
                TextField("e.g. 1042", text: $filter.jobNumber)
                    .textFieldStyle(.plain)
                    .font(TFont.mono(12))
                    .foregroundStyle(theme.text)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(theme.surface))
                    .overlay(Capsule().strokeBorder(
                        filter.jobNumber.isEmpty ? theme.border : theme.accent, lineWidth: 1))
            }

            if filter.activeCount > 0 {
                Button {
                    // Keeps the SEARCH. The web's "Clear all filters" leaves
                    // `taskSearchQ` alone — it is a separate control with its own
                    // ×, and wiping it from in here would look like a bug.
                    filter = JobsFilter(search: filter.search)
                } label: {
                    Text("Clear all filters")
                        .font(TFont.body(11, 600))
                        .foregroundStyle(theme.danger)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(theme.danger.opacity(0.06)))
                        .overlay(Capsule().strokeBorder(theme.danger.opacity(0.2), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(width: 250)
    }

    @ViewBuilder
    private func section(_ title: String,
                         @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(TFont.body(10, 700))
                .tracking(10 * -0.045)
                .textCase(.uppercase)
                .foregroundStyle(theme.textDim)
            content()
        }
    }

    /// `flexWrap: "wrap"` with a 4pt gap.
    private func chipRow(@ViewBuilder content: () -> some View) -> some View {
        // A fixed 2-per-row grid rather than a flow layout: the status names are
        // long enough that they wrap to two rows at 250pt anyway, and a grid keeps
        // the chips a consistent width instead of ragged.
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 4),
                            GridItem(.flexible(), spacing: 4)],
                  alignment: .leading, spacing: 4) {
            content()
        }
    }

    private func chip(_ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(TFont.body(10, on ? 700 : 400))
                .foregroundStyle(on ? theme.accent : theme.text)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .frame(maxWidth: .infinity)
                .background(Capsule().fill(on ? theme.accent.opacity(0.13) : theme.surface))
                .overlay(Capsule().strokeBorder(on ? theme.accent : theme.border,
                                                lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }
}
