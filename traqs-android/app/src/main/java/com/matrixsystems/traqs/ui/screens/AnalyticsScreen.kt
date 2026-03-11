package com.matrixsystems.traqs.ui.screens

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.JobStatus
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
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        statusCounts.forEach { (status, count) ->
                            val pct = if (totalJobs > 0) count.toFloat() / totalJobs else 0f
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(status.label, fontSize = 13.sp, color = c.text)
                                    Text("$count", fontSize = 13.sp, color = c.muted, fontWeight = FontWeight.Medium)
                                }
                                LinearProgressIndicator(
                                    progress = { pct },
                                    modifier = Modifier.fillMaxWidth().height(4.dp),
                                    color = status.toColor(c),
                                    trackColor = c.border
                                )
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
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = c.card),
                        border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                    ) {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            personWorkload.forEach { (person, total, active) ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(person.name, fontSize = 13.sp, color = c.text, modifier = Modifier.weight(1f))
                                    Text("$active active / $total total", fontSize = 11.sp, color = c.muted)
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
