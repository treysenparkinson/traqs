import Foundation

// MARK: - Bar colour
//
// `src/barPaint.js`, the pieces the iOS gantt draws with:
//   - `legibleBarColor` — a bar's colour is its PANEL's (`panel.color`, #253), stepped toward
//     black or white until its own ink clears 4.5:1 on it, at most three steps, so the job
//     stays recognisable while its label stays readable;
//   - `doneBarFill` over `barPaint` — a finished bar (#252): muted toward the DONE grey, then
//     faded 30% toward the row it sits on. Colour only; a DONE bar still opens and reads.
//
// Hex in, hex out, lower-case, exactly as the JS. Held to it by fixtures/schedule-parity.json
// (`paint`). Pure.
enum BarPaint {

    static let ink = "#0f172a"
    static let paper = "#ffffff"
    static let fallback = "#94a3b8"
    private static let doneMute = "#8c8c94"
    private static let aaText = 4.5
    private static let legibleStep = 0.08, legibleStepMax = 0.24

    /// `#rrggbb` as three 0–255 channels, or nil.
    private static func channels(_ hex: String) -> [Double]? {
        let h = Array(hex)
        guard h.first == "#", h.count >= 7 else { return nil }
        var out: [Double] = []
        for k in 0..<3 {
            guard let v = Int(String(h[(1 + k * 2)...(2 + k * 2)]), radix: 16) else { return nil }
            out.append(Double(v))
        }
        return out
    }

    private static func hex(_ c: [Double]) -> String {
        "#" + c.map { String(format: "%02x", Int(min(255, max(0, $0)))) }.joined()
    }

    /// `Math.round` — half toward +∞.
    private static func jsRound(_ v: Double) -> Double { (v + 0.5).rounded(.down) }

    /// `hexLum` — relative luminance.
    static func luminance(_ hex: String) -> Double {
        guard let c = channels(hex) else { return 0 }
        let l = { (v: Double) -> Double in
            let x = v / 255
            return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * l(c[0]) + 0.7152 * l(c[1]) + 0.0722 * l(c[2])
    }

    /// `blendHex` — toward white (f > 0) or black (f < 0) by |f|.
    static func blend(_ hexColor: String, _ f: Double) -> String {
        guard let c = channels(hexColor) else { return hexColor }
        let t: Double = f > 0 ? 255 : 0, a = abs(f)
        return hex(c.map { jsRound($0 + (t - $0) * a) })
    }

    /// `mixHex` — `a` toward `b` by `t`.
    static func mix(_ a: String, _ b: String, _ t: Double) -> String {
        guard let x = channels(a), let y = channels(b) else { return a }
        return hex((0..<3).map { jsRound(x[$0] + (y[$0] - x[$0]) * t) })
    }

    private static func contrast(_ a: String, _ b: String) -> Double {
        let l1 = luminance(a), l2 = luminance(b)
        return l1 > l2 ? (l1 + 0.05) / (l2 + 0.05) : (l2 + 0.05) / (l1 + 0.05)
    }

    /// `barInk` — ink or paper, whichever reads better on `ground`.
    static func barInk(_ ground: String) -> String {
        contrast(ink, ground) >= contrast(paper, ground) ? ink : paper
    }

    /// `legibleBarColor`.
    static func legible(_ color: String) -> String {
        guard color.first == "#", channels(color) != nil else { return color }
        var c = color
        var i = 0.0
        while i < legibleStepMax / legibleStep && contrast(barInk(c), c) < aaText {
            c = blend(c, barInk(c) == paper ? -legibleStep : legibleStep)
            i += 1
        }
        return c
    }

    /// The day view's fill for a FINISHED bar: `doneBarFill(barPaint(op, colour), row)` — the
    /// colour muted 34% toward the DONE grey (barPaint), then the spent grey carrying 30% of
    /// the row behind it (doneBarFill).
    static func doneFill(_ color: String, row: String) -> String {
        let painted = mix(color, doneMute, 0.34)
        return mix(mix(painted, doneMute, 0.8), row, 1 - 0.7)
    }
}
