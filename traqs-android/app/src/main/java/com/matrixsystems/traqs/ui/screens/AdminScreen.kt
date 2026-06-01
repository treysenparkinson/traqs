package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.Coffee
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.ActiveClockIn
import com.matrixsystems.traqs.models.Person
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.parseFlexibleISO
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.max

// Admin live status board — mirrors iOS AdminView. Full-screen, admin-only.

private enum class AdminFilter(val label: String) { LIVE("Live"), BY_DEPT("By dept"), TODAY("Today") }

private enum class WorkerStatus { ON_JOB, ON_BREAK, ON_LUNCH, IDLE, OFFLINE }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(appState: AppState, onBack: () -> Unit) {
    val c = traQSColors
    val people by appState.people.collectAsState()
    val jobs by appState.jobs.collectAsState()
    var filter by remember { mutableStateOf(AdminFilter.LIVE) }

    // Faster poll while on this screen — matches iOS's 5s while task is active.
    LaunchedEffect(Unit) {
        appState.loadAll()
        while (true) {
            delay(5_000)
            appState.loadAll()
        }
    }

    val team = remember(people) { people.sortedBy { it.name.lowercase() } }
    val statuses = remember(team) { team.associateWith { statusFor(it) } }
    val onJob = team.filter { statuses[it] == WorkerStatus.ON_JOB }
    val onBreak = team.filter { statuses[it] == WorkerStatus.ON_BREAK }
    val onLunch = team.filter { statuses[it] == WorkerStatus.ON_LUNCH }
    val idle = team.filter { statuses[it] == WorkerStatus.IDLE }
    val offline = team.filter { statuses[it] == WorkerStatus.OFFLINE }

    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) { now = System.currentTimeMillis(); delay(1000) }
    }

    Scaffold(containerColor = c.bg) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .statusBarsPadding()
                .background(c.bg),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            // Top bar: back button (iOS AdminView style)
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TRAQSIconBtn(icon = Icons.Default.ChevronLeft, contentDescription = "Back", onClick = onBack)
                }
            }

            // Title block
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Live status", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = c.text)
                    val df = SimpleDateFormat("EEE · MMM d · h:mm a", Locale.US)
                    Text("${df.format(Date(now))} · auto-refresh", fontSize = 13.sp, color = c.muted)
                }
            }

            // Stat tiles
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatTile("ON JOB", onJob.size, Color(0xFF10B981))
                    StatTile("BREAK", onBreak.size, Color(0xFFF59E0B))
                    StatTile("LUNCH", onLunch.size, Color(0xFFEAB308))
                    StatTile("IDLE", idle.size, c.accent)
                    StatTile("OFFLINE", offline.size, c.muted)
                }
            }

            // Filter pills
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        AdminFilter.entries.forEach { f ->
                            val on = filter == f
                            Surface(
                                onClick = { filter = f },
                                shape = RoundedCornerShape(20.dp),
                                color = if (on) c.accent else c.surface,
                                border = BorderStroke(1.dp, if (on) Color.Transparent else c.border)
                            ) {
                                Text(
                                    f.label,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (on) Color.White else c.text,
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp)
                                )
                            }
                        }
                    }
                }
            }

            when (filter) {
                AdminFilter.LIVE -> {
                    if (onJob.isNotEmpty()) {
                        item { AdminSectionHeader("On a job", onJob.size) }
                        items(onJob.chunked(2).size) { rowIdx ->
                            val chunk = onJob.chunked(2)[rowIdx]
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                chunk.forEach { p ->
                                    Box(modifier = Modifier.weight(1f)) {
                                        OnJobCard(p, jobs.firstOrNull { it.id == p.activeJobClock?.jobId }?.title, now)
                                    }
                                }
                                if (chunk.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    if (onBreak.isNotEmpty()) {
                        item { AdminSectionHeader("On break", onBreak.size) }
                        items(onBreak.size) { i -> OnBreakCard(onBreak[i], now) }
                    }
                    if (onLunch.isNotEmpty()) {
                        item { AdminSectionHeader("On lunch", onLunch.size) }
                        items(onLunch.size) { i -> OnLunchCard(onLunch[i], lunchStartFor(onLunch[i]), now) }
                    }
                    if (idle.isNotEmpty()) {
                        item { AdminSectionHeader("Idle", idle.size) }
                        items(idle.size) { i -> IdleOfflineCard(idle[i], "Logged in, no active job") }
                    }
                    if (offline.isNotEmpty()) {
                        item { AdminSectionHeader("Offline", offline.size) }
                        items(offline.size) { i -> IdleOfflineCard(offline[i], "Not clocked in") }
                    }
                }
                AdminFilter.BY_DEPT -> {
                    val grouped = team.groupBy { it.role.ifEmpty { "Unassigned" } }.toSortedMap()
                    grouped.forEach { (dept, members) ->
                        item { AdminSectionHeader(dept, members.size) }
                        items(members.size) { i -> IdleOfflineCard(members[i], statusLabelByDept(members[i])) }
                    }
                }
                AdminFilter.TODAY -> {
                    item { AdminSectionHeader("Today", team.size) }
                    items(team.size) { i ->
                        val p = team[i]
                        val label = p.activeClockIn?.clockIn?.let { iso -> "Since ${timeLabel(iso)}" } ?: "Not in"
                        IdleOfflineCard(p, label)
                    }
                }
            }
        }
    }
}

private fun statusFor(p: Person): WorkerStatus {
    if (isOnLunch(p.activeClockIn)) return WorkerStatus.ON_LUNCH
    if (p.activeBreak != null) return WorkerStatus.ON_BREAK
    if (p.activeJobClock != null) return WorkerStatus.ON_JOB
    if (p.activeClockIn != null) return WorkerStatus.IDLE
    return WorkerStatus.OFFLINE
}

// activeClockIn.events isn't modelled yet in Android; treat lunch as not-on for now.
// (Same shape as iOS but we just don't have the events list parsed yet.)
private fun isOnLunch(ac: ActiveClockIn?): Boolean = false

private fun lunchStartFor(p: Person): String? = null  // parity stub — see above

private fun statusLabelByDept(p: Person): String {
    if (p.activeJobClock != null) return if (p.activeBreak != null) "On break" else "On a job"
    if (p.activeClockIn != null) return "Logged in"
    return "Offline"
}

// MARK: - UI components

@Composable
private fun RowScope.StatTile(label: String, count: Int, color: Color) {
    val c = traQSColors
    Column(
        modifier = Modifier
            .weight(1f)
            .clip(RoundedCornerShape(10.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(10.dp))
            .padding(horizontal = 4.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text("$count", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = color)
        Text(label, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.muted, letterSpacing = 0.6.sp, maxLines = 1)
    }
}

@Composable
private fun AdminSectionHeader(title: String, count: Int) {
    val c = traQSColors
    Row(
        modifier = Modifier.padding(top = 6.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.text)
        Spacer(Modifier.weight(1f))
        Text("$count", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.muted)
    }
}

@Composable
private fun PersonAvatar(person: Person, statusColor: Color = Color.Transparent) {
    val c = traQSColors
    val color = try { parseColor(person.color) } catch (_: Exception) { c.accent }
    val initials = remember(person.name) {
        person.name.split(" ").take(2)
            .map { it.firstOrNull()?.uppercaseChar()?.toString() ?: "" }
            .joinToString("")
    }
    Box(contentAlignment = Alignment.BottomEnd) {
        Box(
            modifier = Modifier.size(36.dp).clip(CircleShape).background(color),
            contentAlignment = Alignment.Center
        ) {
            Text(initials, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White)
        }
        if (statusColor != Color.Transparent) {
            Box(
                modifier = Modifier
                    .size(11.dp)
                    .clip(CircleShape)
                    .background(statusColor)
                    .border(2.dp, c.surface, CircleShape)
                    .offset(x = 2.dp, y = 2.dp)
            )
        }
    }
}

@Composable
private fun OnJobCard(person: Person, jobTitle: String?, now: Long) {
    val c = traQSColors
    val statusColor = Color(0xFF10B981)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PersonAvatar(person, statusColor)
            Column(modifier = Modifier.weight(1f)) {
                Text(person.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text, maxLines = 1)
                if (person.role.isNotEmpty()) Text(person.role, fontSize = 11.sp, color = c.muted, maxLines = 1)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(statusColor))
            Text(elapsedSince(person.activeJobClock?.clockIn, now), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = statusColor)
            Spacer(Modifier.weight(1f))
            Text("since ${timeLabel(person.activeJobClock?.clockIn)}", fontSize = 11.sp, color = c.muted)
        }
        val jobLine = buildString {
            jobTitle?.takeIf { it.isNotEmpty() }?.let { append(it) }
            person.activeJobClock?.opTitle?.takeIf { it.isNotEmpty() }?.let {
                if (isNotEmpty()) append(" · ")
                append(it.uppercase())
            }
        }
        if (jobLine.isNotEmpty()) {
            Text(jobLine, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.text, maxLines = 2)
        }
    }
}

@Composable
private fun OnBreakCard(person: Person, now: Long) {
    val c = traQSColors
    val statusColor = Color(0xFFF59E0B)
    val brk = person.activeBreak
    val elapsed = elapsedSince(brk?.startedAt, now)
    val durMin = brk?.durationMinutes ?: 0
    val startedMs = parseFlexibleISO(brk?.startedAt) ?: now
    val endsAt = startedMs + durMin * 60L * 1000
    val overByMin = max(0L, (now - endsAt) / 60_000L)
    val breakLabel = if (overByMin > 0) "$elapsed on break · ${overByMin}m over" else "$elapsed on break"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        PersonAvatar(person, statusColor)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(person.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text)
                if (person.role.isNotEmpty()) Text(person.role, fontSize = 11.sp, color = c.muted)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(Icons.Default.Coffee, null, tint = statusColor, modifier = Modifier.size(11.dp))
                Text(breakLabel, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = statusColor)
            }
        }
    }
}

@Composable
private fun OnLunchCard(person: Person, sinceISO: String?, now: Long) {
    val c = traQSColors
    val statusColor = Color(0xFFEAB308)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        PersonAvatar(person, statusColor)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(person.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text)
                if (person.role.isNotEmpty()) Text(person.role, fontSize = 11.sp, color = c.muted)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(Icons.Default.Restaurant, null, tint = statusColor, modifier = Modifier.size(11.dp))
                Text("${elapsedSince(sinceISO, now)} on lunch", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = statusColor)
            }
        }
    }
}

@Composable
private fun IdleOfflineCard(person: Person, label: String) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        PersonAvatar(person, c.muted)
        Column(modifier = Modifier.weight(1f)) {
            Text(person.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text)
            if (person.role.isNotEmpty()) Text(person.role, fontSize = 11.sp, color = c.muted)
        }
        Text(label, fontSize = 11.sp, color = c.muted, maxLines = 1)
    }
}

// MARK: - Time helpers

private fun timeLabel(iso: String?): String {
    val ms = parseFlexibleISO(iso) ?: return "—"
    return SimpleDateFormat("HH:mm", Locale.US).format(Date(ms))
}

private fun elapsedSince(iso: String?, now: Long): String {
    val ms = parseFlexibleISO(iso) ?: return "—"
    val secs = max(0L, (now - ms) / 1000)
    return "${secs / 3600}h ${(secs % 3600) / 60}m"
}
