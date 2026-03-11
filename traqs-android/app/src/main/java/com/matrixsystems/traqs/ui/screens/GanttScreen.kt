package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import java.util.concurrent.TimeUnit
import kotlin.math.max

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GanttScreen(
    appState: AppState,
    navController: NavHostController,
    onAskTRAQS: () -> Unit = { navController.navigate(Screen.AskTRAQS.route) }
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val isLoading by appState.isLoading.collectAsState()

    val sortedJobs = remember(jobs) { jobs.sortedBy { it.start } }
    val today = remember { Calendar.getInstance() }

    val dateRange = remember(sortedJobs) {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val starts = sortedJobs.mapNotNull { runCatching { fmt.parse(it.start) }.getOrNull() }
        val ends = sortedJobs.mapNotNull { runCatching { fmt.parse(it.end) }.getOrNull() }
        val minDate = starts.minOrNull()?.let {
            Calendar.getInstance().apply { time = it; add(Calendar.DAY_OF_YEAR, -14) }
        } ?: Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -14) }
        val maxDate = ends.maxOrNull()?.let {
            Calendar.getInstance().apply { time = it; add(Calendar.DAY_OF_YEAR, 28) }
        } ?: Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 28) }
        Pair(minDate, maxDate)
    }

    val (startCal, endCal) = dateRange
    val totalDays = TimeUnit.MILLISECONDS.toDays(endCal.timeInMillis - startCal.timeInMillis).toInt() + 1
    val dayWidthDp = 32.dp
    val hScrollState = rememberScrollState()

    LaunchedEffect(sortedJobs.size) {
        if (sortedJobs.isNotEmpty()) {
            val todayOffset = TimeUnit.MILLISECONDS.toDays(today.timeInMillis - startCal.timeInMillis).toInt()
            val scrollPx = (todayOffset * 32 - 100).coerceAtLeast(0)
            hScrollState.scrollTo(scrollPx)
        }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = { TRAQSHeader() }
    ) { padding ->
        if (isLoading && sortedJobs.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = c.accent)
            }
        } else {
            Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                PageActionBar(title = "Gantt", onAskTRAQS = onAskTRAQS)
                // Date header
                Row(modifier = Modifier.fillMaxWidth()) {
                    Spacer(Modifier.width(140.dp))
                    Row(modifier = Modifier.horizontalScroll(hScrollState)) {
                        repeat(totalDays) { dayIdx ->
                            val cal = Calendar.getInstance().apply {
                                timeInMillis = startCal.timeInMillis
                                add(Calendar.DAY_OF_YEAR, dayIdx)
                            }
                            val isToday = cal.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR) &&
                                    cal.get(Calendar.YEAR) == today.get(Calendar.YEAR)
                            val isMonday = cal.get(Calendar.DAY_OF_WEEK) == Calendar.MONDAY

                            Box(
                                modifier = Modifier
                                    .width(dayWidthDp)
                                    .height(36.dp)
                                    .background(if (isToday) c.accent.copy(alpha = 0.15f) else Color.Transparent),
                                contentAlignment = Alignment.Center
                            ) {
                                if (isMonday || dayIdx == 0) {
                                    Text(
                                        "${cal.get(Calendar.MONTH) + 1}/${cal.get(Calendar.DAY_OF_MONTH)}",
                                        fontSize = 9.sp,
                                        color = if (isToday) c.accent else c.muted
                                    )
                                }
                            }
                        }
                    }
                }

                HorizontalDivider(color = c.border)

                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(sortedJobs, key = { it.id }) { job ->
                        GanttJobRow(
                            job = job,
                            startCal = startCal,
                            totalDays = totalDays,
                            today = today,
                            dayWidthDp = 32,
                            hScrollState = hScrollState,
                            onClick = { navController.navigate(Screen.JobDetail.createRoute(job.id)) }
                        )
                        HorizontalDivider(color = c.border.copy(alpha = 0.4f))
                    }
                }
            }
        }
    }
}

@Composable
fun GanttJobRow(
    job: TRAQSJob,
    startCal: Calendar,
    totalDays: Int,
    today: Calendar,
    dayWidthDp: Int,
    hScrollState: androidx.compose.foundation.ScrollState,
    onClick: () -> Unit
) {
    val c = traQSColors
    val jobColor = try { parseColor(job.color) } catch (_: Exception) { c.accent }
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val jobStart = runCatching { fmt.parse(job.start) }.getOrNull()
    val jobEnd = runCatching { fmt.parse(job.end) }.getOrNull()

    val startDayOffset = jobStart?.let {
        TimeUnit.MILLISECONDS.toDays(it.time - startCal.timeInMillis).toInt().coerceAtLeast(0)
    } ?: 0
    val duration = if (jobStart != null && jobEnd != null) {
        max(1, TimeUnit.MILLISECONDS.toDays(jobEnd.time - jobStart.time).toInt() + 1)
    } else 1

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(40.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = job.title,
            fontSize = 11.sp,
            color = c.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .width(140.dp)
                .padding(start = 8.dp, end = 4.dp)
        )

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .horizontalScroll(hScrollState)
        ) {
            Box(modifier = Modifier.width((totalDays * dayWidthDp).dp).fillMaxHeight()) {
                val todayOffset = TimeUnit.MILLISECONDS.toDays(today.timeInMillis - startCal.timeInMillis).toInt()
                if (todayOffset in 0 until totalDays) {
                    Box(
                        modifier = Modifier
                            .width(2.dp)
                            .fillMaxHeight()
                            .offset(x = (todayOffset * dayWidthDp + dayWidthDp / 2).dp)
                            .background(c.accent.copy(alpha = 0.5f))
                    )
                }

                Box(
                    modifier = Modifier
                        .offset(x = (startDayOffset * dayWidthDp).dp)
                        .width((duration * dayWidthDp).dp)
                        .fillMaxHeight()
                        .padding(vertical = 8.dp)
                        .clickable { onClick() }
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(jobColor.copy(alpha = 0.85f), RoundedCornerShape(4.dp)),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        Text(
                            job.title,
                            fontSize = 9.sp,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 4.dp)
                        )
                    }
                }
            }
        }
    }
}
