import SwiftUI

/// A ScrollView that hugs its content, and ANIMATES the hug — so the popup's
/// top and bottom edges travel with a panel opening instead of snapping to the
/// new height a frame later.
///
/// `HugScroll` does the same measurement but deliberately does NOT animate its
/// cap, because its callers hold text fields: a keyboard changing the offered
/// height has to land immediately, and animating there makes the panel chase its
/// own content. This popup has no field and exactly one source of height change
/// — a disclosure — so here the cap SHOULD travel, on the same curve as the
/// content that moved it.
private struct LiveHeightScroll<Content: View>: View {
    let animation: Animation
    @ViewBuilder var content: () -> Content

    /// The content's natural height, which caps the scroller. Measured on the
    /// content, whose height doesn't depend on that cap — so there's no loop.
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        ScrollView {
            content()
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { h in
                    // The FIRST measurement is not a change, it's the initial
                    // size — animating it would grow the popup out of nothing
                    // underneath ModalPop's own entrance.
                    if contentHeight == 0 { contentHeight = h }
                    else { withAnimation(animation) { contentHeight = h } }
                }
        }
        .frame(maxHeight: contentHeight == 0 ? .infinity : contentHeight)
        // Content shrinking under a scrolled-down offset otherwise leaves the
        // view parked mid-content and reads as a jump.
        .defaultScrollAnchor(.top)
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// What the popup is opened on. `Identifiable` so it can drive a
/// `.fullScreenCover(item:)` — which is the whole point: a cover is its OWN
/// presentation, so it renders above the shell's glass header and the floating
/// nav pill. An in-hierarchy overlay inside a page can't, because both of those
/// are drawn by MainTabView on top of every page.
struct JobDetailTarget: Identifiable, Equatable {
    let job: Job
    /// Opens expanded, when the caller knows which panel you came for.
    var panelId: String? = nil
    var opId: String? = nil
    var id: String { job.id }
}

// MARK: - Job detail — a read-only popup
//
// Replaces the pushed JobDetailView for "what is this job?". Tapping a job card
// opens this over the list instead of navigating away from it, so you can check
// a panel's dates or who's on an op without losing your place.
//
// READ-ONLY, deliberately. Edit, Delete, Reschedule, the team picker, the
// engineering sign-off buttons and the per-op Request Finish all stayed behind
// in JobDetailView (still in the repo, no longer reachable — see the note at the
// top of that file). What's left here reports state and never changes it, which
// is what lets it be a popup at all: nothing in here can fail, so nothing needs
// room to say so.
//
// Presentation follows the house modal idiom — see `ModalPop` in Primitives:
// this view owns its whole entrance and exit, and the presenter must not
// animate. `HugScroll` sizes it to its content and only scrolls once the
// content outgrows the screen, so a two-panel job gets a small popup and a
// twenty-panel job gets a scroller.
struct JobDetailPopup: View {
    @Environment(AppState.self) private var appState
    /// Observed so the panel re-tints on a live Customize change — the T.*
    /// tokens it reads aren't observable on their own.
    @Environment(ThemeSettings.self) private var theme

    /// Frozen snapshot from the caller — seed and fallback only.
    let seedJob: Job
    /// When set (arrived from a Schedule block or a deep link), this panel opens
    /// expanded rather than collapsed.
    var highlightPanelId: String? = nil
    /// When set, marks the matching op row inside that panel.
    var highlightOpId: String? = nil
    /// Called after the popup has animated ITSELF out. The presenter must not
    /// tear it down before this fires.
    let onClose: () -> Void

    /// Drives the shared modal entrance/exit — see ModalPop.
    @State private var appear = false
    /// Panels the reader has opened. Expansion is a READING affordance, not an
    /// edit, so it survives the read-only cut.
    @State private var expanded: Set<String> = []

    /// ONE curve for opening a panel and for the popup growing around it. Both
    /// have to be the same animation or the edges arrive after the content and
    /// the panel reads as resizing in two stages.
    private let disclosure: Animation = .easeInOut(duration: 0.26)

    /// Live job, re-read by id every render so a sync landing behind the popup
    /// shows through. Falls back to the seed if the job is momentarily absent
    /// mid-sync, or was deleted from another device while this was open.
    private var job: Job { appState.jobs.first(where: { $0.id == seedJob.id }) ?? seedJob }

    private var clientName: String? {
        let n = appState.client(for: job)?.name
        return (n?.isEmpty == false) ? n : nil
    }

    private var teamNames: String {
        job.team.compactMap { appState.person(id: $0)?.name }.joined(separator: ", ")
    }

    /// Department tag styling, mirroring JobDetailView's mapping.
    private var dept: (label: String, kind: TagKind) {
        let key = (job.jobType ?? "").lowercased()
        if key.contains("repair") || key.contains("break") { return (job.jobType?.uppercased() ?? "REPAIR", .amber) }
        if key.contains("inspect") || key.contains("install") { return (job.jobType?.uppercased() ?? "INSTALL", .indigo) }
        if key.contains("layout")  { return ("LAYOUT", .magenta) }
        if key.contains("wire")    { return ("WIRE", .sky) }
        if key.contains("contract") { return ("CONTRACT", .green) }
        let label = (job.jobType?.uppercased()).flatMap { $0.isEmpty ? nil : $0 } ?? "JOB"
        return (label, .indigo)
    }

    var body: some View {
        _ = theme.frostedGlass; _ = theme.accent
        // GeometryReader, so the card gets an EXPLICIT height ceiling.
        //
        // `HugScroll` sizes to its content but clamps to whatever it is offered,
        // and inside a page it was offered a height it could not trust: the Jobs
        // stack adds a bottom safe-area inset for the nav pill, the popup then
        // ignored that edge again, and an expanded panel simply grew past the
        // glass and out the bottom of the screen. In a cover the geometry is
        // just the screen, and `min(content, screen - 80)` is a number both the
        // panel and the scroller agree on.
        return GeometryReader { geo in
            ZStack {
                // Nothing here can be half-finished, so a tap outside is always
                // just "done reading".
                ModalScrim { close() }

                card
                    .frame(maxHeight: max(0, geo.size.height - 80))
                    .modalPop(appear)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        // The jobs list shows through; MainTabView blurs it (header and nav pill
        // included) via appNav.modalBlur, which the presenter sets.
        .presentationBackground(.clear)
        .onAppear {
            if let pid = highlightPanelId { expanded.insert(pid) }
            withAnimation(modalPopAnimation) { appear = true }
        }
    }

    private func close() {
        modalPopDismiss({ appear = $0 }, then: onClose)
    }

    // MARK: The card

    private var card: some View {
        VStack(alignment: .leading, spacing: 14) {
            head
            LiveHeightScroll(animation: disclosure) {
                VStack(alignment: .leading, spacing: 14) {
                    titleBlock
                    detailsCard
                    if !job.subs.isEmpty { panelsSection }
                    if !job.notes.isEmpty { notesCard }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(T.insetHero)
        // Headroom for the close X — the 46pt every other popup reserves, so the
        // eyebrow clears a 36pt button inset 18pt from a 46pt corner.
        .padding(.top, 46)
        .frame(maxWidth: 420)
        .glassPanel()
        // Anchored INSIDE the card (after the glass, before the outer padding),
        // so it sits on the panel rather than floating in the backdrop.
        .overlay(alignment: .topLeading) {
            Button { close() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color(hex: T.ink))
                    .frame(width: 36, height: 36)
                    .glassEffect(.regular.interactive(), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(18)
        }
        .padding(.horizontal, 20)
    }

    /// The identifying line, held OUT of the scroll so it stays put while you
    /// read down a long job.
    private var head: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("JOB DETAILS")
                .font(TTypo.xsBold(10))
                .tLabel(tracking: 1.4)
                .foregroundStyle(Color(hex: T.muted))
            HStack(spacing: 10) {
                if let n = job.jobNumber, !n.isEmpty {
                    Text("#\(n)")
                        .font(TTypo.mono(13)).tnum()
                        .foregroundStyle(Color(hex: T.ink))
                }
                if let po = job.poNumber, !po.isEmpty {
                    Text("PO \(po)")
                        .font(TTypo.mono(13)).tnum()
                        .foregroundStyle(Color(hex: T.muted))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Title + progress

    private var titleBlock: some View {
        let pct = appState.jobPct(job)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                TagPill(label: dept.label, kind: dept.kind)
                Spacer(minLength: 8)
                JobStatusBadge(job: job)
            }

            Text(job.title)
                .font(.custom(TFontName.bold.rawValue, size: 22))
                .foregroundStyle(Color(hex: T.ink))
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                PriorityDot(priority: job.pri)
                Text(job.pri.rawValue)
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(job.pri.color)
            }

            HStack(spacing: 10) {
                Bar(pct: Double(pct), height: 7, gradient: T.brandGradient())
                Text("\(pct)%")
                    .font(TTypo.monoBold(12)).tnum()
                    .foregroundStyle(Color(hex: T.accentGradientStart))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Details
    //
    // A label/value list, not the two-column InfoCell grid the pushed page used.
    // At popup width those cells wrap to one line each and truncate the very
    // values you opened this to read; a list gives every value the full width.

    private var detailItems: [(String, String)] {
        var items: [(String, String)] = []
        if let c = clientName { items.append(("Customer", c)) }
        items.append(("Start", job.start.shortDate))
        items.append(("End", job.end.shortDate))
        if let due = job.dueDate, !due.isEmpty { items.append(("Due", due.shortDate)) }
        items.append(("Panels", "\(job.subs.count)"))
        if !teamNames.isEmpty { items.append(("Team", teamNames)) }
        return items
    }

    private var detailsCard: some View {
        SBox(size: .lg) {
            VStack(alignment: .leading, spacing: 0) {
                sectionLabel("DETAILS").padding(.bottom, 6)
                ForEach(Array(detailItems.enumerated()), id: \.offset) { idx, item in
                    if idx > 0 { SLine() }
                    HStack(alignment: .top, spacing: 12) {
                        Text(item.0.uppercased())
                            .font(TTypo.xsBold(10))
                            .tLabel(tracking: 0.8)
                            .foregroundStyle(Color(hex: T.muted))
                            .frame(width: 72, alignment: .leading)
                        Text(item.1)
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.ink))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 10)
                }
            }
            .padding(16)
        }
    }

    // MARK: Panels

    private var panelsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                sectionLabel("PANELS")
                Spacer()
                Text("\(job.subs.count)")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }
            .padding(.horizontal, 2)

            ForEach(job.subs) { panel in
                panelCard(panel)
            }
        }
    }

    private func panelCard(_ panel: Panel) -> some View {
        let pct = appState.panelPct(panel)
        let isOpen = expanded.contains(panel.id)
        let isHighlighted = panel.id == highlightPanelId
        return SBox(size: .md, sky: isHighlighted) {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(disclosure) {
                        if isOpen { expanded.remove(panel.id) } else { expanded.insert(panel.id) }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 7) {
                        HStack(spacing: 6) {
                            Text(panel.title)
                                .font(TTypo.smBold(14))
                                .foregroundStyle(Color(hex: T.ink))
                                .lineLimit(1)
                            if isHighlighted { TagPill(label: "YOU", kind: .sky) }
                            Spacer(minLength: 6)
                            StatusBadge(status: panel.status)
                            Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                                .font(.caption)
                                .foregroundStyle(Color(hex: T.muted))
                        }
                        Text(panel.start.shortDate + " → " + panel.end.shortDate)
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                        HStack(spacing: 8) {
                            Bar(pct: Double(pct), height: 5, fill: progressFill(pct))
                            Text("\(pct)%")
                                .font(TTypo.monoBold(11)).tnum()
                                .foregroundStyle(progressFill(pct))
                            Spacer(minLength: 8)
                            engineeringDots(panel)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if isOpen {
                    if !panel.subs.isEmpty {
                        SLine().padding(.vertical, 8)
                        VStack(spacing: 0) {
                            ForEach(panel.subs) { op in
                                opRow(op, panel: panel)
                            }
                        }
                    }
                    if panel.engineering != nil {
                        SLine().padding(.vertical, 8)
                        engineeringStamps(panel)
                    }
                    if !panel.attachments.isEmpty {
                        SLine().padding(.vertical, 8)
                        PanelAttachmentGallery(attachments: panel.attachments)
                    }
                }
            }
            .padding(14)
        }
    }

    /// The three-step engineering chain, at a glance, on the collapsed header.
    private func engineeringDots(_ panel: Panel) -> some View {
        HStack(spacing: 4) {
            ForEach(EngStep.allCases, id: \.self) { step in
                Circle()
                    .fill(signOff(panel, step) != nil ? Color(hex: T.statusFinished) : Color(hex: T.hair))
                    .frame(width: 8, height: 8)
            }
        }
    }

    /// Sign-off as a RECORD — who and when — rather than the buttons that set
    /// it. Signing off happens in the Approval Queue.
    private func engineeringStamps(_ panel: Panel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ENGINEERING")
                .font(TTypo.xsBold(10))
                .tLabel(tracking: 0.8)
                .foregroundStyle(Color(hex: T.muted))
            ForEach(EngStep.allCases, id: \.self) { step in
                let s = signOff(panel, step)
                HStack(spacing: 8) {
                    Image(systemName: s != nil ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: s != nil ? T.statusFinished : T.hair))
                    Text(step.label)
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: s != nil ? T.ink : T.muted))
                    Spacer(minLength: 8)
                    if let s {
                        Text(s.byName)
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(Color(hex: T.muted))
                            .lineLimit(1)
                    } else {
                        Text("Not signed")
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                }
            }
        }
    }

    private func signOff(_ panel: Panel, _ step: EngStep) -> EngineeringSignOff? {
        switch step {
        case .designed:       return panel.engineering?.designed
        case .verified:       return panel.engineering?.verified
        case .sentToPerforex: return panel.engineering?.sentToPerforex
        }
    }

    // MARK: One op

    @ViewBuilder
    private func opRow(_ op: Operation, panel: Panel) -> some View {
        let pct = appState.opPct(op)
        let over = appState.isPctOverdue(pct)
        let isHighlighted = op.id == highlightOpId && panel.id == highlightPanelId
        let crew = op.team.compactMap { appState.person(id: $0)?.name }.joined(separator: ", ")
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(op.status.color)
                .frame(width: 7, height: 7)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(op.title)
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.ink))
                    if op.pendingFinish == true {
                        TagPill(label: "Finish Requested", kind: .amber)
                    }
                }
                Text(op.start.shortDate + " → " + op.end.shortDate)
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
                if !crew.isEmpty {
                    // Plain text. Tapping the crew line used to open the team
                    // picker; assigning is not something this popup does.
                    Text(crew)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
                HStack(spacing: 6) {
                    Bar(pct: Double(pct), height: 5,
                        fill: Color(hex: T.amber),
                        gradient: over ? nil : T.brandGradient())
                        .frame(maxWidth: 100)
                    Text("\(pct)%")
                        .font(TTypo.monoBold(10)).tnum()
                        .foregroundStyle(Color(hex: over ? T.amber : T.accentGradientStart))
                }
                .padding(.top, 1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .background(isHighlighted ? Color(hex: T.sky).opacity(0.10) : Color.clear)
        .overlay(alignment: .leading) {
            if isHighlighted {
                Rectangle().fill(Color(hex: T.sky)).frame(width: 3)
            }
        }
    }

    // MARK: Notes

    private var notesCard: some View {
        SBox(size: .lg) {
            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("NOTES")
                Text(job.notes)
                    .font(TTypo.body(14))
                    .foregroundStyle(Color(hex: T.muted))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    private func sectionLabel(_ s: String) -> some View {
        Text(s)
            .font(TTypo.xsBold(10))
            .tLabel(tracking: 1.2)
            .foregroundStyle(Color(hex: T.muted))
    }
}
