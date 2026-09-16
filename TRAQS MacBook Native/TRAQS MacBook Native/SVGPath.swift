import SwiftUI
import CoreGraphics

// MARK: - SVG path data → SwiftUI Path
//
// Exists so the sidebar glyphs can be VERBATIM copies of the web app's `d`
// attributes rather than hand-translations of them. Hand-translating a bezier
// into `addCurve` calls is how two icons that are supposed to be identical end
// up 0.3pt apart, and it makes every future glyph a fresh opportunity to drift.
// With this, adding an icon is copy-and-paste out of TRAQS.jsx.
//
// Supports the subset the app's icons actually use: M/m L/l H/h V/v C/c S/s
// Q/q T/t A/a Z/z. Anything else is ignored rather than approximated — a glyph
// that silently renders wrong is worse than one that renders empty.
enum SVGPath {

    static func path(_ d: String) -> Path {
        var p = Path()
        var cur = CGPoint.zero
        var start = CGPoint.zero
        /// Reflection point for S/T shorthand — the previous curve's last control.
        var lastControl: CGPoint?
        var cmd: Character = "M"

        var scanner = Tokenizer(d)
        while let token = scanner.next() {
            if case .command(let c) = token { cmd = c; if c == "Z" || c == "z" {
                p.closeSubpath(); cur = start; lastControl = nil; continue
            } }
            // A repeated coordinate run continues the previous command, which is
            // how `M12 6.6 12 12 15.6 13.8` (a polyline written as one M) works.
            let rel = cmd.isLowercase
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                rel ? CGPoint(x: cur.x + x, y: cur.y + y) : CGPoint(x: x, y: y)
            }

            switch Character(cmd.uppercased()) {
            case "M":
                guard let x = scanner.number(token), let y = scanner.number() else { break }
                cur = pt(x, y); start = cur; p.move(to: cur); lastControl = nil
                // Per the spec, further pairs after an M are implicit L commands.
                cmd = rel ? "l" : "L"
            case "L":
                guard let x = scanner.number(token), let y = scanner.number() else { break }
                cur = pt(x, y); p.addLine(to: cur); lastControl = nil
            case "H":
                guard let x = scanner.number(token) else { break }
                cur = CGPoint(x: rel ? cur.x + x : x, y: cur.y); p.addLine(to: cur); lastControl = nil
            case "V":
                guard let y = scanner.number(token) else { break }
                cur = CGPoint(x: cur.x, y: rel ? cur.y + y : y); p.addLine(to: cur); lastControl = nil
            case "C":
                guard let x1 = scanner.number(token), let y1 = scanner.number(),
                      let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { break }
                let c1 = pt(x1, y1), c2 = pt(x2, y2), end = pt(x, y)
                p.addCurve(to: end, control1: c1, control2: c2)
                cur = end; lastControl = c2
            case "S":
                guard let x2 = scanner.number(token), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { break }
                let c1 = lastControl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let c2 = pt(x2, y2), end = pt(x, y)
                p.addCurve(to: end, control1: c1, control2: c2)
                cur = end; lastControl = c2
            case "Q":
                guard let x1 = scanner.number(token), let y1 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { break }
                let c = pt(x1, y1), end = pt(x, y)
                p.addQuadCurve(to: end, control: c)
                cur = end; lastControl = c
            case "T":
                guard let x = scanner.number(token), let y = scanner.number() else { break }
                let c = lastControl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let end = pt(x, y)
                p.addQuadCurve(to: end, control: c)
                cur = end; lastControl = c
            case "A":
                guard let rx = scanner.number(token), let ry = scanner.number(),
                      let rot = scanner.number(), let large = scanner.number(),
                      let sweep = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { break }
                let end = pt(x, y)
                addArc(&p, from: cur, to: end, rx: rx, ry: ry,
                       rotation: rot, largeArc: large != 0, sweep: sweep != 0)
                cur = end; lastControl = nil
            default:
                break
            }
        }
        return p
    }

    // MARK: Elliptical arc
    //
    // SVG states arcs by their ENDPOINT; CoreGraphics wants a centre, a radius
    // and two angles. This is the endpoint→centre conversion from the SVG spec's
    // implementation notes (F.6.5), including the F.6.6 radius correction for
    // radii too small to span the two points — which the app's `a 6.4 6.4 0 0 1
    // 12.8 0` sits exactly on the boundary of.
    private static func addArc(_ p: inout Path, from p0: CGPoint, to p1: CGPoint,
                               rx: CGFloat, ry: CGFloat, rotation: CGFloat,
                               largeArc: Bool, sweep: Bool) {
        var rx = abs(rx), ry = abs(ry)
        guard rx > 0, ry > 0, p0 != p1 else { p.addLine(to: p1); return }

        let phi = rotation * .pi / 180
        let cosP = cos(phi), sinP = sin(phi)
        let dx2 = (p0.x - p1.x) / 2, dy2 = (p0.y - p1.y) / 2
        let x1 = cosP * dx2 + sinP * dy2
        let y1 = -sinP * dx2 + cosP * dy2

        // F.6.6 — scale the radii up if they can't reach.
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { let s = sqrt(lambda); rx *= s; ry *= s }

        let sign: CGFloat = (largeArc != sweep) ? 1 : -1
        let num = max(0, rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1)
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        let coef = sign * sqrt(den == 0 ? 0 : num / den)
        let cx1 = coef * rx * y1 / ry
        let cy1 = -coef * ry * x1 / rx

        let cx = cosP * cx1 - sinP * cy1 + (p0.x + p1.x) / 2
        let cy = sinP * cx1 + cosP * cy1 + (p0.y + p1.y) / 2

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let dot = ux * vx + uy * vy
            let len = sqrt(ux * ux + uy * uy) * sqrt(vx * vx + vy * vy)
            var a = acos(min(1, max(-1, len == 0 ? 1 : dot / len)))
            if ux * vy - uy * vx < 0 { a = -a }
            return a
        }
        let startAngle = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
        var delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        // CoreGraphics has no elliptical-arc primitive: draw it on a unit circle
        // and let the transform carry the radii and rotation.
        //
        // The arc MUST go onto the current subpath, via `addArc`'s own transform
        // parameter. Building it in a separate `Path` and appending that with
        // `addPath` looks equivalent and is not: `addArc` on an EMPTY path begins
        // with an implicit `move(to:)`, so each appended arc started a NEW
        // subpath. A later `z` then closed only the last of them.
        //
        // On the dashboard house — `M3 9.3L12 3l9 6.3V19a2 2 0 0 1-2 2H5a2 2 0 0
        // 1-2-2z` — that meant the closing left wall was never drawn, and the
        // close instead cut a short diagonal from (3,19) back to the final arc's
        // own start at (5,21). The icon rendered as a house with no left side.
        //
        // Only closed paths that contain arcs show the fault, which is why one
        // glyph out of the set looked wrong and the rest looked fine.
        let t = CGAffineTransform(translationX: cx, y: cy)
            .rotated(by: phi)
            .scaledBy(x: rx, y: ry)
        p.addArc(center: .zero, radius: 1,
                 startAngle: .radians(startAngle),
                 endAngle: .radians(startAngle + delta),
                 clockwise: delta < 0,
                 transform: t)
    }

    // MARK: Tokenizer

    private enum Token { case command(Character); case number(CGFloat) }

    private struct Tokenizer {
        private let chars: [Character]
        private var i = 0
        init(_ s: String) { chars = Array(s) }

        mutating func next() -> Token? {
            skip()
            guard i < chars.count else { return nil }
            let c = chars[i]
            if c.isLetter { i += 1; return .command(c) }
            return readNumber().map { .number($0) }
        }

        /// The number carried by a token that turned out to be one, else the next.
        mutating func number(_ token: Token? = nil) -> CGFloat? {
            if case .number(let n)? = token { return n }
            skip()
            return readNumber()
        }

        private mutating func skip() {
            while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i] == "\n" || chars[i] == "\t" {
                i += 1
            }
        }

        private mutating func readNumber() -> CGFloat? {
            skip()
            var s = ""
            if i < chars.count, chars[i] == "-" || chars[i] == "+" { s.append(chars[i]); i += 1 }
            while i < chars.count, chars[i].isNumber || chars[i] == "." { s.append(chars[i]); i += 1 }
            // Exponents don't appear in these icons, but cost nothing to accept.
            if i < chars.count, chars[i] == "e" || chars[i] == "E" {
                s.append(chars[i]); i += 1
                if i < chars.count, chars[i] == "-" || chars[i] == "+" { s.append(chars[i]); i += 1 }
                while i < chars.count, chars[i].isNumber { s.append(chars[i]); i += 1 }
            }
            return Double(s).map { CGFloat($0) }
        }
    }
}
