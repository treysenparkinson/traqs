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
    // Observed only so a Customize glass toggle re-renders these immediately —
    // glassFill() reads a T.* global that SwiftUI can't track.
    @Environment(ThemeSettings.self) private var theme
    var size: SBoxSize = .md
    var radius: CGFloat? = nil       // override the size's default corner radius
    var fill: Color? = nil           // nil = white SURFACE
    var stroke: Color? = nil         // nil = hairline T.hair
    var dashed: Bool = false
    /// `false` drops the glass bevel for a plain hairline. Long lists of rows
    /// set this — see `flatHairline`.
    var rim: Bool = true
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
        _ = theme.frostedGlass
        let shape = RoundedRectangle(cornerRadius: effectiveRadius, style: .continuous)
        // Amber (paused) wins over active/sky so a paused active card reads as
        // on-break. `active` uses the brand indigo; `sky` keeps the legacy accent.
        let highlight: Color? = amber ? Color(hex: T.amber)
            : (active ? Color(hex: T.accentGradientStart)
                      : (sky ? Color(hex: T.sky) : nil))
        // nil here means "no explicit fill" → real frosted glass, the default for
        // every SBox (which is what the Jobs list is built from). An explicit
        // `fill`, or the amber paused state, keeps its solid tint: those are
        // deliberate state colours and shouldn't be diluted into the glass.
        let f: Color? = fill ?? (amber ? Color(hex: T.amber).opacity(0.06) : nil)
        let s = stroke ?? Color(hex: T.hair)

        // Broken into typed sub-views/helpers so the type-checker stays fast.
        // Flat 2D card: fill + hairline/state ring only. Shadows and the
        // compositingGroup offscreen pass were removed for GPU speed — every
        // card previously paid an offscreen pass on appear (state is conveyed
        // by the stroke ring, not the shadow).
        return content()
            .background {
                // The glass branch gets the rim inside `glassFill()`. The solid
                // branch doesn't go through it, so it takes the rim here —
                // otherwise a state-tinted card would be the one flat-edged
                // surface sitting in a list of glass ones. Scoped to the
                // background, so the blend group wraps the fill only and the
                // card's content never pays for it.
                if let f {
                    shape.fill(f)
                } else {
                    shape.glassFill()
                }
            }
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
            // The glass rim carries the hairline as its middle stop, so this is
            // one stroke, not a rim plus a border painted over it. A dashed box
            // is the exception — a dashed dropzone edge is a state, not glass.
            if dashed {
                shape.strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .foregroundStyle(hairline)
            } else if rim {
                shape.specularRim()
            } else {
                shape.flatHairline(hairline)
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
                    // No .blur — the radial gradient is already soft; the live
                    // blur pass was an expensive per-card offscreen render.
                    .offset(x: 30, y: -28)
            }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .allowsHitTesting(false)
    }
}

// ── Zoom navigation transitions ─────────────────────────────────────────────
//
// The system morph Apple uses when pushing a detail screen: the tapped card
// expands into the destination instead of sliding over it. Needs a source view
// and the destination to share one Namespace, which is awkward here because the
// destination lives on the NavigationStack (JobsHubView) while the cards are
// several views deep (TasksView's sections). Carrying the namespace in the
// environment avoids threading a Namespace.ID parameter through every level.
//
// This works for PUSHES inside a tab. It does not apply tab-to-tab: each tab is
// its own navigation root with nothing shared to morph between — Apple's own apps
// don't morph between tab roots either.
private struct ZoomNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    /// Set by whichever view owns the NavigationStack and its
    /// `navigationTransition(.zoom(...))` destinations.
    var zoomNamespace: Namespace.ID? {
        get { self[ZoomNamespaceKey.self] }
        set { self[ZoomNamespaceKey.self] = newValue }
    }
}

extension View {
    /// Marks this view as the thing a pushed detail screen should zoom OUT of.
    /// `id` must match the id the destination passes to `.navigationTransition`.
    /// A no-op when no namespace is in the environment, so a card used outside a
    /// zoom-enabled stack still renders normally.
    func zoomSource(id: String) -> some View {
        modifier(ZoomSource(id: id))
    }
}

private struct ZoomSource: ViewModifier {
    @Environment(\.zoomNamespace) private var namespace
    let id: String

    func body(content: Content) -> some View {
        if let namespace {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}

// ── HeaderGlassCircle: the one header icon button ───────────────────────────
//
// Every circular icon button in a page header goes through this, so they are all
// Liquid Glass and all EXACTLY the same size. They had drifted to 32 / 34 / 36 /
// 38 across pages, and several were flat chips rather than glass.
//
// The fixed square frame is the point: sizing a circle by padding a glyph makes
// its diameter depend on that glyph's intrinsic width, so a chevron and a
// magnifier end up different sizes. Pass just the glyph.
//
// Also used for the job card's overflow menu, which IS per-row. That's the one
// place to watch: one interactive-glass pass per row down a long list is a cost
// this codebase backed out of once before, so if All Jobs scrolling degrades,
// re-flattening that button is the first move.
/// One number for every header control in the app. Change here, not per site.
///
/// Non-generic on purpose: it's read by both `HeaderGlassCircle` and
/// `HeaderGlassPill`, and a static on a generic type can't be reached without
/// naming a type argument.
// ── Glass controls, and their flat counterparts ────────────────────────────
//
// The Customize "frosted glass" switch means NO GLASS ANYWHERE TRAQS PAINTS. It
// used to govern page content only — cards, list boxes, message bubbles, thread
// rows — leaving the nav bar and every popup frosted, so turning it off produced
// a half-flat app rather than a flat one. Those now follow it too (`GlassPanel`,
// `TRAQSTabBar`). What does NOT follow it is the native `.glassEffect` control,
// below.
//
// BUTTONS are the deliberate exception and stay native Liquid Glass whatever
// the switch says — see `GlassControl` below. Everything else TRAQS paints,
// popups included, flattens. See `GlassPanel`.

/// A native Liquid Glass control.
///
/// ALWAYS glass — the Customize frosted-glass toggle does not reach it. That
/// switch governs the app's own SURFACES: cards, page boxes, message bubbles,
/// list rows, and the rim on them. Controls are Apple's material, not ours, and
/// a flat app full of native glass buttons is a coherent look; a flat app whose
/// buttons have also gone flat just looks unfinished.
///
/// Carries no `@Environment` for exactly that reason, which also makes it safe
/// in an environment-less host — see `OverlayWindowController`, where a
/// `HeaderGlassCircle` reading the theme once crashed the Messages header.
struct GlassControl<S: InsettableShape>: ViewModifier {
    let shape: S
    /// `.interactive()` gives the glass its press response. Off for decorative
    /// chrome that isn't a button (the tab bar's drag label).
    var interactive: Bool = true
    /// Colours the glass, and carries over as the flat fill — a destructive
    /// control has to stay red with the glass switched off.
    var tint: Color? = nil

    func body(content: Content) -> some View {
        var g: Glass = .regular
        if let tint { g = g.tint(tint) }
        if interactive { g = g.interactive() }
        return content.glassEffect(g, in: shape)
    }
}

/// The native `.glass` BUTTON STYLE. Separate from `GlassControl` because
/// `.buttonStyle(.glass)` supplies the chrome itself — there's no shape to hand
/// it, so it can't be swapped by changing a background.
///
/// Always glass, for the same reason as `GlassControl`.
struct GlassCircleButton: ViewModifier {
    func body(content: Content) -> some View {
        content.buttonStyle(.glass).buttonBorderShape(.circle)
    }
}

extension View {
    /// Liquid Glass when the frosted-glass setting is on, flat when it's off.
    func glassControl<S: InsettableShape>(in shape: S, interactive: Bool = true,
                                          tint: Color? = nil) -> some View {
        modifier(GlassControl(shape: shape, interactive: interactive, tint: tint))
    }
    /// The shared frosted SURFACE — blur + tint on, flat `T.surface` off — for
    /// backgrounds that hand-rolled `.ultraThinMaterial` instead of going
    /// through `glassFill()`. Pass `tint: 0` to keep a site that had no tint of
    /// its own looking exactly as it did.
    ///
    /// `rim: true` also carries the glass edge, replacing the
    /// `glassFill()` + `specularRim()` pairs that were written out by hand. Those
    /// pairs looked right but couldn't FLIP: neither helper observes anything,
    /// so a view built from them kept its glass until something else happened to
    /// re-render it. Going through here fixes that for every one of them at once.
    func glassSurface<S: InsettableShape>(in shape: S,
                                          tint: Double = glassSurfaceTint,
                                          rim: Bool = false) -> some View {
        modifier(GlassSurface(shape: shape, tint: tint, rim: rim))
    }
    /// `.buttonStyle(.glass) + .buttonBorderShape(.circle)`, with a flat fallback.
    func glassCircleButton() -> some View {
        modifier(GlassCircleButton())
    }
}

/// `GlassControl`'s surface counterpart: a frosted BACKGROUND that flattens
/// with the toggle. Self-observing, so call sites don't each need the theme in
/// their environment — most of them don't have it.
struct GlassSurface<S: InsettableShape>: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    let shape: S
    var tint: Double = glassSurfaceTint
    /// Add the app-wide glass edge — which collapses to the flat hairline with
    /// the toggle. On for surfaces that were hand-rolling `glassFill()` plus
    /// their own `specularRim()`; off for ones whose caller strokes its own
    /// border, or that sit inside something already edged.
    var rim: Bool = false

    func body(content: Content) -> some View {
        // The full observation set, matching FrostedCard: a live Customize
        // change to the preset, the accent OR the glass switch has to re-render
        // this, and none of the T.* tokens it reads are observable on their own.
        _ = theme.bgPresetId; _ = theme.accent; _ = theme.frostedGlass
        return content
            .background {
                if T.glassEnabled {
                    ZStack {
                        shape.fill(.ultraThinMaterial)
                        if tint > 0 { shape.fill(Color(hex: T.surface).opacity(tint)) }
                    }
                } else {
                    shape.fill(Color(hex: T.surface))
                }
            }
            .overlay { if rim { shape.specularRim() } }
    }
}

enum HeaderControl {
    /// Height AND width of every header control — circles and pills alike, so a
    /// pill differs from a circle only in how long it is, never in how thick.
    /// Bumped 38 -> 42 for a slightly larger touch target.
    static let diameter: CGFloat = 42
}

struct HeaderGlassCircle<Content: View>: View {
    /// Kept as an alias so existing call sites reading it still compile.
    static var diameter: CGFloat { HeaderControl.diameter }

    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(width: Self.diameter, height: Self.diameter)
            .glassControl(in: Circle())
    }
}

/// Capsule sibling of `HeaderGlassCircle`, for a header control that carries a
/// label as well as a glyph. Same height, so it lines up with the round buttons
/// on either side of it, and the same glass treatment.
struct HeaderGlassPill<Content: View>: View {
    /// Pass a fixed width when the label's text changes between states — the Jobs
    /// header is deliberately dead-stable across a mode flip, and a pill that
    /// resizes reflows every control beside it.
    var width: CGFloat? = nil

    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(width: width, height: HeaderControl.diameter)
            .glassControl(in: Capsule())
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
    /// Unfilled remainder. `progressTrack`, not `T.hair`: both are theme-aware,
    /// but this is a chart track rather than a border, and the border colour is
    /// tuned to sit on a surface — not to read through frosted glass.
    var track: Color = Color(hex: T.progressTrack)

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
            if let fill {
                // Explicit fill = a deliberate solid chip; leave it alone.
                TIconView(icon: icon, size: size, color: iconColor)
                    .padding(pad)
                    .background(Circle().fill(fill))
                    .overlay(Circle().strokeBorder(stroke ?? Color(hex: T.border), lineWidth: 1))
            } else {
                // Glass, and sized by HeaderGlassCircle so these match every other
                // header control. They were flat chips because clustered IconBtns
                // were the last "glassEffect updated multiple times per frame"
                // source on Jobs/Stats — glass again by request; that's the row to
                // look at if the warning comes back.
                HeaderGlassCircle {
                    TIconView(icon: icon, size: size, color: iconColor)
                }
            }
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

    // Look lives in LiquidTuning, shared with the splash so the load-up resolves
    // into the same background it was loading rather than a different one.

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
                             opacity: LiquidTuning.pageOpacity,
                             thickness: LiquidTuning.thickness,
                             energy: LiquidTuning.pageEnergy,
                             blobScale: LiquidTuning.blobScale,
                             saturation: LiquidTuning.saturation,
                             primaryWeighted: LiquidTuning.primaryWeighted)
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
/// A primary action rendered as Liquid Glass instead of solid paint: a capsule
/// of glass TINTED with the accent, so it still reads as the accent-coloured
/// button it was, just made of the same material as everything around it.
///
/// Tinted, never clear. An untinted glass CTA is only as visible as whatever
/// happens to be behind it, which for the one button a screen exists to get you
/// to press is the wrong trade.
///
/// Falls back to the solid brand gradient when frosted glass is off — that IS
/// the flat look for a CTA, so nothing is lost with the toggle down.
struct GlassCTA<S: InsettableShape>: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    /// Capsule for a normal button; `Circle()` for the PIN pad's confirm key,
    /// which is a round key and not a pill.
    let shape: S
    /// `nil` = the app accent, and the brand gradient as its flat fallback —
    /// the primary-action look.
    ///
    /// A STATE-coloured button passes its own instead: Clock Out and STOP are
    /// red because red is what they mean, and tinting them with the accent
    /// would turn "end this" into just another blue button.
    var tint: Color? = nil

    func body(content: Content) -> some View {
        // Accent only — the toggle doesn't reach buttons. `theme.accent` is
        // still observed because a live Customize accent change has to re-tint
        // this immediately, and T.accent isn't observable on its own.
        _ = theme.accent
        return content.glassEffect(.regular.tint(tint ?? Color(hex: T.accent)).interactive(),
                                   in: shape)
    }
}

/// The legible label colour for a `glassCTA` of this tint — judged against the
/// FLAT colour the glass is tinted with, not against a gradient.
func glassCTALabel(_ tint: Color? = nil) -> Color {
    (tint ?? Color(hex: T.accent)).readableText
}

extension View {
    /// See `GlassCTA`. The glass counterpart of a `GradientCTA` background.
    func glassCTA() -> some View { glassCTA(in: Capsule()) }
    /// Same, with a state colour and/or a shape of your own.
    func glassCTA<S: InsettableShape>(in shape: S, tint: Color? = nil) -> some View {
        modifier(GlassCTA(shape: shape, tint: tint))
    }
    /// Capsule, with a state colour — Clock Out red, STOP red.
    func glassCTA(tint: Color?) -> some View { glassCTA(in: Capsule(), tint: tint) }

    /// A PIN-pad key's paint. Both branches are glass; what differs is weight.
    ///
    /// Confirm takes the TINTED CTA glass — it's the primary action, and the
    /// one key that commits. The digits and the delete key take neutral,
    /// untinted glass, so the pad reads as one material without twelve keys
    /// competing with the one that submits.
    ///
    /// One helper so the two branches can't drift into different sizes.
    @ViewBuilder
    func glassKeyBackground(filled: Bool) -> some View {
        if filled {
            glassCTA(in: Circle())
        } else {
            glassControl(in: Circle())
        }
    }

    /// Picks a CTA's paint: tinted glass when asked for it, the solid brand
    /// gradient otherwise. One place, so a glass CTA and a solid one can never
    /// drift into different capsule shapes or paddings.
    @ViewBuilder
    func glassOrGradientCapsule(glass: Bool) -> some View {
        if glass { glassCTA() }
        else     { background(Capsule().fill(T.brandGradient())) }
    }
}

struct GradientCTA<Label: View>: View {
    /// Observed so the glass/solid branch below re-renders when the Customize
    /// toggle or accent changes — the T.* tokens aren't observable on their own.
    @Environment(ThemeSettings.self) private var theme
    /// Render as tinted Liquid Glass rather than solid gradient — see `GlassCTA`.
    /// Opt-in per button, not the default: a screen full of glass CTAs has no
    /// primary action left, so this is for the ONE button a page is about.
    var glass: Bool = false
    var disabled: Bool = false
    var dimmed: Bool = false
    var fullWidth: Bool = true
    var verticalPadding: CGFloat = 13
    var action: () -> Void
    @ViewBuilder var label: () -> Label
    @State private var pressed = false

    var body: some View {
        _ = theme.accent
        // Glass is tinted with the flat accent rather than the gradient, so the
        // label is judged against THAT, not against the gradient's two stops.
        return Button(action: action) {
            label()
                .foregroundStyle(glass ? T.onAccent : T.onGradient)
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .padding(.vertical, verticalPadding)
                .padding(.horizontal, fullWidth ? 0 : 20)
                .glassOrGradientCapsule(glass: glass)
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
    /// `false` drops the glass bevel for a plain hairline — see `flatHairline`.
    var rim: Bool = true
    func body(content: Content) -> some View {
        // Touch the theme so a live Customize background/accent change
        // re-renders every surface immediately (the T.* tokens it
        // reads aren't observable on their own).
        // frostedGlass touched too: glassFill() reads the T.* global, which
        // SwiftUI can't see as a dependency, so the observation has to happen here.
        _ = theme.bgPresetId; _ = theme.accent; _ = theme.frostedGlass
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        // Real frosted glass, the same recipe as the modals — see GlassPanel and
        // `glassSurfaceTint`. This is what carries the app-wide glass look: it
        // backs ~50 surfaces, so changing it here beats converting each.
        //
        // Deliberately WITHOUT GlassPanel's compositingGroup + shadow. Those
        // force an offscreen pass per surface, and this renders per-row down long
        // lists (All Jobs can be the whole org's job list) where a modal renders
        // once. The hairline border does the lifting instead — cheap, and it
        // matters more on glass than it did on an opaque fill, since it's what
        // keeps a card's edge findable against a moving background.
        return content
            .background(shape.glassFill())
            // ONE stroke: the glass rim, which carries the flat hairline as its
            // middle stop. This used to be a separate opaque `T.border` overlay
            // painted straight over the rim, which is why cards had no visible
            // glass edge. Still a plain stroke with no blend mode, so the note
            // above about avoiding offscreen passes holds.
            .overlay(rim ? AnyView(shape.specularRim()) : AnyView(shape.flatHairline()))
    }
}

extension View {
    /// `rim: false` for rows in a long list — the glass bevel is for cards.
    func frostedCard(radius: CGFloat = T.cornerHero, rim: Bool = true) -> some View {
        modifier(FrostedCard(radius: radius, rim: rim))
    }
    /// Same frosted treatment as `frostedCard` but fully pill-shaped (Capsule).
    func frostedPill(rim: Bool = true) -> some View {
        modifier(FrostedPill(rim: rim))
    }
    /// The frosted treatment for a sheet that runs OFF the bottom of the screen:
    /// rounded at the top two corners, square at the bottom.
    ///
    /// Fills the view's own frame, so the view has to REACH the bottom edge —
    /// don't reserve space above a floating tab pill and expect the fill to
    /// stretch into it. Let the scroll area run full height and pad its content
    /// instead (see MessagesView).
    func frostedSheetTop(radius: CGFloat = T.cornerLg) -> some View {
        modifier(FrostedSheetTop(radius: radius))
    }
    /// Real frosted glass, for modal surfaces. See `GlassPanel`.
    func glassPanel(radius: CGFloat = 46) -> some View {
        modifier(GlassPanel(radius: radius))
    }
}

// ── FrostedSheetTop: a frosted panel anchored to the bottom of the screen ──
//
// One continuous surface with only its TOP corners rounded — the shape a list
// takes when it fills the rest of the page rather than sitting in it as a card.
// Contrast with `frostedPill`, which gives every row its own floating shape.
//
// The glass rim is MASKED to the top of the sheet. It belongs on the panel's
// own edge — the lip you can actually see — and nowhere else: this sheet runs
// off the bottom of the screen, so an unmasked rim would draw its dark side
// bands down the full height of the page and close with a lit lip across the
// very bottom edge, neither of which is an edge anyone sees as an edge.
//
// Note this is the SHEET's border, not the rows'. The threads inside it are
// separated by hairlines and carry no edge of their own — a lit rim per row is
// exactly the noise `flatHairline` exists to avoid.
struct FrostedSheetTop: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    var radius: CGFloat = T.cornerLg
    /// How far down the rim stays at full strength before it starts to go, and
    /// how long it takes to disappear. Sized off the corner arc so the lit lip
    /// always covers the whole curve and a little of the straight below it.
    private var rimSolid: CGFloat { radius }
    private var rimFade: CGFloat { radius * 1.6 }

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: radius,
                               bottomLeadingRadius: 0,
                               bottomTrailingRadius: 0,
                               topTrailingRadius: radius,
                               style: .continuous)
    }

    func body(content: Content) -> some View {
        // Same observation FrostedCard needs: glassFill() reads the T.* globals,
        // which SwiftUI cannot see as dependencies, so a live Customize change
        // would otherwise leave this surface stale.
        _ = theme.bgPresetId; _ = theme.accent; _ = theme.frostedGlass
        return content
            // The content lives INSIDE the sheet, so it has to be cut to the same
            // shape. A ScrollView clips to its own rectangular bounds, which
            // leaves the two top corners uncovered: rows and their separator
            // hairlines kept drawing square into the curve and spilled past it.
            .clipShape(shape)
            .background(alignment: .top) {
                shape
                    .glassFill()
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .top) { topRim }
    }

    /// The app's glass edge, cut off below the lip. `specularRim` draws one
    /// vertical gradient around a CLOSED shape — lit top, dark sides, lit bottom
    /// — which assumes you can see all of it. Here only the top is on screen, so
    /// the rest is masked away rather than left to band down the page.
    ///
    /// Collapses to the flat hairline with frosted glass switched off, same as
    /// every other surface.
    private var topRim: some View {
        shape
            .specularRim()
            .mask(alignment: .top) {
                VStack(spacing: 0) {
                    Rectangle().fill(.black).frame(height: rimSolid)
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: rimFade)
                    Spacer(minLength: 0)
                }
            }
            .allowsHitTesting(false)
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
/// Surface tint laid over the blur on EVERY frosted-glass surface — modals,
/// cards, pills. The transparency knob: lower lets more of the page through, but
/// the blur keeps it frosted either way. One constant so the whole app's glass
/// stays one material.
///
/// Watch this value now that pages have the liquid wash behind them. A modal
/// floats over an already-blurred page, but a card sits directly on vivid moving
/// colour while holding dense text — if body text starts to swim, this is the
/// first thing to raise (0.35–0.45 makes cards notably more solid without
/// turning them opaque).
let glassSurfaceTint: Double = 0.22

/// The same knob for POPUPS only — modal panels, the break/lunch banner, the
/// end-job photo prompt, the clock PIN pad.
///
/// A quarter thinner than `glassSurfaceTint` (0.22 → 0.165), deliberately: a
/// modal already floats over a page that `ModalScrim` has dimmed and blurred,
/// so it doesn't need to fight for legibility the way a card sitting directly
/// on the moving liquid wash does. Letting more of that blurred page through is
/// what makes a popup read as frosted rather than as a solid sheet — the frost
/// is the separation, the tint was only ever a crutch.
///
/// Cards keep `glassSurfaceTint`. Do not collapse these back into one value:
/// they diverge for a reason, and the reason is what's above them.
let modalSurfaceTint: Double = glassSurfaceTint * 0.75

// `InsettableShape`, not `Shape`: the specular rim below is drawn with
// `strokeBorder`, which insets by half the line width so the stroke lands
// INSIDE the fill instead of straddling its edge. Every caller was already
// insettable (they all stroke their own borders), so this narrowed nothing.
extension InsettableShape {
    /// Frosted-glass fill for a shape — a drop-in for `.fill(Color(hex: T.surface))`
    /// on containers that build their own background and border rather than going
    /// through `.frostedCard()`. Swapping just the fill leaves their existing
    /// overlays, strokes and shadows untouched.
    ///
    /// This is the FILL only. The glass edge is a separate overlay — see
    /// `specularRim()` — because it has to sit above the surface, not inside
    /// its background where the call site's own border would cover it.
    ///
    /// For containers only. Buttons, text fields, chips and status marks keep
    /// solid fills: they need to read as opaque objects ON the glass, and an input
    /// you're typing into shouldn't have moving colour behind the caret.
    /// With glass switched off this paints the flat opaque surface colour — white
    /// on light presets, near-black on Charcoal — and drops the rim with it,
    /// which is the point: no glass, no glass edge.
    @ViewBuilder
    func glassFill() -> some View {
        if T.glassEnabled {
            ZStack {
                fill(.ultraThinMaterial)
                fill(Color(hex: T.surface).opacity(glassSurfaceTint))
            }
        } else {
            fill(Color(hex: T.surface))
        }
    }
}

// ── The app-wide glass edge ────────────────────────────────────────────────
//
// One recipe, used by every frosted surface: cards, pills, modal panels, and
// the controls that sit on them. A glare across the top lip, a shadowed
// underside, then the bottom lip lit again — light entering the top of a bubble
// of glass and bouncing back out of the bottom of it.
//
// Both lips lit is the whole trick. Lighting one side and shadowing the
// other reads as a bevel under a single lamp; lighting top AND bottom reads as
// a lens. See `T.rimTop` / `T.rimBot` for the dials.
//
// The lips are SHORT — `T.rimLip` at each end — so the left and right edges
// show the dark `T.rimSide` band down nearly their whole length. That contrast
// is what sells it: a rim that is bright the whole way round reads as paint,
// where a bright top and bottom against dark sides reads as light caught on a
// curve. It's also what makes the edge visible at all on the White preset,
// where the old faint `T.border` down the sides left cards looking flat.
//
// Plain blending, deliberately. That means no compositing group, so this is
// cheap enough for the surfaces that render per-row down long lists.
//
// This stroke REPLACES a surface's flat hairline rather than joining it. The
// hairline (`T.border`) is opaque and was drawn as an overlay on top of the
// rim, covering 83% of it — which is why the rim only ever showed on
// GlassPanel, the one surface with no hairline. So the hairline colour is now
// the mesh's outer columns: the edge stays findable all the way round (the
// whole reason the hairline existed) and there is only ever ONE stroke.
extension InsettableShape {
    /// The plain edge — the flat hairline on its own, no bevel. For surfaces
    /// that opt OUT of the glass look via `rim: false`: long lists of rows,
    /// where a lit edge on every row reads as noise rather than as material.
    /// The rim is for cards you're meant to look AT.
    func flatHairline(_ color: Color = Color(hex: T.border), lineWidth: CGFloat = 1) -> some View {
        strokeBorder(color, lineWidth: lineWidth)
            .allowsHitTesting(false)
    }

    /// The glass rim: a white glare across the top lip, a darker band down the
    /// left and right edges, and the bottom lip lit again. Use INSTEAD of a
    /// `T.border` / `T.hair` stroke, never on top of one.
    ///
    /// One vertical gradient. The lips occupy only `T.rimLip` at each end, so
    /// the middle — which is what the two side edges show along nearly their
    /// whole length — is the dark `T.rimSide` band. That contrast is what makes
    /// the lips read as light caught on an edge rather than as paint.
    ///
    /// Collapses to the flat hairline when the Customize frosted-glass setting
    /// is off. That switch means "no glass ANYWHERE", and a lit bevel on a flat
    /// opaque card is the most obviously glassy thing left once the blur is
    /// gone — it was the one piece the old page-content-only toggle missed.
    ///
    /// `always: true` opts out, for the prompting popups. They stay frosted
    /// whatever the setting says (see `GlassPanel`), so their edge has to stay
    /// lit too — a flat hairline around real glass is worse than either.
    ///
    /// NOTE for callers: `T.glassEnabled` is a plain global, invisible to
    /// SwiftUI. Any view using this must also touch `theme.frostedGlass` so it
    /// re-renders when the toggle flips — same as `FrostedCard` and `SBox`.
    @ViewBuilder
    func specularRim(lineWidth: CGFloat = T.rimWidth, always: Bool = false) -> some View {
        if T.glassEnabled || always {
            strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: Color(hex: T.highlightStroke).opacity(T.rimTop),
                              location: 0.00),
                        .init(color: Color(hex: T.rimSide), location: T.rimLip),
                        .init(color: Color(hex: T.rimSide), location: 1 - T.rimLip),
                        .init(color: Color(hex: T.highlightStroke).opacity(T.rimBot),
                              location: 1.00),
                    ],
                    startPoint: .top, endPoint: .bottom),
                lineWidth: lineWidth)
            .allowsHitTesting(false)
        } else {
            flatHairline(lineWidth: lineWidth)
        }
    }
}

extension View {
    /// Puts the glass rim on this view. The shape must match the surface's own —
    /// a rim tracing a different radius than the fill under it is worse than no
    /// rim at all.
    func glassRim<S: InsettableShape>(_ shape: S, lineWidth: CGFloat = T.rimWidth,
                                      always: Bool = false) -> some View {
        overlay(shape.specularRim(lineWidth: lineWidth, always: always))
    }

    /// Convenience for the common case: a continuous rounded rect.
    func glassRim(radius: CGFloat, lineWidth: CGFloat = T.rimWidth,
                  always: Bool = false) -> some View {
        glassRim(RoundedRectangle(cornerRadius: radius, style: .continuous),
                 lineWidth: lineWidth, always: always)
    }
}

// ── The app's one modal entrance ───────────────────────────────────────────
//
// Every popup swells into place at the centre: 0.88 → 1 with a matching fade,
// on one spring. Used by the end-job attachment prompt, the lunch/break shout,
// and the clock PIN pad, so all three arrive with the same weight.
//
// Two rules for call sites, both learned the hard way:
//
//  1. Nothing may slide. These are centred modals; anything that moves in from
//     an edge reads as arriving from outside the screen rather than opening
//     where you're looking.
//  2. THE PRESENTER MUST NOT ANIMATE. The modal owns its whole entrance and
//     exit; the parent only adds or removes it. Concretely, the presenting site
//     needs all three of:
//
//       - `.transition(.identity)`, since SwiftUI's default insertion is a fade
//         that would run alongside this spring;
//       - NO `.animation(_:value:)` on the presenting flag. That modifier
//         applies to the WHOLE subtree, so it also springs the page blur and
//         the layout underneath — which reads as glitching, not as a popup;
//       - every write to the flag wrapped in `withTransaction(.noAnimation)`.
//
//     A `.fullScreenCover` gets this for free from `withTransaction(.noAnimation)`
//     on its binding, which is why the end-job attachment prompt has always
//     looked right and the in-hierarchy modals had to be brought to match it.
//
//  3. Exit is `modalPopDismiss`, NOT a removal transition — the modal animates
//     itself out and only then lets the presenter tear it down.
let modalPopAnimation: Animation = .spring(response: 0.34, dampingFraction: 0.72)

struct ModalPop: ViewModifier {
    /// Flipped true in the modal's `onAppear`, inside `withAnimation(modalPopAnimation)`.
    let shown: Bool
    func body(content: Content) -> some View {
        content
            .scaleEffect(shown ? 1 : 0.88)
            .opacity(shown ? 1 : 0)
    }
}

extension View {
    func modalPop(_ shown: Bool) -> some View { modifier(ModalPop(shown: shown)) }
}

/// The exit curve, and how long a presenter must wait before tearing the modal
/// down. These two MUST stay in step — clear the flag early and the modal
/// vanishes mid-animation.
let modalPopExitAnimation: Animation = .easeOut(duration: 0.18)
let modalPopExitNanos: UInt64 = 180_000_000

/// Runs the shared modal exit: shrink and fade out, then hand back to the
/// presenter once the animation has actually finished.
///
/// The presenter's callback MUST clear its flag inside
/// `withTransaction(.noAnimation)` — see the note on `modalPopAnimation`.
@MainActor
func modalPopDismiss(_ shown: @escaping (Bool) -> Void,
                     then finish: @escaping () -> Void) {
    withAnimation(modalPopExitAnimation) { shown(false) }
    Task {
        try? await Task.sleep(nanoseconds: modalPopExitNanos)
        finish()
    }
}

/// The house modal radius — the clock PIN pad's, which set the shape. Still
/// softer than a card (T.cornerHero, 42), so a modal reads as a floating pebble
/// rather than another panel. Named so a panel that has to CLIP its content to
/// its own shape can't drift out of step with the glass drawn around it.
let modalPanelRadius: CGFloat = 46

struct GlassPanel: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    /// See `modalPanelRadius`.
    var radius: CGFloat = modalPanelRadius

    func body(content: Content) -> some View {
        // Touch the theme so a live Customize change re-tints the surface (the
        // T.* tokens it reads aren't observable on their own) — same reason
        // FrostedCard does this. `frostedGlass` included: the branch below reads
        // `T.glassEnabled`, a plain global SwiftUI cannot see as a dependency.
        _ = theme.bgPresetId; _ = theme.accent; _ = theme.frostedGlass
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return content
            // FOLLOWS THE TOGGLE. Popups used to be exempt on the grounds that
            // the glass is what tells you a modal is floating over the page
            // rather than being part of it — but with the switch off they were
            // the most obviously glassy thing left, and "flat" read as
            // half-applied. What says "floating" in the flat branch is the same
            // thing that says it for a system alert: the page behind is blurred
            // (`modalPageBlur`) and the panel carries a shadow the page cannot.
            //
            // Deliberately NOT `glassFill()`: that paints `glassSurfaceTint`,
            // where a modal wants `modalSurfaceTint` (see both).
            .background {
                ZStack {
                    if T.glassEnabled {
                        shape.fill(.ultraThinMaterial)
                        shape.fill(Color(hex: T.surface).opacity(modalSurfaceTint))
                    } else {
                        shape.fill(Color(hex: T.surface))
                    }
                }
            }
            // The app-wide glass edge, which collapses to the flat hairline with
            // the toggle. Applied before the group below so it is inside the
            // shadow's compositing group rather than casting one of its own.
            .overlay(shape.specularRim())
            // Modals float over content, so they need their own lift — and in
            // the flat branch it is doing most of the separating. Cards
            // deliberately skip this — see FrostedCard.
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

// ── Popups that hold a text field ───────────────────────────────────────────
//
// Two rules, and the first one is the non-obvious one.
//
// 1. NEVER SIZE A PANEL WITH `ViewThatFits` IF IT HOLDS A TEXT FIELD.
//    `ViewThatFits` picks a branch from the height it's offered, and the
//    keyboard is a safe-area region — so the instant the keyboard opens, the
//    offered height drops by ~300pt and the branch flips. Flipping branches
//    rebuilds everything inside with FRESH IDENTITIES, and a rebuilt
//    `TextField` loses `@FocusState`. The keyboard closes, the height comes
//    back, the branch flips back, and the panel oscillates forever — the field
//    reads as simply refusing the keyboard. Use `HugScroll` below instead: one
//    ScrollView, one identity, no branch to flip.
//
// 2. THEN LET SWIFTUI DO THE LIFTING. With the branch swap gone, ordinary
//    keyboard avoidance is safe, and it beats anything hand-rolled — it moves
//    the card up AND scrolls the focused field into view inside the scroller.
//    So DON'T ignore `.keyboard`, and don't offset the card by a measured
//    keyboard height. Ignore the container inset at the sides and bottom only,
//    so the card keeps the full width while the top inset still caps it just
//    under the Dynamic Island:
//
//        ZStack { ModalScrim { … }; card.modalPop(appear) }
//            .frame(maxWidth: .infinity, maxHeight: .infinity)
//            .ignoresSafeArea(.container, edges: [.horizontal, .bottom])
//
//    The card then fills whatever is left between the island and the keyboard,
//    and `HugScroll` scrolls the overflow. The panel stays WHOLE while it does
//    — no hiding fields to make room. That was tried and reverted: collapsing a
//    form around its focused field means animating a resize against the
//    keyboard's own animation, and the two never quite agree.
//
// 3. GIVE THE FIELD A DONE. A `.numberPad` has no Return key and a
//    `TextField(axis: .vertical)` spends Return on a newline, so neither can
//    put its own keyboard away. Both popups hang a right-aligned Done off the
//    field via `ToolbarItemGroup(placement: .keyboard)`, which iOS renders as
//    an accessory bar on the keyboard. Hanging it off the field is only safe
//    because `HugScroll` builds its content once — under a `ViewThatFits` it
//    would be declared twice. `ModalScrim` and `tapToDismissKeyboard` are the
//    other two ways out.

/// A ScrollView that HUGS its content instead of taking every point it's
/// offered — a panel wrapped in a bare one grows to the full screen even for a
/// three-field form.
///
/// This is the replacement for `ViewThatFits(in: .vertical) { content;
/// ScrollView { content } }` on any panel holding a text field: same "scroll
/// only when it doesn't fit" behaviour, but out of a SINGLE view, so nothing is
/// ever rebuilt and focus is never dropped. See rule 1 above.
struct HugScroll<Content: View>: View {
    @ViewBuilder var content: () -> Content

    /// The content's natural height, which caps the scroller. Measured on the
    /// content, whose height doesn't depend on that cap — so there's no loop.
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        ScrollView {
            content()
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        // A MAX, not a fixed height: when the parent offers less (keyboard up),
        // the scroller takes the smaller amount and scrolls instead. Greedy for
        // the one frame before the measurement lands, which `ModalPop` spends
        // at opacity 0 anyway.
        //
        // NOT animated. If a caller ever animates content in or out, this
        // measurement interpolates frame by frame on its own and the cap tracks
        // it within one frame. A second animation on the cap would make it
        // CHASE that value instead — content finishes moving, then the panel
        // catches up behind it, which reads as a two-stage resize.
        .frame(maxHeight: contentHeight == 0 ? .infinity : contentHeight)
        // Content shrinking under a scrolled-down offset otherwise leaves the
        // view parked mid-content and reads as a jump.
        .defaultScrollAnchor(.top)
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
    }
}

extension View {
    /// Puts the keyboard away when the panel's own face is tapped — anywhere
    /// that isn't a control.
    ///
    /// A BACKGROUND, deliberately. The same gesture laid OVER the content
    /// (`.contentShape(Rectangle()).onTapGesture`) swallows the tap that
    /// focuses a `TextField`, so the field can never take the keyboard in the
    /// first place. Behind the content, the fields are hit-tested first and
    /// only taps on empty panel reach this.
    func tapToDismissKeyboard(_ dismiss: @escaping () -> Void) -> some View {
        background {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(perform: dismiss)
        }
    }
}

// Flat 2D pill — the capsule variant of FrostedCard (surface fill + flat
// hairline border + ambient float shadow, with capsule ends).
struct FrostedPill: ViewModifier {
    @Environment(ThemeSettings.self) private var theme
    var rim: Bool = true
    func body(content: Content) -> some View {
        _ = theme.bgPresetId; _ = theme.accent; _ = theme.frostedGlass
        let shape = Capsule(style: .continuous)
        // The capsule variant of FrostedCard — same glass recipe, and the rim
        // rides along inside `glassFill()`, so a pill and a card are the same
        // material by construction.
        return content
            .background(shape.glassFill())
            .overlay(rim ? AnyView(shape.specularRim()) : AnyView(shape.flatHairline()))
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
        .background(
            Capsule().fill(kind.bg)
                // Thinner than the house 1.2: a chip is ~20pt tall, and the full
                // width reads as a bright outline at that size rather than as an
                // edge catching light.
                .overlay(Capsule().specularRim(lineWidth: 0.8))
        )
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
