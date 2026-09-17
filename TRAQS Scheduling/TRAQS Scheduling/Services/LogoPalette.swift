import Foundation

// MARK: - The app icon's palette
//
// Sampled from the centre pixel of each bar in the shipped asset
// (`AppIcon.icon/Assets/traqs-bars-candy-v2.png`, sRGB), which landed in
// commit 241d2f7. The icon and the app are meant to be the same four colours;
// this is where that is written down once so the two cannot drift.
//
// Hex rather than Color, Foundation rather than SwiftUI, for the reason
// JobPalette gives: this has to compile wherever the test target does.

enum LogoPalette {

    static let coral = "#FF826A"   // bar 1 — top
    static let amber = "#F4B61E"   // bar 2
    static let sky   = "#41C9FA"   // bar 3 — full width, the hero
    static let green = "#1E8D6F"   // bar 4 — bottom, shortest

    /// Top → bottom, exactly as the icon draws them. `TRAQSBarsMark` indexes
    /// this positionally, so the order is the logo's geometry rather than a
    /// convenience — reordering it redraws the mark.
    static let ordered = [coral, amber, sky, green]

    // MARK: - What the bars mark draws

    /// The four bar colours for a given accent, top → bottom.
    ///
    /// On the SHIPPED accent the mark is the icon: the four bars are the four
    /// bars, so the logo in the header and the logo on the springboard are the
    /// same object.
    ///
    /// On any other accent that would be a lie — a mark in four unrelated hues
    /// sitting in an app the user has deliberately turned purple. So the mark
    /// becomes four shades of whatever they chose: same hue, same saturation,
    /// four lightnesses. It still reads as four distinct bars, and it still
    /// belongs to the theme around it.
    static func bars(for accent: String) -> [String] {
        isDefaultAccent(accent) ? ordered : shades(of: accent)
    }

    /// Case- and format-insensitive, because a hex arrives from three places
    /// that do not agree: our own literals, `Color.hexString` (which emits
    /// lowercase), and whatever a user's saved `themeAccent` was written as.
    /// Comparing raw strings would silently miss `#41c9fa`.
    static func isDefaultAccent(_ hex: String) -> Bool {
        norm(hex) == norm(sky)
    }

    private static func norm(_ hex: String) -> String {
        hex.trimmingCharacters(in: .whitespaces)
           .replacingOccurrences(of: "#", with: "")
           .uppercased()
    }

    /// Four shades of one colour, top → bottom.
    ///
    /// The chosen colour lands on the THIRD bar untouched — that is the
    /// full-width one, the mark's hero, so the accent itself is what the eye
    /// goes to. The other three step away from it in lightness only.
    ///
    /// Offsets are clamped into a band rather than applied blind: a very light
    /// accent (amber) would blow its lighter bars out to white, and a very dark
    /// one would crush the bottom bar to black. Both ends stay visible against
    /// the light AND dark background presets.
    static func shades(of hex: String) -> [String] {
        let (h, s, l) = hsl(hex)
        let offsets: [Double] = [0.17, 0.09, 0.0, -0.13]   // top → bottom
        return offsets.map { off in
            off == 0 ? hex
                     : JobColors.hex(hue: h,
                                     saturation: s,
                                     lightness: min(0.82, max(0.22, l + off)))
        }
    }

    /// `#rrggbb` → HSL. The inverse of `JobColors.hex(hue:saturation:lightness:)`,
    /// which is why it lives here in Services rather than reaching up to
    /// `LiquidColor` in the Views layer for the same arithmetic.
    private static func hsl(_ hex: String) -> (h: Double, s: Double, l: Double) {
        var v = UInt64()
        Scanner(string: norm(hex)).scanHexInt64(&v)
        let r = Double((v >> 16) & 0xFF) / 255
        let g = Double((v >> 8) & 0xFF) / 255
        let b = Double(v & 0xFF) / 255

        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2
        guard mx != mn else { return (0, 0, l) }

        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        var h: Double
        switch mx {
        case r:  h = (g - b) / d + (g < b ? 6 : 0)
        case g:  h = (b - r) / d + 2
        default: h = (r - g) / d + 4
        }
        return (h * 60, s, l)
    }
}
