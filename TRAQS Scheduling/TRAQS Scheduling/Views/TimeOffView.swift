import SwiftUI

// MARK: - TimeOffView · PTO/UTO requests
//
// Full-page nav view (NOT the Hours tab anymore) reached from the side
// drawer or a tapped time-off push. Mirrors AdminView's pattern: a sticky
// chevron-left header over a ScrollView. Submit a request → admins
// approve/deny on the desktop; approved requests flow into the schedule +
// accountant export.

struct TimeOffView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var showTimeOffSheet = false
    @State private var editingRequest: TimeOffRequest?

    var body: some View {
        ZStack {
            PageBackground()

            VStack(spacing: 0) {
                // Sticky header — chevron.left back button (matches AdminView).
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        HeaderGlassCircle {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Color(hex: T.ink))
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)

                ScrollView {
                    VStack(spacing: 0) {
                        PageTitle(title: "Time Off")
                            .padding(.top, pageTitleTopInset)
                            .padding(.bottom, 10)

                        VStack(spacing: 12) {
                            // The popup owns its whole entrance (see ModalPop),
                            // so the write that presents it must not animate.
                            GradientCTA(glass: true,
                                        disabled: false, dimmed: false, fullWidth: true,
                                        verticalPadding: 13,
                                        action: {
                                            withTransaction(.noAnimation) {
                                                showTimeOffSheet = true
                                            }
                                        }) {
                                HStack(spacing: 7) {
                                    Image(systemName: "calendar.badge.plus")
                                    Text("REQUEST TIME OFF").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                                }
                            }

                            // Admins: pending requests from others, with
                            // Approve/Deny. This is where a tapped time-off push
                            // lands, so the approver can act right here.
                            if !pendingApprovals.isEmpty {
                                sectionHeader("Pending Approvals")
                                ForEach(pendingApprovals) { req in
                                    TimeOffApprovalCard(request: req)
                                }
                            }

                            if !myTimeOffRequests.isEmpty {
                                if !pendingApprovals.isEmpty { sectionHeader("My Requests") }
                                ForEach(myTimeOffRequests) { req in
                                    TimeOffRequestCard(request: req, onCancel: {
                                        Task { await appState.cancelTimeOff(id: req.id) }
                                    }, onEdit: {
                                        withTransaction(.noAnimation) { editingRequest = req }
                                    })
                                }
                            }

                            if myTimeOffRequests.isEmpty && pendingApprovals.isEmpty {
                                TimeOffEmptyState()
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.visible)
                .topFadeMask()
                .refreshable { await appState.refreshTimeOffRequests() }
            }
            // Blur the PAGE, not the wash behind it and not the popup on top —
            // an in-hierarchy modal has to blur its own backdrop, since there's
            // no presentation boundary doing it (see `modalPageBlur`).
            .modalPageBlur(popupShown)

            // The popups. `.transition(.identity)` and no `.animation` on the
            // flags: each one owns its entrance and exit, and anything the
            // presenter animates plays underneath it as a glitch (see ModalPop).
            if showTimeOffSheet {
                RequestTimeOffOverlay {
                    withTransaction(.noAnimation) { showTimeOffSheet = false }
                }
                .transition(.identity)
            }
            if let req = editingRequest {
                RequestTimeOffOverlay(editing: req) {
                    withTransaction(.noAnimation) { editingRequest = nil }
                }
                .transition(.identity)
            }
        }
        .task { await appState.refreshTimeOffRequests() }
    }

    /// True while either popup is up — drives the page blur behind it.
    private var popupShown: Bool { showTimeOffSheet || editingRequest != nil }

    private var myId: String? { appState.currentPersonId }

    /// My OWN time-off requests, pending first, then newest start date. The
    /// admin member endpoint returns everyone's requests, so scope to me here —
    /// others' requests live in `pendingApprovals`.
    private var myTimeOffRequests: [TimeOffRequest] {
        let order: [String: Int] = ["pending": 0, "approved": 1, "denied": 2, "cancelled": 3]
        return appState.timeOffRequests
            .filter { myId == nil || $0.personId == myId }
            .sorted { a, b in
                let oa = order[a.status] ?? 9, ob = order[b.status] ?? 9
                if oa != ob { return oa < ob }
                return a.start > b.start
            }
    }

    /// Admin only: pending requests from OTHER people awaiting a decision,
    /// soonest start first.
    private var pendingApprovals: [TimeOffRequest] {
        guard appState.isAdmin else { return [] }
        return appState.timeOffRequests
            .filter { $0.status == "pending" && (myId == nil || $0.personId != myId) }
            .sorted { $0.start < $1.start }
    }

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title.uppercased())
                .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                .foregroundStyle(Color(hex: T.muted))
            Spacer()
        }
        .padding(.top, 6)
    }
}

// MARK: - Time Off request card (one per request, with status + cancel)

private struct TimeOffRequestCard: View {
    let request: TimeOffRequest
    let onCancel: () -> Void
    var onEdit: (() -> Void)? = nil

    /// Editable while still open (dates edit re-triggers approval; type edit syncs).
    private var canEdit: Bool { request.status == "pending" || request.status == "approved" }

    private var typeColor: Color { request.type == "UTO" ? Color(hex: "#F59E0B") : Color(hex: "#10B981") }
    private var statusPill: (label: String, kind: TagKind, dot: Bool) {
        switch request.status {
        case "approved":  return ("Approved", .green, false)
        case "denied":    return ("Denied", .magenta, false)
        case "cancelled": return ("Cancelled", .neutral, false)
        default:          return ("Pending", .amber, true)
        }
    }
    private var rangeLabel: String {
        // Stored dates are pure "yyyy-MM-dd" calendar days. ISO8601DateFormatter
        // parses them at UTC midnight, so the output formatter MUST also be UTC —
        // otherwise a device in a negative-offset zone (all of the US) renders the
        // day BEFORE (e.g. "2026-07-04" → "Jul 3"), showing requesters and
        // approvers a date one day off from the real request.
        let out = DateFormatter(); out.dateFormat = "MMM d"
        out.timeZone = TimeZone(identifier: "UTC")
        let inF = ISO8601DateFormatter(); inF.formatOptions = [.withFullDate]
        let sL = inF.date(from: request.start).map(out.string(from:)) ?? request.start
        let eL = inF.date(from: request.end).map(out.string(from:)) ?? request.end
        return request.start == request.end ? sL : "\(sL) – \(eL)"
    }

    var body: some View {
        HStack(spacing: 12) {
            IconChip(icon: .cal, color: typeColor)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(request.type)
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.ink))
                    TagPill(label: statusPill.label, kind: statusPill.kind, dot: statusPill.dot)
                }
                Text(rangeLabel)
                    .font(TTypo.xs(12))
                    .foregroundStyle(Color(hex: T.muted))
                if request.status == "denied", let r = request.denialReason, !r.isEmpty {
                    Text("“\(r)”")
                        .font(TTypo.xs(11))
                        .italic()
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(2)
                } else if !request.note.isEmpty {
                    Text(request.note)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                if canEdit, let onEdit {
                    Button(action: onEdit) {
                        Text("Edit")
                            .font(TTypo.xsBold(11))
                            .tLabel(tracking: 0.4)
                            .foregroundStyle(Color(hex: T.accent))
                            .padding(.horizontal, 11).padding(.vertical, 6)
                            .background(Capsule().stroke(Color(hex: T.accent).opacity(0.4), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                if request.status != "cancelled" {
                    Button(action: onCancel) {
                        Text(request.status == "pending" ? "Cancel" : "Remove")
                            .font(TTypo.xsBold(11))
                            .tLabel(tracking: 0.4)
                            .foregroundStyle(Color(hex: T.muted))
                            .padding(.horizontal, 11).padding(.vertical, 6)
                            .background(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
    }
}

// MARK: - Approval card (admin) — approve/deny a pending request

private struct TimeOffApprovalCard: View {
    @Environment(AppState.self) private var appState
    let request: TimeOffRequest

    @State private var denying = false
    @State private var reason = ""
    @State private var busy = false
    @State private var failed = false

    private var typeColor: Color { request.type == "UTO" ? Color(hex: "#F59E0B") : Color(hex: "#10B981") }
    private var rangeLabel: String {
        // Stored dates are pure "yyyy-MM-dd" calendar days. ISO8601DateFormatter
        // parses them at UTC midnight, so the output formatter MUST also be UTC —
        // otherwise a device in a negative-offset zone (all of the US) renders the
        // day BEFORE (e.g. "2026-07-04" → "Jul 3"), showing requesters and
        // approvers a date one day off from the real request.
        let out = DateFormatter(); out.dateFormat = "MMM d"
        out.timeZone = TimeZone(identifier: "UTC")
        let inF = ISO8601DateFormatter(); inF.formatOptions = [.withFullDate]
        let sL = inF.date(from: request.start).map(out.string(from:)) ?? request.start
        let eL = inF.date(from: request.end).map(out.string(from:)) ?? request.end
        return request.start == request.end ? sL : "\(sL) – \(eL)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                IconChip(icon: .cal, color: typeColor)
                VStack(alignment: .leading, spacing: 3) {
                    Text(request.personName)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                    HStack(spacing: 8) {
                        Text(request.type)
                            .font(TTypo.xsBold(11)).tLabel(tracking: 0.4)
                            .foregroundStyle(typeColor)
                            .padding(.horizontal, 9).padding(.vertical, 3)
                            .background(Capsule().fill(typeColor.opacity(0.14)))
                        Text(rangeLabel)
                            .font(TTypo.smBold(14))
                            .foregroundStyle(Color(hex: T.ink))
                    }
                }
                Spacer(minLength: 8)
                TagPill(label: "Pending", kind: .amber, dot: true)
            }

            if !request.note.isEmpty {
                Text(request.note)
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
            }

            if failed {
                Text("Couldn't save — tap to try again")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: "#ef4444"))
            }

            if denying {
                VStack(spacing: 8) {
                    TextField("Reason (optional)…", text: $reason)
                        .textFieldStyle(.plain)
                        .font(TTypo.sm(13))
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(RoundedRectangle(cornerRadius: T.cornerSm).fill(Color(hex: T.surface)))
                        .overlay(RoundedRectangle(cornerRadius: T.cornerSm).stroke(Color(hex: T.hair), lineWidth: 1))
                    HStack(spacing: 8) {
                        Button { denying = false; reason = "" } label: {
                            Text("Cancel").font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.ink))
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                                .glassControl(in: Capsule())
                        }.buttonStyle(.plain).disabled(busy)
                        Button { decide("deny") } label: {
                            Text(busy ? "Saving…" : "Confirm Deny").font(TTypo.smBold(14)).foregroundStyle(T.onColor("#ef4444"))
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .glassCTA(tint: Color(hex: "#ef4444"))
                        }.buttonStyle(.plain).disabled(busy)
                    }
                }
            } else {
                HStack(spacing: 10) {
                    Button { denying = true } label: {
                        Text("Deny").font(TTypo.smBold(15)).foregroundStyle(T.onColor("#ef4444"))
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .glassCTA(tint: Color(hex: "#ef4444"))
                    }.buttonStyle(.plain).disabled(busy)
                    Button { decide("approve") } label: {
                        Text(busy ? "Saving…" : "Approve").font(TTypo.smBold(15)).foregroundStyle(T.onColor("#10b981"))
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .glassCTA(tint: Color(hex: "#10b981"))
                    }.buttonStyle(.plain).disabled(busy)
                }
            }
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
    }

    private func decide(_ action: String) {
        guard !busy else { return }
        busy = true
        failed = false
        Task {
            let ok = await appState.decideTimeOff(id: request.id, action: action, reason: reason)
            busy = false
            if ok {
                denying = false
                reason = ""
            } else {
                failed = true
            }
        }
    }
}

private struct TimeOffEmptyState: View {
    var body: some View {
        VStack(spacing: 8) {
            TIconView(icon: .cal, size: 24, color: Color(hex: T.muted))
            Text("No time-off requests")
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.muted))
            Text("Tap “Request time off” to submit PTO or UTO.")
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(T.insetHero)
        .frostedCard()
    }
}

// MARK: - Request Time Off popup (date range + PTO/UTO + note)
//
// A TRAQS popup, not a `.sheet`. It was a full-height system sheet with a drag
// indicator and a grey X floated in the corner — the last place in the app
// where submitting something arrived as an Apple tray instead of as a piece of
// the app's own glass. Now it's the house modal: the shared frosted panel, the
// shared spring entrance (ModalPop), the Liquid Glass X at the top-left, and a
// glass CTA carrying the submit.
//
// Presented as an in-hierarchy overlay rather than a cover, because this is a
// whole page and not a row in a scrolling list — so it can blur the page behind
// it directly (`modalPageBlur`) instead of going through appNav.
//
// Every field the sheet had is still here: PTO/UTO, the start and end dates,
// and the optional reason. The point of the popup is that it collects them.

private struct RequestTimeOffOverlay: View {
    @Environment(AppState.self) private var appState
    /// Observed so the submit spinner re-tints when the frosted-glass toggle
    /// flips — `glassCTALabel` reads a global SwiftUI can't track.
    @Environment(ThemeSettings.self) private var theme

    /// When set, edits this request instead of creating a new one.
    var editing: TimeOffRequest? = nil
    /// Called on cancel AND after a successful submit — the overlay runs its
    /// own exit animation first, so the page must NOT tear it down itself.
    let onClose: () -> Void

    @State private var type = "PTO"
    @State private var start = Date()
    @State private var end = Date()
    @State private var note = ""
    @State private var submitting = false
    @State private var error: String?
    @State private var didPrefill = false
    /// Drives the shared modal entrance/exit — see ModalPop. This view owns
    /// both; the page presenting it must not animate.
    @State private var appear = false

    private var isEditing: Bool { editing != nil }

    private static let ymd: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private var validRange: Bool {
        let cal = Calendar.current
        return cal.startOfDay(for: end) >= cal.startOfDay(for: start)
    }

    var body: some View {
        _ = theme.frostedGlass; _ = theme.accent
        return ZStack {
            // Tapping out cancels — nothing has happened yet, the request only
            // goes out from the CTA. Blocked mid-submit.
            ModalScrim { if !submitting { close() } }

            card.modalPop(appear)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .onAppear {
            prefillIfNeeded()
            withAnimation(modalPopAnimation) { appear = true }
        }
    }

    // MARK: Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(isEditing ? "Edit Time Off" : "Request Time Off")
                .font(TTypo.h3(20))
                .foregroundStyle(Color(hex: T.ink))

            // Sized to the form, scrolling ONLY if it can't fit.
            //
            // A bare ScrollView is greedy — it takes every point of height it's
            // offered — so wrapping the form in one grew the panel to the full
            // screen no matter how little it held. `ViewThatFits` uses the
            // plain stack when it fits (so the popup is exactly as tall as its
            // content) and falls back to the scroller only when it wouldn't.
            ViewThatFits(in: .vertical) {
                formFields
                ScrollView { formFields }.scrollBounceBehavior(.basedOnSize)
            }

            // The submit. Deliberately large and full-width — it's what the
            // popup exists for, and the only lit thing on the panel.
            GradientCTA(glass: true,
                        disabled: submitting || !validRange,
                        dimmed: submitting || !validRange,
                        fullWidth: true, verticalPadding: 17, action: submit) {
                HStack(spacing: 8) {
                    if submitting {
                        ProgressView().progressViewStyle(.circular)
                            .tint(glassCTALabel())
                            .scaleEffect(0.8)
                    }
                    Text(submitting ? (isEditing ? "SAVING…" : "SUBMITTING…")
                                    : (isEditing ? "SAVE CHANGES" : "SUBMIT REQUEST"))
                        .font(TTypo.smBold(15)).tLabel(tracking: 0.8)
                }
            }
        }
        .padding(T.insetHero)
        // Headroom for the cancel X — the same 46pt every other popup reserves,
        // so the title clears a 36pt button inset 18pt from a 46pt corner.
        .padding(.top, 46)
        .frame(maxWidth: 380)
        .glassPanel()
        // Cancel, anchored INSIDE the card's top-left (attached after the glass
        // but before the outer padding, so it sits on the card rather than
        // floating out in the backdrop). Same placement as the PIN pad's X.
        .overlay(alignment: .topLeading) {
            Button { if !submitting { close() } } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color(hex: T.ink))
                    .frame(width: 36, height: 36)
                    .glassEffect(.regular.interactive(), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(18)
        }
        .padding(.horizontal, 24)
        // Room top and bottom so a tall form can't reach the screen edges; the
        // ViewThatFits above hands over to its scroller before it gets there.
        .padding(.vertical, 40)
    }

    /// The form itself, built once and used by both `ViewThatFits` branches.
    private var formFields: some View {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("TYPE")
                            .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                            .foregroundStyle(Color(hex: T.muted))
                        Picker("", selection: $type) {
                            Text("PTO · paid").tag("PTO")
                            Text("UTO · unpaid").tag("UTO")
                        }
                        .pickerStyle(.segmented)
                    }

                    VStack(spacing: 4) {
                        DatePicker(selection: $start, displayedComponents: .date) {
                            Text("Start").font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.ink))
                        }
                        .tint(Color(hex: T.accentGradientStart))
                        SLine()
                        DatePicker(selection: $end, in: start..., displayedComponents: .date) {
                            Text("End").font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.ink))
                        }
                        .tint(Color(hex: T.accentGradientStart))
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    // A well INSIDE the glass panel, so the two date rows read
                    // as one grouped control rather than as loose text on the
                    // popup's face.
                    .glassSurface(in: RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous),
                                  rim: true)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("NOTE (OPTIONAL)")
                            .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                            .foregroundStyle(Color(hex: T.muted))
                        TextField("Reason…", text: $note, axis: .vertical)
                            .lineLimit(1...3)
                            .font(TTypo.sm(14))
                            .foregroundStyle(Color(hex: T.ink))
                            .padding(12)
                            // Native glass, matching the message composer's
                            // field — an input on a glass panel shouldn't be
                            // the one flat opaque box on it.
                            .glassControl(in: RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous),
                                          interactive: false)
                    }

                    if let error {
                        Text(error)
                            .font(TTypo.xs(12))
                            .foregroundStyle(Color(hex: "#DC2626"))
                    }
                }
    }

    /// Animates out first, THEN lets the page remove us — the shared modal exit.
    private func close() {
        modalPopDismiss({ appear = $0 }) { onClose() }
    }

    /// Seed the fields from the request being edited (once).
    private func prefillIfNeeded() {
        guard let r = editing, !didPrefill else { return }
        didPrefill = true
        type = r.type
        if let s = Self.ymd.date(from: r.start) { start = s }
        if let e = Self.ymd.date(from: r.end) { end = e }
        note = r.note
    }

    private func submit() {
        guard !submitting, validRange else { return }
        submitting = true
        error = nil
        let s = Self.ymd.string(from: start)
        let e = Self.ymd.string(from: end)
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                if let r = editing {
                    try await appState.editTimeOff(id: r.id, type: type, start: s, end: e, note: n)
                } else {
                    try await appState.submitTimeOff(type: type, start: s, end: e, note: n)
                }
                submitting = false
                close()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                submitting = false
            }
        }
    }
}
