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
    ///
    /// The 18 is SPLIT unevenly here, 10 above and 26 below, and the total is
    /// unchanged so nothing downstream moves. The traffic lights sit at a fixed
    /// height the window server chooses — roughly 14pt down, being 12pt buttons
    /// centred in a 28pt title bar — and the web's even padding put the lockup's
    /// centre at ~43, so the two read diagonally rather than as one row. Shifting
    /// the strip's contents up closes most of that gap.
    ///
    /// This is a Mac-only concern: the web app has no traffic lights to line up
    /// with, which is why it is the one number here not taken from TRAQS.jsx.
    private let topPad: CGFloat = 10
    private let bottomPad: CGFloat = 26
    private let leadPad: CGFloat = 14
    private let trailPad: CGFloat = 32
    private let gap: CGFloat = 18
    /// `marginLeft: 45` on the lockup (TRAQS.jsx:24599).
    private let lockupMarginLeft: CGFloat = 45

    /// The window has no title bar, so its CLOSE/MINIMISE/ZOOM buttons sit in this
    /// row. 78pt clears the rightmost one (centres at 20/40/60, radius ~6) with
    /// breathing room. The web's own 14 + 45 already covers 59 of that, so this
    /// only adds what is missing rather than stacking on top of it — the lockup
    /// still lands where a number derived from the web app puts it, just measured
    /// from the buttons instead of the window edge.
    private let trafficLightInset: CGFloat = 78

    @State private var notifOpen = false

    /// This dropdown's OWN identity space. Never shared: two components in one
    /// namespace matched-geometry against each other's shapes.
    @Namespace private var notifGlass

    var body: some View {
        HStack(spacing: gap) {
            lockup
            undoRedo
            Spacer(minLength: 0)          // where Ask TRAQS sits, archived
            saveStatus
            notificationBell
        }
        .padding(.top, topPad)
        .padding(.bottom, bottomPad)
        .padding(.leading, max(leadPad, trafficLightInset - lockupMarginLeft))
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
            .padding(.leading, lockupMarginLeft)
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

    // MARK: Bell and its dropdown
    //
    // `Notification Bell` (TRAQS.jsx:24697) — a labelled pill: padding 7/14, the
    // traced legacy bell at 18pt, "Notifications" at 12pt/600 with -0.045em
    // tracking, and a red count badge at -4/-4.
    //
    // THE BUTTON BECOMES THE PANEL. This is the same mechanism as
    // `DecisionActions` and `PanelPhotoSheet.attachmentArea`, which demonstrably
    // morph on device, and its rules are not guessable — they are copied:
    //
    //   * Each state gets its OWN glassEffectID. NOT a shared one. The container
    //     splits and merges by proximity; distinct ids are what let one shape
    //     become another rather than one shape chasing another.
    //   * Both states sit in a ZStack, so they occupy the same place. "Shapes
    //     that are already on top of each other have nowhere to jump from."
    //   * if/else, so the closed state is REMOVED. Leaving the button on screen
    //     at opacity 0 (or worse, visible and tinted) gives you a button beside
    //     a panel instead of a button that turned into one.
    //   * An explicit `withAnimation`, or both states simply pop.
    //
    // The whole thing hangs off a HIDDEN copy of the button, which is what holds
    // the slot in the strip. A ZStack sizes to its largest child, so the panel in
    // one would widen the button's slot and reflow the strip the moment it
    // opened; in an overlay it is free to overflow the ghost that reserved the
    // space. That ghost's size cannot depend on the panel, so there is no
    // measurement feedback loop.
    private var notificationBell: some View {
        bellFace
            .hidden()
            // Click-away, on its OWN layer under the glass. Inside the container
            // a 4000pt rectangle would drag the container's geometry out with it;
            // the container measures its children to decide what is near what.
            .overlay(alignment: .topTrailing) {
                if notifOpen {
                    Rectangle()
                        .fill(.clear)
                        .frame(width: 4000, height: 4000)
                        .contentShape(Rectangle())
                        .onTapGesture { setOpen(false) }
                }
            }
            .overlay(alignment: .topTrailing) {
                GlassEffectContainer(spacing: 18) {
                    ZStack(alignment: .topTrailing) {
                        if notifOpen {
                            notifPanel
                                // ORDER: appearance, then the effect, then the id
                                // — and all three on ONE view. Glass applied
                                // inside a Button's label with the id on the
                                // Button puts them on different views, and the
                                // container then has no shape under that id.
                                .glassEffect(.regular.tint(theme.card.opacity(0.55)),
                                             in: RoundedRectangle(cornerRadius: TTheme.radiusLg,
                                                                  style: .continuous))
                                .glassEffectID("notif.panel", in: notifGlass)
                        } else {
                            Button { setOpen(true) } label: {
                                bellFace.contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .shellGlass(in: Capsule())
                            .glassEffectID("notif.bell", in: notifGlass)
                            .help("Notifications for new messages & job updates")
                        }
                    }
                }
            }
    }

    private func setOpen(_ open: Bool) {
        withAnimation(.spring(response: 0.38, dampingFraction: 0.74)) { notifOpen = open }
    }

    /// The button's face. NEVER accent-tinted — there is no "open" version of it,
    /// because when the panel is open the button does not exist.
    private var bellFace: some View {
        HStack(spacing: 8) {
            WebGlyph(spec: WebIcon.bell, size: 18, color: theme.textSec)
            Text("Notifications")
                .font(TFont.body(12, 600))
                .tracking(12 * -0.045)
                .foregroundStyle(theme.textSec)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
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
    }

    // MARK: The panel
    //
    // Two shapes, because the empty case is not a list with nothing in it. With
    // notifications it is the web's card (TRAQS.jsx:24699): a "NOTIFICATIONS"
    // header over rows. With none it is a small panel with "All caught up!" in the
    // MIDDLE of it — a 320pt strip of glass with one line of grey text pinned left
    // reads as a broken list rather than a cleared one.
    //
    // The CONTENT fades in behind the shape, not with it. A menu expands and then
    // fills; content arriving on the same frame as the shape leaves nothing to
    // watch morph.
    @ViewBuilder
    private var notifPanel: some View {
        if rows.isEmpty { emptyPanel } else { listPanel }
    }

    private var emptyPanel: some View {
        Text("All caught up!")
            .font(TFont.body(13))
            .foregroundStyle(theme.textDim)
            .frame(width: 190, height: 90)          // centred in both axes
            .contentFade
    }

    /// `width: 320`, header hairline, then the rows.
    private var listPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("NOTIFICATIONS")
                    .font(TFont.body(11, 700))
                    .tracking(11 * -0.045)
                    .foregroundStyle(theme.textDim)
                Spacer()
                Button {
                    appState.markAllThreadsRead()
                    setOpen(false)
                } label: {
                    Text("Mark all read")
                        .font(TFont.body(11))
                        .foregroundStyle(theme.accent)
                }
                .buttonStyle(.plain)
                .opacity(unreadCount > 0 ? 1 : 0)
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(theme.border).frame(height: 1)
            }

            ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title)
                        .font(TFont.body(13, 700))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(row.detail)
                        .font(TFont.body(12))
                        .foregroundStyle(theme.textSec)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    // No hairline under the LAST row — it would draw across the
                    // panel's bottom edge with nothing beneath it to divide.
                    if i < rows.count - 1 {
                        Rectangle().fill(theme.border).frame(height: 1)
                    }
                }
            }
        }
        .frame(width: 320)
        .contentFade
    }

    /// One panel row. Time-off requests first, then unread message senders —
    /// the web's order.
    private struct NotifRow: Identifiable {
        let id: String
        let title: String
        let detail: String
    }

    private var rows: [NotifRow] {
        var out: [NotifRow] = []
        for r in appState.timeOffRequests where r.status == "pending" {
            out.append(NotifRow(id: "to-" + r.id,
                                title: "Time off request",
                                detail: "\(r.personName) · \(r.type)"))
        }
        for s in appState.unreadSenders {
            out.append(NotifRow(id: "msg-" + s.id,
                                title: s.name,
                                detail: s.count == 1 ? "1 new message"
                                                     : "\(s.count) new messages"))
        }
        return out
    }

    /// The badge count. Messages are the unread source the Mac app already
    /// tracks; pending time-off requests are listed but not counted, as on the web.
    private var unreadCount: Int { appState.totalUnreadMessages }
}

// The panel's CONTENT, arriving just behind its shape. A menu expands and then
// fills; 120ms is the gap that makes the shape's morph readable as a morph
// instead of a slab appearing.
private extension View {
    var contentFade: some View {
        transition(.opacity.animation(.easeOut(duration: 0.16).delay(0.12)))
    }
}
