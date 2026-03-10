package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.models.*
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobDetailScreen(
    job: Job,
    appState: AppState,
    navController: NavHostController
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    // Track live job state
    val liveJob = jobs.firstOrNull { it.id == job.id } ?: job
    val client = appState.clientForJob(liveJob)
    val jobColor = try { parseColor(liveJob.color) } catch (_: Exception) { c.accent }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(liveJob.title, fontWeight = FontWeight.Bold, color = c.text, maxLines = 1)
                        liveJob.jobNumber?.let { Text("#$it", fontSize = 12.sp, color = c.muted) }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = c.accent)
                    }
                },
                actions = {
                    IconButton(onClick = { navController.navigate(Screen.JobEdit.createRoute(liveJob.id)) }) {
                        Icon(Icons.Default.Edit, "Edit", tint = c.accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = c.surface)
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(c.bg),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header card
            item {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = c.card),
                    border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            StatusBadge(liveJob.status)
                            PriorityDot(liveJob.pri)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DetailChip("Start", liveJob.start.shortDate())
                            DetailChip("End", liveJob.end.shortDate())
                            liveJob.dueDate?.let { DetailChip("Due", it.shortDate()) }
                        }
                        client?.let { DetailChip("Client", it.name) }
                        if (liveJob.notes.isNotEmpty()) {
                            Text(liveJob.notes, fontSize = 13.sp, color = c.muted)
                        }
                    }
                }
            }

            // Team
            if (liveJob.team.isNotEmpty()) {
                item {
                    SectionHeader("Team (${liveJob.team.size})")
                }
                items(liveJob.team) { personId ->
                    val person = appState.person(personId)
                    if (person != null) {
                        PersonChip(person = person)
                    }
                }
            }

            // Panels
            if (liveJob.subs.isNotEmpty()) {
                item { SectionHeader("Panels (${liveJob.subs.size})") }
                items(liveJob.subs) { panel ->
                    PanelCard(panel = panel, job = liveJob, appState = appState)
                }
            }
        }
    }
}

@Composable
fun DetailChip(label: String, value: String) {
    val c = traQSColors
    Column(
        modifier = Modifier
            .background(c.surface, RoundedCornerShape(8.dp))
            .border(1.dp, c.border, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp)
    ) {
        Text(label, fontSize = 10.sp, color = c.muted)
        Text(value, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.text)
    }
}

@Composable
fun SectionHeader(title: String) {
    val c = traQSColors
    Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.text, modifier = Modifier.padding(top = 4.dp))
}

@Composable
fun PersonChip(person: com.matrixsystems.traqs.models.Person) {
    val c = traQSColors
    val personColor = try { parseColor(person.color) } catch (_: Exception) { c.accent }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(c.card, RoundedCornerShape(8.dp))
            .border(1.dp, c.border, RoundedCornerShape(8.dp))
            .padding(10.dp)
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(androidx.compose.foundation.shape.CircleShape)
                .background(personColor),
            contentAlignment = Alignment.Center
        ) {
            Text(person.name.take(1).uppercase(), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = androidx.compose.ui.graphics.Color.White)
        }
        Column {
            Text(person.name, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.text)
            Text(person.role, fontSize = 11.sp, color = c.muted)
        }
    }
}

@Composable
fun PanelCard(panel: Panel, job: Job, appState: AppState) {
    val c = traQSColors
    Card(
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = androidx.compose.foundation.BorderStroke(1.dp, c.border),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(panel.title, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.text, modifier = Modifier.weight(1f))
                StatusBadge(panel.status)
            }
            Text(
                "${panel.start.shortDate()} → ${panel.end.shortDate()}",
                fontSize = 11.sp,
                color = c.muted
            )
            if (panel.subs.isNotEmpty()) {
                Text("${panel.subs.size} operations", fontSize = 11.sp, color = c.muted)
            }
        }
    }
}
