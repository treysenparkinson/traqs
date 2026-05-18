import SwiftUI

// MARK: - TRAQS Typography
// DM Sans across the entire app — five static weights bundled in /Fonts.
// All numerics use tabular figures (the `mono` helpers do this explicitly;
// the heading helpers inherit the same monospaced-digit treatment so totals
// and durations always column-align in cards and lists).

enum TFontName: String {
    case regular   = "DMSans-Regular"
    case medium    = "DMSans-Medium"
    case semibold  = "DMSans-SemiBold"
    case bold      = "DMSans-Bold"
    case extrabold = "DMSans-ExtraBold"
}

enum TTypo {
    /// Brand wordmark — "traqs" 28pt ExtraBold, -0.04em letter-spacing.
    static func wordmark(_ size: CGFloat = 28) -> Font {
        Font.custom(TFontName.extrabold.rawValue, size: size, relativeTo: .largeTitle)
    }

    /// h1 (currently unused — header is replaced by the wordmark)
    static func h1(_ size: CGFloat = 32) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .title)
    }

    /// h2 — hero numbers in cards
    static func h2(_ size: CGFloat = 26) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .title2)
    }

    /// h3 — section titles, card titles
    static func h3(_ size: CGFloat = 22) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .title3)
    }

    /// Body 15pt / 500
    static func body(_ size: CGFloat = 15) -> Font {
        Font.custom(TFontName.medium.rawValue, size: size, relativeTo: .body)
    }

    /// Body bold — for emphasized inline content
    static func bodyBold(_ size: CGFloat = 15) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .body)
    }

    /// Secondary text — 14pt / 500
    static func sm(_ size: CGFloat = 14) -> Font {
        Font.custom(TFontName.medium.rawValue, size: size, relativeTo: .callout)
    }

    /// Secondary bold — 14pt / 700
    static func smBold(_ size: CGFloat = 14) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .callout)
    }

    /// Caption / chip / label — 12pt / 600 (often UPPERCASE + 0.12em tracking)
    static func xs(_ size: CGFloat = 12) -> Font {
        Font.custom(TFontName.semibold.rawValue, size: size, relativeTo: .caption)
    }

    /// Caption bold — 12pt / 700
    static func xsBold(_ size: CGFloat = 12) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .caption)
    }

    /// Tiny — 10pt / 700 (tab labels, badges)
    static func xxs(_ size: CGFloat = 10) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .caption2)
    }

    /// "Mono" — DM Sans Medium with tabular figures, used wherever the desktop product
    /// used JetBrains Mono (timestamps, durations, percentages). We keep ONE typeface
    /// and rely on tabular-nums to keep digit columns aligned.
    static func mono(_ size: CGFloat = 12) -> Font {
        Font.custom(TFontName.medium.rawValue, size: size, relativeTo: .caption)
    }

    /// Mono bold — for tabular numbers that should stand out (hero totals, percentages).
    static func monoBold(_ size: CGFloat = 12) -> Font {
        Font.custom(TFontName.bold.rawValue, size: size, relativeTo: .caption)
    }
}

// MARK: - Convenience Text wrappers

extension View {
    /// Apply tabular-figure number rendering so digits column-align in lists/grids.
    /// Pair with `TTypo.mono*` for timestamps / durations / counts.
    func tnum() -> some View {
        self.monospacedDigit()
    }

    /// Uppercase + tracked label treatment (chips, section headers, "TRACKING", etc.).
    func tLabel(tracking: CGFloat = 1.4) -> some View {
        self.kerning(tracking).textCase(.uppercase)
    }
}
