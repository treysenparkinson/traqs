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
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.models.Client
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.util.UUID
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.pulltorefresh.PullToRefreshBox

private val CLIENT_COLOR_PALETTE = listOf(
    "#3d7fff", "#ef4444", "#22c55e", "#f59e0b",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientsScreen(
    appState: AppState,
    navController: NavHostController? = null,
    onAskTRAQS: () -> Unit = {}
) {
    val c = traQSColors
    val clients by appState.clients.collectAsState()
    val isLoading by appState.isLoading.collectAsState()
    var isManualRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(isLoading) { if (!isLoading) isManualRefreshing = false }
    var searchText by remember { mutableStateOf("") }
    var editingClient by remember { mutableStateOf<Client?>(null) }
    var showNewClient by remember { mutableStateOf(false) }
    var detailClient by remember { mutableStateOf<Client?>(null) }

    val filtered = remember(clients, searchText) {
        if (searchText.isEmpty()) clients
        else clients.filter { it.name.contains(searchText, ignoreCase = true) }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = { TRAQSHeader() }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isManualRefreshing,
            onRefresh = { isManualRefreshing = true; appState.loadAll() },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().background(c.bg),
            contentPadding = PaddingValues(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                PageActionBar(title = "Clients", onAskTRAQS = onAskTRAQS) {
                    Button(
                        onClick = { showNewClient = true },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                        modifier = Modifier.height(34.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                    ) {
                        Icon(Icons.Default.Add, null, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("New Client", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = searchText,
                    onValueChange = { searchText = it },
                    placeholder = { Text("Search clients…", color = c.muted) },
                    leadingIcon = { Icon(Icons.Default.Search, null, tint = c.muted) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = c.text,
                        unfocusedTextColor = c.text,
                        focusedContainerColor = c.surface,
                        unfocusedContainerColor = c.surface,
                        focusedBorderColor = c.accent,
                        unfocusedBorderColor = c.border
                    ),
                    shape = RoundedCornerShape(10.dp)
                )
            }

            items(filtered, key = { it.id }) { client ->
                ClientRow(
                    client = client,
                    onClick = { detailClient = client },
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }
        }
        } // PullToRefreshBox
    }

    // Detail view — tap client row → show detail, then can edit from detail
    detailClient?.let { client ->
        ClientDetailSheet(
            client = client,
            appState = appState,
            onEdit = { editingClient = client; detailClient = null },
            onDismiss = { detailClient = null }
        )
    }

    if (showNewClient || editingClient != null) {
        ClientEditSheet(
            client = editingClient,
            appState = appState,
            onDismiss = { showNewClient = false; editingClient = null }
        )
    }
}

@Composable
fun ClientRow(client: Client, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = traQSColors
    val clientColor = try { parseColor(client.color) } catch (_: Exception) { c.accent }

    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
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
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(clientColor),
                contentAlignment = Alignment.Center
            ) {
                Text(client.name.take(1).uppercase(), fontWeight = FontWeight.Bold, color = Color.White, fontSize = 16.sp)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(client.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = c.text)
                if (client.contact.isNotEmpty()) Text(client.contact, fontSize = 12.sp, color = c.muted)
                if (client.email.isNotEmpty()) Text(client.email, fontSize = 11.sp, color = c.muted)
            }
            Icon(Icons.Default.ChevronRight, null, tint = c.muted)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientEditSheet(client: Client?, appState: AppState, onDismiss: () -> Unit) {
    val c = traQSColors
    val isNew = client == null
    var name by remember { mutableStateOf(client?.name ?: "") }
    var contact by remember { mutableStateOf(client?.contact ?: "") }
    var email by remember { mutableStateOf(client?.email ?: "") }
    var phone by remember { mutableStateOf(client?.phone ?: "") }
    var notes by remember { mutableStateOf(client?.notes ?: "") }
    var selectedColor by remember { mutableStateOf(client?.color ?: "#3d7fff") }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = c.surface
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(if (isNew) "New Client" else "Edit Client", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.text)
                Row {
                    if (!isNew) {
                        TextButton(onClick = {
                            val updated = appState.clients.value.filter { it.id != client!!.id }
                            appState.updateClients(updated)
                            onDismiss()
                        }) { Text("Delete", color = c.danger) }
                    }
                    TextButton(onClick = {
                        val newClient = Client(
                            id = client?.id ?: UUID.randomUUID().toString(),
                            name = name, contact = contact, email = email,
                            phone = phone, notes = notes,
                            color = selectedColor
                        )
                        val updated = appState.clients.value.toMutableList()
                        val idx = updated.indexOfFirst { it.id == newClient.id }
                        if (idx >= 0) updated[idx] = newClient else updated.add(newClient)
                        appState.updateClients(updated)
                        onDismiss()
                    }, enabled = name.isNotBlank()) {
                        Text("Save", color = c.accent, fontWeight = FontWeight.Bold)
                    }
                }
            }
            EditField("Name *", name) { name = it }
            EditField("Contact", contact) { contact = it }
            EditField("Email", email) { email = it }
            EditField("Phone", phone) { phone = it }
            EditField("Notes", notes) { notes = it }
            // Color picker
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Color", fontSize = 12.sp, color = c.muted)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CLIENT_COLOR_PALETTE.forEach { hex ->
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
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientDetailSheet(client: Client, appState: AppState, onEdit: () -> Unit, onDismiss: () -> Unit) {
    val c = traQSColors
    val clientColor = try { parseColor(client.color) } catch (_: Exception) { c.accent }
    val jobs by appState.jobs.collectAsState()
    val clientJobs = remember(jobs) { jobs.filter { it.clientId == client.id } }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.surface) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(
                        modifier = Modifier.size(52.dp).clip(CircleShape).background(clientColor),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(client.name.take(1).uppercase(), fontWeight = FontWeight.Bold, color = Color.White, fontSize = 22.sp)
                    }
                    Text(client.name, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.text)
                }
                IconButton(onClick = onEdit) {
                    Icon(Icons.Default.Edit, "Edit", tint = c.accent)
                }
            }

            // Contact info
            if (client.contact.isNotEmpty() || client.email.isNotEmpty() || client.phone.isNotEmpty()) {
                Card(
                    shape = RoundedCornerShape(10.dp),
                    colors = CardDefaults.cardColors(containerColor = c.card),
                    border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (client.contact.isNotEmpty()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Person, null, tint = c.accent, modifier = Modifier.size(16.dp))
                                Text(client.contact, fontSize = 13.sp, color = c.text)
                            }
                        }
                        if (client.email.isNotEmpty()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Email, null, tint = c.accent, modifier = Modifier.size(16.dp))
                                Text(client.email, fontSize = 13.sp, color = c.text)
                            }
                        }
                        if (client.phone.isNotEmpty()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Phone, null, tint = c.accent, modifier = Modifier.size(16.dp))
                                Text(client.phone, fontSize = 13.sp, color = c.text)
                            }
                        }
                    }
                }
            }

            // Notes
            if (client.notes.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Notes", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.muted)
                    Text(client.notes, fontSize = 13.sp, color = c.text)
                }
            }

            // Jobs for this client
            if (clientJobs.isNotEmpty()) {
                Text("Jobs (${clientJobs.size})", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.text)
                clientJobs.forEach { job ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
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
