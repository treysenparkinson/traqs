import SwiftUI

// MARK: - The Jobs toolbar's controls
//
// Every one of these is a Liquid Glass button — the app's one sanctioned
// divergence from the web (see NativeShell). The rule for WHICH glass:
//
//   CLEAR unless the web fills the button with colour.
//
// So it is worth recording what the web actually does, because the source is
// misleading. `Btn` (TRAQS.jsx:2418) accepts variant="ghost"/"danger"/"teal" and
// resolves EVERY ONE of them to the same accent gradient fill — its own comment
// says so: "Semantic variant names are kept as accepted props so existing call
// sites don't break, but they all resolve to the one gradient look." A call site
// reading `variant="ghost"` is therefore a FILLED button, not a quiet one.
//
// That splits the toolbar three ways:
//
//   • FILLED accent → tinted glass. Select/Done, FAST TRAQS, New Job, Export.
//   • OUTLINED (`outlineBtnStyle`, :2432 — surface fill, coloured ring and label)
//     → clear glass with the colour on the label. All/None and Delete.
//   • surface + plain border → clear glass. Filter, Grouping, Align, Search.

enum JobsControlStyle {
    /// The web's accent gradient fill.
    case filled
    /// `outlineBtnStyle(c)` — a coloured ring and label over the list surface.
    case outlined(Color)
    /// A tool: surface fill, plain border. Becomes accent-tinted when it is doing
    /// something (filters applied, a group active).
    case tool(active: Bool)
}

private enum JobsControlMetrics {
    /// `sizes.sm` on `Btn` — height 34, padding "0 18", 13pt.
    static let height: CGFloat = 34
    static let hPad: CGFloat = 18
    static let fontSize: CGFloat = 13
    /// `pageActionIconBtn` (:12710) — a 34pt square, so a pill makes it a circle.
    static let square: CGFloat = 34
    /// The toolbar's own icons are 13pt; the right-hand action icons are 16.
    static let toolGlyph: CGFloat = 13
    static let actionGlyph: CGFloat = 16
}

// MARK: A labelled pill

struct JobsPillButton: View {
    @Environment(\.tqTheme) private var theme

    let label: String
    var glyph: GlyphSpec? = nil
    var glyphSize: CGFloat = 14
    var style: JobsControlStyle = .filled
    /// `minWidth: 78` on Select and Delete, so the label swapping between
    /// "Select" and "Done" cannot resize the button and shift the toolbar.
    var minWidth: CGFloat? = nil
    var help: String? = nil
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let glyph { WebGlyph(spec: glyph, size: glyphSize, color: ink) }
                Text(label)
                    .font(TFont.body(JobsControlMetrics.fontSize, 700))
                    .foregroundStyle(ink)
            }
            .padding(.horizontal, JobsControlMetrics.hPad)
            .frame(minWidth: minWidth, minHeight: JobsControlMetrics.height)
            .shellGlass(tint: tint, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)      // `opacity: disabled ? 0.45 : 1` on Btn
        .help(help ?? "")
    }

    private var ink: Color {
        switch style {
        case .filled:            return theme.accentText
        case .outlined(let c):   return c
        case .tool(let active):  return active ? theme.accent : theme.textSec
        }
    }

    private var tint: Color? {
        switch style {
        // Not the gradient. A gradient inside glass fights the material's own
        // shading and comes out muddy; the accent at 0.85 keeps it a filled
        // accent button while the glass supplies the depth the gradient was for.
        case .filled:           return theme.accent.opacity(0.85)
        // Clear. The colour is on the ring and the label, and glass supplies the
        // ring — which is why `outlineBtnStyle`'s 1.5px border is not redrawn.
        case .outlined:         return nil
        case .tool(let active): return active ? theme.accent.opacity(0.15) : nil
        }
    }
}

// MARK: A 34pt icon control

struct JobsIconButton: View {
    @Environment(\.tqTheme) private var theme

    let glyph: GlyphSpec
    var glyphSize: CGFloat = JobsControlMetrics.toolGlyph
    var style: JobsControlStyle = .tool(active: false)
    /// The count on the Filter button. `nil` draws nothing.
    var badge: Int? = nil
    var help: String
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            WebGlyph(spec: glyph, size: glyphSize, color: ink)
                .frame(width: JobsControlMetrics.square, height: JobsControlMetrics.square)
                .shellGlass(tint: tint, in: Capsule())
                .overlay(alignment: .topTrailing) {
                    if let badge, badge > 0 {
                        Text("\(badge)")
                            .font(TFont.body(9, 700))
                            .foregroundStyle(theme.accentText)
                            .padding(.horizontal, 3)
                            .frame(minWidth: 14, minHeight: 14)
                            .background(Capsule().fill(theme.accent))
                            // `top: -5, right: -5`.
                            .offset(x: 5, y: -5)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .help(help)
    }

    private var ink: Color {
        switch style {
        case .filled:            return theme.accentText
        case .outlined(let c):   return c
        // `color: T.textDim` on the align toggle, `T.textSec` on Filter. textSec
        // for both: the two sit side by side at the same size and the web's
        // one-shade difference between them reads as a rendering fault, not a
        // hierarchy.
        case .tool(let active):  return active ? theme.accent : theme.textSec
        }
    }

    private var tint: Color? {
        switch style {
        case .filled:           return theme.accent.opacity(0.85)
        case .outlined:         return nil
        case .tool(let active): return active ? theme.accent.opacity(0.15) : nil
        }
    }
}

// MARK: The search field
//
// `tq-searchbar` (TRAQS.jsx:11440): 34 tall, and 34 wide until it has focus or
// text, when it opens to 220. Kept expanded once there is a query, so the thing
// you searched for stays visible.

struct JobsSearchField: View {
    @Environment(\.tqTheme) private var theme
    @Binding var text: String
    @FocusState private var focused: Bool

    private var open: Bool { focused || !text.isEmpty }

    var body: some View {
        HStack(spacing: 0) {
            WebGlyph(spec: WebIcon.search, size: 13,
                     color: text.isEmpty ? theme.textSec : theme.accent)
                .frame(width: 34, height: 34)

            if open {
                TextField("Search jobs…", text: $text)
                    .textFieldStyle(.plain)
                    .font(TFont.body(12))
                    .foregroundStyle(theme.text)
                    .focused($focused)
                    .padding(.trailing, text.isEmpty ? 8 : 0)

                if !text.isEmpty {
                    Button { text = ""; focused = true } label: {
                        Text("×")
                            .font(.system(size: 14))
                            .foregroundStyle(theme.textDim)
                            .frame(width: 22, height: 22)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 3)
                }
            }
        }
        .frame(width: open ? 220 : 34, height: 34)
        .shellGlass(tint: text.isEmpty ? nil : theme.accent.opacity(0.12), in: Capsule())
        .contentShape(Capsule())
        // The whole pill is the target, not just the field — clicking the glass
        // left of the caret has to focus it, as the web's wrapper does.
        .onTapGesture { focused = true }
        .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.26), value: open)
    }
}

// MARK: The vertical rule between clusters

struct JobsToolDivider: View {
    @Environment(\.tqTheme) private var theme
    var body: some View {
        // `width: 1, height: 20, background: hexA(T.text, 0.22)`.
        Rectangle()
            .fill(theme.text.opacity(0.22))
            .frame(width: 1, height: 20)
    }
}
