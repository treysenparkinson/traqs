package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.*
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobEditScreen(
    job: Job?,
    appState: AppState,
    onDismiss: () -> Unit
) {
    val c = traQSColors
    val isNew = job == null
    val clients by appState.clients.collectAsState()

    var title by remember { mutableStateOf(job?.title ?: "") }
    var jobNumber by remember { mutableStateOf(job?.jobNumber ?: "") }
    var poNumber by remember { mutableStateOf(job?.poNumber ?: "") }
    var startDate by remember { mutableStateOf(job?.start ?: "") }
    var endDate by remember { mutableStateOf(job?.end ?: "") }
    var status by remember { mutableStateOf(job?.status ?: JobStatus.NOT_STARTED) }
    var priority by remember { mutableStateOf(job?.pri ?: Priority.MEDIUM) }
    var notes by remember { mutableStateOf(job?.notes ?: "") }
    var selectedClientId by remember { mutableStateOf(job?.clientId) }
    var statusExpanded by remember { mutableStateOf(false) }
    var priorityExpanded by remember { mutableStateOf(false) }
    var clientExpanded by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TopAppBar(
                title = { Text(if (isNew) "New Job" else "Edit Job", fontWeight = FontWeight.Bold, color = c.text) },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, "Close", tint = c.muted)
                    }
                },
                actions = {
                    TextButton(
                        onClick = {
                            val newJob = Job(
                                id = job?.id ?: UUID.randomUUID().toString(),
                                title = title,
                                jobNumber = jobNumber.takeIf { it.isNotEmpty() },
                                poNumber = poNumber.takeIf { it.isNotEmpty() },
                                start = startDate,
                                end = endDate,
                                status = status,
                                pri = priority,
                                notes = notes,
                                clientId = selectedClientId,
                                color = job?.color ?: "#3d7fff",
                                team = job?.team ?: emptyList(),
                                subs = job?.subs ?: emptyList(),
                                hpd = job?.hpd ?: 7.5
                            )
                            appState.updateJob(newJob)
                            onDismiss()
                        },
                        enabled = title.isNotBlank() && startDate.isNotBlank() && endDate.isNotBlank()
                    ) {
                        Text("Save", color = c.accent, fontWeight = FontWeight.Bold)
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
            item { EditField("Job Title *", title) { title = it } }
            item { EditField("Job Number", jobNumber) { jobNumber = it } }
            item { EditField("PO Number", poNumber) { poNumber = it } }
            item { EditField("Start Date (yyyy-MM-dd) *", startDate) { startDate = it } }
            item { EditField("End Date (yyyy-MM-dd) *", endDate) { endDate = it } }

            // Status dropdown
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Status", fontSize = 12.sp, color = c.muted)
                    ExposedDropdownMenuBox(expanded = statusExpanded, onExpandedChange = { statusExpanded = it }) {
                        OutlinedTextField(
                            value = status.label,
                            onValueChange = {},
                            readOnly = true,
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(statusExpanded) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(),
                            colors = editFieldColors(c),
                            shape = RoundedCornerShape(10.dp)
                        )
                        ExposedDropdownMenu(expanded = statusExpanded, onDismissRequest = { statusExpanded = false }) {
                            JobStatus.entries.forEach {
                                DropdownMenuItem(
                                    text = { Text(it.label) },
                                    onClick = { status = it; statusExpanded = false }
                                )
                            }
                        }
                    }
                }
            }

            // Priority dropdown
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Priority", fontSize = 12.sp, color = c.muted)
                    ExposedDropdownMenuBox(expanded = priorityExpanded, onExpandedChange = { priorityExpanded = it }) {
                        OutlinedTextField(
                            value = priority.label,
                            onValueChange = {},
                            readOnly = true,
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(priorityExpanded) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(),
                            colors = editFieldColors(c),
                            shape = RoundedCornerShape(10.dp)
                        )
                        ExposedDropdownMenu(expanded = priorityExpanded, onDismissRequest = { priorityExpanded = false }) {
                            Priority.entries.forEach {
                                DropdownMenuItem(
                                    text = { Text(it.label) },
                                    onClick = { priority = it; priorityExpanded = false }
                                )
                            }
                        }
                    }
                }
            }

            // Client dropdown
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Client", fontSize = 12.sp, color = c.muted)
                    ExposedDropdownMenuBox(expanded = clientExpanded, onExpandedChange = { clientExpanded = it }) {
                        OutlinedTextField(
                            value = clients.firstOrNull { it.id == selectedClientId }?.name ?: "None",
                            onValueChange = {},
                            readOnly = true,
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(clientExpanded) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(),
                            colors = editFieldColors(c),
                            shape = RoundedCornerShape(10.dp)
                        )
                        ExposedDropdownMenu(expanded = clientExpanded, onDismissRequest = { clientExpanded = false }) {
                            DropdownMenuItem(text = { Text("None") }, onClick = { selectedClientId = null; clientExpanded = false })
                            clients.forEach {
                                DropdownMenuItem(
                                    text = { Text(it.name) },
                                    onClick = { selectedClientId = it.id; clientExpanded = false }
                                )
                            }
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Notes", fontSize = 12.sp, color = c.muted)
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                        colors = editFieldColors(c),
                        shape = RoundedCornerShape(10.dp),
                        minLines = 3
                    )
                }
            }
        }
    }
}

@Composable
fun EditField(label: String, value: String, onChange: (String) -> Unit) {
    val c = traQSColors
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, fontSize = 12.sp, color = c.muted)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = editFieldColors(c),
            shape = RoundedCornerShape(10.dp)
        )
    }
}

@Composable
fun editFieldColors(c: com.matrixsystems.traqs.ui.theme.TRAQSColors) = OutlinedTextFieldDefaults.colors(
    focusedTextColor = c.text,
    unfocusedTextColor = c.text,
    focusedContainerColor = c.surface,
    unfocusedContainerColor = c.surface,
    focusedBorderColor = c.accent,
    unfocusedBorderColor = c.border,
    cursorColor = c.accent
)
