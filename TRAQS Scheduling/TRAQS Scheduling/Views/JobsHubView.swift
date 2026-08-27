import SwiftUI

// MARK: - Jobs Hub
// The merged "Jobs" tab. It owns the persistent chrome — the nav header, the
// slide-in search field, the add-job sheet, the navigation stack and its
// destinations — and swaps ONLY its body between the list view (TasksView) and
// the gantt view (GanttView). Because the header stays mounted, toggling the
// view mode cross-fades just the content underneath instead of the whole
// screen reading like a reload.

struct JobsHubView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav

    // Navigation + chrome state, lifted here so it survives a list↔gantt swap.
    @State private var path: [Job] = []
    /// Shared with the job cards (via the environment) so pushing a job zooms out
    /// of the tapped card instead of sliding a new screen over it.
    @Namespace private var zoomNS
    /// Header-driven state lives in AppNav: these controls are drawn by
    /// HeaderControlsHost, above the TabView, and a host can't reach a page's
    /// private @State. See HeaderControls.swift. The page reads and writes them
    /// exactly as it did its own @State.
    private var showApprovals: Bool {
        get { appNav.showApprovalQueue } nonmutating set { appNav.showApprovalQueue = newValue }
    }
    private var showAvailability: Bool {
        get { appNav.showAvailability } nonmutating set { appNav.showAvailability = newValue }
    }
    private var showSearch: Bool {
        get { appNav.jobsSearchOpen } nonmutating set { appNav.jobsSearchOpen = newValue }
    }
    private var searchText: String {
        get { appNav.jobsSearchText } nonmutating set { appNav.jobsSearchText = newValue }
    }
    /// Focus stays HERE — a @FocusState belongs to the view owning the field.
    /// The hoisted button only flips `jobsSearchOpen`; this page takes focus.
    @FocusState private var searchFocused: Bool
    @State private var jobsSegment: TasksView.JobsSegment = .today   // list range (Today/Week/Month/Year)

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                PageBackground()
                // Hand the zoom namespace to the cards, which sit several views
                // deep in TasksView's sections — see `zoomSource(id:)`.

                VStack(spacing: 0) {
                    // ↓ modalPageBlur applied at the closing brace below so the
                    //   break banner can blur the page content underneath it.
                    // Persistent header. The leading trailing-button is mode
                    // specific (search in list, jump-to-date in gantt); the
                    // view toggle and add button are shared.
                    // Logo and row height only. The trailing controls are
                    // published to HeaderControlsHost (registered at the bottom
                    // of this view) so their glass can morph into the next tab's
                    // instead of being torn down with the page.
                    TRAQSNavHeader()

                    // (The "Jobs" title now scrolls inside the list content —
                    // see TasksView — so the header is just the buttons and
                    // there's no fixed-vs-scrolling seam line under it.)

                    // Search field — slides in under the header, list mode only.
                    if appNav.jobsMode == .list && showSearch {
                        SearchBar(text: Bindable(appNav).jobsSearchText,
                                  placeholder: "Search jobs, customers…",
                                  focused: $searchFocused,
                                  onCancel: {
                                      withAnimation(.easeInOut(duration: 0.18)) {
                                          showSearch = false
                                          searchText = ""
                                      }
                                  })
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    // Static "Jobs" title — rendered once HERE (not inside the
                    // swapped list/gantt views) so it sits in the exact same
                    // place across both modes with zero shift. The range FAB sits
                    // on the right of the title row (list mode only).
                    JobsHeaderBar()
                        .padding(.top, pageTitleTopInset)
                        .padding(.bottom, 6)

                    // Content — list/gantt crossfade. Both views stay mounted and
                    // crossfade via opacity, keyed on jobsMode (a switch + per-branch
                    // .transition could leave the outgoing view stuck on rapid
                    // toggles; opacity is glitch-free and preserves scroll state).
                    ZStack {
                        TasksView(searchText: searchText, segment: $jobsSegment, onOpenJob: { path.append($0) })
                            .opacity(appNav.jobsMode == .list ? 1 : 0)
                            .allowsHitTesting(appNav.jobsMode == .list)
                        GanttView()
                            .opacity(appNav.jobsMode == .gantt ? 1 : 0)
                            .allowsHitTesting(appNav.jobsMode == .gantt)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)
                }
                .fullScreenCover(isPresented: Bindable(appNav).showApprovalQueue) { ApprovalQueueView(isPresented: Bindable(appNav).showApprovalQueue) }
                .modalPageBlur(appNav.jobsBreakBanner != nil || showAvailability)
                // Slide the bottom nav pill out while the availability popup is
                // up, and back in when it closes — MainTabView owns the spring
                // (see its `.animation(value: appNav.hideTabBar)`), so this is a
                // plain write. Same handling the clock PIN pads get.
                //
                // The popup is tall and centred; unlike the break shout, which
                // is small enough that the bar can just blur behind it, this one
                // reaches the bottom edge and the bar would sit on top of it.
                .onChange(of: showAvailability) { _, shown in
                    appNav.hideTabBar = shown
                }
                // Failsafe: leaving the page with the popup somehow still up
                // would otherwise strand the bar off-screen for every tab.
                .onDisappear { appNav.hideTabBar = false }

                // Break started / ended banner — same frosted-glass popup as the
                // time clock page, and the same entrance as every other modal.
                if let kind = appNav.jobsBreakBanner {
                    ClockActionBanner(kind: kind) {
                        withTransaction(.noAnimation) {
                            appNav.jobsBreakBanner = nil
                            appNav.blurTabBar = false
                        }
                    }
                    .id(kind)
                    // The banner animates itself in and out — see ModalPop.
                    .transition(.identity)
                    .zIndex(20)
                }

                // Availability quick-check — the house popup, in-hierarchy, so
                // it can blur the page behind it directly. Rendered from this
                // stable container (not the opacity-animated FAB) so it
                // reliably shows, which is why the old sheet lived here too.
                if showAvailability {
                    AvailabilityCheckPopup {
                        withTransaction(.noAnimation) { showAvailability = false }
                    }
                    // Owns its own entrance and exit — see ModalPop.
                    .transition(.identity)
                    .zIndex(20)
                }
            }
            // Reserve space INSIDE the NavigationStack so content ends at the top
            // of the floating nav pill (an outer inset is absorbed here).
            .safeAreaInset(edge: .bottom) {
                Color.clear.frame(height: appNav.hideTabBar ? 0 : tabPillBottomInset)
            }
            // The system zoom morph: the detail screen grows out of the card that
            // was tapped. `sourceID` must match the id each card passes to
            // `.zoomSource(id:)`.
            .navigationDestination(for: Job.self) { job in
                JobDetailView(job: job)
                    .navigationTransition(.zoom(sourceID: job.id, in: zoomNS))
            }
            .toolbar(.hidden, for: .navigationBar)
            .environment(\.zoomNamespace, zoomNS)
            .task {
                appState.foregroundSync()   // pull the latest jobs on open
                await appState.refreshOrgSettings()
            }
            // Resolve a tapped "new job / assigned" push to its job detail, and a
            // "step / ready" push to the Approval Queue (approvers) or the job
            // detail (everyone else). `initial: true` covers a tap already pending
            // when this view first appears; the jobs.count watcher retries once a
            // cold-start load brings the job in.
            .onChange(of: appNav.pendingDeepLink, initial: true) { _, _ in consumeJobDeepLink() }
            .onChange(of: appState.jobs.count) { _, _ in consumeJobDeepLink() }
            // The hoisted search button only flips the flag; taking focus is
            // still this page's job (see `searchFocused`).
            .onChange(of: showSearch) { _, open in if open { searchFocused = true } }
        }
        // Header controls, drawn by HeaderControlsHost above the TabView.
        //
        // "search" is deliberately the SAME id Messages uses: it is the same
        // control meaning the same thing, so its glass flows straight across
        // that tab switch instead of one dissolving while the other grows.
    }

    /// Liquid-glass calendar FAB (same 62pt footprint) whose tap opens a native
    /// menu of ranges (Today / Week / Month / Year) with the current one checked.
    private var dateRangeFab: some View {
        Menu {
            Picker("Range", selection: $jobsSegment) {
                ForEach(TasksView.JobsSegment.allCases, id: \.self) { opt in
                    Text(opt.label).tag(opt)
                }
            }
        } label: {
            VStack(spacing: -2) {
                Text(todayMonth)
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .tracking(0.8)
                    .foregroundStyle(Color(hex: T.muted))
                Text(todayDay)
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: T.ink))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .glassCircleButton()
        .frame(width: 62, height: 62)
    }

    private var todayMonth: String {
        let f = DateFormatter(); f.dateFormat = "MMM"; return f.string(from: Date()).uppercased()
    }
    private var todayDay: String {
        let f = DateFormatter(); f.dateFormat = "d"; return f.string(from: Date())
    }

    /// Resolve a pending Jobs-tab deep link:
    /// - `.job` → push that job's detail.
    /// - `.approvals` → open the Approval Queue for approvers; otherwise fall back
    ///   to the job detail (so a non-approver who taps a step/ready push still
    ///   lands somewhere useful).
    /// Leaves a `.job`/fallback link pending (to retry) when the job isn't loaded
    /// yet; the `.approvals`→queue path needs no job lookup so it resolves at once.
    private func consumeJobDeepLink() {
        switch appNav.pendingDeepLink {
        case let .job(number):
            guard let job = appState.jobs.first(where: { $0.jobNumber == number }) else { return }
            path = [job]
            appNav.pendingDeepLink = nil
        case let .approvals(number):
            if appState.canViewApprovalQueue {
                showApprovals = true
                appNav.pendingDeepLink = nil
            } else {
                // Not an approver → behave like a job deep link.
                guard let job = appState.jobs.first(where: { $0.jobNumber == number }) else { return }
                path = [job]
                appNav.pendingDeepLink = nil
            }
        default:
            return
        }
    }
}
