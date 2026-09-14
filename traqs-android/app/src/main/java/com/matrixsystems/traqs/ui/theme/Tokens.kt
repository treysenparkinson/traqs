package com.matrixsystems.traqs.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.min

// Port of the iOS `T` token set (Services/TRAQSTheme.swift). Colours live on
// TRAQSColors next door because they follow the preset; everything here is a
// brand constant that no preset touches.

// ── Corner radii ───────────────────────────────────────────────────────────
//
// The whole scale moved together in the iOS revamp rather than one token at a
// time — a card at 22 next to a chip still at 10 reads as a mistake, where both
// moving reads as the app's shape. Keep them in step with iOS T.corner*.
object TRadius {
    val xs: Dp = 10.dp
    val sm: Dp = 14.dp     // chips, small pills
    val md: Dp = 22.dp     // body cards, list rows
    val lg: Dp = 28.dp     // hero cards, large surfaces
    val xl: Dp = 34.dp     // very large surfaces
    val hero: Dp = 42.dp   // hero / large frosted cards
    val block: Dp = 3.dp   // schedule-timeline bars — nearly square per spec
}

// ── Content insets, paired to the radii above ──────────────────────────────
//
// A rounded corner eats into the box: on a 42dp corner the shape's left edge is
// still ~9dp inboard at the height of the first line of text, so a 16dp inset
// leaves only 7dp of real clearance. Roughly 0.55 x radius. Use these instead of
// a literal whenever padding is insetting content inside one of these shapes, so
// the two move together next time the radius scale changes.
object TInset {
    val sm: Dp = 10.dp     // pairs with TRadius.sm
    val md: Dp = 14.dp     // pairs with TRadius.md
    val lg: Dp = 18.dp     // pairs with TRadius.lg
    val hero: Dp = 24.dp   // pairs with TRadius.hero
}

// ── Elevation recipes ──────────────────────────────────────────────────────
object TElevation {
    val raised: Dp = 2.dp
    val ambient: Dp = 12.dp    // hero surfaces + the floating nav pill
    val cta: Dp = 8.dp
}

// Space every page reserves at the bottom so its last row clears the floating
// tab pill. Tracks the bar's outer height — if the bar shrinks and this does
// not, every page just gains dead space at the end of its scroll.
val tabPillBottomInset: Dp = 99.dp

// ── Colour maths ───────────────────────────────────────────────────────────

// ITU-R BT.601 luma, 0..255. The same weighting iOS uses to decide whether ink
// on a fill should be black or white.
val Color.perceivedBrightness: Double
    get() = (red * 299 + green * 587 + blue * 114) * 255.0 / 1000.0

// The "dark fill takes white text, light fill takes black text" rule. Use this
// anywhere text or an icon sits ON a coloured fill — never hardcode white.
val Color.readableText: Color
    get() = if (perceivedBrightness > 140) Color.Black else Color.White

private fun Color.toHsv(): Triple<Float, Float, Float> {
    val r = red; val g = green; val b = blue
    val mx = max(r, max(g, b)); val mn = min(r, min(g, b))
    val d = mx - mn
    val h = when {
        d == 0f -> 0f
        mx == r -> 60f * (((g - b) / d) % 6f)
        mx == g -> 60f * (((b - r) / d) + 2f)
        else    -> 60f * (((r - g) / d) + 4f)
    }
    return Triple(if (h < 0) h + 360f else h, if (mx == 0f) 0f else d / mx, mx)
}

private fun hsvToColor(h: Float, s: Float, v: Float): Color {
    val c = v * s
    val x = c * (1f - kotlin.math.abs((h / 60f) % 2f - 1f))
    val m = v - c
    val (r, g, b) = when {
        h < 60f  -> Triple(c, x, 0f)
        h < 120f -> Triple(x, c, 0f)
        h < 180f -> Triple(0f, c, x)
        h < 240f -> Triple(0f, x, c)
        h < 300f -> Triple(x, 0f, c)
        else     -> Triple(c, 0f, x)
    }
    return Color(r + m, g + m, b + m)
}

// Derive the brand gradient's end-stop from the chosen accent: KEEP the hue (no
// rotation — that produced an off-hue end that read as a different colour),
// deepen it into a richer shade (a little more saturation, ~22% less brightness)
// so a single accent still yields a coherent same-hue two-stop gradient.
// Mirrors iOS ThemeSettings.derivedEnd.
fun deriveGradientEnd(accent: Color): Color {
    val (h, s, v) = accent.toHsv()
    return hsvToColor(h, min(1f, s + 0.10f), max(0f, v - 0.22f))
}

// ── Frosted glass ──────────────────────────────────────────────────────────
//
// How much of `surface` is laid over the page to make a card. On iOS this rides
// on top of a real `.ultraThinMaterial` backdrop blur; Android has no built-in
// equivalent, so here the tint IS the material and it has to carry the whole
// effect alone. Hence a good deal heavier than the iOS 0.22 — at that value a
// card over the liquid background was a smear rather than a surface.
//
// If body text ever starts to swim on the cards, raise this rather than draining
// colour out of LiquidTuning.
const val glassSurfaceTint: Float = 0.62f

// A quarter thinner than the card tint, deliberately: a modal is a smaller shape
// that sits closer to the eye, and matching the card value made it read as a
// solid slab dropped on the page.
const val modalSurfaceTint: Float = glassSurfaceTint * 0.88f
