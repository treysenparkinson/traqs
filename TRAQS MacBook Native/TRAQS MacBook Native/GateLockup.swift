import SwiftUI
import CoreText

// MARK: - The brand lockup
//
// `TraqsLockup` (App.jsx:43): "traqs" in Space Grotesk 700 at -.05em, thickened
// with `-webkit-text-stroke: 1.5px` in the SAME colour as the fill, then the bars
// mark at .52em with its bottom on the text baseline.
//
// The wordmark is a PATH, not a `Text`, and that is forced rather than chosen.
// `-webkit-text-stroke` is not an outline: it is a stroke centred on the glyph
// outline, in the fill colour, so it THICKENS the letterforms by half its width
// on each side. Reproducing it means having the outlines — and SwiftUI's `Text`
// cannot stroke at all. So the glyphs come from CoreText and get filled and then
// stroked.
//
// Same `Canvas` + `Path` approach `WebGlyph` uses for the sidebar icons, so there
// is one way of drawing vector art in this app rather than two.
struct GateLockup: View {
    /// `TraqsLockup`'s own default.
    var size: CGFloat = 84
    var color: Color = GatePalette.ink
    /// `stroke = 1.5` — a fixed px value on the web, NOT em-relative, so it does
    /// not scale with `size`. Copied as-is.
    var stroke: CGFloat = 1.5
    var bars: Bool = true

    var body: some View {
        // `alignItems: "baseline"` — "the bars image aligns its BOTTOM to the text
        // baseline".
        //
        // The Canvas is trimmed to the wordmark's INK, and its bottom edge is NOT
        // the baseline: "traqs" contains a `q`, whose descender runs 16.8pt below
        // the baseline at size 84 (measured — exactly 0.2em). Aligning the bars to
        // the Canvas bottom therefore dropped them a FIFTH of the lockup's height
        // too low, which is the misalignment against the "s" you could see.
        //
        // So the bars are lifted back up by the descent, which puts their bottom
        // on the real baseline.
        let metrics = Self.glyphPath("traqs", size: size, tracking: size * -0.05)
        return HStack(alignment: .bottom, spacing: 0) {
            wordmark(metrics)
            if bars {
                GateBarsMark()
                    .frame(height: size * 0.52)          // ".52em", the x-height
                    .padding(.leading, size * 0.07)      // "margin-left: .07em"
                    .padding(.bottom, metrics.descent)   // up onto the baseline
                    .offset(y: size * 0.01)              // "translateY(.01em)" — CSS
                                                         // +y is down, and so is
                                                         // SwiftUI's, so this matches
            }
        }
    }

    private func wordmark(_ m: Wordmark) -> some View {
        let (path, sz) = (m.path, m.size)
        return Canvas { ctx, _ in
            // Offset by half the stroke so the stroke's outer edge lands inside
            // the frame instead of being clipped by the Canvas.
            ctx.translateBy(x: stroke / 2, y: stroke / 2)
            ctx.fill(path, with: .color(color))
            // The thickening. SAME colour as the fill — this is weight, not an
            // outline.
            ctx.stroke(path, with: .color(color), lineWidth: stroke)
        }
        .frame(width: sz.width + stroke, height: sz.height + stroke)
    }

    /// "traqs" as outlines, positioned by CoreText, flipped into SwiftUI's y-down
    /// space and moved to the origin.
    ///
    /// `tracking` goes in as `.kern` so CoreText applies it while laying the run
    /// out. Applied afterwards it would move the glyphs without changing the
    /// advances, which is a different thing and looks like it.
    /// The wordmark's outlines plus the two measurements the lockup needs: how big
    /// the ink is, and how far the `q` hangs below the baseline.
    struct Wordmark {
        let path: Path
        let size: CGSize
        /// Ink below the baseline, in points. The bars sit on the BASELINE, not on
        /// the bottom of the ink, so this is what lifts them.
        let descent: CGFloat
    }

    static func glyphPath(_ s: String, size: CGFloat,
                          tracking: CGFloat) -> Wordmark {
        let font = CTFontCreateWithName(TWordmark.face as CFString, size, nil)
        let attr = NSAttributedString(string: s, attributes: [
            .font: font,
            .kern: tracking,
        ])
        let line = CTLineCreateWithAttributedString(attr)
        let combined = CGMutablePath()
        for run in (CTLineGetGlyphRuns(line) as? [CTRun] ?? []) {
            let n = CTRunGetGlyphCount(run)
            guard n > 0 else { continue }
            var glyphs = [CGGlyph](repeating: 0, count: n)
            var pos = [CGPoint](repeating: .zero, count: n)
            CTRunGetGlyphs(run, CFRangeMake(0, n), &glyphs)
            CTRunGetPositions(run, CFRangeMake(0, n), &pos)
            // Force-cast, not `as?`: a conditional downcast to a CoreFoundation
            // type always succeeds, so the compiler rejects it as redundant. The
            // attribute is guaranteed present — CTLine put it there.
            let attrs = CTRunGetAttributes(run) as NSDictionary
            let runFont = attrs[kCTFontAttributeName as String] as! CTFont
            for i in 0..<n {
                guard let g = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) else { continue }
                combined.addPath(g, transform: CGAffineTransform(translationX: pos[i].x,
                                                                 y: pos[i].y))
            }
        }
        let b = combined.boundingBox
        guard !b.isNull, b.width > 0 else { return Wordmark(path: Path(), size: .zero, descent: 0) }
        let flip = CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: -b.minX, y: -b.maxY)
        // CoreText puts the baseline at y=0 and descenders below it, so a negative
        // minY IS the descent.
        return Wordmark(path: Path(combined).applying(flip),
                        size: CGSize(width: b.width, height: b.height),
                        descent: max(0, -b.minY))
    }
}

// MARK: - The bars mark
//
// Drawn, not embedded. The web uses `traqs-bars.png`; this draws the same four
// bars so the lockup stays sharp at any size.
//
// Every number below was MEASURED out of that PNG (1300×1058) rather than
// guessed — bar bands at rows 0–187, 290–477, 580–767, 870–1057, all
// left-aligned, and the colours sampled from the pixels:
//
//   greys  #747270
//   accent #38BDF8   <- exactly LOGIN_BLUE, which is what App.jsx:25 means by
//                       "the sky baked into the bars asset, so login and app
//                       agree"
//
// The iOS app's `TRAQSBarsMark` has the same fractions to within 0.3%, which is
// a useful cross-check, but it cannot be reused here: it reads `ThemeSettings`
// and `T.muted` to track the app's theme, and the gate has no theme.
struct GateBarsMark: View {
    var grey: Color = .hex("#747270")
    var accent: Color = GatePalette.blue

    /// 1300 / 1058.
    static let aspect: CGFloat = 1300.0 / 1058.0
    /// Bar widths as a fraction of the mark's full width, top → bottom.
    private let widths: [CGFloat] = [0.5523, 0.7892, 1.0, 0.4477]
    /// The third bar is the full-width accent one.
    private let accentIndex = 2
    /// 188 / 1058 and 102 / 1058.
    private let barHFraction: CGFloat = 0.1777
    private let gapFraction: CGFloat = 0.0964

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            let fullWidth = h * Self.aspect
            let barH = h * barHFraction
            let gap = h * gapFraction
            VStack(alignment: .leading, spacing: gap) {
                ForEach(widths.indices, id: \.self) { i in
                    RoundedRectangle(cornerRadius: barH * 0.32, style: .continuous)
                        .fill(i == accentIndex ? accent : grey)
                        .frame(width: fullWidth * widths[i], height: barH)
                }
            }
            .frame(width: fullWidth, height: h, alignment: .leading)
        }
        .aspectRatio(Self.aspect, contentMode: .fit)
    }
}
