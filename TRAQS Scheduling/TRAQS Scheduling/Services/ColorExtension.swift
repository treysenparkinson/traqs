import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

extension Color {
    /// Convert a SwiftUI Color to a CSS hex string (e.g. "#3D7FFF").
    func toHex() -> String? {
        #if canImport(UIKit)
        var r: CGFloat = 0; var g: CGFloat = 0; var b: CGFloat = 0; var a: CGFloat = 0
        guard UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a) else { return nil }
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
        #else
        return nil
        #endif
    }

    /// Perceived brightness on the YIQ scale (0…255). Weights green heaviest,
    /// blue lightest, matching how the eye reads luminance. Used to decide
    /// whether black or white text reads on this color as a background.
    /// iOS-only (UIColor); returns a mid value (128) if conversion fails so
    /// callers still get a sane black/white pick.
    var perceivedBrightness: Double {
        #if canImport(UIKit)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a) else { return 128 }
        return (Double(r) * 299 + Double(g) * 587 + Double(b) * 114) / 1000 * 255
        #else
        return 128
        #endif
    }

    /// Black or white — whichever reads legibly on THIS color used as a
    /// background. Threshold 140 (YIQ) keeps white on the default sky accent
    /// and the brand blues, but flips to black on light accents (amber, etc.)
    /// and on light surfaces. This is the single knob for the app-wide
    /// "dark bg → white text, light bg → black text" rule.
    var readableText: Color {
        perceivedBrightness > 140 ? .black : .white
    }

    /// Lighten (positive `amount`) or darken (negative) this color by blending
    /// toward white or black by `amount` (0…1). iOS-only precise path; returns
    /// self unchanged if color conversion fails.
    func adjustBrightness(by amount: Double) -> Color {
        #if canImport(UIKit)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a) else { return self }
        let t = CGFloat(amount)
        if t >= 0 {
            r += (1 - r) * t; g += (1 - g) * t; b += (1 - b) * t
        } else {
            let k = max(0, 1 + t)   // t negative → scale toward black
            r *= k; g *= k; b *= k
        }
        return Color(.sRGB, red: Double(r), green: Double(g), blue: Double(b), opacity: Double(a))
        #else
        return self
        #endif
    }

    /// A subtle vertical gradient of THIS color — lightened at the top, darkened
    /// at the bottom — so a fixed-color button can render as a gradient CTA of
    /// the same hue.
    func verticalGradient(lighten: Double = 0.16, darken: Double = 0.20) -> LinearGradient {
        LinearGradient(colors: [adjustBrightness(by: lighten),
                                adjustBrightness(by: -darken)],
                       startPoint: .top, endPoint: .bottom)
    }

    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            // Web/CSS 8-digit hex is #RRGGBBAA (alpha LAST), not #AARRGGBB.
            (r, g, b, a) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }

    /// Shared default avatar fill — matches PERSON_BLUE on the web so a person
    /// without a photo looks the same on both platforms.
    static let personBlue = Color(hex: "#4169e1")

    /// Fill for a person's avatar: the colour they picked, or `personBlue` when
    /// they never picked one. Needed because `Color(hex:)` falls through to
    /// opaque BLACK on an empty/invalid string, so every person without a
    /// colour — most of the roster — rendered a black circle.
    static func personFill(_ hex: String?) -> Color {
        let h = (hex ?? "").trimmingCharacters(in: .whitespaces)
        return h.isEmpty ? personBlue : Color(hex: h)
    }
}
