import SwiftUI

// MARK: - A modal, the way the web app presents one
//
// `.anim-modal-overlay` + `.anim-modal-box` (TRAQS.jsx:947). A scrim that fades
// (`fadeIn`, 0.22s) over a card that scales up out of a blur (`bcPageIn`, 0.30s
// on `cubic-bezier(0.22, 1, 0.36, 1)`).
//
// NOT a `.sheet`. A sheet is a system presentation with its own chrome, its own
// corner radius and its own entrance, and the point of this app is that it looks
// like the web app. This is a layer inside the page, exactly as the web's is.
//
// Clicking the scrim closes; clicking the card does not — the web's
// `onClick={close}` on the overlay with `stopPropagation` on the box.

// MARK: How a modal comes and goes
//
// `bcModalState` (TRAQS.jsx:25028) is `"closed" | "open" | "closing"`, and the
// third state is the point: the web plays a real exit and only unmounts on
// `onAnimationEnd`. Without it a modal vanishes on the frame it is dismissed,
// which reads as a glitch rather than a close.
//
// The two halves are deliberately NOT symmetrical, because that is what was
// asked for and it is also how it should look:
//
//   IN   the scrim's blur and the card come together — the background goes soft
//        as the card arrives.
//   OUT  the CARD goes first, on its own, and only once it is gone does the blur
//        lift. The page is revealed after the thing covering it has left, not
//        underneath it.
//
// So the card's exit is short and immediate, and the scrim's is delayed by
// exactly the card's duration.

enum TQModalPhase: Equatable {
    case presenting
    case dismissing

    var isLeaving: Bool { self == .dismissing }
}

/// The four numbers the whole choreography is made of, in one place so they can
/// be redialled without hunting through two views.
enum TQModalTiming {
    /// The card's own fade, both directions.
    static let card: Double = 0.15
    /// The scrim and its blur.
    static let scrim: Double = 0.20
    /// How long the scrim waits before lifting, on the way OUT only.
    ///
    /// Equal to `card`, deliberately: the blur starts to go exactly as the card
    /// finishes leaving, so the two never overlap. Shorter and they cross-fade;
    /// longer and the page sits behind a blur with nothing on it.
    static var scrimExitDelay: Double { card }

    /// End to end — what the presenter waits before taking the modal out of the
    /// hierarchy. A shade longer than the parts, so the last frame is not
    /// clipped.
    static var exit: Double { scrimExitDelay + scrim + 0.02 }
}

struct TQModal<Content: View>: View {
    @Environment(\.tqTheme) private var theme

    var width: CGFloat = 720
    /// A cap, not a height: a short modal sizes to its content. The list-shaped
    /// ones (Export, Cloud) fill it and scroll inside.
    var maxHeight: CGFloat = 640
    /// Driven by whoever presents it. `.dismissing` starts the exit; the
    /// presenter removes the view when `TQModalTiming.exit` has passed.
    var phase: TQModalPhase = .presenting
    let dismiss: () -> Void
    @ViewBuilder let content: () -> Content

    /// Flipped one runloop after appearing, so the entrance has two states to
    /// interpolate between. Set at `onAppear` time it would already be true on
    /// the first paint and nothing would animate.
    @State private var entered = false

    private var visible: Bool { entered && !phase.isLeaving }

    var body: some View {
        ZStack {
            scrim
            card
        }
        .ignoresSafeArea()
        .onAppear { entered = true }
    }

    // MARK: The scrim
    //
    // Just the TINT — `rgba(16,24,40,0.14)`, deepened on a dark theme where 14%
    // disappears. The BLUR is not here: it is applied to the page itself by
    // whoever presents the modal, because a `Material` sampling a page that sits
    // inside a clipped, rounded panel was not producing a visible one. Doing both
    // would blur an already-blurred page for nothing.

    private var scrim: some View {
        Rectangle()
            .fill(Color.black.opacity(theme.isDark ? 0.42 : 0.18))
            .contentShape(Rectangle())
            .onTapGesture { dismiss() }
            .opacity(visible ? 1 : 0)
            // Delayed ONLY on the way out. `.delay` on an animation applies to
            // whichever direction is running, so the two are named separately.
            .animation(phase.isLeaving
                       ? .easeOut(duration: TQModalTiming.scrim)
                            .delay(TQModalTiming.scrimExitDelay)
                       : .easeOut(duration: TQModalTiming.scrim),
                       value: visible)
    }

    // MARK: The card

    private var card: some View {
        VStack(spacing: 0) { content() }
            .frame(width: width)
            .frame(maxHeight: maxHeight)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: TTheme.radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: TTheme.radius, style: .continuous)
                    .strokeBorder(theme.borderLight, lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.45), radius: 40, y: 18)
            // A click on the card must NOT reach the scrim behind it.
            .contentShape(RoundedRectangle(cornerRadius: TTheme.radius, style: .continuous))
            .onTapGesture { }
            // `bcPageIn` — 0.97 → 1 with a 6px blur clearing. Both ends are
            // animated states rather than keyframes, because unlike the context
            // menus there is no overshoot here: it is a straight fade in and a
            // straight fade out, and a keyframed entrance cannot play backwards.
            .scaleEffect(visible ? 1 : 0.97)
            .opacity(visible ? 1 : 0)
            .blur(radius: visible ? 0 : 6)
            .animation(.easeOut(duration: TQModalTiming.card), value: visible)
    }
}

// MARK: Presenting one
//
// Owns the phase, so a screen presenting several modals needs one piece of state
// rather than one per modal. `close()` starts the exit and removes the content
// only once it has finished — the web's `onAnimationEnd`, on a timer instead of
// an event because SwiftUI has no completion for an implicit animation.

@Observable
final class TQModalPresenter<Sheet: Equatable> {
    private(set) var sheet: Sheet?
    private(set) var phase: TQModalPhase = .presenting

    func present(_ sheet: Sheet) {
        // A modal opening while another is leaving would otherwise inherit the
        // outgoing phase and never appear.
        phase = .presenting
        self.sheet = sheet
    }

    func close() {
        guard sheet != nil, phase == .presenting else { return }
        phase = .dismissing
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(TQModalTiming.exit))
            // Only if nothing has been presented in the meantime.
            if phase == .dismissing {
                sheet = nil
                phase = .presenting
            }
        }
    }
}

// MARK: A modal's header
//
// An accent-tinted glyph tile, a title, a subtitle, whatever the modal wants on
// the right, and a close button. The shape every one of the web's uses.

struct TQModalHeader<Trailing: View>: View {
    @Environment(\.tqTheme) private var theme

    let glyph: GlyphSpec
    let title: String
    var subtitle: String?
    let dismiss: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            WebGlyph(spec: glyph, size: 18, color: theme.accent)
                .frame(width: 38, height: 38)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(theme.accent.opacity(0.12)))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TFont.body(17, 700))
                    .foregroundStyle(theme.text)
                if let subtitle {
                    Text(subtitle)
                        .font(TFont.body(12))
                        .foregroundStyle(theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: 8)
            trailing()
            TQModalClose(dismiss: dismiss)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }
}

extension TQModalHeader where Trailing == EmptyView {
    init(glyph: GlyphSpec, title: String, subtitle: String? = nil,
         dismiss: @escaping () -> Void) {
        self.init(glyph: glyph, title: title, subtitle: subtitle,
                  dismiss: dismiss, trailing: { EmptyView() })
    }
}

struct TQModalClose: View {
    @Environment(\.tqTheme) private var theme
    let dismiss: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: dismiss) {
            Text("\u{2715}")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(hovering ? theme.text : theme.textDim)
                .frame(width: 28, height: 28)
                .background(Circle().fill(hovering ? theme.hover : .clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .keyboardShortcut(.cancelAction)
    }
}

/// The rule under a header and above a footer.
struct TQModalRule: View {
    @Environment(\.tqTheme) private var theme
    var body: some View { Rectangle().fill(theme.border).frame(height: 1) }
}

// MARK: A modal's buttons

struct TQModalButton: View {
    @Environment(\.tqTheme) private var theme

    let label: String
    var style: Style = .primary
    var enabled = true
    var help: String?
    let action: () -> Void

    enum Style { case primary, quiet, danger }

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(TFont.body(13, 700))
                .foregroundStyle(ink)
                .padding(.horizontal, 18)
                .frame(minHeight: 34)
                .background(Capsule().fill(fill))
                .overlay(Capsule().strokeBorder(stroke, lineWidth: style == .primary ? 0 : 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .onHover { hovering = $0 && enabled }
        .help(help ?? "")
    }

    private var ink: Color {
        switch style {
        case .primary: return theme.accentText
        case .quiet:   return theme.textSec
        case .danger:  return theme.danger
        }
    }

    private var fill: Color {
        switch style {
        case .primary: return theme.accent.opacity(hovering ? 1 : 0.9)
        case .quiet:   return hovering ? theme.hover : .clear
        case .danger:  return theme.danger.opacity(hovering ? 0.14 : 0.06)
        }
    }

    private var stroke: Color {
        switch style {
        case .primary: return .clear
        case .quiet:   return theme.border
        case .danger:  return theme.danger.opacity(0.35)
        }
    }
}

// MARK: A labelled field
//
// `InputField` — a 10pt/700 uppercase label over a pill. One component so the
// three modals cannot each invent their own spacing.

struct TQField<Content: View>: View {
    @Environment(\.tqTheme) private var theme

    let label: String
    var required = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label)
                    .font(TFont.body(10, 700))
                    .tracking(10 * -0.045)
                    .textCase(.uppercase)
                    .foregroundStyle(theme.textDim)
                if required {
                    Text("*").font(TFont.body(10, 700)).foregroundStyle(theme.danger)
                }
            }
            content()
        }
    }
}

/// The pill a text field sits in, so a `TextField` and a picker match.
struct TQFieldChrome: ViewModifier {
    @Environment(\.tqTheme) private var theme
    var focused = false

    func body(content: Content) -> some View {
        content
            .font(TFont.body(13))
            .foregroundStyle(theme.text)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(theme.surface))
            .overlay(Capsule().strokeBorder(focused ? theme.accent : theme.border,
                                            lineWidth: focused ? 1.5 : 1))
    }
}
