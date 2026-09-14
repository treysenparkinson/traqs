package com.matrixsystems.traqs.ui.theme

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Port of the iOS liquid page canvas (Views/LiquidBackground.swift).
//
// TWO big blobs on a diagonal, wandering. An earlier nine-blob version read as a
// busy field of colour rather than as liquid — you could not follow any one
// shape, so nothing appeared to move. Two large ones you can actually track,
// with real ground between them, is the whole effect: fewer, bigger, slower.
//
// Their periods (23s / 29s) share no factors, so the pair drifts in and out of
// phase forever instead of settling into a loop you can spot.
//
// ONE DEPARTURE FROM iOS: there, each blob is a hard ellipse under a heavy
// blur. Compose has no cheap equivalent for a blur that size, so each blob is
// drawn as a radial gradient that falls to fully transparent instead. The soft
// edge is built into the paint rather than applied over it — visually the same
// wash, at a fraction of the cost, and it works below API 31 where
// RenderEffect does not exist.

// The page canvas's look. The splash deliberately does NOT share these — a
// 2.4s load-up needs more presence than a background that sits behind content
// all day.
private object LiquidTuning {
    // Blob footprint — THE dial for how much colour is on screen versus how much
    // ground shows through. Below ~0.6 the pair stops meeting and reads as two
    // spots rather than a wash.
    const val blobScale = 0.72f
    // How much of the finished wash actually lands behind pages. Reach for this
    // when the wash is the right LOOK but too present; reach for the alphas
    // below when it is the pigment itself that is wrong.
    const val pageOpacity = 0.49f
    // How far the blob hues are pushed toward full colour, 0..1.
    const val saturation = 0.30f
}

// One keyframe on a blob's wander: offsets as a fraction of its own size.
private data class LiquidStop(val t: Float, val x: Float, val y: Float, val scale: Float)

// The two paths. B is walked BACKWARDS at its call site so the second blob is
// never mirroring the first — the pair drifts apart and back together instead of
// sliding in parallel.
private val pathA = listOf(
    LiquidStop(0.00f, 0f, 0f, 1.00f),
    LiquidStop(0.25f, 0.26f, 0.17f, 1.32f),
    LiquidStop(0.55f, -0.19f, 0.28f, 0.80f),
    LiquidStop(0.80f, 0.15f, -0.16f, 1.18f),
    LiquidStop(1.00f, 0f, 0f, 1.00f),
)
private val pathB = listOf(
    LiquidStop(0.00f, 0f, 0f, 1.06f),
    LiquidStop(0.30f, -0.30f, 0.22f, 0.78f),
    LiquidStop(0.60f, 0.22f, -0.19f, 1.38f),
    LiquidStop(0.85f, -0.13f, 0.12f, 0.94f),
    LiquidStop(1.00f, 0f, 0f, 1.06f),
)

// Walk the same stops backwards — the equivalent of CSS animation-direction:
// reverse.
private fun reversed(stops: List<LiquidStop>): List<LiquidStop> =
    stops.reversed().map { it.copy(t = 1f - it.t) }

private fun lerp(a: Float, b: Float, f: Float) = a + (b - a) * f

// Sample a path at progress `t`, interpolating between the two stops around it.
private fun sample(stops: List<LiquidStop>, t: Float): LiquidStop {
    val hi = stops.indexOfFirst { it.t >= t }.let { if (it <= 0) 1 else it }
    val lo = hi - 1
    val a = stops[lo]; val b = stops[hi]
    val span = (b.t - a.t).takeIf { it > 0f } ?: 1f
    val f = ((t - a.t) / span).coerceIn(0f, 1f)
    return LiquidStop(t, lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.scale, b.scale, f))
}

// Push a colour toward full saturation without moving its hue — the derived
// tones have to stay in the accent's own warm/cool family or the wash clashes
// with it.
private fun vivid(c: Color, amount: Float): Color {
    val mx = maxOf(c.red, c.green, c.blue)
    if (mx <= 0f) return c
    val k = 1f + amount
    return Color(
        (c.red * k).coerceAtMost(1f),
        (c.green * k).coerceAtMost(1f),
        (c.blue * k).coerceAtMost(1f),
    )
}

// THE page canvas. Every screen sits on this — the glass surfaces above it are
// translucent, so this is what they are translucent ONTO. Without it they have
// nothing to catch and read as flat grey panels.
@Composable
fun PageBackground(modifier: Modifier = Modifier) {
    val c = traQSColors

    // The ground the wash is laid over: the light presets' vertical gradient, or
    // a dark preset's flat paint. Kept separate from the blob layer so fading
    // the wash never lets whatever sits behind the page show through.
    val ground = if (c.isLight) {
        Brush.verticalGradient(listOf(Color(0xFFF4F5F9), Color(0xFFE7E9F1)))
    } else {
        Brush.verticalGradient(listOf(c.bg, c.bg))
    }

    val transition = rememberInfiniteTransition(label = "liquid")
    val tA by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(23_000, easing = LinearEasing), RepeatMode.Restart),
        label = "a"
    )
    val tB by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(29_000, easing = LinearEasing), RepeatMode.Restart),
        label = "b"
    )

    // Two blobs, so two hues: the accent, and the deeper tone derived from it.
    // Derive first, saturate second — the partner has to come off the accent as
    // the user PICKED it or the family maths works from the wrong hue.
    val hueA = vivid(c.accent, LiquidTuning.saturation)
    val hueB = vivid(deriveGradientEnd(c.accent), LiquidTuning.saturation)

    Box(modifier.fillMaxSize().background(ground)) {
        Canvas(Modifier.fillMaxSize()) {
            val s = LiquidTuning.blobScale
            // Each blob is WIDER than the canvas and about three-quarters of its
            // height, so one alone covers most of the screen and the pair spans
            // it with room to move.
            val w = size.width * 1.05f * s
            val h = size.height * 0.72f * s

            // Opposite corners on a diagonal: one off the leading edge up top,
            // one off the trailing edge down low. They overlap through the
            // middle and leave the OTHER two corners as ground — which is what
            // makes this read as two shapes on a background rather than as
            // full-bleed colour.
            //
            // Anchored against the blob's OWN height, so shrinking the pair
            // pulls them toward each other instead of opening a pale band
            // across the middle.
            // pageOpacity is folded into each blob's alpha rather than painted
            // over the finished layer: same result, one less full-screen draw.
            val k = LiquidTuning.pageOpacity
            blob(sample(pathA, tA), hueA, 0.58f * k, -0.18f * size.width, -h * 0.15f, w, h)
            blob(sample(reversed(pathB), tB), hueB, 0.50f * k,
                size.width - w + 0.18f * size.width, size.height - h * 0.85f, w, h)
        }
    }
}

// The fade behind the floating tab bar.
//
// Without it the pill sits on live content: rows scroll right up under it and
// stay sharp at the screen edge, so the bar reads as a sticker on the page
// rather than as chrome floating above it. iOS gets that separation from the
// real blur under its bar; with no backdrop blur here, a scrim is what stands
// in — content dissolves into the page ground as it approaches the bottom.
//
// Transparent at the TOP so there is no hard line where the fade begins, and
// the falloff is weighted (0.45 at the midpoint, not 0.5) so most of the
// opacity gathers behind the pill itself instead of greying the whole lower
// third of the screen.
@Composable
fun NavBarScrim(modifier: Modifier = Modifier, height: Dp = 150.dp) {
    val c = traQSColors
    val ground = if (c.isLight) Color(0xFFE7E9F1) else c.bg
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .background(
                Brush.verticalGradient(
                    0.00f to ground.copy(alpha = 0f),
                    0.45f to ground.copy(alpha = 0.72f),
                    1.00f to ground,
                )
            )
    )
}

// One blob: a radial gradient from the hue at `alpha` out to fully transparent.
// See the header note — this replaces iOS's hard ellipse under a heavy blur.
private fun DrawScope.blob(
    stop: LiquidStop, hue: Color, alpha: Float,
    left: Float, top: Float, w: Float, h: Float,
) {
    val cx = left + w / 2f + stop.x * w
    val cy = top + h / 2f + stop.y * h
    val rx = w / 2f * stop.scale
    val ry = h / 2f * stop.scale
    if (rx <= 0f || ry <= 0f) return

    // Drawn as a circle of radius rx inside a vertical scale, so one radial
    // brush yields the ellipse the spec calls for.
    scale(scaleX = 1f, scaleY = ry / rx, pivot = Offset(cx, cy)) {
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    hue.copy(alpha = alpha),
                    hue.copy(alpha = alpha * 0.55f),
                    hue.copy(alpha = 0f),
                ),
                center = Offset(cx, cy),
                radius = rx,
            ),
            radius = rx,
            center = Offset(cx, cy),
            style = Fill,
        )
    }
}
