import SwiftUI

// MARK: - TRAQS Loading Overlay
// Full-screen, TRAQS-styled blocking loading indicator. Shown during an async
// action that would otherwise leave the screen looking frozen (clock in/out).
// Driven by a non-nil message; the call site animates it in/out.
struct TRAQSLoadingOverlay: View {
    let message: String
    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView()
                    .controlSize(.large)
                    .tint(Color(hex: T.sky))
                Text(message)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: T.ink))
            }
            .padding(.vertical, 30)
            .padding(.horizontal, 44)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color(hex: T.surface)))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
            .shadow(color: .black.opacity(0.28), radius: 26, y: 12)
        }
        // Swallow taps so the underlying screen can't be poked mid-action.
        .contentShape(Rectangle())
        .onTapGesture { }
    }
}

// MARK: - TRAQS Wordmark (image asset)
// Uses the official brand wordmark PNG from Assets.xcassets. `size` is the
// rendered HEIGHT in points; aspect ratio is preserved.
// Light theme → "TRAQSLogoBlack" (dark ink wordmark for light surfaces).
// Dark theme  → "TRAQSLogoWhite" (paper wordmark for dark surfaces).

struct TRAQSWordmark: View {
    @Environment(ThemeSettings.self) private var themeSettings
    var size: CGFloat = 44

    var body: some View {
        Image(themeSettings.isLightTheme ? "TRAQSLogoBlack" : "TRAQSLogoWhite")
            .resizable()
            // .interpolation(.high) tells SwiftUI to use high-quality
            // sampling when scaling the 3840-wide source down to display
            // size, and .antialiased smooths the resulting glyph edges so
            // the wordmark doesn't look pixelated in the nav header.
            .interpolation(.high)
            .antialiased(true)
            .scaledToFit()
            .frame(height: size)
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
        HStack(spacing: 0) {
            TRAQSWordmark(size: size)
            // The bars mark as a trailing "=" — scaled from the tuned size-64
            // lockup: bars 21/64, pulled left 13/64 to clear the wordmark PNG's
            // built-in right padding, nudged up 1/64 to sit level with the letters.
            TRAQSBarsMark(size: size * (21.0 / 64.0))
                .offset(x: -size * (13.0 / 64.0), y: -size * (1.0 / 64.0))
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

    var body: some View {
        // Logo on the left, trailing controls on the right. Extra top padding
        // drops the whole header (and page title) down from the status bar for
        // more breathing room.
        HStack(alignment: .center, spacing: 10) {
            TRAQSHeaderLogo(size: 60)
                .offset(x: -13)   // nudge the lockup toward the leading edge
            Spacer()
            HStack(spacing: 6) {
                trailing()
            }
        }
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
