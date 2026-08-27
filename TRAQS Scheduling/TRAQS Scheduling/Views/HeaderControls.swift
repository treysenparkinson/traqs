import SwiftUI

// MARK: - The app-wide header controls
//
// Every tab's trailing header controls, drawn by ONE view that lives above the
// TabView. Two things about that are load-bearing, and both were learned the
// hard way:
//
// 1. THE HOST NEVER UNMOUNTS. A TabView swaps pages in a single frame — measured
//    2026-08-26, Home's controls settled at 1.552s and were gone at 1.627s, with
//    zero frames between. With the controls inside the pages there was nothing
//    to morph FROM, whatever ids were assigned.
//
// 2. NO TYPE ERASURE, ANYWHERE ON THE PATH. This is the one that took three
//    attempts. `glassEffectID` interpolates a glass shape between states, which
//    it can only do if the view carrying that shape is CONTINUOUS across the
//    change. Every earlier design handed the container an `AnyView`:
//      * hoisting the whole header as an AnyView swapped by `.id()` gave the
//        container two unrelated elements, each replaying its own scale-up;
//      * an AnyView whose underlying type changes is replaced wholesale, so with
//        matched ids and no `.id()` nothing animated at all;
//      * building each control from a page-supplied closure returned a FRESH
//        AnyView on every render, so every frame of the animation handed the
//        container a different view and it could only cross-fade.
//    So the controls are DATA (`HeaderControlKind`) and this file renders them
//    through a concrete `switch`. The view for a given control is the same
//    concrete type on every render and on every tab, which is exactly the
//    condition the effect needs.
//
// Consequence, and it's the price of the effect: the state behind these controls
// lives in `AppNav`, not in the pages. A host that owns the views has to own
// what drives them. Pages read and write it exactly as they did their own @State.

/// One control, as data.
enum HeaderControlKind: Hashable {
    // Jobs
    case eye, search, approvals, availability
    // Home
    case account
    // Analytics
    case worker, week, admin
    // Time clock
    case timeOff
    // Messages
    case filter, compose, selectDone, selectDelete
}

/// One glass shape: a group of controls that share it.
///
/// The id is what morphs. Every tab uses the SAME two ids — `"cluster"` for its
/// group and `"action"` for a control standing apart — so the pill flows into
/// the next page's pill and the circle into its circle, whatever is inside them.
struct HeaderControlGroup: Identifiable {
    let id: String
    let kinds: [HeaderControlKind]
    var tint: Color? = nil
}

/// A square header slot. Shared with the concrete controls the host renders as
/// whole components (`AccountGlassMenu`, `AdminHeaderButton`) so they size
/// exactly like the ones built from `HeaderControlKind`.
///
/// Square matters: a group is then a whole number of slots wide, its width
/// animates predictably, and a one-control group's capsule renders as a circle —
/// so every header shape is the same primitive and one can stretch into another.
struct HeaderSlot<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        content()
            .frame(width: HeaderControl.diameter, height: HeaderControl.diameter)
            .contentShape(Rectangle())
    }
}

// MARK: - Host

struct HeaderControlsHost: View {
    @Environment(AppNav.self) private var appNav
    @Environment(AppState.self) private var appState
    @Namespace private var glass

    /// The tab the header is SHOWING, one animated transaction behind
    /// `appNav.selected`.
    ///
    /// The tab bar writes `selected` with no animation on purpose — wrapping it
    /// made the page wait on the animation, which was the old "not changing on
    /// click" bug. But `glassEffectID` only morphs INSIDE an animated
    /// transaction. Mirroring the selection through `withAnimation` here gives
    /// the glass its transaction and leaves the page switch as instant as it was.
    @State private var shown: TTab = .home

    /// From TRAQSNavHeader: a 60pt row, 16pt in from the edges, dropped 22pt.
    private let rowHeight: CGFloat = 60
    private let topInset: CGFloat = 22
    private let sideInset: CGFloat = 16
    /// Resting gap between the group and a standalone control.
    private let controlGap: CGFloat = 14
    /// How close two shapes come before the glass melts them together. BELOW
    /// `controlGap`, or every control welds into one permanent blob (tried,
    /// 2026-08-26) — but not so far below that shapes crowding each other during
    /// a morph never cross it.
    private let fuseDistance: CGFloat = 10

    var body: some View {
        GlassEffectContainer(spacing: fuseDistance) {
            HStack(spacing: controlGap) {
                ForEach(groups) { group in
                    HStack(spacing: 0) {
                        ForEach(group.kinds, id: \.self) { control($0) }
                    }
                    .frame(height: HeaderControl.diameter)
                    .glassEffect(style(group.tint), in: Capsule())
                    .glassEffectID(group.id, in: glass)
                }
            }
        }
        .frame(height: rowHeight)
        // Layout only — an HStack's empty space isn't hit-tested, so this can't
        // steal taps from the page underneath.
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, sideInset)
        .padding(.top, topInset)
        .onChange(of: appNav.selected, initial: true) { _, tab in
            withAnimation(.smooth(duration: 0.45)) { shown = tab }
        }
    }

    private func style(_ tint: Color?) -> Glass {
        var g: Glass = .regular
        if let tint { g = g.tint(tint) }
        return g.interactive()
    }

    // MARK: What each tab shows

    private var groups: [HeaderControlGroup] {
        switch shown {
        case .home:
            return [HeaderControlGroup(id: "action", kinds: [.account])]

        case .jobs:
            // One group for the three things you do TO the jobs list, and a
            // separate circle for the availability check, which asks about
            // PEOPLE. That separation used to be a hairline; the shapes say it.
            var kinds: [HeaderControlKind] = [.eye, .search]
            if appState.canViewApprovalQueue { kinds.append(.approvals) }
            var out = [HeaderControlGroup(id: "cluster", kinds: kinds)]
            if appState.currentPerson?.isAdmin == true {
                out.append(HeaderControlGroup(id: "action", kinds: [.availability]))
            }
            return out

        case .hours:
            return [HeaderControlGroup(id: "cluster", kinds: [.timeOff])]

        case .stats:
            // Who and when — the two things that scope this page — share the
            // group. Admin goes somewhere else entirely, so it stands apart.
            var kinds: [HeaderControlKind] = []
            if appState.isAdmin { kinds.append(.worker) }
            kinds.append(.week)
            var out = [HeaderControlGroup(id: "cluster", kinds: kinds)]
            if appState.isAdmin {
                out.append(HeaderControlGroup(id: "action", kinds: [.admin]))
            }
            return out

        case .chat:
            // Nothing while a thread is open: that header is drawn in a separate
            // UIWindow (see OverlayWindowController) and the inbox's controls
            // would show through it.
            guard appState.activeMessageThread == nil else { return [] }
            if appNav.chatSelectMode {
                return [
                    HeaderControlGroup(id: "cluster", kinds: [.selectDelete],
                                       tint: .red.opacity(appNav.chatSelectedKeys.isEmpty ? 0.4 : 1.0)),
                    HeaderControlGroup(id: "action", kinds: [.selectDone])
                ]
            }
            // Search and Filter both narrow WHAT you're looking at, so they share
            // a shape. New chat MAKES something, so it stands alone.
            return [
                HeaderControlGroup(id: "cluster", kinds: [.search, .filter]),
                HeaderControlGroup(id: "action", kinds: [.compose])
            ]
        }
    }

    // MARK: Rendering
    //
    // A concrete switch. No AnyView — see the note at the top of this file.

    @ViewBuilder
    private func control(_ kind: HeaderControlKind) -> some View {
        switch kind {
        case .eye:
            // Just an eye. The old label ("List"/"Gantt") named the mode you
            // were LEAVING as often as the one you were in, and cost 62pt of a
            // header with about 70 to spare.
            slotButton(.eye) {
                // No withAnimation: it would animate the header's own layout.
                // JobsHubView's ZStack drives the content cross-fade.
                appNav.jobsMode.toggle()
            }

        case .search:
            slotButton(.search) {
                withAnimation(.easeInOut(duration: 0.18)) {
                    if shown == .jobs {
                        appNav.jobsSearchOpen.toggle()
                        if !appNav.jobsSearchOpen { appNav.jobsSearchText = "" }
                    } else {
                        appNav.chatSearchOpen.toggle()
                        if !appNav.chatSearchOpen { appNav.chatSearchText = "" }
                    }
                }
            }
            // Search is list-only on Jobs, but it stays MOUNTED in both modes and
            // just fades. Removing it would resize the group on every mode flip.
            .opacity(shown == .jobs && appNav.jobsMode != .list ? 0 : 1)
            .allowsHitTesting(!(shown == .jobs && appNav.jobsMode != .list))
            .animation(.easeInOut(duration: 0.22), value: appNav.jobsMode)

        case .approvals:
            ZStack(alignment: .topTrailing) {
                slotButton(.select) { appNav.showApprovalQueue = true }
                // A plain accent dot, not a count. The exact number isn't
                // actionable from here — you open the queue either way — and a
                // two-digit badge crowded the controls beside it.
                if appState.pendingApprovalCount > 0 {
                    Circle()
                        .fill(Color(hex: T.accent))
                        .frame(width: 9, height: 9)
                        .offset(x: -7, y: 10)
                        .allowsHitTesting(false)
                        .accessibilityLabel("Approvals pending")
                }
            }

        case .availability:
            Menu {
                Button {
                    // The popup owns its whole entrance; a transaction here
                    // would animate the page underneath it (see ModalPop).
                    withTransaction(.noAnimation) { appNav.showAvailability = true }
                } label: {
                    Label("Check for availability", systemImage: "clock.arrow.circlepath")
                }
            } label: {
                slot {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Color(hex: T.accent))
                }
            }
            .buttonStyle(.plain)

        case .account:
            AccountGlassMenu()

        case .admin:
            AdminHeaderButton()

        case .worker:
            Menu {
                Picker("Worker", selection: Bindable(appNav).statsWorkerId) {
                    Text("Everyone").tag(String?.none)
                    ForEach(appState.people.sorted { $0.name < $1.name }) { p in
                        Text(p.name).tag(String?.some(p.id))
                    }
                }
            } label: {
                slot { HeaderGlyph(icon: .person) }
            }
            .buttonStyle(.plain)

        case .week:
            Menu {
                ForEach(StatsWeeks.recent, id: \.self) { start in
                    Button { appNav.statsWeekAnchor = start } label: {
                        if StatsWeeks.same(start, appNav.statsWeekAnchor) {
                            Label(StatsWeeks.label(start), systemImage: "checkmark")
                        } else {
                            Text(StatsWeeks.label(start))
                        }
                    }
                }
            } label: {
                slot { HeaderGlyph(icon: .cal) }
            }
            .buttonStyle(.plain)

        case .timeOff:
            Button { appNav.openTimeOffPage = true } label: {
                HStack(spacing: 6) {
                    HeaderGlyph(icon: .cal, size: 14)
                    Text("Time Off")
                        .font(TTypo.smBold(13))
                        .foregroundStyle(Color(hex: T.ink))
                }
                .padding(.horizontal, 16)
                .frame(height: HeaderControl.diameter)
            }
            .buttonStyle(.plain)

        case .filter:
            Menu {
                Picker("Filter", selection: Bindable(appNav).chatFilter) {
                    ForEach(ChatFilter.allCases, id: \.self) { opt in
                        Text(opt.label).tag(opt)
                    }
                }
            } label: {
                slot { HeaderGlyph(icon: .filter) }
            }
            .buttonStyle(.plain)
            .fixedSize()

        case .compose:
            Button {
                appNav.modalBlur = true
                // Animations off, so the cover doesn't slide up from the bottom —
                // NewMessageSheet fades and scales in at the centre under its own
                // steam. Presenting it normally ran BOTH, which read as a pop.
                withTransaction(Transaction.noAnimation) { appNav.showNewMessage = true }
            } label: {
                slot { HeaderGlyph(icon: .plus) }
            }
            .buttonStyle(.plain)

        case .selectDone:
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    appNav.chatSelectMode = false
                    appNav.chatSelectedKeys = []
                }
            } label: {
                Text("Done")
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .padding(.horizontal, 16)
                    .frame(height: HeaderControl.diameter)
            }
            .buttonStyle(.plain)

        case .selectDelete:
            Button { appNav.showDeleteThreads = true } label: {
                HStack(spacing: 6) {
                    TIconView(icon: .trash, size: 16, color: .red.readableText, weight: .bold)
                    if !appNav.chatSelectedKeys.isEmpty {
                        Text("\(appNav.chatSelectedKeys.count)")
                            .font(TTypo.smBold(13))
                            .foregroundStyle(.red.readableText)
                            .tnum()
                    }
                }
                .padding(.horizontal, 16)
                .frame(height: HeaderControl.diameter)
            }
            .buttonStyle(.plain)
            .disabled(appNav.chatSelectedKeys.isEmpty)
        }
    }

    // MARK: Slots

    private func slot<V: View>(@ViewBuilder _ content: @escaping () -> V) -> some View {
        HeaderSlot(content: content)
    }

    private func slotButton(_ icon: TIcon, action: @escaping () -> Void) -> some View {
        Button(action: action) { HeaderSlot { HeaderGlyph(icon: icon) } }
            .buttonStyle(.plain)
    }
}

// MARK: - Week helpers
//
// Free functions rather than MoreView members: the header's week menu is drawn
// by the host, which has no access to a page's private helpers.
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
