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

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                // Sticky header — chevron.left back button (matches AdminView).
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color(hex: T.ink))
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(Color(hex: T.surface)))
                            .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
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
                            GradientCTA(disabled: false, dimmed: false, fullWidth: true,
                                        verticalPadding: 13, action: { showTimeOffSheet = true }) {
                                HStack(spacing: 7) {
                                    Image(systemName: "calendar.badge.plus")
                                    Text("REQUEST TIME OFF").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                                }
                            }
                            ForEach(myTimeOffRequests) { req in
                                TimeOffRequestCard(request: req) {
                                    Task { await appState.cancelTimeOff(id: req.id) }
                                }
                            }
                            if myTimeOffRequests.isEmpty {
                                TimeOffEmptyState()
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.hidden)
                .topFadeMask()
                .refreshable { await appState.refreshTimeOffRequests() }
            }
        }
        .task { await appState.refreshTimeOffRequests() }
        .sheet(isPresented: $showTimeOffSheet) {
            RequestTimeOffSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    /// My time-off requests, pending first, then newest start date.
    private var myTimeOffRequests: [TimeOffRequest] {
        let order: [String: Int] = ["pending": 0, "approved": 1, "denied": 2, "cancelled": 3]
        return appState.timeOffRequests.sorted { a, b in
            let oa = order[a.status] ?? 9, ob = order[b.status] ?? 9
            if oa != ob { return oa < ob }
            return a.start > b.start
        }
    }
}

// MARK: - Time Off request card (one per request, with status + cancel)

private struct TimeOffRequestCard: View {
    let request: TimeOffRequest
    let onCancel: () -> Void

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
        let out = DateFormatter(); out.dateFormat = "MMM d"
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
        .padding(14)
        .frostedCard(radius: T.cornerMd)
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
        .padding(22)
        .frostedCard()
    }
}

// MARK: - Request Time Off sheet (date range + PTO/UTO + note)

private struct RequestTimeOffSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var type = "PTO"
    @State private var start = Date()
    @State private var end = Date()
    @State private var note = ""
    @State private var submitting = false
    @State private var error: String?

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
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Request Time Off")
                        .font(TTypo.h3(20))
                        .foregroundStyle(Color(hex: T.ink))
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 18)

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
                .frostedCard(radius: T.cornerMd)

                VStack(alignment: .leading, spacing: 8) {
                    Text("NOTE (OPTIONAL)")
                        .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                        .foregroundStyle(Color(hex: T.muted))
                    TextField("Reason…", text: $note, axis: .vertical)
                        .lineLimit(1...3)
                        .font(TTypo.sm(14))
                        .foregroundStyle(Color(hex: T.ink))
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).fill(Color(hex: T.surface)))
                        .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
                }

                if let error {
                    Text(error)
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: "#DC2626"))
                }

                Spacer()

                GradientCTA(disabled: submitting || !validRange,
                            dimmed: submitting || !validRange,
                            fullWidth: true, verticalPadding: 14, action: submit) {
                    HStack(spacing: 7) {
                        if submitting {
                            ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(0.7)
                        }
                        Text(submitting ? "SUBMITTING…" : "SUBMIT REQUEST")
                            .font(TTypo.smBold(14)).tLabel(tracking: 0.8)
                    }
                }
                .padding(.bottom, 18)
            }
            .padding(.horizontal, 20)
        }
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
                try await appState.submitTimeOff(type: type, start: s, end: e, note: n)
                submitting = false
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                submitting = false
            }
        }
    }
}
