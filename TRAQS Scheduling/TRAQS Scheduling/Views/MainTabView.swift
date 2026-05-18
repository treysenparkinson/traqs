import SwiftUI

// MARK: - TRAQS Tabs (driven by AppNav + a swipeable side drawer)
// Swipe from the left edge → drawer opens.
// Swipe leftward while open (or tap the scrim / X) → drawer closes.

enum TTab: Int, CaseIterable, Hashable {
    case jobs, schedule, hours, stats, chat

    var label: String {
        switch self {
        case .jobs:     return "Jobs"
        case .schedule: return "Schedule"
        case .hours:    return "Hours"
        case .stats:    return "Stats"
        case .chat:     return "Chat"
        }
    }
    var icon: TIcon {
        switch self {
        case .jobs:     return .jobs
        case .schedule: return .schedule
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
    @State private var dragOffset: CGFloat = 0          // additive offset during a live drag
    @State private var isDragging: Bool = false
    @State private var showSettings: Bool = false

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
                case .jobs:     TasksView()
                case .schedule: GanttView()
                case .hours:    TimeClockView()
                case .stats:    MoreView()
                case .chat:     MessagesView()
                }
            }
            .id(appNav.selected)
            .transition(.opacity)
            .allowsHitTesting(progress < 0.05)   // disable taps under the drawer while open

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
                     })
                .offset(x: drawerX)
                .zIndex(2)
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .preferredColorScheme(.light)
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

struct TRAQSMenuButton: View {
    @Environment(AppNav.self) private var appNav

    var body: some View {
        Button {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.92)) {
                appNav.isMenuOpen.toggle()
            }
        } label: {
            VStack(spacing: 4) {
                Capsule().fill(Color(hex: T.ink)).frame(width: 18, height: 2)
                Capsule().fill(Color(hex: T.ink)).frame(width: 18, height: 2)
                Capsule().fill(Color(hex: T.ink)).frame(width: 18, height: 2)
            }
            .frame(width: 32, height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Side Menu (left drawer)

private struct SideMenu: View {
    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState
    @Environment(AuthManager.self) private var auth
    let close: () -> Void
    let openSettings: () -> Void

    private var person: Person? { appState.currentPerson }
    private var initials: String {
        let parts = (person?.name ?? "—")
            .split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
        return parts.joined()
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                // Header inside the drawer — wordmark + close
                HStack {
                    TRAQSWordmark(size: 30)
                    Spacer()
                    Button { close() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(Color(hex: T.surface)))
                            .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 24)

                // Tab list — Settings sits directly below Chat
                VStack(spacing: 4) {
                    ForEach(TTab.allCases, id: \.self) { tab in
                        SideMenuRow(icon: tab.icon,
                                    label: tab.label,
                                    isOn: appNav.selected == tab) {
                            withAnimation(.easeInOut(duration: 0.22)) {
                                appNav.selected = tab
                            }
                            close()
                        }
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
                              email: person?.email,
                              onLogout: {
                                  auth.logout()
                                  close()
                              })
                    .padding(.horizontal, 20)
                    .padding(.bottom, 28)
            }
            .frame(width: drawerWidth)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Color(hex: T.surface))
            .overlay(alignment: .trailing) {
                Rectangle().fill(Color(hex: T.hair)).frame(width: 1)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 22, x: 4, y: 0)

            Spacer(minLength: 0)
        }
    }
}

// MARK: - One side-menu row

private struct SideMenuRow: View {
    let icon: TIcon
    let label: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Capsule()
                        .fill(isOn ? Color(hex: T.sky).opacity(0.16) : .clear)
                        .frame(width: 36, height: 28)
                    if isOn {
                        Capsule()
                            .stroke(Color(hex: T.sky).opacity(0.24), lineWidth: 1)
                            .frame(width: 36, height: 28)
                    }
                    TIconView(icon: icon, size: 18,
                              color: isOn ? Color(hex: T.sky) : Color(hex: T.muted),
                              weight: isOn ? .semibold : .regular)
                }
                Text(label)
                    .font(.custom(isOn ? TFontName.bold.rawValue : TFontName.medium.rawValue, size: 15))
                    .foregroundStyle(isOn ? Color(hex: T.ink) : Color(hex: T.muted))
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous)
                    .fill(isOn ? Color(hex: T.sky).opacity(0.06) : .clear)
            )
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.18), value: isOn)
    }
}

// MARK: - Profile + Logout footer (drawer, no card border — clean row)

private struct ProfileFooter: View {
    let initials: String
    let name: String
    let email: String?
    let onLogout: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Avatar(initials: initials, size: 38, fill: Color(hex: T.magenta))

            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(TTypo.smBold(13))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                if let email, !email.isEmpty {
                    Text(email)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer(minLength: 4)

            Button(action: onLogout) {
                TIconView(icon: .signOut, size: 14,
                          color: Color(hex: T.red),
                          weight: .semibold)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Color(hex: T.red).opacity(0.10)))
                    .overlay(Circle().stroke(Color(hex: T.red).opacity(0.30), lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }
}
