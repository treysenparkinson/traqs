import SwiftUI

// MARK: - TRAQS Primitives
// SwiftUI ports of the wireframe primitives in screens/shared.jsx.
// Light, hairlined, sometimes raised — never gradient, never playful.

// ── SBox: a light card with a hairline border, optional soft shadow ────────

enum SBoxSize { case sm, md, lg, pill
    var radius: CGFloat {
        switch self {
        case .sm:   return T.cornerSm
        case .md:   return T.cornerMd
        case .lg:   return T.cornerLg
        case .pill: return T.cornerPill
        }
    }
}

struct SBox<Content: View>: View {
    var size: SBoxSize = .md
    var fill: Color? = nil           // nil = white SURFACE
    var stroke: Color? = nil         // nil = hairline T.hair
    var dashed: Bool = false
    var raised: Bool = false         // adds soft raised shadow
    var sky: Bool = false            // adds active sky-tinted shadow + 1px sky ring
    @ViewBuilder var content: () -> Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)
        let f = fill ?? Color(hex: T.surface)
        let s = stroke ?? Color(hex: T.hair)

        return content()
            .background(shape.fill(f))
            .overlay(
                shape.strokeBorder(
                    style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : [])
                )
                .foregroundStyle(s)
            )
            .overlay(
                sky ? AnyView(shape.strokeBorder(Color(hex: T.sky).opacity(0.30), lineWidth: 1)) : AnyView(EmptyView())
            )
            .compositingGroup()
            .shadow(
                color: sky
                    ? Color(hex: T.sky).opacity(T.skyShadowOpacity)
                    : (raised ? Color.black.opacity(T.raisedShadowOpacity) : .clear),
                radius: sky ? T.skyShadowRadius : T.raisedShadowRadius,
                x: 0,
                y: sky ? T.skyShadowY : T.raisedShadowY
            )
    }
}

// ── SLine: hairline divider ────────────────────────────────────────────────

struct SLine: View {
    var color: Color = Color(hex: T.hair)
    var dashed: Bool = false
    var body: some View {
        Rectangle().fill(color).frame(height: 1)
            .overlay(
                dashed ? AnyView(
                    Rectangle()
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(color)
                ) : AnyView(EmptyView())
            )
    }
}

// ── Chip: capsule, hairline border, xs label ───────────────────────────────

struct Chip: View {
    let label: String
    var fill: Color? = nil
    var stroke: Color? = nil
    var color: Color? = nil
    var leading: AnyView? = nil

    var body: some View {
        HStack(spacing: 4) {
            if let l = leading { l }
            Text(label)
                .font(TTypo.xsBold(11))
                .foregroundStyle(color ?? Color(hex: T.ink))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(fill ?? .clear))
        .overlay(Capsule().stroke(stroke ?? Color(hex: T.hair), lineWidth: 1))
    }
}

// ── Avatar: round, department-colored fill with white initial ──────────────

struct Avatar: View {
    let initials: String
    var size: CGFloat = 28
    var fill: Color? = nil      // nil = neutral white circle with hairline
    var stroke: Color? = nil
    var textColor: Color? = nil

    private var isColored: Bool { fill != nil }

    var body: some View {
        ZStack {
            Circle()
                .fill(fill ?? Color(hex: T.surface))
            if !isColored {
                Circle()
                    .strokeBorder(stroke ?? Color(hex: T.hair), lineWidth: 1)
            }
            Text(initials)
                .font(.custom(TFontName.bold.rawValue, size: size * 0.4))
                .foregroundStyle(textColor ?? (isColored ? .white : Color(hex: T.ink)))
        }
        .frame(width: size, height: size)
    }
}

// ── Bar: thin progress bar — pill-capped track + filled portion ────────────

struct Bar: View {
    var pct: Double          // 0 ... 100
    var height: CGFloat = 6
    var fill: Color = Color(hex: T.sky)
    var track: Color = Color(hex: T.hair)

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(fill)
                    .frame(width: max(0, min(1, pct / 100)) * geo.size.width)
            }
        }
        .frame(height: height)
    }
}

// ── JobTypeTag: colored dot + uppercase department label ───────────────────

struct JobTypeTag: View {
    let label: String
    var color: Color = Color(hex: T.magenta)

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label)
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.ink))
                .tLabel(tracking: 1.1)
        }
    }
}

// ── PillBtn: rounded pill action button ────────────────────────────────────

struct PillBtn<Leading: View, Trailing: View>: View {
    let title: String
    var fill: Color? = nil           // nil → white surface
    var stroke: Color? = nil
    var textColor: Color? = nil
    var raised: Bool = true
    var sky: Bool = false             // true → filled-sky CTA with sky-tinted shadow
    var compact: Bool = false
    var action: () -> Void = {}
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                leading()
                Text(title).font(TTypo.xsBold(compact ? 11 : 12)).tLabel(tracking: 0.6)
                trailing()
            }
            .padding(.horizontal, compact ? 10 : 14)
            .padding(.vertical, compact ? 6 : 8)
            .foregroundStyle(textColor ?? (sky ? .white : Color(hex: T.ink)))
            .background(
                Capsule().fill(sky ? Color(hex: T.sky) : (fill ?? Color(hex: T.surface)))
            )
            .overlay(
                Capsule().stroke(
                    sky ? Color(hex: T.sky) : (stroke ?? Color(hex: T.hair)),
                    lineWidth: 1
                )
            )
            .compositingGroup()
            .shadow(
                color: sky ? Color(hex: T.sky).opacity(T.skyShadowOpacity)
                           : (raised ? Color.black.opacity(T.raisedShadowOpacity) : .clear),
                radius: sky ? T.skyShadowRadius : T.raisedShadowRadius,
                x: 0,
                y: sky ? T.skyShadowY : T.raisedShadowY
            )
        }
        .buttonStyle(.plain)
    }
}

extension PillBtn where Leading == EmptyView, Trailing == EmptyView {
    init(_ title: String,
         fill: Color? = nil,
         stroke: Color? = nil,
         textColor: Color? = nil,
         raised: Bool = true,
         sky: Bool = false,
         compact: Bool = false,
         action: @escaping () -> Void = {}) {
        self.title = title
        self.fill = fill
        self.stroke = stroke
        self.textColor = textColor
        self.raised = raised
        self.sky = sky
        self.compact = compact
        self.action = action
        self.leading = { EmptyView() }
        self.trailing = { EmptyView() }
    }
}

// ── IconBtn: standard pill icon button (white surface, hairline, raised) ───

// ── SearchBar: inline search input with leading magnifier, clear (×), cancel ──
// Designed to slide in below a TRAQSNavHeader. Pass a FocusState binding so the
// caller can focus the field as soon as it appears.

struct SearchBar: View {
    @Binding var text: String
    var placeholder: String = "Search…"
    var focused: FocusState<Bool>.Binding
    var onCancel: () -> Void = {}

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                TIconView(icon: .search, size: 14, color: Color(hex: T.muted))
                TextField(placeholder, text: $text)
                    .font(TTypo.sm(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .focused(focused)
                    .submitLabel(.search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !text.isEmpty {
                    Button { text = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Capsule().fill(Color(hex: T.surface)))
            .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))

            Button { onCancel() } label: {
                Text("Cancel")
                    .font(TTypo.smBold(13))
                    .foregroundStyle(Color(hex: T.ink))
            }
            .buttonStyle(.plain)
        }
    }
}

struct IconBtn: View {
    let icon: TIcon
    var size: CGFloat = 18
    var fill: Color? = nil
    var stroke: Color? = nil
    var iconColor: Color = Color(hex: T.ink)
    var pad: CGFloat = 9
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            TIconView(icon: icon, size: size, color: iconColor)
                .padding(pad)
                .background(Circle().fill(fill ?? Color(hex: T.surface)))
                .overlay(Circle().stroke(stroke ?? Color(hex: T.hair), lineWidth: 1))
                .compositingGroup()
                .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                        radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
        }
        .buttonStyle(.plain)
    }
}

// ── Segmented: equal-width segments, single sky pill sliding via offset ────
// Layout strategy:
//   • Each label is `frame(maxWidth: .infinity)` so segments are perfectly equal width.
//   • One Capsule lives in the background, sized to one segment, slid by
//     `selectedIndex * segmentWidth`. Same shape the whole time — no create/destroy.
//   • One implicit animation drives both the pill slide and the label color
//     crossfade, so they're locked to the same curve and duration.

struct Segmented<Value: Hashable>: View {
    let options: [Value]
    let labels: [Value: String]
    @Binding var selection: Value

    private var selectedIndex: Int { options.firstIndex(of: selection) ?? 0 }

    private var slideAnimation: Animation {
        .spring(response: 0.18, dampingFraction: 1.0, blendDuration: 0)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            // The sliding sky pill — single shape, never recreated.
            GeometryReader { geo in
                let segW = geo.size.width / CGFloat(max(options.count, 1))
                Capsule()
                    .fill(Color(hex: T.sky))
                    .frame(width: segW, height: geo.size.height)
                    .offset(x: CGFloat(selectedIndex) * segW)
            }
            .allowsHitTesting(false)

            // Labels row — equal-width tap targets stacked above the pill.
            HStack(spacing: 0) {
                ForEach(options, id: \.self) { o in
                    Text(labels[o] ?? "")
                        .font(.custom(TFontName.bold.rawValue, size: 13))
                        .foregroundStyle(o == selection ? .white : Color(hex: T.ink))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selection = o
                        }
                }
            }
        }
        .padding(3)
        .background(Capsule().fill(Color(hex: T.surface)))
        .overlay(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
        .compositingGroup()
        .shadow(color: Color.black.opacity(T.raisedShadowOpacity),
                radius: T.raisedShadowRadius, x: 0, y: T.raisedShadowY)
        // One implicit animation drives both the offset and the color crossfade
        // — same curve, same duration, regardless of how far the pill is moving.
        .animation(slideAnimation, value: selection)
    }
}

// ── Sparkline: simple line+area chart for the Stats hero ───────────────────

struct Sparkline: View {
    let points: [Double]
    var stroke: Color = Color(hex: T.sky)
    var fill: Color = Color(hex: T.sky).opacity(0.12)
    var height: CGFloat = 84

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let mn = points.min() ?? 0
            let mx = points.max() ?? 1
            let range = max(mx - mn, 0.0001)
            let step = points.count > 1 ? w / CGFloat(points.count - 1) : w
            let ys: [CGFloat] = points.map { v in
                let t = (Double(v) - mn) / range
                return h - CGFloat(t) * (h - 8) - 4
            }
            ZStack(alignment: .bottomLeading) {
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h))
                    p.addLine(to: CGPoint(x: 0, y: ys.first ?? h))
                    for i in 0..<ys.count {
                        p.addLine(to: CGPoint(x: CGFloat(i) * step, y: ys[i]))
                    }
                    p.addLine(to: CGPoint(x: w, y: h))
                    p.closeSubpath()
                }
                .fill(fill)
                Path { p in
                    for i in 0..<ys.count {
                        let pt = CGPoint(x: CGFloat(i) * step, y: ys[i])
                        if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
                    }
                }
                .stroke(stroke, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if let last = ys.last {
                    Circle()
                        .fill(stroke)
                        .frame(width: 8, height: 8)
                        .offset(x: CGFloat(ys.count - 1) * step - 4, y: last - h / 2 - 4)
                }
            }
        }
        .frame(height: height)
    }
}

// ── Section title (used by inboxes, hours entries, etc.) ───────────────────

struct TSectionTitle: View {
    let title: String
    var action: String? = nil
    /// Optional tap handler for the trailing action label. When provided the
    /// label renders in sky and becomes an actual button.
    var onAction: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(TTypo.h3(18))
                .foregroundStyle(Color(hex: T.ink))
            Spacer()
            if let a = action {
                if let onAction {
                    Button(action: onAction) {
                        Text(a)
                            .font(TTypo.xsBold(11))
                            .foregroundStyle(Color(hex: T.sky))
                            .tLabel(tracking: 1.2)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(a)
                        .font(TTypo.xsBold(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .tLabel(tracking: 1.2)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }
}
