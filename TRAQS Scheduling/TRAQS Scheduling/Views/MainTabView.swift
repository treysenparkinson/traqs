import SwiftUI

// MARK: - TRAQS Tabs (driven by AppNav + a swipeable side drawer)
// Swipe from the left edge → drawer opens.
// Swipe leftward while open (or tap the scrim / X) → drawer closes.

enum TTab: Int, CaseIterable, Hashable {
    // Home is the default landing tab (a daily debrief). The Jobs tab subsumes
    // the old Schedule tab: it toggles between list and gantt via `AppNav.jobsMode`.
    case home, jobs, hours, stats, chat

    var label: String {
        switch self {
        case .home:     return "Home"
        case .jobs:     return "Jobs"
        case .hours:    return "Hours"
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

private let drawerWidth: CGFloat = 268
private let edgeGrabZone: CGFloat = 24      // px from the leading edge that initiates an open swipe

struct MainTabView: View {
    @Environment(AppNav.self) private var appNav
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var dragOffset: CGFloat = 0          // additive offset during a live drag
    @State private var isDragging: Bool = false
    @State private var showSettings: Bool = false
    @State private var showAdmin: Bool = false
    @State private var showTimeOff: Bool = false

    /// Current X position of the drawer's leading edge.
    /// -drawerWidth = fully closed (off-screen left). 0 = fully open.
    private var drawerX: CGFloat {
        let base: CGFloat = appNav.isMenuOpen ? 0 : -drawerWidth
        return max(-drawerWidth, min(0, base + dragOffset))
    }

    /// 0 (closed) ... 1 (open) — drives backdrop opacity in lockstep with the drawer.
    private var progress: Double {
        Double((drawerX + drawerWidth) / drawerWidth)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            Color(hex: T.bg).ignoresSafeArea()

            // Tab content
            Group {
                switch appNav.selected {
                case .home:     HomeView()
                // Merged Jobs tab: JobsHubView owns the shared header and
                // cross-fades its body between the list and gantt views.
                case .jobs:     JobsHubView()
                case .hours:    TimeClockView()
                case .stats:    MoreView()
                case .chat:     MessagesView()
                }
            }
            .id(appNav.selected)
            .transition(.opacity)
            .allowsHitTesting(progress < 0.05)   // disable taps under the drawer while open
            // Phase 6: subtle sync-status indicator, just below the nav header.
            // Renders nothing when healthy; a small dot on offline/reconnect/error.
            .overlay(alignment: .top) {
                SyncStatusDot()
                    .padding(.top, 52)
                    .allowsHitTesting(progress < 0.05)
            }

            // Backdrop scrim — opacity follows the drag in real time
            Color.black
                .opacity(0.28 * progress)
                .ignoresSafeArea()
                .onTapGesture { closeMenu() }
                .allowsHitTesting(progress > 0.05)
                .zIndex(1)

            // Drawer — always mounted, offset off-screen when closed
            SideMenu(close: closeMenu,
                     openSettings: {
                         closeMenu()
                         // Brief delay so the drawer's close animation reads
                         // before the settings sheet pushes in.
                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                             showSettings = true
                         }
                     },
                     openAdmin: {
                         closeMenu()
                         DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                             showAdmin = true
                         }
                     })
                .offset(x: drawerX)
                .zIndex(2)
        }
        // Modal sub-pages support a left-edge swipe to go back (dismiss), matching
        // the native back-swipe elsewhere.
        .sheet(isPresented: $showSettings) {
            SettingsView().edgeSwipeBack { showSettings = false }
        }
        .fullScreenCover(isPresented: $showAdmin) {
            AdminView().edgeSwipeBack { showAdmin = false }
        }
        .fullScreenCover(isPresented: $showTimeOff) {
            TimeOffView().edgeSwipeBack { showTimeOff = false }
        }
        // A tapped time-off push flips appNav.openTimeOffPage → present the
        // Time Off page and reset the flag so it fires once. `initial: true`
        // also catches a cold-start tap where the flag is already set.
        .onChange(of: appNav.openTimeOffPage, initial: true) { _, open in
            if open {
                showTimeOff = true
                appNav.openTimeOffPage = false
            }
        }
        .preferredColorScheme(themeSettings.isLightTheme ? .light : .dark)
        .animation(.easeInOut(duration: 0.22), value: appNav.selected)
        .animation(isDragging ? nil
                              : .spring(response: 0.32, dampingFraction: 0.92),
                   value: drawerX)
        .gesture(
            DragGesture(minimumDistance: 8, coordinateSpace: .global)
                .onChanged { value in
                    // Only engage if:
                    //   - the drag started within the leading-edge grab zone (closed → open), OR
                    //   - the drawer is already open (open → close)
                    if !isDragging {
                        let fromEdge = value.startLocation.x <= edgeGrabZone
                        guard fromEdge || appNav.isMenuOpen else { return }
                        isDragging = true
                    }
                    dragOffset = value.translation.width
                }
                .onEnded { value in
                    guard isDragging else { return }
                    isDragging = false

                    let velocity = value.predictedEndTranslation.width - value.translation.width
                    let projected = drawerX + velocity * 0.25

                    // Snap by velocity-projected halfway point.
                    let wantsOpen = projected > -drawerWidth / 2
                    appNav.isMenuOpen = wantsOpen
                    dragOffset = 0
                }
        )
    }

    private func closeMenu() {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.92)) {
            appNav.isMenuOpen = false
            dragOffset = 0
        }
    }
}

// MARK: - Hamburger (used inside TRAQSNavHeader's leading slot)

// MARK: - TRAQS bars mark
// The four stacked bars from the app icon, drawn natively (thin lines) so they
// stay crisp at any size and follow the theme. Three neutral ink lines + one
// accent line — the icon's blue bar — which tracks the app accent so the button
// speaks the same design language as the rest of the app. Bar widths mirror the
// icon's proportions (0.55 / 0.79 / 1.0 / 0.45), accent on the 3rd/widest bar.
struct TRAQSBarsMark: View {
    var width: CGFloat = 24
    var barHeight: CGFloat = 2.5
    var spacing: CGFloat = 3.75

    private let ratios: [CGFloat] = [0.55, 0.79, 1.0, 0.45]
    private let accentIndex = 2

    // Compact stack height = 4·barHeight + 3·spacing = 21.25pt. The header wordmark
    // rides a little larger than this by design (see TRAQSNavHeader).
    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(ratios.indices, id: \.self) { i in
                Capsule()
                    .fill(Color(hex: i == accentIndex ? T.accent : T.ink))
                    .frame(width: width * ratios[i], height: barHeight)
            }
        }
    }
}

struct TRAQSMenuButton: View {
    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState

    var body: some View {
        Button {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.92)) {
                appNav.isMenuOpen.toggle()
            }
        } label: {
            TRAQSBarsMark()
            .frame(width: 32, height: 32)
            .contentShape(Rectangle())
            // Missed-notification indicator: a pulsing red dot on the corner.
            .overlay(alignment: .topTrailing) {
                if appState.hasUnreadNotifications {
                    PulsingDot().offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Pulsing notification dot
// A red dot with an expanding halo ring that pulses to draw the eye. Used on the
// sidebar/hamburger button when there are missed notifications.
struct PulsingDot: View {
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(hex: T.red).opacity(0.5))
                .frame(width: 9, height: 9)
                .scaleEffect(pulse ? 2.2 : 1)
                .opacity(pulse ? 0 : 0.6)
            Circle()
                .fill(Color(hex: T.red))
                .frame(width: 9, height: 9)
                .overlay(Circle().stroke(.white.opacity(0.9), lineWidth: 1.5))
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.3).repeatForever(autoreverses: false)) { pulse = true }
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
            withAnimation(.easeInOut(duration: 0.22)) {
                appNav.jobsMode.toggle()
            }
        }
    }
}

// MARK: - Side Menu (left drawer)

private struct SideMenu: View {
    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    @Environment(ThemeSettings.self) private var themeSettings
    let close: () -> Void
    let openSettings: () -> Void
    let openAdmin: () -> Void

    private var person: Person? { appState.currentPerson }
    private var initials: String {
        let parts = (person?.name ?? "—")
            .split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
        return parts.joined()
    }

    private var orgInitial: String {
        String(appState.orgName.prefix(1)).uppercased()
    }

    /// Current user's shift status — single source of truth on AppState
    /// (shared with the Home screen).
    private var shiftStatus: ShiftStatus { appState.myShiftStatus }

    /// Salaried employees don't punch a clock, so hide the Hours tab for them.
    private var visibleTabs: [TTab] {
        let salary = appState.currentPerson?.isSalary ?? false
        return TTab.allCases.filter { !(salary && $0 == .hours) }
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                // Header inside the drawer — just the (larger) wordmark, its
                // left edge aligned with the nav buttons below (which sit at a
                // 12pt inset via the tab list's horizontal padding).
                HStack {
                    TRAQSWordmark(size: 64)
                    Spacer()
                }
                .padding(.leading, 12)
                .padding(.trailing, 20)
                .padding(.top, 24)
                .padding(.bottom, 18)

                // Org card — gradient avatar + org name + plan/subtitle.
                HStack(spacing: 12) {
                    Avatar(initials: orgInitial.isEmpty ? "—" : orgInitial,
                           size: 44, gradient: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(appState.orgName.isEmpty ? "TRAQS" : appState.orgName)
                            .font(.custom(TFontName.bold.rawValue, size: 14))
                            .foregroundStyle(Color(hex: T.ink))
                            .lineLimit(1)
                            .truncationMode(.tail)
                        if let role = person?.role, !role.isEmpty {
                            Text(role)
                                .font(TTypo.xs(11))
                                .foregroundStyle(Color(hex: T.muted))
                                .tLabel(tracking: 0.8)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 18)

                // Divider — separates the org card from the nav list.
                Rectangle()
                    .fill(Color(hex: T.hair))
                    .frame(height: 1)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 16)

                // Tab list — primary wireframe tabs (Hours hidden for salary).
                VStack(spacing: 4) {
                    ForEach(visibleTabs, id: \.self) { tab in
                        SideMenuRow(icon: tab.icon,
                                    label: tab.label,
                                    isOn: appNav.selected == tab,
                                    badge: tab == .chat ? appState.totalUnreadMessages : 0) {
                            withAnimation(.easeInOut(duration: 0.22)) {
                                appNav.selected = tab
                            }
                            close()
                        }
                    }
                }
                .padding(.horizontal, 12)

                // Subtle divider — separates Settings from the wireframe tabs.
                Rectangle()
                    .fill(Color(hex: T.hair))
                    .frame(height: 1)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)

                VStack(spacing: 4) {
                    // Time Off moved to a button on the Hours page's header.
                    if appState.isAdmin {
                        SideMenuRow(icon: .admin,
                                    label: "Admin",
                                    isOn: false,
                                    action: openAdmin)
                    }
                    SideMenuRow(icon: .settings,
                                label: "Settings",
                                isOn: false,
                                action: openSettings)
                }
                .padding(.horizontal, 12)

                Spacer()

                // Profile + logout footer (no card border — clean row)
                ProfileFooter(initials: initials,
                              name: person?.name ?? "—",
                              status: shiftStatus,
                              imageData: person?.image,
                              onLogout: {
                                  auth.logout()
                                  close()
                              })
                    .padding(.horizontal, 20)
                    .padding(.bottom, 28)
            }
            .frame(width: drawerWidth)
            .frame(maxHeight: .infinity, alignment: .top)
            // Full-bleed drawer: fill the rounded shape itself (extended into the
            // safe area) so the gradient reaches the very top & bottom, flush on
            // the left, with only the two right-hand corners rounded. Filling the
            // shape (rather than clipping a safe-area-sized background) is what
            // keeps the fill and the outline the same size.
            .background {
                let shape = UnevenRoundedRectangle(bottomTrailingRadius: 40,
                                                   topTrailingRadius: 40,
                                                   style: .continuous)
                ZStack {
                    shape.fill(themeSettings.isLightTheme
                               ? LinearGradient(colors: [Color(hex: T.bgGradTop), Color(hex: T.surface)],
                                                startPoint: .top, endPoint: .bottom)
                               : LinearGradient(colors: [Color(hex: "#2C2C2E"), Color(hex: "#000000")],
                                                startPoint: .top, endPoint: .bottom))
                    if themeSettings.isLightTheme {
                        GlowBlob(size: T.glowSize * 0.9, opacity: T.glowOpacity * 0.7)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .offset(x: -40, y: 160)
                            .clipShape(shape)
                    }
                    shape.strokeBorder(
                        LinearGradient(colors: [Color(hex: T.highlightStroke).opacity(0.5),
                                                Color(hex: T.hair)],
                                       startPoint: .top, endPoint: .bottom),
                        lineWidth: 1)
                }
                .ignoresSafeArea()
                .shadow(color: Color.black.opacity(0.18), radius: 24, x: 6, y: 0)
            }

            Spacer(minLength: 0)
        }
    }
}

// MARK: - One side-menu row

private struct SideMenuRow: View {
    let icon: TIcon
    let label: String
    let isOn: Bool
    var badge: Int = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                TIconView(icon: icon, size: 19,
                          color: isOn ? .white : Color(hex: T.muted),
                          weight: isOn ? .semibold : .regular)
                    .frame(width: 22)
                Text(label)
                    .font(.custom(isOn ? TFontName.bold.rawValue : TFontName.medium.rawValue, size: 16))
                    .foregroundStyle(isOn ? .white : Color(hex: T.muted))
                Spacer(minLength: 0)
                if badge > 0 {
                    Text(badge > 99 ? "99+" : "\(badge)")
                        .font(.custom(TFontName.bold.rawValue, size: 12))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color(hex: T.red)))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Capsule())
            .background {
                // Active row → full-width indigo→magenta gradient pill + CTA glow.
                // Inactive rows stay transparent (muted glyph + label).
                if isOn {
                    Capsule()
                        .fill(T.brandGradient())
                        .shadow(color: Color(hex: T.ctaGlowColor).opacity(T.ctaGlowOpacity),
                                radius: T.ctaGlowRadius, x: 0, y: T.ctaGlowY)
                }
            }
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: isOn)
    }
}

// MARK: - Worker shift status (drawer pill)
// Derived from the person's shift time-clock (activeClockIn + its lunch/break
// events). Shown as a TagPill above the name so people see their current state.

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

// MARK: - Profile + Logout footer (drawer, no card border — clean row)

private struct ProfileFooter: View {
    let initials: String
    let name: String
    let status: ShiftStatus
    var imageData: String? = nil
    let onLogout: () -> Void

    var body: some View {
        // Bottom-align the avatar with the text so the status + name sit lower,
        // riding the avatar's baseline rather than floating at its center.
        HStack(alignment: .bottom, spacing: 12) {
            Avatar(initials: initials, size: 40, gradient: true, imageData: imageData)

            // Status pill directly above the name — one tight, left-aligned
            // unit. Email lives in Settings now, so it's dropped here.
            VStack(alignment: .leading, spacing: 3) {
                TagPill(label: status.label, kind: status.kind, dot: status.dot)
                Text(name)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            Button(action: onLogout) {
                TIconView(icon: .signOut, size: 15,
                          color: Color(hex: T.red),
                          weight: .semibold)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Color(hex: T.red).opacity(0.10)))
                    .overlay(Circle().stroke(Color(hex: T.red).opacity(0.30), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }
}
