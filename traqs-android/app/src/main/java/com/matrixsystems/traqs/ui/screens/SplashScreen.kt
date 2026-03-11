package com.matrixsystems.traqs.ui.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

// ── Radiating line definitions ───────────────────────────────────────────────

private data class LineDef(
    val angleDeg: Float,
    val length: Float,
    val colorHex: String,
    val strokeWidth: Float,
    val delayMs: Long
)

private val SPLASH_LINES = listOf(
    LineDef(  0f, 90f, "#3d7fff", 2.0f,   0),
    LineDef( 30f, 65f, "#8b5cf6", 1.5f,  80),
    LineDef( 60f, 75f, "#14b8a6", 1.0f,  30),
    LineDef( 90f, 95f, "#f59e0b", 2.0f, 110),
    LineDef(120f, 60f, "#ec4899", 1.5f,  60),
    LineDef(150f, 80f, "#22c55e", 1.0f, 160),
    LineDef(180f, 90f, "#3d7fff", 2.0f,  20),
    LineDef(210f, 70f, "#f97316", 1.5f, 100),
    LineDef(240f, 75f, "#8b5cf6", 1.0f,  50),
    LineDef(270f, 95f, "#14b8a6", 2.0f, 130),
    LineDef(300f, 65f, "#ef4444", 1.5f,  75),
    LineDef(330f, 80f, "#f59e0b", 1.0f, 180),
    LineDef( 15f, 45f, "#ec4899", 0.8f, 200),
    LineDef( 75f, 50f, "#22c55e", 0.8f, 150),
    LineDef(195f, 40f, "#3d7fff", 0.8f,  90),
    LineDef(285f, 48f, "#f97316", 0.8f, 220),
)

// ── Wipe bar count ────────────────────────────────────────────────────────────

private const val BAR_COUNT = 16

// ── Splash screen ─────────────────────────────────────────────────────────────

@Composable
fun SplashScreen(onFinished: () -> Unit) {
    val c = traQSColors

    val logoScale  = remember { Animatable(0f) }
    val logoAlpha  = remember { Animatable(0f) }
    // One progress value per wipe bar
    val bars       = remember { List(BAR_COUNT) { Animatable(0f) } }

    LaunchedEffect(Unit) {
        // Logo bounces in
        launch { logoAlpha.animateTo(1f, tween(250)) }
        logoScale.animateTo(
            targetValue = 1f,
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioMediumBouncy,
                stiffness    = Spring.StiffnessMediumLow
            )
        )

        // Hold so the animation is visible
        delay(900)

        // Horizontal wipe bars fire staggered from top to bottom
        val barJobs = bars.mapIndexed { i, anim ->
            launch {
                delay((i * 18).toLong())
                anim.animateTo(
                    targetValue = 1f,
                    animationSpec = tween(260, easing = FastOutLinearInEasing)
                )
            }
        }
        barJobs.forEach { it.join() }

        onFinished()
    }

    // Read all bar progress values in composable scope so Canvas redraws on change
    val barValues = bars.map { it.value }
    val bgColor   = c.bg

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(c.bg),
        contentAlignment = Alignment.Center
    ) {
        // Radiating streak lines
        SPLASH_LINES.forEach { def -> SplashLine(def) }

        // TRAQS logo — bouncy spring
        TRAQSLogo(
            modifier = Modifier
                .fillMaxWidth(0.58f)
                .aspectRatio(225f / 40f)
                .graphicsLayer {
                    scaleX = logoScale.value
                    scaleY = logoScale.value
                    alpha  = logoAlpha.value
                },
            useDefaultSize = false
        )

        // Horizontal wipe overlay — even bars slide from left, odd from right
        Canvas(modifier = Modifier.fillMaxSize()) {
            val barH = size.height / BAR_COUNT + 1f   // +1 closes any sub-pixel gap
            barValues.forEachIndexed { i, p ->
                val w = size.width * p
                val y = i * (size.height / BAR_COUNT)
                val x = if (i % 2 == 0) 0f else size.width - w
                drawRect(
                    color    = bgColor,
                    topLeft  = Offset(x, y),
                    size     = Size(w, barH)
                )
            }
        }
    }
}

// ── Individual radiating streak ───────────────────────────────────────────────

@Composable
private fun SplashLine(def: LineDef) {
    val progress = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        delay(def.delayMs)
        progress.animateTo(1f, tween(820, easing = FastOutSlowInEasing))
    }

    val color    = try { parseColor(def.colorHex) } catch (_: Exception) { parseColor("#3d7fff") }
    val p        = progress.value
    val leading  = p
    val trailing = (p - 0.35f).coerceAtLeast(0f) / 0.65f
    val alpha    = (sin(p * PI) * 0.85f).toFloat().coerceIn(0f, 0.85f)
    val angleRad = Math.toRadians(def.angleDeg.toDouble())
    val cosA     = cos(angleRad).toFloat()
    val sinA     = sin(angleRad).toFloat()

    Canvas(modifier = Modifier.fillMaxSize()) {
        val cx      = size.width  / 2f
        val cy      = size.height / 2f
        val innerPx = 55.dp.toPx()
        val maxPx   = def.length.dp.toPx()
        val startPx = innerPx + maxPx * trailing
        val endPx   = innerPx + maxPx * leading

        if (endPx > startPx) {
            drawLine(
                color       = color.copy(alpha = alpha),
                start       = Offset(cx + cosA * startPx, cy + sinA * startPx),
                end         = Offset(cx + cosA * endPx,   cy + sinA * endPx),
                strokeWidth = def.strokeWidth.dp.toPx(),
                cap         = StrokeCap.Round
            )
        }
    }
}
