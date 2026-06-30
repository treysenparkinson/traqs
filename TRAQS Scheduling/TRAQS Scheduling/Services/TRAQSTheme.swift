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
    static let cornerXs: CGFloat = 7
    static let cornerSm: CGFloat = 10    // chips, small pills
    static let cornerMd: CGFloat = 16    // body cards, list rows
    static let cornerLg: CGFloat = 20    // hero cards, large surfaces
    static let cornerXl: CGFloat = 24    // very large surfaces
    static let cornerPill: CGFloat = 9999
    static let cornerBlock: CGFloat = 3  // schedule-timeline bars — nearly square per spec

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
    static let brandGradStartDefault = "#6D5BE8"   // indigo
    static let brandGradEndDefault   = "#D63AC8"   // hot magenta
    static var accentGradientStart   = "#6D5BE8"
    static var accentGradientEnd     = "#D63AC8"

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

    // ── Progress track + presence dots ──
    static let progressTrack = "#E6E8EF"
    static let presenceWork  = "#3B82F6"
    static let presenceBreak = "#F5A623"
    static let presenceIdle  = "#9AA0AC"

    // ── New radius + glassy highlight stroke ──
    static let cornerHero: CGFloat = 26            // hero / large frosted cards
    static let highlightStroke = "#FFFFFF"         // used at low alpha as a white→clear top edge

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
