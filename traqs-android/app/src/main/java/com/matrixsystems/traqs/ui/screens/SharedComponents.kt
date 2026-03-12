package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
            .background(color.copy(alpha = 0.13f), RoundedCornerShape(6.dp))
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
        shape = RoundedCornerShape(20.dp),
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
                    .background(c.surface.copy(alpha = 0.9f), RoundedCornerShape(20.dp))
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
                    .background(c.surface.copy(alpha = 0.9f), RoundedCornerShape(20.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text("✓", fontSize = 12.sp, color = c.statusFinished)
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

// Image logo — picks white or blue version based on app theme (not just system dark mode)
// Pass a full modifier (e.g. fillMaxWidth + aspectRatio) to control size, or rely on default height
@Composable
fun TRAQSLogo(height: Dp = 28.dp, modifier: Modifier = Modifier, useDefaultSize: Boolean = true) {
    val c = traQSColors
    val logoRes = if (c.isLight) R.drawable.traqs_logo else R.drawable.traqs_logo_white
    Image(
        painter = painterResource(logoRes),
        contentDescription = "TRAQS",
        contentScale = ContentScale.Fit,
        modifier = if (useDefaultSize) modifier.height(height) else modifier
    )
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

// Logo-only header — no buttons, no actions
@Composable
fun TRAQSHeader() {
    val c = traQSColors
    Surface(
        color = c.bg,
        shadowElevation = 0.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        val logoRes = if (c.isLight) R.drawable.traqs_logo else R.drawable.traqs_logo_white
        Image(
            painter = painterResource(logoRes),
            contentDescription = "TRAQS",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxWidth()
                .height(62.dp)
                .padding(top = 28.dp, bottom = 12.dp, start = 120.dp, end = 120.dp)
        )
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
            shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, c.accent.copy(alpha = 0.5f)),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = c.accent)
        ) {
            Icon(Icons.Default.AutoAwesome, null, modifier = Modifier.size(14.dp))
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
