import SwiftUI

// MARK: - Revamp kit (iOS Wireframes v2)
//
// The pieces every redesigned page is built from, so the five screens share one
// set of measurements rather than five close copies:
//
//   RvTitle      34pt title, tight tracking, an optional muted meta on the right
//   RvSection    uppercase eyebrow + optional accent action, over a hairline
//   RvRow        a cardless list row: hairline under it, 14pt vertical padding
//   RvDot        the 8pt colour dot that leads a row
//   RvTile       a pastel status tile: eyebrow, big number, sub line
//   RvTabs       underline tabs — the page's own range/filter switch
//   RvBars       white bars on the canvas, the highlighted one in accent
//   RvTrack      a 6pt white progress track
//
// Pages sit on the flat canvas (`PageBackground`) with 24pt side margins
// (`Rv.side`). Colour comes from the theme tokens, so Light/Dark and the accent
// still apply; the pastel tiles have a dark-theme pair of their own.
//
// Header buttons, the nav pill and every glass CTA are NOT here — they stay the
// native Liquid Glass controls they were.

enum Rv {
    /// Page side margin.
    static let side: CGFloat = 24
    /// Page title size — the design's 34, taken up a step by request. Shared with
    /// the gantt's Jobs title so both Jobs views match every other page.
    static let titleSize: CGFloat = 38
    /// The hairline: ink at 9%, so it reads on light and dark alike.
    static var line: Color { Color(hex: T.ink).opacity(0.09) }

    /// The five tile fills — SHADES OF THE ACCENT, so the tiles follow whatever
    /// colour the user picks rather than the design's fixed lavender/mint/peach/
    /// sky/butter. The case names are kept as slot names; each is the accent mixed
    /// into a ground at its own strength. On light the ground is white (pastels);
    /// on dark it is the surface, so the tiles sink into the canvas as tints.
    ///
    /// Strengths are spread so tiles that sit side by side read as different
    /// shades: Home pairs lavender/mint, Analytics sky/lavender over peach/butter.
    /// The box colours: blue, green, red, yellow — and nothing else. Lavender
    /// (purple) was removed 2026-10-13 so no box can pick it up again.
    enum Tint: CaseIterable {
        case mint, peach, sky, butter

        private var strength: Double {
            switch self {
            case .sky:      return 0.10
            case .mint:     return 0.12
            case .peach:    return 0.25
            case .butter:   return 0.32
            }
        }

        var fill: Color {
            let dark = T.isDarkTheme
            // On the SHIPPED accent the tiles keep the design's own multi-colour
            // pastels; any other accent turns them into shades of that colour.
            if LogoPalette.isDefaultAccent(T.accent) {
                return Color(hex: dark ? designDark : designLight)
            }
            // A dark ground takes more accent to show the same step.
            return Rv.mix(T.accent, into: dark ? T.surface : "#FFFFFF",
                          dark ? strength * 1.25 : strength)
        }

        /// The Wireframes v2 pastels, with a dark-theme pair each.
        private var designLight: String {
            switch self {
            case .mint:     return "#DFF5EC"
            case .peach:    return "#FDE8E3"
            case .sky:      return "#E0F3FC"
            case .butter:   return "#FDF1D6"
            }
        }
        private var designDark: String {
            switch self {
            case .mint:     return "#1E3A30"
            case .peach:    return "#43292A"
            case .sky:      return "#1D3746"
            case .butter:   return "#40361F"
            }
        }
    }

    /// `t` of `hex` laid over `ground`, both "#RRGGBB".
    static func mix(_ hex: String, into ground: String, _ t: Double) -> Color {
        func rgb(_ h: String) -> (Double, Double, Double) {
            let s = h.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
            guard s.count >= 6, let v = UInt32(s.prefix(6), radix: 16) else { return (0.5, 0.5, 0.5) }
            return (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
        }
        let a = rgb(hex), g = rgb(ground), k = min(1, max(0, t))
        return Color(red: g.0 + (a.0 - g.0) * k, green: g.1 + (a.1 - g.1) * k, blue: g.2 + (a.2 - g.2) * k)
    }
}

// MARK: Title

/// "Jobs", "Hello, Treysen" — with an optional meta ("Mon, Oct 5") on the right,
/// bottom-aligned to the title.
struct RvTitle: View {
    @Environment(ThemeSettings.self) private var theme
    let title: String
    var meta: String? = nil
    /// Every page's title size; Home's greeting passes its own, larger.
    var size: CGFloat = Rv.titleSize
    /// Side inset. The pages back on the Liquid Glass arrangement pass 16 so the
    /// title lines up with their cards (spec 2026-10-14); size is unchanged.
    var side: CGFloat = Rv.side

    var body: some View {
        let _ = theme.bgPresetId
        HStack(alignment: .lastTextBaseline, spacing: 12) {
            Text(title)
                .font(.traqs(.bold, size: size))
                .tracking(-size * 0.044)
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            if let meta {
                Text(meta)
                    .font(.traqs(.medium, size: 13))
                    .foregroundStyle(Color(hex: T.muted))
                    .lineLimit(1)
            }
        }
        // Close under the header: the header already carries its own bottom
        // gap, so the design's 26pt doubled it up.
        .padding(.top, 8)
        .padding(.bottom, 22)
        .padding(.horizontal, side)
    }
}

// MARK: Rows

/// A cardless list row: content, 14pt above and below, a hairline under it.
struct RvRow<Content: View>: View {
    var divider: Bool = true
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 14) { content() }
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            if divider { Rv.line.frame(height: 1) }
        }
    }
}

/// Title + subtitle stack used inside a row ("401964 – Thacker pass" /
/// "FLS · 7:00 AM – 3:30 PM").
struct RvRowText: View {
    let title: String
    var subtitle: String? = nil
    var emphasizeSubtitle = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.traqs(.semibold, size: 15))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.traqs(emphasizeSubtitle ? .medium : .regular,
                                  size: 12.5))
                    .foregroundStyle(Color(hex: emphasizeSubtitle ? T.ink : T.muted))
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct RvDot: View {
    let color: Color
    var size: CGFloat = 8
    /// Grows with Dynamic Type (the large-phone floor in RootView), so elements
    /// scale with the text they hold.
    @ScaledMetric(relativeTo: .body) private var k: CGFloat = 1
    var body: some View { Circle().fill(color).frame(width: size * k, height: size * k) }
}

/// The trailing chevron of a tappable row.
struct RvChevron: View {
    var direction: Direction = .right
    enum Direction { case right, down, up }

    var body: some View {
        Image(systemName: direction == .right ? "chevron.right" : direction == .down ? "chevron.down" : "chevron.up")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color(hex: T.muted))
    }
}

// MARK: Tabs

/// Underline tabs. The selected label is ink with a 2pt accent rule under it;
/// the rest are muted. A hairline runs under the whole row.
struct RvTabs<Value: Hashable>: View {
    @Environment(ThemeSettings.self) private var theme
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    /// Muted text at the right end of the row — the Jobs page's job count.
    var trailing: String? = nil
    @Namespace private var underline

    var body: some View {
        let _ = theme.accent
        ZStack(alignment: .bottom) {
            Rv.line.frame(height: 1)
            HStack(spacing: 24) {
                ForEach(options, id: \.value) { option in
                    let on = option.value == selection
                    Button {
                        withAnimation(.easeInOut(duration: 0.22)) { selection = option.value }
                    } label: {
                        Text(option.label)
                            .font(.traqs(.semibold, size: 14))
                            .foregroundStyle(Color(hex: on ? T.ink : T.muted))
                            .padding(.bottom, 10)
                            .overlay(alignment: .bottom) {
                                if on {
                                    Capsule()
                                        .fill(Color(hex: T.accent))
                                        .frame(height: 2)
                                        .matchedGeometryEffect(id: "rule", in: underline)
                                }
                            }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
                if let trailing {
                    Text(trailing)
                        .font(.traqs(.medium, size: 13))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                        .padding(.bottom, 10)
                        .contentTransition(.numericText())
                }
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}
