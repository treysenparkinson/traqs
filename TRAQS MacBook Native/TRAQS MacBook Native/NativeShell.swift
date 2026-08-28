import SwiftUI

// MARK: - The app shell, copied from the web app
//
// Sidebar on the left, page on the right. Every measurement is lifted from
// TRAQS.jsx rather than chosen: rail 220/64, NAV_PAD 12, 40pt buttons on a 20pt
// radius, a 12pt gap between glyph and label, 13pt labels, 17pt icon slot, and
// the 0.28s cubic-bezier(0.22,1,0.36,1) the rail collapses on. A number in here
// that wasn't copied is a bug.
//
// The ONE intended difference from the web app: the buttons in a PAGE HEADER are
// real Liquid Glass (native `glassEffect` — see GlassControls, not the CSS
// imitation the web view wears in MacNativeSkin, which never touches a native
// view).
//
// THE SIDEBAR IS NOT PART OF THAT. Its buttons are a straight copy of the web's:
// a flat accent-at-18% fill on the active row, no glass, no travelling indicator.

// MARK: Views

enum TView: String, CaseIterable, Identifiable {
    case dashboard, tasks, schedule, employees, timestamp, analytics, clients, messages
    case approvals, admin
    var id: String { rawValue }

    /// Labels exactly as the sidebar spells them — "Jobs", not "Tasks".
    var label: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .tasks:     return "Jobs"
        case .schedule:  return "Schedule"
        case .employees: return "Employees"
        case .timestamp: return "Time Clock"
        case .analytics: return "Analytics"
        case .clients:   return "Clients"
        case .messages:  return "Messages"
        case .approvals: return "Approval Queue"
        case .admin:     return "Admin"
        }
    }

    /// Listed in the sidebar's own order. Approvals and Admin are appended after
    /// these, gated, exactly as the web sidebar appends them.
    static let primary: [TView] = [
        .dashboard, .tasks, .schedule, .employees,
        .timestamp, .analytics, .clients, .messages,
    ]
}

/// The settings sections, from SETTINGS_ORG_CHILDREN and the nav around it.
enum TSettings: String, CaseIterable, Identifiable {
    case general
    case orgGeneral = "org-general"
    case orgDepartments = "org-departments"
    case orgPermissions = "org-permissions"
    case orgSchedule = "org-schedule"
    case orgApprovalTemplates = "org-approval-templates"
    case orgTimeclock = "org-timeclock"
    case customization

    var id: String { rawValue }

    var label: String {
        switch self {
        case .general:              return "General"
        case .orgGeneral:           return "General"
        case .orgDepartments:       return "Departments"
        case .orgPermissions:       return "Worker Permissions"
        case .orgSchedule:          return "Schedule Preferences"
        case .orgApprovalTemplates: return "Approval Queue Templates"
        case .orgTimeclock:         return "Time Clock"
        case .customization:        return "Customization"
        }
    }

    /// The six that live under the collapsible Organization parent.
    static let orgChildren: [TSettings] = [
        .orgGeneral, .orgDepartments, .orgPermissions,
        .orgSchedule, .orgApprovalTemplates, .orgTimeclock,
    ]
}

// MARK: - Shell

struct NativeShell: View {
    @Environment(\.tqTheme) private var theme
    @Environment(AppState.self) private var appState
    /// For the sidebar's log-out button.
    @Environment(AuthManager.self) private var auth

    // Computed, not stored, so the shell TRACKS AppState. The four values these
    // replace were hardcoded defaults — a real person's name and org compiled in
    // and shown to whoever opened the app, with the Approvals and Admin rows
    // permanently visible regardless of permission.
    //
    // Deliberately REMOVED as parameters rather than given defaults: a default is
    // an invitation to pass fiction again.
    private var personName: String { appState.currentPerson?.name ?? "" }
    private var orgName: String { appState.orgName }
    private var isAdmin: Bool { appState.isAdmin }
    private var canSeeApprovals: Bool { appState.canViewApprovalQueue }

    @State private var view: TView = .tasks
    @State private var expanded = true
    /// Settings is a MODE, not a view — the whole nav layer swaps out for it,
    /// which is why it can't just be another `TView` case.
    @State private var settingsMode = false
    @State private var settingsSection: TSettings = .general
    @State private var orgExpanded = false
    @State private var hovered: String?
    @State private var logoutHovering = false
    @State private var confirmLogout = false

    /// The PAGE HEADER cluster's morph identity space — not the sidebar's, which
    /// has no glass and no travelling indicator (see `navRow`).
    ///
    /// Declared HERE, in the shell, and that placement is precondition 1: a
    /// namespace owned by a view that gets rebuilt on a screen change gives the
    /// glass nothing to interpolate between. Unused until a screen has header
    /// controls — the Jobs pass is the first — and it has to already be in the
    /// right place by then. See GlassControls.
    @Namespace private var headerGlass

    private let navPad: CGFloat = 12
    private let iconSlot: CGFloat = 17
    /// The rail's own curve, from the web app's NAV_EASE.
    private let railEase = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.28)
    /// Every COLOUR change on a nav button — hover in, hover out, and the active
    /// row's fill and lettering. From `.tq-sidebar button` in TRAQS.jsx (:1110):
    ///
    ///     background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease
    ///
    /// `timingCurve(0.25, 0.1, 0.25, 1)` IS css `ease` — that keyword is defined as
    /// exactly that cubic-bezier, so this is copied rather than approximated with
    /// `.easeInOut`. Separate from `railEase` because the web states them
    /// separately: geometry moves on one curve, colour on another.
    private let navColorEase = Animation.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.15)
    private var railWidth: CGFloat { expanded ? 220 : 64 }
    /// The web's `NAV_W = SB_W - NAV_PAD * 2` — the nav button's width, and it is
    /// EXPLICIT for two reasons that both show up only when collapsed.
    ///
    /// At 64pt rail this is exactly 40, which is the button height, so the
    /// Capsule highlight becomes a true CIRCLE rather than staying a pill. And it
    /// is what clips the label away: `maxWidth: .infinity` does not cap a row whose
    /// label is `.fixedSize()`, so the row kept its label width, the label survived
    /// into the collapsed rail as a couple of stray letters, and the highlight
    /// stayed pill-shaped.
    ///
    /// Animates with the rail because `expanded` is written inside
    /// `withAnimation(railEase)` — same curve, same duration, which is how the web
    /// gets each label progressively clipped rather than cut dead on frame one.
    private var navRowWidth: CGFloat { railWidth - navPad * 2 }

    var body: some View {
        // The brand strip spans the FULL WIDTH above the sidebar-and-content row,
        // so it is a sibling of that row rather than something inside either half
        // (TRAQS.jsx:24582). Getting that wrong would put the logo above the page
        // only, leaving the sidebar to start at the window's top edge.
        VStack(spacing: 0) {
            BrandStrip()
                // ABOVE the row below it. The notification panel hangs out of the
                // strip's bounds, and in a VStack a later sibling draws over an
                // earlier one — without this the panel opens behind the content.
                .zIndex(2)
            HStack(spacing: 0) {
                sidebar
                page
            }
            // SURFACE, not bg — `{/* Body — sidebar + content */}` carries
            // `background: Tc.surfaceSolid` (TRAQS.jsx:24742).
            //
            // This is what makes the panel's 22pt corners visible at all. The
            // panel is `bg`; painting `bg` behind it too means the corners cut
            // away to the same colour and read as square. The chrome colour
            // behind them is the whole point.
            .background(theme.surface)
        }
        .background(theme.bg)
        .preferredColorScheme(theme.isDark ? .dark : .light)
        // The web confirms before logging out (TRAQS.jsx:28537) rather than doing
        // it on the first click, and so does this.
        .overlay { if confirmLogout { logoutConfirm } }
    }

    /// `confirmLogout`'s dialog (TRAQS.jsx:28537).
    ///
    /// Note the button order, which is copied and NOT a mistake: Cancel carries
    /// the accent gradient and Log Out is flat red. The prominent button is the
    /// one that keeps you where you are.
    private var logoutConfirm: some View {
        ZStack {
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .onTapGesture { confirmLogout = false }
            VStack(alignment: .leading, spacing: 0) {
                Text("Log Out?")
                    .font(TFont.body(18, 700))
                    .foregroundStyle(theme.text)
                    .padding(.bottom, 8)
                Text("You are signed in as \(personName). Are you sure you want to log out?")
                    .font(TFont.body(14))
                    .foregroundStyle(theme.textSec)
                    .lineSpacing(14 * 0.6)          // lineHeight 1.6
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 24)
                HStack(spacing: 10) {
                    Spacer()
                    Button { confirmLogout = false } label: {
                        Text("Cancel")
                            .font(TFont.body(13, 600))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 20).padding(.vertical, 9)
                            .background(Capsule().fill(theme.accent))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    Button {
                        confirmLogout = false
                        auth.logout()
                    } label: {
                        Text("Log Out")
                            .font(TFont.body(13, 600))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 20).padding(.vertical, 9)
                            .background(Capsule().fill(Color(hex: "#ef4444")))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(28)
            .frame(maxWidth: 360)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: TTheme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TTheme.radius, style: .continuous)
                .stroke(theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 32, y: 24)
            .padding(24)
        }
    }

    // MARK: Page

    /// The content panel. Its corners come from the web's 22pt on all four
    /// (TRAQS.jsx:25003), opened up to `radiusHero` on request. The panel is
    /// `T.bg` floating inside the
    /// surface-coloured chrome — the strip above it and the rail beside it — so
    /// the radius is what separates the page from the chrome. Square, the two
    /// read as one flat slab.
    private var page: some View {
        ZStack {
            theme.bg
            // Still a placeholder — no screen is ported in this pass. It goes
            // through TPage so the chrome is exercised, and visibly wrong if any
            // copied number is wrong, before a real screen depends on it.
            TPage(settingsMode ? settingsSection.label : view.label) {
                Text("Not ported yet")
                    .font(TFont.body(15))
                    .foregroundStyle(theme.textDim)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // ROUNDER than the web's 22. A deliberate divergence, asked for — and
        // `TTheme.radiusHero` rather than a loose number, so it stays on the
        // app's own radius scale instead of becoming a one-off.
        .clipShape(RoundedRectangle(cornerRadius: TTheme.radiusHero, style: .continuous))
    }

    // MARK: Sidebar

    private var sidebar: some View {
        // NO GlassEffectContainer. The sidebar is a straight copy of the web
        // app's, and the web app's nav buttons are not glass — see `navRow`.
        VStack(alignment: .leading, spacing: 0) {
            hamburger
            // The two nav layers swap instantly rather than cross-fading — the
            // web app does the same, and a fade here reads as the sidebar
            // reloading rather than changing mode.
            Group {
                if settingsMode { settingsNav } else { mainNav }
            }
            .padding(.horizontal, navPad)

            Spacer(minLength: 0)
            orgLabel
            profile
        }
        .frame(width: railWidth, alignment: .leading)
        .background(theme.surface)
        .clipped()
    }

    private var hamburger: some View {
        // NO LABEL. The web's toggle is an icon on its own — its button contains a
        // single <span style={navIcon}> and nothing else (TRAQS.jsx:24835). The
        // "Menu" text here was invented.
        //
        // What it does carry is a tooltip, which is the web's `title` attribute on
        // the same element.
        navRow(glyph: .init(spec: GlyphSpec(strokeWidth: 2.5, elements: [
            .line(3, 6, 21, 6), .line(3, 12, 21, 12), .line(3, 18, 21, 18),
        ])), label: "", key: "toggle", active: false, tint: theme.textSec) {
            withAnimation(railEase) { expanded.toggle() }
        }
        .help(expanded ? "Collapse sidebar" : "Expand sidebar")
        .padding(.horizontal, navPad)
        .padding(.top, 12)
        .padding(.bottom, 22)   // 12 padding + 10 margin, per the web
    }

    private var mainNav: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(TView.primary) { v in
                navRow(glyph: glyph(for: v), label: v.label, key: v.rawValue,
                       active: view == v) { select(v) }
            }
            if canSeeApprovals {
                navRow(glyph: .init(spec: WebIcon.approvals), label: TView.approvals.label,
                       key: "approvals", active: view == .approvals) { select(.approvals) }
            }
            if isAdmin {
                navRow(glyph: .init(spec: WebIcon.admin), label: TView.admin.label,
                       key: "admin", active: view == .admin) { select(.admin) }
            }
            navRow(glyph: .init(spec: WebIcon.settings), label: "Settings",
                   key: "settings", active: false) {
                withAnimation(.easeOut(duration: 0.12)) { settingsMode = true }
            }
        }
    }

    private var settingsNav: some View {
        VStack(alignment: .leading, spacing: 2) {
            navRow(glyph: .init(spec: WebIcon.back), label: "Back", key: "s.back",
                   active: false, tint: theme.textSec) {
                withAnimation(.easeOut(duration: 0.12)) { settingsMode = false }
            }
            divider.padding(.top, 6).padding(.bottom, 8)

            navRow(glyph: .init(spec: WebIcon.settings, size: 15), label: "General",
                   key: "s.general", active: settingsSection == .general) {
                settingsSection = .general
            }

            // Organization and its children are ONE child of the layer with a
            // tight internal gap — as siblings they'd each take the layer's gap
            // and the sub-items would float away from the tab they belong to.
            VStack(alignment: .leading, spacing: 2) {
                navRow(glyph: .init(spec: WebIcon.organization, size: 15), label: "Organization",
                       key: "s.org", active: TSettings.orgChildren.contains(settingsSection),
                       trailingChevron: true) {
                    if !expanded { withAnimation(railEase) { expanded = true } }
                    withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.22)) {
                        orgExpanded.toggle()
                    }
                }
                if orgExpanded && expanded {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(TSettings.orgChildren) { c in
                            navRow(glyph: nil, label: c.label, key: "s." + c.rawValue,
                                   active: settingsSection == c, height: 34, fontSize: 12) {
                                settingsSection = c
                            }
                        }
                    }
                    .padding(.leading, 14)
                    .padding(.vertical, 2)
                    .transition(.opacity)
                }
            }

            navRow(glyph: .init(spec: WebIcon.customization, size: 15), label: "Customization",
                   key: "s.custom", active: settingsSection == .customization) {
                settingsSection = .customization
            }

            divider.padding(.top, 8).padding(.bottom, 4)

            // FAST TRAQS — the one nav entry with a fill and a border of its own.
            navRow(glyph: .init(spec: WebIcon.fastTraqs, size: 15), label: "FAST TRAQS",
                   key: "s.fast", active: false, tint: theme.accent,
                   fill: theme.accent.opacity(0.07), bordered: true) { }
                .padding(.top, 6)
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(theme.border.opacity(0.33))
            .frame(height: 1)
            .padding(.horizontal, 12)
            .opacity(expanded ? 1 : 0.4)
    }

    private var orgLabel: some View {
        Text(orgName)
            .font(TFont.body(10, 700))
            .kerning(-0.45)
            .foregroundStyle(theme.textDim)
            .lineLimit(1)
            .frame(height: expanded ? 22 : 0)
            .opacity(expanded ? 0.55 : 0)
            .padding(.horizontal, 16)
            .clipped()
    }

    private var profile: some View {
        HStack(spacing: 10) {
            // `PersonAvatar` (TRAQS.jsx:2817): the PERSON's colour, not the theme
            // accent, with their initials in white at size * 0.34 for two glyphs
            // (0.42 for one) and weight 800. The web's note on the scale: "Two
            // glyphs need to be set smaller than one or they crowd the circle."
            Circle()
                .fill(personFill)
                .frame(width: 32, height: 32)
                .overlay {
                    // Nothing before people load, rather than a placeholder that
                    // swaps a beat later. `initials("")` would be an empty circle
                    // with a stray subtitle under it.
                    if !personName.isEmpty {
                        let text = initials(personName)
                        Text(text)
                            .font(TFont.body((32 * (text.count > 1 ? 0.34 : 0.42)).rounded(), 800))
                            .tracking(text.count > 1 ? 32 * -0.03 : 0)
                            .foregroundStyle(.white)
                    }
                }
            if expanded && !personName.isEmpty {
                VStack(alignment: .leading, spacing: 1) {
                    Text(personName)
                        .font(TFont.body(13, 600))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(isAdmin ? "Admin" : "Crew")
                        .font(TFont.body(10))
                        .foregroundStyle(isAdmin ? theme.accent : theme.textDim)
                }
                .fixedSize()
            }
            Spacer(minLength: 0)
            // Log out (TRAQS.jsx:24996). Only reachable while the rail is open —
            // the web sets `pointerEvents: sidebarExpanded ? "auto" : "none"` on
            // this cell, so a collapsed rail cannot be logged out of by accident.
            if expanded && !personName.isEmpty { logoutButton }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    /// `PERSON_BLUE` when the person has no colour of their own.
    private var personFill: Color {
        let c = appState.currentPerson?.color ?? ""
        return c.isEmpty ? Color(hex: "#4169e1") : Color(hex: c)
    }

    /// 30pt, outlined, red — and transparent until hovered, which is the whole of
    /// its resting state on the web too. NOT glass: it is one of the elements the
    /// web already opts out of its own button chrome, and a lit pill here would
    /// pull the eye to the most destructive control in the sidebar.
    private var logoutButton: some View {
        Button { confirmLogout = true } label: {
            WebGlyph(spec: WebIcon.logout, size: 14, color: Color(hex: "#ef4444"))
                .frame(width: 30, height: 30)
                .background(Circle().fill(logoutHovering
                    ? Color(hex: "#ef4444").opacity(0.067)   // #ef444411
                    : .clear))
                .overlay(Circle().stroke(logoutHovering
                    ? Color(hex: "#ef4444").opacity(0.33)    // #ef444455
                    : Color(hex: T.border), lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help("Log out")
        // transition: background 0.15s, border-color 0.15s
        .animation(.easeInOut(duration: 0.15), value: logoutHovering)
        .onHover { logoutHovering = $0 }
    }

    // MARK: One nav row
    //
    // 40pt tall on a 20pt radius: a pill at full width and a true circle at 40pt,
    // which is what lets the rail collapse without the shape snapping. The
    // horizontal padding is (40 - iconSlot) / 2 so the glyph's centre lands on
    // 20pt — half the button, concentric with the active pill, and dead on the
    // 64pt rail's centreline once NAV_PAD is added.

    private struct Glyph {
        var spec: GlyphSpec
        var size: CGFloat = 17
    }

    private func glyph(for v: TView) -> Glyph? {
        switch v {
        case .dashboard: return .init(spec: WebIcon.dashboard)
        case .tasks:     return .init(spec: WebIcon.jobs)
        case .schedule:  return nil    // drawn by ScheduleGlyph — it carries the date
        case .employees: return .init(spec: WebIcon.employees)
        case .timestamp: return .init(spec: WebIcon.timeClock)
        case .analytics: return .init(spec: WebIcon.analytics)
        case .clients:   return .init(spec: WebIcon.clients)
        case .messages:  return .init(spec: WebIcon.messages)
        case .approvals: return .init(spec: WebIcon.approvals)
        case .admin:     return .init(spec: WebIcon.admin)
        }
    }

    @ViewBuilder
    private func navRow(glyph: Glyph?, label: String, key: String, active: Bool,
                        height: CGFloat = 40, fontSize: CGFloat = 13,
                        tint: Color? = nil, fill: Color? = nil,
                        bordered: Bool = false, trailingChevron: Bool = false,
                        action: @escaping () -> Void) -> some View {
        let fg = active ? theme.accent : (tint ?? theme.text)
        Button(action: action) {
            HStack(spacing: 12) {
                Group {
                    if let glyph {
                        WebGlyph(spec: glyph.spec, size: glyph.size, color: fg)
                    } else if key == TView.schedule.rawValue {
                        ScheduleGlyph(size: iconSlot, color: fg)
                    } else {
                        Color.clear.frame(width: iconSlot, height: iconSlot)
                    }
                }
                .frame(width: iconSlot, height: iconSlot)

                // Skipped entirely when empty — the hamburger has no label, and an
                // empty Text still occupies the HStack's 12pt gap.
                if !label.isEmpty {
                    Text(label)
                        .font(TFont.body(fontSize, active ? 700 : 500))
                        .foregroundStyle(fg)
                        .lineLimit(1)
                        .fixedSize()
                }
                if trailingChevron {
                    Spacer(minLength: 4)
                    WebGlyph(spec: WebIcon.chevronRight, size: 10, color: theme.textDim)
                        .rotationEffect(.degrees(orgExpanded ? 90 : 0))
                        .opacity(expanded ? 1 : 0)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, (40 - iconSlot) / 2)
            // The web's `width: NAV_W` and `height: o.h || 40`, both explicit.
            // See `navRowWidth` for why the width cannot be `maxWidth: .infinity`.
            .frame(width: navRowWidth, height: height, alignment: .leading)
            // `overflow: hidden` on the web's nav button, and it is load-bearing:
            // the BUTTON is what clips the label, not the rail. Its width tracks
            // the rail (NAV_W = SB_W - NAV_PAD * 2, so 40pt collapsed), so the
            // label is progressively cut away as the rail narrows and is gone
            // entirely at 64pt.
            //
            // Without this the label overflowed the row and was only cut at the
            // rail's own edge, which left a couple of stray letters ("Da", "Sc")
            // sitting in the collapsed rail beside each icon.
            .clipped()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background {
            ZStack {
                if active {
                    // `background: active ? hexA(T.accent, 0.18)` — copied, and
                    // NOT GLASS. The web app's own note on this button: "active =
                    // brand-gradient fill; pill when expanded, circle when
                    // collapsed; NO SEPARATE SLIDING INDICATOR."
                    //
                    // So there is no travelling pill either. A glassEffect pill was
                    // tried here and was wrong twice: wrong material, and being a
                    // background layer with a material in it, it painted over the
                    // row's own icon and label — the active row rendered as an
                    // empty capsule. Glass belongs on the page HEADER buttons; see
                    // GlassControls.
                    Capsule().fill(theme.accent.opacity(0.18))
                } else if let fill {
                    Capsule().fill(fill)
                } else if hovered == key {
                    Capsule().fill(theme.hover)
                }
            }
        }
        .overlay {
            if bordered { Capsule().stroke(theme.accent.opacity(0.27), lineWidth: 1) }
        }
        .clipShape(Capsule())
        .onHover { hovered = $0 ? key : (hovered == key ? nil : hovered) }
        // Hover fades in and out rather than snapping — the web's
        // `background-color 0.15s ease`. Keyed on THIS row's hover state, not the
        // shared `hovered` string, so moving between rows doesn't re-animate every
        // other row in the rail.
        .animation(navColorEase, value: hovered == key)
        // The active row's fill and lettering, on the same curve — the web's
        // `color 0.15s ease` from the same rule.
        .animation(navColorEase, value: active)
    }

    private func select(_ v: TView) {
        // A colour change, on the web's colour curve — there is no travelling
        // indicator to carry anywhere (see `navRow`), so the bouncy spring this
        // used to run was animating nothing but the fill, overshooting a value
        // the web crossfades in 0.15s.
        withAnimation(navColorEase) { view = v }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        let first = parts.first?.first.map(String.init) ?? ""
        let last = parts.count > 1 ? parts.last?.first.map(String.init) ?? "" : ""
        return (first + last).uppercased()
    }
}
