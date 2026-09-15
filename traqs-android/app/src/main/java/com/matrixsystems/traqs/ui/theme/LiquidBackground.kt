package com.matrixsystems.traqs.ui.theme

import android.os.Build
import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Port of the iOS liquid page canvas (Views/LiquidBackground.swift).
//
// TWO big blobs on a diagonal, wandering. An earlier nine-blob version read as a
// busy field of colour rather than as liquid — you could not follow any one
// shape, so nothing appeared to move. Two large ones you can actually track,
// with real ground between them, is the whole effect: fewer, bigger, slower.
//
// Their periods share no factors, so the pair drifts in and out of phase forever
// instead of settling into a loop you can spot.
//
// Everything below — the tuning numbers, the colour ladder, the motion paths,
// the blob geometry — is carried across from the Swift verbatim. An earlier
// Android version approximated all three and looked nothing like it: the hues
// came from a crude RGB multiply instead of the HSL family maths, the blobs were
// soft radial gradients instead of blurred solids (so the wash had no body), and
// the paths ran at their raw durations instead of being divided by `pageEnergy`,
// which made the whole thing drift three times too slowly and travel two-thirds
// as far.

// The page canvas's look. The splash deliberately does NOT share these — a
// 2.4s load-up needs more presence than a background that sits behind content
// all day.
internal object LiquidTuning {
    /**
     * Blob footprint — THE dial for how much colour is on screen versus how much
     * ground shows through. The pair's vertical anchors move with this (see
     * `specs`), so shrinking pulls them toward each other instead of leaving a
     * pale band across the middle. Below ~0.6 they stop meeting at all and read
     * as two spots rather than as a wash.
     */
    const val blobScale = 0.72f

    /**
     * Pigment density — the SECOND half of how saturated the wash looks, and
     * often the more important one. `saturation` decides how vivid a blob's
     * colour is; this decides how much of it actually lands, since every blob is
     * drawn at well under full alpha and then blurred. A perfectly vivid hue at
     * low density still reads as a pastel haze.
     *
     * Note `blurRadius` tightens as this climbs — the two have to move together,
     * because a heavy blur is exactly what turns pigment back into haze.
     *
     * If body text ever starts to swim on the cards over this, raise
     * `glassSurfaceTint` rather than dropping this back.
     */
    const val thickness = 1.45f

    /** Pair the accent with the DEEPER derived tone (`tertiary`), for body. */
    const val primaryWeighted = true

    /**
     * How much of the wash actually lands behind pages, 0..1. A flat multiplier
     * on the finished blob layer, applied AFTER `thickness` and the blur — so
     * unlike turning `thickness` down, it takes colour out without letting the
     * blur widen and dissolve the two shapes back into haze.
     */
    const val pageOpacity = 0.49f

    /** Behind pages: noticeable drift without competing with content. */
    const val pageEnergy = 3.0f

    /** How far the blob hues are pushed toward full colour. */
    const val saturation = 0.30f
}

// MARK: - Colour maths (port of iOS LiquidColor)
//
// The wash's two hues are DERIVED from the accent, not picked: a companion or
// tertiary tone rotated within the accent's own warm/cool family, then pushed
// toward full colour. Rotating within the family is what stops a warm accent
// from being paired with a cool partner — the pair has to read as one palette.

internal object LiquidColor {

    private fun toHsl(c: Color): Triple<Float, Float, Float> {
        val r = c.red; val g = c.green; val b = c.blue
        val mx = max(r, max(g, b)); val mn = min(r, min(g, b)); val d = mx - mn
        var h = 0f
        if (d != 0f) {
            h = when (mx) {
                // `%`, NOT IEEErem: Kotlin's `%` is Swift's
                // `truncatingRemainder`, which is what the Swift uses. IEEErem
                // rounds to NEAREST and returns a signed result, which drove the
                // hue maths negative and turned a blue accent purple.
                r -> 60f * (((g - b) / d) % 6f)
                g -> 60f * (((b - r) / d) + 2f)
                else -> 60f * (((r - g) / d) + 4f)
            }
        }
        if (h < 0f) h += 360f
        val l = (mx + mn) / 2f
        val s = if (d == 0f) 0f else d / (1f - abs(2f * l - 1f))
        return Triple(h, s, l)
    }

    private fun fromHsl(h: Float, s: Float, l: Float): Color {
        val hh = ((h % 360f) + 360f) % 360f
        val c = (1f - abs(2f * l - 1f)) * s
        val x = c * (1f - abs((hh / 60f) % 2f - 1f))
        val m = l - c / 2f
        val (r, g, b) = when {
            hh < 60f -> Triple(c, x, 0f)
            hh < 120f -> Triple(x, c, 0f)
            hh < 180f -> Triple(0f, c, x)
            hh < 240f -> Triple(0f, x, c)
            hh < 300f -> Triple(x, 0f, c)
            else -> Triple(c, 0f, x)
        }
        return Color(
            (r + m).coerceIn(0f, 1f),
            (g + m).coerceIn(0f, 1f),
            (b + m).coerceIn(0f, 1f),
        )
    }

    /** Warm is the red→yellow and magenta arc. */
    private fun isWarm(h: Float) = h < 55f || h >= 295f

    /**
     * Warm is a wrapped arc (295°→360°→55°); cool is the 55°→295° span between.
     * Linearising each into 0..len lets us rotate a hue and REFLECT off the ends
     * rather than wrapping past them, so a rotation can never tip a warm pick
     * into the cool family or vice versa.
     */
    private fun rotateInFamily(h: Float, degrees: Float): Float {
        val warm = isWarm(h)
        val len = if (warm) 120f else 240f
        val pos = if (warm) (if (h >= 295f) h - 295f else h + 65f) else h - 55f
        var p = pos + degrees
        if (p < 0f) p = -p                  // reflect off the low end
        if (p > len) p = 2f * len - p       // …and the high end
        p = p.coerceIn(0f, len)
        return if (warm) (p + 295f) % 360f else p + 55f
    }

    /**
     * A companion hue for the wash. Stays in the same temperature family — a
     * warm pick gets a warm partner — so the blobs read as one palette.
     */
    fun companion(c: Color): Color {
        val (h, s, l) = toHsl(c)
        val warm = isWarm(h)
        val shifted = if (warm) (if (h < 55f) h + 32f else h - 34f)
        else (if (h < 180f) h + 46f else h - 46f)
        return fromHsl(shifted, min(1f, max(0.45f, s)), min(0.68f, max(0.42f, l)))
    }

    /**
     * A deeper third hue. `companion` rotates one way from the pick; this
     * rotates the other, so the tones straddle the chosen colour instead of
     * stacking to one side of it. It is what gives the wash body rather than
     * another pastel.
     */
    fun tertiary(c: Color): Color {
        val (h, s, l) = toHsl(c)
        val hue = rotateInFamily(h, if (isWarm(h)) -26f else -38f)
        return fromHsl(hue, min(1f, max(0.55f, s)), min(0.58f, max(0.34f, l)))
    }

    /**
     * Push a hue toward full colour. `amount` is a FRACTION OF THE HEADROOM
     * left, not a flat addition: a dull pick gains a lot, an already-vivid one
     * gains only what it can take, and nothing clips to a different colour.
     *
     * Lightness moves too, and it has to. Saturation only reads near mid
     * lightness — a near-white pastel or a near-black deep tone has nowhere to
     * put it, so raising S alone leaves both looking as washed out as before.
     */
    fun vivid(c: Color, amount: Float): Color {
        if (amount <= 0f) return c
        val (h, s, l) = toHsl(c)
        return fromHsl(h, min(1f, s + (1f - s) * amount), l + (0.55f - l) * amount * 0.6f)
    }
}

// MARK: - Motion paths

/** One keyframe of a blob's wander: offset as a fraction of the blob's OWN size. */
private data class LiquidStop(val t: Float, val x: Float, val y: Float, val scale: Float)

// tqLiquidA…D, verbatim. Only A and B are in play now that the wash is two
// blobs; C and D are kept as the alternates to swap in if the pair's wander
// wants a different shape.
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

/** CSS `animation-direction: reverse` — walk the same stops backwards. */
private fun reversed(stops: List<LiquidStop>): List<LiquidStop> =
    stops.reversed().map { it.copy(t = 1f - it.t) }

/**
 * Sample a path at progress `t`.
 *
 * Eased with smoothstep across each segment, not linear. iOS uses
 * `CubicKeyframe`, which arrives at and leaves every stop at rest; straight
 * lerping gave the blobs a visible tick as they changed direction at each one.
 */
private fun sample(stops: List<LiquidStop>, t: Float): LiquidStop {
    val hi = stops.indexOfFirst { it.t >= t }.let { if (it <= 0) 1 else it }
    val lo = hi - 1
    val a = stops[lo]; val b = stops[hi]
    val span = (b.t - a.t).takeIf { it > 0f } ?: 1f
    val raw = ((t - a.t) / span).coerceIn(0f, 1f)
    val f = raw * raw * (3f - 2f * raw)   // smoothstep
    return LiquidStop(t, lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.scale, b.scale, f))
}

private fun lerp(a: Float, b: Float, f: Float) = a + (b - a) * f

/** One blob's fixed geometry, hue and tempo. */
private data class BlobSpec(
    val w: Float,            // fraction of container width
    val h: Float,            // fraction of container HEIGHT
    val leading: Float?,     // fraction of width from the leading edge…
    val trailing: Float?,    // …or from the trailing edge
    val top: Float,          // fraction of container height
    val hue: Color,
    val alpha: Float,
    val stops: List<LiquidStop>,
    val durationMs: Int,
)

// MARK: - The page canvas

/**
 * The ground BOTH canvases sit on: the light presets' vertical gradient, or a
 * dark preset's flat paint.
 *
 * Shared on purpose — the liquid wash is laid over exactly the ground the static
 * canvas would have painted, so flipping Liquid Motion changes what drifts on
 * top and never what is underneath. It is also what the thread header's plate
 * matches itself to (see ThreadHeaderPlate).
 */
@Composable
fun pageGround(): Brush {
    val c = traQSColors
    return if (c.isLight) {
        Brush.verticalGradient(listOf(pageGroundTop(), Color(0xFFE7E9F1)))
    } else {
        Brush.verticalGradient(listOf(c.bg, c.bg))
    }
}

/**
 * The ground's colour at the TOP of the screen — the first stop of `pageGround`.
 *
 * Exposed because chrome pinned to the top edge has to match the page it covers:
 * the thread header's plate paints this so it disappears into the canvas instead
 * of reading as a flatter slab laid on it.
 */
@Composable
fun pageGroundTop(): Color = if (traQSColors.isLight) Color(0xFFF4F5F9) else traQSColors.bg

// THE page canvas. Every screen sits on this — the glass surfaces above it are
// translucent, so this is what they are translucent ONTO. Without it they have
// nothing to catch and read as flat grey panels.
//
// ONE branch point for the app's two canvases, so the call site doesn't choose:
// the drifting liquid wash when the user has Liquid Motion on (the default), the
// static ambient canvas when off. Mirrors iOS PageBackground / AmbientCanvas.
@Composable
fun PageBackground(modifier: Modifier = Modifier) {
    val c = traQSColors
    val ground = pageGround()
    if (c.liquid) LiquidWash(modifier, ground) else AmbientCanvas(modifier, ground)
}

@Composable
private fun LiquidWash(modifier: Modifier, ground: Brush) {
    val c = traQSColors
    val scale = LiquidTuning.blobScale.coerceIn(0.2f, 1f)

    // Two blobs, so two hues. `primaryWeighted` picks the partner: the deeper
    // tertiary for body behind page content, the lighter companion otherwise.
    //
    // Derive FIRST, saturate second — the partner has to come off the accent as
    // the user PICKED it, or the warm/cool family maths works from the wrong hue.
    val partner = if (LiquidTuning.primaryWeighted) LiquidColor.tertiary(c.accent)
    else LiquidColor.companion(c.accent)
    val hueA = LiquidColor.vivid(c.accent, LiquidTuning.saturation)
    val hueB = LiquidColor.vivid(partner, LiquidTuning.saturation)

    // Denser than any single blob in the old nine-blob ladder: nine overlapping
    // shapes built their colour by stacking, two have to carry it alone.
    fun dens(base: Float) = min(0.92f, base * LiquidTuning.thickness)

    // Each blob is WIDER than the canvas and about three-quarters of its height,
    // so one alone covers most of the screen and the pair spans it with room to
    // move. Anchored on opposite corners of a diagonal, leaving the OTHER two
    // corners as ground — which is what makes this read as two shapes on a
    // background rather than as full-bleed colour.
    //
    // The vertical anchors are fractions of the blob's OWN height, so shrinking
    // `scale` pulls the pair together instead of opening a pale band between.
    val w = 1.05f * scale
    val h = 0.72f * scale
    val specs = listOf(
        BlobSpec(w, h, leading = -0.18f, trailing = null, top = -h * 0.15f,
            hue = hueA, alpha = dens(0.58f), stops = pathA, durationMs = periodMs(23f)),
        BlobSpec(w, h, leading = null, trailing = -0.18f, top = 1f - h * 0.85f,
            hue = hueB, alpha = dens(0.50f), stops = reversed(pathB), durationMs = periodMs(29f)),
    )

    // Excursions grow with energy, but sub-linearly — at full tilt the blobs
    // should surge, not fly off the canvas.
    val amplitude = min(1.7f, 1f + (LiquidTuning.pageEnergy - 1f) * 0.25f)

    // Blur tightens as the wash thickens (a heavy blur is what turns pigment
    // back into haze) and scales with the blob's own footprint, since a blur
    // sized for a big blob would dissolve a small one completely.
    val blurRadius: Dp = (scale * max(70f, 130f / LiquidTuning.thickness)).dp

    val transition = rememberInfiniteTransition(label = "liquid")
    val progress = specs.map { spec ->
        transition.animateFloat(
            initialValue = 0f, targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(spec.durationMs, easing = LinearEasing)),
            label = "blob${spec.durationMs}"
        )
    }

    Box(modifier.fillMaxSize().background(ground)) {
        specs.forEachIndexed { i, spec ->
            LiquidBlob(
                spec = spec,
                progress = progress[i],
                amplitude = amplitude,
                blurRadius = blurRadius,
                layerAlpha = LiquidTuning.pageOpacity,
            )
        }
    }
}

/** 23s / 29s divided by `pageEnergy` — the same paths, run faster. */
private fun periodMs(seconds: Float): Int =
    (seconds / max(0.1f, LiquidTuning.pageEnergy) * 1000f).toInt()

/**
 * One blob: a SOLID ellipse under a heavy blur, exactly as iOS draws it.
 *
 * The blur is the whole look. A blurred solid has a dense, flat core that fades
 * only at its rim, which is what gives the wash body; the radial gradient this
 * used to be was densest at a single point and fell away immediately, so it read
 * as a pale haze no matter how the alphas were tuned.
 *
 * `Modifier.blur` needs API 31. Below that it silently does nothing and we would
 * be drawing hard-edged ellipses, so those devices get a flat-CORE radial
 * gradient instead — not the real thing, but it keeps the dense middle that
 * matters rather than falling back to the haze.
 */
@Composable
private fun LiquidBlob(
    spec: BlobSpec,
    progress: State<Float>,
    amplitude: Float,
    blurRadius: Dp,
    layerAlpha: Float,
) {
    val canBlur = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val alpha = spec.alpha * layerAlpha

    // The wander, applied as a graphics-layer transform on the BLURRED shape —
    // which is what iOS does too (`.blur()` then `.scaleEffect()`), so the blur
    // scales with the blob rather than staying a fixed width as it grows.
    //
    // It is also the difference between 60fps and 40% dropped frames. Driving
    // the motion through `layout` re-measured both blobs every frame, and a
    // re-measure of a blurred layer means rebuilding its RenderEffect 60 times a
    // second. Reading `progress` INSIDE this lambda keeps it off the composition
    // and draw phases entirely — only the layer transform re-runs.
    val wander: Modifier = Modifier.graphicsLayer {
        val stop = sample(spec.stops, progress.value)
        scaleX = stop.scale
        scaleY = stop.scale
        translationX = stop.x * size.width * amplitude
        translationY = stop.y * size.height * amplitude
    }

    if (canBlur) {
        Box(
            Modifier
                .blobLayout(spec)
                .then(wander)
                // `Unbounded`, and that is the whole difference between a wash
                // and two hard rectangles. `Modifier.blur` defaults to
                // `BlurredEdgeTreatment.Rectangle`, which clips the result back
                // to the layer's own bounds — so a 64dp blur on a blob wider
                // than the screen had its entire soft rim cut off square, and
                // what landed was a sharp-edged block of colour.
                .blur(blurRadius, BlurredEdgeTreatment.Unbounded)
                // CircleShape on a NON-square box is a 50% rounded rect — i.e.
                // the ellipse the spec calls for, with no path maths.
                .clip(androidx.compose.foundation.shape.CircleShape)
                .background(spec.hue.copy(alpha = alpha))
        )
    } else {
        Canvas(Modifier.blobLayout(spec).then(wander)) {
            val rx = size.width / 2f
            val ry = size.height / 2f
            if (rx <= 0f || ry <= 0f) return@Canvas
            val centre = Offset(rx, ry)
            scale(scaleX = 1f, scaleY = ry / rx, pivot = centre) {
                drawCircle(
                    brush = Brush.radialGradient(
                        // Flat core out to 55%, then a fast fade — the shape a
                        // blurred solid actually has.
                        0.00f to spec.hue.copy(alpha = alpha),
                        0.55f to spec.hue.copy(alpha = alpha * 0.94f),
                        1.00f to spec.hue.copy(alpha = 0f),
                        center = centre,
                        radius = rx,
                    ),
                    radius = rx,
                    center = centre,
                    style = Fill,
                )
            }
        }
    }
}

/**
 * Size the blob from the container and place it, including its wander.
 *
 * A custom `layout` because the geometry is all FRACTIONS OF THE PARENT — width,
 * height, both edge anchors and the travel — and there is no modifier chain that
 * expresses "1.05 times my parent's width" directly.
 */
private fun Modifier.blobLayout(spec: BlobSpec): Modifier =
    this.layout { measurable, constraints ->
        val cw = constraints.maxWidth.toFloat()
        val ch = constraints.maxHeight.toFloat()
        val w = (cw * spec.w).toInt().coerceAtLeast(0)
        val h = (ch * spec.h).toInt().coerceAtLeast(0)
        val placeable = measurable.measure(
            constraints.copy(minWidth = w, maxWidth = w, minHeight = h, maxHeight = h)
        )
        // Anchored off one edge or the other — the diagonal. FIXED: the wander
        // is a graphicsLayer transform (see LiquidBlob), never a re-layout.
        val baseX = spec.leading?.let { it * cw } ?: (cw - (spec.trailing ?: 0f) * cw - w)
        val baseY = spec.top * ch
        layout(constraints.maxWidth, constraints.maxHeight) {
            placeable.place(baseX.toInt(), baseY.toInt())
        }
    }

/**
 * The non-liquid branch of `PageBackground` — the same ground with ONE soft glow
 * in the upper right, and no animation at all.
 *
 * A port of iOS `AmbientCanvas`, including its two decisions:
 *
 *  · the glow shows on LIGHT presets only, because on a dark ground it muddies
 *    rather than lifts;
 *  · upper-right ONLY. A second glow low down pooled a soft colour band at the
 *    bottom of any page with empty space (Home, most obviously), which read as a
 *    footer nobody had designed.
 *
 * Nothing here is animated, which is the whole point of the toggle: with Liquid
 * Motion off the app stops running two infinite animations behind every screen.
 */
@Composable
private fun AmbientCanvas(modifier: Modifier = Modifier, ground: Brush) {
    val c = traQSColors
    Box(modifier.fillMaxSize().background(ground)) {
        if (!c.isLight) return@Box
        Canvas(Modifier.fillMaxSize()) {
            val hue = LiquidColor.vivid(c.accent, LiquidTuning.saturation)
            // iOS's glow offset of (130, -210) carried over as a fraction of the
            // canvas, so it lands in the same place on any screen size.
            val cx = size.width * 0.5f + size.width * 0.34f
            val cy = size.height * 0.5f - size.height * 0.26f
            val r = size.minDimension * 0.95f
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        hue.copy(alpha = 0.30f * LiquidTuning.pageOpacity),
                        hue.copy(alpha = 0.14f * LiquidTuning.pageOpacity),
                        hue.copy(alpha = 0f),
                    ),
                    center = Offset(cx, cy),
                    radius = r,
                ),
                radius = r,
                center = Offset(cx, cy),
            )
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
