import SwiftUI

// MARK: - The web app's icons, verbatim
//
// Every glyph below is a literal copy of the SVG in TRAQS.jsx — same viewBox,
// same `d` strings, same stroke width, same round caps and joins. Nothing is
// redrawn or approximated, and no SF Symbol stands in for one, because a
// lookalike is exactly what makes the two apps feel like different products.
//
// To add one: copy the <svg> out of TRAQS.jsx and transcribe its children into
// `elements`. The path strings go across untouched — see SVGPath.

struct GlyphSpec {
    /// Matches the SVG's own viewBox. Messages uses a tighter one (0.9 0.9 22.2
    /// 22.2) so a circle reads the same optical size as the square-ish glyphs
    /// around it — copied along with everything else.
    var viewBox = CGRect(x: 0, y: 0, width: 24, height: 24)
    var strokeWidth: CGFloat = 2
    var elements: [Element]

    enum Element {
        case path(String)
        case fill(String)
        case circle(CGFloat, CGFloat, CGFloat)
        case circleFill(CGFloat, CGFloat, CGFloat)
        case rect(x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, r: CGFloat)
        case line(CGFloat, CGFloat, CGFloat, CGFloat)
        case polyline([CGFloat])
    }
}

struct WebGlyph: View {
    let spec: GlyphSpec
    var size: CGFloat = 17
    var color: Color = .primary

    var body: some View {
        Canvas { ctx, canvas in
            let s = canvas.width / spec.viewBox.width
            let t = CGAffineTransform(scaleX: s, y: s)
                .translatedBy(x: -spec.viewBox.minX, y: -spec.viewBox.minY)
            // Round caps and joins on every stroke — the web icons all set
            // strokeLinecap/strokeLinejoin="round", and square ends read as a
            // different icon family entirely at 17pt.
            let style = StrokeStyle(lineWidth: spec.strokeWidth * s,
                                    lineCap: .round, lineJoin: .round)
            let paint = GraphicsContext.Shading.color(color)

            for el in spec.elements {
                switch el {
                case .path(let d):
                    ctx.stroke(SVGPath.path(d).applying(t), with: paint, style: style)
                case .fill(let d):
                    ctx.fill(SVGPath.path(d).applying(t), with: paint)
                case .circle(let cx, let cy, let r):
                    ctx.stroke(circlePath(cx, cy, r).applying(t), with: paint, style: style)
                case .circleFill(let cx, let cy, let r):
                    ctx.fill(circlePath(cx, cy, r).applying(t), with: paint)
                case .rect(let x, let y, let w, let h, let r):
                    let p = Path(roundedRect: CGRect(x: x, y: y, width: w, height: h),
                                 cornerRadius: r, style: .continuous)
                    ctx.stroke(p.applying(t), with: paint, style: style)
                case .line(let x1, let y1, let x2, let y2):
                    var p = Path()
                    p.move(to: CGPoint(x: x1, y: y1))
                    p.addLine(to: CGPoint(x: x2, y: y2))
                    ctx.stroke(p.applying(t), with: paint, style: style)
                case .polyline(let pts):
                    var p = Path()
                    for i in stride(from: 0, to: pts.count - 1, by: 2) {
                        let point = CGPoint(x: pts[i], y: pts[i + 1])
                        if i == 0 { p.move(to: point) } else { p.addLine(to: point) }
                    }
                    ctx.stroke(p.applying(t), with: paint, style: style)
                }
            }
        }
        .frame(width: size, height: size)
    }

    private func circlePath(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
    }
}

// MARK: - The sidebar set
//
// All glyph geometry is normalised to 3..21 of the 24-unit box on the web side,
// so every icon inks the same 20×20 area once its 2px stroke halo is added.
// Keep new ones inside that range for the same reason.
enum WebIcon {

    /// The brand strip's notification bell (TRAQS.jsx:24697). strokeWidth 2,
    /// round caps — the legacy bell, not an SF Symbol lookalike.
    static let bell = GlyphSpec(elements: [
        .path("M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"),
        .path("M13.73 21a2 2 0 0 1-3.46 0"),
    ])

    /// The sidebar's log-out button (TRAQS.jsx:24996). A door with an arrow
    /// leaving it — strokeWidth 2, like the nav glyphs.
    static let logout = GlyphSpec(elements: [
        .path("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"),
        .polyline([16, 17, 21, 12, 16, 7]),
        .line(21, 12, 9, 12),
    ])

    static let dashboard = GlyphSpec(elements: [
        .path("M3 9.3L12 3l9 6.3V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
        .polyline([9.2, 21, 9.2, 12.8, 14.8, 12.8, 14.8, 21]),
    ])

    static let jobs = GlyphSpec(elements: [
        .circleFill(3.7, 3.9, 1.7),  .path("M8.8 3.9h12.2"),
        .circleFill(3.7, 12, 1.7),   .path("M8.8 12h12.2"),
        .circleFill(3.7, 20.1, 1.7), .path("M8.8 20.1h8.2"),
    ])

    /// The date tile. The number is drawn by the caller — it changes daily, and
    /// the web app renders it as live <text> for the same reason.
    static let schedule = GlyphSpec(elements: [
        .rect(x: 3, y: 3, w: 18, h: 18, r: 5.2),
        .path("M3.3 8.4h17.4"),
    ])

    static let employees = GlyphSpec(elements: [
        .circle(9.4, 7.4, 4.4),
        .path("M3 21a6.4 6.4 0 0 1 12.8 0"),
        .path("M15.6 5.6a3.1 3.1 0 0 1 0 6.2"),
        .path("M17.2 14.6a6.2 6.2 0 0 1 3.8 6.4"),
    ])

    static let timeClock = GlyphSpec(elements: [
        .circle(12, 12, 9),
        .polyline([12, 6.6, 12, 12, 15.6, 13.8]),
    ])

    static let analytics = GlyphSpec(elements: [
        .line(18.4, 21, 18.4, 9.75),
        .line(12, 21, 12, 3),
        .line(5.6, 21, 5.6, 14.25),
    ])

    static let clients = GlyphSpec(elements: [
        .rect(x: 3, y: 3, w: 11.4, h: 18, r: 3.3),
        .rect(x: 14.4, y: 9.6, w: 6.6, h: 11.4, r: 2.7),
        .path("M6.2 8.2h5"),
        .path("M6.2 12.8h5"),
    ])

    /// Round bubble with a floating tail — deliberately NOT the rounded-rectangle
    /// the other chat glyphs use, and deliberately not the iOS tab bar's SF
    /// Symbol. Tighter viewBox and a 1.85 stroke keep its optical weight equal to
    /// its neighbours despite being drawn ~8% larger.
    static let messages = GlyphSpec(
        viewBox: CGRect(x: 0.9, y: 0.9, width: 22.2, height: 22.2),
        strokeWidth: 1.85,
        elements: [
            .path("M21 11.5c0 4.29-4.04 7.76-9 7.76-1.08 0-2.12-.17-3.08-.47L4.2 20.8l1.2-3.46C3.9 15.8 3 13.8 3 11.5 3 7.3 7 3.8 12 3.8s9 3.47 9 7.7z"),
        ])

    static let approvals = GlyphSpec(elements: [
        .path("M22 11.08V12a10 10 0 1 1-5.93-9.14"),
        .polyline([22, 4, 12, 14.01, 9, 11.01]),
    ])

    static let admin = GlyphSpec(elements: [
        .path("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"),
    ])

    static let settings = GlyphSpec(elements: [
        .circle(12, 12, 3),
        .path("M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"),
    ])

    // MARK: Settings sub-nav

    static let back = GlyphSpec(elements: [
        .line(19, 12, 5, 12),
        .polyline([12, 19, 5, 12, 12, 5]),
    ])

    static let organization = GlyphSpec(elements: [
        .rect(x: 2, y: 7, w: 20, h: 14, r: 2),
        .path("M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"),
    ])

    static let customization = GlyphSpec(elements: [
        .path("M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"),
        .path("M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.22 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"),
    ])

    /// The one filled glyph in the set.
    static let fastTraqs = GlyphSpec(elements: [
        .fill("M13 2L4 14h7l-1 8 9-12h-7l1-8z"),
    ])

    static let chevronRight = GlyphSpec(strokeWidth: 2.5, elements: [
        .polyline([9, 18, 15, 12, 9, 6]),
    ])
}

// MARK: - The date tile
//
// Schedule's icon carries today's date as live text, so it can't be a static
// glyph. The baseline is derived from DM Sans Bold's actual digit ink
// (yMin -12, yMax 712 per 1000 upem → (712 + -12) / 2 = 0.350em below the open
// area's centre of 14.7), which is why two-digit dates stay centred at their
// smaller size. Copied from the web app's own working, not re-derived.
struct ScheduleGlyph: View {
    var size: CGFloat = 17
    var color: Color = .primary
    var day: Int = Calendar.current.component(.day, from: Date())

    private var fontSize: CGFloat { day > 9 ? 9.5 : 10.5 }
    private var baseline: CGFloat { 14.7 + fontSize * 0.35 }

    var body: some View {
        WebGlyph(spec: WebIcon.schedule, size: size, color: color)
            .overlay {
                GeometryReader { geo in
                    let s = geo.size.width / 24
                    Text("\(day)")
                        .font(.custom("DMSans-Bold", size: fontSize * s))
                        .foregroundStyle(color)
                        // `.bottom` on the text's own frame puts its BASELINE at
                        // the y the web app computes, rather than its box centre.
                        .position(x: 12 * s, y: baseline * s)
                        .offset(y: -fontSize * s * 0.35)
                }
            }
    }
}
