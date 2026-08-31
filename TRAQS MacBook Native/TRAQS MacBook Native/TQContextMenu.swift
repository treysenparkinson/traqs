import SwiftUI
import AppKit

// MARK: - Right-click menus, the way the web app draws them
//
// The web's context menus are not system menus. They are cards: a header block
// with the item's title, dates and a row of icon buttons, then rows that carry a
// SUBTITLE under the label ("Send to all admins for review and approval"), and
// the whole thing deals its rows out in a cascade as it opens.
//
// `.contextMenu` cannot draw that. It builds an `NSMenu`, which has no header, no
// two-line rows and no entrance of its own — so this is a card presented over the
// page, and the right click is caught by hand.
//
// Everything here is chrome. What goes IN a menu lives with the thing it acts on:
// JobsRowMenu, JobsColumnMenu.

// MARK: The card
//
// `.anim-ctx` (TRAQS.jsx:950) over the `ctxMenu` container (:27964):
// `T.card`, a `borderLight` hairline, `radiusLg`, min-width 252, `padding: 6px 0`,
// and a two-part shadow.

enum TQMenuMetrics {
    /// `minWidth: 252` on the row menu, `width: 224` on the column menu.
    static let rowMenuWidth: CGFloat = 252
    static let columnMenuWidth: CGFloat = 224
    /// `padding: "6px 0"`.
    static let cardVPad: CGFloat = 6
    /// `padding: "10px 16px"`, `gap: 12` on a row; the column menu's are tighter.
    static let rowVPad: CGFloat = 10
    static let rowHPad: CGFloat = 16
    static let rowGap: CGFloat = 12
    /// The icon gutter — `width: 22`, so labels line up whatever the glyph.
    static let iconColumn: CGFloat = 22
    /// `0.14s`, `idx * 38ms` — the row cascade.
    static let cascadeStep: Double = 0.038
    static let cascadeDuration: Double = 0.14
    /// `-7px`, the distance a row travels in.
    static let cascadeRise: CGFloat = 7
}

/// The container. Its entrance is `ctxMenuIn` (TRAQS.jsx:807), which is a
/// THREE-STOP curve — 0.90 → 1.02 → 1.00 with a blur that clears at the
/// overshoot — so it is keyframed, not sprung. Per the toggle brief the codebase
/// already follows: `withAnimation` interpolates between endpoints, and a scale
/// that starts and ends at 1 has identical endpoints, so the overshoot would
/// silently not happen.
struct TQMenuCard<Content: View>: View {
    @Environment(\.tqTheme) private var theme

    /// Which way it opened. The mirror keyframes (`ctxMenuInUp`) rise instead of
    /// dropping, so the motion always reads as coming from the pointer.
    var up: Bool = false
    var width: CGFloat = TQMenuMetrics.rowMenuWidth
    /// Set only when the menu could not fit — see `MenuPlacement`. A cap without
    /// a scroller hides the rows it cuts off, so the two travel together.
    var maxHeight: CGFloat?
    @ViewBuilder let content: () -> Content

    @State private var shown = false

    var body: some View {
        let card = VStack(alignment: .leading, spacing: 0) { content() }
            .padding(.vertical, TQMenuMetrics.cardVPad)
            .frame(width: width, alignment: .leading)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: TTheme.radiusLg, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: TTheme.radiusLg, style: .continuous)
                    .strokeBorder(theme.borderLight, lineWidth: 1)
            }
            // `0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)`.
            .shadow(color: .black.opacity(0.7), radius: 24, y: 16)

        return Group {
            if let maxHeight {
                // MUST scroll. The height cap and the scroller are one decision.
                ScrollView(.vertical) { card }
                    .frame(width: width, height: maxHeight)
                    .scrollIndicators(.automatic)
            } else {
                card
            }
        }
        .keyframeAnimator(initialValue: TQMenuEntry(), trigger: shown) { view, v in
            view
                .scaleEffect(v.scale)
                .offset(y: up ? -v.rise : v.rise)
                .opacity(v.opacity)
                .blur(radius: v.blur)
        } keyframes: { _ in
            // 0.26s total, `cubic-bezier(0.34, 1.56, 0.64, 1)` — the overshoot is
            // in the values, so cubic segments carry it rather than a spring.
            KeyframeTrack(\.scale) {
                CubicKeyframe(1.02, duration: 0.156)
                CubicKeyframe(1.00, duration: 0.104)
            }
            KeyframeTrack(\.rise) {
                CubicKeyframe(-2, duration: 0.156)
                CubicKeyframe(0, duration: 0.104)
            }
            KeyframeTrack(\.opacity) {
                LinearKeyframe(1, duration: 0.10)
                LinearKeyframe(1, duration: 0.16)
            }
            KeyframeTrack(\.blur) {
                LinearKeyframe(0, duration: 0.156)
                LinearKeyframe(0, duration: 0.104)
            }
        }
        .onAppear { shown = true }
    }
}

private struct TQMenuEntry: Equatable {
    var scale: CGFloat = 0.90
    /// Positive means "further from the pointer" — the card flips the sign.
    var rise: CGFloat = 10
    var opacity: Double = 0
    var blur: CGFloat = 3
}

// MARK: A row
//
// `CtxMenuItem` (TRAQS.jsx:2939): a 22pt icon gutter, a 14pt/500 label, an
// optional 11pt subtitle, `padding: 10px 16px`, and `T.hover` behind it on
// pointer-over.

struct TQMenuRow: View {
    @Environment(\.tqTheme) private var theme

    let glyph: GlyphSpec
    let label: String
    var sub: String? = nil
    /// The Delete row. Red label and a red wash on hover, not the accent one.
    var destructive = false
    /// Position in the cascade. See `TQMenuCascade` for why it is passed in
    /// rather than counted here.
    var cascade: TQMenuCascade = .init()
    /// Draws it, refuses it, and says why on hover. The convention this app
    /// already follows for anything whose destination is not ported — better
    /// than a live row that silently does nothing.
    var enabled = true
    var help: String? = nil
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: TQMenuMetrics.rowGap) {
                WebGlyph(spec: glyph, size: 14, color: ink)
                    .frame(width: TQMenuMetrics.iconColumn)

                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(TFont.body(14, 500))
                        .foregroundStyle(destructive ? theme.danger : theme.text)
                    if let sub {
                        Text(sub)
                            .font(TFont.body(11))
                            .foregroundStyle(theme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TQMenuMetrics.rowHPad)
            .padding(.vertical, TQMenuMetrics.rowVPad)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(wash)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .onHover { hovering = $0 }
        .help(help ?? "")
        .modifier(cascade)
    }

    private var ink: Color { destructive ? theme.danger : theme.textSec }

    /// `T.danger + "15"` on the delete row, `T.hover` on the rest.
    private var wash: Color {
        guard hovering, enabled else { return .clear }
        return destructive ? theme.danger.opacity(0.08) : theme.hover
    }
}

/// A hairline between groups. `borderTop: 1px solid T.border` with `margin: 4px 0`
/// around it.
struct TQMenuDivider: View {
    @Environment(\.tqTheme) private var theme
    var body: some View {
        Rectangle()
            .fill(theme.border)
            .frame(height: 1)
            .padding(.vertical, 4)
    }
}

// MARK: The cascade
//
// `ctxRowAnim` (TRAQS.jsx:2934): every row plays `toolDrop` — 7pt up, fading in,
// 0.14s — staggered 38ms apart, and the order REVERSES when the menu flipped
// above the pointer so the deal always travels away from the cursor rather than
// back toward it.
//
// The index is supplied by the menu rather than counted here for the same reason
// the web threads it through a context: the rows are built from conditionals, so
// no row can know how many came before it. `total` is only needed for the
// reversal, and 0 means "not measured yet, do not reverse" — exactly the web's
// fallback on the first, unplaced paint.

/// NOT `Equatable`, deliberately: synthesising `==` would need `State<Bool>` to
/// be Equatable, which it is not, and there is nothing here worth comparing.
struct TQMenuCascade: ViewModifier {
    var index: Int = 0
    var total: Int = 0
    var up: Bool = false

    @State private var dealt = false

    /// Never exactly zero. The first row's delay is 0, and a zero-duration
    /// keyframe is a degenerate segment — a millisecond costs nothing and keeps
    /// every track well-formed.
    private var delay: Double {
        let i = up && total > 0 ? max(0, total - 1 - index) : index
        return max(0.001, Double(i) * TQMenuMetrics.cascadeStep)
    }

    func body(content: Content) -> some View {
        content
            .keyframeAnimator(initialValue: Deal(), trigger: dealt) { view, v in
                view.opacity(v.opacity).offset(y: v.offset)
            } keyframes: { _ in
                // A held first segment IS the delay. `.delay()` on an animation
                // would work too, but keyframes keep the hold and the move on one
                // timeline, so a row cannot start moving before it is opaque.
                KeyframeTrack(\.opacity) {
                    LinearKeyframe(0, duration: delay)
                    LinearKeyframe(1, duration: TQMenuMetrics.cascadeDuration)
                }
                KeyframeTrack(\.offset) {
                    LinearKeyframe(-TQMenuMetrics.cascadeRise, duration: delay)
                    CubicKeyframe(0, duration: TQMenuMetrics.cascadeDuration)
                }
            }
            .onAppear { dealt = true }
    }

    private struct Deal: Equatable {
        var opacity: Double = 0
        var offset: CGFloat = -TQMenuMetrics.cascadeRise
    }
}

// MARK: - Catching the right click
//
// SwiftUI reports a secondary click only through `.contextMenu`, which then
// insists on drawing an NSMenu, and never reports WHERE the click landed. Both
// are needed here, so the click is caught by an AppKit view laid over the row.
//
// The subtle part is `hitTest`. An overlay that accepts every event would eat the
// left clicks the row underneath needs — expanding, selecting, opening a cell for
// editing. So it accepts ONLY the events that mean "context click" and returns
// nil for everything else, which puts it out of the way for normal input.

struct TQRightClickCatcher: NSViewRepresentable {
    let onClick: (CGPoint) -> Void

    func makeNSView(context: Context) -> Catcher {
        let view = Catcher()
        view.onClick = onClick
        return view
    }

    func updateNSView(_ view: Catcher, context: Context) {
        view.onClick = onClick
    }

    final class Catcher: NSView {
        var onClick: ((CGPoint) -> Void)?

        /// Top-left origin, so the point handed back is already in SwiftUI's
        /// coordinate system and needs no flip.
        override var isFlipped: Bool { true }

        override func hitTest(_ point: NSPoint) -> NSView? {
            guard let event = NSApp.currentEvent else { return nil }
            switch event.type {
            case .rightMouseDown, .rightMouseUp, .rightMouseDragged:
                return super.hitTest(point)
            // Control-click is a context click on macOS and people use it.
            case .leftMouseDown where event.modifierFlags.contains(.control):
                return super.hitTest(point)
            default:
                // Invisible to ordinary input, so the row below still works.
                return nil
            }
        }

        override func rightMouseDown(with event: NSEvent) {
            onClick?(convert(event.locationInWindow, from: nil))
        }

        override func mouseDown(with event: NSEvent) {
            // The control-click branch above arrives here, not in rightMouseDown.
            if event.modifierFlags.contains(.control) {
                onClick?(convert(event.locationInWindow, from: nil))
            } else {
                super.mouseDown(with: event)
            }
        }
    }
}

// The per-view convenience wrapper that used to live here is gone. It put one
// catcher on every row and every header cell, and the grid catches right-clicks
// ONCE per section instead — see `JobsSection.hitCatcher`, which resolves the row
// and column by arithmetic off the fixed row height and known column widths.

// MARK: - Presenting one
//
// A menu is placed against the PAGE, not against the row that opened it, so it
// stays put if the list scrolls underneath — the web's `position: fixed`.
//
// It renders hidden until it has been measured, because the flip decision needs
// the menu's own height and a menu that paints once in the wrong place and then
// jumps is worse than one that appears a frame late. That is the web's rule too
// (`visibility: ctxPlace ? "visible" : "hidden"`).

struct TQMenuPresenter<Menu: View>: View {
    /// Where the pointer was, in the page's coordinate space.
    let point: CGPoint
    /// The page's own size — the "viewport" the placement math clamps against.
    let viewport: CGSize
    let width: CGFloat
    let dismiss: () -> Void
    @ViewBuilder let menu: (MenuPlacement.Context) -> Menu

    @State private var measured: CGFloat?

    var body: some View {
        let place = measured.map {
            MenuPlacement.contextMenu(pointerY: point.y,
                                      viewportHeight: viewport.height,
                                      menuHeight: $0)
        }

        ZStack(alignment: .topLeading) {
            // Click-away. Mouse-DOWN, as the web's backdrop uses, so the menu is
            // gone before the click underneath is delivered.
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { dismiss() }

            menu(place ?? MenuPlacement.Context(up: false, maxHeight: nil))
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                    // Only the FIRST measurement. Re-reading it after the card is
                    // placed would feed its own clamped height back into the
                    // decision that clamped it.
                    if measured == nil { measured = $0 }
                }
                .offset(x: MenuPlacement.clampX(point.x, menuWidth: width,
                                                viewportWidth: viewport.width),
                        y: y(for: place))
                .opacity(place == nil ? 0 : 1)
        }
        .ignoresSafeArea()
    }

    private func y(for place: MenuPlacement.Context?) -> CGFloat {
        guard let place, let measured else { return point.y }
        let height = place.maxHeight ?? measured
        return place.up ? max(8, point.y - height) : point.y
    }
}
