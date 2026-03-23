package com.matrixsystems.traqs.ui.screens

import android.app.Activity
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.models.ActiveClockIn
import com.matrixsystems.traqs.models.ClockEntry
import com.matrixsystems.traqs.models.JobRef
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.services.ThemeSettings
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreScreen(
    appState: AppState,
    authManager: AuthManager,
    themeSettings: ThemeSettings,
    navController: NavHostController,
    activity: Activity,
    onAskTRAQS: () -> Unit = { navController.navigate(Screen.AskTRAQS.route) }
) {
    val c = traQSColors
    val person = appState.currentPerson
    val email by authManager.userEmail.collectAsState()
    val orgCode by appState.orgCode.collectAsState()
    var showLogoutConfirm by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = c.bg,
        topBar = { TRAQSHeader() }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                PageActionBar(title = "More", onAskTRAQS = onAskTRAQS)
            }

            // Profile card
            item {
                Card(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = c.card),
                    border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        val personColor = person?.color?.let { try { parseColor(it) } catch (_: Exception) { c.accent } } ?: c.accent
                        Box(
                            modifier = Modifier.size(52.dp).clip(CircleShape).background(personColor),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                (person?.name?.take(1) ?: email?.take(1) ?: "?").uppercase(),
                                fontWeight = FontWeight.Bold, color = Color.White, fontSize = 22.sp
                            )
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(person?.name ?: "Unknown", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
                                if (person?.isAdmin == true) {
                                    Text(
                                        "Admin",
                                        fontSize = 10.sp,
                                        color = c.accent,
                                        modifier = Modifier
                                            .background(c.accent.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                                            .padding(horizontal = 5.dp, vertical = 2.dp)
                                    )
                                }
                            }
                            Text(email ?: "", fontSize = 12.sp, color = c.muted)
                            person?.role?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, fontSize = 12.sp, color = c.muted)
                            }
                            if (orgCode.isNotEmpty()) {
                                Text(
                                    "Org: $orgCode",
                                    fontSize = 10.sp,
                                    color = c.muted,
                                    modifier = Modifier
                                        .padding(top = 2.dp)
                                        .background(c.surface, RoundedCornerShape(4.dp))
                                        .border(1.dp, c.border, RoundedCornerShape(4.dp))
                                        .padding(horizontal = 5.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(4.dp)) }

            item {
                Box(Modifier.padding(horizontal = 16.dp)) {
                    MenuSection("Scheduling") {
                        MenuItem(Icons.Default.AutoAwesome, "Ask TRAQS", c.accent) {
                            navController.navigate(Screen.AskTRAQS.route)
                        }
                        MenuItem(Icons.Default.BarChart, "Analytics", c.accent) {
                            navController.navigate(Screen.Analytics.route)
                        }
                        MenuItem(Icons.Default.People, "Team", c.accent) {
                            navController.navigate(Screen.Team.route)
                        }
                        MenuItem(Icons.Default.Business, "Clients", c.accent) {
                            navController.navigate(Screen.Clients.route)
                        }
                    }
                }
            }

            item {
                Box(Modifier.padding(horizontal = 16.dp)) {
                    MenuSection("Settings") {
                        MenuItem(Icons.Default.Palette, "Customize", c.accent) {
                            navController.navigate(Screen.Customize.route)
                        }
                        MenuItem(Icons.Default.Refresh, "Refresh Data", c.accent) {
                            appState.loadAll()
                        }
                        MenuItem(Icons.Default.Logout, "Sign Out", c.danger) {
                            showLogoutConfirm = true
                        }
                    }
                }
            }
        }
    }

    if (showLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showLogoutConfirm = false },
            title = { Text("Sign Out", color = c.text) },
            text = { Text("Are you sure you want to sign out?", color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutConfirm = false
                    authManager.logout(activity)
                    navController.navigate("login") { popUpTo(0) { inclusive = true } }
                }) { Text("Sign Out", color = c.danger) }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutConfirm = false }) { Text("Cancel", color = c.muted) }
            },
            containerColor = c.card
        )
    }
}

@Composable
fun MenuSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    val c = traQSColors
    Column {
        Text(title, fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = c.card),
            border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
        ) {
            Column(content = content)
        }
    }
}

@Composable
fun ColumnScope.MenuItem(icon: ImageVector, label: String, tint: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
        Text(label, fontSize = 15.sp, color = c.text, modifier = Modifier.weight(1f))
        Icon(Icons.Default.ChevronRight, null, tint = c.muted, modifier = Modifier.size(16.dp))
    }
    HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 48.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimestampScreen(appState: AppState) {
    val c = traQSColors
    val people by appState.people.collectAsState()
    val jobs by appState.jobs.collectAsState()
    val currentPerson = appState.currentPerson
    val isAdmin = currentPerson?.isAdmin == true
    val scope = rememberCoroutineScope()

    // Main state: home | selectJob | clockedIn | summary
    var kioskState by remember { mutableStateOf("home") }

    // PIN sheet state
    var showPinSheet by remember { mutableStateOf(false) }
    var pinAction by remember { mutableStateOf("") } // "clockIn" | "clockOut"
    var pinInput by remember { mutableStateOf("") }
    var pinError by remember { mutableStateOf("") }
    var pinLoading by remember { mutableStateOf(false) }

    // Identified person state
    var identifiedId by remember { mutableStateOf(0) }
    var identifiedName by remember { mutableStateOf("") }
    var selectedJobIds by remember { mutableStateOf(setOf<String>()) }
    var clockInTime by remember { mutableStateOf("") }
    var workingJobRefs by remember { mutableStateOf<List<JobRef>>(emptyList()) }
    var summaryHours by remember { mutableStateOf(0.0) }
    var elapsedText by remember { mutableStateOf("") }
    var isClockingIn by remember { mutableStateOf(false) }

    // Live elapsed timer
    LaunchedEffect(kioskState, clockInTime) {
        if (kioskState == "clockedIn" && clockInTime.isNotEmpty()) {
            while (true) {
                val utcFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).also { it.timeZone = java.util.TimeZone.getTimeZone("UTC") }
                val start = try { utcFmt.parse(clockInTime)?.time ?: System.currentTimeMillis() } catch (_: Exception) { System.currentTimeMillis() }
                val totalMin = ((System.currentTimeMillis() - start) / 60000).toInt()
                val hrs = totalMin / 60; val mins = totalMin % 60
                elapsedText = if (hrs > 0) "${hrs}h ${mins}m" else "${mins}m"
                delay(30_000)
            }
        }
    }

    fun resetAll() {
        kioskState = "home"; pinInput = ""; pinError = ""; pinAction = ""
        identifiedId = 0; identifiedName = ""; selectedJobIds = setOf()
        clockInTime = ""; workingJobRefs = emptyList(); summaryHours = 0.0; elapsedText = ""
    }

    // Called after 4 digits entered in the PIN sheet
    fun submitPin(digits: String) {
        if (pinLoading) return
        pinLoading = true
        scope.launch {
            try {
                val result = appState.timeclockPost(mapOf("action" to "identify", "pin" to digits))
                val ok = result["ok"] as? Boolean ?: false
                if (!ok) {
                    pinError = "Invalid PIN"
                    pinInput = ""
                    delay(700)
                    pinError = ""
                } else {
                    val pid = (result["personId"] as? Number)?.toInt() ?: 0
                    val pname = result["name"] as? String ?: ""
                    @Suppress("UNCHECKED_CAST")
                    val active = result["activeClockIn"] as? Map<String, Any>

                    if (pinAction == "clockIn") {
                        if (active != null) {
                            pinError = "Already clocked in"
                            pinInput = ""
                            delay(1200)
                            pinError = ""
                        } else {
                            identifiedId = pid; identifiedName = pname
                            showPinSheet = false; pinInput = ""
                            kioskState = "selectJob"
                        }
                    } else { // clockOut
                        if (active == null) {
                            pinError = "Not currently clocked in"
                            pinInput = ""
                            delay(1200)
                            pinError = ""
                        } else {
                            identifiedId = pid; identifiedName = pname
                            // Do the clock out immediately
                            val outResult = appState.timeclockPost(mapOf(
                                "action" to "clockOut",
                                "personId" to pid,
                                "pin" to digits
                            ))
                            val outOk = outResult["ok"] as? Boolean ?: false
                            if (outOk) {
                                @Suppress("UNCHECKED_CAST")
                                val entry = outResult["entry"] as? Map<String, Any>
                                summaryHours = (entry?.get("hours") as? Number)?.toDouble() ?: 0.0
                                showPinSheet = false; pinInput = ""
                                kioskState = "summary"
                                appState.loadTimeclock()
                            } else {
                                pinError = "Clock out failed"
                                pinInput = ""
                                delay(1000)
                                pinError = ""
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                pinError = "Error — try again"
                pinInput = ""
                delay(800)
                pinError = ""
            } finally {
                pinLoading = false
            }
        }
    }

    fun doClockIn() {
        if (isClockingIn) return
        isClockingIn = true
        scope.launch {
            try {
                val refs = selectedJobIds.map { mapOf("jobId" to it, "panelId" to "", "opId" to "") }
                val result = appState.timeclockPost(mapOf(
                    "action" to "clockIn",
                    "personId" to identifiedId,
                    "pin" to pinInput.ifEmpty { "0000" }, // pin already verified; pass stored or dummy
                    "jobRefs" to refs
                ))
                val ok = result["ok"] as? Boolean ?: false
                if (ok) {
                    clockInTime = result["clockIn"] as? String ?: ""
                    workingJobRefs = selectedJobIds.map { JobRef(jobId = it) }
                    kioskState = "clockedIn"
                }
            } catch (_: Exception) {}
            finally { isClockingIn = false }
        }
    }

    val timeclock by appState.timeclock.collectAsState()

    LaunchedEffect(Unit) { appState.loadTimeclock() }

    val clockedInPeople = remember(people) { people.filter { it.activeClockIn != null } }

    val myLogs = remember(timeclock, currentPerson) {
        if (currentPerson == null) return@remember emptyList<ClockEntry>()
        val cutoff = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000
        val utcFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).also { it.timeZone = java.util.TimeZone.getTimeZone("UTC") }
        timeclock.filter { entry ->
            val idMatch = entry.personId.toDoubleOrNull()?.toInt() == currentPerson.id ||
                    entry.personId == currentPerson.id.toString()
            val entryMs = try { utcFmt.parse(entry.clockIn)?.time ?: 0L } catch (_: Exception) { 0L }
            idMatch && entryMs >= cutoff && entry.clockOut.isNotEmpty()
        }.sortedByDescending { it.clockIn }
    }

    // PIN Bottom Sheet
    if (showPinSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPinSheet = false; pinInput = ""; pinError = "" },
            containerColor = c.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp)
                    .navigationBarsPadding(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    if (pinAction == "clockIn") "Enter PIN to Clock In" else "Enter PIN to Clock Out",
                    fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.text
                )

                // Dots
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    repeat(4) { i ->
                        Box(
                            modifier = Modifier.size(16.dp).clip(CircleShape)
                                .background(if (i < pinInput.length) c.accent else c.border)
                        )
                    }
                }

                if (pinError.isNotEmpty()) {
                    Text(pinError, color = c.danger, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }

                if (pinLoading) {
                    CircularProgressIndicator(color = c.accent, modifier = Modifier.size(36.dp))
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(listOf("1","2","3"), listOf("4","5","6"), listOf("7","8","9"), listOf("⌫","0","")).forEach { row ->
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { digit ->
                                    Box(
                                        modifier = Modifier
                                            .weight(1f).aspectRatio(2f)
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(if (digit.isEmpty()) Color.Transparent else c.card)
                                            .then(if (digit.isNotEmpty()) Modifier.clickable {
                                                if (digit == "⌫") {
                                                    if (pinInput.isNotEmpty()) pinInput = pinInput.dropLast(1)
                                                } else if (pinInput.length < 4) {
                                                    pinInput += digit
                                                    if (pinInput.length == 4) submitPin(pinInput)
                                                }
                                            } else Modifier),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        if (digit.isNotEmpty()) Text(digit, fontSize = 22.sp, fontWeight = FontWeight.Medium, color = c.text)
                                    }
                                }
                            }
                        }
                    }
                }

                TextButton(onClick = { showPinSheet = false; pinInput = ""; pinError = "" }) {
                    Text("Cancel", color = c.muted)
                }
            }
        }
    }

    Scaffold(containerColor = c.bg, topBar = { TRAQSHeader() }) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { PageActionBar(title = "Time Stamp", onAskTRAQS = {}) }

            // Main card — changes based on kioskState
            item {
                Card(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = c.card),
                    border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        when (kioskState) {

                            // ── Home: two big buttons ──────────────────────────────
                            "home" -> {
                                Text("Time Stamp", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
                                Button(
                                    onClick = { pinAction = "clockIn"; pinInput = ""; showPinSheet = true },
                                    modifier = Modifier.fillMaxWidth().height(52.dp),
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                                ) {
                                    Icon(Icons.Default.Login, null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text("Clock In", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                }
                                Button(
                                    onClick = { pinAction = "clockOut"; pinInput = ""; showPinSheet = true },
                                    modifier = Modifier.fillMaxWidth().height(52.dp),
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = c.danger)
                                ) {
                                    Icon(Icons.Default.Logout, null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text("Clock Out", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                }
                            }

                            // ── Select Job ────────────────────────────────────────
                            "selectJob" -> {
                                val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
                                val greeting = when { hour < 12 -> "Good morning"; hour < 17 -> "Good afternoon"; else -> "Good evening" }
                                Text("$greeting, $identifiedName!", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
                                Text("Select jobs you're working on:", fontSize = 13.sp, color = c.muted)

                                val myJobs = remember(jobs, identifiedId) {
                                    jobs.filter { it.status.label != "Finished" && identifiedId in it.team }
                                }
                                if (myJobs.isEmpty()) {
                                    Text("No active jobs assigned to you.", fontSize = 13.sp, color = c.muted, textAlign = TextAlign.Center)
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                                        myJobs.forEach { job ->
                                            Row(
                                                modifier = Modifier.fillMaxWidth()
                                                    .clip(RoundedCornerShape(8.dp)).background(c.surface)
                                                    .clickable { selectedJobIds = if (job.id in selectedJobIds) selectedJobIds - job.id else selectedJobIds + job.id }
                                                    .padding(10.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                                            ) {
                                                Checkbox(
                                                    checked = job.id in selectedJobIds,
                                                    onCheckedChange = { selectedJobIds = if (it) selectedJobIds + job.id else selectedJobIds - job.id },
                                                    colors = CheckboxDefaults.colors(checkedColor = c.accent)
                                                )
                                                Column(modifier = Modifier.weight(1f)) {
                                                    Text(job.title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.text)
                                                    if (job.jobNumber != null) Text("#${job.jobNumber}", fontSize = 12.sp, color = c.muted)
                                                }
                                            }
                                        }
                                    }
                                }
                                if (isClockingIn) {
                                    CircularProgressIndicator(color = c.accent, modifier = Modifier.size(28.dp))
                                } else {
                                    Button(
                                        onClick = { doClockIn() },
                                        modifier = Modifier.fillMaxWidth().height(48.dp),
                                        shape = RoundedCornerShape(10.dp),
                                        colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                                    ) { Text("Clock In", fontWeight = FontWeight.Bold, fontSize = 15.sp) }
                                }
                                TextButton(onClick = { resetAll() }) { Text("← Cancel", color = c.muted, fontSize = 13.sp) }
                            }

                            // ── Clocked In ────────────────────────────────────────
                            "clockedIn" -> {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Box(modifier = Modifier.size(10.dp).clip(CircleShape).background(Color(0xFF10B981)))
                                    Text(identifiedName, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
                                }
                                val displayTime = remember(clockInTime) {
                                    try {
                                        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).also { it.timeZone = java.util.TimeZone.getTimeZone("UTC") }
                                        SimpleDateFormat("h:mm a", Locale.US).format(f.parse(clockInTime) ?: Date())
                                    } catch (_: Exception) { clockInTime }
                                }
                                Text("Clocked in at $displayTime", fontSize = 13.sp, color = c.muted)
                                if (elapsedText.isNotEmpty()) Text(elapsedText, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = c.accent)
                                if (workingJobRefs.isNotEmpty()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
                                        Text("Working on:", fontSize = 12.sp, color = c.muted)
                                        workingJobRefs.forEach { ref ->
                                            jobs.firstOrNull { it.id == ref.jobId }?.let { job ->
                                                Row(
                                                    modifier = Modifier.fillMaxWidth()
                                                        .background(c.accent.copy(alpha = 0.12f), RoundedCornerShape(6.dp)).padding(8.dp),
                                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    Icon(Icons.Default.Work, null, tint = c.accent, modifier = Modifier.size(14.dp))
                                                    Text(job.title, fontSize = 13.sp, color = c.accent, fontWeight = FontWeight.Medium)
                                                }
                                            }
                                        }
                                    }
                                }
                                Button(
                                    onClick = { pinAction = "clockOut"; pinInput = ""; showPinSheet = true },
                                    modifier = Modifier.fillMaxWidth().height(48.dp),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = c.danger)
                                ) {
                                    Icon(Icons.Default.Logout, null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Clock Out", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                }
                                TextButton(onClick = { resetAll() }) { Text("← Back", color = c.muted, fontSize = 13.sp) }
                            }

                            // ── Summary ───────────────────────────────────────────
                            "summary" -> {
                                Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF10B981), modifier = Modifier.size(52.dp))
                                Text("$identifiedName clocked out", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
                                Text("%.2f hrs".format(summaryHours), fontSize = 30.sp, fontWeight = FontWeight.Bold, color = c.accent)
                                Button(
                                    onClick = { resetAll() },
                                    modifier = Modifier.fillMaxWidth().height(48.dp),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                                ) { Text("Done", fontWeight = FontWeight.Bold, fontSize = 15.sp) }
                            }
                        }
                    }
                }
            }

            // Admin: Live Team Status
            if (isAdmin && clockedInPeople.isNotEmpty()) {
                item {
                    Card(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = c.card),
                        border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                    ) {
                        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Live Team Status", fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.text)
                            Text("${clockedInPeople.size} currently clocked in", fontSize = 12.sp, color = c.muted)
                            HorizontalDivider(color = c.border)
                            clockedInPeople.forEach { person ->
                                val personColor = try { parseColor(person.color) } catch (_: Exception) { c.accent }
                                val clockInISO = person.activeClockIn?.clockIn ?: ""
                                val inTime = remember(clockInISO) {
                                    try {
                                        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).also { it.timeZone = java.util.TimeZone.getTimeZone("UTC") }
                                        SimpleDateFormat("h:mm a", Locale.US).format(f.parse(clockInISO) ?: Date())
                                    } catch (_: Exception) { "—" }
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Box(
                                        modifier = Modifier.size(36.dp).clip(CircleShape).background(personColor),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(person.name.take(1).uppercase(), fontWeight = FontWeight.Bold, color = Color.White, fontSize = 14.sp)
                                    }
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(person.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = c.text)
                                        Text("In at $inTime", fontSize = 12.sp, color = c.muted)
                                    }
                                    Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(Color(0xFF10B981)))
                                }
                            }
                        }
                    }
                }
            }

            // My Time Log — last 30 days
            if (myLogs.isNotEmpty()) {
                item {
                    Card(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = c.card),
                        border = androidx.compose.foundation.BorderStroke(1.dp, c.border)
                    ) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(0.dp)
                        ) {
                            Text(
                                "My Time Log — Last 30 Days",
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                                color = c.text,
                                modifier = Modifier.padding(bottom = 12.dp)
                            )

                            // Group by date string (YYYY-MM-DD)
                            val grouped = myLogs.groupBy { it.date.ifEmpty {
                                it.clockIn.take(10)
                            }}
                            val sortedDates = grouped.keys.sortedDescending()
                            val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
                            val displayFmt = SimpleDateFormat("EEE, MMM d", Locale.US)
                            val timeFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).also { it.timeZone = java.util.TimeZone.getTimeZone("UTC") }
                            val localTimeFmt = SimpleDateFormat("h:mm a", Locale.US)

                            sortedDates.forEachIndexed { dateIdx, dateKey ->
                                val entries = grouped[dateKey] ?: return@forEachIndexed
                                val displayDate = try { displayFmt.format(dateFmt.parse(dateKey) ?: Date()) } catch (_: Exception) { dateKey }
                                val dayTotal = entries.sumOf { it.hours }

                                // Date header row
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = if (dateIdx > 0) 12.dp else 0.dp, bottom = 6.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(displayDate, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = c.text)
                                    Text("%.1f hrs".format(dayTotal), fontSize = 12.sp, color = c.accent, fontWeight = FontWeight.Medium)
                                }

                                entries.forEach { entry ->
                                    val inDisplay = try { localTimeFmt.format(timeFmt.parse(entry.clockIn) ?: Date()) } catch (_: Exception) { entry.clockIn.takeLast(8) }
                                    val outDisplay = try { localTimeFmt.format(timeFmt.parse(entry.clockOut) ?: Date()) } catch (_: Exception) { entry.clockOut.takeLast(8) }
                                    val entryJobs = entry.jobRefs.mapNotNull { ref -> jobs.firstOrNull { it.id == ref.jobId }?.title }.distinct()

                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(bottom = 6.dp)
                                            .background(c.surface, RoundedCornerShape(8.dp))
                                            .padding(horizontal = 10.dp, vertical = 8.dp),
                                        verticalArrangement = Arrangement.spacedBy(3.dp)
                                    ) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Row(
                                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Icon(Icons.Default.AccessTime, null, tint = c.muted, modifier = Modifier.size(12.dp))
                                                Text("$inDisplay → $outDisplay", fontSize = 12.sp, color = c.muted)
                                            }
                                            Text("%.2f hrs".format(entry.hours), fontSize = 12.sp, color = c.text, fontWeight = FontWeight.Medium)
                                        }
                                        if (entryJobs.isNotEmpty()) {
                                            Text(entryJobs.joinToString(", "), fontSize = 11.sp, color = c.accent)
                                        }
                                    }
                                }

                                if (dateIdx < sortedDates.lastIndex) {
                                    HorizontalDivider(color = c.border.copy(alpha = 0.5f))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
