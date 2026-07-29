import SwiftUI

// MARK: - TRAQS Tabs (native Liquid Glass bottom TabView)
// The primary navigation is a native SwiftUI TabView — on iOS 26 its tab bar
// renders as Liquid Glass automatically. Selection is bound to AppNav.selected
// so push-notification deep links (which set `selected`) keep working.

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
        ZStack {
            // Native Liquid Glass tab bar. Order (all 5, for everyone):
            // Home · Jobs · Time Clock · Stats · Messages.
            TabView(selection: Binding(get: { appNav.selected },
                                       set: { appNav.selected = $0 })) {
                Tab(TTab.home.label,  systemImage: TTab.home.icon.sfName,  value: TTab.home)  { HomeView() }
                // Merged Jobs tab: JobsHubView owns the shared header and
                // cross-fades its body between the list and gantt views.
                Tab(TTab.jobs.label,  systemImage: TTab.jobs.icon.sfName,  value: TTab.jobs)  { JobsHubView() }
                Tab(TTab.hours.label, systemImage: TTab.hours.icon.sfName, value: TTab.hours) { TimeClockView() }
                Tab(TTab.stats.label, systemImage: TTab.stats.icon.sfName, value: TTab.stats) { MoreView() }
                Tab(TTab.chat.label,  systemImage: TTab.chat.icon.sfName,  value: TTab.chat)  { MessagesView() }
                    .badge(appState.totalUnreadMessages)
            }

            // Global blocking-action loading overlay (clock in/out). Sits above
            // everything, including the tab bar, so no screen looks frozen while
            // a request is in flight.
            if let label = appState.clockActionLabel {
                TRAQSLoadingOverlay(message: label)
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        // Phase 6: subtle sync-status indicator, just below the nav header.
        // Renders nothing when healthy; a small dot on offline/reconnect/error.
        .overlay(alignment: .top) {
            SyncStatusDot()
                .padding(.top, 52)
        }
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
        .animation(.easeInOut(duration: 0.22), value: appNav.selected)
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
