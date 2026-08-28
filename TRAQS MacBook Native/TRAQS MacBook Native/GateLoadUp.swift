import SwiftUI

// MARK: - The load-up
//
// A staged timeline, copied from LOADUP_CSS and the constants under it
// (App.jsx:271–330). Not one fade: the logo arrives at CENTRE, holds, then
// travels up to its resting place, and the copy, card and strapline fade in one
// at a time behind it — the web's words: "the eye is led down the page:
// greeting, instructions, card, then the strapline once the rest has settled."
enum GateLoadUp {

    enum Timing {
        /// LOGO_MS. "The logo runs 2.4s: ~960ms fading in at centre (40%), a
        /// brief hold, then the travel up."
        static let logoMS: Double = 2400
        /// COPY_MS — the greeting and instructions share this slower fade.
        static let copyMS: Double = 760
        static let titleAtMS: Double = 2150    // TITLE_AT, "just before the logo lands"
        static let blurbAtMS: Double = 2300    // BLURB_AT = TITLE_AT + 150
        static let cardAtMS:  Double = 2630    // CARD_AT  = BLURB_AT + 330
        static let footAtMS:  Double = 3250    // FOOT_AT  = CARD_AT + 620
        /// FADE's default duration.
        static let fadeMS: Double = 520
        /// tqFadeUp's travel — `translateY(7px)`.
        static let fadeUpDistance: CGFloat = 7

        // tqLogoIn's keyframe stops, as fractions of logoMS: fade+scale to 40%,
        // hold to 46%, then travel to 100%.
        static let logoFadeEnd: Double = 0.40
        static let logoHoldEnd: Double = 0.46
    }
}

// MARK: - tqLogoIn
//
/// The logo's arrival: fade in at centre to 40%, hold to 46%, then rise.
///
/// `rise` is how far BELOW its resting place the lockup starts, and the caller
/// MEASURES it rather than passing a constant. The web's reason: "Any fixed
/// vh/px start lands wherever the content height happens to put it… a percentage
/// that centres the logo on a laptop drops it well below centre on a tall
/// monitor." So the caller reads the lockup's resting position and hands in the
/// exact offset to window centre.
///
/// The two phases carry DIFFERENT curves, and that separation is the point. The
/// web's note: "The travel uses a per-keyframe timing function so the fade and
/// the move can have different curves in ONE animation: the hold is linear, then
/// the move runs easeInOutQuint — slow, fast, slow — rather than a single curve
/// applied across both phases, which would have made the fade drift upward."
struct GateLogoIn: ViewModifier {
    let rise: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var run = false

    func body(content: Content) -> some View {
        if reduceMotion {
            // The `@media (prefers-reduced-motion: reduce)` block: no animation,
            // full opacity, no transform.
            content
        } else {
            let total = GateLoadUp.Timing.logoMS / 1000
            let fade = total * GateLoadUp.Timing.logoFadeEnd
            let hold = total * (GateLoadUp.Timing.logoHoldEnd - GateLoadUp.Timing.logoFadeEnd)
            let travel = total * (1 - GateLoadUp.Timing.logoHoldEnd)

            content
                .keyframeAnimator(initialValue: LogoPhase(y: rise), trigger: run) { view, p in
                    view.opacity(p.opacity)
                        .scaleEffect(p.scale)
                        .offset(y: p.y)
                } keyframes: { _ in
                    // 0% → 40%: opacity 0→1 and scale .97→1 on
                    // cubic-bezier(.33,0,.2,1), while y stays at `rise`.
                    KeyframeTrack(\.opacity) {
                        CubicKeyframe(1, duration: fade)
                        LinearKeyframe(1, duration: hold + travel)
                    }
                    KeyframeTrack(\.scale) {
                        CubicKeyframe(1, duration: fade)
                        LinearKeyframe(1, duration: hold + travel)
                    }
                    // 46% → 100%: the travel to 0, on cubic-bezier(.83,0,.17,1).
                    KeyframeTrack(\.y) {
                        LinearKeyframe(rise, duration: fade + hold)
                        CubicKeyframe(0, duration: travel)
                    }
                }
                .onAppear { run = true }
        }
    }

    struct LogoPhase {
        var opacity: Double = 0
        /// tqLogoIn starts at `scale(.97)`.
        var scale: CGFloat = 0.97
        var y: CGFloat = 0
    }
}

// MARK: - tqFadeUp
//
/// One staged element — the greeting, the blurb, the card or the strapline.
/// `FADE(delay, ms)` on the web, which is `tqFadeUp` at
/// `cubic-bezier(.22,1,.36,1)`.
struct GateFadeUp: ViewModifier {
    let delayMS: Double
    var durationMS: Double = GateLoadUp.Timing.fadeMS
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : GateLoadUp.Timing.fadeUpDistance)
                .onAppear {
                    withAnimation(
                        .timingCurve(0.22, 1, 0.36, 1, duration: durationMS / 1000)
                            .delay(delayMS / 1000)
                    ) { shown = true }
                }
        }
    }
}

extension View {
    /// See `GateLogoIn`. `rise` must be MEASURED, not guessed.
    func gateLogoIn(rise: CGFloat) -> some View {
        modifier(GateLogoIn(rise: rise))
    }
    /// See `GateFadeUp`. Delays come from `GateLoadUp.Timing`.
    func gateFadeUp(delayMS: Double,
                    durationMS: Double = GateLoadUp.Timing.fadeMS) -> some View {
        modifier(GateFadeUp(delayMS: delayMS, durationMS: durationMS))
    }
}

// MARK: - Measuring the rise
//
// The load-up's one runtime measurement, kept here beside the animation that
// needs it rather than re-derived per step.
//
// Wrap the lockup in this. It reads the lockup's RESTING position in window
// space, works out how far below that the window's vertical centre is, and hands
// that distance to `gateLogoIn`. That is what makes the fade happen dead centre
// on any screen — the whole reason the web measures instead of using a `vh`.
/// Hands its content the measured rise AND whether the measurement has happened
/// yet. Both, because they are different questions: a rise of 0 is a perfectly
/// valid measurement — it means the lockup already rests at window centre — and
/// inferring "measured" from `rise > 0` leaves the logo hidden forever in exactly
/// that case. That bug shipped once; hence the second value.
struct GateRiseMeasured<Content: View>: View {
    @ViewBuilder let content: (CGFloat, Bool) -> Content
    @State private var rise: CGFloat = 0
    @State private var measured = false

    var body: some View {
        GeometryReader { window in
            content(rise, measured)
                .background {
                    GeometryReader { me in
                        Color.clear
                            .onAppear { measure(me, in: window) }
                            .onChange(of: me.frame(in: .global)) { _, _ in
                                measure(me, in: window)
                            }
                    }
                }
        }
    }

    private func measure(_ me: GeometryProxy, in window: GeometryProxy) {
        let myCentre = me.frame(in: .global).midY
        let windowCentre = window.frame(in: .global).midY
        let next = max(0, windowCentre - myCentre)
        // Only when it actually moves — an unconditional write here re-renders
        // every frame the geometry reports, which fights the animation.
        if abs(next - rise) > 0.5 { rise = next }
        // Set REGARDLESS of the value, and separately from it: the point is that a
        // measurement happened, not that it was non-zero.
        if !measured { measured = true }
    }
}
