package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.Person
import com.matrixsystems.traqs.models.TimeOffEntry
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.util.UUID

private val PERSON_COLOR_PALETTE = listOf(
    "#3d7fff", "#ef4444", "#22c55e", "#f59e0b",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamScreen(appState: AppState, onBack: () -> Unit) {
    val c = traQSColors
    val people by appState.people.collectAsState()
    val jobs by appState.jobs.collectAsState()
    var editingPerson by remember { mutableStateOf<Person?>(null) }
    var showNewPerson by remember { mutableStateOf(false) }
    var detailPerson by remember { mutableStateOf<Person?>(null) }

    // Compute active ops per person
    val workloadMap = remember(jobs, people) {
        people.associate { person ->
            person.id to jobs.flatMap { job -> job.subs.flatMap { p -> p.subs.filter { person.id in it.team } } }.size
        }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TopAppBar(
                title = { Text("Team", fontWeight = FontWeight.Bold, color = c.text) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = c.accent)
                    }
                },
                actions = {
                    IconButton(onClick = { showNewPerson = true }) {
                        Icon(Icons.Default.PersonAdd, "Add Person", tint = c.accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = c.surface)
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(people, key = { "${it.id}_${it.name}" }) { person ->
                PersonRow(
                    person = person,
                    opCount = workloadMap[person.id] ?: 0,
                    onClick = { detailPerson = person }
                )
            }
        }
    }

    // Detail view
    detailPerson?.let { person ->
        PersonDetailSheet(
            person = person,
            appState = appState,
            onEdit = { editingPerson = person; detailPerson = null },
            onDismiss = { detailPerson = null }
        )
    }

    if (showNewPerson || editingPerson != null) {
        PersonEditSheet(
            person = editingPerson,
            appState = appState,
            onDismiss = { showNewPerson = false; editingPerson = null }
        )
    }
}

@Composable
fun PersonRow(person: Person, opCount: Int, onClick: () -> Unit) {
    val c = traQSColors
    val personColor = try { parseColor(person.color) } catch (_: Exception) { c.accent }

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier.size(44.dp).clip(CircleShape).background(personColor),
                contentAlignment = Alignment.Center
            ) {
                Text(person.name.take(1).uppercase(), fontWeight = FontWeight.Bold, color = Color.White, fontSize = 18.sp)
            }
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(person.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = c.text)
                    if (person.isAdmin) {
                        Text("Admin", fontSize = 10.sp, color = c.accent,
                            modifier = Modifier.background(c.accent.copy(alpha = 0.15f), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 2.dp))
                    }
                    if (person.isTeamLead == true) {
                        Text("Lead", fontSize = 10.sp, color = Color(0xFFF59E0B),
                            modifier = Modifier.background(Color(0xFFF59E0B).copy(alpha = 0.15f), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 2.dp))
                    }
                }
                Text(person.role, fontSize = 12.sp, color = c.muted)
                Text(person.email, fontSize = 11.sp, color = c.muted)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("$opCount", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.accent)
                Text("ops", fontSize = 10.sp, color = c.muted)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PersonDetailSheet(person: Person, appState: AppState, onEdit: () -> Unit, onDismiss: () -> Unit) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val personColor = try { parseColor(person.color) } catch (_: Exception) { c.accent }

    val activeTasks = remember(jobs) {
        jobs.count { job -> person.id in job.team && job.status == com.matrixsystems.traqs.models.JobStatus.IN_PROGRESS }
    }
    val pendingTasks = remember(jobs) {
        jobs.count { job -> person.id in job.team && job.status == com.matrixsystems.traqs.models.JobStatus.PENDING }
    }
    val assignedJobs = remember(jobs) {
        jobs.filter { job -> person.id in job.team }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.surface) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth().navigationBarsPadding(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(
                            modifier = Modifier.size(52.dp).clip(CircleShape).background(personColor),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(person.name.take(1).uppercase(), fontWeight = FontWeight.Bold, color = Color.White, fontSize = 22.sp)
                        }
                        Column {
                            Text(person.name, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.text)
                            if (person.role.isNotEmpty()) Text(person.role, fontSize = 13.sp, color = c.muted)
                        }
                    }
                    IconButton(onClick = onEdit) {
                        Icon(Icons.Default.Edit, "Edit", tint = c.accent)
                    }
                }
            }

            // Stats row
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("Active", "$activeTasks", Icons.Default.PlayCircle, Modifier.weight(1f), c.statusInProgress)
                    StatCard("Pending", "$pendingTasks", Icons.Default.Pending, Modifier.weight(1f), c.statusPending)
                    StatCard("Cap", "${person.cap}h", Icons.Default.AccessTime, Modifier.weight(1f))
                }
            }

            // Badges
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (person.isAdmin) {
                        Text("Admin", fontSize = 11.sp, color = c.accent,
                            modifier = Modifier.background(c.accent.copy(alpha = 0.15f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp))
                    }
                    if (person.isEngineer == true) {
                        Text("Engineer", fontSize = 11.sp, color = Color(0xFF22C55E),
                            modifier = Modifier.background(Color(0xFF22C55E).copy(alpha = 0.15f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp))
                    }
                    if (person.isTeamLead == true) {
                        Text("Team Lead", fontSize = 11.sp, color = Color(0xFFF59E0B),
                            modifier = Modifier.background(Color(0xFFF59E0B).copy(alpha = 0.15f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp))
                    }
                }
            }

            // Time off
            if (person.timeOff.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Time Off", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.text)
                        person.timeOff.forEach { to ->
                            Row(
                                modifier = Modifier.fillMaxWidth()
                                    .background(c.card, RoundedCornerShape(8.dp))
                                    .border(1.dp, c.border, RoundedCornerShape(8.dp))
                                    .padding(10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text("${to.start} → ${to.end}", fontSize = 12.sp, color = c.text)
                                Text(to.type, fontSize = 11.sp, color = c.muted)
                            }
                        }
                    }
                }
            }

            // Assigned jobs
            if (assignedJobs.isNotEmpty()) {
                item {
                    Text("Assigned Work (${assignedJobs.size})", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.text)
                }
                items(assignedJobs) { job ->
                    Row(
                        modifier = Modifier.fillMaxWidth()
                            .background(c.card, RoundedCornerShape(8.dp))
                            .border(1.dp, c.border, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(job.title, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.text)
                            Text("${job.start.shortDate()} → ${job.end.shortDate()}", fontSize = 11.sp, color = c.muted)
                        }
                        StatusBadge(job.status)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PersonEditSheet(person: Person?, appState: AppState, onDismiss: () -> Unit) {
    val c = traQSColors
    val isNew = person == null
    val maxId = appState.people.value.maxOfOrNull { it.id } ?: 0
    var name by remember { mutableStateOf(person?.name ?: "") }
    var role by remember { mutableStateOf(person?.role ?: "") }
    var email by remember { mutableStateOf(person?.email ?: "") }
    var selectedColor by remember { mutableStateOf(person?.color ?: "#3d7fff") }
    var cap by remember { mutableStateOf(person?.cap ?: 8.0) }
    var isEngineer by remember { mutableStateOf(person?.isEngineer ?: false) }
    var isTeamLead by remember { mutableStateOf(person?.isTeamLead ?: false) }
    var isAdmin by remember { mutableStateOf(person?.userRole == "admin") }
    var autoSchedule by remember { mutableStateOf(person?.autoSchedule ?: true) }
    var timeOffEntries by remember { mutableStateOf(person?.timeOff ?: emptyList()) }
    var showAddTimeOff by remember { mutableStateOf(false) }
    var newToType by remember { mutableStateOf("PTO") }
    var newToStart by remember { mutableStateOf("") }
    var newToEnd by remember { mutableStateOf("") }
    var newToReason by remember { mutableStateOf("") }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = c.surface
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth().navigationBarsPadding(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(if (isNew) "New Person" else "Edit Person", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.text)
                    Row {
                        if (!isNew) {
                            TextButton(onClick = { showDeleteConfirm = true }) {
                                Text("Delete", color = c.danger)
                            }
                        }
                        TextButton(
                            onClick = {
                                val updated = if (isNew) {
                                    appState.people.value + Person(
                                        id = maxId + 1, name = name, role = role, email = email,
                                        cap = cap, color = selectedColor,
                                        userRole = if (isAdmin) "admin" else "user",
                                        isEngineer = isEngineer,
                                        isTeamLead = isTeamLead,
                                        autoSchedule = autoSchedule,
                                        timeOff = timeOffEntries
                                    )
                                } else {
                                    appState.people.value.map {
                                        if (it.id == person!!.id) it.copy(
                                            name = name, role = role, email = email,
                                            cap = cap, color = selectedColor,
                                            userRole = if (isAdmin) "admin" else "user",
                                            isEngineer = isEngineer,
                                            isTeamLead = isTeamLead,
                                            autoSchedule = autoSchedule,
                                            timeOff = timeOffEntries
                                        ) else it
                                    }
                                }
                                appState.updatePeople(updated)
                                onDismiss()
                            },
                            enabled = name.isNotBlank()
                        ) {
                            Text("Save", color = c.accent, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            item { EditField("Name *", name) { name = it } }
            item { EditField("Role", role) { role = it } }
            item { EditField("Email", email) { email = it } }

            // Color picker
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Color", fontSize = 12.sp, color = c.muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PERSON_COLOR_PALETTE.forEach { hex ->
                            val color = try { parseColor(hex) } catch (_: Exception) { c.accent }
                            val isSelected = selectedColor == hex
                            Box(
                                modifier = Modifier
                                    .size(34.dp)
                                    .clip(CircleShape)
                                    .background(color)
                                    .then(if (isSelected) Modifier.border(3.dp, Color.White, CircleShape) else Modifier)
                                    .clickable { selectedColor = hex },
                                contentAlignment = Alignment.Center
                            ) {
                                if (isSelected) {
                                    Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
            }

            // Capacity stepper (1–16h, 0.5h steps)
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Daily Capacity: ${cap}h", fontSize = 12.sp, color = c.muted)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        IconButton(
                            onClick = { if (cap > 1.0) cap = (cap - 0.5).coerceAtLeast(1.0) },
                            enabled = cap > 1.0
                        ) {
                            Icon(Icons.Default.Remove, null, tint = if (cap > 1.0) c.accent else c.muted)
                        }
                        Text("${cap}h", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = c.text)
                        IconButton(
                            onClick = { if (cap < 16.0) cap = (cap + 0.5).coerceAtMost(16.0) },
                            enabled = cap < 16.0
                        ) {
                            Icon(Icons.Default.Add, null, tint = if (cap < 16.0) c.accent else c.muted)
                        }
                    }
                }
            }

            // Time Off management
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Time Off", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                        IconButton(onClick = { showAddTimeOff = !showAddTimeOff }) {
                            Icon(
                                if (showAddTimeOff) Icons.Default.Close else Icons.Default.Add,
                                null, tint = c.accent, modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                    timeOffEntries.forEach { entry ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(c.bg, RoundedCornerShape(8.dp))
                                .border(1.dp, c.border, RoundedCornerShape(8.dp))
                                .padding(start = 10.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("${entry.start} → ${entry.end}", fontSize = 12.sp, color = c.text)
                                Text(
                                    "${entry.type}${entry.reason?.let { " — $it" } ?: ""}",
                                    fontSize = 11.sp, color = c.muted
                                )
                            }
                            IconButton(
                                onClick = { timeOffEntries = timeOffEntries - entry },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(Icons.Default.Close, null, tint = c.danger, modifier = Modifier.size(14.dp))
                            }
                        }
                    }
                    if (showAddTimeOff) {
                        Column(
                            modifier = Modifier
                                .background(c.bg, RoundedCornerShape(8.dp))
                                .border(1.dp, c.border, RoundedCornerShape(8.dp))
                                .padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf("PTO", "UTO").forEach { t ->
                                    FilterChip(
                                        selected = newToType == t,
                                        onClick = { newToType = t },
                                        label = { Text(t, fontSize = 12.sp) }
                                    )
                                }
                            }
                            EditField("Start (YYYY-MM-DD)", newToStart) { newToStart = it }
                            EditField("End (YYYY-MM-DD)", newToEnd) { newToEnd = it }
                            EditField("Reason (optional)", newToReason) { newToReason = it }
                            Button(
                                onClick = {
                                    timeOffEntries = timeOffEntries + TimeOffEntry(
                                        start = newToStart, end = newToEnd,
                                        type = newToType,
                                        reason = newToReason.takeIf { it.isNotBlank() }
                                    )
                                    newToStart = ""; newToEnd = ""; newToReason = ""
                                    showAddTimeOff = false
                                },
                                enabled = newToStart.isNotBlank() && newToEnd.isNotBlank(),
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                            ) {
                                Text("Add Entry", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                        }
                    }
                }
            }

            // Toggles
            item {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Is Engineer", fontSize = 14.sp, color = c.text)
                        Switch(
                            checked = isEngineer,
                            onCheckedChange = { isEngineer = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = c.accent)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Is Team Lead", fontSize = 14.sp, color = c.text)
                        Switch(
                            checked = isTeamLead,
                            onCheckedChange = { isTeamLead = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = c.accent)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Admin", fontSize = 14.sp, color = c.text)
                        Switch(
                            checked = isAdmin,
                            onCheckedChange = { isAdmin = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = c.accent)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Auto-Scheduling", fontSize = 14.sp, color = c.text)
                        Switch(
                            checked = autoSchedule,
                            onCheckedChange = { autoSchedule = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = c.accent)
                        )
                    }
                }
            }
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete Person", color = c.text) },
            text = { Text("Are you sure you want to remove ${person?.name}?", color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    appState.updatePeople(appState.people.value.filter { it.id != person!!.id })
                    onDismiss()
                }) { Text("Delete", color = c.danger) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("Cancel", color = c.muted) }
            },
            containerColor = c.card
        )
    }
}
