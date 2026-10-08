import SwiftUI

// MARK: - TRAQS Tabs (custom frosted floating pill)
// The primary navigation is a bespoke TRAQS frosted-glass pill — icon-only,
// glowy, floating above the content. Selection is bound to AppNav.selected so
// push-notification deep links (which set `selected`) keep working.

/// `TTab` itself lives in Services/NavigationTypes — AppNav stores it. This is
/// the half that needs a view type.
extension TTab {
    /// On Basic the Analytics slot is the Employees directory — Analytics is
    /// Business-only, as on the web. Same tab, same position, different page.
    func icon(business: Bool) -> TIcon { self == .stats && !business ? .employees : icon }
    func label(business: Bool) -> String { self == .stats && !business ? "Employees" : label }

    var icon: TIcon {
        switch self {
        case .home:     return .home
        case .jobs:     return .jobs
        case .hours:    return .hours
        case .stats:    return .stats
        case .chat:     return .chat
        }
    }
}

struct MainTabView: View {
    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @Environment(AuthManager.self) private var auth
    @State private var showTimeOff: Bool = false

    /// MUST live here, in the shell. Declared inside GlassHeader (or a page) it
    /// would die with that view, and the outgoing and incoming glass shapes
    /// would never share an identity space — see §2/§5.3 of the header brief.
    @Namespace private var headerNamespace

    var body: some View {
        return ZStack(alignment: .bottom) {
            Color(hex: T.bg).ignoresSafeArea()

            // The TabView lives in its own view so that the SELECTION read is
            // scoped to it. Held inline here, a tab change invalidated
            // MainTabView's whole body — which recomputed the unread badge and
            // rebuilt the modifier chain around all five tabs on every tap.
            //
            // THREE blur layers, and which layer a thing sits in is what decides
            // whether it blurs behind a modal:
            //
            //   • the PAGE     — blurred by `pageBlurred` (a .fullScreenCover is
            //                    its own presentation and can't blur the page
            //                    from the inside, so it sets the flag and we do
            //                    it out here; the cover itself stays sharp. The
            //                    hoisted availability popup rides the same flag).
            //   • the HEADER   — blurred by `chromeBlurred`, i.e. EITHER kind of
            //                    modal.
            //   • the NAV PILL — same.
            //
            // The header's `.overlay` is attached AFTER the page's `.shellBlur`
            // on purpose: an overlay is drawn on top of the already-blurred
            // result, so the header is outside the page's blur layer and carries
            // exactly one blur of its own. Attached before it, the header
            // inherited the page's blur and an in-hierarchy popup — which can't
            // set `modalBlur` without blurring itself — left the TRAQS wordmark
            // and every header button perfectly sharp over a blurred page.
            Group {
                TabHost()
                    .shellBlur(\.pageBlurred)
                    // THE header. One instance, above the TabView, alive for the
                    // life of the app — pages render content only. The namespace
                    // is handed down from here.
                    .overlay(alignment: .top) {
                        HeaderHost(namespace: headerNamespace)
                            .shellBlur(\.chromeBlurred)
                    }

                // The tab bar is Apple's own (TabHost) — its native Liquid Glass bar
                // and selection highlighter. The custom TRAQS pill is gone.
            }

            // Availability quick-check — HOISTED here, out of the Jobs page, and
            // drawn ABOVE the header on purpose.
            //
            // THE header is an `.overlay` on TabHost just above, so it is drawn
            // in front of anything a page renders and no zIndex down in a page
            // can out-rank it. Rendered inside JobsHubView, this popup had to
            // reserve the header's whole 94pt band to stop the header landing on
            // top of it once the number pad lifted it — a quarter of the height
            // it had left, on the one screen where every point counts. Out here
            // the question doesn't arise: it owns the screen, the header and the
            // pill blur behind it like they do behind a `.fullScreenCover`.
            //
            // In the ZStack rather than a cover BECAUSE it still needs to blur
            // the page (`pageBlurred`) while staying sharp itself, which a
            // separate presentation can't do.
            if appNav.showAvailability {
                AvailabilityCheckPopup {
                    withTransaction(.noAnimation) { appNav.showAvailability = false }
                }
                // Owns its own entrance and exit — see ModalPop.
                .transition(.identity)
                .zIndex(5)
            }

            // Global blocking-action loading overlay (clock in/out). Above all.
            if let label = appState.clockActionLabel {
                TRAQSLoadingOverlay(message: appState.clockActionDone
                                        ? (label.hasPrefix("Clocking In") ? "Clocked In" : "Clocked Out")
                                        : label,
                                    done: appState.clockActionDone)
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: appNav.hideTabBar)
        .animation(.easeInOut(duration: 0.18), value: appState.clockActionLabel)
        // A tapped time-off push flips appNav.openTimeOffPage → present the Time
        // Off page and reset the flag so it fires once. `initial: true` also
        // catches a cold-start tap where the flag is already set.
        .fullScreenCover(isPresented: $showTimeOff) {
            TimeOffView().edgeSwipeBack { showTimeOff = false }
        }
        // Destinations the header's account menu and Admin button open. They are
        // presented HERE because the header lives in the shell now — a control
        // can't present from a view that outlives every page.
        .fullScreenCover(isPresented: Bindable(appNav).showAdmin) {
            AdminView().edgeSwipeBack { appNav.showAdmin = false }
        }
        .sheet(isPresented: Bindable(appNav).showAddJob) { AddJobSheet() }
        .sheet(isPresented: Bindable(appNav).showCustomize) { CustomizeView() }
        .sheet(isPresented: Bindable(appNav).showProfile) {
            EditProfileView().edgeSwipeBack { appNav.showProfile = false }
        }
        .onChange(of: appNav.logoutRequested) { _, wants in
            guard wants else { return }
            appNav.logoutRequested = false
            auth.logout()
        }
        // Basic has no Gantt toggle, so never leave it stranded in Gantt — a
        // mode picked while the org was Business, or before the tier loaded.
        .onChange(of: appState.isBusinessTier, initial: true) { _, business in
            if !business, appNav.jobsMode != .list { appNav.jobsMode = .list }
        }
        .onChange(of: appNav.openTimeOffPage, initial: true) { _, open in
            if open {
                showTimeOff = true
                appNav.openTimeOffPage = false
            }
        }
        .preferredColorScheme(themeSettings.isLightTheme ? .light : .dark)
    }
}

/// Blurs its content while one of AppNav's blur flags is up, reading that flag
/// ITSELF rather than letting the shell read it. A `KeyPath`, so it takes a
/// computed flag (`chromeBlurred`) as readily as a stored one.
///
/// The read HAS to live in a modifier. MainTabView read `appNav.modalBlur`
/// inline, so opening any modal re-ran the shell's whole body — rebuilding the
/// TabView, the header host and the tab bar — and the page visibly re-rendered a
/// beat after the modal arrived. Under the job popup's zoom transition that
/// landed right in the middle of the animation. It is the same trap the note on
/// `TabHost` describes for `appNav.selected`.
///
/// A ViewModifier's body re-runs on its own dependency WITHOUT re-evaluating the
/// content it wraps, so the flip costs a blur and nothing else. The animation
/// lives here too, for the same reason: on the shell it was another read.
private struct ShellBlur: ViewModifier {
    @Environment(AppNav.self) private var appNav
    let flag: KeyPath<AppNav, Bool>

    func body(content: Content) -> some View {
        let on = appNav[keyPath: flag]
        return content
            .modalPageBlur(on)
            // Eases in/out with the modal it belongs to rather than snapping.
            .animation(.easeInOut(duration: 0.2), value: on)
    }
}

private extension View {
    func shellBlur(_ flag: KeyPath<AppNav, Bool>) -> some View {
        modifier(ShellBlur(flag: flag))
    }
}

// MARK: - Header host
//
// Reads `appNav.selected` ITSELF and holds the per-tab configs. Kept out of
// MainTabView's body for the same reason TabHost is: a selection read up there
// re-runs the shell on every tap, rebuilding the TabView and all five pages.
//
// The NAMESPACE is not declared here — it is passed in from the shell, so it
// outlives every change to this view.

private struct HeaderHost: View {
    let namespace: Namespace.ID
    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState

    var body: some View {
        GlassHeader(config: config(for: appNav.selected), namespace: namespace)
    }

    /// What each tab's header holds. Slots are roles, never icons or indices
    /// (§3): a slot on both sides of a switch keeps its glass and swaps its
    /// glyph; a slot on one side only materializes or dissolves.
    private func config(for tab: TTab) -> HeaderConfig {
        switch tab {
        case .home:
            return HeaderConfig(pills: [
                HeaderPill(slot: .profile, content: .avatar, action: .menu(.account))
            ])

        case .jobs:
            var pills: [HeaderPill] = []
            // Availability and the list/Gantt eye are Business-only. Basic has
            // the list alone — it's where the job clock lives.
            let business = appState.isBusinessTier
            if business, appState.currentPerson?.isAdmin == true {
                // Leftmost in the cluster. It used to stand alone where "+" is
                // now; creating a job is the page's primary action, so it takes
                // the prominent slot and this joins the cluster.
                pills.append(HeaderPill(
                    slot: .availability,
                    content: .symbol("clock.arrow.circlepath", tint: nil),
                    action: .menu(.availability)))
            }
            if business {
                // Just an eye. The old label ("List"/"Gantt") named the mode you
                // were LEAVING as often as the one you were in.
                pills.append(HeaderPill(slot: .viewMode, content: .icon(.eye),
                                        action: .tap({ appNav.jobsMode.toggle() })))
            }
            pills += [
                // Search is list-only, but stays MOUNTED in gantt and just fades
                // — removing it resizes the cluster on every mode flip.
                HeaderPill(slot: .search, content: .icon(.search),
                           dimmed: appNav.jobsMode != .list,
                           action: .tap({
                               withAnimation(.easeInOut(duration: 0.18)) {
                                   appNav.jobsSearchOpen.toggle()
                                   if !appNav.jobsSearchOpen { appNav.jobsSearchText = "" }
                               }
                           }))
            ]
            if appState.can(.editJobs) {
                // Alone: the cluster looks at the jobs list, this MAKES a job —
                // the same split as Messages' compose.
                pills.append(HeaderPill(
                    slot: .addJob, content: .icon(.plus), style: .prominent,
                    action: .tap({ appNav.showAddJob = true })))
            }
            return HeaderConfig(pills: pills)

        case .hours:
            return HeaderConfig(pills: [
                HeaderPill(slot: .timeOff, content: .label(.cal, "Time Off"),
                           action: .tap({ appNav.openTimeOffPage = true }))
            ])

        case .stats:
            var pills: [HeaderPill] = []
            // Basic: the Employees directory. Worker and week scope Analytics,
            // so they go with it; Admin stays for admins.
            let business = appState.isBusinessTier
            if business, appState.isAdmin {
                pills.append(HeaderPill(slot: .worker, content: .icon(.person),
                                        action: .menu(.worker)))
            }
            if business {
                pills.append(HeaderPill(slot: .week, content: .icon(.cal), action: .menu(.week)))
            }
            if appState.isAdmin {
                // Alone: Admin goes somewhere else entirely, where worker and
                // week both scope THIS page.
                pills.append(HeaderPill(slot: .admin, content: .icon(.admin),
                                        style: .prominent, action: .tap({
                    appNav.showAdmin = true
                })))
            }
            return HeaderConfig(pills: pills)

        case .chat:
            // Nothing while a thread is open: that header is drawn in a separate
            // UIWindow (see OverlayWindowController) and would show through.
            // The WORDMARK goes too — clearing the pills alone left the lockup
            // ghosting through the thread bar's translucency, since the lockup
            // isn't a pill and so isn't governed by the pill list.
            guard appState.activeMessageThread == nil else {
                return HeaderConfig(showsLogo: false)
            }
            if appNav.chatSelectMode {
                return HeaderConfig(pills: [
                    HeaderPill(slot: .selectDelete,
                               content: .deleteCount(appNav.chatSelectedKeys.count),
                               tint: .red.opacity(appNav.chatSelectedKeys.isEmpty ? 0.4 : 1.0),
                               action: .tap({ appNav.showDeleteThreads = true })),
                    // `.prominent` — a union of one, and past `mergeDistance`
                    // from the cluster, so Done keeps its own capsule instead of
                    // fusing with the trash beside it. Fused, the pair took the
                    // trash's red tint across both halves and read as one red
                    // pill: "Done" looked like part of the delete button.
                    HeaderPill(slot: .selectDone, content: .text("Done"),
                               style: .prominent, action: .tap({
                        withAnimation(.easeInOut(duration: 0.2)) {
                            appNav.chatSelectMode = false
                            appNav.chatSelectedKeys = []
                        }
                    }))
                ])
            }
            return HeaderConfig(pills: [
                HeaderPill(slot: .search, content: .icon(.search), action: .tap({
                    withAnimation(.easeInOut(duration: 0.18)) {
                        appNav.chatSearchOpen.toggle()
                        if !appNav.chatSearchOpen { appNav.chatSearchText = "" }
                    }
                })),
                HeaderPill(slot: .filter, content: .icon(.filter), action: .menu(.filter)),
                // Alone: search and filter narrow what you're looking at,
                // compose MAKES something.
                HeaderPill(slot: .compose, content: .icon(.plus),
                           style: .prominent, action: .tap({
                    appNav.modalBlur = true
                    // Animations off, so the cover doesn't slide up from the
                    // bottom — NewMessageSheet springs in at the centre itself.
                    withTransaction(Transaction.noAnimation) { appNav.showNewMessage = true }
                }))
            ])
        }
    }
}

// MARK: - Tab host
//
// Owns the TabView and, critically, the `appNav.selected` read. Everything that
// does NOT need to change when you switch tabs — the unread badge, the floating
// pill, the loading overlay, the color scheme — stays in MainTabView, which now
// keeps its body out of the tap path entirely.

private struct TabHost: View {
    @Environment(AppNav.self) private var appNav
    /// Read for the tier (the fourth tab's page and label) and the unread badge.
    @Environment(AppState.self) private var appState
    @Environment(\.displayScale) private var displayScale

    /// Pages used to reserve the floating pill's height here. The native tab bar
    /// insets the safe area itself, so this now only collapses with the bar.
    @ViewBuilder
    private func reserveBar<Content: View>(_ content: Content) -> some View {
        content.safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: appNav.hideTabBar ? 0 : tabPillBottomInset)
        }
    }

    /// The native tab item: the traced TRAQS glyph as a template image (so the
    /// system tints it like an SF Symbol) and the tab's name.
    private func item(_ tab: TTab) -> some View {
        let business = appState.isBusinessTier
        return Label {
            Text(tab.label(business: business))
        } icon: {
            TabBarGlyph.image(tab.icon(business: business), scale: displayScale)
        }
    }

    /// Shown on every tab, hidden together when a page asks (a message thread,
    /// the PIN pad).
    private var barVisibility: Visibility { appNav.hideTabBar ? .hidden : .visible }

    var body: some View {
        // Native TabView with Apple's OWN tab bar (2026-10-08): its Liquid Glass
        // bar and selection highlighter replace the custom TRAQS pill. Each tab
        // is built once and kept alive; the other tabs are not re-evaluated on a
        // switch.
        //
        // The selection is written inside an animation because the header's
        // glass morph interpolates on it — an unanimated write just swaps the
        // header controls (§10 step 8).
        return TabView(selection: Binding(
            get: { appNav.selected },
            set: { new in withAnimation(.bouncy(duration: 0.4, extraBounce: 0.05)) { appNav.selected = new } }
        )) {
            // In bar order: Jobs · Time Clock · Home · Messages · Stats.
            JobsHubView()                           // reserves bar space inside its own NavigationStack
                .tabItem { item(.jobs) }.tag(TTab.jobs)
                .toolbar(barVisibility, for: .tabBar)
            reserveBar(TimeClockView())
                .tabItem { item(.hours) }.tag(TTab.hours)
                .toolbar(barVisibility, for: .tabBar)
            reserveBar(HomeView())
                .tabItem { item(.home) }.tag(TTab.home)
                .toolbar(barVisibility, for: .tabBar)
            MessagesView()                          // reserves bar space inside its own NavigationStack
                .tabItem { item(.chat) }.tag(TTab.chat)
                .badge(appState.totalUnreadMessages)
                .toolbar(barVisibility, for: .tabBar)
            Group {
                if appState.isBusinessTier { reserveBar(MoreView()) } else { reserveBar(EmployeesView()) }
            }
            .tabItem { item(.stats) }.tag(TTab.stats)
            .toolbar(barVisibility, for: .tabBar)
        }
    }
}

/// The traced nav glyphs (Icons.swift) rendered once to template images, because
/// a native tab item takes an Image, not a view. Cached per glyph and scale.
@MainActor
private enum TabBarGlyph {
    private static var cache: [String: Image] = [:]

    static func image(_ icon: TIcon, scale: CGFloat) -> Image {
        let key = "\(icon)@\(scale)"
        if let hit = cache[key] { return hit }
        let renderer = ImageRenderer(content:
            TIconView(icon: icon, size: 24, color: .black, weight: .regular)
                .frame(width: 28, height: 28))
        renderer.scale = scale
        let image = renderer.uiImage.map { Image(uiImage: $0.withRenderingMode(.alwaysTemplate)) }
            ?? Image(systemName: "circle")
        cache[key] = image
        return image
    }
}

// MARK: - TRAQS floating tab bar
// Icon-only pill in the app's frosted-glass language: an ultra-thin frost under
// a preset-driven tint, an ambient float shadow, and a soft accent glow bleeding
// out behind it. Flattens to an opaque pill with the Customize toggle. Order:
// Jobs · Time Clock · Home · Messages · Stats.

/// Display order of the bar (independent of TTab's raw values):
/// Jobs · Time Clock · Home · Messages · Stats.

/// Bottom space every page reserves so its content ends at the TOP of the
/// floating nav pill (not the physical screen bottom). Applied by MainTabView
/// for non-NavigationStack tabs, and INSIDE the NavigationStack for the Jobs &
/// Messages tabs (a NavigationStack absorbs an outer safe-area inset).
// Space pages reserve at the bottom so their last row clears the floating tab
// pill. Tracks the bar's outer height — if the bar shrinks and this doesn't,
// every page just gains dead space at the end of its scroll.
let tabPillBottomInset: CGFloat = 0   // the native tab bar insets the safe area itself

// NO `headerTopInset` any more. A modal used to reserve the header's band so
// the keyboard couldn't lift it underneath the header; the band cost it 94pt of
// the little height it had left with the pad up. Modals that need to clear the
// header are rendered ABOVE it instead — see the availability popup in `body`.

// MARK: - Jobs view-mode toggle (header pill)
// Sits between the search/calendar button and the approval-queue button on the
// Jobs tab. Names the CURRENT view — "List" with horizontal lines, "Gantt" with
// staggered horizontal bars — and flips the mode when tapped. A labelled pill
// rather than a bare glyph because the two icons alone didn't say which way the
// tap would go.

struct JobsViewToggleButton: View {
    @Environment(AppNav.self) private var appNav

    /// Fixed, and sized for the WIDER label. The Jobs header is deliberately
    /// dead-stable across a mode flip — see the search button in JobsHubView,
    /// which fades in place rather than being inserted — so the pill must not
    /// change width when the label does.
    ///
    /// 62 is a measured budget, not a guess. The Jobs header spends 127.5pt on the
    /// logo lockup and 143pt on its other controls (search + approvals + divider +
    /// availability + gaps), leaving ~70pt on a 393pt screen once the 16pt side
    /// padding and two 10pt HStack gaps are paid. "Gantt" is 31.3pt in DM Sans Bold
    /// 11, so glyph 13 + gap 4 + label = 48.3 of content and ~7pt each side.
    ///
    /// This was 82 for one commit, which overran that budget by 11.5pt — and the
    /// wordmark was the only compressible thing in the row, so the logo shrank
    /// app-wide. Anything added to this header needs the same arithmetic.
    private static let pillWidth: CGFloat = 62

    var body: some View {
        let isList = appNav.jobsMode == .list
        Button {
            // No withAnimation here: it would animate the HEADER's layout change
            // (the search button appearing/disappearing), jiggling the header +
            // title. The content crossfade is driven by the ZStack's own
            // .animation(value: jobsMode) in JobsHubView, so the header stays
            // completely static while only the list/gantt content fades.
            appNav.jobsMode.toggle()
        } label: {
            HeaderGlassPill(width: Self.pillWidth) {
                HStack(spacing: 4) {
                    TIconView(icon: isList ? .list : .gantt, size: 13)
                    Text(isList ? "List" : "Gantt")
                        .font(TTypo.xsBold(11))
                        .foregroundStyle(Color(hex: T.ink))
                        .fixedSize()
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isList ? "Showing list. Switch to gantt." : "Showing gantt. Switch to list.")
    }
}

// MARK: - Worker shift status
// Derived from the person's shift time-clock (activeClockIn + its lunch/break
// events). Shown as a TagPill (e.g. on the Home screen) so people see their
// current state.

/// `ShiftStatus` lives in Services/NavigationTypes — AppState computes it.
extension ShiftStatus {
    var kind: TagKind {
        switch self {
        case .offline:   return .neutral
        case .clockedIn: return .green
        case .lunch:     return .indigo
        case .onBreak:   return .amber
        }
    }
}
