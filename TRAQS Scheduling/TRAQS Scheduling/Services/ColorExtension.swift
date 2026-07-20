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
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
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
}
