import SwiftUI

// MARK: - The intro
//
// The gate opens on the lockup alone over a drifting liquid wash, with one
// button. Pressing it moves the logo up, disperses the wash, and brings the form
// in behind it.
//
// This REPLACES the web's timed load-up, deliberately, and it is worth writing
// down why rather than leaving it as a divergence someone later "corrects".
//
// The web's version is a 2.4s timeline that measures the lockup's resting
// position at runtime and animates it up from screen centre. Ported faithfully,
// that measurement is a feedback loop: the thing being measured is the thing
// being moved, so measuring changes the offset, which changes the measurement.
// The first attempt here read the animated view and jittered; the fix would have
// been to measure a stable proxy of it.
//
// Triggering the move from a BUTTON removes the problem instead of managing it.
// In `.welcome` the lockup is the only content, so it is genuinely centred — no
// measurement can be wrong. In `.form` there is more content below it, so the
// same centred column puts the lockup higher, and the move is a LAYOUT change
// SwiftUI animates on its own. Nothing measures anything.
//
// It is also a better fit for a desktop app: a 2.4s animation you cannot skip is
// tolerable on a page you loaded, and tiresome on an app you open every morning.

enum GateIntroPhase {
    /// Lockup, wash, one button.
    case welcome
    /// The form. The lockup has moved up out of its way.
    case form
}

extension GateIntroPhase {
    /// The move — slow, fast, slow (`cubic-bezier(0.83, 0, 0.17, 1)`, the web's
    /// travel curve, kept).
    static let travel = Animation.timingCurve(0.83, 0, 0.17, 1, duration: 0.9)
    /// The form arrives HALFWAY through the travel, so the two overlap and read
    /// as one gesture rather than two events.
    static let contentDelayMS: Double = 450
}

// MARK: - The wash
//
// A small drifting wash in the GATE's palette, not the app's `LiquidBackground`.
//
// That one is portable — pure SwiftUI — but it reads `theme.accent`, and the gate
// has no theme: it renders before one is resolved, which is the whole reason it
// carries `LOGIN_BLUE` (App.jsx:24). Linking it would mean fighting that
// dependency for a screen that cannot use it.
//
// Two blobs, drifting on long out-of-phase loops so the motion never visibly
// repeats, heavily blurred so they read as light rather than as shapes.
struct GateLiquidWash: View {
    /// Falls to 0 and the wash disperses — blobs drift apart and fade out.
    var dispersed: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            GeometryReader { geo in
                let side = max(geo.size.width, geo.size.height)
                ZStack {
                    blob(t: t, geo: geo, side: side,
                         color: GatePalette.blue, period: 23, phase: 0,
                         home: CGPoint(x: 0.32, y: 0.38), reach: 0.10)
                    blob(t: t, geo: geo, side: side,
                         color: .hex("#4169e1"), period: 31, phase: 2.1,
                         home: CGPoint(x: 0.68, y: 0.60), reach: 0.12)
                }
                // Blur LAST and hard: it is what turns two ellipses back into a
                // wash. Sized off the canvas so it holds at any window size.
                .blur(radius: side * 0.13)
                .opacity(dispersed ? 0 : 1)
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }

    /// One blob. `home` is its resting centre as a fraction of the canvas;
    /// `reach` how far it wanders from it.
    private func blob(t: TimeInterval, geo: GeometryProxy, side: CGFloat,
                      color: Color, period: Double, phase: Double,
                      home: CGPoint, reach: CGFloat) -> some View {
        let a = (t / period + phase) * 2 * .pi
        // Two different frequencies per axis, so the path is a slow Lissajous
        // figure rather than a circle you can follow.
        let dx = cos(a) * reach
        let dy = sin(a * 0.7) * reach
        // Dispersal pushes each blob further out along its own axis as it fades,
        // so the wash comes APART rather than just dimming.
        let escape: CGFloat = dispersed ? 0.35 : 0
        let x = (home.x + dx + (home.x < 0.5 ? -escape : escape)) * geo.size.width
        let y = (home.y + dy) * geo.size.height
        return Circle()
            .fill(RadialGradient(colors: [color.opacity(0.55), color.opacity(0)],
                                 center: .center, startRadius: 0, endRadius: side * 0.30))
            .frame(width: side * 0.75, height: side * 0.75)
            .position(x: x, y: y)
    }
}

// MARK: - Get Started

/// The one button on the welcome phase. Liquid glass, like every other button in
/// the app.
struct GateGetStartedButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Get Started")
                .font(TFont.body(15, 700))
                .tracking(15 * -0.01)
                .foregroundStyle(.white)
                .padding(.horizontal, 34)
                .padding(.vertical, 14)
                .gateGlass(GatePalette.ink)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(0.18), radius: 10, y: 5)
    }
}
