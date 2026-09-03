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
    // Mirrors ThemeSettings.frostedGlass — see there for exactly what it covers
    // and the three things it deliberately doesn't. Lives on T because the glass
    // helpers include `Shape.glassFill()`, a Shape extension: it has no view
    // context, so it can't read @Environment. Views that need to RE-RENDER when
    // this flips still have to observe `theme.frostedGlass`; see FrostedCard,
    // SBox and GlassSurface.
    //
    // Reaches the app's own SURFACES *and* its chrome: cards, page boxes,
    // message bubbles, list rows, the rim on them, the floating nav pill and the
    // prompting popups. BUTTONS are the one exception — every `.glassEffect`
    // control (header pills, keypad keys, glass CTAs) stays native Liquid Glass,
    // because a flat app with native glass buttons is a coherent look and a flat
    // app whose buttons went flat too just looks unfinished.
    static var glassEnabled: Bool = true

    // ── Nav bar paint (the floating tab pill) ──────────────────────────────
    //
    // The pill gets its OWN tint rather than sharing `glassSurfaceTint` over
    // `T.surface`, because it is the one surface that has to hold five small
    // glyphs legible against whatever page is drifting underneath it. Each
    // preset pushes the bar AWAY from its page — near-solid white on White,
    // near-black on Charcoal — so the icons read at full contrast either way.
    // At `glassSurfaceTint` (0.22 of `T.surface`) the bar sat close enough to
    // the page for the unselected glyphs to wash out.
    //
    // Preset-driven (see `ThemeSettings.applyNavToT`) for the same reason
    // `progressTrack` and the rim are: one set of numbers cannot serve a
    // near-white page and a near-black one.
    //
    // There is no flat counterpart. The bar is native Liquid Glass on the same
    // terms as every glass button — the frosted-glass toggle governs the
    // surfaces TRAQS paints, and this is Apple's material. See NavPillMaterial.
    /// The colour of the pill's glass. Passed to `Glass.tint` — see
    /// `NavPillMaterial`, which is always glass whatever the frosted-glass
    /// toggle says.
    static var navTint = "#FFFFFF"
    /// How much of `navTint` (see above). THE transparency dial for the bar —
    /// nothing else reads it. Preset-driven; this default matches the LIGHT
    /// value, as `navTint` above does. See `applyNavToT` for why light sits
    /// where it does and where the legibility floor is.
    static var navTintOpacity: Double = 0.38

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
    // The Apple "glass bubble" edge: a bright glare along the TOP lip, the
    // sides falling away to almost nothing, a shadowed underside, and then the
    // bottom lip lighting up again as light bounces back through the material.
    // Top and bottom both lit is what makes a surface read as a bubble of glass
    // rather than a rectangle with a highlight on it — it's the single detail
    // that separates Apple's Liquid Glass from a plain bevel.
    //
    // Drawn as ONE vertical stroke gradient (`.top` → `.bottom`), so the whole
    // top arc of a rounded rect glows and the whole bottom arc glows, with the
    // straight left/right runs dimmest in between. An earlier version ran the
    // gradient diagonally (top-left → bottom-right), which lit one corner and
    // shadowed the opposite one — a single hard light source, not a lens.
    //
    // Normal blending, deliberately: no `.plusLighter`, so no compositing
    // group, so this is cheap enough for surfaces that render per-row down long
    // lists. (`.plusLighter` was tried first. Being additive, on the light
    // presets the white stroke clamped straight to white and the rim was
    // invisible on everything except Charcoal.)
    //
    // THE dials for the whole app's glass edge, top of the stroke to the
    // bottom.
    //
    // `var`, and PRESET-DRIVEN (see ThemeSettings.applyRimToT) — one set of
    // numbers could not serve both families. A white glare has nothing to do
    // against a near-white card, so on the light presets the lips need to run
    // brighter and the side band needs to be a real grey rather than the faint
    // `T.border` hairline, which is what made the glass hard to see on white.
    static var rimTop:  Double  = 0.50   // glare along the top lip
    static var rimBot:  Double  = 0.37   // the bottom lip, light bouncing back up
    /// The band down the LEFT AND RIGHT edges — a colour, not an alpha, because
    /// it has to be darker than the surface on both families and there's no one
    /// opacity of black that manages it.
    ///
    /// This is the contrast that makes the lips read as lips. With the faint
    /// `T.border` here instead, a card's sides all but vanished and the glare
    /// looked painted on rather than caught. Each preset pushes AWAY from its
    /// surface — a definite grey on White, a near-black groove on Charcoal —
    /// the same trick `progressTrack` uses, and for the same reason.
    static var rimSide: String  = "#3A3A42"
    /// How quickly each lip gives way to the side band, as a fraction of the
    /// stroke's height. Small: a lip is a lip, not a fade over half the card.
    static var rimLip:  Double  = 0.18
    static var rimWidth: CGFloat = 1.0

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
