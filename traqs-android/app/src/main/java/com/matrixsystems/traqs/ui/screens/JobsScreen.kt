package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
fun JobsScreen(
    appState: AppState,
    navController: NavHostController,
    onAskTRAQS: () -> Unit = { navController.navigate(Screen.AskTRAQS.route) }
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val isLoading by appState.isLoading.collectAsState()
    var searchText by remember { mutableStateOf("") }
    var filterStatus by remember { mutableStateOf<JobStatus?>(null) }
    var showJobEdit by remember { mutableStateOf(false) }
    val engQueue = appState.engineeringQueue

    val filteredJobs = remember(jobs, searchText, filterStatus) {
        jobs.filter { job ->
            val matchSearch = searchText.isEmpty() ||
                job.title.contains(searchText, ignoreCase = true) ||
                (job.jobNumber ?: "").contains(searchText, ignoreCase = true)
            val matchStatus = filterStatus == null || job.status == filterStatus
            matchSearch && matchStatus
        }.sortedBy { it.start }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = { TRAQSHeader() }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            PullToRefreshBox(isRefreshing = isLoading, onRefresh = { appState.loadAll() }) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().background(c.bg),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    item {
                        PageActionBar(title = "Jobs", onAskTRAQS = onAskTRAQS) {
                            IconButton(
                                onClick = { appState.undo() },
                                enabled = appState.canUndo,
                                modifier = Modifier.size(34.dp)
                            ) {
                                Icon(Icons.Default.Undo, "Undo", tint = if (appState.canUndo) c.accent else c.muted, modifier = Modifier.size(18.dp))
                            }
                            Button(
                                onClick = { showJobEdit = true },
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
                    }

                    // Engineering Queue
                    if (engQueue.isNotEmpty()) {
                        item { EngineeringQueueSection(appState = appState, queue = engQueue) }
                    }

                    // Search bar
                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp)
                                .background(c.surface, RoundedCornerShape(10.dp))
                                .border(1.dp, c.border, RoundedCornerShape(10.dp))
                                .padding(10.dp)
                        ) {
                            Icon(Icons.Default.Search, null, tint = c.muted, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            BasicTextField(
                                value = searchText,
                                onValueChange = { searchText = it },
                                singleLine = true,
                                textStyle = androidx.compose.ui.text.TextStyle(color = c.text, fontSize = 14.sp),
                                decorationBox = { inner ->
                                    if (searchText.isEmpty()) Text("Search jobs…", color = c.muted, fontSize = 14.sp)
                                    inner()
                                },
                                modifier = Modifier.weight(1f)
                            )
                            if (searchText.isNotEmpty()) {
                                IconButton(onClick = { searchText = "" }, modifier = Modifier.size(20.dp)) {
                                    Icon(Icons.Default.Cancel, null, tint = c.muted, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }

                    // Filter chips
                    item {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(bottom = 8.dp)
                        ) {
                            item {
                                FilterChip(label = "All", isSelected = filterStatus == null) {
                                    filterStatus = null
                                }
                            }
                            items(JobStatus.entries) { status ->
                                FilterChip(
                                    label = status.label,
                                    isSelected = filterStatus == status,
                                    color = status.toColor(c)
                                ) {
                                    filterStatus = if (filterStatus == status) null else status
                                }
                            }
                        }
                    }

                    // Job list
                    items(filteredJobs, key = { it.id }) { job ->
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

    if (showJobEdit) {
        navController.navigate(Screen.JobEdit.createRoute(null))
        showJobEdit = false
    }
}

@Composable
fun JobRow(job: TRAQSJob, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = traQSColors
    val jobColor = try { parseColor(job.color) } catch (_: Exception) { c.accent }

    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = BorderStroke(1.dp, c.border)
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Box(modifier = Modifier.width(4.dp).height(64.dp).background(jobColor))

            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(
                            job.title,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = c.text,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        job.jobNumber?.let {
                            Text("#$it", fontSize = 12.sp, color = c.muted)
                        }
                    }
                    StatusBadge(job.status)
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "${job.start.shortDate()} → ${job.end.shortDate()}",
                        fontSize = 11.sp,
                        color = c.muted
                    )
                    PriorityDot(job.pri)
                }
            }
        }
    }
}

@Composable
fun EngineeringQueueSection(appState: AppState, queue: List<Pair<TRAQSJob, Panel>>) {
    val c = traQSColors
    var isExpanded by remember { mutableStateOf(true) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(c.surface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { isExpanded = !isExpanded }
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Build, null, tint = c.eng, modifier = Modifier.size(18.dp))
                Text("Engineering Queue", fontWeight = FontWeight.Bold, color = c.text, fontSize = 15.sp)
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "${queue.size}",
                    fontSize = 11.sp,
                    color = c.eng,
                    modifier = Modifier
                        .background(c.eng.copy(alpha = 0.2f), RoundedCornerShape(10.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                )
                Icon(
                    if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    null,
                    tint = c.muted,
                    modifier = Modifier.size(16.dp)
                )
            }
        }

        if (isExpanded) {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 0.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(bottom = 12.dp)
            ) {
                items(queue) { (job, panel) ->
                    EngineeringCard(job = job, panel = panel, appState = appState)
                }
            }
        }

        HorizontalDivider(color = c.border)
    }
}

@Composable
fun EngineeringCard(job: TRAQSJob, panel: Panel, appState: AppState) {
    val c = traQSColors
    val steps = EngStep.entries
    val eng = panel.engineering
    val activeIdx = when {
        eng?.designed == null -> 0
        eng.verified == null -> 1
        eng.sentToPerforex == null -> 2
        else -> 3
    }
    val person = appState.currentPerson

    Card(
        modifier = Modifier.width(200.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = BorderStroke(1.dp, c.border)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(job.title, fontSize = 11.sp, color = c.muted, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(panel.title, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.text, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(0.dp)
            ) {
                steps.forEachIndexed { idx, step ->
                    val done = idx < activeIdx
                    val active = idx == activeIdx
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(
                                when {
                                    done -> c.statusFinished
                                    active -> c.eng
                                    else -> c.border
                                }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        if (done) Text("✓", fontSize = 6.sp, color = Color.White)
                    }
                    if (idx < steps.size - 1) {
                        Box(
                            modifier = Modifier
                                .height(2.dp)
                                .weight(1f)
                                .background(if (done) c.statusFinished else c.border)
                        )
                    }
                }
            }

            if (activeIdx < 3 && person != null) {
                val step = EngStep.fromIndex(activeIdx)
                if (step != null) {
                    Button(
                        onClick = {
                            appState.signOff(job.id, panel.id, step, person.id, person.name)
                        },
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.eng),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 5.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text("Sign Off: ${step.label}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    }
                }
            }
        }
    }
}
