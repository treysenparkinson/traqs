import SwiftUI

// MARK: - TRAQS Loading Overlay
// Full-screen, TRAQS-styled blocking loading indicator. Shown during an async
// action that would otherwise leave the screen looking frozen (clock in/out).
// Driven by a non-nil message; the call site animates it in/out.
struct TRAQSLoadingOverlay: View {
    let message: String
    /// The action landed. Swaps the spinner for the checkmark — see
    /// `ClockProgressMark`. The caller holds this for a beat before clearing the
    /// overlay, so the confirmation is actually seen.
    var done: Bool = false
    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
            VStack(spacing: 16) {
                ClockProgressMark(done: done)
                Text(message)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
                    .contentTransition(.opacity)
            }
            .padding(.vertical, 30)
            .padding(.horizontal, 44)
            .glassSurface(in: RoundedRectangle(cornerRadius: T.cornerLg, style: .continuous), rim: true)
            .shadow(color: .black.opacity(0.28), radius: 26, y: 12)
        }
        // Swallow taps so the underlying screen can't be poked mid-action.
        .contentShape(Rectangle())
        .onTapGesture { }
    }
}

// MARK: - Clock progress mark
//
// A spinner while the request is out, then a checkmark that draws itself on.
// ONE view, shared by the PIN pad and the full-screen loading overlay, so the
// two endings of a clock in/out can't drift into different confirmations.

struct ClockProgressMark: View {
    let done: Bool
    var size: CGFloat = 64

    /// How much of the tick is drawn — animated from 0 so the stroke travels
    /// rather than appearing whole.
    @State private var trim: CGFloat = 0
    /// The disc's settle. Starts under 1 so the mark lands with a little weight.
    @State private var pop: CGFloat = 0.7
    /// The sweep's rotation, driven forever while the request is out.
    @State private var spin: Double = 0

    /// Ring weight. Proportional to `size` so the mark scales as one object.
    private var stroke: CGFloat { size * 0.085 }

    var body: some View {
        ZStack {
            if done {
                Circle()
                    .fill(Color(hex: T.statusFinished).opacity(0.16))
                    .scaleEffect(pop)
                CheckmarkPath()
                    .trim(from: 0, to: trim)
                    .stroke(Color(hex: T.statusFinished),
                            style: StrokeStyle(lineWidth: stroke,
                                               lineCap: .round, lineJoin: .round))
                    .padding(size * 0.3)
                    .scaleEffect(pop)
            } else {
                // A brand-coloured sweep on its own faint track, NOT the stock
                // `ProgressView`. The system spinner is a grey pinwheel that
                // belongs to no part of this app — next to a glass panel and a
                // gradient CTA it read as a placeholder. The track keeps the
                // circle whole so the sweep travels around something.
                Circle()
                    .stroke(Color(hex: T.accentGradientStart).opacity(0.13),
                            lineWidth: stroke)
                    .padding(stroke / 2)
                Circle()
                    .trim(from: 0, to: 0.3)
                    .stroke(
                        AngularGradient(
                            colors: [Color(hex: T.accentGradientEnd),
                                     Color(hex: T.accentGradientStart)],
                            center: .center),
                        style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                    .padding(stroke / 2)
                    // Starts at 12 o'clock rather than 3, so the head leads from
                    // the top on the first frame.
                    .rotationEffect(.degrees(-90 + spin))
            }
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.linear(duration: 0.85).repeatForever(autoreverses: false)) {
                spin = 360
            }
        }
        .onChange(of: done, initial: true) { _, landed in
            guard landed else { return }
            trim = 0
            pop = 0.7
            withAnimation(.spring(response: 0.34, dampingFraction: 0.6)) { pop = 1 }
            // Slightly behind the disc, so the tick draws INTO a circle that is
            // already there rather than racing it.
            withAnimation(.easeOut(duration: 0.28).delay(0.06)) { trim = 1 }
        }
        .sensoryFeedback(.success, trigger: done)
    }
}

/// The tick, as a path so it can be trimmed and drawn on.
struct CheckmarkPath: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.36, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        return p
    }
}

// MARK: - TRAQS Wordmark (image asset)
// Uses the official brand wordmark PNG from Assets.xcassets. `size` is the
// rendered HEIGHT in points; aspect ratio is preserved.
// Light theme → "TRAQSLogoBlack" (dark ink wordmark for light surfaces).
// Dark theme  → "TRAQSLogoWhite" (paper wordmark for dark surfaces).

struct TRAQSWordmark: View {
    @Environment(ThemeSettings.self) private var themeSettings

    /// Aspect of the source art (traqs-wordmark-bold-ink-2348x1200).
    ///
    /// The frame below is deliberately DEFINITE in both axes. Constraining only
    /// the height leaves a `.resizable()` image with no minimum intrinsic width,
    /// so it is the first thing a tight HStack compresses — and because
    /// `scaledToFit` preserves the ratio, losing width also loses HEIGHT. That is
    /// how adding one wider control to the Jobs header silently shrank the logo on
    /// every page: the wordmark, not the row, absorbed the overflow. With a
    /// definite frame it holds its size and the layout has to give elsewhere.
    static let aspect: CGFloat = 2348.0 / 1200.0

    var size: CGFloat = 44
    /// Overrides the theme-driven variant for callers whose backdrop ISN'T the
    /// page colour. `true` → the black mark (light backdrop), `false` → white.
    /// The splash uses this: it sits on the accent-coloured liquid wash, not on
    /// the theme background, so `isLightTheme` is the wrong question there.
    var onLightBackground: Bool? = nil

    var body: some View {
        Image((onLightBackground ?? themeSettings.isLightTheme) ? "TRAQSLogoBlack" : "TRAQSLogoWhite")
            .resizable()
            // .interpolation(.high) tells SwiftUI to use high-quality
            // sampling when scaling the 3840-wide source down to display
            // size, and .antialiased smooths the resulting glyph edges so
            // the wordmark doesn't look pixelated in the nav header.
            .interpolation(.high)
            .antialiased(true)
            .scaledToFit()
            // Rounded to whole points: a fractional width puts the bars mark
            // beside it — and every trailing control after it — on subpixel
            // coordinates, which is visible as the header twitching a point as
            // views come and go.
            .frame(width: (size * Self.aspect).rounded(), height: size)
    }
}

// Back-compat: a few places still call TRAQSNavLogo() — keep as the image wordmark.
struct TRAQSNavLogo: View {
    var body: some View { TRAQSWordmark(size: 44) }
}

// MARK: - TRAQS Bars Mark (native, theme-tracking)
// The TRAQS "bars" lockup, drawn in SwiftUI instead of the fixed-color raster
// (`Image("TRAQSIconBars")`) so it follows the system theme: the accent bar
// tracks the user's chosen accent, and the three grey bars use the theme's
// muted ink so they stay legible on light AND dark backgrounds. `size` is the
// rendered HEIGHT in points; width is derived from the original 184×150 art.
struct TRAQSBarsMark: View {
    @Environment(ThemeSettings.self) private var themeSettings
    var size: CGFloat = 22

    // Bar widths as a fraction of the mark's full width, top → bottom, measured
    // from the original artwork. The 3rd (full-width) bar is the accent bar.
    private let widths: [CGFloat] = [0.554, 0.788, 1.0, 0.451]
    private let accentIndex = 2

    var body: some View {
        // Read themeSettings.accent / .bgPresetId so the mark re-renders live
        // when the customizer changes the accent or the light/dark background.
        let accentColor = Color(hex: themeSettings.accent)
        let _ = themeSettings.bgPresetId
        let greyColor = Color(hex: T.muted)

        let aspect: CGFloat = 184.0 / 150.0
        let fullWidth = size * aspect
        let barH = size * (27.0 / 150.0)
        let gap  = size * (14.0 / 150.0)

        VStack(alignment: .leading, spacing: gap) {
            ForEach(widths.indices, id: \.self) { i in
                RoundedRectangle(cornerRadius: barH * 0.32, style: .continuous)
                    .fill(i == accentIndex ? accentColor : greyColor)
                    .frame(width: fullWidth * widths[i], height: barH)
            }
        }
        .frame(width: fullWidth, height: size, alignment: .leading)
    }
}

// MARK: - TRAQS Header Logo (the "traqs=" lockup)
// The brand wordmark with the four-bar accent mark riding right after it like a
// trailing "=" — the same lockup the old side drawer used, now the fixed
// leading element of every page's header. Parametric so the hand-tuned bar
// alignment (offsets measured at wordmark height 64) scales cleanly to any
// header size.
struct TRAQSHeaderLogo: View {
    /// Rendered HEIGHT of the wordmark in points.
    var size: CGFloat = 44

    var body: some View {
        // The bars mark as a trailing "=" — scaled from the tuned size-64 lockup:
        // bars 21/64, pulled left 15/64 to clear the wordmark PNG's built-in right
        // padding, nudged up 1/64 to sit level with the letters.
        //
        // The pull stays a FRACTION of size rather than a flat point value so the
        // lockup holds together at every size it's rendered at (60 in the nav
        // header, 44 via TRAQSNavLogo).
        //
        // The pull is NEGATIVE SPACING, not an x-offset. An offset is visual only,
        // so the lockup used to claim ~14pt of layout width at its right edge that
        // it never drew into — phantom width taken straight out of the header's
        // budget for its trailing controls, and a big part of why one wider control
        // there was enough to start squeezing the logo. Now the lockup measures
        // exactly as wide as it looks.
        HStack(spacing: -size * (15.0 / 64.0)) {
            TRAQSWordmark(size: size)
            TRAQSBarsMark(size: size * (21.0 / 64.0))
                .offset(y: -size * (1.0 / 64.0))
        }
    }
}

// MARK: - Screen Header
// Logo lockup on the left (every page), trailing controls on the right.
// No center title — the tab bar tells the user where they are.

struct TRAQSNavHeader<Trailing: View>: View {
    /// Back-compat only: the logo now rides in the header on every page, so this
    /// flag is ignored. Kept so existing call sites keep compiling.
    var showLogo: Bool = false
    @ViewBuilder var trailing: () -> Trailing

    /// Rendered height of the logo lockup, and therefore of the header row.
    /// A computed property, not a stored one — TRAQSNavHeader is generic over its
    /// trailing content, and generic types can't hold static stored properties.
    private static var logoHeight: CGFloat { 60 }

    var body: some View {
        // Logo on the left, trailing controls on the right. Extra top padding
        // drops the whole header (and page title) down from the status bar for
        // more breathing room.
        HStack(alignment: .center, spacing: 10) {
            TRAQSHeaderLogo(size: Self.logoHeight)
                .offset(x: -13)   // nudge the lockup toward the leading edge
            Spacer()
            HStack(spacing: 6) {
                trailing()
            }
        }
        // PINNED height. Every trailing control is ≤38pt so the 60pt logo already
        // decided this row's height — but pinning it means it STAYS decided: a
        // control appearing as data loads (the approvals button, the admin
        // availability button), a badge, or anything added later can no longer
        // change the header's height and shift the page title under it by a point.
        .frame(height: Self.logoHeight)
        .padding(.horizontal, 16)
        .padding(.top, 22)
        .padding(.bottom, 12)
    }
}

extension TRAQSNavHeader where Trailing == EmptyView {
    init() { self.trailing = { EmptyView() } }
    /// Back-compat: older call sites used a centered tab name. Per the wireframes
    /// there's no centered title now — the tab bar tells the user where they are.
    /// We accept and ignore the argument so the build keeps moving while screens
    /// are rewritten.
    init(tabName _: String) { self.trailing = { EmptyView() } }
}

// MARK: - FastTRAQSPillButton — kept for back-compat
struct FastTRAQSPillButton: View {
    var body: some View {
        TIconView(icon: .sparkle, size: 15, color: Color(hex: T.sky))
            .padding(8)
            .background(Circle().fill(Color(hex: T.sky).opacity(0.12)))
            .overlay(Circle().stroke(Color(hex: T.sky).opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Legacy view-modifiers (kept compiling for older call sites — the new design
// uses SBox / PillBtn / IconBtn directly).

extension View {
    func traqsCard(radius: CGFloat = T.cornerMd) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color(hex: T.surface)))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
            .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                    radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
    }

    func traqsToolbar(radius: CGFloat = T.cornerLg) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color(hex: T.surface)))
            .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                    radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
    }

    func traqsField(radius: CGFloat = T.cornerMd) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color(hex: T.surface)))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
    }

    /// Soft top edge for a page's ScrollView — content fades into the header
    /// instead of cutting off on a hard line. Used app-wide for a consistent
    /// fading header. Pages give their title ~`pageTitleTopInset` of top padding
    /// so it stays crisp at rest (the fade band is the top ~4.5% of the scroll).
    func topFadeMask() -> some View {
        // No-op. Every fade we tried fought the gradient background: a
        // full-height `.mask` left a hard bottom edge ("footer"), and a flat
        // top overlay left a hard top line (a flat color can't match the
        // gradient). The page title now scrolls inside the content, so there's
        // no sticky-header seam to hide at rest — so we don't fade at all.
        // Kept as a no-op so the call sites don't need to churn.
        self
    }
}

/// Small top breathing room above each page's title, just below the header
/// (no more fade band to clear, so this is tight on purpose).
let pageTitleTopInset: CGFloat = 6
