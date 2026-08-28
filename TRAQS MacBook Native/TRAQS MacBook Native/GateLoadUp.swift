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
        // The logo's arrival, as three named phases rather than percentages of a
        // total — the phases are what the design is actually specified in, and
        // percentages made every change here arithmetic.
        //
        /// Fading up at centre.
        static let logoFadeMS: Double = 700
        /// Then it just SITS there. Short on purpose: long enough to register as
        /// an arrival, not long enough to feel like a splash screen.
        static let logoHoldMS: Double = 500
        /// Then the travel up — slow, fast, slow. See `logoTravelCurve`.
        static let logoTravelMS: Double = 900
        static var logoMS: Double { logoFadeMS + logoHoldMS + logoTravelMS }

        /// The rest of the page starts HALFWAY THROUGH THE TRAVEL, so the copy is
        /// already rising while the logo is still moving. Waiting for the logo to
        /// land makes the two read as separate events; overlapping them reads as
        /// one gesture.
        static var contentStartMS: Double {
            logoFadeMS + logoHoldMS + logoTravelMS / 2
        }

        // The staggered gaps AFTER that point are the web's own: blurb +150,
        // card +480, strapline +1100.
        static var titleAtMS: Double { contentStartMS }
        static var blurbAtMS: Double { contentStartMS + 150 }
        static var cardAtMS:  Double { contentStartMS + 480 }
        static var footAtMS:  Double { contentStartMS + 1100 }

        /// COPY_MS — the greeting and instructions share this slower fade.
        static let copyMS: Double = 760
        /// FADE's default duration.
        static let fadeMS: Double = 520
        /// tqFadeUp's travel — `translateY(7px)`.
        static let fadeUpDistance: CGFloat = 7
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
/// The three phases carry DIFFERENT curves, and that separation is the point. The
/// web's note: "The travel uses a per-keyframe timing function so the fade and
/// the move can have different curves in ONE animation: the hold is linear, then
/// the move runs easeInOutQuint — slow, fast, slow — rather than a single curve
/// applied across both phases, which would have made the fade drift upward."
///
/// The rest of the page does not wait for the logo to land — it starts halfway
/// through the travel. See `Timing.contentStartMS`.
struct GateLogoIn: ViewModifier {
    let rise: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var faded = false
    @State private var travelled = false

    func body(content: Content) -> some View {
        if reduceMotion {
            // The `@media (prefers-reduced-motion: reduce)` block: no animation,
            // full opacity, no transform.
            content
        } else {
            content
                .opacity(faded ? 1 : 0)
                .scaleEffect(faded ? 1 : 0.97)
                .offset(y: travelled ? 0 : rise)
                .task {
                    // TWO staged animations rather than one keyframeAnimator, and
                    // the reason is precision: SwiftUI's keyframe types interpolate
                    // their own way and cannot be handed an arbitrary cubic-bezier.
                    // These curves are the specification, not an approximation of
                    // it, so each phase gets its own `timingCurve`.
                    withAnimation(.timingCurve(0.33, 0, 0.2, 1,
                                              duration: GateLoadUp.Timing.logoFadeMS / 1000)) {
                        faded = true
                    }
                    try? await Task.sleep(for: .milliseconds(
                        Int(GateLoadUp.Timing.logoFadeMS + GateLoadUp.Timing.logoHoldMS)))
                    // easeInOutQuint — slow, fast, slow.
                    withAnimation(.timingCurve(0.83, 0, 0.17, 1,
                                              duration: GateLoadUp.Timing.logoTravelMS / 1000)) {
                        travelled = true
                    }
                }
        }
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
