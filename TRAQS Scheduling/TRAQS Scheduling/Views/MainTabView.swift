import SwiftUI

// MARK: - TRAQS Tabs (custom frosted floating pill)
// The primary navigation is a bespoke TRAQS frosted-glass pill — icon-only,
// glowy, floating above the content. Selection is bound to AppNav.selected so
// push-notification deep links (which set `selected`) keep working.

enum TTab: Int, CaseIterable, Hashable {
    // Home is the default landing tab (a daily debrief). The Jobs tab subsumes
    // the old Schedule tab: it toggles between list and gantt via `AppNav.jobsMode`.
    case home, jobs, hours, stats, chat

    var label: String {
        switch self {
        case .home:     return "Home"
        case .jobs:     return "Jobs"
        case .hours:    return "Time Clock"
        case .stats:    return "Stats"
        case .chat:     return "Messages"
        }
    }
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
    @State private var showTimeOff: Bool = false
    /// Tabs mounted so far — a tab is added on first visit and then kept alive
    /// (lazy mount + keep-alive, like the native tab bar) so re-selecting it is
    /// instant instead of rebuilding.
    @State private var visited: Set<TTab> = [.home]

    /// One keep-alive tab slot: mounted once visited, shown via opacity. Non-nav
    /// tabs (Home/TimeClock/Stats) reserve space for the floating pill here;
    /// Jobs/Messages already do it inside their own NavigationStacks.
    @ViewBuilder
    private func tabContent<Content: View>(_ tab: TTab, reserveBar: Bool,
                                           @ViewBuilder _ content: () -> Content) -> some View {
        if visited.contains(tab) {
            let isActive = appNav.selected == tab
            Group {
                if reserveBar {
                    content().safeAreaInset(edge: .bottom) {
                        Color.clear.frame(height: appNav.hideTabBar ? 0 : tabPillBottomInset)
                    }
                } else {
                    content()
                }
            }
            .opacity(isActive ? 1 : 0)
            .allowsHitTesting(isActive)
            .zIndex(isActive ? 1 : 0)
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(hex: T.bg).ignoresSafeArea()

            // Keep-alive tab content: each tab MOUNTS on first visit and stays
            // mounted, so switching is INSTANT — the tap no longer waits on a heavy
            // page (NavigationStack / gantt / message list + its .task) rebuilding
            // on the main thread, which was the click→response lag. Visibility
            // cross-fades via opacity.
            ZStack {
                tabContent(.home,  reserveBar: true)  { HomeView() }
                tabContent(.jobs,  reserveBar: false) { JobsHubView() }
                tabContent(.hours, reserveBar: true)  { TimeClockView() }
                tabContent(.stats, reserveBar: true)  { MoreView() }
                tabContent(.chat,  reserveBar: false) { MessagesView() }
            }
            .animation(.easeInOut(duration: 0.14), value: appNav.selected)   // quick page cross-fade (pops in)
            // Phase 6: subtle sync-status indicator, just below the nav header.
            .overlay(alignment: .top) {
                SyncStatusDot().padding(.top, 52)
            }

            // TRAQS frosted floating pill (icon-only).
            if !appNav.hideTabBar {
                TRAQSTabBar(
                    selected: Binding(get: { appNav.selected }, set: { appNav.selected = $0 }),
                    messagesBadge: appState.totalUnreadMessages)
                    .padding(.bottom, 1)
                    .offset(y: 10)   // sit lower toward the bottom edge
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            // Global blocking-action loading overlay (clock in/out). Above all.
            if let label = appState.clockActionLabel {
                TRAQSLoadingOverlay(message: label)
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
        .onChange(of: appNav.openTimeOffPage, initial: true) { _, open in
            if open {
                showTimeOff = true
                appNav.openTimeOffPage = false
            }
        }
        // Mount each tab on first visit and keep it alive thereafter.
        .onChange(of: appNav.selected, initial: true) { _, tab in visited.insert(tab) }
        .preferredColorScheme(themeSettings.isLightTheme ? .light : .dark)
    }
}

// MARK: - TRAQS frosted floating tab bar
// Icon-only pill with the app's frosted-glass language: an ultra-thin frost, a
// brand-surface tint, a top highlight stroke, an ambient float shadow, and a
// soft accent glow bleeding out behind it. Order: Jobs · Time Clock · Home ·
// Messages · Stats.

/// Display order of the bar (independent of TTab's raw values):
/// Jobs · Time Clock · Home · Messages · Stats.
private let tabBarOrder: [TTab] = [.jobs, .hours, .home, .chat, .stats]

/// Bottom space every page reserves so its content ends at the TOP of the
/// floating nav pill (not the physical screen bottom). Applied by MainTabView
/// for non-NavigationStack tabs, and INSIDE the NavigationStack for the Jobs &
/// Messages tabs (a NavigationStack absorbs an outer safe-area inset).
let tabPillBottomInset: CGFloat = 104

struct TRAQSTabBar: View {
    @Binding var selected: TTab
    var messagesBadge: Int
    @Environment(ThemeSettings.self) private var theme

    // Drag-to-select state.
    @State private var dragX: CGFloat? = nil       // finger x while actively dragging (drives label + highlighter)
    @State private var dragStartX: CGFloat? = nil  // where the touch began (nil = no touch down)
    @State private var isDragging = false          // true once the touch moved past the tap threshold

    // Fixed layout — buttons are fixed-width, so the bar width is deterministic
    // and we can map a drag x → tab without measuring.
    private let keyW: CGFloat = 65
    private let keySpacing: CGFloat = 2
    private let hPad: CGFloat = 14
    private var tabCount: Int { tabBarOrder.count }
    private var barWidth: CGFloat { hPad * 2 + CGFloat(tabCount) * keyW + CGFloat(tabCount - 1) * keySpacing }

    /// Map a horizontal position (in the bar's local space) to the tab under it.
    private func tab(atX x: CGFloat) -> TTab {
        let step = keyW + keySpacing
        let idx = Int(((x - hPad + keySpacing / 2) / step).rounded(.down))
        return tabBarOrder[min(max(idx, 0), tabCount - 1)]
    }

    /// Width of the icon row (inside the horizontal padding).
    private var contentWidth: CGFloat { CGFloat(tabCount) * keyW + CGFloat(tabCount - 1) * keySpacing }

    /// Resting center (in the icon row's local space) of a tab.
    private func centerX(of tab: TTab) -> CGFloat {
        let i = tabBarOrder.firstIndex(of: tab) ?? 0
        return CGFloat(i) * (keyW + keySpacing) + keyW / 2
    }

    /// Highlighter center: the finger while dragging (clamped inside the row),
    /// else the selected tab's resting center.
    private var highlightCenterX: CGFloat {
        if let x = dragX {
            return min(max(x - hPad, keyW / 2), contentWidth - keyW / 2)
        }
        return centerX(of: selected)
    }

    /// The tab the highlighter currently sits on (finger's tab while dragging,
    /// else the selection) — drives which icon reads as active.
    private var highlightedTab: TTab {
        if let x = dragX { return tab(atX: x) }
        return selected
    }

    var body: some View {
        // Touch the theme so a live Customize accent/background change re-renders
        // the frost immediately (T.* tokens aren't observable on their own).
        _ = theme.accent; _ = theme.bgPresetId
        let shape = Capsule(style: .continuous)

        return ZStack(alignment: .leading) {
            // The ONE accent highlighter — its center follows the finger while
            // dragging (no animation → 1:1 tracking), otherwise rests on the
            // selected tab. `.offset` only animates on release (see onEnded).
            Capsule(style: .continuous)
                .fill(Color(hex: T.accent).verticalGradient())
                .shadow(color: Color(hex: T.accent).opacity(0.45), radius: 8, x: 0, y: 3)
                .frame(width: keyW - 4, height: 44)
                .offset(x: highlightCenterX - (keyW - 4) / 2)

            HStack(spacing: keySpacing) {
                ForEach(tabBarOrder, id: \.self) { tab in
                    TabBarIcon(tab: tab,
                               isSelected: highlightedTab == tab,
                               badge: tab == .chat ? messagesBadge : 0,
                               keyW: keyW)
                }
            }
        }
        .padding(.horizontal, hPad)
        .padding(.vertical, 13)
        // Frosted-glass fill (translucent blur + subtle surface tint) with a FLAT
        // hairline border — the frosted look, minus the glossy reflection.
        .background {
            ZStack {
                shape.fill(.ultraThinMaterial)
                shape.fill(Color(hex: T.surface).opacity(0.30))
            }
        }
        .overlay(shape.strokeBorder(Color(hex: T.border), lineWidth: 1))
        .compositingGroup()
        .shadow(color: .black.opacity(T.ambientShadowOpacity),
                radius: T.ambientShadowRadius, x: 0, y: T.ambientShadowY)
        // Floating "which page" label that tracks the finger while dragging.
        .overlay(alignment: .top) {
            if let x = dragX {
                Text(tab(atX: x).label)
                    .font(.custom(TFontName.bold.rawValue, size: 13))
                    .foregroundStyle(Color(hex: T.ink))
                    .fixedSize()
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .glassEffect(.regular, in: Capsule())
                    // Center on the finger, clamped so it stays over the bar.
                    .offset(x: min(max(x - barWidth / 2, -(barWidth / 2 - 46)), barWidth / 2 - 46),
                            y: -50)
                    .allowsHitTesting(false)
                    .transition(.opacity.combined(with: .scale(scale: 0.85, anchor: .bottom)))
            }
        }
        // Tap OR press-and-slide anywhere on the pill: the highlighter follows to
        // the tab under the finger; releasing selects it.
        .contentShape(Capsule())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    // TOUCH-DOWN: commit the page IMMEDIATELY — the transition to the
                    // pressed tab starts now, no waiting for finger-up. The page's own
                    // fade (content .animation, 0.22) runs independently of the
                    // highlighter's slide, and a fast re-press just cross-fades to the
                    // newest page.
                    if dragStartX == nil {
                        dragStartX = value.location.x
                        // Highlighter slides at its own curve; the page's own fade
                        // (content .animation) starts immediately, independent of it.
                        withAnimation(.timingCurve(0.5, 0.0, 0.2, 1.0, duration: 0.18)) {
                            selected = tab(atX: value.location.x)
                        }
                    }
                    // Past a small threshold it's a real slide → the highlighter +
                    // label follow the finger 1:1. The page is NOT re-committed while
                    // sliding — only on release (below).
                    if abs(value.location.x - (dragStartX ?? value.location.x)) > 8 {
                        isDragging = true
                    }
                    if isDragging { dragX = value.location.x }
                }
                .onEnded { value in
                    // If the user slid to a different tab, commit that on release.
                    let final = tab(atX: value.location.x)
                    if final != selected { selected = final }
                    withAnimation(.timingCurve(0.5, 0.0, 0.2, 1.0, duration: 0.18)) { dragX = nil }
                    dragStartX = nil
                    isDragging = false
                }
        )
        // Haptic as the highlighter crosses onto each tab (preview + release).
        .sensoryFeedback(.selection, trigger: highlightedTab)
    }
}

// Non-interactive icon cell — selection + the highlighter are driven by
// TRAQSTabBar's drag gesture / manual highlighter behind these icons.
private struct TabBarIcon: View {
    let tab: TTab
    let isSelected: Bool
    var badge: Int
    var keyW: CGFloat

    var body: some View {
        Image(systemName: tab.icon.sfName)
            .font(.system(size: 23, weight: isSelected ? .semibold : .regular))
            // Readable on the accent fill when the highlighter is on this tab;
            // primary ink otherwise.
            .foregroundStyle(isSelected ? T.onAccent : Color(hex: T.ink))
            .frame(width: keyW, height: 48)
            .overlay(alignment: .topTrailing) {
                if badge > 0 {
                    Text(badge > 99 ? "99+" : "\(badge)")
                        .font(.custom(TFontName.bold.rawValue, size: 10))
                        .foregroundStyle(T.onColor(T.red))
                        .padding(.horizontal, 5)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(Capsule().fill(Color(hex: T.red)))
                        .offset(x: 6, y: -2)
                        .allowsHitTesting(false)
                }
            }
    }
}

// MARK: - Jobs view-mode toggle (header "dot" button)
// A round icon button that sits between the search/calendar button and the add
// button on the Jobs tab. It shows the icon of the CURRENT view — a list glyph
// in list mode, a gantt glyph in gantt mode — and flips the mode when tapped.

struct JobsViewToggleButton: View {
    @Environment(AppNav.self) private var appNav

    var body: some View {
        IconBtn(icon: appNav.jobsMode == .list ? .list : .gantt, size: 18) {
            // No withAnimation here: it would animate the HEADER's layout change
            // (the search button appearing/disappearing), jiggling the header +
            // title. The content crossfade is driven by the ZStack's own
            // .animation(value: jobsMode) in JobsHubView, so the header stays
            // completely static while only the list/gantt content fades.
            appNav.jobsMode.toggle()
        }
    }
}

// MARK: - Worker shift status
// Derived from the person's shift time-clock (activeClockIn + its lunch/break
// events). Shown as a TagPill (e.g. on the Home screen) so people see their
// current state.

enum ShiftStatus {
    case offline, clockedIn, lunch, onBreak

    var label: String {
        switch self {
        case .offline:   return "Offline"
        case .clockedIn: return "Clocked in"
        case .lunch:     return "Lunch"
        case .onBreak:   return "Break"
        }
    }
    var kind: TagKind {
        switch self {
        case .offline:   return .neutral
        case .clockedIn: return .green
        case .lunch:     return .indigo
        case .onBreak:   return .amber
        }
    }
    var dot: Bool { self != .offline }
}
