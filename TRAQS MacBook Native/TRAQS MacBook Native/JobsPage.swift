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
// STILL NOT PORTED, each its own piece of work rather than a detail: conditional
// formatting, grouping, row drag-reordering, the engineering and sign-off queues
// above the grid, and the wizard's SCHEDULING step (the availability check, the
// AI suggestion and the packer). The controls those live behind are drawn — the
// toolbar is what the page looks like — and disabled with a tooltip saying so,
// rather than left live and silently doing nothing. The same convention applies
// to the right-click menus' rows.
//
// That convention is the whole rule here, and it is worth stating plainly: a
// control that is drawn, enabled, and does nothing is indistinguishable from a
// bug. Anything that cannot work yet says so on hover.
//
// Two things here are HALF wired, and both say so where they are:
//
//   * Adding a custom column writes `AppState.orgSettings` but NOT the server,
//     because nothing in this app posts org settings yet. The column works until
//     the next settings fetch and then vanishes. `OrgSettings` already carries
//     its passthrough, so adding that write cannot destroy `conditions` and the
//     rest when it lands.
//   * New Job creates a job through the web's own "Save for Later" path —
//     complete, and unscheduled. Scheduling it is the step that is missing, and
//     TRAQS Cloud is where such a job then waits.
//
// A full map of what is left, with the web's line numbers, is in
// docs/MAC-JOBS-PARITY.md.

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
    /// The one cell in edit mode, app-wide — `gridCell` on the web.
    @State private var editing: JobsEditTarget?
    @State private var confirmingDelete = false

    /// The open right-click menu, and the one row it was opened on. `ctxMenu`.
    @State private var rowMenu: JobsRowMenuTarget?
    /// The Approval column's own right-click menu — `approvalCtx`. A separate
    /// state from `rowMenu` rather than a case of it: they open on the same
    /// gesture over different columns, and one optional per menu is what keeps
    /// two from being up at once.
    @State private var approvalMenu: JobsApprovalMenuTarget?
    /// A single row queued for deletion — the web's `confirmDelete`, which is a
    /// different thing from the toolbar's bulk `bulkDeleteConfirm`.
    @State private var confirmingRowDelete: JobGridRow?
    /// Column order, widths and renames (per device) recombined with the org's
    /// custom columns. See `JobsColumnStore` for why those two halves are stored
    /// apart.
    /// `taskOrder` — the order somebody set by dragging rows, overriding the
    /// column sort. Session-only, as it is on the web: it is `useState([])` there
    /// and is not in the bundle `saveUserSettings` persists.
    @State private var manualOrder: [String] = []
    /// The ids currently on screen, in the order they are drawn. Recorded after
    /// each render so a drag can seed `manualOrder` from it without recomputing
    /// the filter, the sort and the whole cell context inside the gesture.
    @State private var visibleOrder: [String] = []
    @State private var columnStore = JobsColumnStore()
    /// Which pointer-anchored column popover is open, if any. One at a time —
    /// the web's `colCtxMenu` / `renameCol` / `colPickerOpen` are three separate
    /// states there, and being able to open two at once is not a feature.
    @State private var columnPopover: JobsColumnPopover?

    /// Which modal is up, and whether it is arriving or leaving.
    ///
    /// A presenter rather than a bare optional, because a modal has to OUTLIVE
    /// its dismissal long enough to play an exit — see `TQModalPresenter`.
    @State private var modals = TQModalPresenter<JobsSheet>()

    /// The page's own size, which is the "viewport" every menu is placed
    /// against. Not the screen: the page sits inside the shell's rounded panel,
    /// and a menu that flips against the screen's bottom edge would still run off
    /// the panel's.
    /// Set from the GeometryReader in `body`, which is the only measurement here
    /// that reports the window's width rather than the grid's. See the note
    /// there.
    @State private var pageSize: CGSize = .zero

    /// Where the shell should navigate when a menu asks. Supplied by NativeShell,
    /// which owns `view` — a closure rather than a shared nav object, so the page
    /// gains no new observation dependency.
    var goTo: (TView) -> Void = { _ in }

    /// The coordinate space every pointer-anchored menu on this page is placed
    /// in. Named on the page's OUTERMOST view, above TPage's scroller, so a menu
    /// stays where it opened if the list scrolls under it — the web's
    /// `position: fixed`.
    static let menuSpace = "jobsPage"

    /// True while a modal is up and NOT yet leaving.
    private var modalUp: Bool { modals.sheet != nil && !modals.phase.isLeaving }

    /// `gap: 6` inside the tool cluster, `PAGE_ACTION_GAP = 10` between actions.
    private let toolGap: CGFloat = 6
    private let actionGap: CGFloat = 10

    var body: some View {
        // A GeometryReader, and it is load-bearing rather than decorative.
        //
        // Everything downstream needs to know how wide the page ACTUALLY is, so
        // the grid can decide whether its columns overflow. Three different ways
        // of measuring that were wrong, all for the same reason: a view whose
        // subtree contains the 1288pt grid reports 1288, not the window's width.
        // `.frame(maxWidth: .infinity)` GROWS to a wider child rather than
        // clamping it, and a `ScrollView(.vertical)` does the same horizontally —
        // measured, not assumed:
        //
        //     maxWidth:.infinity around 1288pt content, proposed 1100  -> 1288
        //     ScrollView(.vertical) with 1288pt content, window 1164   -> 1352
        //     GeometryReader,                            window 1164   -> 1164
        //
        // Only a GeometryReader reports the PROPOSAL, because it never sizes to
        // its content. That is the whole reason it is here.
        GeometryReader { geo in
            page(geo.size)
        }
    }

    private func page(_ size: CGSize) -> some View {
        // Filtered and sorted ONCE per render, then handed down. As a computed
        // property it was re-run by every reader — the toolbar alone asks three
        // times, for the row count and the All/None set — and each read is a
        // filter plus a sort over every job.
        //
        // Built once here, so no cell has to read AppState — see JobsCellContext.
        //
        // Over `appState.jobs`, NOT over the filtered lists: the percentages do
        // not depend on the filter, so building them from `visible + finished`
        // meant every keystroke in the search box rebuilt them — and cost an
        // array concatenation of the whole list to do it.
        //
        // FIRST, because the query needs it too: sorting by Progress compares
        // percentages, and reaching back to `appState.jobPct` for each comparison
        // is the same walk again, O(n log n) times over.
        // The width a section actually has: the page, less TPage's own side
        // padding. Taken from the reader's size rather than from `pageSize`,
        // which lands a frame later — and a frame of the grid laid out at the
        // wrong width is a visible jump.
        let contentWidth = max(0, size.width - TPageMetrics.padSide * 2)
        // Instrumented, because "the Jobs page is slow" is not something anyone
        // can act on and this is the whole of what a redraw computes. Off unless
        // TRAQS_PERF=1 — see TQPerf.
        let cells = TQPerf.measure("cellContext", TQPerf.shape(appState.jobs)) {
            cellContext()
        }
        let query = queryContext(cells)
        let layout = columnStore.layout(customColumns: appState.orgSettings.customCols)
        let columns = layout.columns
        let visible = TQPerf.measure("filter+sort") {
            // The manual order goes ON TOP of the filter and the sort, which is
            // where `orderedActive` sits on the web — a row somebody dragged
            // stays put until they change the sort themselves.
            JobsQuery.applyingManualOrder(
                JobsQuery.activeRows(appState.jobs, filter: filter,
                                     sort: sort, context: query),
                manualOrder)
        }
        let finished = JobsQuery.finishedRows(appState.jobs, sort: sort, context: query)
        return TPage("Jobs", right: { toolbar(visible) }) {
            if appState.jobs.isEmpty {
                emptyState
            } else {
                // `marginBottom: 20` between sections.
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(JobsQuery.managerSections(visible)) { section in
                        JobsSection(sectionID: section.id, jobs: section.jobs,
                                    columns: columns, align: cellAlign,
                                    availableWidth: contentWidth,
                                    context: cells, actions: cellActions,
                                    editing: $editing,
                                    sort: $sort, expanded: $expanded,
                                    collapsed: $collapsed,
                                    selectMode: selectMode, selected: $selected,
                                    secondaryClick: openRowMenu,
                                    approvalMenu: { row, point in
                                        openApprovalMenu(row, at: point, cells)
                                    },
                                    columnActions: columnActions(layout)) {
                            managerHeader(section)
                        }
                    }

                    if !finished.isEmpty {
                        finishedSection(finished, cells, columns, layout, contentWidth)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .confirmationDialog(deletePrompt, isPresented: $confirmingDelete) {
            Button("Delete \(selected.count) Job\(selected.count == 1 ? "" : "s")",
                   role: .destructive) {
                // One `updateJobs` for the whole set, not a `deleteJob` per id:
                // that pushes ONE undo entry, so Cmd-Z brings the whole selection
                // back rather than one job at a time.
                let doomed = selected
                appState.updateJobs(appState.jobs.filter { !doomed.contains($0.id) })
                withAnimation { selected = []; selectMode = false }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This also deletes their operations and sub-operations. Undo with \u{2318}Z.")
        }
        // The menu layer, and the space it is measured in. Both on the OUTERMOST
        // view: inside TPage the content sits in a scroller, and a menu placed
        // there would slide away under the pointer.
        .coordinateSpace(.named(Self.menuSpace))
        // Written from the reader rather than measured here. `.task(id:)` so it
        // lands once per size change instead of on every body pass.
        .task(id: size) { pageSize = size }
        // After the render, not during it — writing state inside `body` is what
        // produces "Modifying state during view update".
        .task(id: visible.map(\.id)) { visibleOrder = visible.map(\.id) }
        .overlay { menuLayer }
        .overlay { columnLayer(layout) }
        // THE PAGE ITSELF BLURS behind a modal, rather than relying on the
        // scrim's material to do it. A `Material` samples what is behind it, and
        // what is behind this one is a page inside a clipped, rounded panel —
        // the sampling was not producing a visible blur. Blurring the content
        // directly cannot fail to show, and it is what the web does too
        // (`modalBlur`, which blurs the page rather than only frosting the
        // overlay).
        //
        // BEFORE the sheet layer, so the modal itself stays sharp; after the
        // menu layers, so an open context menu blurs with the page.
        .blur(radius: modalUp ? 9 : 0)
        // Delayed on the way OUT only, so the blur lifts after the card has
        // gone — the same asymmetry the scrim uses. See `TQModalTiming`.
        .animation(modals.phase.isLeaving
                   ? .easeOut(duration: TQModalTiming.scrim)
                        .delay(TQModalTiming.scrimExitDelay)
                   : .easeOut(duration: TQModalTiming.scrim),
                   value: modalUp)
        .overlay { sheetLayer(cells, visible: visible, finished: finished) }
        .confirmationDialog(rowDeletePrompt, isPresented: rowDeleteBinding) {
            Button("Delete", role: .destructive) {
                if let row = confirmingRowDelete { deleteRow(row) }
                confirmingRowDelete = nil
            }
            Button("Cancel", role: .cancel) { confirmingRowDelete = nil }
        } message: {
            Text(rowDeleteDetail)
        }
    }

    // MARK: - The modals

    enum JobsSheet: Equatable {
        case export, cloud, newJob
        /// `approvalModal`. Carries the panel it edits, because unlike the other
        /// three it is about ONE row rather than about the page.
        case approvalSteps(jobID: String, panelID: String, title: String,
                           seed: [ApprovalChainStep])
    }

    @ViewBuilder
    private func sheetLayer(_ cells: JobsCellContext,
                            visible: [Job], finished: [Job]) -> some View {
        switch modals.sheet {
        case .export:
            // Active AND finished, which is what `allJobs` is on the web — the
            // Finished section is excluded from the grid's working list but an
            // export of "the jobs" that silently omitted every closed one would
            // be wrong in a way nobody would notice until it mattered.
            JobsExportSheet(jobs: visible + finished,
                            clients: cells.clientsByID,
                            progress: cells.percent,
                            phase: modals.phase,
                            dismiss: { modals.close() })

        case .cloud:
            JobsCloudSheet(jobs: appState.jobs,
                           clients: cells.clientsByID,
                           phase: modals.phase,
                           dismiss: { modals.close() })

        case .newJob:
            JobsNewJobSheet(people: appState.people,
                            clients: appState.clients,
                            customColumns: appState.orgSettings.customCols,
                            // `orgSettings.roles` — the department list the Dept
                            // pickers offer, and what filters each row's
                            // assignee options.
                            departments: appState.orgSettings.roles,
                            // The approval chains a new panel can start on. Read
                            // through JobsApproval, which is the one place that
                            // knows they live in the org settings' passthrough.
                            signOffTemplates: JobsApproval.templates(appState.orgSettings),
                            // Job templates are per device AND per org — see
                            // JobsTemplateStore.
                            orgCode: appState.orgCode,
                            // Step 3 needs the roster, everything already
                            // booked, and the org's work calendar. Assembled
                            // here so the sheet still reads no AppState itself.
                            scheduling: JobsNewJobSheet.JobsSchedulingContext(
                                people: appState.people,
                                jobs: appState.jobs,
                                calendar: WorkCalendar(
                                    workDays: appState.orgSettings.workDays,
                                    holidays: appState.orgSettings.holidays),
                                orgHpd: appState.orgSettings.hpd,
                                departments: appState.orgSettings.roles,
                                today: JobsDate.todayKey),
                            create: { job in
                                // `sendNotification: true` — the web's `saveTask`
                                // fires the "new job" heads-up to the admins, and
                                // only on creation.
                                appState.updateJob(job, sendNotification: true,
                                                   clientName: job.clientId.flatMap { id in
                                                       appState.clients.first { $0.id == id }?.name
                                                   })
                            },
                            phase: modals.phase,
                            dismiss: { modals.close() })

        case .approvalSteps(let jobID, let panelID, let title, let seed):
            JobsApprovalSheet(title: title,
                              people: appState.people,
                              seed: seed,
                              phase: modals.phase,
                              save: { steps in
                                  appState.setApprovalChain(jobId: jobID,
                                                            panelId: panelID,
                                                            steps: steps)
                                  modals.close()
                              },
                              dismiss: { modals.close() })

        case nil:
            EmptyView()
        }
    }

    // MARK: - Columns

    /// Which column popover is open, where, and about which column.
    ///
    /// One value rather than three booleans: the menu, the rename field and the
    /// add-column picker are mutually exclusive, and three flags is three ways to
    /// have two of them open at once.
    enum JobsColumnPopover: Equatable {
        case menu(JobsGridColumn, CGPoint)
        case rename(JobsGridColumn, CGPoint)
        case add(CGPoint)

        var point: CGPoint {
            switch self {
            case .menu(_, let p), .rename(_, let p), .add(let p): return p
            }
        }

        var width: CGFloat {
            switch self {
            case .menu:   return TQMenuMetrics.columnMenuWidth
            case .rename: return 220
            case .add:    return 280
            }
        }
    }

    private func columnActions(_ layout: JobsColumnLayout) -> JobsColumnActions {
        JobsColumnActions(
            move: { id, to in write(layout.moving(id, to: to)) },
            // Live: written into the store's in-memory copy so the drag is
            // visible, but not to disk until it ends. A drag is a hundred
            // changes and UserDefaults should see one.
            resize: { id, width in columnStore.previewWidth(id, width) },
            endResize: { columnStore.commitWidths() },
            openMenu: { column, point in columnPopover = .menu(column, point) },
            // A double-click on the header goes straight to rename, and the
            // header cannot know where to anchor it — the point comes from the
            // header cell's own frame, resolved here as the pointer's last
            // position is not available to a tap-count gesture.
            rename: { column, point in
                columnPopover = .rename(column, point == .zero
                                        ? CGPoint(x: 40, y: 120) : point)
            },
            addColumn: { point in columnPopover = .add(point) })
    }

    private func columnMenuActions(_ layout: JobsColumnLayout) -> JobsColumnMenuActions {
        JobsColumnMenuActions(
            rename: { column in
                columnPopover = .rename(column, columnPopover?.point ?? .zero)
            },
            insert: { newColumn, anchor, side in
                columnPopover = nil
                write(layout.inserting(newColumn, beside: anchor.id, side: side))
            },
            toggleGroupable: { column in write(layout.togglingGroupable(column.id)) },
            delete: { column in
                columnPopover = nil
                write(layout.removing(column.id))
            },
            setOptions: { custom, options in
                write(layout.updatingCustom(custom.id) { $0.options = options })
            },
            // A built-in list is recoloured for THIS user only, so it goes to the
            // per-device store and never to the server — the same split the web
            // uses, where `statusOpts` rides in `saveUserSettings` beside
            // `colOrder` while `customCols` lives in org settings.
            setPalette: { column, options in
                switch column {
                case .status: columnStore.saveStatusPalette(options)
                case .pri:    columnStore.savePriorityPalette(options)
                default:      break
                }
            })
    }

    /// Persist a new layout — the per-device half to `UserDefaults`, the custom
    /// columns to ORG SETTINGS, because a column somebody adds is a column the
    /// whole org gets. See `JobsColumnStore`.
    private func write(_ layout: JobsColumnLayout) {
        // The per-device half always lands: order, widths and renames are this
        // machine's preference and need nobody's permission.
        columnStore.save(layout)

        guard layout.custom != appState.orgSettings.customCols else { return }
        // The ORG half now reaches the server. It used to write
        // `AppState.orgSettings` and stop there, so a column added on this page
        // survived until the next settings fetch and then vanished — which reads
        // as the app losing your work rather than as a feature being unfinished.
        //
        // `updateOrgSettings` is optimistic and rolls back if the POST fails; the
        // passthrough on `OrgSettings` is what stops that POST destroying
        // `conditions`, `statusOpts` and everything else Swift does not model.
        appState.updateOrgSettings { $0.customCols = layout.custom }
    }

    /// Whether this person may change the ORG's columns — adding, deleting and
    /// editing a column's options all write org settings, which the server gates
    /// on `orgSettings` permission. Asked before the control is offered rather
    /// than after the POST comes back 403.
    private var canEditColumns: Bool { appState.canEditOrgSettings }

    /// The colours and glyphs the Edit Options editor should open on. Only the
    /// two built-in lists have one here; a custom column carries its own options.
    private func palette(for column: JobsGridColumn) -> [JobsSelectOption] {
        switch column.standard {
        case .status: return columnStore.statusOpts
        case .pri:    return columnStore.priOpts
        default:      return []
        }
    }

    @ViewBuilder
    private func columnLayer(_ layout: JobsColumnLayout) -> some View {
        if let popover = columnPopover {
            TQMenuPresenter(point: popover.point, viewport: pageSize,
                            width: popover.width,
                            dismiss: { columnPopover = nil }) { placement in
                switch popover {
                case .menu(let column, _):
                    JobsColumnMenu(column: column,
                                   isGroupable: layout.isGroupable(column.id),
                                   placement: placement,
                                   canEditColumns: canEditColumns,
                                   palette: palette(for: column),
                                   actions: columnMenuActions(layout),
                                   dismiss: { columnPopover = nil })
                case .rename(let column, _):
                    TQMenuCard(up: placement.up, width: popover.width) {
                        JobsRenamePopover(
                            column: column,
                            defaultLabel: defaultLabel(of: column),
                            commit: { name in
                                columnPopover = nil
                                write(layout.renaming(column.id, to: name,
                                                      defaultLabel: defaultLabel(of: column)))
                            },
                            cancel: { columnPopover = nil })
                    }
                case .add:
                    TQMenuCard(up: placement.up, width: popover.width) {
                        JobsColumnPicker(layout: layout,
                                         canEditColumns: canEditColumns,
                                         add: { write(layout.inserting($0)) },
                                         dismiss: { columnPopover = nil })
                    }
                }
            }
        }
    }

    /// The label a column has with no rename applied — what clearing the rename
    /// field restores.
    private func defaultLabel(of column: JobsGridColumn) -> String {
        switch column.kind {
        case .standard(let c): return c.label
        case .custom(let c):   return c.label
        }
    }

    // MARK: - The right-click menu

    @ViewBuilder
    private var menuLayer: some View {
        if let target = rowMenu {
            TQMenuPresenter(point: target.point, viewport: pageSize,
                            width: TQMenuMetrics.rowMenuWidth,
                            dismiss: { rowMenu = nil }) { placement in
                JobsRowMenu(target: target, placement: placement,
                            actions: rowMenuActions,
                            dismiss: { rowMenu = nil })
            }
        }
        if let target = approvalMenu {
            TQMenuPresenter(point: target.point, viewport: pageSize,
                            width: TQMenuMetrics.rowMenuWidth,
                            dismiss: { approvalMenu = nil }) { placement in
                JobsApprovalMenu(target: target, placement: placement,
                                 actions: approvalMenuActions,
                                 dismiss: { approvalMenu = nil })
            }
        }
    }

    private var approvalMenuActions: JobsApprovalMenuActions {
        JobsApprovalMenuActions(
            editSteps: { target in
                // Seeded from the panel as it stands NOW, not from the snapshot
                // the menu was opened with — the same reason `openRowMenu`
                // re-reads its child count.
                guard let panel = appState.jobs.first(where: { $0.id == target.jobID })?
                        .subs.first(where: { $0.id == target.panelID })
                else { return }
                modals.present(.approvalSteps(
                    jobID: target.jobID, panelID: target.panelID,
                    title: target.title,
                    seed: JobsApproval.editableSteps(of: panel,
                                                     settings: appState.orgSettings)))
            },
            resetChain: { target in
                appState.removeApprovalChain(jobId: target.jobID,
                                             panelId: target.panelID)
            })
    }

    /// A right-click on a panel's Approval cell. Resolved here, like the row
    /// menu's, so the cell hands over a row and a point and nothing else.
    private func openApprovalMenu(_ row: JobGridRow, at point: CGPoint,
                                  _ cells: JobsCellContext) {
        editing = nil
        guard case .panel(let panel, let jobID, _) = row,
              let state = cells.approval[panel.id] else { return }
        approvalMenu = JobsApprovalMenuTarget(
            point: point, jobID: jobID, panelID: panel.id,
            title: panel.title.isEmpty ? "Approval" : panel.title,
            state: state)
    }

    /// Resolve the right-click into everything the menu needs, ONCE.
    ///
    /// The row is a snapshot taken when the grid last drew, so the ancestry and
    /// the child count are re-read from `appState.jobs` here rather than taken
    /// from it — the web does the same, and its comment says why: "Live children
    /// count — read from tasks state, not from the spread item (which may not
    /// have subs populated)."
    private func openRowMenu(_ row: JobGridRow, at point: CGPoint) {
        // A menu opening over a half-typed cell would strand the edit.
        editing = nil

        let job = appState.jobs.first { $0.id == row.jobID }
        var target = JobsRowMenuTarget(
            point: point, row: row,
            jobID: row.jobID, jobTitle: job?.title ?? row.title,
            panelID: nil, panelTitle: nil,
            childCount: 0, siblingOpCount: 0, depsMode: .free)

        switch row {
        case .job:
            target.childCount = job?.subs.count ?? 0

        case .panel(let panel, _, _):
            let live = job?.subs.first { $0.id == panel.id }
            target.panelID = panel.id
            target.panelTitle = live?.title ?? panel.title
            target.childCount = live?.subs.count ?? 0

        case .operation(_, _, let panelID, _):
            let panel = job?.subs.first { $0.id == panelID }
            target.panelID = panelID
            target.panelTitle = panel?.title
            // Operations never have children, so Request Completion is always
            // offered on one.
            target.childCount = 0
            target.siblingOpCount = panel?.subs.count ?? 0
            // An explicit closure, not `flatMap(JobsEdit.dependencyMode)`. `map`'s
            // closure parameter is nonisolated, and handing it a reference to a
            // main-actor-isolated function is the same complaint
            // `map(Color.hex)` drew — the target defaults every declaration to
            // MainActor (`SWIFT_DEFAULT_ACTOR_ISOLATION`).
            target.depsMode = JobsDepsMode(panel.flatMap { JobsEdit.dependencyMode(of: $0) })
        }

        rowMenu = target
    }

    private var rowMenuActions: JobsRowMenuActions {
        JobsRowMenuActions(
            requestCompletion: { row in cellActions.requestCompletion(row) },
            // Never deletes on the click. The web routes every delete through a
            // confirmation, and this one can take a whole job with its panels.
            delete: { row in confirmingRowDelete = row },
            cycleDependencyMode: { target in cycleDependencyMode(target) },
            openChat: { _ in goTo(.messages) },
            goToSchedule: { _ in
                // The job to highlight is not carried yet — the Schedule page is
                // not ported, so there is nothing to highlight it on. Navigating
                // is the honest half of this, and the half that works.
                goTo(.schedule)
            })
    }

    /// Writes the mode AND the operations' `deps` together — see
    /// `JobsEdit.settingDependencyMode` for why they cannot be written apart.
    private func cycleDependencyMode(_ target: JobsRowMenuTarget) {
        guard let panelID = target.panelID,
              let job = appState.jobs.first(where: { $0.id == target.jobID })
        else { return }
        let next = target.depsMode.next
        let updated = JobsEdit.settingDependencyMode(
            next == .free ? nil : next.rawValue, panelID: panelID, in: job)
        guard JobsEdit.differs(job, updated) else { return }
        appState.updateJob(updated)
        // The menu stays open — this is a toggle you cycle — so its own copy of
        // the mode has to move with it.
        rowMenu?.depsMode = next
    }

    // MARK: Deleting one row

    private var rowDeleteBinding: Binding<Bool> {
        Binding(get: { confirmingRowDelete != nil },
                set: { if !$0 { confirmingRowDelete = nil } })
    }

    private var rowDeletePrompt: String {
        guard let row = confirmingRowDelete else { return "Delete?" }
        switch row.level {
        case 0:  return "Delete \u{201C}\(row.title)\u{201D}?"
        case 1:  return "Delete operation \u{201C}\(row.title)\u{201D}?"
        default: return "Delete sub-operation \u{201C}\(row.title)\u{201D}?"
        }
    }

    private var rowDeleteDetail: String {
        guard let row = confirmingRowDelete else { return "" }
        let children = row.childCount
        // Level 0 owns operations; a level-1 row owns sub-operations. The names
        // the whole page uses — see the note in JobsNewJobSheet.
        let noun = row.level == 0 ? "operation" : "sub-operation"
        let sweeps = children > 0
            ? " This also deletes its \(children) \(noun)\(children == 1 ? "" : "s")."
            : ""
        return "Permanently removes this item.\(sweeps) Undo with \u{2318}Z."
    }

    /// One `updateJob`/`updateJobs`, so the whole delete is ONE undo entry.
    private func deleteRow(_ row: JobGridRow) {
        guard let job = appState.jobs.first(where: { $0.id == row.jobID }) else { return }
        if let trimmed = JobsEdit.removing(row.editPath, from: job) {
            guard JobsEdit.differs(job, trimmed) else { return }
            appState.updateJob(trimmed)
        } else {
            appState.updateJobs(appState.jobs.filter { $0.id != job.id })
        }
    }

    private var deletePrompt: String {
        selected.count == 1
            ? "Delete this job?"
            : "Delete \(selected.count) jobs?"
    }

    // MARK: The list

    /// Everything the query needs that is not on a Job.
    ///
    /// Every lookup comes out of the cell context, which has already indexed the
    /// roster, the client list and the percentages. That is not just tidiness:
    /// these closures are called from inside a SORT COMPARATOR and from the
    /// search's per-field walk, so a `first(where:)` in any of them turns an
    /// O(n log n) sort into O(n log n × roster).
    private func queryContext(_ cells: JobsCellContext) -> JobsQuery.Context {
        JobsQuery.Context(
            today: cells.today,
            clientName: { id in
                guard let id else { return "" }
                return cells.clientsByID[id]?.name ?? ""
            },
            personName: { cells.peopleByID[$0]?.name ?? "" },
            percentComplete: { cells.percent[$0.id] })
    }

    // MARK: What the cells do
    //
    // `updTask(id, fields, pid)` — one write path. The row carries its own path
    // within its job (`JobGridRow.editPath`), the edit is applied purely (`JobsEdit`),
    // and `updateJob` handles the undo entry, the optimistic local write and the
    // debounced save.

    private var cellActions: JobsCellActions {
        JobsCellActions(
            commit: { [appState] row, field in
                guard let job = appState.jobs.first(where: { $0.id == row.jobID }) else { return }
                let updated = JobsEdit.apply(field, at: row.editPath, in: job)
                // Nothing changed — a picker reopened and confirmed on the same
                // day, or a field committed on blur without being touched. Saving
                // it anyway would push a pointless undo entry onto the stack.
                guard JobsEdit.differs(job, updated) else { return }
                appState.updateJob(updated)
            },
            commitCustom: { [appState] row, column, value in
                guard let job = appState.jobs.first(where: { $0.id == row.jobID }) else { return }
                let updated = JobsCustomValue.apply(column, value,
                                                    at: row.editPath, in: job)
                guard JobsEdit.differs(job, updated) else { return }
                appState.updateJob(updated)
            },
            reorder: { dragged, target in
                withAnimation(.easeOut(duration: 0.18)) {
                    // Seeded from what is ON SCREEN the first time, so one drag
                    // does not send every other job to the end.
                    //
                    // `visibleOrder`, not a fresh `activeRows` call: rebuilding it
                    // here would rebuild the cell context with it — the three
                    // full-tree index passes — inside a drag handler. It is
                    // recorded after each render instead; see the `.task` in
                    // `page`.
                    manualOrder = JobsQuery.movingInManualOrder(
                        manualOrder, dragged: dragged, onto: target,
                        current: visibleOrder)
                }
            },
            signApproval: { [appState] row, index in
                // Only a panel row carries a signable chain — a job's cell is a
                // rollup and is not clickable, and an operation has none.
                guard case .panel(let panel, let jobID, _) = row else { return }
                appState.signApproval(jobId: jobID, panelId: panel.id, stepIndex: index)
            },
            requestCompletion: { [appState] row in
                Task {
                    switch row {
                    case .job(let job):
                        await appState.requestJobCompletion(jobId: job.id)
                    case .panel(let panel, let jobID, _):
                        await appState.requestTaskCompletion(
                            jobId: jobID, panelId: panel.id, opId: nil,
                            panelTitle: panel.title, opTitle: nil)
                    case .operation(let op, let jobID, let panelID, _):
                        let panelTitle = appState.jobs
                            .first { $0.id == jobID }?.subs
                            .first { $0.id == panelID }?.title ?? ""
                        await appState.requestTaskCompletion(
                            jobId: jobID, panelId: panelID, opId: op.id,
                            panelTitle: panelTitle, opTitle: op.title)
                    }
                }
            })
    }

    /// Everything a cell needs, resolved ONCE. The dictionaries replace a
    /// `first(where:)` per cell per render, and — the reason this exists — they
    /// keep AppState out of the cells entirely: a cell that reads it becomes an
    /// observer of it, and a few hundred observers on one object means any change
    /// anywhere invalidates the whole grid.
    /// Everything a cell needs, resolved ONCE — and, on the common path, not
    /// resolved at all.
    ///
    /// The derived half (clients, people, percentages, display statuses,
    /// approval chains, the activity trail, the cloud list) lives behind a class
    /// reference that `AppState` rebuilds only when its `dataRevision` moves. So
    /// this runs on every body pass and is usually one `Int` comparison.
    ///
    /// That indirection is the difference between a page that responds and one
    /// that does not. Held by VALUE, the context's dictionaries were rebuilt each
    /// pass, never shared storage, and so had to be compared element by element —
    /// once per cell. Measured at 831 ms per pass against a 16 ms frame. See
    /// `JobsCellIndices`.
    ///
    /// The rest — the palettes, `today`, `isAdmin`, the approval actor — stays by
    /// value. None is derived from the job tree and all are tiny, so comparing
    /// them costs nothing and a recolour does not have to invalidate the indices.
    private func cellContext() -> JobsCellContext {
        JobsCellContext(indices: appState.jobsCellIndices(),
                        statusStyles: columnStore.statusStyles,
                        priorityStyles: columnStore.priorityStyles,
                        isAdmin: appState.isAdmin,
                        actor: appState.approvalActor,
                        today: JobsDate.todayKey)
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
    private func finishedSection(_ finished: [Job],
                                 _ cells: JobsCellContext,
                                 _ columns: [JobsGridColumn],
                                 _ layout: JobsColumnLayout,
                                 _ contentWidth: CGFloat) -> some View {
        JobsSection(sectionID: "__finished__", jobs: finished,
                    columns: columns, align: cellAlign,
                    availableWidth: contentWidth,
                    context: cells, actions: cellActions,
                    editing: $editing,
                    accent: Color.hex("#10b981"),
                    sort: $sort, expanded: $expanded, collapsed: $collapsed,
                    selectMode: false, selected: $selected,
                    secondaryClick: openRowMenu,
                    approvalMenu: { row, point in
                        openApprovalMenu(row, at: point, cells)
                    },
                    columnActions: columnActions(layout)) {
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
            HStack(spacing: selectGap) {
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
                    //
                    // A wider gap than the web's 6 before this one, asked for: at
                    // 6 the filled Select pill and the outlined All pill read as a
                    // single two-tone control. The emerge travel uses the same
                    // number, so the melt still starts from under Select.
                    JobsEmerge(distance: selectMinWidth + selectGap) {
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
                        JobsEmerge(distance: allMinWidth + selectGap) {
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
    /// Wider than the toolbar's 6, so Select and All do not read as one control.
    private let selectGap: CGFloat = 12

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
                           help: "Export jobs to CSV or Word") {
                modals.present(.export)
            }

            JobsToolDivider().padding(.horizontal, 3)

            JobsIconButton(glyph: WebIcon.cloud, glyphSize: 16,
                           style: .filled,
                           help: "TRAQS Cloud — jobs waiting to be scheduled") {
                modals.present(.cloud)
            }

            JobsPillButton(label: "+ New Job", style: .filled,
                           help: "Create a job") {
                modals.present(.newJob)
            }
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
