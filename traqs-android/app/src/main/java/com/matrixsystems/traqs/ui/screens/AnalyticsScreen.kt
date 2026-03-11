package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.JobStatus
import com.matrixsystems.traqs.models.Priority
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.traQSColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(appState: AppState, onBack: () -> Unit) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()

    val statusCounts = remember(jobs) {
        JobStatus.entries.associateWith { s -> jobs.count { it.status == s } }
    }
    val priorityCounts = remember(jobs) {
        mapOf(
            Priority.HIGH to jobs.count { it.pri == Priority.HIGH },
            Priority.MEDIUM to jobs.count { it.pri == Priority.MEDIUM },
            Priority.LOW to jobs.count { it.pri == Priority.LOW }
        )
    }
    val totalJobs = jobs.size
    val activeJobs = jobs.count { it.status == JobStatus.IN_PROGRESS }
    val finishedJobs = jobs.count { it.status == JobStatus.FINISHED }
    val completionPct = if (totalJobs > 0) (finishedJobs * 100 / totalJobs) else 0
    val totalPanels = jobs.sumOf { it.subs.size }
    val totalOps = jobs.sumOf { job -> job.subs.sumOf { it.subs.size } }
    val engQueueCount = appState.engineeringQueue.size

    // Workload per person
    val personWorkload = remember(jobs, people) {
        people.map { person ->
            val assignedOps = jobs.flatMap { job -> job.subs.flatMap { p -> p.subs.filter { person.id in it.team } } }
            Triple(person, assignedOps.size, assignedOps.count { it.status == JobStatus.IN_PROGRESS })
        }.sortedByDescending { it.second }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TopAppBar(
                title = { Text("Analytics", fontWeight = FontWeight.Bold, color = c.text) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = c.accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = c.surface)
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Summary cards
            item {
                Text("Overview", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("Jobs", "$totalJobs", Icons.Default.Work, Modifier.weight(1f))
                    StatCard("Active", "$activeJobs", Icons.Default.PlayCircle, Modifier.weight(1f), c.statusInProgress)
                    StatCard("Done", "$finishedJobs", Icons.Default.CheckCircle, Modifier.weight(1f), c.statusFinished)
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("Panels", "$totalPanels", Icons.Default.Layers, Modifier.weight(1f))
                    StatCard("Operations", "$totalOps", Icons.Default.List, Modifier.weight(1f))
                    StatCard("Team", "${people.size}", Icons.Default.People, Modifier.weight(1f))
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("Complete", "$completionPct%", Icons.Default.CheckCircle, Modifier.weight(1f), c.statusFinished)
                    StatCard("Eng Queue", "$engQueueCount", Icons.Default.Build, Modifier.weight(1f), c.statusPending)
                    Spacer(Modifier.weight(1f))
                }
            }

            // Status breakdown
            item {
                Text("By Status", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text, modifier = Modifier.padding(top = 4.dp))
            }
            item {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = c.card),
                    border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        statusCounts.forEach { (status, count) ->
                            val pct = if (totalJobs > 0) count.toFloat() / totalJobs else 0f
                            val barColor = status.toColor(c)
                            val trackColor = c.border
                            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(status.label, fontSize = 13.sp, color = c.text)
                                    Text("$count", fontSize = 13.sp, color = c.muted, fontWeight = FontWeight.Medium)
                                }
                                Canvas(modifier = Modifier.fillMaxWidth().height(10.dp)) {
                                    val h = size.height
                                    val w = size.width
                                    val r = h / 2
                                    drawRoundRect(color = trackColor, size = Size(w, h), cornerRadius = CornerRadius(r, r))
                                    if (pct > 0f) {
                                        drawRoundRect(
                                            color = barColor,
                                            size = Size(w * pct.coerceAtMost(1f), h),
                                            cornerRadius = CornerRadius(r, r)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // By Priority — donut chart
            item {
                Text("By Priority", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text, modifier = Modifier.padding(top = 4.dp))
            }
            item {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = c.card),
                    border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(20.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val highColor = Color(0xFFEF4444)
                        val medColor = Color(0xFFF59E0B)
                        val lowColor = Color(0xFF22C55E)
                        val total = priorityCounts.values.sum().toFloat().coerceAtLeast(1f)
                        Canvas(modifier = Modifier.size(120.dp)) {
                            val strokeWidth = 28.dp.toPx()
                            val radius = (size.minDimension - strokeWidth) / 2
                            val entries = listOf(
                                (priorityCounts[Priority.HIGH] ?: 0) to highColor,
                                (priorityCounts[Priority.MEDIUM] ?: 0) to medColor,
                                (priorityCounts[Priority.LOW] ?: 0) to lowColor
                            )
                            // Draw track
                            drawArc(
                                color = Color.Gray.copy(alpha = 0.15f),
                                startAngle = 0f, sweepAngle = 360f, useCenter = false,
                                topLeft = Offset(strokeWidth / 2, strokeWidth / 2),
                                size = Size(radius * 2, radius * 2),
                                style = Stroke(strokeWidth, cap = StrokeCap.Butt)
                            )
                            var startAngle = -90f
                            entries.forEach { (count, color) ->
                                val sweep = count / total * 360f
                                if (sweep > 0f) {
                                    drawArc(
                                        color = color,
                                        startAngle = startAngle, sweepAngle = sweep, useCenter = false,
                                        topLeft = Offset(strokeWidth / 2, strokeWidth / 2),
                                        size = Size(radius * 2, radius * 2),
                                        style = Stroke(strokeWidth, cap = StrokeCap.Butt)
                                    )
                                    startAngle += sweep
                                }
                            }
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(
                                Triple("High", priorityCounts[Priority.HIGH] ?: 0, highColor),
                                Triple("Medium", priorityCounts[Priority.MEDIUM] ?: 0, medColor),
                                Triple("Low", priorityCounts[Priority.LOW] ?: 0, lowColor)
                            ).forEach { (label, count, color) ->
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(12.dp)
                                            .background(color, RoundedCornerShape(3.dp))
                                    )
                                    Text(label, fontSize = 13.sp, color = c.text, modifier = Modifier.width(56.dp))
                                    Text("$count", fontSize = 13.sp, color = c.muted, fontWeight = FontWeight.Medium)
                                }
                            }
                        }
                    }
                }
            }

            // Team workload
            if (personWorkload.isNotEmpty()) {
                item {
                    Text("Team Workload", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text, modifier = Modifier.padding(top = 4.dp))
                }
                item {
                    val maxOps = personWorkload.maxOfOrNull { it.second }.takeIf { (it ?: 0) > 0 } ?: 1
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = c.card),
                        border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                    ) {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            personWorkload.forEach { (person, total, active) ->
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(person.name, fontSize = 13.sp, color = c.text)
                                        Text("$active active / $total total", fontSize = 11.sp, color = c.muted)
                                    }
                                    // Bar: grey = total capacity, accent = active ops
                                    val totalFraction = total.toFloat() / maxOps
                                    val activeFraction = active.toFloat() / maxOps
                                    val trackColor = c.border
                                    val activeColor = c.accent
                                    val totalColor = c.accent.copy(alpha = 0.3f)
                                    Canvas(modifier = Modifier.fillMaxWidth().height(8.dp)) {
                                        val h = size.height; val w = size.width; val r = h / 2
                                        drawRoundRect(color = trackColor, size = Size(w, h), cornerRadius = CornerRadius(r, r))
                                        if (totalFraction > 0f) {
                                            drawRoundRect(color = totalColor, size = Size(w * totalFraction.coerceAtMost(1f), h), cornerRadius = CornerRadius(r, r))
                                        }
                                        if (activeFraction > 0f) {
                                            drawRoundRect(color = activeColor, size = Size(w * activeFraction.coerceAtMost(1f), h), cornerRadius = CornerRadius(r, r))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun StatCard(
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    color: androidx.compose.ui.graphics.Color = traQSColors.accent
) {
    val c = traQSColors
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = androidx.compose.foundation.BorderStroke(1.dp, c.border),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
            Text(value, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.text)
            Text(label, fontSize = 11.sp, color = c.muted)
        }
    }
}
