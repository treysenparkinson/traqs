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
    /// Gap between a section's eyebrow row and the previous block.
    static let sectionTop: CGFloat = 24
    /// The hairline: ink at 9%, so it reads on light and dark alike.
    static var line: Color { Color(hex: T.ink).opacity(0.09) }

    /// The design's five pastel tile fills, each with a dark-theme pair.
    enum Tint: CaseIterable {
        case lavender, mint, peach, sky, butter

        private var light: String {
            switch self {
            case .lavender: return "#E9E6FB"
            case .mint:     return "#DFF5EC"
            case .peach:    return "#FDE8E3"
            case .sky:      return "#E0F3FC"
            case .butter:   return "#FDF1D6"
            }
        }
        /// The same hues sunk into a dark canvas — tinted, not grey, so the tiles
        /// keep telling each other apart.
        private var dark: String {
            switch self {
            case .lavender: return "#2C2843"
            case .mint:     return "#1E3A30"
            case .peach:    return "#43292A"
            case .sky:      return "#1D3746"
            case .butter:   return "#40361F"
            }
        }
        var fill: Color { Color(hex: T.isDarkTheme ? dark : light) }
    }
}

// MARK: Title

/// "Jobs", "Hello, Treysen" — with an optional meta ("Mon, Oct 5") on the right,
/// bottom-aligned to the title.
struct RvTitle: View {
    @Environment(ThemeSettings.self) private var theme
    let title: String
    var meta: String? = nil

    var body: some View {
        let _ = theme.bgPresetId
        HStack(alignment: .lastTextBaseline, spacing: 12) {
            Text(title)
                .font(.custom(TFontName.bold.rawValue, size: 34))
                .tracking(-1.5)
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            if let meta {
                Text(meta)
                    .font(.custom(TFontName.medium.rawValue, size: 13))
                    .foregroundStyle(Color(hex: T.muted))
                    .lineLimit(1)
            }
        }
        // Close under the header: the header already carries its own bottom
        // gap, so the design's 26pt doubled it up.
        .padding(.top, 8)
        .padding(.bottom, 22)
        .padding(.horizontal, Rv.side)
    }
}

// MARK: Section header

/// The eyebrow row that opens a section: "THIS WEEK ··· Full schedule", over a
/// hairline. The trailing slot takes an accent action, a count, or any view.
struct RvSection<Trailing: View>: View {
    @Environment(ThemeSettings.self) private var theme
    let title: String
    var hairline: Bool = true
    var top: CGFloat = Rv.sectionTop
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        let _ = theme.bgPresetId
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                RvEyebrow(title)
                Spacer(minLength: 8)
                trailing()
            }
            .padding(.bottom, 10)
            if hairline { Rv.line.frame(height: 1) }
        }
        .padding(.top, top)
    }
}

extension RvSection where Trailing == EmptyView {
    init(_ title: String, hairline: Bool = true, top: CGFloat = Rv.sectionTop) {
        self.init(title: title, hairline: hairline, top: top) { EmptyView() }
    }
}

extension RvSection where Trailing == RvSectionAction {
    /// An accent text action ("Full schedule") — tappable when `action` is set.
    init(_ title: String, action label: String, hairline: Bool = true,
         top: CGFloat = Rv.sectionTop, perform: (() -> Void)? = nil) {
        self.init(title: title, hairline: hairline, top: top) {
            RvSectionAction(label: label, perform: perform)
        }
    }
}

struct RvSectionAction: View {
    let label: String
    var perform: (() -> Void)? = nil

    var body: some View {
        let text = Text(label)
            .font(.custom(TFontName.semibold.rawValue, size: 12))
            .foregroundStyle(Color(hex: perform == nil ? T.muted : T.accent))
        if let perform {
            Button(action: perform) { text }.buttonStyle(.plain)
        } else {
            text
        }
    }
}

/// 11pt uppercase, 0.1em tracking — the design's `.eyebrow`.
struct RvEyebrow: View {
    let text: String
    var color: Color? = nil
    init(_ text: String, color: Color? = nil) { self.text = text; self.color = color }

    var body: some View {
        Text(text.uppercased())
            .font(.custom(TFontName.semibold.rawValue, size: 11))
            .tracking(1.1)
            .foregroundStyle(color ?? Color(hex: T.muted))
            .lineLimit(1)
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
                .font(.custom(TFontName.semibold.rawValue, size: 15))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.custom(emphasizeSubtitle ? TFontName.medium.rawValue : TFontName.regular.rawValue,
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

// MARK: Tiles

/// A pastel status tile: eyebrow top-left, a big number at the bottom, an
/// optional sub line. 104pt tall, 20pt corners.
struct RvTile<Accessory: View>: View {
    @Environment(ThemeSettings.self) private var theme
    let eyebrow: String
    let value: String
    var sub: String? = nil
    var tint: Rv.Tint
    var height: CGFloat = 104
    var action: (() -> Void)? = nil
    @ViewBuilder var accessory: () -> Accessory
    /// Grows with Dynamic Type (the large-phone floor in RootView), so elements
    /// scale with the text they hold.
    @ScaledMetric(relativeTo: .body) private var k: CGFloat = 1

    var body: some View {
        let _ = theme.bgPresetId
        let tile = VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                RvEyebrow(eyebrow, color: Color(hex: T.ink).opacity(0.55))
                Spacer(minLength: 4)
                accessory()
            }
            Spacer(minLength: 6)
            Text(value)
                .font(.custom(TFontName.bold.rawValue, size: 28))
                .tracking(-1)
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .monospacedDigit()
            if let sub {
                Text(sub)
                    .font(.custom(TFontName.regular.rawValue, size: 12))
                    .foregroundStyle(Color(hex: T.muted))
                    .lineLimit(1)
                    .padding(.top, 4)
            }
        }
        .padding(16 * k)
        .frame(maxWidth: .infinity, minHeight: height * k, maxHeight: height * k, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 20 * k, style: .continuous).fill(tint.fill))
        .contentShape(RoundedRectangle(cornerRadius: 20 * k, style: .continuous))

        if let action {
            Button(action: action) { tile }.buttonStyle(.plain)
        } else {
            tile
        }
    }
}

extension RvTile where Accessory == EmptyView {
    init(eyebrow: String, value: String, sub: String? = nil, tint: Rv.Tint,
         height: CGFloat = 104, action: (() -> Void)? = nil) {
        self.init(eyebrow: eyebrow, value: value, sub: sub, tint: tint, height: height,
                  action: action) { EmptyView() }
    }
}

/// The two-column tile grid.
struct RvTileGrid<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                  spacing: 12, content: content)
            .padding(.top, 14)
    }
}

// MARK: Tabs

/// Underline tabs. The selected label is ink with a 2pt accent rule under it;
/// the rest are muted. A hairline runs under the whole row.
struct RvTabs<Value: Hashable>: View {
    @Environment(ThemeSettings.self) private var theme
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
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
                            .font(.custom(TFontName.semibold.rawValue, size: 14))
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
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}

// MARK: Bars

/// White bars on the canvas, rounded 8pt; the `highlight` bar (today, or the
/// selected day) is accent. Heights scale to the largest value, with a floor so
/// an empty day still shows a stub, as the design draws it.
struct RvBars: View {
    @Environment(ThemeSettings.self) private var theme
    let values: [Double]
    let labels: [String]
    var highlight: Int? = nil
    /// Optional value line above the bars ("0.00").
    var valueLabels: [String]? = nil
    var height: CGFloat = 84
    var barWidth: CGFloat = 30
    var minBar: CGFloat = 8
    /// A second series drawn inside each bar from the bottom (job hours inside
    /// pay hours on Efficiency). Nil draws one series.
    var inner: [Double]? = nil
    /// Grows with Dynamic Type (the large-phone floor in RootView), so elements
    /// scale with the text they hold.
    @ScaledMetric(relativeTo: .body) private var k: CGFloat = 1

    var body: some View {
        let _ = theme.accent; let _ = theme.bgPresetId
        let top = max(values.max() ?? 0, inner?.max() ?? 0, 0.0001)
        let height = self.height * k, barWidth = self.barWidth * k, minBar = self.minBar * k
        VStack(spacing: 0) {
            if let valueLabels {
                HStack(spacing: 0) {
                    ForEach(valueLabels.indices, id: \.self) { i in
                        cell(valueLabels[i], on: i == highlight)
                    }
                }
                .padding(.bottom, 8)
            }
            HStack(alignment: .bottom, spacing: 0) {
                ForEach(values.indices, id: \.self) { i in
                    let on = i == highlight
                    let h = values[i] > 0 ? max(minBar, height * CGFloat(values[i] / top)) : minBar
                    ZStack(alignment: .bottom) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(on ? Color(hex: T.accent) : Color(hex: T.progressTrack))
                            .frame(width: barWidth, height: h)
                        if let inner, inner.indices.contains(i), inner[i] > 0 {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color(hex: ThemeSettings.derivedEnd(from: T.accent)))
                                .frame(width: barWidth,
                                       height: min(h, max(minBar, height * CGFloat(inner[i] / top))))
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: height, alignment: .bottom)
            HStack(spacing: 0) {
                ForEach(labels.indices, id: \.self) { i in
                    cell(labels[i], on: i == highlight)
                }
            }
            .padding(.top, 8)
        }
    }

    private func cell(_ text: String, on: Bool) -> some View {
        Text(text)
            .font(.custom(on ? TFontName.semibold.rawValue : TFontName.regular.rawValue, size: 11))
            .foregroundStyle(Color(hex: on ? T.ink : T.muted))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity)
    }
}

// MARK: Track

/// A 6pt white progress track with an accent fill.
struct RvTrack: View {
    @Environment(ThemeSettings.self) private var theme
    let fraction: Double
    var color: Color? = nil

    var body: some View {
        let _ = theme.accent; let _ = theme.bgPresetId
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(hex: T.progressTrack))
                Capsule()
                    .fill(color ?? Color(hex: T.accent))
                    .frame(width: g.size.width * CGFloat(min(1, max(0, fraction))))
            }
        }
        .frame(height: 6 * k)
    }
    /// Grows with Dynamic Type (the large-phone floor in RootView), so elements
    /// scale with the text they hold.
    @ScaledMetric(relativeTo: .body) private var k: CGFloat = 1
}

// MARK: Week strip

/// Seven day columns — weekday letter over a day number; the highlighted day is
/// an accent disc with a soft accent shadow.
struct RvWeekStrip: View {
    @Environment(ThemeSettings.self) private var theme
    struct Day: Identifiable {
        let id: String
        let letter: String
        let number: String
        let isOn: Bool
        var dimmed: Bool = false
    }
    let days: [Day]
    var onTap: ((Day) -> Void)? = nil
    /// Grows with Dynamic Type (the large-phone floor in RootView), so elements
    /// scale with the text they hold.
    @ScaledMetric(relativeTo: .body) private var k: CGFloat = 1

    var body: some View {
        let _ = theme.accent; let _ = theme.bgPresetId
        HStack(spacing: 0) {
            ForEach(days) { d in
                let cell = VStack(spacing: 6) {
                    Text(d.letter)
                        .font(.custom(TFontName.semibold.rawValue, size: 11))
                        .foregroundStyle(Color(hex: T.muted))
                    Text(d.number)
                        .font(.custom(TFontName.semibold.rawValue, size: 16))
                        .foregroundStyle(d.isOn ? T.onAccent : Color(hex: T.ink))
                        .frame(width: 36 * k, height: 36 * k)
                        .background {
                            if d.isOn {
                                Circle()
                                    .fill(Color(hex: T.accent))
                                    .shadow(color: Color(hex: T.accent).opacity(0.45), radius: 7, y: 6)
                            }
                        }
                }
                .opacity(d.dimmed ? 0.45 : 1)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())

                if let onTap {
                    Button { onTap(d) } label: { cell }.buttonStyle(.plain)
                } else {
                    cell
                }
            }
        }
        .padding(.top, 14)
    }
}

// MARK: Pill tag

/// The small rounded tag in the design ("401964 – 01", "NOT ASSIGNED", "OFFLINE").
struct RvTag: View {
    let text: String
    var foreground: Color
    var background: Color

    var body: some View {
        Text(text)
            .font(.custom(TFontName.semibold.rawValue, size: 11))
            .foregroundStyle(foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(background))
            .lineLimit(1)
    }
}
