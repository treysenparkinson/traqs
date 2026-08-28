import SwiftUI
import CoreText   // the debug face check below

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

// MARK: The wordmark face
//
// Space Grotesk, which the web app's brand lockup is set in (App.jsx:50). ONLY
// the lockup uses it — everything else in the app is DM Sans.
//
// The PostScript name is why this is a named constant rather than a literal at
// the call site. Google Fonts publishes Space Grotesk only as a VARIABLE font,
// `SpaceGrotesk[wght].ttf`, whose default instance is Light — so its named
// instances register as:
//
//     SpaceGrotesk-Light           (wght 300, the default)
//     SpaceGrotesk-Light_Regular
//     SpaceGrotesk-Light_Medium
//     SpaceGrotesk-Light_Bold      <- the 700 the lockup wants
//
// enumerated with CTFontManagerCopyAvailablePostScriptNames against the actual
// file. So "SpaceGrotesk-Bold" does not exist, and asking for it would return
// the SYSTEM FACE in silence — exactly the failure the foundation pass spent a
// commit fixing for DM Sans. Hence it is in `assertFacesRegistered` below.
enum TWordmark {
    static let face = "SpaceGrotesk-Light_Bold"
}

// MARK: Type
//
// The web app styles type by NUMBER — `fontWeight: 700`, `fontSize: 13`. So does
// this API: callers pass the web's number and get the DM Sans face that number
// resolves to, via the shared `TFontName.face(forWebWeight:)`. That is what keeps
// "copy the number out of TRAQS.jsx" true for type the way it is for layout.
//
// It used to be `.custom("DMSans-Regular", size:).weight(weight)` — asking SwiftUI
// to synthesise a bold from the Regular face, against a bundle that shipped no DM
// Sans at all. Two bugs in one line: the family silently resolved to the system
// face, and the weight was faked. DM Sans ships real Medium, SemiBold, Bold and
// ExtraBold cuts, and a synthesised weight is a different shape — next to the web
// app in split mode the difference is plain.
enum TFont {
    /// `size` and `webWeight` are the web app's own numbers, copied.
    static func body(_ size: CGFloat, _ webWeight: Int = 400) -> Font {
        .custom(TFontName.face(forWebWeight: webWeight).rawValue, size: size)
    }

    /// Sidebar and control labels — 13pt on the web, 500 idle / 700 active.
    static func nav(_ active: Bool) -> Font {
        body(13, active ? 700 : 500)
    }

    #if DEBUG
    /// A missing font is SILENT: `Font.custom` with a name it cannot find returns
    /// the system face and reports nothing. That is exactly how this app came to
    /// look finished while rendering in the wrong typeface for its whole life, so
    /// the check is an assertion at launch rather than something to notice by eye.
    static func assertFacesRegistered() {
        // CoreText, not `NSFontManager.shared` — touching the shared font manager
        // this early spins up AppKit's font panel machinery and logs "A shared
        // NSFontManager instance already exists". CoreText just answers the
        // question, and PostScript names are exactly what `Font.custom` matches on.
        let names = CTFontManagerCopyAvailablePostScriptNames() as? [String] ?? []
        let available = Set(names)
        // The wordmark face too — it is the same class of silent failure, and its
        // PostScript name is the unobvious one.
        let wanted = TFontName.allCases.map(\.rawValue) + [TWordmark.face]
        let missing = wanted.filter { !available.contains($0) }
        assert(missing.isEmpty, """
            Bundled faces are not registered: \(missing.joined(separator: ", ")).
            Check that Info.plist carries ATSApplicationFontsPath = "." and that the \
            Fonts directory is in the target's fileSystemSynchronizedGroups. Note \
            ATSApplicationFontsPath CANNOT be set via INFOPLIST_KEY_* — Xcode does \
            not map that key — which is why this target has a real Info.plist.
            """)
    }
    #endif
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

// MARK: - Glass, on the app's buttons
//
// THE RULE, stated once so it is not re-decided per button: every control in the
// app is Liquid Glass, EXCEPT
//
//   • sidebar nav rows — they are a straight copy of the web's rail, and the web's
//     own note is that the active row is a flat accent fill with "no separate
//     sliding indicator" (see `navRow`);
//   • rows in a list or grid — a lit bevel per row reads as noise rather than as
//     material, which is the same reason `frostedCard(rim:)` exists on iOS;
//   • the sidebar's log-out button — one of the elements the web already opts out
//     of its own button chrome, and glass would pull the eye to the most
//     destructive control in the rail.
//
// Everything else — brand strip chrome, page-header actions, CTAs, toggles, the
// kiosk keypad — takes glass.
extension View {
    /// Liquid Glass for a shell control.
    ///
    /// CLEAR BY DEFAULT. A tint is only correct where the web actually colours
    /// the button — its gradient CTAs, the red destructive actions, the kiosk's
    /// green/red clock pair, an active toggle segment. Most controls are
    /// `background: "transparent"` there, and tinting those makes the chrome
    /// louder than the original.
    ///
    /// `enabled: false` drops the glass entirely rather than dimming it: dim
    /// glass still reads as pressable, no material reads as off.
    func shellGlass<S: InsettableShape>(tint: Color? = nil, enabled: Bool = true,
                                        in shape: S) -> some View {
        modifier(ShellGlass(tint: tint, enabled: enabled, shape: shape))
    }
    /// Convenience for the common pill.
    func shellGlass(tint: Color? = nil, enabled: Bool = true) -> some View {
        shellGlass(tint: tint, enabled: enabled, in: Capsule())
    }
}

struct ShellGlass<S: InsettableShape>: ViewModifier {
    let tint: Color?
    let enabled: Bool
    let shape: S

    func body(content: Content) -> some View {
        if !enabled {
            content
        } else if let tint {
            content.glassEffect(.regular.tint(tint).interactive(), in: shape)
        } else {
            // `.clear`, not `.regular` untinted — clear is the variant with no
            // fill of its own, which is what a transparent web button should be.
            content.glassEffect(.clear.interactive(), in: shape)
        }
    }
}
