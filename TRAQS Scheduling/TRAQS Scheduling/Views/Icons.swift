import SwiftUI

// MARK: - TRAQS Icon Set
// Map the desktop's Lucide-style icon names to SF Symbols of similar geometry.
// Most glyphs use SF Symbols (system, scaled, stroked). The five NAV glyphs —
// home, jobs, hours, stats, chat — are hand-traced from the web app's sidebar
// SVGs instead, so the two apps show the same icon rather than a lookalike
// (see "Desktop-parity nav glyphs" below).

enum TIcon: String {
    case home
    case jobs, schedule, hours, stats, chat
    case search, plus, chev, chevDown, filter
    case pin, bolt, play, pause
    case dot, check, arrowUp, arrowDown
    case mic, paperclip, settings, send
    case person, map, list, cal, sparkle, bell, signOut
    case clients, team
    case select, trash, admin
    case gantt

    var sfName: String {
        switch self {
        case .home:      return "house.fill"
        case .jobs:      return "briefcase"
        case .schedule:  return "calendar"
        case .hours:     return "clock"
        case .stats:     return "chart.bar"
        case .chat:      return "message"
        case .search:    return "magnifyingglass"
        case .plus:      return "plus"
        case .chev:      return "chevron.right"
        case .chevDown:  return "chevron.down"
        case .filter:    return "line.3.horizontal.decrease"
        case .pin:       return "pin.fill"
        case .bolt:      return "bolt.fill"
        case .play:      return "play.fill"
        case .pause:     return "pause.fill"
        case .dot:       return "circle.fill"
        case .check:     return "checkmark"
        case .arrowUp:   return "arrow.up"
        case .arrowDown: return "arrow.down"
        case .mic:       return "mic"
        case .paperclip: return "paperclip"
        case .settings:  return "gearshape"
        case .send:      return "paperplane.fill"
        case .person:    return "person"
        case .map:       return "map"
        case .list:      return "list.bullet"
        case .cal:       return "calendar"
        case .sparkle:   return "sparkles"
        case .bell:      return "bell"
        case .signOut:   return "rectangle.portrait.and.arrow.right"
        case .clients:   return "building.2"
        case .team:      return "person.2"
        case .select:    return "checkmark.circle"
        case .trash:     return "trash"
        case .admin:     return "shield.lefthalf.filled"
        case .gantt:     return "chart.bar.xaxis"
        }
    }

    /// True for the glyphs drawn from the desktop SVGs rather than SF Symbols.
    var isNavGlyph: Bool {
        switch self {
        case .home, .jobs, .hours, .stats, .chat: return true
        default: return false
        }
    }
}

struct TIconView: View {
    let icon: TIcon
    var size: CGFloat = 18
    var color: Color = Color(hex: T.ink)
    /// Roughly map stroke-weight semantics from the desktop SVG icons (1.5–2.0) onto
    /// SwiftUI symbol weight. SF Symbols don't have arbitrary stroke widths but
    /// `.regular` ↔ ~1.5, `.semibold` ↔ ~1.8, `.bold` ↔ ~2.0.
    var weight: Font.Weight = .medium

    var body: some View {
        // The gantt glyph is hand-drawn: three vertical bars side by side,
        // nudged up/down so they don't share a baseline. No axis line.
        if icon == .gantt {
            GanttGlyph(size: size, color: color)
        } else if icon.isNavGlyph {
            // Traced from the desktop sidebar. `weight` still means something
            // here — it picks the stroke width — so existing call sites that
            // pass a weight keep behaving sensibly.
            NavGlyph(icon: icon, size: size, color: color, stroke: NavGlyph.stroke(for: weight))
        } else {
            Image(systemName: icon.sfName)
                .font(.system(size: size, weight: weight))
                .foregroundStyle(color)
        }
    }
}

// MARK: - Desktop-parity nav glyphs
// The five nav glyphs are traced point-for-point from the web app's sidebar
// SVGs (`views` in src/TRAQS.jsx) so the phone and the browser show the SAME
// icon, not two different takes on the same idea. SF Symbols got close on some
// (clock, message) and not at all on others — Jobs was a briefcase against the
// desktop's bulleted list, Analytics was horizontal bars against vertical ones.
//
// GEOMETRY CONTRACT — keep this if you add a glyph. Paths are authored in the
// desktop's 24-unit viewBox, and the desktop normalizes every sidebar glyph so
// its geometry sits inside 3…21. With the 2-unit stroke halo that inks a 20-unit
// box (2…22), and it is that box — not the full 24 — that `navGlyphPath` maps
// onto `size`. So `size` means what it means for an SF Symbol: how big the
// glyph actually looks. Authoring in raw 24-space instead would render every
// icon ~17% small and silently shrink the existing `.hours` / `.stats` call
// sites in MoreView.

/// Scale a path authored in the desktop's 24-unit viewBox into `rect`, mapping
/// the inked 20-unit box (2…22) onto the rect's smaller dimension.
private func navGlyphPath(in rect: CGRect, _ draw: (inout Path) -> Void) -> Path {
    var p = Path()
    draw(&p)
    let s = min(rect.width, rect.height) / 20
    let t = CGAffineTransform(translationX: -2, y: -2)
        .concatenating(CGAffineTransform(scaleX: s, y: s))
        .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY))
    return p.applying(t)
}

/// Renders one traced nav glyph. `stroke` is a width in viewBox units — the
/// desktop draws all of these at 2 — and is scaled with the glyph.
struct NavGlyph: View {
    let icon: TIcon
    var size: CGFloat = 18
    var color: Color = Color(hex: T.ink)
    var stroke: CGFloat = 2

    /// Stroke width (viewBox units) for a requested symbol weight, so the
    /// SF-Symbol-shaped API keeps working. The desktop's own weight is 2.
    static func stroke(for weight: Font.Weight) -> CGFloat {
        switch weight {
        case .ultraLight, .thin, .light: return 1.6
        case .regular:                   return 1.9
        case .semibold:                  return 2.3
        case .bold, .heavy, .black:      return 2.5
        default:                         return 2.0   // .medium and anything new
        }
    }

    private var style: StrokeStyle {
        // The desktop sets strokeLinecap/strokeLinejoin="round" on all of them.
        StrokeStyle(lineWidth: stroke * (size / 20), lineCap: .round, lineJoin: .round)
    }

    var body: some View {
        ZStack {
            switch icon {
            case .home:
                HomeGlyph().stroke(color, style: style)
            case .jobs:
                // Two layers because the desktop fills the bullets and strokes
                // the rules — one uniform stroke can't do both.
                JobsRulesGlyph().stroke(color, style: style)
                JobsBulletsGlyph().fill(color)
            case .hours:
                ClockGlyph().stroke(color, style: style)
            case .stats:
                BarsGlyph().stroke(color, style: style)
            case .chat:
                BubbleGlyph().stroke(color, style: style)
            default:
                EmptyView()
            }
        }
        .frame(width: size, height: size)
    }
}

// Home — house outline with a doorway.
// <path d="M3 9.3L12 3l9 6.3V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
// <polyline points="9.2 21 9.2 12.8 14.8 12.8 14.8 21"/>
private struct HomeGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        navGlyphPath(in: rect) { p in
            p.move(to: CGPoint(x: 3, y: 9.3))
            p.addLine(to: CGPoint(x: 12, y: 3))
            p.addLine(to: CGPoint(x: 21, y: 9.3))
            p.addLine(to: CGPoint(x: 21, y: 19))
            // The SVG's `a2 2 0 0 1` corners, as cubics with the circular
            // kappa (0.5523 × r) — exact to a rounding error, and unambiguous
            // about sweep direction in a y-down space, which addArc is not.
            p.addCurve(to: CGPoint(x: 19, y: 21),
                       control1: CGPoint(x: 21, y: 20.105),
                       control2: CGPoint(x: 20.105, y: 21))
            p.addLine(to: CGPoint(x: 5, y: 21))
            p.addCurve(to: CGPoint(x: 3, y: 19),
                       control1: CGPoint(x: 3.895, y: 21),
                       control2: CGPoint(x: 3, y: 19.895))
            p.closeSubpath()

            p.move(to: CGPoint(x: 9.2, y: 21))
            p.addLine(to: CGPoint(x: 9.2, y: 12.8))
            p.addLine(to: CGPoint(x: 14.8, y: 12.8))
            p.addLine(to: CGPoint(x: 14.8, y: 21))
        }
    }
}

// Jobs — bulleted list. Rules: <path d="M8.8 3.9h12.2"/> etc.
private struct JobsRulesGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        navGlyphPath(in: rect) { p in
            // The bottom rule is deliberately short (h8.2) — a ragged last line.
            for (y, endX) in [(3.9, 21.0), (12.0, 21.0), (20.1, 17.0)] {
                p.move(to: CGPoint(x: 8.8, y: y))
                p.addLine(to: CGPoint(x: endX, y: y))
            }
        }
    }
}

// Jobs bullets — <circle cx="3.7" cy="…" r="1.7" fill="currentColor"/>
private struct JobsBulletsGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        navGlyphPath(in: rect) { p in
            for y in [3.9, 12.0, 20.1] {
                p.addEllipse(in: CGRect(x: 3.7 - 1.7, y: y - 1.7, width: 3.4, height: 3.4))
            }
        }
    }
}

// Time Clock — <circle cx="12" cy="12" r="9"/> + <polyline points="12 6.6 12 12 15.6 13.8"/>
private struct ClockGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        navGlyphPath(in: rect) { p in
            p.addEllipse(in: CGRect(x: 3, y: 3, width: 18, height: 18))
            p.move(to: CGPoint(x: 12, y: 6.6))
            p.addLine(to: CGPoint(x: 12, y: 12))
            p.addLine(to: CGPoint(x: 15.6, y: 13.8))
        }
    }
}

// Analytics — three vertical bars on a shared baseline, stepped tall-in-the-middle.
private struct BarsGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        navGlyphPath(in: rect) { p in
            for (x, top) in [(18.4, 9.75), (12.0, 3.0), (5.6, 14.25)] {
                p.move(to: CGPoint(x: x, y: 21))
                p.addLine(to: CGPoint(x: x, y: top))
            }
        }
    }
}

// Messages — rounded speech bubble with a tail at the lower left.
// <path d="M21 11.5c0 4.29-4.04 7.76-9 7.76-1.08 0-2.12-.17-3.08-.47L4.2 20.8l1.2-3.46C3.9 15.8 3 13.8 3 11.5 3 7.3 7 3.8 12 3.8s9 3.47 9 7.7z"/>
private struct BubbleGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        navGlyphPath(in: rect) { p in
            p.move(to: CGPoint(x: 21, y: 11.5))
            p.addCurve(to: CGPoint(x: 12, y: 19.26),
                       control1: CGPoint(x: 21, y: 15.79),
                       control2: CGPoint(x: 16.96, y: 19.26))
            p.addCurve(to: CGPoint(x: 8.92, y: 18.79),
                       control1: CGPoint(x: 10.92, y: 19.26),
                       control2: CGPoint(x: 9.88, y: 19.09))
            p.addLine(to: CGPoint(x: 4.2, y: 20.8))   // tail tip
            p.addLine(to: CGPoint(x: 5.4, y: 17.34))
            p.addCurve(to: CGPoint(x: 3, y: 11.5),
                       control1: CGPoint(x: 3.9, y: 15.8),
                       control2: CGPoint(x: 3, y: 13.8))
            p.addCurve(to: CGPoint(x: 12, y: 3.8),
                       control1: CGPoint(x: 3, y: 7.3),
                       control2: CGPoint(x: 7, y: 3.8))
            // The SVG's `s9 3.47 9 7.7` — the smooth cubic's first control is
            // the reflection of the previous one: 2×(12,3.8) − (7,3.8).
            p.addCurve(to: CGPoint(x: 21, y: 11.5),
                       control1: CGPoint(x: 17, y: 3.8),
                       control2: CGPoint(x: 21, y: 7.27))
            p.closeSubpath()
        }
    }
}

// MARK: - Gantt glyph
// Three equal-length vertical bars set side by side and nudged up/down so they
// don't line up on a common baseline. No axis line.

struct GanttGlyph: View {
    var size: CGFloat = 18
    var color: Color = Color(hex: T.ink)

    /// Vertical offset per bar (fraction of `size`), left → right. Positive is
    /// down; the gentle stagger keeps the bars from sharing a baseline.
    private let offsets: [CGFloat] = [0.09, -0.02, -0.11]

    var body: some View {
        let barW = size * 0.15
        let barH = size * 0.50
        let spacing = size * 0.13
        HStack(spacing: spacing) {
            ForEach(offsets.indices, id: \.self) { i in
                Capsule(style: .continuous)
                    .fill(color)
                    .frame(width: barW, height: barH)
                    .offset(y: size * offsets[i])
            }
        }
        .frame(width: size, height: size)
    }
}
