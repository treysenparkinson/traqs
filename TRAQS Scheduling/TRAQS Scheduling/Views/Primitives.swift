import SwiftUI
import UIKit
import Combine

/// A `TimelineView` that only ticks while its owning tab is selected. When
/// inactive it freezes (an effectively-infinite interval), so a page living in a
/// background TabView tab stops re-running its periodic recompute/redraw.
/// Content still updates on real data changes; it just doesn't burn the timer
/// off-screen.
///
/// The selected-tab check lives HERE rather than at the call site on purpose.
/// Callers used to pass `active: appNav.selected == .stats`, which read
/// `appNav.selected` inside the CALLER's body — so every tab change invalidated
/// the entire calling page (MoreView, TasksView). Reading it in this small
/// wrapper keeps the invalidation scoped to the timeline itself.
struct PausableTimeline<Content: View>: View {
    @Environment(AppNav.self) private var appNav
    let tab: TTab
    let interval: TimeInterval
    @ViewBuilder let content: (Date) -> Content

    var body: some View {
        let active = appNav.selected == tab
        return TimelineView(.periodic(from: .now, by: active ? interval : 1_000_000_000)) { ctx in
            content(ctx.date)
        }
    }
}

/// Owns a repeating clock and hands the current time to a SMALL subtree.
///
/// Two traps this exists to avoid, both of which were measured causing per-tap
/// main-thread stalls:
///
///  1. Holding `@State now` + a ticker on a big page means every tick
///     invalidates that page's ENTIRE body. Scope the state here instead and a
///     tick re-renders only `content`.
///
///  2. A `private let ticker = Timer.publish(…).autoconnect()` STORED on a view
///     is a brand-new, non-equal object every time the view struct is built. A
///     parent re-render therefore makes the view compare as "changed" and
///     SwiftUI re-evaluates its body — even when nothing it displays moved.
///     The publisher lives in `@State` here so it's created once and stays
///     identical across re-renders.
struct LiveClock<Content: View>: View {
    @Environment(AppNav.self) private var appNav
    @State private var now = Date()
    @State private var ticker: Publishers.Autoconnect<Timer.TimerPublisher>
    private let tab: TTab
    private let content: (Date) -> Content

    init(every interval: TimeInterval,
         tab: TTab,
         @ViewBuilder content: @escaping (Date) -> Content) {
        _ticker = State(initialValue: Timer.publish(every: interval, on: .main, in: .common).autoconnect())
        self.tab = tab
        self.content = content
    }

    var body: some View {
        content(now)
            // Guard inside the closure, never in the body: reading
            // `appNav.selected` during body evaluation would re-introduce the
            // per-tab-change invalidation this type exists to prevent.
            .onReceive(ticker) { if appNav.selected == tab { now = $0 } }
    }
}

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
        // Flat 2D card: fill + hairline/state ring only. Shadows and the
        // compositingGroup offscreen pass were removed for GPU speed — every
        // card previously paid an offscreen pass on appear (state is conveyed
        // by the stroke ring, not the shadow).
        return content()
            .background(shape.fill(f))
            .overlay { glowOverlay(shape) }
            .overlay { strokeOverlay(shape, hairline: s, highlight: highlight) }
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
            // Flat hairline border only — no glossy white top-edge reflection.
            shape.strokeBorder(style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : []))
                .foregroundStyle(hairline)
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
                    // No .blur — the radial gradient is already soft; the live
                    // blur pass was an expensive per-card offscreen render.
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
                    // Legible on whatever the circle is filled with: readable
                    // black/white for the gradient or a colored fill, ink on the
                    // neutral surface circle.
                    .foregroundStyle(textColor ?? (gradient ? T.onGradient : (fill?.readableText ?? Color(hex: T.ink))))
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
            .foregroundStyle(textColor ?? (gradient ? T.onGradient : (sky ? T.onAccent : (fill?.readableText ?? Color(hex: T.ink)))))
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
                // Flat chip (was interactive glass — clustered IconBtns were the
                // last "glassEffect updated multiple times per frame" source on
                // Jobs/Stats, and a lone glass button looks off amid flat cards).
                .background(Circle().fill(fill ?? Color(hex: T.surface)))
                .overlay(Circle().strokeBorder(stroke ?? Color(hex: T.border), lineWidth: 1))
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
                        .foregroundStyle(o == selection ? (gradient ? T.onGradient : T.onAccent) : Color(hex: T.ink))
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
    /// Pass "" for a header that carries only its trailing action — the section
    /// is already obvious from context and doesn't need naming.
    let title: String
    var action: String? = nil
    /// Optional tap handler for the trailing action label. When provided the
    /// label renders in sky and becomes an actual button.
    var onAction: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            if !title.isEmpty {
                Text(title)
                    .font(TTypo.h3(18))
                    .foregroundStyle(Color(hex: T.ink))
            }
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
            // No .blur — the radial gradient is already soft; the blur was a
            // full-screen offscreen pass on every appear of Home/Stats/TimeClock.
            .allowsHitTesting(false)
    }
}

// ── PageBackground: the canvas behind every page ────────────────────────────
//
// The single branch point for the app's two canvases, so the 22 call sites don't
// each have to choose: the drifting liquid wash when the user has it on (the
// default), the static ambient canvas when off. Flipping
// ThemeSettings.liquidBackground re-skins the whole app at once.
//
// Named for the job rather than the look, because the look is now conditional —
// this used to be `AmbientBackground`, which described only one of the two.
struct PageBackground: View {
    @Environment(ThemeSettings.self) private var themeSettings

    // ── The three dials that set the canvas's balance ──
    //
    // Target is roughly 50% ground / 30% accent / 20% derived tones.
    //
    // `blobScale` is what buys the 50% ground: nine ellipses of 0.76·0.34·scale²
    // cover about half the canvas at 0.55, so the rest reads as the mode's own
    // near-white or near-black. This is the dial for background-vs-colour —
    // NOT thickness, which only fades pigment and blurs it into haze.
    //
    // `primaryWeighted` then splits that colour 56/22/22 toward the accent,
    // landing close to the 30/20 half of the target.

    /// Smaller, distinct blobs rather than a full-bleed wash. See above.
    private let liquidBlobScale: Double = 0.55

    /// Pigment density. Back UP from the earlier 0.85: with the blobs now small
    /// enough to leave half the canvas bare, the overall colour is set by
    /// coverage, so the pigment can stay dense enough that each blob reads as a
    /// distinct shape — the splash's look — instead of dissolving into haze.
    /// Blur scales with blob size now, so this no longer trades one for the other.
    private let liquidThickness: Double = 1.15

    /// Close to the splash's 3.4, since the ask was for that kind of visible
    /// churn. Also widens travel via LiquidBackground's `amplitude` (1.5x here),
    /// which keeps the smaller blobs roaming the whole screen rather than each
    /// patrolling its own patch.
    private let liquidEnergy: Double = 3.0

    var body: some View {
        if themeSettings.liquidBackground {
            // The underlying paths are 13–29s with no shared factors, so however
            // fast they're driven the field keeps re-mixing rather than visibly
            // looping.
            //
            // Blob hues come from theme.accent by default, with companion and
            // tertiary tones derived inside LiquidBackground — all three stay in
            // the accent's own warm/cool family, so the wash can't clash with it.
            LiquidBackground(base: AmbientCanvas.ground(light: themeSettings.isLightTheme),
                             thickness: liquidThickness,
                             energy: liquidEnergy,
                             blobScale: liquidBlobScale,
                             primaryWeighted: true)
                .ignoresSafeArea()
        } else {
            AmbientCanvas()
        }
    }
}

// ── AmbientCanvas: tinted vertical canvas + faint glow blob ─────────────────
// The non-liquid branch of PageBackground, unchanged from when it was the only
// page paint. Glows show only on light bg presets (they'd muddy a dark canvas),
// gated by ThemeSettings.isLightTheme.
private struct AmbientCanvas: View {
    @Environment(ThemeSettings.self) private var themeSettings

    /// The ground both canvases sit on: the light presets' vertical gradient, or
    /// a dark preset's flat paint. Shared with PageBackground so the liquid wash
    /// is laid over exactly the ground the static canvas would have painted,
    /// and switching the toggle doesn't change what's underneath.
    static func ground(light: Bool) -> AnyShapeStyle {
        light
            ? AnyShapeStyle(LinearGradient(colors: [Color(hex: T.bgGradTop),
                                                    Color(hex: T.bgGradBottom)],
                                           startPoint: .top, endPoint: .bottom))
            : AnyShapeStyle(Color(hex: T.bg))
    }

    var body: some View {
        // Read accent too so a live Customize accent change (which only
        // shifts the glow tint, not isLightTheme) still re-renders here.
        let _ = themeSettings.accent
        let light = themeSettings.isLightTheme
        ZStack {
            Rectangle().fill(AmbientCanvas.ground(light: light))
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
                .foregroundStyle(T.onGradient)
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

// ── FrostedCard: flat 2D card — surface fill, a simple flat hairline border,
// diffuse ambient elevation. Opt-in via .frostedCard().
struct FrostedCard: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    var radius: CGFloat = T.cornerHero
    func body(content: Content) -> some View {
        // Touch the theme so a live Customize background/accent change
        // re-renders every surface immediately (the T.* tokens it
        // reads aren't observable on their own).
        _ = theme.bgPresetId; _ = theme.accent
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        // Flat 2D card — fill + hairline border, no shadow/compositingGroup
        // (removed for GPU speed on content-dense pages).
        return content
            .background(shape.fill(Color(hex: T.surface)))
            .overlay(shape.strokeBorder(Color(hex: T.border), lineWidth: 1))
    }
}

extension View {
    func frostedCard(radius: CGFloat = T.cornerHero) -> some View {
        modifier(FrostedCard(radius: radius))
    }
    /// Same frosted treatment as `frostedCard` but fully pill-shaped (Capsule).
    func frostedPill() -> some View {
        modifier(FrostedPill())
    }
    /// Real frosted glass, for modal surfaces. See `GlassPanel`.
    func glassPanel(radius: CGFloat = 36) -> some View {
        modifier(GlassPanel(radius: radius))
    }
}

// ── GlassPanel: REAL frosted glass, for modal surfaces ─────────────────────
//
// Not to be confused with `frostedCard`, which despite its name paints an
// opaque surface fill with no blur — right for the content-dense pages it's
// used on, wrong for a modal floating over them.
//
// This is the recipe the nav bar uses: a real blur (.ultraThinMaterial) plus a
// surface tint. The tint is the transparency knob — lower lets more through,
// but the blur keeps it properly frosted either way. `.glassEffect(.clear)`
// was tried and reads as barely-there glass, not frost.
//
// Used by the break/lunch banner, the clock PIN pad, and the end-job photo
// prompt, so all three modals read as the same material.
struct GlassPanel: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    /// Default 36 — softer than any card on a page, so a modal reads as a
    /// floating pebble rather than another panel.
    var radius: CGFloat = 36

    func body(content: Content) -> some View {
        // Touch the theme so a live Customize change re-tints the surface (the
        // T.* tokens it reads aren't observable on their own) — same reason
        // FrostedCard does this.
        _ = theme.bgPresetId; _ = theme.accent
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return content
            .background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(Color(hex: T.surface).opacity(0.22))
                }
            }
            // Modals float over content, so they need their own lift.
            .compositingGroup()
            .shadow(color: .black.opacity(0.22), radius: 24, x: 0, y: 10)
    }
}

extension Transaction {
    /// Suppresses the animation a state change would otherwise drive. Wrap a
    /// `.fullScreenCover` / `.sheet` binding change in
    /// `withTransaction(.noAnimation) { … }` to kill the system's slide-up so
    /// the presented view can run its own entrance instead.
    static var noAnimation: Transaction {
        var t = Transaction()
        t.disablesAnimations = true
        return t
    }
}

// ── Modal backdrop: an invisible tap-catcher + a page blur ──────────────────
//
// Separating a modal from the page is done by BLURRING THE PAGE ITSELF
// (`.modalPageBlur`), not by laying anything over it. There's no darkening
// tint, and the scrim itself draws nothing at all.
//
// Why not a material scrim: a material only blurs content inside its own render
// surface. `.ultraThinMaterial` over a `.fullScreenCover`'s clear background
// has nothing behind it to sample — it can't reach across a presentation
// boundary — so it rendered as a flat wash and the page stayed perfectly sharp.
// Fading a material's opacity to get a "slight" blur doesn't work either: it
// cross-fades a fully-blurred layer with the sharp original, which reads as
// haze rather than as a small blur radius. `.blur(radius:)` on the content is
// the only thing that actually gives a gentle blur, and it has to be applied by
// whoever OWNS the content.

/// Full-screen, completely invisible tap target that sits under a modal card so
/// a tap outside it dismisses. Draws nothing — see the note above.
struct ModalScrim: View {
    /// Tap handler. Omit to swallow taps without acting on them (e.g. while an
    /// upload is in flight and dismissal must be blocked).
    var onTap: (() -> Void)?

    var body: some View {
        Rectangle()
            .fill(.clear)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture { onTap?() }
    }
}

extension View {
    /// Blurs THIS content while a modal is over it. Apply to the page behind a
    /// modal — never to the modal itself, which must stay sharp.
    ///
    /// A presented `.fullScreenCover` is a separate presentation, so it is not
    /// affected by this and stays crisp automatically. For an in-hierarchy
    /// overlay, group the page content and blur only that group.
    func modalPageBlur(_ active: Bool) -> some View {
        blur(radius: active ? modalPageBlurRadius : 0)
    }
}

/// How much to blur the page behind a modal. Small on purpose — a little reads
/// as depth, more reads as the page being taken away. THE dial for this.
let modalPageBlurRadius: CGFloat = 3

// Flat 2D pill — the capsule variant of FrostedCard (surface fill + flat
// hairline border + ambient float shadow, with capsule ends).
struct FrostedPill: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    func body(content: Content) -> some View {
        _ = theme.bgPresetId; _ = theme.accent
        let shape = Capsule(style: .continuous)
        // Flat 2D pill — fill + hairline border, no shadow/compositingGroup
        // (removed for GPU speed; these render per-row in the Messages inbox).
        return content
            .background(shape.fill(Color(hex: T.surface)))
            .overlay(shape.strokeBorder(Color(hex: T.border), lineWidth: 1))
    }
}

// ── PageTitle: big bold screen title + optional subtitle (under the header) ─
struct PageTitle: View {
    @Environment(ThemeSettings.self) private var theme
    let title: String
    var subtitle: String? = nil
    var size: CGFloat = 56
    /// Letter spacing. Default is tight (-4) to match the big display titles;
    /// callers can loosen it slightly for smaller titles.
    var tracking: CGFloat = -4
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
                .tracking(tracking)
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
    case indigo, amber, green, sky, magenta, red, neutral
    var bg: Color {
        switch self {
        case .indigo:  return Color(hex: T.pillIndigoBg)
        case .amber:   return Color(hex: T.pillAmberBg)
        case .green:   return Color(hex: T.pillGreenBg)
        case .sky:     return Color(hex: "#DCEAFD")
        case .magenta: return Color(hex: "#FBE0F2")
        case .red:     return Color(hex: "#FDE2E2")
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
        case .red:     return Color(hex: "#DC2626")
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
