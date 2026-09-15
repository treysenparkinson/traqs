package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.*
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.BorderStroke
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.R
import com.matrixsystems.traqs.models.JobStatus
import com.matrixsystems.traqs.models.Priority
import com.matrixsystems.traqs.ui.theme.TRAQSColors
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.glassControl
import com.matrixsystems.traqs.ui.theme.TRadius
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun StatusBadge(status: JobStatus) {
    val c = traQSColors
    val color = status.toColor(c)
    Text(
        text = status.label,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        color = color,
        modifier = Modifier
            .background(color.copy(alpha = 0.13f), RoundedCornerShape(TRadius.xs))
            .padding(horizontal = 7.dp, vertical = 3.dp)
    )
}

@Composable
fun PriorityDot(priority: Priority) {
    val c = traQSColors
    val color = priority.toColor(c)
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(color)
    )
}

@Composable
fun FilterChip(
    label: String,
    isSelected: Boolean,
    color: Color = traQSColors.accent,
    onClick: () -> Unit
) {
    val c = traQSColors
    Button(
        onClick = onClick,
        shape = RoundedCornerShape(TRadius.md),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (isSelected) color.copy(alpha = 0.15f) else c.surface,
            contentColor = if (isSelected) color else c.text.copy(alpha = 0.6f)
        ),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
        modifier = Modifier.height(32.dp)
    ) {
        Text(text = label, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SaveStatusBanner(saveStatus: com.matrixsystems.traqs.services.SaveStatus) {
    val c = traQSColors
    when (saveStatus) {
        is com.matrixsystems.traqs.services.SaveStatus.Saving -> {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .background(c.surface.copy(alpha = 0.9f), RoundedCornerShape(TRadius.md))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp)
                Text("Saving…", fontSize = 12.sp, color = Color.White)
            }
        }
        is com.matrixsystems.traqs.services.SaveStatus.Saved -> {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .background(c.surface.copy(alpha = 0.9f), RoundedCornerShape(TRadius.md))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Icon(TIcons.Check, null, tint = c.statusFinished, modifier = Modifier.size(12.dp))
                Text("Saved", fontSize = 12.sp, color = c.text)
            }
        }
        else -> {}
    }
}

fun String.shortDate(): String {
    return try {
        val parser = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val fmt = SimpleDateFormat("M/d/yy", Locale.US)
        fmt.format(parser.parse(this)!!)
    } catch (_: Exception) { this }
}

fun com.matrixsystems.traqs.services.SaveStatus.isSaving() = this is com.matrixsystems.traqs.services.SaveStatus.Saving

fun JobStatus.toColor(c: TRAQSColors): Color = when (this) {
    JobStatus.NOT_STARTED -> c.statusNotStarted
    JobStatus.PENDING -> c.statusPending
    JobStatus.IN_PROGRESS -> c.statusInProgress
    JobStatus.ON_HOLD -> c.statusOnHold
    JobStatus.FINISHED -> c.statusFinished
}

fun Priority.toColor(c: TRAQSColors): Color = when (this) {
    Priority.LOW -> c.priLow
    Priority.MEDIUM -> c.priMedium
    Priority.HIGH -> c.priHigh
}

// The brand wordmark. Same art the iOS app ships
// (traqs-wordmark-bold-ink / -paper, 2348x1200) so the two platforms are
// literally the same mark, not two renderings of it.
//
// `size` is the rendered HEIGHT; the frame is DEFINITE in both axes on purpose.
// Constrained on height alone the image has no minimum intrinsic width, so it is
// the first thing a tight header row compresses — and since the ratio is
// preserved, losing width also loses height. That is how one wider header
// control silently shrinks the logo on every page.
private const val WORDMARK_ASPECT = 2348f / 1200f

@Composable
fun TRAQSLogo(height: Dp = 28.dp, modifier: Modifier = Modifier, useDefaultSize: Boolean = true) {
    val c = traQSColors
    val logoRes = if (c.isLight) R.drawable.traqs_logo else R.drawable.traqs_logo_white
    Image(
        painter = painterResource(logoRes),
        contentDescription = "TRAQS",
        contentScale = ContentScale.Fit,
        modifier = if (useDefaultSize) modifier.height(height).width(height * WORDMARK_ASPECT) else modifier
    )
}

// Which view the Jobs tab is showing. iOS calls this AppNav.jobsMode; the Jobs
// tab subsumed the old Schedule tab there, and the header toggle is how you get
// between them.
enum class JobsMode { LIST, GANTT }

// The Jobs header's view toggle. Names the CURRENT view rather than the one the
// tap leads to — the two glyphs alone did not say which way the tap would go.
//
// FIXED width, sized for the wider label: the Jobs header is deliberately stable
// across a mode flip, so the pill must not change width when the label does.
@Composable
fun JobsViewToggle(mode: JobsMode, onToggle: (JobsMode) -> Unit) {
    val c = traQSColors
    val isList = mode == JobsMode.LIST
    Box(
        modifier = Modifier
            .width(76.dp)
            .height(38.dp)
            .glassControl()
            .clickable { onToggle(if (isList) JobsMode.GANTT else JobsMode.LIST) },
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(
                if (isList) TIcons.Jobs else TIcons.Calendar,
                contentDescription = null,
                tint = c.text,
                modifier = Modifier.size(13.dp)
            )
            Text(
                if (isList) "List" else "Plan",
                fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.text,
            )
        }
    }
}

// A person's avatar: their profile photo if they have one, else their initials
// on their own colour. Mirrors iOS Avatar.
//
// `image` is a data: URL / base64 blob carried on the person record — the same
// shape iOS decodes — so there is no network fetch here and no image library to
// pull in. A malformed blob falls through to initials rather than showing a
// broken box.
@Composable
fun Avatar(person: com.matrixsystems.traqs.models.Person?, size: Dp = 38.dp) {
    val c = traQSColors
    val bg = remember(person?.color) {
        runCatching { parseColor(person?.color ?: "#7c3aed") }.getOrDefault(Color(0xFF7C3AED))
    }
    val bitmap = remember(person?.image) { decodeAvatar(person?.image) }

    Box(
        modifier = Modifier.size(size).clip(CircleShape).background(bg),
        contentAlignment = Alignment.Center
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = person?.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(CircleShape)
            )
        } else {
            val initials = (person?.name ?: "")
                .split(" ").filter { it.isNotBlank() }.take(2)
                .mapNotNull { it.firstOrNull()?.uppercaseChar() }
                .joinToString("")
            Text(
                initials.ifEmpty { "?" },
                fontSize = (size.value * 0.36f).sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
        }
    }
}

private fun decodeAvatar(data: String?): androidx.compose.ui.graphics.ImageBitmap? {
    if (data.isNullOrBlank()) return null
    return runCatching {
        // Accept both a bare base64 payload and a full data: URL.
        val payload = data.substringAfter("base64,", data)
        val bytes = android.util.Base64.decode(payload, android.util.Base64.DEFAULT)
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?.asImageBitmap()
    }.getOrNull()
}

// The TRAQS "bars" mark — four stacked bars, the third one the accent. Drawn in
// Compose rather than shipped as a raster so it follows the customizer's accent
// and the light/dark preset, exactly as iOS TRAQSBarsMark does.
@Composable
fun TRAQSBarsMark(size: Dp) {
    val c = traQSColors
    // Bar widths as a fraction of the mark's full width, top to bottom, measured
    // from the original artwork. The third (full-width) bar is the accent bar.
    val widths = listOf(0.554f, 0.788f, 1.0f, 0.451f)
    val accentIndex = 2
    val aspect = 184f / 150f
    val fullWidth = size * aspect
    val barH = size * (27f / 150f)
    val gap = size * (14f / 150f)

    Column(
        modifier = Modifier.width(fullWidth).height(size),
        verticalArrangement = Arrangement.spacedBy(gap)
    ) {
        widths.forEachIndexed { i, w ->
            Box(
                Modifier
                    .width(fullWidth * w)
                    .height(barH)
                    .clip(RoundedCornerShape(barH * 0.32f))
                    .background(if (i == accentIndex) c.accent else c.muted)
            )
        }
    }
}

// The "traqs=" lockup: the wordmark with the bars mark riding after it like a
// trailing equals sign. Parametric so the hand-tuned alignment (measured at
// wordmark height 64) scales cleanly to any header size.
//
// The pull-left is NEGATIVE SPACING, not an offset. An offset is visual only, so
// the lockup would claim ~14dp of layout width at its right edge that it never
// draws into — phantom width taken straight out of the header's budget for its
// trailing controls.
@Composable
fun TRAQSHeaderLogo(size: Dp = 44.dp, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(-size * (15f / 64f)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TRAQSLogo(height = size)
        Box(Modifier.offset(y = -size * (1f / 64f))) {
            TRAQSBarsMark(size = size * (21f / 64f))
        }
    }
}

// Fallback text logo kept for places where an image won't fit
@Composable
fun TRAQSLogoText(fontSize: Int = 24) {
    val c = traQSColors
    Text(
        text = "TRAQS",
        fontSize = fontSize.sp,
        fontWeight = FontWeight.Black,
        style = LocalTextStyle.current.copy(
            brush = Brush.horizontalGradient(listOf(c.accent, parseColor("#2563eb")))
        )
    )
}

// The app's one header: wordmark on the left, trailing actions on the right.
// Mirrors iOS GlassHeader — no centre title, because the tab bar already says
// where you are, and no hamburger, because there is no longer a drawer to open.
//
// TRANSPARENT, deliberately. The shell paints one PageBackground behind every
// tab and the header floats on it; an opaque fill here cut a flat band across
// the top of the liquid canvas.
@Composable
fun TRAQSHeader(actions: @Composable RowScope.() -> Unit = {}) {
    val c = traQSColors
    val logoSize = 56.dp
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            // Bottom padding is 2, not 12, and that is not a typo. The wordmark
            // art carries its own transparent margin VERTICALLY as well as on
            // the left, so a 56dp logo box holds roughly 15dp of nothing under
            // the glyph. Twelve more on top of that is what left every page
            // looking like it had a heavy forehead above its title.
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        // Pulled left by the wordmark's own transparent margin, so the visible
        // "t" lands on the same 16dp gutter every PageTitle uses — otherwise the
        // header reads as indented against the title right below it.
        //
        // MEASURED from the PNG's alpha bounding box (the same 2348x1200 asset
        // iOS ships): the glyph starts at x=331, i.e. 14.1% of the width. The
        // 2dp back is the optical nudge iOS applies for the same reason — a big
        // title glyph carries its own side bearing, so a lockup set to the exact
        // gutter reads a touch too far left.
        TRAQSHeaderLogo(
            size = logoSize,
            modifier = Modifier.offset(x = -(logoSize * WORDMARK_ASPECT * 0.141f - 2.dp))
        )
        Spacer(Modifier.weight(1f))
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) { actions() }
    }
}

// The header for a PUSHED screen — back button on the left, optional actions on
// the right, and the page's own `PageTitle` underneath it.
//
// This exists because those screens used Material3's `TopAppBar`, which reserves
// a fixed 64dp row plus the status-bar inset to hold one small chevron. With the
// title living below it in a `PageTitle`, that bar was 64dp of nothing — the
// "big forehead" every pushed page carried. This row is the same height as the
// tab pages' own header (38dp control + 12 top + 2 bottom), so a pushed screen
// and a tab now start their content on the same line, and the back control is
// the app's glass key rather than a bare Material icon button.
@Composable
fun TRAQSPageBar(
    onBack: () -> Unit,
    backIcon: androidx.compose.ui.graphics.vector.ImageVector = TIcons.ArrowLeft,
    backDescription: String = "Back",
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        TRAQSIconBtn(icon = backIcon, contentDescription = backDescription, onClick = onBack)
        Spacer(Modifier.weight(1f))
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) { actions() }
    }
}

// The header control: a round key in the app's glass language. Mirrors iOS
// HeaderGlassPill — near-solid rather than translucent, because a button has to
// read as an opaque object ON the glass, not as more glass.
@Composable
fun TRAQSIconBtn(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String? = null,
    iconColor: Color? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val c = traQSColors
    val tint = iconColor ?: if (enabled) c.text else c.muted
    Box(
        modifier = Modifier
            .size(38.dp)
            .glassControl()
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription, tint = tint, modifier = Modifier.size(18.dp))
    }
}

// Consistent action bar shown below the header on every main screen
@Composable
fun PageActionBar(
    title: String,
    onAskTRAQS: () -> Unit,
    primaryAction: @Composable RowScope.() -> Unit = {}
) {
    val c = traQSColors
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        // Left — Ask TRAQS
        OutlinedButton(
            onClick = onAskTRAQS,
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
            modifier = Modifier.height(34.dp).align(Alignment.CenterStart),
            shape = RoundedCornerShape(TRadius.xs),
            border = BorderStroke(1.dp, c.accent.copy(alpha = 0.5f)),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = c.accent)
        ) {
            Icon(TIcons.Spark, null, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text("Ask TRAQS", fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }

        // Center — page title
        Text(
            title,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            color = c.text,
            modifier = Modifier.align(Alignment.Center)
        )

        // Right — primary action
        Row(
            modifier = Modifier.align(Alignment.CenterEnd),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            primaryAction()
        }
    }
}
