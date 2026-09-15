package com.matrixsystems.traqs.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.TTypo
import com.matrixsystems.traqs.ui.theme.glassControl
import com.matrixsystems.traqs.ui.theme.glassSurfaceTint
import com.matrixsystems.traqs.ui.theme.specularRim
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ============================================================================
// Clock PIN pad
//
// A port of iOS `ClockPinOverlay` (Views/TimeClockView.swift). This replaces a
// stock Material `AlertDialog` holding an `OutlinedTextField`, which pulled up
// the system keyboard and looked nothing like the rest of the app — the one
// place a worker touches the app every single day.
//
// The pad runs the WHOLE action itself: the keypad gives way to a spinner in the
// same panel, the spinner becomes a tick, and only then does it leave. That is
// why it cannot simply close on submit — a wrong PIN springs it back to entry
// with an error instead.
// ============================================================================

/** Where the pad is in its own flow. */
private enum class PadPhase { ENTRY, WORKING, DONE }

/** The key grid. Action row below it is Delete · 0 · Confirm. */
private val DIGIT_ROWS = listOf(
    listOf("1", "2", "3"),
    listOf("4", "5", "6"),
    listOf("7", "8", "9"),
)

private val KEY_SIZE = 72.dp
private val KEY_SPACING = 16.dp
/** This pad is where the app's big radius came from; `TRadius.hero` is the same 42. */
private val PAD_RADIUS = 42.dp
/**
 * Side of the square the pad becomes once the PIN is submitted. At rest the pad
 * is a tall keypad-shaped rectangle; once committed there is one mark and one
 * word in it, and holding the keypad's proportions left them stranded in a wide
 * empty panel.
 */
private val PAD_SQUARE_SIDE = 168.dp
private const val MAX_DIGITS = 8

/**
 * @param title        the verb — "Clock In" / "Clock Out".
 * @param personName   whose PIN, when clocking someone else in.
 * @param onClose      called for cancel AND after a successful PIN, once the pad
 *                     has run its own exit. The caller must NOT dismiss from
 *                     `onSubmit`.
 * @param onSubmit     verifies the PIN; true closes the pad, false shows the error.
 */
@Composable
fun ClockPinPad(
    title: String,
    personName: String? = null,
    onClose: () -> Unit,
    onSubmit: (String, (Boolean) -> Unit) -> Unit,
) {
    val c = traQSColors
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var phase by remember { mutableStateOf(PadPhase.ENTRY) }
    val submitting = phase != PadPhase.ENTRY

    fun submit() {
        if (pin.isEmpty() || submitting) return
        phase = PadPhase.WORKING
        onSubmit(pin) { ok ->
            if (ok) {
                phase = PadPhase.DONE
                scope.launch {
                    // Long enough for the tick to draw and be read.
                    delay(850)
                    onClose()
                }
            } else {
                pin = ""
                phase = PadPhase.ENTRY
                error = "Incorrect PIN"
            }
        }
    }

    Dialog(
        onDismissRequest = { if (!submitting) onClose() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                // Dimmed backdrop, the same scrim the other popups use. The pad
                // is glass, so the scrim only has to separate it from the page.
                .background(Color.Black.copy(alpha = 0.45f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() }
                ) { if (!submitting) onClose() },
            contentAlignment = Alignment.Center
        ) {
            val shape = RoundedCornerShape(PAD_RADIUS)
            Box(
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .widthIn(max = 360.dp)
                    .clip(shape)
                    // A hair thinner than the app-wide popup tint: the pad is
                    // mostly big round keys with air between them, so it can let
                    // more of the page through before content starts to swim.
                    .background(
                        c.surface.copy(alpha = if (c.frosted) glassSurfaceTint * 0.92f else 1f),
                        shape
                    )
                    .then(if (c.frosted) Modifier.specularRim(shape) else Modifier)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() }
                    ) { /* swallow taps so the scrim's dismiss doesn't fire through */ }
            ) {
                Column(
                    modifier = Modifier.padding(26.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(18.dp)
                ) {
                    if (phase == PadPhase.ENTRY) {
                        EntryContent(
                            title = title,
                            personName = personName,
                            pin = pin,
                            error = error,
                            onDigit = { d ->
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                if (pin.length < MAX_DIGITS) { error = null; pin += d }
                            },
                            onDelete = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                if (pin.isNotEmpty()) { pin = pin.dropLast(1); error = null }
                            },
                            onConfirm = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                submit()
                            }
                        )
                    } else {
                        ProgressContent(done = phase == PadPhase.DONE, title = title)
                    }
                }

                // Cancel, anchored INSIDE the card's top-left. Gone once the
                // request is out — there is nothing to cancel from here any more,
                // and a live X beside a spinner invites a tap that would only
                // orphan the action.
                if (phase == PadPhase.ENTRY) {
                    Box(
                        modifier = Modifier
                            .padding(16.dp)
                            .size(38.dp)
                            .glassControl()
                            .clickable(onClick = onClose),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(TIcons.Close, "Cancel", tint = c.text, modifier = Modifier.size(15.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.EntryContent(
    title: String,
    personName: String?,
    pin: String,
    error: String?,
    onDigit: (String) -> Unit,
    onDelete: () -> Unit,
    onConfirm: () -> Unit,
) {
    val c = traQSColors

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(title, style = TTypo.h3(20.sp), color = c.text)
        Text(
            personName?.let { "Enter $it's PIN" } ?: "Enter your PIN",
            style = TTypo.xs(12.sp), color = c.muted
        )
    }

    // PIN dots — at least four, growing with a longer PIN.
    Row(
        modifier = Modifier.height(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(maxOf(pin.length, 4)) { i ->
            val filled = i < pin.length
            Box(
                Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(if (filled) c.gradStart else c.text.copy(alpha = 0.12f))
            )
        }
    }

    if (error != null) {
        Text(error, style = TTypo.xs(12.sp), color = c.red, textAlign = TextAlign.Center)
    }

    // Circular, tap-friendly keypad.
    Column(verticalArrangement = Arrangement.spacedBy(KEY_SPACING)) {
        DIGIT_ROWS.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(KEY_SPACING)) {
                row.forEach { d -> DigitKey(d) { onDigit(d) } }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(KEY_SPACING)) {
            // Backspace, not an X — this rubs out the last digit, and an X next
            // to the card's cancel X read as a second way to close the pad.
            ActionKey(icon = TIcons.Backspace, filled = false, enabled = true, onClick = onDelete)
            DigitKey("0") { onDigit("0") }
            ActionKey(icon = TIcons.Check, filled = true, enabled = pin.isNotEmpty(), onClick = onConfirm)
        }
    }
}

/** A round digit key, in the app's glass language. */
@Composable
private fun DigitKey(digit: String, onClick: () -> Unit) {
    val c = traQSColors
    Box(
        modifier = Modifier
            .size(KEY_SIZE)
            .glassControl()
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(digit, style = TTypo.h2(26.sp), color = c.text)
    }
}

/**
 * A round action key: delete (neutral glass) or confirm (the brand gradient, the
 * same fill as Clock In and the Start buttons).
 */
@Composable
private fun ActionKey(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    filled: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val c = traQSColors
    Box(
        modifier = Modifier
            .size(KEY_SIZE)
            .then(
                if (filled) Modifier
                    .clip(CircleShape)
                    .background(
                        if (enabled) Brush.horizontalGradient(c.brandGradient)
                        else androidx.compose.ui.graphics.SolidColor(c.muted.copy(alpha = 0.35f)),
                        CircleShape
                    )
                else Modifier.glassControl()
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            icon, null,
            tint = if (filled) c.onGradient else c.text,
            modifier = Modifier.size(24.dp)
        )
    }
}

/**
 * Working and landed. The panel keeps its glass and shrinks around this, so the
 * pad becomes the confirmation rather than handing off to one.
 */
@Composable
private fun ProgressContent(done: Boolean, title: String) {
    val c = traQSColors
    // "Clock In" -> "Clocked In". The pad is told a verb; this is its past tense.
    val label = if (done) (if (title.endsWith("In")) "Clocked In" else "Clocked Out") else title
    val scale by animateFloatAsState(
        targetValue = if (done) 1f else 0.8f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "mark"
    )
    Column(
        modifier = Modifier.size(PAD_SQUARE_SIDE),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)
    ) {
        if (done) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .scale(scale)
                    .clip(CircleShape)
                    .background(Brush.horizontalGradient(c.brandGradient), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(TIcons.Check, null, tint = c.onGradient, modifier = Modifier.size(30.dp))
            }
        } else {
            CircularProgressIndicator(
                modifier = Modifier.size(44.dp),
                color = c.accent,
                strokeWidth = 4.dp
            )
        }
        Text(
            label,
            style = TTypo.h3(17.sp),
            color = c.text,
            maxLines = 1,
            textAlign = TextAlign.Center
        )
    }
}
