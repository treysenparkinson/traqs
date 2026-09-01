import SwiftUI

// MARK: - Glass header — model (§5.1)
//
// One persistent header for the whole app. Pages declare WHAT their header
// holds; the shell renders it. See §2 of the brief: if each page owned a header,
// switching pages would tear down that page's GlassEffectContainer and
// @Namespace and build the next page's fresh, so the outgoing and incoming
// shapes never coexist in one identity space and there is nothing to
// interpolate. The container and namespace here are never destroyed.

/// Stable header positions — the morph identity (§3).
///
/// NEVER derived from icon names, titles or array indices. A slot present on
/// both pages keeps its glass shape and swaps the glyph inside it; a slot on
/// only one side materializes or dissolves.
enum HeaderSlot: String, Hashable {
    case viewMode, search, approvals, availability   // Jobs
    case profile                                     // Home
    case worker, week, admin                         // Analytics
    case timeOff                                     // Time clock
    case filter, compose                             // Messages
    case selectDone, selectDelete                    // Messages, select mode
}

enum HeaderEdge: String, Hashable { case leading, trailing }

enum PillStyle { case plain, prominent }

/// What a pill draws.
///
/// DEVIATION from §5.1, which models a pill as a single `systemImage`. TRAQS's
/// header carries a labelled pill, a live count, a profile photo, a badge and
/// three menus — none of which is an SF Symbol button. The cases stay concrete
/// so the header path holds no AnyView (§8).
enum HeaderPillContent {
    case icon(TIcon)
    case symbol(String, tint: Color?)
    case label(TIcon, String)
    case text(String)
    case deleteCount(Int)
    case badgedIcon(TIcon, showsBadge: Bool)
    case avatar
}

/// What a pill does. A menu can't be expressed as a closure that returns a
/// view without erasing its type, so menus are named and rendered concretely.
enum HeaderPillAction {
    case tap(() -> Void)
    case menu(HeaderMenu)
}

enum HeaderMenu { case filter, worker, week, availability, account }

struct HeaderPill: Identifiable {
    let slot: HeaderSlot
    let content: HeaderPillContent
    var edge: HeaderEdge = .trailing
    var style: PillStyle = .plain
    var tint: Color? = nil
    /// Faded and non-interactive, but still MOUNTED — removing a control resizes
    /// the cluster on every state flip, which reads as a pop.
    var dimmed: Bool = false
    let action: HeaderPillAction

    var id: HeaderSlot { slot }
}

struct HeaderConfig {
    var pills: [HeaderPill] = []
    func pills(on edge: HeaderEdge) -> [HeaderPill] { pills.filter { $0.edge == edge } }
}

// MARK: - The persistent header (§5.2)

struct GlassHeader: View {
    let config: HeaderConfig
    /// Passed IN. Never declared here — see §5.3. A namespace owned by this view
    /// dies with it, and this view is rebuilt whenever the config changes.
    let namespace: Namespace.ID

    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState

    private let controlSize: CGFloat = HeaderControl.diameter   // 42
    // The three spacings are ONE system, and the order between them is what
    // decides which controls fuse:
    //
    //     itemSpacing (4)  <  mergeDistance (14)  <  soloGap (24)
    //
    // Controls inside a cluster sit 4pt apart, far below the merge distance, so
    // they blend into one surface (§4.1). A solo control sits 24pt away — ABOVE
    // it — so it stays its own shape. Every number has to keep its place in that
    // chain; move one and the other two need checking.
    /// Tight, so controls in a cluster fuse into one surface (§4.1).
    private let itemSpacing: CGFloat = 4
    /// How close two shapes must be to blend. LARGER than `itemSpacing` — that
    /// is the whole trick, per Apple: a container spacing larger than the
    /// interior stack's makes the effects blend at rest, and animating views in
    /// or out morphs the shapes apart or together.
    ///
    /// Was 28, which is what left the solo control tethered to the cluster by a
    /// liquid neck: at 28 it blended with anything within 28pt, and no sane gap
    /// clears that. Pulling it down to 14 keeps the cluster fused (4 ≪ 14) while
    /// leaving room for a solo gap that is wide enough to break the blend but
    /// still reads as one header row.
    private let mergeDistance: CGFloat = 14
    /// Gap between the fused cluster and a solo control. ABOVE `mergeDistance`,
    /// which is what actually disconnects them — `glassEffectUnion` alone does
    /// not, since the container blends by DISTANCE regardless of union id.
    private let soloGap: CGFloat = 14

    /// Total height this header occupies, so pages can inset their content to
    /// start below it while still SCROLLING UNDER it (§8 — glass over a static
    /// opaque background renders flat and grey).
    static let height: CGFloat = 94

    private let logoSize: CGFloat = 60
    /// The wordmark asset carries transparent margin on its left — MEASURED from
    /// the PNG's alpha bounding box, which starts at x=331 of 2348, i.e. 14.1% of
    /// the width. At the rendered size that is ~16.5pt of nothing before the "t".
    ///
    /// Cancelling it puts the visible glyph exactly on the 16pt gutter every
    /// `PageTitle` uses, so the header and the page title beneath it share one
    /// left edge. The old hand-tuned `-13` was this figure guessed at, and it
    /// left the lockup a few points shy.
    ///
    /// `logoOpticalNudge` then eases it back a touch: a big title glyph carries
    /// its own side bearing, so a lockup set to the exact same gutter reads as
    /// very slightly too far left.
    private var logoLeftBearing: CGFloat {
        logoSize * TRAQSWordmark.aspect * 0.141 - logoOpticalNudge
    }
    /// Optical correction, in points. THE dial for nudging the lockup relative to
    /// the page titles — positive moves it right.
    private let logoOpticalNudge: CGFloat = 2
    private let topPad: CGFloat = 22
    private let bottomPad: CGFloat = 12

    var body: some View {
        GlassEffectContainer(spacing: mergeDistance) {
            HStack(spacing: 12) {
                cluster(.leading)

                // The brand lockup is the "title" — plain, NOT inside glass
                // (§4.2). A glass shape spanning the full header width never
                // changes shape, so the morph would degrade to a crossfade.
                HStack(spacing: 5) {
                    TRAQSHeaderLogo(size: logoSize)
                    // Connection state, as a mark on the lockup rather than a
                    // notice of its own. Nothing at all when healthy.
                    SyncStatusMark()
                }
                .offset(x: -logoLeftBearing)
                .frame(maxWidth: .infinity, alignment: .leading)

                cluster(.trailing)
            }
            .padding(.horizontal, 16)
            .frame(height: controlSize + 18)
        }
        .padding(.top, topPad)
        .padding(.bottom, bottomPad)
    }

    /// Plain controls fuse into one shape; `.prominent` ones stand alone.
    ///
    /// TWO things keep them apart, and both are needed. `soloGap` puts the solo
    /// control beyond `mergeDistance` so the container stops blending it — that
    /// is the one doing the real work. The union ids then make the grouping
    /// explicit rather than emergent, so a later spacing tweak can't silently
    /// re-absorb a control into the cluster (§4.3).
    @ViewBuilder
    private func cluster(_ edge: HeaderEdge) -> some View {
        let pills = config.pills(on: edge)
        // Nothing at all when the edge is empty, not an empty HStack. An empty
        // stack is still a child, so the outer HStack pays its 12pt spacing —
        // which is what was pushing the logo 12pt right of the page titles.
        if pills.isEmpty {
            EmptyView()
        } else {
        HStack(spacing: soloGap) {
            HStack(spacing: itemSpacing) {
                ForEach(pills.filter { $0.style == .plain }) { control($0) }
            }
            HStack(spacing: itemSpacing) {
                ForEach(pills.filter { $0.style == .prominent }) { control($0) }
            }
        }
        }
    }

    /// Union membership. Plain controls share one id so they read as a single
    /// pill; a prominent control gets an id of its own — a union of one is
    /// itself, so it stays a separate shape.
    private func unionID(for pill: HeaderPill) -> String {
        switch pill.style {
        case .plain:     return "cluster-\(pill.edge.rawValue)"
        case .prominent: return "solo-\(pill.slot.rawValue)"
        }
    }

    // MARK: One control

    @ViewBuilder
    private func control(_ pill: HeaderPill) -> some View {
        switch pill.action {
        case .tap(let run):
            Button(action: run) { face(pill) }
                .buttonStyle(.plain)
                // ORDER (§6): appearance, then the effect, then the id.
                .glassEffect(glass(for: pill), in: .capsule)
                .glassEffectUnion(id: unionID(for: pill), namespace: namespace)
                .glassEffectID(pill.slot, in: namespace)
                .opacity(pill.dimmed ? 0 : 1)
                .allowsHitTesting(!pill.dimmed)
        case .menu(let menu):
            menuControl(menu, pill: pill)
                .glassEffect(glass(for: pill), in: .capsule)
                .glassEffectUnion(id: unionID(for: pill), namespace: namespace)
                .glassEffectID(pill.slot, in: namespace)
        }
    }

    @ViewBuilder
    private func menuControl(_ menu: HeaderMenu, pill: HeaderPill) -> some View {
        switch menu {
        case .filter:
            Menu {
                Picker("Filter", selection: Bindable(appNav).chatFilter) {
                    ForEach(ChatFilter.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            } label: { face(pill) }
            .buttonStyle(.plain)
            .fixedSize()
        case .worker:
            Menu {
                Picker("Worker", selection: Bindable(appNav).statsWorkerId) {
                    Text("Everyone").tag(String?.none)
                    ForEach(appState.people.sorted { $0.name < $1.name }) { p in
                        Text(p.name).tag(String?.some(p.id))
                    }
                }
            } label: { face(pill) }
            .buttonStyle(.plain)
        case .week:
            // Weeks or pay periods, following the Analytics page's own toggle —
            // a list of weeks is no use while every number on the page is
            // measured over a fortnight. Both write the same
            // `statsWeekAnchor`; the page resolves it through whichever window
            // the toggle selects (see MoreView.statsInterval).
            Menu {
                if appNav.statsRange == .payPeriod {
                    ForEach(StatsPayPeriods.recent(appState), id: \.start) { p in
                        Button { appNav.statsWeekAnchor = p.start } label: {
                            if StatsPayPeriods.isSelected(p.start, anchor: appNav.statsWeekAnchor, appState) {
                                Label(StatsPayPeriods.label(p, appState), systemImage: "checkmark")
                            } else {
                                Text(StatsPayPeriods.label(p, appState))
                            }
                        }
                    }
                } else {
                    ForEach(StatsWeeks.recent, id: \.self) { start in
                        Button { appNav.statsWeekAnchor = start } label: {
                            if StatsWeeks.same(start, appNav.statsWeekAnchor) {
                                Label(StatsWeeks.label(start), systemImage: "checkmark")
                            } else {
                                Text(StatsWeeks.label(start))
                            }
                        }
                    }
                }
            } label: { face(pill) }
            .buttonStyle(.plain)
        case .account:
            Menu {
                // Just "Profile": the button IS your face, so repeating the name
                // here would label the row with the answer, not the action.
                Button { appNav.showProfile = true } label: {
                    Label("Profile", systemImage: "person.crop.circle")
                }
                Divider()
                Button { appNav.showCustomize = true } label: {
                    Label("Customization", systemImage: "sparkles")
                }
                Divider()
                Button(role: .destructive) { appNav.logoutRequested = true } label: {
                    Label("Log out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } label: { face(pill) }
            .buttonStyle(.plain)
        case .availability:
            Menu {
                Button {
                    // The popup owns its whole entrance; a transaction here would
                    // animate the page underneath it (see ModalPop).
                    withTransaction(.noAnimation) { appNav.showAvailability = true }
                } label: {
                    Label("Check for availability", systemImage: "clock.arrow.circlepath")
                }
            } label: { face(pill) }
            .buttonStyle(.plain)
        }
    }

    /// The glyph. Sized here, BEFORE `.glassEffect` captures it (§6).
    @ViewBuilder
    private func face(_ pill: HeaderPill) -> some View {
        switch pill.content {
        case .icon(let icon):
            TIconView(icon: icon, size: 18, color: Color(hex: T.ink))
                .frame(width: controlSize, height: controlSize)
                .contentTransition(.symbolEffect(.replace))
        case .symbol(let name, let tint):
            Image(systemName: name)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tint ?? Color(hex: T.ink))
                .frame(width: controlSize, height: controlSize)
                .contentTransition(.symbolEffect(.replace))
        case .label(let icon, let text):
            HStack(spacing: 6) {
                TIconView(icon: icon, size: 14, color: Color(hex: T.ink))
                Text(text).font(TTypo.smBold(13)).foregroundStyle(Color(hex: T.ink))
            }
            .padding(.horizontal, 16)
            .frame(height: controlSize)
        case .text(let text):
            Text(text)
                .font(TTypo.smBold(14))
                .foregroundStyle(Color(hex: T.ink))
                .padding(.horizontal, 16)
                .frame(height: controlSize)
        case .deleteCount(let n):
            HStack(spacing: 6) {
                TIconView(icon: .trash, size: 16, color: .red.readableText, weight: .bold)
                if n > 0 {
                    Text("\(n)").font(TTypo.smBold(13)).foregroundStyle(.red.readableText).tnum()
                }
            }
            .padding(.horizontal, 16)
            .frame(height: controlSize)
        case .badgedIcon(let icon, let showsBadge):
            ZStack(alignment: .topTrailing) {
                TIconView(icon: icon, size: 18, color: Color(hex: T.ink))
                    .frame(width: controlSize, height: controlSize)
                // A plain accent dot, not a count. The exact number isn't
                // actionable from here — you open the queue either way.
                if showsBadge {
                    Circle()
                        .fill(Color(hex: T.accent))
                        .frame(width: 9, height: 9)
                        .offset(x: -7, y: 10)
                        .allowsHitTesting(false)
                        .accessibilityLabel("Approvals pending")
                }
            }
        case .avatar:
            Group {
                if let me = appState.currentPerson {
                    Avatar(initials: Initials.from(me),
                           size: controlSize - 6,
                           fill: .personFill(me.color),
                           imageData: me.image)
                } else {
                    // Before people load there is neither photo nor colour; a
                    // glyph beats an empty circle or a "?" that swaps a beat later.
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Color(hex: T.ink))
                }
            }
            .frame(width: controlSize, height: controlSize)
        }
    }

    private func glass(for pill: HeaderPill) -> Glass {
        var g = Glass.regular.interactive()
        if let tint = pill.tint { g = g.tint(tint) }
        return g
    }
}

// MARK: - Week helpers
//
// Free functions rather than page members: the week menu is drawn by the shell's
// header, which has no access to a page's private helpers.
/// The last N pay periods, for the header's calendar menu in Pay Period mode.
///
/// Walked BACKWARDS through `payPeriodWindow` rather than by subtracting a fixed
/// number of days: an org can be weekly, biweekly, semi-monthly, or on explicit
/// pay DATES (the 5th and the 20th, say), and only the last of those has periods
/// of equal length. Probing the day before each period's start asks the same
/// function the rest of the app uses, so this list can never disagree with the
/// window the page actually measures.
enum StatsPayPeriods {
    struct Period: Hashable {
        let start: Date
        let end: Date      // inclusive last day, as payPeriodWindow reports it
    }

    static func recent(_ appState: AppState, count: Int = 8) -> [Period] {
        let cal = Calendar.current
        var out: [Period] = []
        var probe = Date()
        for _ in 0..<count {
            let w = appState.payPeriodWindow(now: probe)
            let p = Period(start: cal.startOfDay(for: w.start), end: cal.startOfDay(for: w.end))
            // A misconfigured window that doesn't move would otherwise repeat
            // the same period `count` times.
            if out.last?.start == p.start { break }
            out.append(p)
            guard let before = cal.date(byAdding: .day, value: -1, to: p.start) else { break }
            probe = before
        }
        return out
    }

    static func label(_ p: Period, _ appState: AppState) -> String {
        let f = DateFormatter.display("MMM d")
        let range = "\(f.string(from: p.start)) – \(f.string(from: p.end))"
        let current = appState.payPeriodWindow(now: Date()).start
        return Calendar.current.isDate(current, inSameDayAs: p.start)
            ? "This period · \(range)"
            : range
    }

    /// Which row is checked: the anchor is any day inside a period, so resolve
    /// it to that period's start before comparing.
    static func isSelected(_ start: Date, anchor: Date, _ appState: AppState) -> Bool {
        Calendar.current.isDate(appState.payPeriodWindow(now: anchor).start, inSameDayAs: start)
    }
}

enum StatsWeeks {
    /// Start-of-week (Monday) dates for the last 8 weeks, this week first.
    static var recent: [Date] {
        let cal = Calendar.current
        let thisStart = StatsMath.weekInterval(containing: Date(), calendar: cal).start
        return (0..<8).compactMap { cal.date(byAdding: .day, value: -7 * $0, to: thisStart) }
    }

    static func label(_ start: Date) -> String {
        let cal = Calendar.current
        let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
        let f = DateFormatter.display("MMM d")
        let range = "\(f.string(from: start)) – \(f.string(from: end))"
        return same(start, Date()) ? "This week · \(range)" : range
    }

    /// Compared by Monday-anchored week start, not `.weekOfYear` — otherwise on a
    /// Sunday the checkmark and the "This week" label point at the week that is
    /// about to begin rather than the one being shown.
    static func same(_ a: Date, _ b: Date) -> Bool {
        let cal = Calendar.current
        return StatsMath.weekInterval(containing: a, calendar: cal).start
            == StatsMath.weekInterval(containing: b, calendar: cal).start
    }
}
