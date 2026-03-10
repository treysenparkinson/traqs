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
import com.matrixsystems.traqs.models.Person
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamScreen(appState: AppState, onBack: () -> Unit) {
    val c = traQSColors
    val people by appState.people.collectAsState()
    val jobs by appState.jobs.collectAsState()
    var editingPerson by remember { mutableStateOf<Person?>(null) }
    var showNewPerson by remember { mutableStateOf(false) }

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
            items(people, key = { it.id }) { person ->
                PersonRow(
                    person = person,
                    opCount = workloadMap[person.id] ?: 0,
                    onClick = { editingPerson = person }
                )
            }
        }
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
fun PersonEditSheet(person: Person?, appState: AppState, onDismiss: () -> Unit) {
    val c = traQSColors
    val isNew = person == null
    val maxId = appState.people.value.maxOfOrNull { it.id } ?: 0
    var name by remember { mutableStateOf(person?.name ?: "") }
    var role by remember { mutableStateOf(person?.role ?: "") }
    var email by remember { mutableStateOf(person?.email ?: "") }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = c.surface
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(if (isNew) "New Person" else "Edit Person", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.text)
                TextButton(
                    onClick = {
                        val updated = if (isNew) {
                            appState.people.value + Person(
                                id = maxId + 1, name = name, role = role, email = email,
                                cap = 8.0, color = "#3d7fff", userRole = "user"
                            )
                        } else {
                            appState.people.value.map { if (it.id == person!!.id) it.copy(name = name, role = role, email = email) else it }
                        }
                        appState.updatePeople(updated)
                        onDismiss()
                    },
                    enabled = name.isNotBlank()
                ) {
                    Text("Save", color = c.accent, fontWeight = FontWeight.Bold)
                }
            }
            EditField("Name *", name) { name = it }
            EditField("Role", role) { role = it }
            EditField("Email", email) { email = it }
        }
    }
}
