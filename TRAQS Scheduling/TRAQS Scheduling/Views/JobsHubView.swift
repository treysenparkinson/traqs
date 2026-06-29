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

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

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
                    .background(Color(hex: T.bg))

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

                    // The only part that swaps. Overlaid in a ZStack so the
                    // outgoing view fades out while the incoming one fades in.
                    ZStack {
                        switch appNav.jobsMode {
                        case .list:
                            TasksView(searchText: searchText)
                                .transition(.opacity)
                        case .gantt:
                            GanttView()
                                .transition(.opacity)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)
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

    /// Push the job named by a pending `.job` deep link, if it's loaded.
    /// Leaves the link pending (to retry) when the job isn't here yet.
    private func consumeJobDeepLink() {
        guard case let .job(number)? = appNav.pendingDeepLink else { return }
        guard let job = appState.jobs.first(where: { $0.jobNumber == number }) else { return }
        path = [job]
        appNav.pendingDeepLink = nil
    }
}
