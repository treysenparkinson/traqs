import SwiftUI

// MARK: - The web app's theme, ported verbatim
//
// These are the EXACT token values from `THEMES` in TRAQS.jsx. The Mac app is a
// visual copy of the web app, so its colours cannot be "close" — a hand-picked
// Mac palette is how the two drift apart on the first screen.
//
// Ported as-is, including the pieces that look odd out of context (obsidian's
// text, textSec and textDim are all the same colour on the web too). Anything
// that looks like a bug here should be fixed in TRAQS.jsx first, then copied.

struct TTheme: Equatable {
    let name: String
    let bg, surface, card, border, borderLight: Color
    let text, textSec, textDim: Color
    let accent, accentText, danger: Color
    let hover, hoverStrong: Color
    let isDark: Bool

    /// Corner radii — one scale, shared by every surface in the app.
    static let radius: CGFloat = 22
    static let radiusSm: CGFloat = 16
    static let radiusXs: CGFloat = 11
    static let radiusLg: CGFloat = 26
    static let radiusHero: CGFloat = 34

    static let midnight = TTheme(
        name: "Dark",
        bg: .hex("#17171A"), surface: .hex("#202024"), card: .hex("#27272C"),
        border: .hex("#3A3A42"), borderLight: .hex("#4A4A54"),
        text: .hex("#F4F4F5"), textSec: .hex("#B4B4BC"), textDim: .hex("#8A8A93"),
        accent: .hex("#3d7fff"), accentText: .hex("#ffffff"), danger: .hex("#f43f5e"),
        hover: .hex("#3d7fff").opacity(0.20), hoverStrong: .hex("#3d7fff").opacity(0.34),
        isDark: true)

    static let obsidian = TTheme(
        name: "Obsidian",
        bg: .hex("#07070e"), surface: .hex("#0d0d1a"), card: .hex("#111120"),
        border: .hex("#1c1c34"), borderLight: .hex("#252548"),
        text: .hex("#eeeef8"), textSec: .hex("#eeeef8"), textDim: .hex("#eeeef8"),
        accent: .hex("#7c3aed"), accentText: .hex("#ffffff"), danger: .hex("#f43f5e"),
        hover: .hex("#7c3aed").opacity(0.20), hoverStrong: .hex("#7c3aed").opacity(0.34),
        isDark: true)

    static let frost = TTheme(
        name: "White",
        bg: .hex("#EDEAE3"), surface: .hex("#FBFAF7"), card: .hex("#FFFFFF"),
        border: .hex("#E2DED5"), borderLight: .hex("#D8D3C8"),
        text: .hex("#0B0B0C"), textSec: .hex("#8A867E"), textDim: .hex("#B4B0A7"),
        accent: .hex("#38BDF8"), accentText: .hex("#ffffff"), danger: .hex("#ef4444"),
        hover: .hex("#38BDF8").opacity(0.14), hoverStrong: .hex("#38BDF8").opacity(0.24),
        isDark: false)

    static let all: [TTheme] = [.midnight, .obsidian, .frost]
}

// MARK: Type
//
// The web app sets `font: 'DM Sans'`. The iOS app ships DM Sans in its bundle;
// this one falls back to the system face until the same files are added here, so
// weights and sizes stay right even before the font lands.
enum TFont {
    static func body(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("DMSans-Regular", size: size).weight(weight)
    }
    /// Sidebar and control labels — 13pt on the web.
    static func nav(_ active: Bool) -> Font {
        .custom("DMSans-Regular", size: 13).weight(active ? .bold : .medium)
    }
}

extension Color {
    /// `#RRGGBB` / `#RRGGBBAA`, matching the hex strings the web theme uses.
    static func hex(_ s: String) -> Color {
        var h = s.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        let r, g, b, a: Double
        switch h.count {
        case 8:
            r = Double((v >> 24) & 0xFF) / 255; g = Double((v >> 16) & 0xFF) / 255
            b = Double((v >> 8) & 0xFF) / 255;  a = Double(v & 0xFF) / 255
        default:
            r = Double((v >> 16) & 0xFF) / 255; g = Double((v >> 8) & 0xFF) / 255
            b = Double(v & 0xFF) / 255;         a = 1
        }
        return Color(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}
