package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.models.JobStatus
import com.matrixsystems.traqs.models.OrgSettings
import com.matrixsystems.traqs.models.Panel
import com.matrixsystems.traqs.models.TRAQSJob
import com.matrixsystems.traqs.models.Operation
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.parseFlexibleISO
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.max
import kotlin.math.min

// Schedule view matching iOS GanttView. Day/Week segmented toggle.
// Day = vertical hour grid with packed task blocks for the selected day.
// Week = 7-day Mon→Sun grid with hour rules + tile blocks per day.

enum class ScheduleSegment(val label: String) { DAY("Day"), WEEK("Week") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GanttScreen(
    appState: AppState,
    navController: NavHostController,
    onAskTRAQS: () -> Unit = { navController.navigate(Screen.AskTRAQS.route) }
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val clients by appState.clients.collectAsState()
    val orgSettings by appState.orgSettings.collectAsState()
    val currentPersonId = appState.currentPersonId
    val currentPerson = appState.currentPerson
    var selectedDate by remember { mutableStateOf(Date(startOfDay(System.currentTimeMillis()))) }
    var segment by rememberSaveable { mutableStateOf(ScheduleSegment.DAY) }

    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) { now = System.currentTimeMillis(); delay(60_000) }
    }

    val workStart = orgSettings.workStartHour()
    val workEnd = orgSettings.workEndHour()
    val lunchStart = orgSettings.lunchStartHour()
    val lunchDuration = orgSettings.lunch.durationMinutes / 60.0

    val blocks = remember(jobs, selectedDate, currentPersonId, orgSettings) {
        computeBlocksFor(selectedDate, jobs, clients, currentPersonId, orgSettings)
    }

    // Week-view derived state: Mon..Sun around selectedDate.
    val weekDates = remember(selectedDate) { weekMonToSun(selectedDate) }
    val weekBlocksByDay = remember(weekDates, jobs, currentPersonId, orgSettings) {
        weekDates.associateWith { computeBlocksFor(it, jobs, clients, currentPersonId, orgSettings) }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TRAQSHeader {
                TRAQSIconBtn(icon = Icons.Default.CalendarMonth, contentDescription = "Today") {
                    selectedDate = Date(startOfDay(System.currentTimeMillis()))
                }
                if (currentPerson?.isAdmin == true) {
                    TRAQSIconBtn(icon = Icons.Default.Add, contentDescription = "New", iconColor = c.accent) {
                        navController.navigate(Screen.JobEdit.createRoute(null))
                    }
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(c.bg)
        ) {
            // Day / Week segmented toggle (matches iOS GanttView).
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center
            ) {
                ScheduleSegmentedControl(selected = segment, onSelect = { segment = it })
            }

            if (segment == ScheduleSegment.DAY) {
                // Date selector
                DateSelector(
                    selected = selectedDate,
                    onPrev = {
                        val c2 = Calendar.getInstance().apply { time = selectedDate; add(Calendar.DAY_OF_YEAR, -1) }
                        selectedDate = c2.time
                    },
                    onNext = {
                        val c2 = Calendar.getInstance().apply { time = selectedDate; add(Calendar.DAY_OF_YEAR, 1) }
                        selectedDate = c2.time
                    },
                    onToday = { selectedDate = Date(startOfDay(System.currentTimeMillis())) }
                )

                // Stat strip
                val jobCount = blocks.map { it.jobId }.toSet().size
                val taskCount = blocks.size
                val estHours = blocks.sumOf { it.endH - it.startH }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    StatPill("JOBS", "$jobCount", Modifier.weight(1f))
                    StatPill("TASKS", "$taskCount", Modifier.weight(1f))
                    StatPill("EST.", "%.1f h".format(estHours), Modifier.weight(1f))
                }

                // Day timeline
                DayTimeline(
                    blocks = blocks,
                    workStart = workStart,
                    workEnd = workEnd,
                    lunchStart = lunchStart,
                    lunchDurationH = lunchDuration,
                    now = now,
                    selectedDate = selectedDate,
                    onBlockClick = { block -> navController.navigate(Screen.JobDetail.createRoute(block.jobId)) },
                    modifier = Modifier.weight(1f)
                )
            } else {
                // Week view — header bar + 7-day grid + legend (matches iOS).
                WeekHeaderBar(
                    weekDates = weekDates,
                    onToday = { selectedDate = Date(startOfDay(System.currentTimeMillis())) },
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
                WeekGrid(
                    weekDates = weekDates,
                    now = now,
                    workStart = workStart,
                    workEnd = workEnd,
                    blocksFor = { weekBlocksByDay[it] ?: emptyList() },
                    onBlockClick = { block -> navController.navigate(Screen.JobDetail.createRoute(block.jobId)) },
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp)
                )
                WeekLegendRow(
                    blocks = weekBlocksByDay.values.flatten(),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }
        }
    }
}

// MARK: - Date selector

@Composable
private fun DateSelector(
    selected: Date,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
) {
    val c = traQSColors
    val mainFmt = SimpleDateFormat("EEEE · MMM d", Locale.US)
    val shortFmt = SimpleDateFormat("EEE", Locale.US)
    val todayMs = startOfDay(System.currentTimeMillis())
    val selectedMs = startOfDay(selected.time)
    val subtitle = when (selectedMs) {
        todayMs -> "TODAY"
        todayMs + 24L * 60 * 60 * 1000 -> "TOMORROW"
        todayMs - 24L * 60 * 60 * 1000 -> "YESTERDAY"
        else -> shortFmt.format(selected).uppercase()
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        TRAQSIconBtn(icon = Icons.Default.ChevronLeft, contentDescription = "Prev", onClick = onPrev)
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text(
                subtitle,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                color = c.muted,
                letterSpacing = 1.3.sp
            )
            Text(
                mainFmt.format(selected),
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = c.text
            )
        }
        TRAQSIconBtn(icon = Icons.Default.ChevronRight, contentDescription = "Next", onClick = onNext)
        Spacer(Modifier.weight(1f))
        // TODAY pill — jumps back to today
        Surface(
            onClick = onToday,
            shape = RoundedCornerShape(20.dp),
            color = c.surface,
            border = BorderStroke(1.dp, c.border),
            shadowElevation = 1.dp,
        ) {
            Text(
                "TODAY",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = c.text,
                letterSpacing = 0.6.sp,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
    }
}

@Composable
private fun StatPill(label: String, value: String, modifier: Modifier = Modifier) {
    val c = traQSColors
    // iOS statCard: small SBox raised, left-aligned, label xs(11)+1.0 tracking, value h3(18).
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = c.surface,
        border = BorderStroke(1.dp, c.border),
        shadowElevation = 1.dp,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                label,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = c.muted,
                letterSpacing = 1.0.sp
            )
            Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = c.text)
        }
    }
}

// MARK: - Day timeline

@Composable
private fun DayTimeline(
    blocks: List<ScheduleBlock>,
    workStart: Double,
    workEnd: Double,
    lunchStart: Double,
    lunchDurationH: Double,
    now: Long,
    selectedDate: Date,
    onBlockClick: (ScheduleBlock) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    val hourHeight = 56.dp
    // Show from workStart to max(workEnd, lastBlockEnd) so overflow tasks remain visible.
    val maxBlockEnd = blocks.maxOfOrNull { it.endH } ?: workEnd
    val endHour = max(workEnd, maxBlockEnd + 0.5)
    val totalHours = max(1.0, endHour - workStart)
    val totalHeight = (hourHeight.value * totalHours).dp
    val labelColumnWidth = 56.dp
    val scrollState = rememberScrollState()

    // Snap-scroll to current time on first compose (if viewing today)
    LaunchedEffect(selectedDate, now) {
        if (isSameDay(selectedDate.time, now)) {
            val nowHour = hourOfDay(now)
            if (nowHour in workStart..endHour) {
                val px = ((nowHour - workStart) * hourHeight.value).toInt().coerceAtLeast(0)
                scrollState.scrollTo(px)
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(scrollState)
            .padding(horizontal = 16.dp)
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(totalHeight)) {
            // Hour grid lines + labels
            val hourCount = (endHour - workStart).toInt() + 1
            for (i in 0 until hourCount) {
                val h = workStart + i
                val y = ((h - workStart) * hourHeight.value).dp
                // Label
                Text(
                    formatHour(h),
                    fontSize = 10.sp,
                    color = c.muted,
                    modifier = Modifier
                        .offset(y = y - 6.dp)
                        .width(labelColumnWidth)
                )
                // Line
                Box(
                    modifier = Modifier
                        .offset(x = labelColumnWidth, y = y)
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(c.border.copy(alpha = 0.5f))
                )
            }

            // Lunch shading
            val lunchEnd = lunchStart + lunchDurationH
            val lunchTopY = ((lunchStart - workStart) * hourHeight.value).dp
            val lunchHeight = (lunchDurationH * hourHeight.value).dp
            Box(
                modifier = Modifier
                    .offset(x = labelColumnWidth, y = lunchTopY)
                    .fillMaxWidth()
                    .height(lunchHeight)
                    .background(c.muted.copy(alpha = 0.06f))
            )

            // NOW line (only if viewing today)
            if (isSameDay(selectedDate.time, now)) {
                val nowH = hourOfDay(now)
                if (nowH in workStart..endHour) {
                    val nowY = ((nowH - workStart) * hourHeight.value).dp
                    Box(
                        modifier = Modifier
                            .offset(x = labelColumnWidth, y = nowY)
                            .fillMaxWidth()
                            .height(2.dp)
                            .background(c.accent)
                    )
                }
            }

            // Blocks
            blocks.forEach { block ->
                val top = ((block.startH - workStart) * hourHeight.value).dp
                val height = ((block.endH - block.startH) * hourHeight.value).dp.coerceAtLeast(28.dp)
                Box(
                    modifier = Modifier
                        .offset(x = labelColumnWidth + 6.dp, y = top)
                        .width(280.dp)
                        .height(height)
                        .padding(end = 8.dp, bottom = 2.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(block.color.copy(alpha = 0.85f))
                        .clickable { onBlockClick(block) }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Column {
                        Text(
                            block.title,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            block.subtitle,
                            fontSize = 10.sp,
                            color = Color.White.copy(alpha = 0.85f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
    }
}

// MARK: - Schedule blocks computation

data class ScheduleBlock(
    val id: String,
    val jobId: String,
    val title: String,
    val subtitle: String,
    val typeLabel: String,
    val jobNumber: String,
    val color: Color,
    val startH: Double,
    val endH: Double,
)

private data class _Item(
    val job: TRAQSJob,
    val panel: Panel,
    val op: Operation?,
    val title: String,
    val subtitle: String,
    val typeLabel: String,
    val color: Color,
    val hpd: Double,
)

private fun computeBlocksFor(
    day: Date,
    jobs: List<TRAQSJob>,
    clients: List<com.matrixsystems.traqs.models.Client>,
    me: Int?,
    settings: OrgSettings,
): List<ScheduleBlock> {
    val dayStart = startOfDay(day.time)
    val dayEnd = dayStart + 24L * 60 * 60 * 1000

    val items = mutableListOf<_Item>()
    for (job in jobs) {
        for (panel in job.subs) {
            val pStart = parseFlexibleISO(panel.start) ?: continue
            val pEnd = parseFlexibleISO(panel.end) ?: continue
            if (!(pStart < dayEnd && pEnd >= dayStart)) continue

            val myOps = panel.subs.filter { op ->
                val s = parseFlexibleISO(op.start) ?: return@filter false
                val e = parseFlexibleISO(op.end) ?: return@filter false
                s < dayEnd && e >= dayStart && (me == null || me in op.team)
            }

            val clientName = job.clientId?.let { id ->
                clients.firstOrNull { it.id == id }?.name?.takeIf { it.isNotEmpty() }
            }

            if (myOps.isNotEmpty()) {
                myOps.forEach { op ->
                    val (lbl, col) = deptForOpKt(op.title, job.color)
                    items.add(_Item(
                        job, panel, op,
                        title = op.title.ifEmpty { panel.title },
                        subtitle = clientName ?: job.title,
                        typeLabel = lbl,
                        color = col,
                        hpd = max(0.5, if (op.hpd > 0) op.hpd else panel.hpd)
                    ))
                }
            } else if (me == null || me in panel.team || me in job.team) {
                val (lbl, col) = deptForOpKt(panel.title.ifEmpty { job.title }, job.color)
                items.add(_Item(
                    job, panel, null,
                    title = panel.title.ifEmpty { job.title },
                    subtitle = clientName ?: job.title,
                    typeLabel = lbl,
                    color = col,
                    hpd = max(0.5, if (panel.hpd > 0) panel.hpd else 1.0)
                ))
            }
        }
    }
    items.sortBy { (it.job.jobNumber ?: "") + it.panel.id }

    val workStart = settings.workStartHour()
    val lunchStart = settings.lunchStartHour()
    val lunchEnd = lunchStart + settings.lunch.durationMinutes / 60.0

    var cursor = workStart
    val out = mutableListOf<ScheduleBlock>()
    for ((idx, item) in items.withIndex()) {
        var remaining = item.hpd

        if (cursor in lunchStart..lunchEnd) cursor = lunchEnd

        val firstCapEdge = if (cursor < lunchStart) lunchStart else Double.MAX_VALUE
        val firstChunk = min(remaining, firstCapEdge - cursor)
        if (firstChunk > 0.01) {
            out.add(makeBlock(item, idx, cursor, cursor + firstChunk))
            cursor += firstChunk
            remaining -= firstChunk
        }
        if (remaining > 0.01 && cursor in lunchStart..lunchEnd) {
            cursor = lunchEnd
            out.add(makeBlock(item, idx, cursor, cursor + remaining))
            cursor += remaining
        }
    }
    return out
}

private fun makeBlock(it: _Item, idx: Int, start: Double, end: Double) = ScheduleBlock(
    id = "${it.panel.id}/${it.op?.id ?: "panel"}/$idx",
    jobId = it.job.id,
    title = it.title,
    subtitle = it.subtitle,
    typeLabel = it.typeLabel,
    jobNumber = it.job.jobNumber ?: "",
    color = it.color,
    startH = start,
    endH = end,
)

private fun deptForOpKt(title: String, jobColorHex: String): Pair<String, Color> {
    val key = title.lowercase()
    return when {
        "layout" in key -> "LAYOUT" to Color(0xFFD946EF)
        "wire" in key -> "WIRE" to Color(0xFF22D3EE)
        "cut" in key -> "CUT" to Color(0xFFEAB308)
        "inspect" in key -> "INSPECT" to Color(0xFFA78BFA)
        "repair" in key -> "REPAIR" to Color(0xFFF59E0B)
        "install" in key -> "INSTALL" to Color(0xFFD946EF)
        "callback" in key -> "CALLBACK" to Color(0xFFF43F5E)
        "contract" in key -> "CONTRACT" to Color(0xFF10B981)
        else -> title.uppercase() to (try { parseColor(jobColorHex) } catch (_: Exception) { Color(0xFF3D7FFF) })
    }
}

// MARK: - Time helpers

private fun startOfDayLocal(ms: Long): Long {
    val cal = Calendar.getInstance().apply {
        timeInMillis = ms
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    return cal.timeInMillis
}

private fun isSameDay(a: Long, b: Long): Boolean = startOfDayLocal(a) == startOfDayLocal(b)

private fun hourOfDay(ms: Long): Double {
    val cal = Calendar.getInstance().apply { timeInMillis = ms }
    return cal.get(Calendar.HOUR_OF_DAY) + cal.get(Calendar.MINUTE) / 60.0
}

private fun formatHour(h: Double): String {
    val hh = h.toInt()
    val ampm = if (hh < 12 || hh == 24) "am" else "pm"
    val display = when {
        hh == 0 || hh == 24 -> 12
        hh > 12 -> hh - 12
        else -> hh
    }
    return "$display$ampm"
}

private fun OrgSettings.workStartHour(): Double {
    val parts = workStart.split(":").mapNotNull { it.toIntOrNull() }
    return if (parts.size == 2) parts[0] + parts[1] / 60.0 else 7.0
}

private fun OrgSettings.workEndHour(): Double {
    val parts = workEnd.split(":").mapNotNull { it.toIntOrNull() }
    return if (parts.size == 2) parts[0] + parts[1] / 60.0 else 17.0
}

private fun OrgSettings.lunchStartHour(): Double {
    val parts = lunch.time.split(":").mapNotNull { it.toIntOrNull() }
    return if (parts.size == 2) parts[0] + parts[1] / 60.0 else 12.0
}

internal fun weekMonToSun(anchor: Date): List<Date> {
    val cal = Calendar.getInstance().apply {
        time = anchor
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val weekday = cal.get(Calendar.DAY_OF_WEEK)
    val toMonday = if (weekday == Calendar.SUNDAY) -6 else -(weekday - 2)
    cal.add(Calendar.DAY_OF_YEAR, toMonday)
    return (0..6).map {
        val c2 = cal.clone() as Calendar
        c2.add(Calendar.DAY_OF_YEAR, it)
        c2.time
    }
}

// MARK: - Schedule Day/Week segmented control

@Composable
private fun ScheduleSegmentedControl(
    selected: ScheduleSegment,
    onSelect: (ScheduleSegment) -> Unit,
) {
    SlidingPillSegmented(
        options = ScheduleSegment.entries,
        selected = selected,
        label = { it.label },
        onSelect = onSelect,
    )
}

// MARK: - Week header bar (range label + TODAY pill)

@Composable
private fun WeekHeaderBar(
    weekDates: List<Date>,
    onToday: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    val f = SimpleDateFormat("MMM d", Locale.US)
    val rangeLabel = if (weekDates.size >= 7) "${f.format(weekDates.first())} – ${f.format(weekDates.last())}" else ""
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            rangeLabel.uppercase(),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = c.muted,
            letterSpacing = 1.4.sp
        )
        Spacer(Modifier.weight(1f))
        Surface(
            onClick = onToday,
            shape = RoundedCornerShape(20.dp),
            color = c.surface,
            border = BorderStroke(1.dp, c.border),
            shadowElevation = 1.dp,
        ) {
            Text(
                "TODAY",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = c.text,
                letterSpacing = 0.6.sp,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
    }
}

// MARK: - Week grid: header row + scrollable hour grid with day columns

@Composable
private fun WeekGrid(
    weekDates: List<Date>,
    now: Long,
    workStart: Double,
    workEnd: Double,
    blocksFor: (Date) -> List<ScheduleBlock>,
    onBlockClick: (ScheduleBlock) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    val pxPerHour = 36.dp
    val gutterW = 24.dp
    val hourCount = (workEnd - workStart).toInt()
    val gridHeight = pxPerHour * hourCount
    val today = startOfDay(System.currentTimeMillis())
    val scrollState = rememberScrollState()

    Column(modifier = modifier.fillMaxSize()) {
        // Header row: gutter + day cells
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            Spacer(Modifier.width(gutterW))
            weekDates.forEach { d ->
                DayHeaderCell(day = d, isToday = startOfDay(d.time) == today, modifier = Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(4.dp))
        // Scrollable grid
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(scrollState),
            horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            // Time gutter
            Column(
                modifier = Modifier.width(gutterW).height(gridHeight)
            ) {
                for (i in 0 until hourCount) {
                    val hourLabel = ((workStart.toInt() + i + 11) % 12 + 1).toString()
                    Box(
                        modifier = Modifier.height(pxPerHour),
                        contentAlignment = Alignment.TopStart
                    ) {
                        Text(hourLabel, fontSize = 9.sp, color = c.muted)
                    }
                }
            }
            weekDates.forEach { d ->
                WeekDayColumn(
                    day = d,
                    isToday = startOfDay(d.time) == today,
                    now = now,
                    workStart = workStart,
                    workEnd = workEnd,
                    pxPerHour = pxPerHour,
                    gridHeight = gridHeight,
                    blocks = blocksFor(d),
                    onBlockClick = onBlockClick,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun DayHeaderCell(day: Date, isToday: Boolean, modifier: Modifier = Modifier) {
    val c = traQSColors
    val cal = Calendar.getInstance().apply { time = day }
    val dowSingle = SimpleDateFormat("EEE", Locale.US).format(day).take(1)
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp))
            .background(if (isToday) c.accent else Color.Transparent)
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(
            dowSingle,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = if (isToday) Color.White else c.text
        )
        Text(
            "${cal.get(Calendar.DAY_OF_MONTH)}",
            fontSize = 11.sp,
            color = if (isToday) Color.White.copy(alpha = 0.85f) else c.muted
        )
    }
}

@Composable
private fun WeekDayColumn(
    day: Date,
    isToday: Boolean,
    now: Long,
    workStart: Double,
    workEnd: Double,
    pxPerHour: androidx.compose.ui.unit.Dp,
    gridHeight: androidx.compose.ui.unit.Dp,
    blocks: List<ScheduleBlock>,
    onBlockClick: (ScheduleBlock) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    val hourCount = (workEnd - workStart).toInt()
    Box(
        modifier = modifier
            .height(gridHeight)
            .background(if (isToday) c.accent.copy(alpha = 0.07f) else Color.Transparent)
            .border(width = 1.dp, color = c.border, shape = RoundedCornerShape(0.dp))
    ) {
        // Hour rules
        Column(modifier = Modifier.fillMaxSize()) {
            for (i in 0 until hourCount) {
                Box(modifier = Modifier.height(pxPerHour).fillMaxWidth()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(c.border.copy(alpha = if (i % 2 == 0) 1f else 0.5f))
                    )
                }
            }
        }
        // Event tiles
        blocks.filter { it.startH < workEnd }.forEach { b ->
            val clampedEnd = minOf(b.endH, workEnd)
            val top = pxPerHour * (b.startH - workStart).toFloat()
            val h = (pxPerHour * (clampedEnd - b.startH).toFloat()).coerceAtLeast(2.dp)
            Box(
                modifier = Modifier
                    .offset(y = top + 1.dp)
                    .padding(horizontal = 2.dp)
                    .fillMaxWidth()
                    .height(h - 2.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(b.color.copy(alpha = 0.92f))
                    .clickable { onBlockClick(b) }
                    .padding(horizontal = 3.dp, vertical = 2.dp)
            ) {
                WeekBlockTileContent(block = b, heightDp = h)
            }
        }
        // NOW line on today
        if (isToday) {
            val cal = Calendar.getInstance().apply { timeInMillis = now }
            val nowH = cal.get(Calendar.HOUR_OF_DAY) + cal.get(Calendar.MINUTE) / 60.0
            if (nowH in workStart..workEnd) {
                val y = pxPerHour * (nowH - workStart).toFloat()
                Box(
                    modifier = Modifier
                        .offset(y = y - 1.dp)
                        .fillMaxWidth()
                        .height(1.5.dp)
                        .background(c.text)
                )
            }
        }
    }
}

@Composable
private fun WeekBlockTileContent(block: ScheduleBlock, heightDp: androidx.compose.ui.unit.Dp) {
    val showLabel = heightDp >= 26.dp
    val showJobNum = heightDp >= 44.dp && block.jobNumber.isNotEmpty()
    val showTitle = heightDp >= 64.dp
    // Yellow swatches need ink text; everything else is white-on-color.
    val textColor = if (block.color == Color(0xFFEAB308)) Color(0xFF0B0B0C) else Color.White
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (showLabel) {
            Text(
                block.typeLabel,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                color = textColor,
                letterSpacing = 0.6.sp,
                maxLines = 1
            )
        }
        if (showJobNum) {
            Text(
                "#${block.jobNumber}",
                fontSize = 9.sp,
                fontWeight = FontWeight.Medium,
                color = textColor.copy(alpha = 0.85f),
                maxLines = 1
            )
        }
        if (showTitle) {
            Text(
                block.title,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                color = textColor,
                maxLines = 2
            )
        }
    }
}

// MARK: - Week legend

@Composable
private fun WeekLegendRow(blocks: List<ScheduleBlock>, modifier: Modifier = Modifier) {
    val c = traQSColors
    // Distinct (label, color) pairs by first appearance
    val entries = remember(blocks) {
        val seen = mutableSetOf<String>()
        blocks.mapNotNull { b ->
            if (b.typeLabel.isEmpty() || !seen.add(b.typeLabel)) null
            else b.typeLabel to b.color
        }
    }
    if (entries.isEmpty()) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        entries.forEach { (label, color) ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(width = 12.dp, height = 6.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(color)
                )
                Text(
                    label,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.text,
                    letterSpacing = 0.6.sp
                )
            }
        }
    }
}
