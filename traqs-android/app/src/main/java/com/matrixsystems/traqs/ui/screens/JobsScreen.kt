package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.models.*
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.BreakReminderScheduler
import com.matrixsystems.traqs.services.parseFlexibleISO
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.max
import kotlin.math.min

// Tasks tab — mirrors iOS TasksView. Shows the current user's assigned
// ops/panels with per-task LOG TIME / STOP / BREAK controls and a
// Today / Week / Month / Year segmented control.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen(
    appState: AppState,
    navController: NavHostController,
    onAskTRAQS: () -> Unit = { navController.navigate(Screen.AskTRAQS.route) }
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val orgSettings by appState.orgSettings.collectAsState()
    val isLoading by appState.isLoading.collectAsState()
    var isManualRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(isLoading) { if (!isLoading) isManualRefreshing = false }
    var searchText by remember { mutableStateOf("") }
    var showSearch by remember { mutableStateOf(false) }
    val searchFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(showSearch) {
        if (showSearch) {
            // Wait one frame for the row to compose, then focus.
            kotlinx.coroutines.delay(80)
            runCatching { searchFocus.requestFocus() }
        }
    }
    var showJobEdit by remember { mutableStateOf(false) }

    val currentPersonId = appState.currentPersonId
    val currentPerson = appState.currentPerson

    var segment by rememberSaveable { mutableStateOf(JobsSegment.TODAY) }
    var selectedDate by remember { mutableStateOf(Date(startOfToday())) }

    val myTasks = remember(jobs, currentPersonId, searchText) {
        computeMyTasks(jobs, currentPersonId, searchText)
    }

    // Half-open [start, end) window for the active segment — the whole list
    // (YOUR TASKS + ALL JOBS) is bounded to this span, mirroring iOS.
    val range = remember(segment, selectedDate) {
        activeRange(segment, selectedDate)
    }

    // My tasks that overlap the active range, sorted by start.
    val mineInRange = remember(myTasks, range) {
        myTasks.filter { overlapsRange(it.startStr, it.endStr, range) }
            .sortedBy { parseFlexibleISO(it.startStr) ?: Long.MAX_VALUE }
    }

    // Jobs the user is NOT scheduled to, with at least one panel overlapping
    // the range. Search filters by job title + jobNumber.
    val othersInRange = remember(jobs, currentPersonId, range, searchText) {
        computeOtherJobs(jobs, currentPersonId, range, searchText)
    }

    // Day counts for the calendar/strip/heatmap include ALL jobs, not just
    // mine — so the dots actually reflect every scheduled piece of work.
    val dayCountMap = remember(jobs, orgSettings) {
        val map = mutableMapOf<Long, Int>()
        // Helper to walk a [s, e] range and bump the count on each work day.
        fun bump(startMs: Long, endMs: Long) {
            if (endMs < startMs) return
            var day = startOfDay(startMs)
            val end = startOfDay(endMs)
            while (day <= end) {
                if (isWorkDay(day, orgSettings)) {
                    map[day] = (map[day] ?: 0) + 1
                }
                day += 24L * 60 * 60 * 1000
            }
        }
        for (job in jobs) {
            for (panel in job.subs) {
                val s = parseFlexibleISO(panel.start) ?: continue
                val e = parseFlexibleISO(panel.end) ?: continue
                bump(s, e)
            }
        }
        map
    }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TRAQSHeader {
                TRAQSIconBtn(
                    icon = Icons.Default.Search,
                    contentDescription = "Search"
                ) {
                    showSearch = !showSearch
                    if (!showSearch) searchText = ""
                }
                if (currentPerson?.isAdmin == true) {
                    TRAQSIconBtn(
                        icon = Icons.Default.Add,
                        contentDescription = "New",
                        iconColor = c.accent
                    ) { showJobEdit = true }
                }
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            PullToRefreshBox(
                isRefreshing = isManualRefreshing,
                onRefresh = { isManualRefreshing = true; appState.loadAll() }
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().background(c.bg),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    // Inline search bar — only shown when the header's search icon is toggled.
                    // Matches iOS TasksView: slides in below the header with focus + Cancel.
                    if (showSearch) {
                        item {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(20.dp))
                                        .background(c.surface)
                                        .border(1.dp, c.border, RoundedCornerShape(20.dp))
                                        .padding(horizontal = 12.dp, vertical = 9.dp)
                                ) {
                                    Icon(Icons.Default.Search, null, tint = c.muted, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(8.dp))
                                    BasicTextField(
                                        value = searchText,
                                        onValueChange = { searchText = it },
                                        singleLine = true,
                                        textStyle = androidx.compose.ui.text.TextStyle(color = c.text, fontSize = 14.sp),
                                        decorationBox = { inner ->
                                            if (searchText.isEmpty()) {
                                                Text("Search jobs, customers…", color = c.muted, fontSize = 14.sp)
                                            }
                                            inner()
                                        },
                                        modifier = Modifier
                                            .weight(1f)
                                            .focusRequester(searchFocus)
                                    )
                                    if (searchText.isNotEmpty()) {
                                        IconButton(onClick = { searchText = "" }, modifier = Modifier.size(20.dp)) {
                                            Icon(Icons.Default.Cancel, null, tint = c.muted, modifier = Modifier.size(14.dp))
                                        }
                                    }
                                }
                                TextButton(onClick = {
                                    showSearch = false
                                    searchText = ""
                                }) {
                                    Text("Cancel", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text)
                                }
                            }
                        }
                    }

                    // Segmented control
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            JobsSegmentedControl(
                                selected = segment,
                                onSelect = {
                                    segment = it
                                    selectedDate = Date(startOfToday())
                                }
                            )
                        }
                    }

                    // Per-segment picker (week strip / month calendar / year heatmap).
                    // Today has no picker — it just renders the range body below.
                    when (segment) {
                        JobsSegment.TODAY -> { /* no picker */ }
                        JobsSegment.WEEK -> {
                            item {
                                val allDays = weekDatesAround(selectedDate)
                                val workDays = allDays.filter { isWorkDay(it.time, orgSettings) }
                                Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                                    WeekStrip(
                                        days = workDays,
                                        selected = selectedDate,
                                        countFor = { dayCountMap[startOfDay(it.time)] ?: 0 },
                                        onPick = { selectedDate = it },
                                        isWorkDay = { isWorkDay(it.time, orgSettings) }
                                    )
                                }
                            }
                        }
                        JobsSegment.MONTH -> {
                            item {
                                Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                                    MonthCalendar(
                                        month = selectedDate,
                                        selected = selectedDate,
                                        countFor = { dayCountMap[startOfDay(it.time)] ?: 0 },
                                        onPick = { selectedDate = it }
                                    )
                                }
                            }
                        }
                        JobsSegment.YEAR -> {
                            val year = Calendar.getInstance().apply { time = selectedDate }.get(Calendar.YEAR)
                            item {
                                Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                                    YearHeatmap(year = year, countFor = { dayCountMap[startOfDay(it.time)] ?: 0 })
                                }
                            }
                        }
                    }

                    // Shared body for every segment: YOUR TASKS + ALL JOBS, both
                    // bounded to the active range. Section headers only appear
                    // when there are other (not-mine) jobs, so a fully-personal
                    // view keeps its old look.
                    rangeContent(
                        mine = mineInRange,
                        others = othersInRange,
                        range = range,
                        label = spanLabel(segment, selectedDate),
                        appState = appState,
                        onOpen = { jobId -> navController.navigate(Screen.JobDetail.createRoute(jobId)) }
                    )
                }
            }
        }
    }

    if (showJobEdit) {
        navController.navigate(Screen.JobEdit.createRoute(null))
        showJobEdit = false
    }
}

// MARK: - TaskAssignment

data class TaskAssignment(
    val job: TRAQSJob,
    val panel: Panel,
    val op: Operation?,
    // True when the current user is actually scheduled to this work. Defaults
    // to true so existing "my tasks" call sites are unchanged; the ALL JOBS
    // section passes false for panels of jobs the user isn't assigned to.
    val isMine: Boolean = true,
) {
    val id: String get() = "${job.id}/${panel.id}/${op?.id ?: "panel"}"
    val title: String get() = op?.title?.takeIf { it.isNotEmpty() } ?: panel.title
    val status: JobStatus get() = op?.status ?: panel.status
    val hpd: Double get() = op?.hpd ?: panel.hpd
    val startStr: String get() = op?.start?.takeIf { it.isNotEmpty() } ?: panel.start
    val endStr: String get() = op?.end?.takeIf { it.isNotEmpty() } ?: panel.end

    fun overlapsDay(dayStartMs: Long): Boolean {
        val s = parseFlexibleISO(startStr) ?: return false
        val e = parseFlexibleISO(endStr) ?: return false
        val dayEnd = dayStartMs + 24L * 60 * 60 * 1000
        return s < dayEnd && e >= dayStartMs
    }
}

private fun computeMyTasks(
    jobs: List<TRAQSJob>,
    me: Int?,
    search: String
): List<TaskAssignment> {
    if (me == null) return emptyList()
    val q = search.trim().lowercase()
    val out = mutableListOf<TaskAssignment>()
    for (job in jobs) {
        if (q.isNotEmpty()) {
            val hay = (job.title + " " + (job.jobNumber ?: "")).lowercase()
            if (!hay.contains(q)) continue
        }
        for (panel in job.subs) {
            val myOps = panel.subs.filter { me in it.team }
            if (myOps.isNotEmpty()) {
                myOps.forEach { out.add(TaskAssignment(job, panel, it)) }
            } else if (me in panel.team) {
                out.add(TaskAssignment(job, panel, null))
            }
        }
    }
    return out
}

private fun startOfToday(): Long = startOfDay(System.currentTimeMillis())

internal fun startOfDay(ms: Long): Long {
    val cal = Calendar.getInstance().apply {
        timeInMillis = ms
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    return cal.timeInMillis
}

internal fun weekDatesAround(anchor: Date): List<Date> {
    val cal = Calendar.getInstance().apply { time = anchor }
    val weekday = cal.get(Calendar.DAY_OF_WEEK)
    val toMonday = if (weekday == Calendar.SUNDAY) -6 else -(weekday - 2)
    cal.add(Calendar.DAY_OF_YEAR, toMonday)
    return (0..6).map {
        val c2 = cal.clone() as Calendar
        c2.add(Calendar.DAY_OF_YEAR, it)
        c2.time
    }
}

private fun isWorkDay(dayMs: Long, settings: OrgSettings): Boolean {
    val cal = Calendar.getInstance().apply { timeInMillis = dayMs }
    val jsDay = cal.get(Calendar.DAY_OF_WEEK) - 1   // Calendar: 1=Sun..7=Sat → JS: 0=Sun..6=Sat
    return jsDay in settings.workDays
}

// MARK: - Range / overlap helpers — mirror iOS activeRange + overlap tests.

/// Half-open [first, last] LongRange (last is the inclusive last millisecond
/// before the next segment starts) for the active segment. Mirrors iOS
/// `activeRange` in TasksView.swift.
internal fun activeRange(segment: JobsSegment, selectedDate: Date): LongRange {
    val cal = Calendar.getInstance()
    return when (segment) {
        JobsSegment.TODAY -> {
            val s = startOfDay(System.currentTimeMillis())
            val e = s + 24L * 60 * 60 * 1000
            s until e
        }
        JobsSegment.WEEK -> {
            val days = weekDatesAround(selectedDate)
            val first = startOfDay((days.firstOrNull() ?: selectedDate).time)
            val last = startOfDay((days.lastOrNull() ?: selectedDate).time)
            val e = last + 24L * 60 * 60 * 1000
            first until e
        }
        JobsSegment.MONTH -> {
            cal.time = selectedDate
            cal.set(Calendar.DAY_OF_MONTH, 1)
            cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
            cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
            val s = cal.timeInMillis
            cal.add(Calendar.MONTH, 1)
            val e = cal.timeInMillis
            s until e
        }
        JobsSegment.YEAR -> {
            cal.time = selectedDate
            cal.set(Calendar.MONTH, Calendar.JANUARY)
            cal.set(Calendar.DAY_OF_MONTH, 1)
            cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
            cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
            val s = cal.timeInMillis
            cal.add(Calendar.YEAR, 1)
            val e = cal.timeInMillis
            s until e
        }
    }
}

/// True iff a closed [startStr, endStr] date range overlaps the half-open
/// `range`. LongRange.last is inclusive, so the test mirrors iOS:
/// `s < range.upperBound && e >= range.lowerBound`.
internal fun overlapsRange(startStr: String, endStr: String, range: LongRange): Boolean {
    val s = parseFlexibleISO(startStr) ?: return false
    val e = parseFlexibleISO(endStr) ?: return false
    return s <= range.last && e >= range.first
}

/// True iff the current user is scheduled to a job anywhere — on the job team,
/// any panel's team, or any op's team. Mirrors iOS isMineJob.
private fun isMineJob(job: TRAQSJob, me: Int?): Boolean {
    if (me == null) return false
    if (me in job.team) return true
    for (panel in job.subs) {
        if (me in panel.team) return true
        for (op in panel.subs) if (me in op.team) return true
    }
    return false
}

/// Jobs the user is NOT scheduled to that have at least one panel overlapping
/// `range`. Search filters by title + jobNumber. Mirrors iOS otherJobs.
private fun computeOtherJobs(
    jobs: List<TRAQSJob>,
    me: Int?,
    range: LongRange,
    search: String,
): List<TRAQSJob> {
    val q = search.trim().lowercase()
    return jobs.filter { job ->
        if (isMineJob(job, me)) return@filter false
        if (q.isNotEmpty()) {
            val hay = (job.title + " " + (job.jobNumber ?: "")).lowercase()
            if (!hay.contains(q)) return@filter false
        }
        job.subs.any { overlapsRange(it.start, it.end, range) }
    }.sortedBy { it.title.lowercase() }
}

/// Panels of `job` overlapping `range` as panel-level (op=null) not-mine
/// TaskAssignments. These are the rows revealed when an AllJobsCard expands.
private fun panelsInWindow(job: TRAQSJob, range: LongRange): List<TaskAssignment> =
    job.subs
        .filter { overlapsRange(it.start, it.end, range) }
        .map { TaskAssignment(job, it, null, isMine = false) }

/// Label for the span summary line. Today shows "EEE · MMM d", Week shows
/// "MMM d – MMM d", Month shows "MMMM yyyy", Year shows "yyyy".
private fun spanLabel(segment: JobsSegment, selectedDate: Date): String {
    return when (segment) {
        JobsSegment.TODAY -> SimpleDateFormat("EEE · MMM d", Locale.US).format(Date()).uppercase()
        JobsSegment.WEEK -> {
            val f = SimpleDateFormat("MMM d", Locale.US)
            val days = weekDatesAround(selectedDate)
            val first = days.firstOrNull() ?: selectedDate
            val last = days.lastOrNull() ?: selectedDate
            "${f.format(first)} – ${f.format(last)}".uppercase()
        }
        JobsSegment.MONTH -> SimpleDateFormat("MMMM yyyy", Locale.US).format(selectedDate).uppercase()
        JobsSegment.YEAR -> SimpleDateFormat("yyyy", Locale.US).format(selectedDate)
    }
}

// MARK: - Span Summary Line (replaces DaySummaryLine)

@Composable
private fun SpanSummaryLine(tasks: List<TaskAssignment>, label: String, modifier: Modifier = Modifier) {
    val c = traQSColors
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.muted, letterSpacing = 1.4.sp)
        Spacer(Modifier.weight(1f))
        Text(
            if (tasks.isEmpty()) "No tasks" else "${tasks.size} ${if (tasks.size == 1) "task" else "tasks"}",
            fontSize = 11.sp, color = c.muted
        )
    }
}

// MARK: - Section header (YOUR TASKS / ALL JOBS)
// Centered, bold label flanked by hairlines so the two groups read as
// clearly separated sections. Matches iOS sectionHeader.

@Composable
private fun SectionHeader(title: String, modifier: Modifier = Modifier) {
    val c = traQSColors
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        HorizontalDivider(modifier = Modifier.weight(1f), color = c.border, thickness = 1.dp)
        Text(
            title,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = c.text,
            letterSpacing = 1.6.sp,
            maxLines = 1,
            softWrap = false,
        )
        HorizontalDivider(modifier = Modifier.weight(1f), color = c.border, thickness = 1.dp)
    }
}

// MARK: - Range content — YOUR TASKS + ALL JOBS, both bounded to `range`.
// Section headers only appear when there are other jobs; otherwise the
// summary line + my task cards render as they always did.

@OptIn(ExperimentalMaterial3Api::class)
private fun androidx.compose.foundation.lazy.LazyListScope.rangeContent(
    mine: List<TaskAssignment>,
    others: List<TRAQSJob>,
    range: LongRange,
    label: String,
    appState: AppState,
    onOpen: (String) -> Unit,
) {
    if (others.isNotEmpty()) {
        item("hdr-yours") {
            SectionHeader(
                "YOUR TASKS",
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp),
            )
        }
    }
    item("yours-summary") {
        SpanSummaryLine(tasks = mine, label = label, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
    }
    if (mine.isEmpty()) {
        item("yours-empty") { TasksEmptyState() }
    } else {
        items(mine, key = { "mine/${it.id}" }) { task ->
            TaskCard(
                task = task,
                appState = appState,
                onOpen = { onOpen(task.job.id) },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
            )
        }
    }
    if (others.isNotEmpty()) {
        item("hdr-all") {
            SectionHeader(
                "ALL JOBS",
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 28.dp, bottom = 12.dp),
            )
        }
        items(others, key = { "other/${it.id}" }) { job ->
            AllJobsCard(
                job = job,
                panels = panelsInWindow(job, range),
                appState = appState,
                onOpen = { onOpen(job.id) },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
            )
        }
    }
}

// MARK: - AllJobsCard (collapsible parent for a not-mine job)
// Mirrors iOS AllJobsCard. Thin job header → tap to reveal each in-range
// panel as a full TaskCard (isMine = false). LOG TIME on those panels still
// works through the existing flow; the in-progress lockout in TaskCard
// handles the case where someone else is already clocked in.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AllJobsCard(
    job: TRAQSJob,
    panels: List<TaskAssignment>,
    appState: AppState,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    var isExpanded by remember(job.id) { mutableStateOf(false) }
    val jobColor = try { parseColor(job.color) } catch (_: Exception) { c.accent }
    val clientName = appState.clientForJob(job)?.name?.takeIf { it.isNotEmpty() }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Thin tappable header — collapsed by default. The full-size TaskCard
        // is reserved for YOUR TASKS and the panels revealed on expand.
        Card(
            modifier = Modifier.fillMaxWidth(),
            onClick = { isExpanded = !isExpanded },
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = c.card),
            border = BorderStroke(1.dp, c.border),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(jobColor))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        job.title,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = c.text,
                        maxLines = 1,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        job.jobNumber?.takeIf { it.isNotEmpty() }?.let {
                            Text("#$it", fontSize = 10.sp, color = c.muted)
                        }
                        clientName?.let {
                            Text(it, fontSize = 11.sp, color = c.muted, maxLines = 1)
                        }
                        Text(
                            "· ${panels.size} panel${if (panels.size == 1) "" else "s"}",
                            fontSize = 11.sp,
                            color = c.muted,
                        )
                    }
                }
                Icon(
                    if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = c.muted,
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        if (isExpanded) {
            if (panels.isEmpty()) {
                Text(
                    "No panels scheduled in this window",
                    fontSize = 12.sp,
                    color = c.muted,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                )
            } else {
                panels.forEach { task ->
                    TaskCard(
                        task = task,
                        appState = appState,
                        onOpen = onOpen,
                    )
                }
            }
        }
    }
}

@Composable
private fun TasksEmptyState() {
    val c = traQSColors
    Card(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = BorderStroke(1.dp, c.border)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("Nothing scheduled today", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.muted)
            Text("Tasks assigned to you will appear here.", fontSize = 11.sp, color = c.muted)
        }
    }
}

// MARK: - Department palette (label + color from task title)

private fun deptForTitle(title: String, jobColorHex: String): Pair<String, Color> {
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

// MARK: - TaskCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskCard(
    task: TaskAssignment,
    appState: AppState,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier
) {
    val c = traQSColors
    val ctx = LocalContext.current
    val people by appState.people.collectAsState()
    val currentPersonId = appState.currentPersonId
    val activeJobClock = people.firstOrNull { it.id == currentPersonId }?.activeJobClock
    val activeBreak = people.firstOrNull { it.id == currentPersonId }?.activeBreak

    val isActive = remember(activeJobClock, task) {
        val jc = activeJobClock ?: return@remember false
        val op = task.op
        if (op != null) jc.opId == op.id
        else jc.opId == null && jc.panelId == task.panel.id
    }

    // Another person (not me) currently clocked into this same work. For an
    // op-level card we match the exact op; for a panel-level card we match
    // anyone working anywhere in the panel.
    val busyBy: Person? = remember(people, currentPersonId, task) {
        people.firstOrNull { p ->
            if (p.id == currentPersonId) return@firstOrNull false
            val jc = p.activeJobClock ?: return@firstOrNull false
            if (jc.jobId != task.job.id) return@firstOrNull false
            val opId = task.op?.id
            if (opId != null) jc.opId == opId
            else jc.panelId == task.panel.id
        }
    }
    val busyByOther = !isActive && busyBy != null
    val busyByFirstName = remember(busyBy) {
        val n = busyBy?.name ?: ""
        if (n.isBlank()) "IN USE" else n.split(" ").firstOrNull() ?: n
    }

    var showLogConfirm by remember { mutableStateOf(false) }
    var showStopConfirm by remember { mutableStateOf(false) }
    var showBreakConfirm by remember { mutableStateOf(false) }
    var isStarting by remember { mutableStateOf(false) }
    var isStopping by remember { mutableStateOf(false) }
    var isBreakBusy by remember { mutableStateOf(false) }
    // Reset busy flags when the underlying state changes.
    LaunchedEffect(isActive) {
        if (isActive && isStarting) isStarting = false
        if (!isActive && isStopping) isStopping = false
    }
    LaunchedEffect(activeBreak) { if (isBreakBusy) isBreakBusy = false }

    val (deptLabel, deptColor) = deptForTitle(task.title, task.job.color)
    val clientName = appState.clientForJob(task.job)?.name
    val contextLine = buildString {
        clientName?.let { append(it) }
        if (task.job.title.isNotEmpty() && task.job.title != clientName) {
            if (isNotEmpty()) append(" · ")
            append(task.job.title)
        }
    }
    val dateRange = remember(task) { formatDateRange(task.startStr, task.endStr) }

    Card(
        modifier = modifier.fillMaxWidth(),
        onClick = onOpen,
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isActive) c.accent.copy(alpha = 0.08f) else c.card
        ),
        border = BorderStroke(1.dp, if (isActive) c.accent.copy(alpha = 0.45f) else c.border)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Top row: dept tag + job number [+ NOT ASSIGNED chip] ····· status badge
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    deptLabel,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    letterSpacing = 0.8.sp,
                    modifier = Modifier
                        .background(deptColor, RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                )
                task.job.jobNumber?.takeIf { it.isNotEmpty() }?.let {
                    Text("#$it", fontSize = 11.sp, color = c.muted)
                }
                if (!task.isMine) {
                    Text(
                        "NOT ASSIGNED",
                        fontSize = 8.sp,
                        fontWeight = FontWeight.Bold,
                        color = c.muted,
                        letterSpacing = 0.5.sp,
                        maxLines = 1,
                        softWrap = false,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(c.text.copy(alpha = 0.05f))
                            .border(1.dp, c.border, RoundedCornerShape(50))
                            .padding(horizontal = 5.dp, vertical = 2.dp)
                    )
                }
                Spacer(Modifier.weight(1f))
                StatusBadge(if (busyByOther) JobStatus.IN_PROGRESS else task.status)
            }

            // Headline
            Text(
                task.title,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = c.text,
                maxLines = 2,
                modifier = Modifier.padding(top = 8.dp)
            )

            if (contextLine.isNotEmpty()) {
                Text(contextLine, fontSize = 13.sp, color = c.muted, maxLines = 1)
            }

            // Panel + date row
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (task.op != null && task.panel.title.isNotEmpty()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(Icons.Default.ViewModule, null, tint = c.muted, modifier = Modifier.size(12.dp))
                        Text(task.panel.title, fontSize = 11.sp, color = c.muted, maxLines = 1)
                    }
                }
                Spacer(Modifier.weight(1f))
                if (dateRange.isNotEmpty()) {
                    Text(dateRange, fontSize = 11.sp, color = c.muted)
                }
            }

            HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(vertical = 12.dp))

            if (isActive) {
                ActiveRow(
                    task = task,
                    appState = appState,
                    activeJobClock = activeJobClock,
                    activeBreak = activeBreak,
                    isStopping = isStopping,
                    isBreakBusy = isBreakBusy,
                    onStop = { showStopConfirm = true },
                    onBreak = { showBreakConfirm = true }
                )
            } else {
                QueuedRow(
                    task = task,
                    appState = appState,
                    deptColor = deptColor,
                    isStarting = isStarting,
                    busyByOther = busyByOther,
                    busyByFirstName = busyByFirstName,
                    onLog = { showLogConfirm = true }
                )
            }
        }
    }

    // STOP confirmation
    if (showStopConfirm) {
        AlertDialog(
            onDismissRequest = { showStopConfirm = false },
            title = { Text("End this job?", color = c.text) },
            text = { Text("This stops the timer and logs your hours for this job.", color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    showStopConfirm = false
                    if (!isStopping) {
                        isStopping = true
                        appState.jobClockOut()
                    }
                }) { Text("End Job", color = c.danger) }
            },
            dismissButton = {
                TextButton(onClick = { showStopConfirm = false }) { Text("Cancel", color = c.muted) }
            },
            containerColor = c.card
        )
    }

    // BREAK confirmation
    if (showBreakConfirm) {
        val onBreak = activeBreak != null
        AlertDialog(
            onDismissRequest = { showBreakConfirm = false },
            title = { Text(if (onBreak) "End your break?" else "Start a break?", color = c.text) },
            text = {
                Text(
                    if (onBreak) "You'll go back to working on the job."
                    else "Your job timer keeps running while you're on break.",
                    color = c.muted
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showBreakConfirm = false
                    if (!isBreakBusy) {
                        isBreakBusy = true
                        if (onBreak) {
                            appState.endBreak(onCancelReminder = { BreakReminderScheduler.cancel(ctx) })
                        } else {
                            appState.startBreak(onScheduleReminder = { minutes ->
                                BreakReminderScheduler.schedule(ctx, minutes)
                            })
                        }
                    }
                }) { Text(if (onBreak) "End Break" else "Start Break", color = c.accent) }
            },
            dismissButton = {
                TextButton(onClick = { showBreakConfirm = false }) { Text("Cancel", color = c.muted) }
            },
            containerColor = c.card
        )
    }

    // LOG TIME confirmation sheet
    if (showLogConfirm) {
        LogTimeConfirmSheet(
            task = task,
            appState = appState,
            deptLabel = deptLabel,
            deptColor = deptColor,
            customer = clientName,
            onDismiss = { showLogConfirm = false },
            onConfirm = {
                showLogConfirm = false
                if (!isStarting) {
                    isStarting = true
                    appState.jobClockIn(
                        jobId = task.job.id,
                        panelId = task.panel.id,
                        opId = task.op?.id,
                        jobTitle = task.job.title,
                        panelTitle = task.panel.title,
                        opTitle = task.op?.title
                    )
                }
            }
        )
    }
}

// MARK: - Active / Queued rows

@Composable
private fun ActiveRow(
    task: TaskAssignment,
    appState: AppState,
    activeJobClock: ActiveJobClock?,
    activeBreak: ActiveBreak?,
    isStopping: Boolean,
    isBreakBusy: Boolean,
    onStop: () -> Unit,
    onBreak: () -> Unit,
) {
    val c = traQSColors
    val onBreakNow = activeBreak != null
    val accent = if (onBreakNow) Color(0xFFF59E0B) else c.accent

    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) { now = System.currentTimeMillis(); delay(1000) }
    }
    val elapsed = remember(activeJobClock, now) { elapsedLabel(activeJobClock, now) }
    val pct = task.op?.let { appState.opPct(it) } ?: appState.panelPct(task.panel)
    val breakCountdown = remember(activeBreak, now) { breakCountdown(activeBreak, now) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Status label + live timer
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(accent))
                Text(
                    if (onBreakNow) "ON BREAK" else "TRACKING",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = accent,
                    letterSpacing = 1.0.sp
                )
                if (onBreakNow && breakCountdown.isNotEmpty()) {
                    Spacer(Modifier.width(6.dp))
                    Text(breakCountdown, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = accent)
                }
            }
            Spacer(Modifier.weight(1f))
            Text("$elapsed · ${pct}%", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.accent)
        }

        // Progress bar
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(c.border)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction = (pct / 100f).coerceIn(0f, 1f))
                    .background(c.accent, RoundedCornerShape(3.dp))
            )
        }

        // Break + Stop buttons, side by side
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onBreak,
                enabled = !isBreakBusy && !isStopping,
                modifier = Modifier.weight(1f).height(40.dp),
                shape = RoundedCornerShape(20.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B), contentColor = Color.White)
            ) {
                if (isBreakBusy) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
                } else {
                    Icon(
                        if (onBreakNow) Icons.Default.PlayArrow else Icons.Default.Pause,
                        null, modifier = Modifier.size(14.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(if (onBreakNow) "END BREAK" else "BREAK", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                }
            }
            Button(
                onClick = onStop,
                enabled = !isStopping && !isBreakBusy,
                modifier = Modifier.weight(1f).height(40.dp),
                shape = RoundedCornerShape(20.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = Color.White)
            ) {
                if (isStopping) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("STOPPING…", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                } else {
                    Icon(Icons.Default.Stop, null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("STOP", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                }
            }
        }
    }
}

@Composable
private fun QueuedRow(
    task: TaskAssignment,
    appState: AppState,
    deptColor: Color,
    isStarting: Boolean,
    busyByOther: Boolean,
    busyByFirstName: String,
    onLog: () -> Unit,
) {
    val c = traQSColors
    val pct = task.op?.let { appState.opPct(it) } ?: appState.panelPct(task.panel)
    val inProgressColor = Color(0xFF3D7FFF)
    val labelColor = if (busyByOther) inProgressColor else c.muted
    val barColor = if (busyByOther) inProgressColor else deptColor
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when {
                        busyByOther -> "IN PROGRESS"
                        isStarting -> "STARTING…"
                        else -> "PROGRESS"
                    },
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = labelColor,
                    letterSpacing = 1.0.sp
                )
                Spacer(Modifier.weight(1f))
                Text("$pct%", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.muted)
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(c.border)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(fraction = (pct / 100f).coerceIn(0f, 1f))
                        .background(barColor, RoundedCornerShape(3.dp))
                )
            }
        }
        if (busyByOther) {
            // Someone else is clocked into this work — block logging and
            // show who has it, greyed out so it clearly can't be tapped.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(c.surface)
                    .border(1.dp, c.border, RoundedCornerShape(20.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .alpha(0.55f)
            ) {
                Icon(Icons.Default.Person, null, modifier = Modifier.size(14.dp), tint = c.muted)
                Spacer(Modifier.width(6.dp))
                Text(busyByFirstName, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.muted, letterSpacing = 0.8.sp)
            }
        } else {
            Button(
                onClick = onLog,
                enabled = !isStarting,
                shape = RoundedCornerShape(20.dp),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.surface, contentColor = c.text),
                border = BorderStroke(1.dp, c.border)
            ) {
                if (isStarting) {
                    CircularProgressIndicator(color = c.text, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("STARTING…", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                } else {
                    Icon(Icons.Default.PlayArrow, null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("LOG TIME", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                }
            }
        }
    }
}

// MARK: - LogTimeConfirmSheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LogTimeConfirmSheet(
    task: TaskAssignment,
    appState: AppState,
    deptLabel: String,
    deptColor: Color,
    customer: String?,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val c = traQSColors
    val loggedOnOp = task.op?.loggedHours ?: 0.0
    val loggedOnJob = task.job.loggedHours ?: 0.0
    val estimate = max(task.hpd, 0.5)
    val taskPct = task.op?.let { appState.opPct(it) } ?: appState.panelPct(task.panel)
    val jobPctVal = appState.jobPct(task.job)
    val dateRange = formatDateRange(task.startStr, task.endStr)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = c.surface
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp)) {
            // Summary card
            Card(
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = c.card),
                border = BorderStroke(1.dp, c.border)
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            deptLabel,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            letterSpacing = 0.8.sp,
                            modifier = Modifier
                                .background(deptColor, RoundedCornerShape(6.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                        task.job.jobNumber?.takeIf { it.isNotEmpty() }?.let {
                            Text("#$it", fontSize = 11.sp, color = c.muted)
                        }
                        Spacer(Modifier.weight(1f))
                        StatusBadge(task.status)
                    }
                    Text(task.title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = c.text)
                    customer?.takeIf { it.isNotEmpty() }?.let {
                        Text(it, fontSize = 13.sp, color = c.muted)
                    }
                    if (task.job.title.isNotEmpty() && task.job.title != customer) {
                        Text(task.job.title, fontSize = 13.sp, color = c.muted)
                    }
                    HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(vertical = 6.dp))
                    MetricRow(
                        "This task",
                        "%.2f h · %d%%".format(loggedOnOp, taskPct),
                        sub = "of %.1f h/day est.".format(estimate)
                    )
                    MetricRow("This job", "%.2f h · %d%%".format(loggedOnJob, jobPctVal))
                    if (task.panel.title.isNotEmpty()) MetricRow("Panel", task.panel.title)
                    if (dateRange.isNotEmpty()) MetricRow("Window", dateRange)
                }
            }

            Spacer(Modifier.height(20.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f).height(48.dp),
                    shape = RoundedCornerShape(24.dp),
                    border = BorderStroke(1.dp, c.border),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = c.text)
                ) { Text("CANCEL", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp) }

                Button(
                    onClick = onConfirm,
                    modifier = Modifier.weight(1f).height(48.dp),
                    shape = RoundedCornerShape(24.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = Color.White)
                ) {
                    Icon(Icons.Default.PlayArrow, null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("START TIMER", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun MetricRow(label: String, value: String, sub: String? = null) {
    val c = traQSColors
    Row(verticalAlignment = Alignment.Top) {
        Text(label.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.muted, letterSpacing = 1.2.sp)
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End) {
            Text(value, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text)
            if (sub != null) Text(sub, fontSize = 10.sp, color = c.muted)
        }
    }
}

// MARK: - Helpers

private fun elapsedLabel(jc: ActiveJobClock?, now: Long): String {
    if (jc == null) return "—"
    val start = parseFlexibleISO(jc.clockIn) ?: return "—"
    var ms = (now - start).toDouble()
    ms -= jc.totalPausedMs ?: 0.0
    jc.pausedAt?.let { p ->
        parseFlexibleISO(p)?.let { ms -= (now - it).toDouble() }
    }
    val secs = max(0, (ms / 1000).toInt())
    return "%dh %dm %ds".format(secs / 3600, (secs % 3600) / 60, secs % 60)
}

private fun breakCountdown(brk: ActiveBreak?, now: Long): String {
    if (brk == null) return ""
    val start = parseFlexibleISO(brk.startedAt) ?: return ""
    val endsAt = start + brk.durationMinutes * 60L * 1000
    val leftSec = ((endsAt - now) / 1000).toInt()
    return if (leftSec >= 0) "%d:%02d left".format(leftSec / 60, leftSec % 60)
    else "over by %d:%02d".format((-leftSec) / 60, (-leftSec) % 60)
}

private fun formatDateRange(startStr: String, endStr: String): String {
    val s = parseFlexibleISO(startStr) ?: return ""
    val e = parseFlexibleISO(endStr) ?: return ""
    val f = SimpleDateFormat("MMM d", Locale.US)
    val sCal = Calendar.getInstance().apply { timeInMillis = s }
    val eCal = Calendar.getInstance().apply { timeInMillis = e }
    val sameDay = sCal.get(Calendar.YEAR) == eCal.get(Calendar.YEAR) &&
        sCal.get(Calendar.DAY_OF_YEAR) == eCal.get(Calendar.DAY_OF_YEAR)
    return if (sameDay) f.format(Date(s)) else "${f.format(Date(s))} – ${f.format(Date(e))}"
}

// MARK: - Engineering Queue (preserved from prior screen)

@Composable
fun EngineeringQueueSection(appState: AppState, queue: List<Pair<TRAQSJob, Panel>>) {
    val c = traQSColors
    var isExpanded by remember { mutableStateOf(true) }
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = BorderStroke(1.dp, c.border)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable { isExpanded = !isExpanded },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Engineering Queue (${queue.size})", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text)
                Icon(
                    if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    null, tint = c.muted, modifier = Modifier.size(20.dp)
                )
            }
            if (isExpanded) {
                Spacer(Modifier.height(8.dp))
                queue.forEach { (job, panel) ->
                    EngineeringCard(job = job, panel = panel, appState = appState)
                    Spacer(Modifier.height(6.dp))
                }
            }
        }
    }
}

@Composable
fun EngineeringCard(job: TRAQSJob, panel: Panel, appState: AppState) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(c.surface, RoundedCornerShape(8.dp))
            .border(1.dp, c.border, RoundedCornerShape(8.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(panel.title, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.text, maxLines = 1)
            Text(job.title, fontSize = 11.sp, color = c.muted, maxLines = 1)
        }
        val eng = panel.engineering
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            EngStepDot(done = eng?.designed != null)
            EngStepDot(done = eng?.verified != null)
            EngStepDot(done = eng?.sentToPerforex != null)
        }
    }
}

@Composable
private fun EngStepDot(done: Boolean) {
    val c = traQSColors
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(if (done) c.eng else c.border)
    )
}
