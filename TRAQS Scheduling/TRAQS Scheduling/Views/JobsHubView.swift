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
    @State private var showAddJob = false
    @State private var showSearch = false
    @State private var searchText = ""
    @FocusState private var searchFocused: Bool
    @State private var jobsSegment: TasksView.JobsSegment = .today   // list range (Today/Week/Month/Year)
    @State private var pickerOpen = false                            // range-picker dropdown open?

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                AmbientBackground()

                VStack(spacing: 0) {
                    // Persistent header. The leading trailing-button is mode
                    // specific (search in list, jump-to-date in gantt); the
                    // view toggle and add button are shared.
                    TRAQSNavHeader {
                        // Search is list-only; the gantt view has no leading
                        // utility button (its date controls live in its body).
                        if appNav.jobsMode == .list {
                            IconBtn(icon: .search, size: 18) {
                                withAnimation(.easeInOut(duration: 0.18)) {
                                    showSearch.toggle()
                                    if !showSearch { searchText = "" }
                                }
                                if showSearch { searchFocused = true }
                            }
                        }
                        JobsViewToggleButton()
                        if appState.isAdmin {
                            IconBtn(icon: .plus, size: 18) { showAddJob = true }
                        }
                    }

                    JobsHeaderBar()
                        .padding(.top, 2)
                        .padding(.bottom, 2)
                        .zIndex(1)   // keep the title above the blurred content

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

                    // Content area. When the range picker is open the cards
                    // blur behind the floating options — they don't move. The
                    // blur ramps in via a gradient (sharp near the title, full
                    // lower down), so there's no hard edge.
                    ZStack(alignment: .topTrailing) {
                        ZStack {
                            switch appNav.jobsMode {
                            case .list:
                                TasksView(searchText: searchText, segment: $jobsSegment)
                                    .transition(.opacity)
                            case .gantt:
                                GanttView()
                                    .transition(.opacity)
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)
                        .allowsHitTesting(!pickerOpen)

                        // Fading backdrop blur + tap-anywhere-to-dismiss. Always
                        // mounted and driven by opacity so it eases AWAY (not
                        // snaps) when the picker collapses.
                        FadingBlur()
                            .ignoresSafeArea()
                            .opacity(pickerOpen ? 1 : 0)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) {
                                    pickerOpen = false
                                }
                            }
                            .allowsHitTesting(pickerOpen)
                            .animation(.easeInOut(duration: 0.28), value: pickerOpen)

                        // Bottom-right: the calendar FAB with the range options
                        // stacked ABOVE it (they float over the blurred cards).
                        if appNav.jobsMode == .list {
                            VStack(alignment: .trailing, spacing: 12) {
                                rangeOptions
                                CalendarFab(open: $pickerOpen)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            .padding(.trailing, 20)
                            .padding(.bottom, 26)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .sheet(isPresented: $showAddJob) { JobEditView(job: nil) }
            }
            .navigationDestination(for: Job.self) { JobDetailView(job: $0) }
            .toolbar(.hidden, for: .navigationBar)
            .task { await appState.refreshOrgSettings() }
            // Resolve a tapped "new job / assigned / step / ready" push to its
            // job detail. `initial: true` covers a tap already pending when this
            // view first appears; the jobs.count watcher retries once a
            // cold-start load brings the job in.
            .onChange(of: appNav.pendingDeepLink, initial: true) { _, _ in consumeJobDeepLink() }
            .onChange(of: appState.jobs.count) { _, _ in consumeJobDeepLink() }
        }
    }

    /// Floating range-picker options — stacked vertically under the calendar
    /// button, dropping in one-by-one. Empty (zero-size) when closed.
    @ViewBuilder private var rangeOptions: some View {
        VStack(alignment: .trailing, spacing: 10) {
            if pickerOpen {
                // Stacked ABOVE the FAB: Today nearest the button, rising up
                // one-by-one (nearest the FAB reveals first).
                let opts = Array(TasksView.JobsSegment.allCases.reversed())   // [year, month, week, today]
                ForEach(Array(opts.enumerated()), id: \.element) { idx, opt in
                    let fromFab = opts.count - 1 - idx   // 0 = nearest the FAB (today)
                    RangePill(label: opt.label, selected: opt == jobsSegment) {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.8)) {
                            jobsSegment = opt
                            pickerOpen = false
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(response: 0.32, dampingFraction: 0.74)
                                .delay(Double(fromFab) * 0.05), value: pickerOpen)
                }
            }
        }
    }

    /// Push the job named by a pending `.job` deep link, if it's loaded.
    /// Leaves the link pending (to retry) when the job isn't here yet.
    private func consumeJobDeepLink() {
        guard case let .job(number)? = appNav.pendingDeepLink else { return }
        guard let job = appState.jobs.first(where: { $0.jobNumber == number }) else { return }
        path = [job]
        appNav.pendingDeepLink = nil
    }
}
