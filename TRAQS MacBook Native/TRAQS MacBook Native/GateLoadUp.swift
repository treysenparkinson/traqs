import SwiftUI

// MARK: - Staged fades
//
// What is left of the web's load-up (LOADUP_CSS and the constants under it,
// App.jsx:271–330): the staggered fade-ups that bring the copy, card and
// strapline in one at a time, so "the eye is led down the page".
//
// The LOGO's arrival is no longer here. It is a layout change driven by a button
// now — see GateIntro, which explains why the timed, self-measuring version was
// replaced rather than ported.
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
    /// See `GateFadeUp`. Delays come from `GateLoadUp.Timing`.
    func gateFadeUp(delayMS: Double,
                    durationMS: Double = GateLoadUp.Timing.fadeMS) -> some View {
        modifier(GateFadeUp(delayMS: delayMS, durationMS: durationMS))
    }
}
