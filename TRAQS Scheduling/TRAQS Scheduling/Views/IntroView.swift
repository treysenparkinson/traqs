import SwiftUI

// MARK: - Intro · the front door before Welcome
//
// The logo on the paper ground, the brand's four-colour liquid wash moving
// around it, and Get Started. Tapping it disperses the wash like smoke, the
// button goes with it, and the logo stays exactly where it is — WelcomeView
// then picks the logo up in that same spot (`logoAlreadyShown`) and carries it
// to its resting place, so the handoff is one continuous move, not two screens.
//
// The logo sits where WelcomeView's own load-up puts it: the centre of the safe
// area, at `WelcomeView.logoSize × WelcomeView.logoBigScale`.

struct IntroView: View {
    let onGetStarted: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dispersing = false
    @State private var shown = false

    private let paper = Color(hex: "#EDEAE3")
    private let brandBlue = Color(hex: "#4169E1")

    var body: some View {
        ZStack {
            paper.ignoresSafeArea()
            BrandWash(dispersing: dispersing).ignoresSafeArea()

            TRAQSHeaderLogo(size: WelcomeView.logoSize)
                .scaleEffect(WelcomeView.logoBigScale)
                .opacity(shown ? 1 : 0)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack {
                Spacer()
                Button(action: getStarted) {
                    Text("Get Started")
                        .font(TTypo.smBold(16))
                        .foregroundStyle(.white)
                        .frame(maxWidth: 320)
                        .padding(.vertical, 16)
                        .glassCTA(in: Capsule(style: .continuous), tint: brandBlue)
                }
                .buttonStyle(.plain)
                .disabled(dispersing)
                .padding(.horizontal, 28)
                .padding(.bottom, 36)
                .opacity(shown && !dispersing ? 1 : 0)
                .offset(y: shown ? 0 : 12)
            }
        }
        .preferredColorScheme(.light)
        .onAppear {
            withAnimation(.easeOut(duration: 0.85)) { shown = true }
        }
    }

    private func getStarted() {
        withAnimation(.easeOut(duration: 0.3)) { dispersing = true }
        // Hand over once the wash has cleared — the same 900ms the web spends,
        // so Welcome arrives on clean paper and never inherits a half-faded wash.
        DispatchQueue.main.asyncAfter(deadline: .now() + (reduceMotion ? 0.2 : BrandWash.disperseDuration)) {
            onGetStarted()
        }
    }
}

// MARK: - The brand wash
//
// A port of the web front door's wash (LIQUID_CSS in src/App.jsx), number for
// number: four blobs in the brand colours, each a soft radial, riding ONE shared
// circle a quarter turn apart so the colours sweep past each other, blurred 26pt,
// with the centre masked clear so nothing moves behind the logo.
//
// Positions are CSS background-position percentages: 0 = flush left/top, 1 =
// flush right/bottom, so a blob's origin is `(container − blob) × p`. On a tall
// phone that makes the circle read as a tall ellipse, which is what the web does
// on a wide screen the other way round — it follows the shape of the viewport.
struct BrandWash: View {
    var dispersing: Bool

    static let disperseDuration = 0.9
    /// One lap. Slow on purpose — the web's 54s.
    private static let period = 54.0

    /// Colour, peak alpha, diameter in vmax. BRAND_BARS (src/brand.jsx) with the
    /// web's alphas (d9, cc, e6, bf) and sizes (30/34/38/27vmax).
    private static let palette: [(hex: String, alpha: Double, vmax: Double)] = [
        ("#FF6B57", 0.85, 30),
        ("#F0A819", 0.80, 34),
        ("#38BDF8", 0.90, 38),
        ("#1D7D5C", 0.75, 27),
    ]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var epoch = Date()
    @State private var appeared = false
    /// The dispersal's three stops, driven in two legs below.
    @State private var puff = Puff.rest

    private struct Puff: Equatable {
        var scale: CGFloat
        var blur: CGFloat
        var opacity: Double
        static let rest = Puff(scale: 1, blur: 26, opacity: 1)
        static let billow = Puff(scale: 1.58, blur: 56, opacity: 0.66)
        static let gone = Puff(scale: 2.2, blur: 100, opacity: 0)
    }

    var body: some View {
        GeometryReader { g in
            // 30fps is plenty for a lap that takes most of a minute, and halves
            // the cost of re-blurring the layer every frame.
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { tl in
                let t = reduceMotion ? 0 : tl.date.timeIntervalSince(epoch)
                blobs(in: g.size, at: t)
            }
            .blur(radius: puff.blur)
            .mask(centreClear(in: g.size))
            .scaleEffect(puff.scale)
            .opacity(puff.opacity * (appeared ? 1 : 0))
        }
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.easeOut(duration: 0.9)) { appeared = true }
        }
        .onChange(of: dispersing) { _, now in
            guard now else { return }
            disperse()
        }
    }

    private func blobs(in size: CGSize, at t: TimeInterval) -> some View {
        let vmax = max(size.width, size.height) / 100
        let lap = 2 * Double.pi * t / Self.period
        return ZStack {
            ForEach(Self.palette.indices, id: \.self) { i in
                let b = Self.palette[i]
                let d = b.vmax * vmax
                // Blob i starts a quarter turn ahead of blob i-1.
                let a = lap + Double(i) * .pi / 2
                let px = 0.5 + 0.5 * cos(a)
                let py = 0.5 + 0.5 * sin(a)
                let color = Color(hex: b.hex)
                Circle()
                    .fill(RadialGradient(colors: [color.opacity(b.alpha), color.opacity(0)],
                                         center: .center, startRadius: 0, endRadius: d / 2))
                    .frame(width: d, height: d)
                    .position(x: (size.width - d) * px + d / 2,
                              y: (size.height - d) * py + d / 2)
            }
        }
        .frame(width: size.width, height: size.height)
    }

    /// CENTRE_CLEAR: an ellipse 40% × 44% of the screen at (50%, 48%), clear out
    /// to 58% of its radius and fully opaque by its edge. Built as a hole punched
    /// out of an opaque layer, because a gradient can only paint inside its own
    /// frame and everything outside the ellipse has to stay covered.
    private func centreClear(in size: CGSize) -> some View {
        ZStack {
            Rectangle().fill(.black)
            EllipticalGradient(stops: [.init(color: .black, location: 0),
                                       .init(color: .black, location: 0.58),
                                       .init(color: .clear, location: 1)],
                               center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
                .frame(width: size.width * 0.8, height: size.height * 0.88)
                .position(x: size.width * 0.5, y: size.height * 0.48)
                .blendMode(.destinationOut)
        }
        .compositingGroup()
    }

    /// DISPERSES LIKE SMOKE — tqLiquidOut. Expansion runs ahead of the thinning:
    /// most of the growth happens in the first 45% while the wash is still more
    /// than half there, so it billows outward and THEN thins, instead of just
    /// fading at its original size. The orbit keeps running underneath, so each
    /// blob blows apart from wherever it actually is.
    private func disperse() {
        guard !reduceMotion else {
            withAnimation(.easeOut(duration: 0.2)) { puff.opacity = 0 }
            return
        }
        let total = Self.disperseDuration
        withAnimation(.timingCurve(0.4, 0, 0.6, 1, duration: total * 0.45)) { puff = .billow }
        DispatchQueue.main.asyncAfter(deadline: .now() + total * 0.45) {
            withAnimation(.timingCurve(0.4, 0, 0.6, 1, duration: total * 0.55)) { puff = .gone }
        }
    }
}
