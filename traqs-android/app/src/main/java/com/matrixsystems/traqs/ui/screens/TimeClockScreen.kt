package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.ActiveJobClock
import com.matrixsystems.traqs.models.OrgSettings
import com.matrixsystems.traqs.models.TRAQSJob
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.parseFlexibleISO
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.max
import kotlin.math.min

// Hours dashboard — personal view of weekly hours, daily bars, active job timer,
// and recent entries. Mirrors iOS TimeClockView. Per-job time tracking only;
// no payroll clock-in here (that's the kiosk on the More screen).

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeClockScreen(
    appState: AppState,
    onAskTRAQS: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()
    val orgSettings by appState.orgSettings.collectAsState()
    val currentPersonId = appState.currentPersonId
    // Derive activeJobClock from `people` so Compose recomposes when it changes.
    val activeJobClock = people.firstOrNull { it.id == currentPersonId }?.activeJobClock

    // 1-second ticker so the running timer + live hours update.
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }

    var isStopping by remember { mutableStateOf(false) }
    // Reset the "STOPPING…" indicator the moment the optimistic clear fires.
    LaunchedEffect(activeJobClock) {
        if (activeJobClock == null && isStopping) isStopping = false
    }

    val liveRunningHours = remember(activeJobClock, now) {
        computeLiveRunningHours(activeJobClock, now)
    }
    val weekHours = remember(jobs, currentPersonId, liveRunningHours) {
        computeWeekHours(jobs, currentPersonId, liveRunningHours)
    }
    val weeklyTarget = remember(orgSettings) {
        val t = orgSettings.hpd * max(1, orgSettings.workDays.size)
        if (t > 0) t else 40.0
    }
    val onPace = weekHours <= weeklyTarget

    val dailyBars = remember(now, liveRunningHours) { buildDailyBars(now, liveRunningHours) }
    val groups = remember(activeJobClock, jobs) { buildEntryGroups(activeJobClock, jobs) }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TRAQSHeader {
                TRAQSIconBtn(icon = Icons.Default.Settings, contentDescription = "Settings", onClick = onOpenSettings)
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                HeroPayPeriodCard(
                    totalHours = weekHours,
                    target = weeklyTarget,
                    onPace = onPace,
                    now = now,
                    settings = orgSettings,
                )
            }

            item { DailyBarsCard(days = dailyBars) }

            if (activeJobClock != null) {
                item { SectionTitle("Running") }
                item {
                    RunningEntryCard(
                        jobClock = activeJobClock,
                        now = now,
                        isStopping = isStopping,
                        onStop = {
                            if (!isStopping) {
                                isStopping = true
                                appState.jobClockOut()
                            }
                        }
                    )
                }
            }

            item { SectionTitle("Recent entries") }

            if (groups.isEmpty()) {
                item { HoursEmptyState() }
            } else {
                items(groups) { group -> EntryGroupCard(group) }
            }
        }
    }
}

// MARK: - Compute helpers

private fun computeLiveRunningHours(jc: ActiveJobClock?, now: Long): Double {
    if (jc == null) return 0.0
    val start = parseFlexibleISO(jc.clockIn) ?: return 0.0
    var ms = (now - start).toDouble()
    ms -= jc.totalPausedMs ?: 0.0
    val pausedAt = jc.pausedAt
    if (!pausedAt.isNullOrEmpty()) {
        val pStart = parseFlexibleISO(pausedAt)
        if (pStart != null) ms -= (now - pStart).toDouble()
    }
    return max(0.0, ms / 1000 / 3600)
}

// Weekly hours = sum of loggedHours on jobs the current user is on + live running.
private fun computeWeekHours(
    jobs: List<TRAQSJob>,
    currentPersonId: Int?,
    liveRunningHours: Double
): Double {
    val totalLogged = jobs.fold(0.0) { acc, job ->
        val onJob = if (currentPersonId != null) {
            job.team.contains(currentPersonId) || job.subs.any { panel ->
                panel.team.contains(currentPersonId) ||
                    panel.subs.any { op -> op.team.contains(currentPersonId) }
            }
        } else true
        if (onJob) acc + (job.loggedHours ?: 0.0) else acc
    }
    return totalLogged + liveRunningHours
}

data class DailyBar(val date: Date, val dow: String, val hours: Double, val isToday: Boolean)

private fun buildDailyBars(nowMs: Long, liveRunningHours: Double): List<DailyBar> {
    val cal = Calendar.getInstance()
    cal.timeInMillis = nowMs
    cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
    val today = cal.timeInMillis
    val dowChars = listOf("S", "M", "T", "W", "T", "F", "S")
    val out = mutableListOf<DailyBar>()
    for (i in 7 downTo 0) {
        val c2 = Calendar.getInstance().apply { timeInMillis = today; add(Calendar.DAY_OF_YEAR, -i) }
        val dow = dowChars[c2.get(Calendar.DAY_OF_WEEK) - 1]
        val h = if (i == 0) liveRunningHours else 0.0
        out.add(DailyBar(date = c2.time, dow = dow, hours = h, isToday = i == 0))
    }
    return out
}

data class TimeEntryRow(
    val id: String,
    val start: Date,
    val end: Date?,
    val jobTitle: String,
    val running: Boolean,
)

data class EntryGroupUI(val id: String, val label: String, val entries: List<TimeEntryRow>)

private fun buildEntryGroups(jc: ActiveJobClock?, jobs: List<TRAQSJob>): List<EntryGroupUI> {
    if (jc == null) return emptyList()
    val startMs = parseFlexibleISO(jc.clockIn) ?: return emptyList()
    val start = Date(startMs)
    val cal = Calendar.getInstance().apply {
        timeInMillis = startMs
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val dayKey = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)
    val label = SimpleDateFormat("EEE · MMM d", Locale.US).format(start)
    val job = jobs.firstOrNull { it.id == jc.jobId }
    val title = jc.jobTitle ?: job?.title ?: "Job"
    val entry = TimeEntryRow(id = jc.jobId, start = start, end = null, jobTitle = title, running = true)
    return listOf(EntryGroupUI(dayKey, label, listOf(entry)))
}

// MARK: - Components

@Composable
private fun SectionTitle(title: String) {
    val c = traQSColors
    Text(
        title.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        color = c.muted,
        letterSpacing = 1.4.sp,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp)
    )
}

@Composable
private fun HeroPayPeriodCard(
    totalHours: Double,
    target: Double,
    onPace: Boolean,
    now: Long,
    settings: OrgSettings,
) {
    val c = traQSColors
    val window = remember(now, settings) { computePeriodWindow(now, settings) }
    val df = SimpleDateFormat("MMM d", Locale.US)
    val periodLabel = "PAY PERIOD · ${df.format(window.first)} – ${df.format(window.second)}"
    val left = max(0.0, target - totalHours)
    val leftLabel = "%.1f left to weekly target".format(left)
    val paceLabel = if (onPace) "· on pace" else "· behind"
    val paceColor = if (onPace) c.accent else Color(0xFFF59E0B)

    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = c.text),  // inverted: ink on paper
        border = BorderStroke(1.dp, c.text)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                periodLabel,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = c.bg.copy(alpha = 0.7f),
                letterSpacing = 1.4.sp
            )
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "%.2f".format(totalHours),
                    fontSize = 48.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.bg
                )
                Text(
                    "hours",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = c.bg.copy(alpha = 0.7f),
                    modifier = Modifier.padding(bottom = 8.dp)
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(leftLabel, fontSize = 11.sp, color = c.bg.copy(alpha = 0.7f))
                Text(paceLabel, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = paceColor)
            }
        }
    }
}

// Pay period window — mirrors iOS HeroPayPeriodCard.periodWindow.
private fun computePeriodWindow(nowMs: Long, settings: OrgSettings): Pair<Date, Date> {
    val cal = Calendar.getInstance().apply {
        timeInMillis = nowMs
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val today = cal.time
    val anchor = settings.payPeriodStart?.let { parseFlexibleISO(it) }?.let { Date(it) } ?: today

    return when (settings.payPeriodType) {
        "weekly" -> {
            val weekday = cal.get(Calendar.DAY_OF_WEEK)  // Sun=1..Sat=7
            val toMonday = if (weekday == Calendar.SUNDAY) -6 else -(weekday - 2)
            val start = Calendar.getInstance().apply { time = today; add(Calendar.DAY_OF_YEAR, toMonday) }
            val end = Calendar.getInstance().apply { time = start.time; add(Calendar.DAY_OF_YEAR, 6) }
            start.time to end.time
        }
        "semimonthly" -> {
            val day = cal.get(Calendar.DAY_OF_MONTH)
            val monthStart = Calendar.getInstance().apply {
                time = today; set(Calendar.DAY_OF_MONTH, 1)
            }
            if (day <= 15) {
                val end = Calendar.getInstance().apply { time = monthStart.time; add(Calendar.DAY_OF_YEAR, 14) }
                monthStart.time to end.time
            } else {
                val start = Calendar.getInstance().apply { time = monthStart.time; add(Calendar.DAY_OF_YEAR, 15) }
                val nextMonth = Calendar.getInstance().apply { time = monthStart.time; add(Calendar.MONTH, 1) }
                val end = Calendar.getInstance().apply { time = nextMonth.time; add(Calendar.DAY_OF_YEAR, -1) }
                start.time to end.time
            }
        }
        else -> { // biweekly
            val daysBetween = ((today.time - anchor.time) / (24L * 60 * 60 * 1000)).toInt()
            val cycles = daysBetween / 14
            val start = Calendar.getInstance().apply { time = anchor; add(Calendar.DAY_OF_YEAR, cycles * 14) }
            val end = Calendar.getInstance().apply { time = start.time; add(Calendar.DAY_OF_YEAR, 13) }
            start.time to end.time
        }
    }
}

@Composable
private fun DailyBarsCard(days: List<DailyBar>) {
    val c = traQSColors
    val maxValue = 9.0
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = BorderStroke(1.dp, c.border)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "DAILY",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.muted,
                    letterSpacing = 1.2.sp
                )
                Spacer(Modifier.weight(1f))
                Text("last 8 days", fontSize = 11.sp, color = c.muted)
            }
            Row(
                modifier = Modifier.fillMaxWidth().height(112.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                days.forEach { d ->
                    Column(
                        modifier = Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(88.dp),
                            contentAlignment = Alignment.BottomCenter
                        ) {
                            val barHeight = max(2.0, min(1.0, d.hours / maxValue) * 88).dp
                            val barColor = when {
                                d.isToday -> c.accent
                                d.hours == 0.0 -> c.border
                                else -> c.text
                            }
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(0.7f)
                                    .height(barHeight)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(barColor)
                            )
                        }
                        Text(
                            d.dow,
                            fontSize = 11.sp,
                            color = if (d.isToday) c.text else c.muted,
                            fontWeight = if (d.isToday) FontWeight.Bold else FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RunningEntryCard(
    jobClock: ActiveJobClock,
    now: Long,
    isStopping: Boolean,
    onStop: () -> Unit,
) {
    val c = traQSColors
    val elapsedLabel = remember(jobClock, now) {
        val start = parseFlexibleISO(jobClock.clockIn) ?: return@remember "—"
        var ms = (now - start).toDouble()
        ms -= jobClock.totalPausedMs ?: 0.0
        jobClock.pausedAt?.let { p ->
            parseFlexibleISO(p)?.let { ms -= (now - it).toDouble() }
        }
        val secs = max(0, (ms / 1000).toInt())
        "%d:%02d:%02d".format(secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = c.accent.copy(alpha = 0.08f)),
        border = BorderStroke(1.dp, c.accent.copy(alpha = 0.45f))
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(modifier = Modifier.size(10.dp).clip(CircleShape).background(c.accent))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    jobClock.jobTitle ?: "Job",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.text,
                    maxLines = 1
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "RUNNING",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = c.accent,
                        modifier = Modifier
                            .background(c.accent.copy(alpha = 0.12f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                    Text(
                        elapsedLabel,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = c.text
                    )
                }
            }
            Button(
                onClick = onStop,
                enabled = !isStopping,
                shape = RoundedCornerShape(22.dp),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 7.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = Color.White)
            ) {
                if (isStopping) {
                    CircularProgressIndicator(
                        color = Color.White,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("STOPPING…", fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                } else {
                    Icon(Icons.Default.Stop, null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("STOP", fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                }
            }
        }
    }
}

@Composable
private fun EntryGroupCard(group: EntryGroupUI) {
    val c = traQSColors
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(
            group.label.uppercase(),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = c.muted,
            letterSpacing = 1.4.sp
        )
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = c.card),
            border = BorderStroke(1.dp, c.border)
        ) {
            Column {
                group.entries.forEachIndexed { i, entry ->
                    EntryRow(entry)
                    if (i < group.entries.lastIndex) {
                        HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 22.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun EntryRow(entry: TimeEntryRow) {
    val c = traQSColors
    val tf = SimpleDateFormat("HH:mm", Locale.US)
    val range = "${tf.format(entry.start)} – ${entry.end?.let { tf.format(it) } ?: "live"}"
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(
            modifier = Modifier
                .width(4.dp)
                .height(28.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(c.accent)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(range, fontSize = 11.sp, color = c.text)
            Text(entry.jobTitle, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text, maxLines = 1)
        }
        if (entry.running) {
            Text(
                "● LIVE",
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                color = c.accent,
                modifier = Modifier
                    .background(c.accent.copy(alpha = 0.10f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
    }
}

@Composable
private fun HoursEmptyState() {
    val c = traQSColors
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = BorderStroke(1.dp, c.border)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("No recent entries", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.muted)
            Text(
                "Log time against a job to start tracking.",
                fontSize = 11.sp,
                color = c.muted
            )
        }
    }
}
