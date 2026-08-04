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
        case .stats:    return "Analytics"
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
        return ZStack(alignment: .bottom) {
            Color(hex: T.bg).ignoresSafeArea()

            // The TabView lives in its own view so that the SELECTION read is
            // scoped to it. Held inline here, a tab change invalidated
            // MainTabView's whole body — which recomputed the unread badge and
            // rebuilt the modifier chain around all five tabs on every tap.
            TabHost()
                // Phase 6: subtle sync-status indicator, just below the nav header.
                .overlay(alignment: .top) {
                    SyncStatusDot().padding(.top, 52)
                }

            // TRAQS frosted floating pill (icon-only).
            if !appNav.hideTabBar {
                TRAQSTabBar()
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

// MARK: - Tab host
//
// Owns the TabView and, critically, the `appNav.selected` read. Everything that
// does NOT need to change when you switch tabs — the unread badge, the floating
// pill, the loading overlay, the color scheme — stays in MainTabView, which now
// keeps its body out of the tap path entirely.

private struct TabHost: View {
    @Environment(AppNav.self) private var appNav

    /// Reserves bottom space so a page's content ends at the TOP of the floating
    /// nav pill. Used by Home/TimeClock/Stats — the tabs without their own
    /// NavigationStack (Jobs/Messages reserve it inside their stacks). Collapses
    /// while the bar is hidden (e.g. inside a message thread).
    @ViewBuilder
    private func reserveBar<Content: View>(_ content: Content) -> some View {
        content.safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: appNav.hideTabBar ? 0 : tabPillBottomInset)
        }
    }

    var body: some View {
        // Native TabView backbone: each tab is built once and kept alive, and —
        // crucially — the OTHER tabs are NOT re-evaluated when you switch. The
        // old keep-alive ZStack re-ran all five heavy page bodies on every tap,
        // which was the click→page lag. The system tab bar is hidden; the custom
        // frosted pill drives `selected`.
        return TabView(selection: Binding(get: { appNav.selected }, set: { appNav.selected = $0 })) {
            reserveBar(HomeView()).tag(TTab.home)
                .toolbar(.hidden, for: .tabBar)
            JobsHubView().tag(TTab.jobs)            // reserves pill space inside its own NavigationStack
                .toolbar(.hidden, for: .tabBar)
            reserveBar(TimeClockView()).tag(TTab.hours)
                .toolbar(.hidden, for: .tabBar)
            reserveBar(MoreView()).tag(TTab.stats)
                .toolbar(.hidden, for: .tabBar)
            MessagesView().tag(TTab.chat)           // reserves pill space inside its own NavigationStack
                .toolbar(.hidden, for: .tabBar)
        }
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
    // Reads the selection and the badge count ITSELF rather than taking them
    // from MainTabView. Handing this view a `Binding` to `appNav.selected`
    // attached that dependency to MainTabView's body, so every tap re-ran the
    // parent — which rebuilt the TabView and all five tab structs.
    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var theme

    private var selected: TTab {
        get { appNav.selected }
        nonmutating set { appNav.selected = newValue }
    }
    private var messagesBadge: Int { appState.totalUnreadMessages }

    // Drag-to-select state.
    @State private var dragX: CGFloat? = nil       // finger x while actively dragging (drives label + highlighter)
    @State private var dragStartX: CGFloat? = nil  // where the touch began (nil = no touch down)
    @State private var isDragging = false          // true once the touch moved past the tap threshold

    // Fixed layout — buttons are fixed-width, so the bar width is deterministic
    // and we can map a drag x → tab without measuring.
    private let keyW: CGFloat = 65
    private let keySpacing: CGFloat = 2
    private let hPad: CGFloat = 17.5   // +2.5px each side → bar 5px wider L→R
    private var tabCount: Int { tabBarOrder.count }
    private var barWidth: CGFloat { hPad * 2 + CGFloat(tabCount) * keyW + CGFloat(tabCount - 1) * keySpacing }

    // Accent highlighter size. It's the tallest thing in the bar, so `highlightH`
    // sets the bar's inner height — `vPad` absorbs the difference to keep the
    // pill's outer height fixed at 76pt (highlightH + vPad * 2).
    private let highlightW: CGFloat = 83   // keyW + 18
    private let highlightH: CGFloat = 62

    /// How long the highlighter takes to slide to a tapped tab. The page itself
    /// swaps with no animation, so this is what the eye reads as "how long the
    /// tap took" — keep it short.
    private let highlightSlide: Double = 0.15
    private var vPad: CGFloat { (76 - highlightH) / 2 }

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
            // The ONE accent highlighter. Its slide is animated INDEPENDENTLY of
            // the page: `selected` is set with NO transaction (so the page swaps
            // instantly on tap), and this scoped `.animation` eases only the
            // highlighter's offset toward the new tab. While dragging (dragX set)
            // the animation is disabled so it tracks the finger 1:1.
            Capsule(style: .continuous)
                .fill(Color(hex: T.accent).verticalGradient())
                .shadow(color: Color(hex: T.accent).opacity(0.45), radius: 8, x: 0, y: 3)
                // Slightly larger than a key cell so the active tab reads clearly.
                // The height drives the bar's inner height (icons are only 48
                // tall), so `.padding(.vertical)` below is reduced by the same
                // amount this grows — the pill's outer size never changes.
                .frame(width: highlightW, height: highlightH)
                .offset(x: highlightCenterX - highlightW / 2)
                // PERCEIVED latency, not CPU: the page swaps instantly, so while
                // the highlighter is still travelling the tap reads as "not done
                // yet". Shortened 0.22 → 0.15 and given a faster-departing curve
                // so the indicator arrives closer to when the page does.
                // `highlightSlide` is the dial — raise it for a lazier glide.
                .animation(dragX == nil ? .timingCurve(0.25, 0.0, 0.2, 1.0, duration: highlightSlide) : nil,
                           value: highlightCenterX)

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
        .padding(.vertical, vPad)   // shrinks as the highlighter grows → pill height locked at 76
        // Frosted-glass fill (translucent blur + subtle surface tint) with a FLAT
        // hairline border — the frosted look, minus the glossy reflection.
        // (Measured on device: replacing this whole stack with a plain opaque
        // fill did NOT reduce the per-tap stall, so the blur is not the cost.)
        .background {
            ZStack {
                shape.fill(.ultraThinMaterial)
                // Surface tint eased back from 0.30 so a little more of the page
                // shows through — .ultraThinMaterial is already the thinnest
                // system material, so this tint is the only transparency lever.
                // Don't go much below this or the bar stops reading as frosted.
                shape.fill(Color(hex: T.surface).opacity(0.22))
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
        // the tab under the finger; releasing selects it. (A UIKit touch layer was
        // tried and REGRESSED render time to 50–167ms — its UIView overlay forced
        // an expensive layout/compositing pass against the frosted material every
        // render. The SwiftUI gesture measures ~1ms, so it's the right tool.)
        .contentShape(Capsule())
        .highPriorityGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if dragStartX == nil {
                        dragStartX = value.location.x
                        // Page changes instantly (no animation transaction) — the
                        // highlighter eases independently via its scoped animation.
                        let target = tab(atX: value.location.x)
                        selected = target
                    }
                    if abs(value.location.x - (dragStartX ?? value.location.x)) > 8 {
                        isDragging = true
                    }
                    if isDragging { dragX = value.location.x }
                }
                .onEnded { value in
                    if isDragging {
                        let final = tab(atX: value.location.x)
                        if final != selected { selected = final }
                    }
                    dragX = nil          // instant settle, no slide
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
        // Via TIconView, not a glyph type directly: four of the five tabs are
        // traced from the desktop sidebar and Messages is still an SF Symbol, so
        // the dispatch has to stay in one place. For the traced glyphs the
        // weight becomes a stroke width; for Messages it stays a symbol weight.
        TIconView(icon: tab.icon,
                  size: 23,
                  // Readable on the accent fill when the highlighter is on this
                  // tab; primary ink otherwise.
                  color: isSelected ? T.onAccent : Color(hex: T.ink),
                  weight: isSelected ? .semibold : .regular)
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
