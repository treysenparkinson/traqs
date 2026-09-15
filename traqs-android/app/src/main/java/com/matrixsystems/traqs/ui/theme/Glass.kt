package com.matrixsystems.traqs.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ripple
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// The app's frosted-glass language, ported from iOS Views/Primitives.swift.
//
// WHAT IS DIFFERENT FROM iOS, and why. On iOS a frosted surface is a real
// backdrop blur (`.ultraThinMaterial`) with a tint laid over it. Android has no
// built-in backdrop blur for arbitrary composables — `Modifier.blur` blurs the
// view itself, not what is behind it — so there is nothing here to blur with.
//
// So the tint carries the effect alone, at roughly 3x the iOS opacity (see
// `glassSurfaceTint`). Over the drifting LiquidBackground this still reads as a
// translucent pane catching colour from the page: you see the wash move behind
// the card, you just do not see it go soft. The rim and the shadow are doing
// more of the work of saying "glass" here than they do on iOS, which is why
// neither is optional on a hero surface.

// ── The app-wide glass edge ────────────────────────────────────────────────
//
// One recipe, used by every frosted surface: a glare across the top lip, a
// darker band down the sides, then the bottom lip lit again — light entering the
// top of a bubble of glass and bouncing back out of the bottom. Top and bottom
// both lit is the single detail that separates this from a plain bevel.
//
// Drawn as ONE vertical gradient so the whole top arc of a rounded rect glows
// and the whole bottom arc glows, with the straight left/right runs dimmest in
// between. A diagonal gradient was tried first and lit one corner while
// shadowing the opposite one — a single hard light source, not a lens.
@Composable
fun Modifier.specularRim(shape: Shape, width: Dp? = null): Modifier {
    val c = traQSColors
    val brush = remember(c) {
        Brush.verticalGradient(
            0.00f to Color.White.copy(alpha = c.rimTop),
            c.rimLip to c.rimSide,
            (1f - c.rimLip) to c.rimSide,
            1.00f to Color.White.copy(alpha = c.rimBot),
        )
    }
    return this.border(BorderStroke(width ?: c.rimWidth, brush), shape)
}

// The plain edge, for surfaces that should not read as glass — and for the flat
// branch of anything that can lose its frost.
@Composable
fun Modifier.flatHairline(shape: Shape, width: Dp = 1.dp): Modifier =
    this.border(width, traQSColors.border, shape)

// THE card surface. Backs most of the app, so changing it here beats converting
// each call site.
//
// `rim = false` for rows in a long list — the glass bevel is for cards, and at
// row scale it reads as a bright wire tracing every item.
// `c.frosted` is the Customize > Frosted Glass toggle. Off, a card goes fully
// opaque and drops the specular rim for a plain hairline — the flat surface iOS
// describes as "*Off flattens cards and panels". It is read HERE, in the one
// place the glass recipe is defined, so the toggle reaches every card-shaped
// thing in the app without a per-screen sweep.
@Composable
fun Modifier.frostedCard(radius: Dp = TRadius.hero, rim: Boolean = true): Modifier {
    val c = traQSColors
    val shape = RoundedCornerShape(radius)
    return this
        .clip(shape)
        .background(c.surface.copy(alpha = if (c.frosted) glassSurfaceTint else 1f), shape)
        .then(if (rim && c.frosted) Modifier.specularRim(shape) else Modifier.flatHairline(shape))
}

// Same treatment, fully pill-shaped.
@Composable
fun Modifier.frostedPill(rim: Boolean = true): Modifier {
    val c = traQSColors
    val shape = CircleShape
    return this
        .clip(shape)
        .background(c.surface.copy(alpha = if (c.frosted) glassSurfaceTint else 1f), shape)
        .then(if (rim && c.frosted) Modifier.specularRim(shape) else Modifier.flatHairline(shape))
}

// The heavier frost for a modal. Thinner tint than a card (see
// `modalSurfaceTint`) but it carries a real shadow, because a popup has to
// separate from the page behind it in a way a card sitting in a list does not.
@Composable
fun Modifier.glassPanel(radius: Dp = TRadius.lg): Modifier {
    val c = traQSColors
    val shape = RoundedCornerShape(radius)
    return this
        .shadow(TElevation.ambient, shape, clip = false)
        .clip(shape)
        .background(c.surface.copy(alpha = if (c.frosted) modalSurfaceTint else 1f), shape)
        .then(if (c.frosted) Modifier.specularRim(shape) else Modifier.flatHairline(shape))
}

// Ambient float — for hero surfaces and the nav pill. Kept off `frostedCard`
// deliberately: that renders per-row down long lists, and a shadow there costs
// an offscreen pass per item.
@Composable
fun Modifier.ambientFloat(shape: Shape): Modifier =
    this.shadow(TElevation.ambient, shape, clip = false)

// A control sitting ON a card — a keypad key, a header pill, an unfilled toggle.
// Solid-ish rather than translucent: buttons need to read as opaque objects on
// the glass, not as more glass.
@Composable
fun Modifier.glassControl(shape: Shape = CircleShape): Modifier {
    val c = traQSColors
    return this
        .clip(shape)
        .background(c.surface.copy(alpha = 0.90f), shape)
        .border(1.dp, c.controlHairline, shape)
}

// THE card. A drop-in for Material3's `Card` — same trailing ColumnScope lambda —
// but painted in the app's own language instead of Material's opaque surface +
// elevation. Every card-shaped thing in the app goes through this, so the glass
// recipe has exactly one definition to change.
//
// `rim = false` for rows in a long list; see frostedCard.
// `tint` + `ring` override the glass for a card that has to carry a STATE — the
// job you are clocked into, say. State colour beats material: a row you need to
// find down a long list cannot be made of the same stuff as the rows around it.
// Leave both null for the ordinary frosted surface.
@Composable
fun TCard(
    modifier: Modifier = Modifier,
    radius: Dp = TRadius.md,
    rim: Boolean = true,
    tint: Color? = null,
    ring: Color? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(radius)
    val base = if (tint != null) {
        Modifier
            .clip(shape)
            .background(tint, shape)
            .border(1.dp, ring ?: traQSColors.border, shape)
    } else {
        Modifier.frostedCard(radius = radius, rim = rim)
    }
    Column(
        modifier = modifier
            .then(base)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        content = content,
    )
}

// ── Progress ───────────────────────────────────────────────────────────────

// The circular progress ring. A track at `progressTrack` with the brand gradient
// swept over it from 12 o'clock, round-capped. Mirrors iOS GradientRing.
@Composable
fun GradientRing(
    pct: Double,
    modifier: Modifier = Modifier,
    lineWidth: Dp = 14.dp,
) {
    val c = traQSColors
    val sweep = (pct.coerceIn(0.0, 100.0) / 100.0 * 360.0).toFloat()
    Canvas(modifier) {
        val stroke = Stroke(width = lineWidth.toPx(), cap = StrokeCap.Round)
        val inset = lineWidth.toPx() / 2f
        val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
        val topLeft = Offset(inset, inset)
        // Ink at low alpha, NOT `progressTrack`. That token is near-white on the
        // light presets — fine on iOS where the card is a real blur over a
        // stronger wash, but here it sits on a pale frosted card and the ring
        // vanished entirely at 0%, leaving the number floating in space.
        drawCircle(
            color = c.text.copy(alpha = 0.09f),
            radius = (size.minDimension - lineWidth.toPx()) / 2f,
            style = Stroke(width = lineWidth.toPx()),
        )
        if (sweep > 0f) {
            drawArc(
                brush = Brush.linearGradient(c.brandGradient),
                startAngle = -90f,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = stroke,
            )
        }
    }
}

// The linear progress bar under a job card. `fill` overrides the brand gradient
// for a state colour — amber past the estimate, the department colour when the
// work is queued rather than tracking.
@Composable
fun Bar(
    pct: Double,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp,
    fill: Color? = null,
) {
    val c = traQSColors
    val f = (pct.coerceIn(0.0, 100.0) / 100.0).toFloat()
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(CircleShape)
            .background(c.progressTrack, CircleShape)
    ) {
        if (f > 0f) {
            Box(
                Modifier
                    .fillMaxWidth(f)
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(
                        if (fill != null) SolidColor(fill)
                        else Brush.horizontalGradient(c.brandGradient),
                        CircleShape
                    )
            )
        }
    }
}

// ── Semantic pills ─────────────────────────────────────────────────────────

enum class TagKind { INDIGO, AMBER, GREEN, SKY, MAGENTA, RED, NEUTRAL }

@Composable
fun TagKind.bg(): Color = traQSColors.let {
    when (this) {
        TagKind.INDIGO -> it.pillIndigoBg
        TagKind.AMBER -> it.pillAmberBg
        TagKind.GREEN -> it.pillGreenBg
        TagKind.SKY -> if (it.isLight) Color(0xFFDCEAFD) else Color(0xFF1E3050)
        TagKind.MAGENTA -> if (it.isLight) Color(0xFFFBE0F2) else Color(0xFF45203A)
        TagKind.RED -> if (it.isLight) Color(0xFFFDE2E2) else Color(0xFF4A2424)
        TagKind.NEUTRAL -> it.pillNeutralBg
    }
}

@Composable
fun TagKind.fg(): Color = traQSColors.let {
    when (this) {
        TagKind.INDIGO -> it.pillIndigoFg
        TagKind.AMBER -> it.pillAmberFg
        TagKind.GREEN -> it.pillGreenFg
        TagKind.SKY -> if (it.isLight) Color(0xFF2F74E0) else Color(0xFF7FB0F5)
        TagKind.MAGENTA -> if (it.isLight) Color(0xFFC026A6) else Color(0xFFE87FD0)
        TagKind.RED -> if (it.isLight) Color(0xFFDC2626) else Color(0xFFF08080)
        TagKind.NEUTRAL -> it.pillNeutralFg
    }
}

@Composable
fun TagPill(
    label: String,
    kind: TagKind = TagKind.INDIGO,
    dot: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val fg = kind.fg()
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(kind.bg(), CircleShape)
            // Thinner than the house width: a chip is ~20dp tall, and the full
            // rim reads as a bright outline at that size rather than as an edge
            // catching light.
            .specularRim(CircleShape, width = 0.8.dp)
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        if (dot) Box(Modifier.size(6.dp).clip(CircleShape).background(fg))
        Text(
            label.uppercase(),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.4.sp,
            color = fg,
        )
    }
}

// ── The one primary CTA ────────────────────────────────────────────────────
//
// The brand gradient on a capsule with its accent glow beneath. One per page
// header — see the button-hierarchy rule; a second one on screen means neither
// is primary.
@Composable
fun GradientCTA(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    verticalPadding: Dp = 14.dp,
    content: @Composable RowScope.() -> Unit,
) {
    val c = traQSColors
    val shape = CircleShape
    val dim = !enabled || busy
    Row(
        modifier = modifier
            .shadow(TElevation.cta, shape, ambientColor = c.ctaGlow, spotColor = c.ctaGlow)
            .clip(shape)
            .background(Brush.horizontalGradient(c.brandGradient), shape)
            .then(if (dim) Modifier.background(c.bg.copy(alpha = 0.45f), shape) else Modifier)
            .clickable(
                enabled = enabled && !busy,
                interactionSource = remember { MutableInteractionSource() },
                indication = ripple(color = c.onGradient),
                onClick = onClick
            )
            .padding(horizontal = 18.dp, vertical = verticalPadding),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (busy) {
            CircularProgressIndicator(
                color = c.onGradient, strokeWidth = 2.dp, modifier = Modifier.size(16.dp)
            )
            Spacer(Modifier.width(8.dp))
        }
        content()
    }
}
