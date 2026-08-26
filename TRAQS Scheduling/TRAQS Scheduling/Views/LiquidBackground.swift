import SwiftUI

// MARK: - Liquid background
//
// A SwiftUI port of the web app's "Liquid" background mode (src/TRAQS.jsx —
// `LiquidBackground` + the `tqLiquidA…D` keyframes).
//
// TWO big blobs, on a diagonal, wandering. This was a nine-blob ladder ported
// straight from the web, which on a phone read as a busy field of colour rather
// than as liquid — you couldn't follow any one shape, so nothing appeared to
// move. Two large ones you can actually track, with real ground between them,
// is the whole effect: fewer, bigger, slower.
//
// Their periods (23s / 29s) share no factors, so the pair drifts in and out of
// phase forever instead of settling into a loop you can spot. That mattered
// more with nine blobs, but it's cheap to keep and it's what stops the two from
// pulsing in lockstep.
//
// Geometry, colours, opacities and durations are taken straight from the web so
// the two platforms read as the same effect. Sizes there are percentages of the
// container, and CSS `padding-bottom: N%` resolves against the container WIDTH —
// hence `height = containerWidth * pb` here, not `containerHeight`.

// MARK: Tuning
//
// The PAGE canvas's look (PageBackground). The splash deliberately does NOT use
// these — it passes its own heavier, full-bleed values inline. Sharing them was
// tried and cost the load-up its punch: a 2.4s appearance needs more presence
// than a background that sits behind content all day.
enum LiquidTuning {
    /// Blob footprint — THE dial for how much colour is on screen versus how
    /// much ground shows through. Lower = smaller blobs = more page.
    ///
    /// The pair's vertical anchors move with this (see `specs`), so shrinking
    /// pulls them toward each other instead of leaving a pale band across the
    /// middle. Below ~0.6 they stop meeting at all and read as two spots rather
    /// than as a wash.
    static let blobScale: Double = 0.72
    /// Pigment density — the SECOND half of how saturated the wash looks, and
    /// often the more important one. `saturation` decides how vivid a blob's
    /// colour is; this decides how much of it actually lands, since every blob
    /// is drawn at well under full alpha and then blurred. A perfectly vivid
    /// hue at low density still reads as a pastel haze.
    ///
    /// Raised with the move to two blobs: nine overlapping ones were stacking
    /// their alpha into the colour you saw, and two can't. Note `blurRadius`
    /// tightens as this climbs — the two have to move together, because a heavy
    /// blur is exactly what turns pigment back into haze.
    ///
    /// If body text ever starts to swim on the cards sitting over this, raise
    /// `glassSurfaceTint` rather than dropping this back.
    static let thickness: Double = 1.45
    /// Weight the hue ladder toward the accent (~56/22/22).
    static let primaryWeighted: Bool = true

    /// Behind pages: noticeable drift without competing with content.
    static let pageEnergy: Double = 3.0
    /// How far the blob hues are pushed toward full colour. See
    /// `LiquidBackground.saturation`.
    static let saturation: Double = 0.45
}

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

    /// Push a hue toward full colour. `amount` is a FRACTION OF THE HEADROOM
    /// left, not a flat addition: a dull pick gains a lot, an already-vivid one
    /// gains only what it can take, and nothing clips to a different colour.
    ///
    /// Lightness moves too, and it has to. Saturation only reads near mid
    /// lightness — a near-white pastel or a near-black deep tone has nowhere to
    /// put it, so raising S alone leaves both looking exactly as washed out as
    /// before. Easing L toward 0.55 (at a gentler rate, so a deliberately light
    /// or dark accent still reads as itself) is what actually makes the wash
    /// look saturated rather than merely brighter.
    static func vivid(_ hex: String, _ amount: Double) -> String {
        guard amount > 0 else { return hex }
        let (h, s, l) = hexToHSL(hex)
        return hslToHex(h,
                        min(1, s + (1 - s) * amount),
                        l + (0.55 - l) * amount * 0.6)
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
    // tqLiquidA…D, verbatim. Only A and B are in play now that the wash is two
    // blobs (see `specs`); C and D are kept as the alternates to swap in if the
    // pair's wander wants a different shape.
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
    /// Blob footprint, as a fraction of the full-bleed geometry. 1 (the
    /// default, and the splash) is the largest the pair goes: each blob wider
    /// than the canvas and about 0.72 of its height, hanging off opposite
    /// corners so the wash spans it.
    ///
    /// Below 1 both blobs shrink in place, opening the diagonal between them.
    /// That gap is the point — it's how the ground reads through — so this is
    /// the dial for the background-to-colour ratio. Don't take it far below
    /// 0.8: two small blobs read as two spots, not as a wash.
    var blobScale: Double = 1
    /// How far the blob hues are pushed toward full colour, 0…1 — see
    /// `LiquidColor.vivid`. 0 is the accent and its derived tones exactly as
    /// picked, which is what this used to do; the wash read washed-out at two
    /// blobs, where nine overlapping ones had been stacking their colour up.
    ///
    /// Applied AFTER the companion/tertiary maths, never before, so the derived
    /// hues are still worked out from the accent as the user chose it and the
    /// warm/cool family rule still holds.
    var saturation: Double = LiquidTuning.saturation
    /// Pairs the accent with the DEEPER derived tone (`tertiary`) instead of
    /// the lighter `companion`. With only two blobs there's no ladder left to
    /// weight, so this became a straight choice of partner: tertiary gives the
    /// wash body behind content, companion keeps it airier.
    var primaryWeighted: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ThemeSettings.self) private var theme

    /// Blur tightens as the wash thickens — a heavy blur is what turns pigment
    /// back into haze, so the two have to move together — and scales with the
    /// blob's own footprint, because a blur sized for a big blob would dissolve
    /// a small one completely.
    ///
    /// Raised from the nine-blob era's `max(44, 80 / thickness)`: blur has to
    /// grow with the shape it's softening, and these blobs are roughly twice
    /// the size. At the old figure their edges read as hard ellipses.
    private var blurRadius: CGFloat { scale * max(70, 130 / thickness) }

    /// Clamped so a caller can't collapse the wash to nothing or inflate it past
    /// the geometry the ladder was designed around.
    private var scale: Double { max(0.2, min(1, blobScale)) }
    /// Excursions grow with energy, but sub-linearly — at full tilt the blobs
    /// should surge, not fly off the canvas.
    private var amplitude: Double { min(1.7, 1 + (energy - 1) * 0.25) }

    private func a(_ base: Double) -> Double { min(0.92, base * thickness) }

    private var specs: [BlobSpec] {
        let base = color ?? theme.accent
        // Two blobs, so two hues. `primaryWeighted` picks the partner: the
        // deeper tertiary for body behind page content, the lighter companion
        // otherwise. (The nine-blob version cycled all three down the ladder
        // and weighted the mix 5:2:2 — with a pair there's nothing to weight.)
        //
        // Both are then pushed toward full colour. Derive first, saturate
        // second: the partner has to come off the accent as PICKED or the
        // warm/cool family maths is working from the wrong hue.
        let partner = primaryWeighted ? LiquidColor.tertiary(base)
                                      : LiquidColor.companion(base)
        let hues = [LiquidColor.vivid(base, saturation),
                    LiquidColor.vivid(partner, saturation)]

        // Denser than any single blob in the old ladder. Nine overlapping
        // shapes built their colour by stacking; two have to carry it alone, so
        // each one holds more pigment.
        let alphas = [0.58, 0.50]

        // Two paths with different shapes AND different tempos. Reversing B
        // means the second blob is never mirroring the first — the pair drifts
        // apart and back together instead of sliding in parallel.
        let paths = [LiquidPath.a, LiquidPath.reversed(LiquidPath.b)]

        // Coprime, and slower than the old 17/21. Big shapes moving quickly
        // read as sloshing; these are meant to wander.
        let durations: [Double] = [23, 29]

        // Each blob is WIDER than the canvas and about three-quarters of its
        // height, so one alone covers most of the screen and the pair spans it
        // with room to move. `scale` shrinks both in place.
        let w = 1.05 * scale
        let h = 0.72 * scale

        return (0..<2).map { i in
            let isFirst = i == 0
            return BlobSpec(
                id: i,
                w: w,
                h: h,
                // Opposite corners on a diagonal: one anchored off the leading
                // edge up top, one off the trailing edge down low. Overlapping
                // through the middle, leaving the OTHER two corners as ground —
                // which is what makes the composition read as two shapes on a
                // background rather than as full-bleed colour.
                leading:  isFirst ? -0.18 : nil,
                trailing: isFirst ? nil   : -0.18,
                // Anchored as fractions of the blob's OWN height, not of the
                // screen — that's what lets `scale` shrink the pair without
                // pulling them apart. Two blobs can only span a screen while
                // their heights still roughly sum to it, so as they shrink they
                // have to sit closer to the middle; with fixed screen-space
                // anchors, dropping the scale opened a pale horizontal band
                // between them instead of the diagonal of ground that's wanted.
                //
                // They still hang off the top and bottom edges, just less far.
                top: isFirst ? -h * 0.15 : 1 - h * 0.85,
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
