package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.*
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.text.SimpleDateFormat
import java.util.*

// Fast TRAQS: shows today's / upcoming operations for the current user with quick status toggle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FastTRAQSScreen(appState: AppState, onDismiss: () -> Unit) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val person = appState.currentPerson
    val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    // Operations assigned to this person that are active or coming up
    data class OpEntry(val job: Job, val panel: Panel, val op: Operation)
    val myOps = remember(jobs, person) {
        if (person == null) return@remember emptyList()
        jobs.flatMap { job ->
            job.subs.flatMap { panel ->
                panel.subs.filter { op ->
                    person.id in op.team &&
                        op.status != JobStatus.FINISHED &&
                        op.end >= today
                }.map { OpEntry(job, panel, it) }
            }
        }.sortedWith(compareBy({ it.op.start }, { it.job.title }))
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = c.surface,
        modifier = Modifier.fillMaxHeight(0.85f)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(c.surface)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("⚡", fontSize = 20.sp)
                    Column {
                        Text("Fast TRAQS", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.text)
                        Text(person?.name ?: "Not signed in", fontSize = 12.sp, color = c.muted)
                    }
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, "Close", tint = c.muted)
                }
            }

            HorizontalDivider(color = c.border)

            if (person == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Sign in to see your tasks", color = c.muted)
                }
            } else if (myOps.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.CheckCircle, null, tint = c.statusFinished, modifier = Modifier.size(48.dp))
                        Text("All caught up!", fontWeight = FontWeight.Bold, color = c.text)
                        Text("No active tasks assigned to you", color = c.muted, fontSize = 13.sp)
                    }
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(myOps, key = { it.op.id }) { (job, panel, op) ->
                        FastTRAQSOpCard(
                            job = job,
                            panel = panel,
                            op = op,
                            onToggle = { newStatus ->
                                val updatedOp = op.copy(status = newStatus)
                                val updatedSubs = panel.subs.toMutableList().also { list ->
                                    val idx = list.indexOfFirst { it.id == op.id }
                                    if (idx >= 0) list[idx] = updatedOp
                                }
                                val updatedPanel = panel.copy(subs = updatedSubs)
                                val updatedPanels = job.subs.toMutableList().also { list ->
                                    val idx = list.indexOfFirst { it.id == panel.id }
                                    if (idx >= 0) list[idx] = updatedPanel
                                }
                                appState.updateJob(job.copy(subs = updatedPanels))
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun FastTRAQSOpCard(
    job: Job,
    panel: Panel,
    op: Operation,
    onToggle: (JobStatus) -> Unit
) {
    val c = traQSColors

    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = androidx.compose.foundation.BorderStroke(1.dp, c.border),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Status toggle button
            val isInProgress = op.status == JobStatus.IN_PROGRESS
            val isFinished = op.status == JobStatus.FINISHED
            IconButton(
                onClick = {
                    onToggle(
                        when (op.status) {
                            JobStatus.NOT_STARTED, JobStatus.PENDING -> JobStatus.IN_PROGRESS
                            JobStatus.IN_PROGRESS -> JobStatus.FINISHED
                            else -> JobStatus.NOT_STARTED
                        }
                    )
                },
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    when {
                        isFinished -> Icons.Default.CheckCircle
                        isInProgress -> Icons.Default.PlayCircle
                        else -> Icons.Default.RadioButtonUnchecked
                    },
                    null,
                    tint = when {
                        isFinished -> c.statusFinished
                        isInProgress -> c.statusInProgress
                        else -> c.muted
                    },
                    modifier = Modifier.size(28.dp)
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(op.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = c.text, maxLines = 1)
                Text("${job.title} › ${panel.title}", fontSize = 11.sp, color = c.muted, maxLines = 1)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("${op.start.shortDate()} → ${op.end.shortDate()}", fontSize = 11.sp, color = c.muted)
                    StatusBadge(op.status)
                }
            }

            Text("${op.hpd}h/d", fontSize = 11.sp, color = c.muted)
        }
    }
}
