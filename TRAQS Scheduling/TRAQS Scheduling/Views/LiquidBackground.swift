import SwiftUI

// MARK: - Liquid background
//
// A SwiftUI port of the web app's "Liquid" background mode (src/TRAQS.jsx —
// `LiquidBackground` + the `tqLiquidA…D` keyframes). Five heavily blurred blobs
// wander on four different paths at four tempos; because the periods don't
// divide evenly (17s / 21s / 19s / 25s / 15s) the overlaps keep re-mixing
// instead of settling into a loop you can spot.
//
// Geometry, colours, opacities and durations are taken straight from the web so
// the two platforms read as the same effect. Sizes there are percentages of the
// container, and CSS `padding-bottom: N%` resolves against the container WIDTH —
// hence `height = containerWidth * pb` here, not `containerHeight`.

// MARK: Colour maths (ports of hexToHsl / hslToHex / companionHue)

enum LiquidColor {
    static func hexToHSL(_ hex: String) -> (h: Double, s: Double, l: Double) {
        var s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        s = s.padding(toLength: 6, withPad: "0", startingAt: 0)
        let v = UInt32(s, radix: 16) ?? 0
        let r = Double((v >> 16) & 0xFF) / 255
        let g = Double((v >> 8) & 0xFF) / 255
        let b = Double(v & 0xFF) / 255
        let mx = max(r, g, b), mn = min(r, g, b), d = mx - mn
        var hue = 0.0
        if d != 0 {
            if mx == r { hue = ((g - b) / d).truncatingRemainder(dividingBy: 6) }
            else if mx == g { hue = (b - r) / d + 2 }
            else { hue = (r - g) / d + 4 }
        }
        hue = (hue * 60).truncatingRemainder(dividingBy: 360)
        if hue < 0 { hue += 360 }
        let l = (mx + mn) / 2
        let sat = d == 0 ? 0 : d / (1 - abs(2 * l - 1))
        return (hue, sat, l)
    }

    static func hslToHex(_ h: Double, _ s: Double, _ l: Double) -> String {
        var hh = h.truncatingRemainder(dividingBy: 360)
        if hh < 0 { hh += 360 }
        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs((hh / 60).truncatingRemainder(dividingBy: 2) - 1))
        let m = l - c / 2
        let (r, g, b): (Double, Double, Double)
        switch hh {
        case ..<60:   (r, g, b) = (c, x, 0)
        case ..<120:  (r, g, b) = (x, c, 0)
        case ..<180:  (r, g, b) = (0, c, x)
        case ..<240:  (r, g, b) = (0, x, c)
        case ..<300:  (r, g, b) = (x, 0, c)
        default:      (r, g, b) = (c, 0, x)
        }
        let hx = { (v: Double) in String(format: "%02X", Int((v + m) * 255 + 0.5)) }
        return "#\(hx(r))\(hx(g))\(hx(b))"
    }

    /// A companion hue for the wash, derived from the chosen colour. It stays in
    /// the same temperature family — a warm pick gets a warm partner, a cool
    /// pick a cool one — so the blobs read as one palette rather than a clash.
    /// Warm is the red→yellow and magenta arc (h < 55 or h >= 295).
    static func companion(_ hex: String) -> String {
        let (h, s, l) = hexToHSL(hex)
        let warm = h < 55 || h >= 295
        let shifted = warm ? (h < 55 ? h + 32 : h - 34)
                           : (h < 180 ? h + 46 : h - 46)
        return hslToHex(shifted, min(1, max(0.45, s)), min(0.68, max(0.42, l)))
    }

    /// Warm is a wrapped arc (295°→360°→55°); cool is the 55°→295° span between.
    /// Linearising each into 0…len lets us rotate a hue and REFLECT off the ends
    /// rather than wrapping past them, so a rotation can never tip a warm pick
    /// into the cool family or vice versa.
    private static func rotateInFamily(_ h: Double, by degrees: Double) -> Double {
        let warm = h < 55 || h >= 295
        let len = warm ? 120.0 : 240.0
        let pos = warm ? (h >= 295 ? h - 295 : h + 65) : h - 55
        var p = pos + degrees
        if p < 0 { p = -p }                 // reflect off the low end
        if p > len { p = 2 * len - p }      // …and the high end
        p = min(max(p, 0), len)
        return warm ? (p + 295).truncatingRemainder(dividingBy: 360) : p + 55
    }

    /// A THIRD hue for the wash. `companion` rotates one way from the pick; this
    /// rotates the other, so the three tones straddle the chosen colour instead
    /// of stacking to one side of it. Deeper and more saturated than the other
    /// two — it's what gives the wash its body rather than another pastel.
    static func tertiary(_ hex: String) -> String {
        let (h, s, l) = hexToHSL(hex)
        let warm = h < 55 || h >= 295
        let hue = rotateInFamily(h, by: warm ? -26 : -38)
        return hslToHex(hue, min(1, max(0.55, s)), min(0.58, max(0.34, l)))
    }
}

// MARK: Motion paths

/// One keyframe of a blob's wander: offset as a fraction of the blob's own size
/// (CSS `translate(%)` is relative to the element's own box), plus a scale.
private struct LiquidStop {
    let t: Double      // 0…1 through the loop
    let x: Double      // fraction of blob width
    let y: Double      // fraction of blob height
    let scale: Double
}

private enum LiquidPath {
    // tqLiquidA…D, verbatim.
    static let a: [LiquidStop] = [
        .init(t: 0.00, x: 0,     y: 0,     scale: 1.00),
        .init(t: 0.25, x: 0.26,  y: 0.17,  scale: 1.32),
        .init(t: 0.55, x: -0.19, y: 0.28,  scale: 0.80),
        .init(t: 0.80, x: 0.15,  y: -0.16, scale: 1.18),
        .init(t: 1.00, x: 0,     y: 0,     scale: 1.00),
    ]
    static let b: [LiquidStop] = [
        .init(t: 0.00, x: 0,     y: 0,     scale: 1.06),
        .init(t: 0.30, x: -0.30, y: 0.22,  scale: 0.78),
        .init(t: 0.60, x: 0.22,  y: -0.19, scale: 1.38),
        .init(t: 0.85, x: -0.13, y: 0.12,  scale: 0.94),
        .init(t: 1.00, x: 0,     y: 0,     scale: 1.06),
    ]
    static let c: [LiquidStop] = [
        .init(t: 0.00, x: 0,     y: 0,     scale: 0.95),
        .init(t: 0.35, x: 0.29,  y: -0.24, scale: 1.30),
        .init(t: 0.65, x: -0.25, y: -0.12, scale: 1.06),
        .init(t: 1.00, x: 0,     y: 0,     scale: 0.95),
    ]
    static let d: [LiquidStop] = [
        .init(t: 0.00, x: 0,     y: 0,     scale: 1.10),
        .init(t: 0.40, x: -0.24, y: -0.26, scale: 0.82),
        .init(t: 0.70, x: 0.27,  y: 0.19,  scale: 1.34),
        .init(t: 1.00, x: 0,     y: 0,     scale: 1.10),
    ]

    /// CSS `animation-direction: reverse` — walk the same stops backwards.
    static func reversed(_ stops: [LiquidStop]) -> [LiquidStop] {
        stops.reversed().map { .init(t: 1 - $0.t, x: $0.x, y: $0.y, scale: $0.scale) }
    }
}

private struct BlobSpec: Identifiable {
    let id: Int
    let w: Double            // fraction of container width
    /// Height as a fraction of container HEIGHT — a deliberate departure from
    /// the web, where `padding-bottom: N%` resolves against WIDTH. That works on
    /// a wide desktop viewport but on a tall phone it makes every blob short,
    /// so the wash bunched into the top two-thirds and left the bottom bare.
    let h: Double
    let leading: Double?     // fraction of container width from the leading edge
    let trailing: Double?    // …or from the trailing edge
    let top: Double          // fraction of container height
    let hex: String
    let alpha: Double
    let stops: [LiquidStop]
    let duration: Double
}

// MARK: The wash

struct LiquidBackground: View {
    /// Primary blob hue. Defaults to the customization accent, which is what
    /// `liquidColor` maps to on this platform.
    var color: String? = nil
    /// Painted behind the blobs so the wash works on any ground.
    var base: AnyShapeStyle? = nil
    var opacity: Double = 1
    /// Density of the wash. 1 = the web's values; above that the blobs carry
    /// more pigment and blur less, so the colour reads as body rather than haze.
    var thickness: Double = 1.4
    /// Motion multiplier. 1 = the web's ambient tempo (17–25s paths, which
    /// barely register over a short splash). Higher runs the same paths faster
    /// and travels further, so the wash visibly churns during a load-up.
    var energy: Double = 1

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ThemeSettings.self) private var theme

    /// Blur tightens as the wash thickens — a heavy blur is what turns pigment
    /// back into haze, so the two have to move together.
    private var blurRadius: CGFloat { max(44, 80 / thickness) }
    /// Excursions grow with energy, but sub-linearly — at full tilt the blobs
    /// should surge, not fly off the canvas.
    private var amplitude: Double { min(1.7, 1 + (energy - 1) * 0.25) }

    private func a(_ base: Double) -> Double { min(0.92, base * thickness) }

    private var specs: [BlobSpec] {
        let c = color ?? theme.accent
        let c2 = LiquidColor.companion(c)
        let c3 = LiquidColor.tertiary(c)
        // Nine blobs on a staggered ladder. Each is 0.34 of the height and they
        // step by 0.13, so every point on screen falls inside at least two of
        // them; the first starts above the top edge and the last ends below the
        // bottom one. Sides ALTERNATE and each blob is 0.76 wide with a -0.12
        // inset, so each pair of neighbours spans the full width between them —
        // a single 0.76-wide blob leaves ~140pt bare at the edges, which a 50pt
        // blur cannot bridge. That's what left the top and bottom corners empty.
        //
        // Durations are 13–29s with no shared factors, so the eight paths never
        // line back up and the field keeps re-mixing instead of visibly looping.
        // The three hues cycle down the ladder so no one colour owns a region.
        let hues = [c, c2, c3, c2, c, c3, c2, c, c3]
        let alphas = [0.55, 0.50, 0.38, 0.34, 0.42, 0.34, 0.38, 0.44, 0.36]
        let paths = [LiquidPath.a, LiquidPath.b, LiquidPath.c, LiquidPath.d,
                     LiquidPath.reversed(LiquidPath.b), LiquidPath.reversed(LiquidPath.a),
                     LiquidPath.reversed(LiquidPath.c), LiquidPath.reversed(LiquidPath.d),
                     LiquidPath.a]
        let durations: [Double] = [17, 21, 19, 25, 15, 23, 13, 27, 29]
        return (0..<9).map { i in
            let fromLeading = i % 2 == 0
            return BlobSpec(
                id: i,
                w: 0.76,
                h: 0.34,
                leading: fromLeading ? -0.12 : nil,
                trailing: fromLeading ? nil : -0.12,
                top: -0.16 + Double(i) * 0.13,
                hex: hues[i],
                alpha: a(alphas[i]),
                stops: paths[i],
                duration: durations[i]
            )
        }
    }

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width, H = geo.size.height
            ZStack(alignment: .topLeading) {
                if let base { Rectangle().fill(base) }
                ForEach(specs) { s in
                    let w = W * s.w, h = H * s.h
                    let x = s.leading.map { $0 * W } ?? (W - (s.trailing ?? 0) * W - w)
                    blob(s, w: w, h: h)
                        .offset(x: x, y: s.top * H)
                }
            }
            .frame(width: W, height: H)
        }
        .opacity(opacity)
        .clipped()
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func blob(_ s: BlobSpec, w: CGFloat, h: CGFloat) -> some View {
        let shape = Ellipse()
            .fill(Color(hex: s.hex).opacity(s.alpha))
            .frame(width: w, height: h)
            .blur(radius: blurRadius)

        if reduceMotion {
            // A perpetual ambient loop is exactly what this preference asks us
            // not to run — the wash stays, the motion stops. (Matches the web's
            // prefers-reduced-motion rule.)
            shape
        } else {
            // Segments carry their OWN duration, and the animator starts on the
            // path's first stop — several paths begin at a scale other than 1.
            let segs = segments(s)
            let first = s.stops[0]
            KeyframeAnimator(initialValue: LiquidState(x: first.x, y: first.y, scale: first.scale),
                             repeating: true) { st in
                shape
                    .scaleEffect(st.scale)
                    .offset(x: st.x * w * amplitude, y: st.y * h * amplitude)
            } keyframes: { _ in
                KeyframeTrack(\.x)     { for g in segs { CubicKeyframe(g.stop.x,     duration: g.dur) } }
                KeyframeTrack(\.y)     { for g in segs { CubicKeyframe(g.stop.y,     duration: g.dur) } }
                KeyframeTrack(\.scale) { for g in segs { CubicKeyframe(g.stop.scale, duration: g.dur) } }
            }
        }
    }

    /// Each stop after the first, paired with the length of the segment leading
    /// into it — CSS keyframe percentages are absolute, SwiftUI durations are
    /// relative, so the gap between consecutive stops is what we need.
    private func segments(_ s: BlobSpec) -> [(stop: LiquidStop, dur: Double)] {
        let period = s.duration / max(0.1, energy)
        return zip(s.stops.dropFirst(), s.stops).map { next, prev in
            (next, (next.t - prev.t) * period)
        }
    }
}

private struct LiquidState {
    var x: Double = 0
    var y: Double = 0
    var scale: Double = 1
}
