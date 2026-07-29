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

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(hex: T.bg).ignoresSafeArea()

            // Selected tab content. Only the active view is mounted (swaps by
            // appNav.selected — set by taps and by push-notification deep links).
            Group {
                switch appNav.selected {
                case .home:  HomeView()
                // Merged Jobs tab: JobsHubView owns the shared header and
                // cross-fades its body between the list and gantt views.
                case .jobs:  JobsHubView()
                case .hours: TimeClockView()
                case .stats: MoreView()
                case .chat:  MessagesView()
                }
            }
            .id(appNav.selected)
            .transition(.opacity)
            // Reserve room at the bottom so scroll content AND bottom-anchored
            // FABs (Jobs / Messages) clear the floating pill (and sit well above
            // it); collapses to 0 when the bar is hidden (inside a message thread).
            .safeAreaInset(edge: .bottom) {
                Color.clear.frame(height: appNav.hideTabBar ? 0 : tabPillBottomInset)
            }
            // Phase 6: subtle sync-status indicator, just below the nav header.
            .overlay(alignment: .top) {
                SyncStatusDot().padding(.top, 52)
            }
            // Content crossfade timing — scoped to the content only so it doesn't
            // fight the tab highlighter's own slide animation.
            .animation(.easeInOut(duration: 0.22), value: appNav.selected)

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
        .preferredColorScheme(themeSettings.isLightTheme ? .light : .dark)
    }
}

// MARK: - TRAQS frosted floating tab bar
// Icon-only pill with the app's frosted-glass language: an ultra-thin frost, a
// brand-surface tint, a top highlight stroke, an ambient float shadow, and a
// soft accent glow bleeding out behind it. Order: Jobs · Messages · Home ·
// Time Clock · Stats.

/// Display order of the bar (independent of TTab's raw values).
private let tabBarOrder: [TTab] = [.jobs, .chat, .home, .hours, .stats]

/// Bottom space every page reserves so its content ends at the TOP of the
/// floating nav pill (not the physical screen bottom). Applied by MainTabView
/// for non-NavigationStack tabs, and INSIDE the NavigationStack for the Jobs &
/// Messages tabs (a NavigationStack absorbs an outer safe-area inset).
let tabPillBottomInset: CGFloat = 104

struct TRAQSTabBar: View {
    @Binding var selected: TTab
    var messagesBadge: Int
    @Environment(ThemeSettings.self) private var theme
    /// Ties the single accent highlighter across buttons so it slides/stretches
    /// from the old tab to the tapped one.
    @Namespace private var highlightNS

    var body: some View {
        // Touch the theme so a live Customize accent/background change re-renders
        // the frost + glow immediately (T.* tokens aren't observable on their own).
        _ = theme.accent; _ = theme.bgPresetId
        let shape = Capsule(style: .continuous)

        return HStack(spacing: 2) {
            ForEach(tabBarOrder, id: \.self) { tab in
                TabBarButton(
                    tab: tab,
                    isSelected: selected == tab,
                    badge: tab == .chat ? messagesBadge : 0,
                    highlightNS: highlightNS,
                    onSelect: {
                        // Quick, smooth glide — fast onset (no slow lead-in) with a
                        // gentle decelerate so it feels responsive, not delayed.
                        withAnimation(.timingCurve(0.4, 0.0, 0.2, 1.0, duration: 0.28)) {
                            selected = tab
                        }
                    })
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .background {
            ZStack {
                // Frost + brand-surface tint (no glow halo).
                shape.fill(.ultraThinMaterial)
                shape.fill(Color(hex: T.surface).opacity(0.30))
            }
        }
        .overlay(
            shape.strokeBorder(
                LinearGradient(colors: [Color(hex: T.highlightStroke).opacity(0.6), .clear],
                               startPoint: .top, endPoint: .bottom),
                lineWidth: 1))
        .compositingGroup()
        .shadow(color: .black.opacity(T.ambientShadowOpacity),
                radius: T.ambientShadowRadius, x: 0, y: T.ambientShadowY)
    }
}

private struct TabBarButton: View {
    let tab: TTab
    let isSelected: Bool
    var badge: Int
    var highlightNS: Namespace.ID
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            Image(systemName: tab.icon.sfName)
                .font(.system(size: 23, weight: isSelected ? .semibold : .regular))
                // Readable on the accent fill when selected; primary ink (black on
                // light / white on dark) otherwise.
                .foregroundStyle(isSelected ? T.onAccent : Color(hex: T.ink))
                .frame(width: 65, height: 48)
                .background {
                    if isSelected {
                        // Full customization-accent highlighter (a gradient of the
                        // chosen accent). The matchedGeometryEffect makes this ONE
                        // pill slide + stretch from the previous tab to this one.
                        Capsule(style: .continuous)
                            .fill(Color(hex: T.accent).verticalGradient())
                            .matchedGeometryEffect(id: "tabHighlight", in: highlightNS)
                            .shadow(color: Color(hex: T.accent).opacity(0.45),
                                    radius: 8, x: 0, y: 3)
                            .padding(2)
                    }
                }
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
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
