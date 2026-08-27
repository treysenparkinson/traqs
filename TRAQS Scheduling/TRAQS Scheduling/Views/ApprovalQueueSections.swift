import SwiftUI

// Finish-request and time-off sections for the Approval Queue.
//
// The queue previously covered engineering sign-off steps only, so finish
// requests had to be found by scrolling chat and time-off lived on its own
// screen. These render alongside the engineering buckets in ApprovalQueueView.
//
// Each section returns nothing when the viewer lacks the capability — the
// gating lives in AppState (pendingFinishRequests / pendingTimeOffRequests), so
// the view can't accidentally show a row the server would refuse.

/// One pending finish request, with approve / decline.
struct FinishRequestRow: View {
    @Environment(AppState.self) private var appState
    let item: AppState.PendingFinish

    @State private var busy = false
    @State private var declining = false
    @State private var reason = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.job.title)
                    .font(TTypo.smBold(15))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(2)
                if !item.contextLabel.isEmpty {
                    // Which panel/op this was raised against. Job-level requests
                    // have none, and this stays out of their way.
                    Text(item.contextLabel)
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
                Text("\(item.request.byName) · \(relativeAt)")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }

            if declining {
                TextField("Reason for declining", text: $reason, axis: .vertical)
                    .font(TTypo.sm(13))
                    .lineLimit(1...3)
                    .textFieldStyle(.roundedBorder)
                HStack(spacing: 10) {
                    Button("Cancel") { declining = false; reason = "" }
                        .font(TTypo.smBold(13))
                        .foregroundStyle(Color(hex: T.muted))
                    Spacer()
                    Button("Decline") { decline() }
                        .font(TTypo.smBold(13))
                        .foregroundStyle(Color(hex: T.red))
                        .disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                }
                .buttonStyle(.plain)
            } else {
                // Tinted glass — same pair, same treatment as the deny/approve
                // buttons further down this file.
                let shape = RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous)
                HStack(spacing: 10) {
                    Button { decline0() } label: {
                        Label("Decline", systemImage: "xmark")
                            .font(TTypo.smBold(13))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .foregroundStyle(glassCTALabel(Color(hex: T.red)))
                            .glassCTA(in: shape, tint: Color(hex: T.red))
                    }
                    Button { approve() } label: {
                        Label("Approve", systemImage: "checkmark")
                            .font(TTypo.smBold(13))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .foregroundStyle(glassCTALabel(Color(hex: T.green)))
                            .glassCTA(in: shape, tint: Color(hex: T.green))
                    }
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .opacity(busy ? 0.5 : 1)
            }
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
    }

    private var relativeAt: String {
        guard let d = ISO8601DateFormatter().date(from: item.request.at) else { return "" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: d, relativeTo: Date())
    }

    /// Reject requires a reason, so the first tap opens the field rather than
    /// firing the decline.
    private func decline0() { declining = true }

    private func approve() {
        busy = true
        Task {
            await appState.approveJobCompletion(jobId: item.job.id,
                                                panelId: item.panelId, opId: item.opId,
                                                requestId: item.request.id)
            busy = false
        }
    }

    private func decline() {
        busy = true
        Task {
            // denyJobCompletion takes no reason parameter — the entry model has a
            // declineReason field but the iOS method never sets it. The typed reason
            // is still required before the button enables, so the decline is a
            // deliberate act; wiring it through needs the method widened.
            await appState.denyJobCompletion(jobId: item.job.id,
                                             panelId: item.panelId, opId: item.opId,
                                             requestId: item.request.id)
            declining = false
            reason = ""
            busy = false
        }
    }
}

/// One pending time-off request, with approve / deny.
struct TimeOffQueueRow: View {
    @Environment(AppState.self) private var appState
    let request: TimeOffRequest

    @State private var busy = false
    @State private var denying = false
    @State private var reason = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(request.personName)
                        .font(TTypo.smBold(15))
                        .foregroundStyle(Color(hex: T.ink))
                    Text(request.type)
                        .font(TTypo.xsBold(10))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(Color(hex: T.accent).opacity(0.15)))
                        .foregroundStyle(Color(hex: T.accent))
                }
                Text(request.start == request.end ? request.start : "\(request.start) → \(request.end)")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
                if !request.note.isEmpty {
                    Text(request.note)
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(3)
                }
            }

            if denying {
                TextField("Reason for denying", text: $reason, axis: .vertical)
                    .font(TTypo.sm(13))
                    .lineLimit(1...3)
                    .textFieldStyle(.roundedBorder)
                HStack(spacing: 10) {
                    Button("Cancel") { denying = false; reason = "" }
                        .font(TTypo.smBold(13))
                        .foregroundStyle(Color(hex: T.muted))
                    Spacer()
                    Button("Deny") { decide("deny") }
                        .font(TTypo.smBold(13))
                        .foregroundStyle(Color(hex: T.red))
                        .disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                }
                .buttonStyle(.plain)
            } else {
                // Tinted glass, matching the approve/deny pair on the time-off
                // cards and in the message thread. These were a 10%-opacity
                // wash behind coloured text, which read as a status chip rather
                // than as the two buttons that resolve the request.
                let shape = RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous)
                HStack(spacing: 10) {
                    Button { denying = true } label: {
                        Label("Deny", systemImage: "xmark")
                            .font(TTypo.smBold(13))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .foregroundStyle(glassCTALabel(Color(hex: T.red)))
                            .glassCTA(in: shape, tint: Color(hex: T.red))
                    }
                    Button { decide("approve") } label: {
                        Label("Approve", systemImage: "checkmark")
                            .font(TTypo.smBold(13))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .foregroundStyle(glassCTALabel(Color(hex: T.green)))
                            .glassCTA(in: shape, tint: Color(hex: T.green))
                    }
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .opacity(busy ? 0.5 : 1)
            }
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
    }

    private func decide(_ action: String) {
        busy = true
        Task {
            _ = await appState.decideTimeOff(id: request.id, action: action, reason: reason)
            denying = false
            reason = ""
            busy = false
        }
    }
}
