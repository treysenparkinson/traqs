package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.boundsInParent
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.text.SimpleDateFormat
import java.util.*

// Today / Week / Month / Year segmented control — matches iOS TasksView.JobsSegment.

enum class JobsSegment(val label: String) { TODAY("Today"), WEEK("Week"), MONTH("Month"), YEAR("Year") }

// Content-sized segmented control with iOS-style sliding pill.
// Each segment captures its measured bounds; a single capsule slides to
// the selected segment via animateDpAsState (spring).
@Composable
fun JobsSegmentedControl(selected: JobsSegment, onSelect: (JobsSegment) -> Unit) {
    SlidingPillSegmented(
        options = JobsSegment.entries,
        selected = selected,
        label = { it.label },
        onSelect = onSelect,
    )
}

// MARK: - Week strip

@Composable
fun WeekStrip(
    days: List<Date>,
    selected: Date,
    countFor: (Date) -> Int,
    onPick: (Date) -> Unit,
    isWorkDay: (Date) -> Boolean,
) {
    val c = traQSColors
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        days.forEach { d ->
            val isSel = isSameDay(d, selected)
            val isToday = isSameDay(d, Date())
            val workDay = isWorkDay(d)
            val count = if (workDay) countFor(d) else 0
            val cal = Calendar.getInstance().apply { time = d }
            val dow = SimpleDateFormat("EEE", Locale.US).format(d).take(1)
            val borderColor = when {
                isSel -> c.accent
                isToday -> c.text.copy(alpha = 0.25f)
                else -> c.border
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (isSel) c.accent.copy(alpha = 0.14f) else c.surface)
                    .border(1.dp, borderColor, RoundedCornerShape(10.dp))
                    .then(if (workDay) Modifier.clickable { onPick(d) } else Modifier)
                    .alpha(if (workDay) 1f else 0.38f)
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    dow,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (isSel) c.accent else c.muted,
                    letterSpacing = 0.6.sp
                )
                Text(
                    "${cal.get(Calendar.DAY_OF_MONTH)}",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.text
                )
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.height(6.dp)) {
                    when {
                        !workDay -> {}
                        count == 0 -> Box(
                            modifier = Modifier
                                .size(4.dp)
                                .clip(CircleShape)
                                .border(1.dp, c.border, CircleShape)
                        )
                        else -> repeat(minOf(count, 4)) {
                            Box(modifier = Modifier.size(4.dp).clip(CircleShape).background(Color(0xFFD946EF)))
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Month calendar

@Composable
fun MonthCalendar(
    month: Date,
    selected: Date,
    countFor: (Date) -> Int,
    onPick: (Date) -> Unit,
) {
    val c = traQSColors
    val cal = Calendar.getInstance()
    val firstOfMonth = Calendar.getInstance().apply {
        time = month
        set(Calendar.DAY_OF_MONTH, 1)
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val weekday = firstOfMonth.get(Calendar.DAY_OF_WEEK)
    val toMon = if (weekday == Calendar.SUNDAY) -6 else -(weekday - 2)
    val gridStart = Calendar.getInstance().apply {
        time = firstOfMonth.time
        add(Calendar.DAY_OF_YEAR, toMon)
    }
    val weeks: List<List<Date>> = (0..5).map { w ->
        (0..6).map { d ->
            Calendar.getInstance().apply {
                time = gridStart.time
                add(Calendar.DAY_OF_YEAR, w * 7 + d)
            }.time
        }
    }
    val monthLabel = SimpleDateFormat("MMMM yyyy", Locale.US).format(month)
    val anchorMonth = Calendar.getInstance().apply { time = month }.get(Calendar.MONTH)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(monthLabel, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf("M", "T", "W", "T", "F", "S", "S").forEach { d ->
                Text(
                    d,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.muted,
                    modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            weeks.forEach { week ->
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    week.forEach { day ->
                        DayCell(day = day, anchorMonth = anchorMonth, selected = selected, count = countFor(day), onPick = onPick, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    day: Date,
    anchorMonth: Int,
    selected: Date,
    count: Int,
    onPick: (Date) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    val cal = Calendar.getInstance().apply { time = day }
    val inMonth = cal.get(Calendar.MONTH) == anchorMonth
    val isSel = isSameDay(day, selected)
    val isToday = isSameDay(day, Date())
    val textColor = when {
        isSel -> c.accent
        !inMonth -> c.muted.copy(alpha = 0.45f)
        else -> c.text
    }
    val borderColor = when {
        isSel -> c.accent
        isToday -> c.text.copy(alpha = 0.5f)
        else -> Color.Transparent
    }
    Column(
        modifier = modifier
            .height(34.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (isSel) c.accent.copy(alpha = 0.16f) else Color.Transparent)
            .border(1.dp, borderColor, RoundedCornerShape(8.dp))
            .clickable { onPick(day) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("${cal.get(Calendar.DAY_OF_MONTH)}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = textColor)
        if (count > 0) {
            Spacer(Modifier.height(2.dp))
            Box(modifier = Modifier.size(4.dp).clip(CircleShape).background(Color(0xFFD946EF)))
        }
    }
}

// MARK: - Year heatmap

@Composable
fun YearHeatmap(year: Int, countFor: (Date) -> Int) {
    val c = traQSColors
    val magenta = Color(0xFFD946EF)
    val palette = listOf(
        c.text.copy(alpha = 0.05f),
        magenta.copy(alpha = 0.30f),
        magenta.copy(alpha = 0.60f),
        magenta
    )
    fun bucket(count: Int): Color = when {
        count <= 0 -> palette[0]
        count == 1 -> palette[1]
        count <= 3 -> palette[2]
        else -> palette[3]
    }
    val months = listOf("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$year · jobs by day", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.muted, letterSpacing = 1.2.sp)
            Spacer(Modifier.weight(1f))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("less", fontSize = 10.sp, color = c.muted)
                palette.forEach { col ->
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(col)
                            .border(0.5.dp, c.border, RoundedCornerShape(2.dp))
                    )
                }
                Text("more", fontSize = 10.sp, color = c.muted)
            }
        }
        // 12 mini-grids per month, each 7 rows x ~5 cols
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            months.chunked(4).forEachIndexed { rowIdx, group ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    group.forEachIndexed { colIdx, monthLabel ->
                        val month = rowIdx * 4 + colIdx
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(3.dp)
                        ) {
                            Text(monthLabel, fontSize = 9.sp, fontWeight = FontWeight.Bold, color = c.muted)
                            MonthMiniGrid(year = year, month = month, palette = palette, bucket = ::bucket, countFor = countFor)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthMiniGrid(
    year: Int,
    month: Int,
    palette: List<Color>,
    bucket: (Int) -> Color,
    countFor: (Date) -> Int,
) {
    val cal = Calendar.getInstance().apply {
        clear()
        set(Calendar.YEAR, year)
        set(Calendar.MONTH, month)
        set(Calendar.DAY_OF_MONTH, 1)
    }
    val daysInMonth = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
    // Group into weeks of 7 days
    val days = (1..daysInMonth).map { day ->
        val c2 = cal.clone() as Calendar
        c2.set(Calendar.DAY_OF_MONTH, day)
        c2.time
    }
    val rows = days.chunked(7)
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                row.forEach { d ->
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(2.dp))
                            .background(bucket(countFor(d)))
                    )
                }
                // Pad row to 7 columns
                repeat(7 - row.size) { Box(modifier = Modifier.weight(1f).aspectRatio(1f)) }
            }
        }
    }
}

// MARK: - Sliding-pill segmented control (iOS Primitives.Segmented parity)
// Generic so Schedule (Day/Week) and Jobs (Today/Week/Month/Year) can both use it.
@Composable
fun <T : Any> SlidingPillSegmented(
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelect: (T) -> Unit,
) {
    val c = traQSColors
    val density = androidx.compose.ui.platform.LocalDensity.current
    val bounds = remember { mutableStateMapOf<T, androidx.compose.ui.geometry.Rect>() }
    val sel = bounds[selected]

    // Spring tuned to feel like iOS .spring(response: 0.18, dampingFraction: 1.0)
    val animSpec = androidx.compose.animation.core.spring<androidx.compose.ui.unit.Dp>(
        stiffness = 800f,
        dampingRatio = androidx.compose.animation.core.Spring.DampingRatioNoBouncy,
    )

    val pillX by androidx.compose.animation.core.animateDpAsState(
        targetValue = sel?.let { with(density) { it.left.toDp() } } ?: 0.dp,
        animationSpec = animSpec,
        label = "pillX",
    )
    val pillY by androidx.compose.animation.core.animateDpAsState(
        targetValue = sel?.let { with(density) { it.top.toDp() } } ?: 0.dp,
        animationSpec = animSpec,
        label = "pillY",
    )
    val pillW by androidx.compose.animation.core.animateDpAsState(
        targetValue = sel?.let { with(density) { it.width.toDp() } } ?: 0.dp,
        animationSpec = animSpec,
        label = "pillW",
    )
    val pillH by androidx.compose.animation.core.animateDpAsState(
        targetValue = sel?.let { with(density) { it.height.toDp() } } ?: 0.dp,
        animationSpec = animSpec,
        label = "pillH",
    )

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(20.dp))
            .padding(3.dp)
    ) {
        // Sliding pill — drawn behind the labels
        if (sel != null) {
            Box(
                modifier = Modifier
                    .offset(x = pillX, y = pillY)
                    .width(pillW)
                    .height(pillH)
                    .clip(RoundedCornerShape(18.dp))
                    .background(c.accent)
            )
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            options.forEach { opt ->
                val on = opt == selected
                Box(
                    modifier = Modifier
                        .onGloballyPositioned { coords ->
                            bounds[opt] = coords.boundsInParent()
                        }
                        .clip(RoundedCornerShape(18.dp))
                        .clickable { onSelect(opt) }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        label(opt),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (on) Color.White else c.text
                    )
                }
            }
        }
    }
}

// MARK: - Helpers

private fun isSameDay(a: Date, b: Date): Boolean {
    val ca = Calendar.getInstance().apply { time = a }
    val cb = Calendar.getInstance().apply { time = b }
    return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) &&
        ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
}
