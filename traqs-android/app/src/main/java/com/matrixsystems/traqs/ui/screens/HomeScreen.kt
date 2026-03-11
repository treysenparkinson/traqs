package com.matrixsystems.traqs.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircleOutline
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.models.TRAQSJob
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    appState: AppState,
    navController: NavHostController,
    onAskTRAQS: () -> Unit
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val today = remember { Calendar.getInstance() }
    val currentPerson = appState.currentPerson
    val fmt = remember { SimpleDateFormat("yyyy-MM-dd", Locale.US) }

    // Week offset — 0 = current week, -1 = last week, +1 = next week, etc.
    var weekOffset by remember { mutableStateOf(0) }

    // Monday–Sunday for the offset week
    val weekDays = remember(weekOffset) {
        val cal = Calendar.getInstance()
        val dow = cal.get(Calendar.DAY_OF_WEEK)
        val daysToMon = if (dow == Calendar.SUNDAY) -6 else 2 - dow
        cal.add(Calendar.DAY_OF_YEAR, daysToMon + weekOffset * 7)
        (0..6).map { offset ->
            Calendar.getInstance().apply {
                timeInMillis = cal.timeInMillis
                add(Calendar.DAY_OF_YEAR, offset)
            }
        }
    }

    // Jobs active this week
    val weekJobs = remember(jobs, weekOffset) {
        val ws = weekDays.first().timeInMillis
        val we = Calendar.getInstance().apply {
            timeInMillis = weekDays.last().timeInMillis
            add(Calendar.DAY_OF_YEAR, 1)
        }.timeInMillis
        jobs.filter { job ->
            val s = runCatching { fmt.parse(job.start)?.time }.getOrNull() ?: return@filter false
            val e = runCatching { fmt.parse(job.end)?.time }.getOrNull() ?: return@filter false
            s < we && e >= ws
        }
    }

    fun jobsForDay(dayCal: Calendar): List<TRAQSJob> {
        val dayMs = dayCal.timeInMillis
        val nextMs = Calendar.getInstance().apply {
            timeInMillis = dayMs
            add(Calendar.DAY_OF_YEAR, 1)
        }.timeInMillis
        return weekJobs.filter { job ->
            val s = runCatching { fmt.parse(job.start)?.time }.getOrNull() ?: return@filter false
            val e = runCatching { fmt.parse(job.end)?.time }.getOrNull() ?: return@filter false
            s < nextMs && e >= dayMs
        }
    }

    // Selected day — defaults to today on current week, else first day of week
    var selectedDay by remember {
        mutableStateOf(weekDays.firstOrNull { d ->
            d.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR) &&
                d.get(Calendar.YEAR) == today.get(Calendar.YEAR)
        } ?: weekDays.first())
    }

    // When week changes, update selected day
    LaunchedEffect(weekOffset) {
        selectedDay = weekDays.firstOrNull { d ->
            weekOffset == 0 &&
                d.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR) &&
                d.get(Calendar.YEAR) == today.get(Calendar.YEAR)
        } ?: weekDays.first()
    }

    // Jobs active on the selected day
    val selectedDayJobs = remember(jobs, selectedDay) {
        jobsForDay(selectedDay).sortedBy { it.start }
    }

    // My Tasks: jobs assigned to current person on selected day, not finished
    val myTasks = remember(selectedDayJobs, currentPerson) {
        if (currentPerson == null) return@remember emptyList()
        selectedDayJobs.filter { job ->
            job.status != com.matrixsystems.traqs.models.JobStatus.FINISHED &&
                currentPerson.id in job.team
        }
    }

    // Other active jobs on selected day (not in myTasks)
    val otherWeekJobs = remember(selectedDayJobs, myTasks) {
        val myIds = myTasks.map { it.id }.toSet()
        selectedDayJobs.filterNot { it.id in myIds }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TRAQSHeader()
        }
    ) { padding ->
        var selectedTab by remember { mutableStateOf(0) } // 0 = My Tasks, 1 = Active This Week

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(c.bg)
        ) {
            PageActionBar(title = "Schedule", onAskTRAQS = onAskTRAQS) {
                Button(
                    onClick = { navController.navigate(Screen.JobEdit.createRoute(null)) },
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                    modifier = Modifier.height(34.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                ) {
                    Icon(Icons.Default.Add, null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("New Task", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }

            // Week calendar strip (stays fixed while content slides)
            WeekCalendarStrip(
                weekDays = weekDays,
                today = today,
                selectedDay = selectedDay,
                onDaySelected = { selectedDay = it },
                jobsForDay = ::jobsForDay,
                onPrevWeek = { weekOffset-- },
                onNextWeek = { weekOffset++ },
                weekOffset = weekOffset,
                onToday = { weekOffset = 0 }
            )

            // Animated toggle pill
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .background(c.surface, RoundedCornerShape(12.dp))
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                listOf("My Tasks", "Active This Week").forEachIndexed { idx, label ->
                    val isSelected = selectedTab == idx
                    val bgColor by animateColorAsState(
                        targetValue = if (isSelected) c.accent else Color.Transparent,
                        animationSpec = tween(durationMillis = 250),
                        label = "tabBg$idx"
                    )
                    val textColor by animateColorAsState(
                        targetValue = if (isSelected) Color.White else c.muted,
                        animationSpec = tween(durationMillis = 250),
                        label = "tabText$idx"
                    )
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(9.dp))
                            .background(bgColor)
                            .clickable { selectedTab = idx }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            label,
                            fontSize = 13.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            color = textColor
                        )
                    }
                }
            }

            // Tab content — instant swap, no animation
            val allWeekJobs = remember(myTasks, otherWeekJobs) {
                (myTasks + otherWeekJobs).sortedBy { it.start }
            }
            val listItems = if (selectedTab == 0) myTasks else allWeekJobs

            if (listItems.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(vertical = 40.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            Icons.Default.CheckCircleOutline,
                            null,
                            tint = c.muted,
                            modifier = Modifier.size(36.dp)
                        )
                        Text(
                            if (selectedTab == 0) "No tasks assigned to you" else "No active jobs this week",
                            color = c.muted,
                            fontSize = 14.sp
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(listItems, key = { "${selectedTab}_${it.id}" }) { job ->
                        JobRow(
                            job = job,
                            onClick = { navController.navigate(Screen.JobDetail.createRoute(job.id)) },
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun WeekCalendarStrip(
    weekDays: List<Calendar>,
    today: Calendar,
    selectedDay: Calendar,
    onDaySelected: (Calendar) -> Unit,
    jobsForDay: (Calendar) -> List<TRAQSJob>,
    onPrevWeek: () -> Unit = {},
    onNextWeek: () -> Unit = {},
    weekOffset: Int = 0,
    onToday: () -> Unit = {}
) {
    val c = traQSColors
    val dayNames = listOf("M", "T", "W", "T", "F", "S", "S")
    val monthFmt = remember { SimpleDateFormat("MMMM yyyy", Locale.US) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = c.surface),
        border = BorderStroke(1.dp, c.border)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                IconButton(onClick = onPrevWeek, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.KeyboardArrowLeft,
                        contentDescription = "Previous week",
                        tint = c.muted,
                        modifier = Modifier.size(22.dp)
                    )
                }
                Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Text(
                        monthFmt.format(weekDays[0].time),
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = c.muted
                    )
                }
                if (weekOffset != 0) {
                    TextButton(
                        onClick = onToday,
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text("Today", fontSize = 12.sp, color = c.accent, fontWeight = FontWeight.Bold)
                    }
                }
                IconButton(onClick = onNextWeek, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.KeyboardArrowRight,
                        contentDescription = "Next week",
                        tint = c.muted,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                weekDays.forEachIndexed { idx, dayCal ->
                    val isToday = dayCal.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR) &&
                        dayCal.get(Calendar.YEAR) == today.get(Calendar.YEAR)
                    val isSelected = dayCal.get(Calendar.DAY_OF_YEAR) == selectedDay.get(Calendar.DAY_OF_YEAR) &&
                        dayCal.get(Calendar.YEAR) == selectedDay.get(Calendar.YEAR)
                    val dayJobs = jobsForDay(dayCal)

                    val circleBg by animateColorAsState(
                        targetValue = when {
                            isSelected && isToday -> c.accent
                            isSelected -> c.accent.copy(alpha = 0.75f)
                            else -> Color.Transparent
                        },
                        animationSpec = tween(200),
                        label = "dayBg$idx"
                    )

                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { onDaySelected(dayCal) }
                            .padding(vertical = 4.dp)
                    ) {
                        Text(
                            dayNames[idx],
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (isSelected) c.accent else c.muted
                        )

                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(circleBg),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "${dayCal.get(Calendar.DAY_OF_MONTH)}",
                                fontSize = 14.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSelected) Color.White else c.text
                            )
                        }

                        // Job color dots
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            modifier = Modifier.height(6.dp)
                        ) {
                            if (dayJobs.isNotEmpty()) {
                                dayJobs.take(3).forEach { job ->
                                    val jobColor = try {
                                        parseColor(job.color)
                                    } catch (_: Exception) {
                                        c.accent
                                    }
                                    Box(
                                        modifier = Modifier
                                            .size(5.dp)
                                            .clip(CircleShape)
                                            .background(jobColor)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
