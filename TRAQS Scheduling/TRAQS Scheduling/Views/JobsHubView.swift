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
    /// The job whose read-only detail popup is open. Tapping a card no longer
    /// PUSHES — a job's details are something you check and dismiss, and pushing
    /// meant losing your scroll position in the list to do it.
    ///
    /// Drives a `.fullScreenCover`, NOT an in-hierarchy overlay. The shell's
    /// glass header and the floating nav pill are drawn by MainTabView on top of
    /// every page, so a popup living inside this page renders UNDER both. A
    /// cover is its own presentation, above the lot. (An in-hierarchy popup can
    /// still BLUR the chrome — see `appNav.blurChrome` — but it cannot get on
    /// top of it, and this one is full-height.)
    @State private var detailTarget: JobDetailTarget?
    /// Shared with the job cards (via the environment). The zoom morph belonged
    /// to the pushed detail screen; the cards still publish their source ids, so
    /// re-attaching a pushed destination later needs no change on their side.
    @Namespace private var zoomNS
    /// Header-driven state lives in AppNav: these controls are drawn by
    /// HeaderControlsHost, above the TabView, and a host can't reach a page's
    /// private @State. See HeaderControls.swift. The page reads and writes them
    /// exactly as it did its own @State.
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
                    // No header here — the shell owns the one persistent GlassHeader
                    // (§2). The spacer reserves its height so content starts below it and
                    // still SCROLLS UNDER it, which is what gives the glass something live
                    // to refract (§8 — glass over a static background renders flat).
                    Color.clear.frame(height: GlassHeader.height)

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

                    // The "Jobs" title is NOT here any more — it scrolls with the
                    // content, the way Home's and Analytics' titles do, so the only
                    // thing fixed to the top of the page is the shell's header.
                    // Both modes render it through the same `JobsHeaderBar`, so
                    // list and gantt can't drift into different title treatments;
                    // what they no longer share is its scroll offset, which is the
                    // price of having it scroll at all.

                    // Content — list/gantt crossfade. Both views stay mounted and
                    // crossfade via opacity, keyed on jobsMode (a switch + per-branch
                    // .transition could leave the outgoing view stuck on rapid
                    // toggles; opacity is glitch-free and preserves scroll state).
                    ZStack {
                        TasksView(searchText: searchText, segment: $jobsSegment, onOpenJob: { openDetail($0) })
                            .opacity(appNav.jobsMode == .list ? 1 : 0)
                            .allowsHitTesting(appNav.jobsMode == .list)
                        GanttView()
                            .opacity(appNav.jobsMode == .gantt ? 1 : 0)
                            .allowsHitTesting(appNav.jobsMode == .gantt)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)
                }
                // Read-only job details, over everything — see `detailTarget`.
                // NO `.navigationTransition(.zoom(...))`. A zoom presentation
                // shrinks the PRESENTER to fly the card up, which pulled the
                // whole page in, showed the window surface as a white border
                // around it, and snapped back on landing. The popup springs up
                // on its own instead (ModalPop) and the page stays put.
                .fullScreenCover(item: $detailTarget) { target in
                    JobDetailPopup(seedJob: target.job,
                                   highlightPanelId: target.panelId,
                                   highlightOpId: target.opId) {
                        // BOTH writes inside, for the reason in `openDetail`.
                        withTransaction(.noAnimation) {
                            detailTarget = nil
                            appNav.modalBlur = false
                        }
                    }
                }
                .modalPageBlur(appNav.jobsBreakBanner != nil || showAvailability)
                // Blur the CHROME from the same condition. `.modalPageBlur`
                // above reaches only this page's content; the glass header is a
                // sibling of the page out in MainTabView, so without this the
                // TRAQS wordmark and the header buttons stayed sharp over a
                // blurred page. (The break banner sets `blurChrome` at its own
                // call site too — this covers the availability popup and acts as
                // the failsafe for both.)
                .onChange(of: appNav.jobsBreakBanner != nil || showAvailability) { _, up in
                    appNav.blurChrome = up
                }
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
                .onDisappear {
                    appNav.hideTabBar = false
                    appNav.blurChrome = false
                }

                // Break started / ended banner — same frosted-glass popup as the
                // time clock page, and the same entrance as every other modal.
                if let kind = appNav.jobsBreakBanner {
                    ClockActionBanner(kind: kind) {
                        withTransaction(.noAnimation) {
                            appNav.jobsBreakBanner = nil
                            appNav.blurChrome = false
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
            // No `navigationDestination(for: Job.self)` any more — a job's detail
            // is a popup (see `detailJob`), not a screen. `path` stays for other
            // pushes and so a deep link has somewhere to land.
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

    /// Open a job's read-only detail popup.
    ///
    /// `modalBlur` is what blurs the page, the glass header AND the nav pill —
    /// MainTabView applies it to all three as one layer. The cover is a separate
    /// presentation, so it stays sharp on top of that.
    ///
    /// Presented WITHOUT animation, like every other modal here: the popup fades
    /// and scales up from the centre on its own (ModalPop), and the cover's
    /// default slide-up-from-the-bottom would play underneath it.
    ///
    /// BOTH writes go inside the transaction, and that is load-bearing. With the
    /// blur set outside it, SwiftUI batched the two changes into ONE update pass
    /// and that pass took the transaction in effect at the FIRST change — the
    /// default, animated one. `disablesAnimations` never reached the cover and
    /// it slid up regardless. The blur still eases, because ShellBlur carries
    /// its own `.animation(_:value:)`, which outranks the transaction.
    private func openDetail(_ job: Job) {
        withTransaction(.noAnimation) {
            appNav.modalBlur = true
            detailTarget = JobDetailTarget(job: job)
        }
    }

    /// Resolve a pending Jobs-tab deep link: `.job` opens that job's detail
    /// popup. Left PENDING when the job isn't loaded yet, so the `jobs.count`
    /// watcher can retry once a cold-start load brings it in.
    private func consumeJobDeepLink() {
        guard case let .job(number) = appNav.pendingDeepLink else { return }
        guard let job = appState.jobs.first(where: { $0.jobNumber == number }) else { return }
        openDetail(job)
        appNav.pendingDeepLink = nil
    }
}
