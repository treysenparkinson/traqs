import SwiftUI

// MARK: - The brand strip
//
// The app-wide bar across the top of the window (TRAQS.jsx:24582):
//
//   ── Brand strip — logo + undo/redo + search/ask + save/bell/settings ──
//
// It spans the FULL WIDTH, above the sidebar-and-content row — so it is a sibling
// of that row in the shell, not something inside the content panel. The Mac app
// was missing it entirely.
//
// Its "Ask TRAQS" centre section is archived on the web ("Keep the markup intact
// so we can re-enable"), so there is nothing to port there and a spacer holds the
// space its absence leaves.
struct BrandStrip: View {
    @Environment(\.tqTheme) private var theme
    @Environment(AppState.self) private var appState

    /// `padding: "18px 32px 18px 14px"`, `gap: 18`.
    private let vPad: CGFloat = 18
    private let leadPad: CGFloat = 14
    private let trailPad: CGFloat = 32
    private let gap: CGFloat = 18

    @State private var notifOpen = false

    var body: some View {
        HStack(spacing: gap) {
            lockup
            undoRedo
            Spacer(minLength: 0)          // where Ask TRAQS sits, archived
            saveStatus
            notificationBell
        }
        .padding(.top, vPad)
        .padding(.bottom, vPad)
        .padding(.leading, leadPad)
        .padding(.trailing, trailPad)
        // `background: Tc.surfaceSolid` — the chrome theme's surface, which is
        // what makes the strip and the sidebar read as one piece of chrome
        // against the content panel's bg.
        .background(theme.surface)
    }

    // MARK: Logo

    /// `fontSize: 40`, `marginLeft: 45`, `top: 5`, and a 0.6px stroke — a much
    /// lighter thickening than the login screen's 1.5, because 40pt does not need
    /// as much help as 84pt does.
    ///
    /// The accent bar follows the THEME here, unlike the gate's, which has no
    /// theme to follow.
    private var lockup: some View {
        GateLockup(size: 40,
                   color: theme.text,
                   stroke: 0.6,
                   barsAccent: theme.accent)
            .padding(.leading, 45)          // marginLeft: 45
            // "Nudged down with a relative offset rather than margin so the brand
            // strip keeps its height — a margin would grow the bar by the same
            // 10px." Same reasoning applies to an offset here.
            .offset(y: 5)                   // top: 5
    }

    // MARK: Undo / Redo
    //
    // 28pt circles, and DISABLED-LOOKING rather than hidden when there is nothing
    // to undo: the web drops them to 0.3 opacity and removes the border, so the
    // pair never changes width.
    //
    // Not wired to anything yet. The Mac app has no undo stack — that is a
    // separate piece of work — so these render in their disabled state, which is
    // exactly what the web shows with an empty history.
    private var undoRedo: some View {
        HStack(spacing: 2) {
            chromeButton("↩", enabled: false, help: "Undo (Ctrl+Z)")
            chromeButton("↪", enabled: false, help: "Redo (Ctrl+Shift+Z)")
        }
        .offset(y: 8)                       // marginTop: 8
    }

    /// A chrome control. GLASS, like every button in the app that is not a
    /// sidebar row or a list row — see `ShellGlass`.
    ///
    /// Disabled drops the glass entirely rather than dimming it. A dimmed piece of
    /// glass still reads as pressable; no material reads as off, which is the same
    /// call the iOS app made for its disabled controls.
    private func chromeButton(_ glyph: String, enabled: Bool, help: String) -> some View {
        Text(glyph)
            .font(.system(size: 14))
            .foregroundStyle(theme.textSec)
            .frame(width: 28, height: 28)
            .shellGlass(enabled: enabled, in: Capsule())
            .opacity(enabled ? 1 : 0.3)
            .help(help)
    }

    // MARK: Save status
    //
    // "Saved" / "Saving..." / "Unsaved", and clicking it saves now. `minWidth: 52`
    // on the label so the strip does not reflow as the wording changes.
    private var saveStatus: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(statusLabel)
                .font(TFont.body(11, 500))
                .foregroundStyle(statusColor)
                .frame(minWidth: 52, alignment: .leading)
        }
        .opacity(0.85)
        .help("Click to save now")
    }

    private var statusLabel: String {
        switch appState.saveStatus {
        case .saving: return "Saving..."
        case .saved:  return "Saved"
        default:      return "Unsaved"
        }
    }

    private var statusColor: Color {
        switch appState.saveStatus {
        case .saved:  return .hex("#10b981")
        case .saving: return theme.accent
        default:      return theme.textSec
        }
    }

    // MARK: Bell
    //
    // `Notification Bell` (TRAQS.jsx:24697). A LABELLED PILL, not a bare icon:
    // padding 7/14, the traced legacy bell at 18pt, "Notifications" at 12pt/600
    // with -0.045em tracking, and a red count badge pinned at -4/-4.
    //
    // Open state tints it with the accent. Glass here too.
    private var notificationBell: some View {
        Button { notifOpen.toggle() } label: {
            HStack(spacing: 8) {
                WebGlyph(spec: WebIcon.bell, size: 18,
                         color: notifOpen ? theme.accent : theme.textSec)
                Text("Notifications")
                    .font(TFont.body(12, 600))
                    .tracking(12 * -0.045)
                    .foregroundStyle(notifOpen ? theme.accent : theme.textSec)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .shellGlass(tint: notifOpen ? theme.accent.opacity(0.15) : nil, in: Capsule())
            .overlay(alignment: .topTrailing) {
                if unreadCount > 0 {
                    Text(unreadCount > 9 ? "9+" : "\(unreadCount)")
                        .font(TFont.body(9, 700))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(Capsule().fill(Color.hex("#ef4444")))
                        .offset(x: 4, y: -4)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help("Notifications for new messages & job updates")
    }

    /// The badge count. Messages are the one unread source the Mac app already
    /// tracks; the web's panel also lists job events, which arrive with that pass.
    private var unreadCount: Int { appState.totalUnreadMessages }
}
