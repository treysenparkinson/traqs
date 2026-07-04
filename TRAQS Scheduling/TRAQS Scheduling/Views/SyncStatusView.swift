import SwiftUI

// MARK: - Shake (Phase 6, STEP 3)
//
// A horizontal shake driven by an incrementing token. Native, no deps. Bump the
// token (e.g. on a save/send failure) and the modified view shakes once. Usage:
//   @State private var shakeToken = 0
//   TextField(...).shakeIfChanged(shakeToken)
//   // on failure: shakeToken += 1

private struct ShakeGeometry: GeometryEffect {
    var travel: CGFloat = 6
    var shakes: CGFloat = 3
    var animatableData: CGFloat   // = token; SwiftUI interpolates 0→1 on change
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(
            translationX: travel * sin(animatableData * .pi * 2 * shakes), y: 0))
    }
}

struct ShakeIfChanged: ViewModifier {
    /// Bump this Int to trigger exactly one shake.
    var token: Int
    func body(content: Content) -> some View {
        content
            .modifier(ShakeGeometry(animatableData: CGFloat(token)))
            .animation(.linear(duration: 0.4), value: token)
    }
}

extension View {
    /// Shake once each time `token` increments.
    func shakeIfChanged(_ token: Int) -> some View { modifier(ShakeIfChanged(token: token)) }
}

// MARK: - Sync status indicator (Phase 6, STEP 4)
//
// Silent when everything is healthy (renders nothing). Shows a small colored dot
// only when there's something worth surfacing. Tapping expands a one-line status
// message; there's no dismissable alert — if the user can't act on it, we don't
// nag. States come from AppState.syncBadge (network reachability + Ably state +
// sync-in-flight + recent failure), debounced upstream so it doesn't flicker.

struct SyncStatusDot: View {
    @Environment(AppState.self) private var appState
    @State private var expanded = false
    @State private var collapseTask: Task<Void, Never>?

    var body: some View {
        let badge = appState.syncBadge
        Group {
            if badge != .hidden {
                content(for: badge)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: badge)
        // Reset the expanded label whenever the state changes.
        .onChange(of: badge) { _, _ in expanded = false }
    }

    @ViewBuilder
    private func content(for badge: AppState.SyncBadge) -> some View {
        let showText = expanded || badge == .reconnected   // reconnected auto-announces
        HStack(spacing: 6) {
            if badge == .syncing {
                ProgressView().scaleEffect(0.6).frame(width: 10, height: 10)
            } else {
                Circle().fill(color(for: badge)).frame(width: 8, height: 8)
                    .shadow(color: color(for: badge).opacity(0.5), radius: 3)
            }
            if showText, let msg = message(for: badge) {
                Text(msg)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
        }
        .padding(.horizontal, showText ? 10 : 7)
        .padding(.vertical, 5)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(color(for: badge).opacity(0.25), lineWidth: 1))
        .contentShape(Capsule())
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
            scheduleCollapse()
        }
    }

    private func scheduleCollapse() {
        collapseTask?.cancel()
        guard expanded else { return }
        collapseTask = Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run { withAnimation { expanded = false } }
        }
    }

    private func color(for badge: AppState.SyncBadge) -> Color {
        switch badge {
        case .reconnected:  return .green
        case .reconnecting: return .orange
        case .offline, .error: return .red
        case .syncing, .hidden: return .secondary
        }
    }

    private func message(for badge: AppState.SyncBadge) -> String? {
        switch badge {
        case .reconnected:  return "Reconnected"
        case .reconnecting: return "Reconnecting…"
        case .offline:      return "Offline — changes won't sync"
        case .error:        return "Sync problem — will retry"
        case .syncing, .hidden: return nil
        }
    }
}
