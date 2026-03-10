package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientsScreen(
    appState: AppState,
    navController: NavHostController? = null,
    onAskTRAQS: () -> Unit = {}
) {
    val c = traQSColors
    val clients by appState.clients.collectAsState()
    var searchText by remember { mutableStateOf("") }
    var editingClient by remember { mutableStateOf<Client?>(null) }
    var showNewClient by remember { mutableStateOf(false) }

    val filtered = remember(clients, searchText) {
        if (searchText.isEmpty()) clients
        else clients.filter { it.name.contains(searchText, ignoreCase = true) }
    }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TRAQSHeader(

                onAskTRAQS = onAskTRAQS,
                actions = {
                    IconButton(onClick = { showNewClient = true }) {
                        Icon(Icons.Default.Add, "Add Client", tint = c.accent)
                    }
                },

            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                OutlinedTextField(
                    value = searchText,
                    onValueChange = { searchText = it },
                    placeholder = { Text("Search clients…", color = c.muted) },
                    leadingIcon = { Icon(Icons.Default.Search, null, tint = c.muted) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
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
                    onClick = { editingClient = client }
                )
            }
        }
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
fun ClientRow(client: Client, onClick: () -> Unit) {
    val c = traQSColors
    val clientColor = try { parseColor(client.color) } catch (_: Exception) { c.accent }

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
                            color = client?.color ?: "#3d7fff"
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
        }
    }
}
