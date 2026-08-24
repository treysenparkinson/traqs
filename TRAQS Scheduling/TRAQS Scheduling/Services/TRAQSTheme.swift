import SwiftUI

// MARK: - TRAQS Light · Brand Tokens
// Light-mode is the canonical theme (per the wireframes).
// Tokens marked `var` may be overridden at runtime by ThemeSettings; tokens marked `let`
// are brand constants that the customize UI cannot retint.

enum T {
    // ── Theme-able surface tokens (ThemeSettings can override) ─────────────
    static var bg       = "#F4F6FA"   // paper — app canvas (cool light gray)
    static var surface  = "#FFFFFF"   // default card surface (white)
    static var card     = "#FFFFFF"   // raised / active card (white, distinguished by border + shadow)
    static var border   = "#E6E8EE"   // hairline borders, dividers, chart tracks
    static var text     = "#0B0B0C"   // ink — primary text, the wordmark
    static var muted    = "#6E6E73"   // tertiary text, inactive icons
    static var accent   = "#3B82F6"   // sky — primary interactive accent

    // ── Brand-locked tokens ────────────────────────────────────────────────
    static let paper    = "#F4F6FA"
    /// Primary text. Aliased to `T.text` so a Black/Charcoal background
    /// flips every "ink" caller to the bg preset's light text color
    /// instead of staying near-black and turning invisible.
    static var ink: String { text }
    /// Hairline borders. Aliased to `T.border` for the same reason: a
    /// light hairline (#E6E8EE) on a black canvas reads as a glowing
    /// outline instead of a divider.
    static var hair: String { border }
    /// CTA / "selected" / NOW / live indicator. Mirrors `T.accent` so the
    /// user's chosen accent retints every button in the app.
    static var sky: String { accent }
    static let magenta  = "#FF1FB4"   // department · Layout · canonical job color · profile avatar
    static let cyan     = "#06B6D4"   // department · Wire
    static let yellow   = "#EAB308"   // department · Cut
    static let lavender = "#A78BFA"   // department · Inspect (per wireframe palette)
    static let amber    = "#F59E0B"   // department · Repair (per wireframe palette)
    static let green    = "#10B981"   // status · finished / on-pace
    static let orange   = "#F97316"   // status · blocked / overdue
    static let red      = "#EF4444"   // status · destructive / callback
    static let danger   = "#EF4444"   // legacy alias for red

    // Engineering legacy (now lavender so EngineeringCard stays compatible)
    static let eng      = "#A78BFA"

    // Status / priority legacy aliases — kept so existing call sites compile.
    static let statusNotStarted = "#94A3B8"
    static let statusPending    = "#A78BFA"
    /// "In Progress" status — the only blue in the status palette, so it
    /// follows the user-chosen accent. The other statuses stay
    /// semantic-fixed (lavender pending, yellow on-hold, green done).
    static var statusInProgress: String { accent }
    static let statusOnHold     = "#EAB308"
    static let statusFinished   = "#10B981"

    static let priLow    = "#10B981"
    static let priMedium = "#EAB308"
    static let priHigh   = "#EF4444"

    // ── Corner radii (revamp: rounder, softer everywhere) ───────────────────
    //
    // Rounded up across the board so every surface matches the clock PIN pad,
    // which set the house radius. The whole scale moved together rather than
    // one token at a time — a card at 22 next to a chip still at 10 reads as a
    // mistake, where both moving reads as the app's shape.
    //
    // Two tokens deliberately did NOT move: `cornerBlock` (the schedule
    // timeline's bars are near-square per spec, and rounding them costs
    // readable width on short blocks) and `cornerPill` (already fully round).
    static let cornerXs: CGFloat = 10    // was 7
    static let cornerSm: CGFloat = 14    // was 10 — chips, small pills
    static let cornerMd: CGFloat = 22    // was 16 — body cards, list rows
    static let cornerLg: CGFloat = 28    // was 20 — hero cards, large surfaces
    static let cornerXl: CGFloat = 34    // was 24 — very large surfaces
    static let cornerPill: CGFloat = 9999
    static let cornerBlock: CGFloat = 3  // schedule-timeline bars — nearly square per spec

    // ── Content insets, paired to the radii above ──────────────────────────
    //
    // A rounded corner eats into the box: on a 42pt corner the shape's left
    // edge is still 9pt inboard at the height of the first line of text, so a
    // 16pt inset leaves only 7pt of real clearance and a 12pt inset actually
    // collides with the arc. These are the insets that keep text clear —
    // roughly 0.55 × radius, which lands ~20pt of clearance at every step.
    //
    // Use these instead of a literal whenever the padding is insetting content
    // inside one of these shapes. That way the two move together the next time
    // the radius scale changes, rather than the padding silently going stale.
    static let insetSm:   CGFloat = 10   // pairs with cornerSm   (14)
    static let insetMd:   CGFloat = 14   // pairs with cornerMd   (22)
    static let insetLg:   CGFloat = 18   // pairs with cornerLg   (28)
    static let insetHero: CGFloat = 24   // pairs with cornerHero (42)

    // ── Shadow recipes ─────────────────────────────────────────────────────
    static let raisedShadowOpacity: Double  = 0.06
    static let raisedShadowRadius:  CGFloat = 2
    static let raisedShadowY:       CGFloat = 1

    static let skyShadowOpacity:    Double  = 0.22
    static let skyShadowRadius:     CGFloat = 12
    static let skyShadowY:          CGFloat = 4

    // ── Revamp · signature gradient (DERIVED from accent — never hardcode at call sites) ──
    // The default accent maps to the wireframe indigo→magenta brand pair. A custom
    // accent keeps its own start and derives an intentional end-stop (see ThemeSettings).
    static let brandGradStartDefault = "#4FACFE"   // light blue
    static let brandGradEndDefault   = "#1E40AF"   // dark blue
    static var accentGradientStart   = "#4FACFE"
    static var accentGradientEnd     = "#1E40AF"

    // ── Canvas gradient + ambient glow (light-mode only; gated by isLightTheme) ──
    static let bgGradTop    = "#F4F5F9"
    static let bgGradBottom = "#E7E9F1"
    static var glowBlob     = "#E9E2F7"            // lavender ambient pool (mirrors accent end for custom accents)
    static let glowOpacity: Double  = 0.22
    static let glowBlur:    CGFloat = 80
    static let glowSize:    CGFloat = 260

    // ── Bright semantic pills (tint bg + same-hue text) ──
    static let pillIndigoBg = "#E7E3FB"; static let pillIndigoFg = "#6B5BE0"
    static let pillAmberBg  = "#FBEFD6"; static let pillAmberFg  = "#C9881F"
    static let pillGreenBg  = "#D8F2DE"; static let pillGreenFg  = "#2F9E54"
    static let pillNeutralBg = "#ECEDF2"; static let pillNeutralFg = "#8A8A95"

    // ── Neutral control fills ──
    // For a control sitting ON a card: a keypad key, an unfilled PIN dot, a
    // disabled button. Ink at low alpha rather than a fixed grey, which means it
    // darkens a light surface and lightens a dark one, and it reads whether the
    // card behind it is frosted glass or solid.
    //
    // Do NOT use progressTrack for these. That's a chart-track token and it's
    // deliberately near-white on light presets, so anything using it as a control
    // fill disappears into a white card.
    static var controlFill: Color { Color(hex: ink).opacity(0.10) }
    /// For small marks that need to carry at a glance — unfilled PIN dots.
    static var controlFillStrong: Color { Color(hex: ink).opacity(0.20) }
    /// Hairline around a control fill; gives the shape an edge on glass.
    static var controlHairline: Color { Color(hex: ink).opacity(0.07) }

    /// Whether the active background preset is a dark one. Derived from the
    /// ink, which the preset writes (`applyBgToT`): light presets set a near
    /// black ink, dark presets a near white one. Lets the `T.*` helpers below
    /// adapt without needing a view context to read ThemeSettings.
    static var isDarkTheme: Bool { Color(hex: ink).perceivedBrightness > 140 }

    /// Fill for a RECESSED area — a dropzone, an attachment well, an input
    /// trough — that should read as sunk INTO the surface it sits on. So it is
    /// always darker than that surface: a soft indigo tint on light presets,
    /// and genuinely dark on dark ones.
    ///
    /// This used to be a flat `pillIndigoBg` at 0.6. That token is a `static
    /// let` light lavender with no preset awareness, so on a dark theme the
    /// end-job attachment box came out as a pale slab floating on a dark card —
    /// lighter than everything around it, which is the opposite of recessed.
    static var wellFill: Color {
        isDarkTheme ? Color.black.opacity(0.30)
                    : Color(hex: pillIndigoBg).opacity(0.6)
    }

    // ── Frosted glass on/off ──
    // Mirrors ThemeSettings.frostedGlass. Lives on T because the glass helpers
    // include `Shape.glassFill()`, a Shape extension — it has no view context, so
    // it can't read @Environment. Views that need to RE-RENDER when this flips
    // still have to observe `theme.frostedGlass`; see FrostedCard and SBox.
    //
    // Covers page CONTENT only — cards, page boxes, message bubbles, thread rows.
    // The nav bar, the popups (GlassPanel) and the header buttons
    // (HeaderGlassCircle) are chrome and stay frosted regardless.
    static var glassEnabled: Bool = true

    // ── Progress track + presence dots ──
    // `var`, not `let`: the track is preset-driven (see BgPreset.track and
    // applyBgToT). A single mid-grey couldn't work for both — on frosted glass it
    // read as a dirty smudge over a light surface and vanished into a dark one.
    static var progressTrack = "#F7F9FD"
    static let presenceWork  = "#3B82F6"
    static let presenceBreak = "#F5A623"
    static let presenceIdle  = "#9AA0AC"

    // ── New radius + glassy highlight stroke ──
    static let cornerHero: CGFloat = 42            // was 30 — hero / large frosted cards
    static let highlightStroke = "#FFFFFF"         // used at low alpha as a white→clear top edge

    // ── Specular rim (the app-wide glass edge) ─────────────────────────────
    //
    // Every frosted surface is edged with a stroke of `highlightStroke` that is
    // bright at the top-left and gone by the bottom-right — the way a real
    // glass edge picks up a single light source. Drawn with `.plusLighter`, so
    // it ADDS light to whatever is under it instead of painting white on top;
    // that's what keeps it from going chalky on the light presets and invisible
    // on Charcoal.
    //
    // A real glass edge is lit on one side and in shadow on the other, and it
    // needs BOTH to read. An earlier version was highlight-only, drawn with
    // `.plusLighter` — which is additive, so on a near-white card the white
    // stroke clamped straight to white and the rim was invisible on every light
    // preset. It only ever showed on Charcoal.
    //
    // So: white down the top-left, transparent through the middle, and a soft
    // dark down the bottom-right. Normal blending, no `.plusLighter` — which
    // also means no compositing group, so this costs nothing to render and is
    // safe on the surfaces that draw per-row in long lists.
    //
    // THE dials for the whole app's glass edge. `rimShade` is what carries the
    // effect on light presets; `rimTop` is what carries it on dark ones.
    static let rimTop:   Double  = 0.55   // highlight at the top-left corner
    static let rimMid:   Double  = 0.10   // where the highlight has fallen off
    static let rimShade: Double  = 0.18   // shadow down the bottom-right
    static let rimWidth: CGFloat = 1.2

    // ── CTA glow shadow (accompanies every gradient pill) ──
    static var ctaGlowColor   = "#7B5BE8"          // mirrors accent end for custom accents
    static let ctaGlowOpacity: Double  = 0.35
    static let ctaGlowRadius:  CGFloat = 20
    static let ctaGlowY:       CGFloat = 8

    // ── Ambient (hero) elevation — softer + larger than `raised` ──
    static let ambientShadowOpacity: Double  = 0.10
    static let ambientShadowRadius:  CGFloat = 24
    static let ambientShadowY:       CGFloat = 12
}

// MARK: - Readable foreground tokens
// The "dark bg → white text, light bg → black text" rule, resolved for the
// two backgrounds that follow the user's accent. Use these anywhere text or an
// icon sits ON the accent color or the brand gradient — never hardcode `.white`.
extension T {
    /// Legible text/icon color for content sitting on a solid `T.accent` fill.
    static var onAccent: Color { Color(hex: accent).readableText }

    /// Legible text/icon color for content sitting on the brand gradient.
    /// Judged from the AVERAGE brightness of the two stops so the pick is
    /// correct whether the content rides the light end or the dark end.
    static var onGradient: Color {
        let avg = (Color(hex: accentGradientStart).perceivedBrightness
                 + Color(hex: accentGradientEnd).perceivedBrightness) / 2
        return avg > 140 ? .black : .white
    }

    /// Legible text/icon color for content sitting on an arbitrary hex fill
    /// (semantic pills, department colors, avatars, status chips).
    static func onColor(_ hex: String) -> Color { Color(hex: hex).readableText }
}

// MARK: - Signature gradient
// THE brand gradient. Reads the derived accent stops so the Customize accent
// picker stays coherent (default accent → wireframe indigo→magenta).
extension T {
    static func brandGradient(start: UnitPoint = .leading,
                              end: UnitPoint = .trailing) -> LinearGradient {
        LinearGradient(
            colors: [Color(hex: accentGradientStart), Color(hex: accentGradientEnd)],
            startPoint: start, endPoint: end)
    }
}
