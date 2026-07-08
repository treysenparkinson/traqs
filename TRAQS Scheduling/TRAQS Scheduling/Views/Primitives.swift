import SwiftUI
import UIKit

// MARK: - TRAQS Primitives
// SwiftUI ports of the wireframe primitives in screens/shared.jsx.
// Light, hairlined, frosted, sometimes raised. The signature indigo→magenta
// gradient (T.brandGradient) is a first-class brand element — reserved for
// identity, progress, active, and primary-action states only.

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
    var radius: CGFloat? = nil       // override the size's default corner radius
    var fill: Color? = nil           // nil = white SURFACE
    var stroke: Color? = nil         // nil = hairline T.hair
    var dashed: Bool = false
    var raised: Bool = false         // adds soft raised shadow
    var sky: Bool = false            // adds active sky-tinted shadow + 1px sky ring
    var active: Bool = false         // like `sky` but uses the brand gradient START (indigo) — for the active hero card
    var amber: Bool = false          // paused/on-break state — amber ring + tint, takes precedence over sky/active
    var frosted: Bool = false        // glassy white top-edge highlight + softer/larger ambient elevation
    var heroGlow: Bool = false       // lavender corner glow blob bleeding from the upper-right (clipped)
    var liveSheen: Bool = false      // whisper-soft ANIMATED brand glow — for "your" cards (drifts/hue-shifts)
    @ViewBuilder var content: () -> Content

    private var effectiveRadius: CGFloat { radius ?? size.radius }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: effectiveRadius, style: .continuous)
        // Amber (paused) wins over active/sky so a paused active card reads as
        // on-break. `active` uses the brand indigo; `sky` keeps the legacy accent.
        let highlight: Color? = amber ? Color(hex: T.amber)
            : (active ? Color(hex: T.accentGradientStart)
                      : (sky ? Color(hex: T.sky) : nil))
        let f = fill ?? (amber ? Color(hex: T.amber).opacity(0.06) : Color(hex: T.surface))
        let s = stroke ?? Color(hex: T.hair)

        // Broken into typed sub-views/helpers so the type-checker stays fast.
        return content()
            .background(shape.fill(f))
            .overlay { glowOverlay(shape) }
            .overlay { strokeOverlay(shape, hairline: s, highlight: highlight) }
            .compositingGroup()
            .shadow(color: shadowColor(highlight),
                    radius: shadowRadius(highlight),
                    x: 0, y: shadowY(highlight))
    }

    @ViewBuilder
    private func glowOverlay(_ shape: RoundedRectangle) -> some View {
        if heroGlow {
            GlowBlob(size: T.glowSize * 0.85, opacity: 0.24)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .offset(x: 34, y: -28)
                .clipShape(shape)
                .allowsHitTesting(false)
        }
        if liveSheen { LiveSheen(radius: effectiveRadius) }
    }

    @ViewBuilder
    private func strokeOverlay(_ shape: RoundedRectangle, hairline: Color, highlight: Color?) -> some View {
        ZStack {
            shape.strokeBorder(style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : []))
                .foregroundStyle(hairline)
            if frosted {                     // glassy white top-edge highlight
                shape.strokeBorder(
                    LinearGradient(colors: [Color(hex: T.highlightStroke).opacity(0.55), .clear],
                                   startPoint: .top, endPoint: .bottom),
                    lineWidth: 1)
            }
            if let highlight {               // active/sky/amber ring
                shape.strokeBorder(highlight.opacity(0.35), lineWidth: 1)
            }
        }
    }

    private func shadowColor(_ highlight: Color?) -> Color {
        highlight.map { $0.opacity(T.skyShadowOpacity) }
            ?? (frosted ? Color.black.opacity(T.ambientShadowOpacity)
                        : (raised ? Color.black.opacity(T.raisedShadowOpacity) : .clear))
    }
    private func shadowRadius(_ highlight: Color?) -> CGFloat {
        highlight != nil ? T.skyShadowRadius : (frosted ? T.ambientShadowRadius : T.raisedShadowRadius)
    }
    private func shadowY(_ highlight: Color?) -> CGFloat {
        highlight != nil ? T.skyShadowY : (frosted ? T.ambientShadowY : T.raisedShadowY)
    }
}

// ── LiveSheen: static, minimal brand-gradient glow for "your" cards ────────
// A fixed indigo→magenta radial pool in the top-right corner — present at all
// times on assigned cards, no animation. Clipped to the card; never hit-tests.
struct LiveSheen: View {
    var radius: CGFloat = T.cornerLg
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Color.clear)
            .overlay(alignment: .topTrailing) {
                Circle()
                    .fill(RadialGradient(
                        colors: [Color(hex: T.accentGradientEnd).opacity(0.22),
                                 Color(hex: T.accentGradientStart).opacity(0.10),
                                 .clear],
                        center: .center, startRadius: 0, endRadius: 95))
                    .frame(width: 190, height: 190)
                    .blur(radius: 28)
                    .offset(x: 30, y: -28)
            }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .allowsHitTesting(false)
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
    var gradient: Bool = false  // fill with the signature brand gradient (wins over fill)
    var presence: Color? = nil  // optional bottom-right presence dot (work/break/idle)
    var imageData: String? = nil // optional profile picture as a data: URL / base64

    private var isColored: Bool { fill != nil || gradient }
    private var profileImage: UIImage? { Avatar.decodeImage(imageData) }

    var body: some View {
        ZStack {
            if let profileImage {
                // Profile picture wins over initials/gradient.
                Image(uiImage: profileImage)
                    .resizable()
                    .scaledToFill()
            } else {
                if gradient {
                    Circle().fill(T.brandGradient(start: .topLeading, end: .bottomTrailing))
                } else {
                    Circle().fill(fill ?? Color(hex: T.surface))
                }
                if !isColored {
                    Circle()
                        .strokeBorder(stroke ?? Color(hex: T.hair), lineWidth: 1)
                }
                Text(initials)
                    .font(.custom(TFontName.bold.rawValue, size: size * 0.4))
                    .foregroundStyle(textColor ?? (isColored ? .white : Color(hex: T.ink)))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(alignment: .bottomTrailing) {
            if let presence {
                Circle().fill(presence)
                    .frame(width: size * 0.28, height: size * 0.28)
                    .overlay(Circle().stroke(Color(hex: T.surface), lineWidth: max(1.5, size * 0.05)))
            }
        }
    }

    /// Decode a stored profile image — a `data:image/...;base64,XXXX` URL (as the
    /// web writes) or a bare base64 string — into a UIImage.
    static func decodeImage(_ s: String?) -> UIImage? {
        guard let s, !s.isEmpty else { return nil }
        let b64 = s.contains(",") ? String(s.split(separator: ",").last ?? "") : s
        guard let data = Data(base64Encoded: b64) else { return nil }
        return UIImage(data: data)
    }
}

// ── Bar: thin progress bar — pill-capped track + filled portion ────────────

struct Bar: View {
    var pct: Double          // 0 ... 100
    var height: CGFloat = 6
    var fill: Color = Color(hex: T.sky)
    /// When set, the filled portion paints with this gradient instead of `fill`.
    var gradient: LinearGradient? = nil
    var track: Color = Color(hex: T.hair)   // theme-aware; stays correct on dark bg presets

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule()
                    .fill(gradient.map { AnyShapeStyle($0) } ?? AnyShapeStyle(fill))
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
    var gradient: Bool = false        // true → signature brand-gradient CTA with glow (wins over sky)
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
            .foregroundStyle(textColor ?? ((sky || gradient) ? .white : Color(hex: T.ink)))
            .background(
                Capsule().fill(
                    gradient ? AnyShapeStyle(T.brandGradient())
                             : AnyShapeStyle(sky ? Color(hex: T.sky) : (fill ?? Color(hex: T.surface)))
                )
            )
            .overlay(
                Capsule().stroke(
                    gradient ? Color.clear : (sky ? Color(hex: T.sky) : (stroke ?? Color(hex: T.hair))),
                    lineWidth: 1
                )
            )
            .compositingGroup()
            .shadow(
                color: gradient ? Color(hex: T.ctaGlowColor).opacity(T.ctaGlowOpacity)
                    : (sky ? Color(hex: T.sky).opacity(T.skyShadowOpacity)
                           : (raised ? Color.black.opacity(T.raisedShadowOpacity) : .clear)),
                radius: gradient ? T.ctaGlowRadius : (sky ? T.skyShadowRadius : T.raisedShadowRadius),
                x: 0,
                y: gradient ? T.ctaGlowY : (sky ? T.skyShadowY : T.raisedShadowY)
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
         gradient: Bool = false,
         compact: Bool = false,
         action: @escaping () -> Void = {}) {
        self.title = title
        self.fill = fill
        self.stroke = stroke
        self.textColor = textColor
        self.raised = raised
        self.sky = sky
        self.gradient = gradient
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
    /// Active pill paints with the signature brand gradient (default). Set false
    /// to fall back to a flat sky pill.
    var gradient: Bool = true

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
                    .fill(gradient ? AnyShapeStyle(T.brandGradient()) : AnyShapeStyle(Color(hex: T.sky)))
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

// MARK: - Revamp · ambient canvas, glow, gradient CTA, ring, frosted card

// ── GlowBlob: soft blurred radial pool of brand color ──────────────────────
struct GlowBlob: View {
    var color: Color = Color(hex: T.glowBlob)
    var size: CGFloat = T.glowSize
    var opacity: Double = T.glowOpacity
    var body: some View {
        Circle()
            .fill(RadialGradient(colors: [color.opacity(opacity), .clear],
                                 center: .center, startRadius: 0, endRadius: size / 2))
            .frame(width: size, height: size)
            .blur(radius: T.glowBlur)
            .allowsHitTesting(false)
    }
}

// ── AmbientBackground: tinted vertical canvas + faint glow blobs ───────────
// Replaces the flat `Color(hex: T.bg)` page paint. Glows show only on light bg
// presets (they'd muddy a dark canvas), gated by ThemeSettings.isLightTheme.
struct AmbientBackground: View {
    @Environment(ThemeSettings.self) private var themeSettings
    var body: some View {
        // Read accent too so a live Customize accent change (which only
        // shifts the glow tint, not isLightTheme) still re-renders here.
        let _ = themeSettings.accent
        let light = themeSettings.isLightTheme
        ZStack {
            if light {
                LinearGradient(colors: [Color(hex: T.bgGradTop), Color(hex: T.bgGradBottom)],
                               startPoint: .top, endPoint: .bottom)
            } else {
                Color(hex: T.bg)
            }
            if light {
                // Upper-right glow only. The lower glow pooled a soft color
                // band at the bottom of pages with empty space (e.g. Home),
                // which read as a "footer" — removed so the bottom stays clean.
                GlowBlob().offset(x: 130, y: -210)
            }
        }
        .ignoresSafeArea()
    }
}

// ── GradientCTA: the primary action button (Stop / Start Timer / End Job) ──
// Generic over its label so existing spinner/icon HStacks drop straight in.
// `disabled` blocks taps; `dimmed` controls the 0.5 fade independently (so a
// busy-but-full-color "STOPPING…/Ending…" state stays vivid while non-tappable).
struct GradientCTA<Label: View>: View {
    var disabled: Bool = false
    var dimmed: Bool = false
    var fullWidth: Bool = true
    var verticalPadding: CGFloat = 13
    var action: () -> Void
    @ViewBuilder var label: () -> Label
    @State private var pressed = false

    var body: some View {
        Button(action: action) {
            label()
                .foregroundStyle(.white)
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .padding(.vertical, verticalPadding)
                .padding(.horizontal, fullWidth ? 0 : 20)
                .background(Capsule().fill(T.brandGradient()))
                .opacity(dimmed ? 0.5 : 1)
                .scaleEffect(pressed && !disabled ? 0.97 : 1)
                .shadow(color: Color(hex: T.ctaGlowColor)
                            .opacity(dimmed ? 0 : (pressed ? T.ctaGlowOpacity * 0.7 : T.ctaGlowOpacity)),
                        radius: T.ctaGlowRadius, x: 0, y: T.ctaGlowY)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .simultaneousGesture(DragGesture(minimumDistance: 0)
            .onChanged { _ in if !disabled { pressed = true } }
            .onEnded { _ in pressed = false })
        .animation(.easeOut(duration: 0.12), value: pressed)
    }
}

// ── GradientRing: circular progress with the signature gradient ────────────
struct GradientRing: View {
    var pct: Double            // 0...100
    var lineWidth: CGFloat = 14
    var body: some View {
        ZStack {
            Circle().stroke(Color(hex: T.progressTrack), lineWidth: lineWidth)
            Circle().trim(from: 0, to: max(0, min(1, pct / 100)))
                .stroke(T.brandGradient(start: .topLeading, end: .bottomTrailing),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: Color(hex: T.ctaGlowColor).opacity(0.25), radius: 6)
        }
    }
}

// ── FrostedCard: glassy white surface — big radius, soft white top-edge ────
// highlight, diffuse ambient elevation. Opt-in via .frostedCard().
struct FrostedCard: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    var radius: CGFloat = T.cornerHero
    func body(content: Content) -> some View {
        // Touch the theme so a live Customize background/accent change
        // re-renders every frosted surface immediately (the T.* tokens it
        // reads aren't observable on their own).
        _ = theme.bgPresetId; _ = theme.accent
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return content
            .background(shape.fill(Color(hex: T.surface)))
            .overlay(shape.strokeBorder(
                LinearGradient(colors: [Color(hex: T.highlightStroke).opacity(0.55), .clear],
                               startPoint: .top, endPoint: .bottom),
                lineWidth: 1))
            .compositingGroup()
            .shadow(color: .black.opacity(T.ambientShadowOpacity),
                    radius: T.ambientShadowRadius, x: 0, y: T.ambientShadowY)
    }
}

extension View {
    func frostedCard(radius: CGFloat = T.cornerHero) -> some View {
        modifier(FrostedCard(radius: radius))
    }
}

// ── PageTitle: big bold screen title + optional subtitle (under the header) ─
struct PageTitle: View {
    @Environment(ThemeSettings.self) private var theme
    let title: String
    var subtitle: String? = nil
    var size: CGFloat = 56
    /// Title fill. Defaults to solid primary ink (theme-aware "black"). Pass a
    /// gradient to override.
    var gradient: LinearGradient? = nil

    private var titleFill: AnyShapeStyle {
        // Solid primary ink — adapts to light/dark backgrounds. An explicit
        // gradient override still wins if a caller passes one.
        if let gradient { return AnyShapeStyle(gradient) }
        return AnyShapeStyle(Color(hex: T.ink))
    }

    var body: some View {
        // Re-render the title ink on a live Customize background change.
        _ = theme.bgPresetId
        return VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.custom(TFontName.extrabold.rawValue, size: size))
                .tracking(-4)
                .foregroundStyle(titleFill)
            if let subtitle {
                Text(subtitle)
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
    }
}

// ── TagPill: bright semantic tag / status pill (tint bg + same-hue text) ───
// The wireframe's Install / Repair / Inspect / Up-next / On-job / Break / Idle
// pills. Bright non-brand color lives ONLY here.
enum TagKind {
    case indigo, amber, green, sky, magenta, neutral
    var bg: Color {
        switch self {
        case .indigo:  return Color(hex: T.pillIndigoBg)
        case .amber:   return Color(hex: T.pillAmberBg)
        case .green:   return Color(hex: T.pillGreenBg)
        case .sky:     return Color(hex: "#DCEAFD")
        case .magenta: return Color(hex: "#FBE0F2")
        case .neutral: return Color(hex: T.pillNeutralBg)
        }
    }
    var fg: Color {
        switch self {
        case .indigo:  return Color(hex: T.pillIndigoFg)
        case .amber:   return Color(hex: T.pillAmberFg)
        case .green:   return Color(hex: T.pillGreenFg)
        case .sky:     return Color(hex: "#2F74E0")
        case .magenta: return Color(hex: "#C026A6")
        case .neutral: return Color(hex: T.pillNeutralFg)
        }
    }
}

struct TagPill: View {
    let label: String
    var kind: TagKind = .indigo
    var dot: Bool = false
    var body: some View {
        HStack(spacing: 5) {
            if dot { Circle().fill(kind.fg).frame(width: 6, height: 6) }
            Text(label)
                .font(TTypo.xsBold(11))
                .tLabel(tracking: 0.4)
                .foregroundStyle(kind.fg)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(kind.bg))
    }
}

// ── IconChip: rounded-square tinted chip with a centered line icon ─────────
// The Hours "recent" rows and Settings rows use these as leading glyphs.
struct IconChip: View {
    let icon: TIcon
    var color: Color = Color(hex: T.pillIndigoFg)
    var size: CGFloat = 38
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.30, style: .continuous)
            .fill(color.opacity(0.14))
            .frame(width: size, height: size)
            .overlay(TIconView(icon: icon, size: size * 0.46, color: color, weight: .semibold))
    }
}

// ── GradientToggleStyle: capsule that fills with the brand gradient when ON ─
struct GradientToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                configuration.isOn.toggle()
            }
        } label: {
            ZStack {
                Capsule()
                    .fill(configuration.isOn ? AnyShapeStyle(T.brandGradient())
                                             : AnyShapeStyle(Color(hex: T.hair)))
                    .frame(width: 48, height: 29)
                    .shadow(color: configuration.isOn ? Color(hex: T.ctaGlowColor).opacity(0.35) : .clear,
                            radius: 8, x: 0, y: 3)
                Circle()
                    .fill(.white)
                    .frame(width: 23, height: 23)
                    .shadow(color: .black.opacity(0.18), radius: 2, x: 0, y: 1)
                    .offset(x: configuration.isOn ? 9.5 : -9.5)
            }
        }
        .buttonStyle(.plain)
    }
}

// ── FadingBlur: a backdrop blur that ramps in via a gradient mask ──────────
// Used to softly blur content behind a floating menu: sharp at the top (near
// the title), easing into full blur lower down — no hard edge, and not every
// pixel is blurred.
#if canImport(UIKit)
import UIKit

final class _GradientBlurView: UIVisualEffectView {
    private let maskLayer = CAGradientLayer()
    /// `flip == false`: sharp at the top, full blur lower down (for a menu that
    /// floats near the BOTTOM, e.g. the Jobs range FAB). `flip == true`: full
    /// blur at the top easing out toward the bottom (for a menu near the TOP,
    /// e.g. the Messages header people popover).
    init(flip: Bool = false) {
        super.init(effect: UIBlurEffect(style: .systemUltraThinMaterial))
        if flip {
            maskLayer.colors = [UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]
            maskLayer.locations = [0.0, 0.66, 1.0]
        } else {
            maskLayer.colors = [UIColor.clear.cgColor, UIColor.black.cgColor, UIColor.black.cgColor]
            maskLayer.locations = [0.0, 0.34, 1.0]
        }
        maskLayer.startPoint = CGPoint(x: 0.5, y: 0)
        maskLayer.endPoint = CGPoint(x: 0.5, y: 1)
        layer.mask = maskLayer
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        maskLayer.frame = bounds
        CATransaction.commit()
    }
}

struct FadingBlur: UIViewRepresentable {
    /// Flip the gradient to full-at-top (for menus anchored near the top).
    var flip: Bool = false
    func makeUIView(context: Context) -> _GradientBlurView { _GradientBlurView(flip: flip) }
    func updateUIView(_ uiView: _GradientBlurView, context: Context) {}
}

// MARK: - Interactive swipe-back (edge swipe → go back)

/// Re-enables the native left-edge swipe-to-go-back on a PUSHED screen whose
/// navigation bar is hidden — hiding the bar otherwise disables UIKit's
/// interactivePopGestureRecognizer. Drop `.background(SwipeBackEnabler())` on a
/// pushed view. The delegate only lets the swipe begin when there's something to
/// pop, so a root screen still yields the left edge to the side drawer.
final class PopGestureCoordinator: NSObject, UIGestureRecognizerDelegate {
    weak var nav: UINavigationController?
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        (nav?.viewControllers.count ?? 0) > 1
    }
}

struct SwipeBackEnabler: UIViewControllerRepresentable {
    func makeCoordinator() -> PopGestureCoordinator { PopGestureCoordinator() }
    func makeUIViewController(context: Context) -> UIViewController { UIViewController() }
    func updateUIViewController(_ vc: UIViewController, context: Context) {
        DispatchQueue.main.async {
            var current: UIViewController? = vc
            while let c = current {
                if let nav = c.navigationController {
                    context.coordinator.nav = nav
                    nav.interactivePopGestureRecognizer?.isEnabled = true
                    nav.interactivePopGestureRecognizer?.delegate = context.coordinator
                    return
                }
                current = c.parent
            }
        }
    }
}

/// Left-edge swipe that triggers `action` (typically dismiss). For modally
/// presented pages (fullScreenCover / sheet) that aren't in a navigation stack,
/// so the native pop gesture doesn't apply. Runs as a simultaneous gesture and
/// only fires on a clear left-edge horizontal swipe, so it won't hijack scrolls.
struct EdgeSwipeBack: ViewModifier {
    let action: () -> Void
    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 20, coordinateSpace: .global)
                .onEnded { v in
                    if v.startLocation.x < 24, v.translation.width > 90, abs(v.translation.height) < 60 {
                        action()
                    }
                }
        )
    }
}
extension View {
    func edgeSwipeBack(_ action: @escaping () -> Void) -> some View {
        modifier(EdgeSwipeBack(action: action))
    }
}
#endif
