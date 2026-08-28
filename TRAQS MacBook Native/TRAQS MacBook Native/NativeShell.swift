import SwiftUI

// MARK: - The app shell, copied from the web app
//
// Sidebar on the left, page on the right. Every measurement is lifted from
// TRAQS.jsx rather than chosen: rail 220/64, NAV_PAD 12, 40pt buttons on a 20pt
// radius, a 12pt gap between glyph and label, 13pt labels, 17pt icon slot, and
// the 0.28s cubic-bezier(0.22,1,0.36,1) the rail collapses on. A number in here
// that wasn't copied is a bug.
//
// The ONE intended difference: buttons are real Liquid Glass, and the active
// pill morphs from row to row as the screen changes.

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
    let theme: TTheme
    var canSeeApprovals = true
    var isAdmin = true
    var personName = "Treysen Parkinson"
    var orgName = "MATRIX SYSTEMS"

    @State private var view: TView = .tasks
    @State private var expanded = true
    /// Settings is a MODE, not a view — the whole nav layer swaps out for it,
    /// which is why it can't just be another `TView` case.
    @State private var settingsMode = false
    @State private var settingsSection: TSettings = .general
    @State private var orgExpanded = false
    @State private var hovered: String?

    /// The morph's identity space. Declared HERE so it outlives every screen
    /// change — a namespace owned by a view that gets rebuilt gives the glass
    /// nothing to interpolate between.
    @Namespace private var navGlass

    private let navPad: CGFloat = 12
    private let iconSlot: CGFloat = 17
    /// The rail's own curve, from the web app's NAV_EASE.
    private let railEase = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.28)
    private var railWidth: CGFloat { expanded ? 220 : 64 }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            page
        }
        .background(theme.bg)
        .preferredColorScheme(theme.isDark ? .dark : .light)
    }

    // MARK: Page

    private var page: some View {
        ZStack {
            theme.bg
            Text(settingsMode ? settingsSection.label : view.label)
                .font(TFont.body(28, 700))
                .foregroundStyle(theme.textDim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Sidebar

    private var sidebar: some View {
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
        navRow(glyph: .init(spec: GlyphSpec(strokeWidth: 2.5, elements: [
            .line(3, 6, 21, 6), .line(3, 12, 21, 12), .line(3, 18, 21, 18),
        ])), label: "Menu", key: "toggle", active: false, tint: theme.textSec) {
            withAnimation(railEase) { expanded.toggle() }
        }
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
            Circle()
                .fill(theme.accent.opacity(0.22))
                .frame(width: 32, height: 32)
                .overlay {
                    Text(initials(personName))
                        .font(TFont.body(12, 700))
                        .foregroundStyle(theme.accent)
                }
            if expanded {
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
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 12)
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

                Text(label)
                    .font(TFont.body(fontSize, active ? 700 : 500))
                    .foregroundStyle(fg)
                    .lineLimit(1)
                    .fixedSize()
                if trailingChevron {
                    Spacer(minLength: 4)
                    WebGlyph(spec: WebIcon.chevronRight, size: 10, color: theme.textDim)
                        .rotationEffect(.degrees(orgExpanded ? 90 : 0))
                        .opacity(expanded ? 1 : 0)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, (40 - iconSlot) / 2)
            .frame(height: height)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background {
            ZStack {
                if active {
                    // ONE shape, handed from row to row — the pill travels rather
                    // than being redrawn where you tapped.
                    Capsule()
                        .fill(theme.accent.opacity(0.18))
                        .matchedGeometryEffect(id: "nav.active", in: navGlass)
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
    }

    private func select(_ v: TView) {
        // An ANIMATED transaction is what carries the pill to the new row.
        withAnimation(.spring(response: 0.34, dampingFraction: 0.78)) { view = v }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        let first = parts.first?.first.map(String.init) ?? ""
        let last = parts.count > 1 ? parts.last?.first.map(String.init) ?? "" : ""
        return (first + last).uppercased()
    }
}
