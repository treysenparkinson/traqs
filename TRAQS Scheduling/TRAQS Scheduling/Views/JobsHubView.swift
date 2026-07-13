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
    @State private var showApprovals = false
    @State private var showSearch = false
    @State private var searchText = ""
    @FocusState private var searchFocused: Bool
    @State private var jobsSegment: TasksView.JobsSegment = .today   // list range (Today/Week/Month/Year)

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                AmbientBackground()

                VStack(spacing: 0) {
                    // Persistent header. The leading trailing-button is mode
                    // specific (search in list, jump-to-date in gantt); the
                    // view toggle and add button are shared.
                    TRAQSNavHeader {
                        // Search is list-only (the gantt view has its own date
                        // controls in its body), but the button stays MOUNTED in
                        // both modes and just fades its opacity. Conditionally
                        // inserting/removing it made the icon pop out of the
                        // header layout the instant you switched — reading as a
                        // glitchy jump. Keeping the fixed-size slot and fading it
                        // (non-interactive in gantt) keeps the header dead-stable.
                        IconBtn(icon: .search, size: 18) {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                showSearch.toggle()
                                if !showSearch { searchText = "" }
                            }
                            if showSearch { searchFocused = true }
                        }
                        .opacity(appNav.jobsMode == .list ? 1 : 0)
                        .allowsHitTesting(appNav.jobsMode == .list)
                        .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)

                        JobsViewToggleButton()
                        // Approval Queue entry — replaces the old create-job "+".
                        // Only approvers (admin || canSignOff) see it; a badge shows
                        // how many panels are awaiting a sign-off step.
                        if appState.canViewApprovalQueue {
                            approvalQueueButton
                        }
                    }

                    // (The "Jobs" title now scrolls inside the list content —
                    // see TasksView — so the header is just the buttons and
                    // there's no fixed-vs-scrolling seam line under it.)

                    // Search field — slides in under the header, list mode only.
                    if appNav.jobsMode == .list && showSearch {
                        SearchBar(text: $searchText,
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
                    // place across both modes with zero shift.
                    JobsHeaderBar()
                        .padding(.top, pageTitleTopInset)
                        .padding(.bottom, 6)

                    // Content area with a floating liquid-glass calendar FAB
                    // (bottom-right). Tapping it opens a native menu of ranges.
                    ZStack(alignment: .topTrailing) {
                        // Both views stay mounted and crossfade via opacity, keyed
                        // on jobsMode. A switch + per-branch .transition here could
                        // leave the outgoing view stuck on rapid toggles; opacity
                        // is glitch-free and also preserves each view's scroll state.
                        ZStack {
                            TasksView(searchText: searchText, segment: $jobsSegment)
                                .opacity(appNav.jobsMode == .list ? 1 : 0)
                                .allowsHitTesting(appNav.jobsMode == .list)
                            GanttView()
                                .opacity(appNav.jobsMode == .gantt ? 1 : 0)
                                .allowsHitTesting(appNav.jobsMode == .gantt)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)

                        dateRangeFab
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            .padding(.trailing, 20)
                            .padding(.bottom, 26)
                            .opacity(appNav.jobsMode == .list ? 1 : 0)
                            .allowsHitTesting(appNav.jobsMode == .list)
                            .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .fullScreenCover(isPresented: $showApprovals) { ApprovalQueueView(isPresented: $showApprovals) }
            }
            .navigationDestination(for: Job.self) { JobDetailView(job: $0) }
            .toolbar(.hidden, for: .navigationBar)
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
        }
    }

    /// The Approval Queue entry button with a pending-count badge.
    private var approvalQueueButton: some View {
        ZStack(alignment: .topTrailing) {
            IconBtn(icon: .select, size: 18) { showApprovals = true }
            if appState.pendingApprovalCount > 0 {
                Text("\(appState.pendingApprovalCount)")
                    .font(TTypo.xsBold(11))
                    .tnum()
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .frame(minWidth: 18, minHeight: 18)
                    .background(Capsule().fill(T.brandGradient()))
                    .offset(x: 5, y: -5)
                    .allowsHitTesting(false)
            }
        }
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
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
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
