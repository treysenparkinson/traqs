package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.ActiveClockIn
import com.matrixsystems.traqs.models.ActiveJobClock
import com.matrixsystems.traqs.models.ClockEvent
import com.matrixsystems.traqs.models.OrgSettings
import com.matrixsystems.traqs.models.TRAQSJob
import com.matrixsystems.traqs.models.TimeclockEntry
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.BreakReminderScheduler
import com.matrixsystems.traqs.services.parseFlexibleISO
import com.matrixsystems.traqs.ui.theme.GradientRing
import com.matrixsystems.traqs.ui.theme.TCard
import com.matrixsystems.traqs.ui.theme.TInset
import com.matrixsystems.traqs.ui.theme.frostedCard
import com.matrixsystems.traqs.ui.theme.TRadius
import com.matrixsystems.traqs.ui.theme.TTypo
import com.matrixsystems.traqs.ui.theme.tabPillBottomInset
import com.matrixsystems.traqs.ui.theme.TTrack
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.max
import kotlin.math.min

// Hours dashboard — personal view of pay-period hours, daily bars, active job
// timer, and recent entries. Mirrors iOS TimeClockView.
//
// Carries BOTH clocks: the per-job timer (started from the Jobs screen) and the
// payroll clock-in/out with its lunch toggle, the latter shown only when an
// admin has enabled it for the org. They measure different things — see the Pay
// Clock section of AppState.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeClockScreen(
    appState: AppState,
    onAskTRAQS: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()
    val orgSettings by appState.orgSettings.collectAsState()
    val currentPersonId = appState.currentPersonId
    // Derive the live clock fields from `people` so Compose recomposes when they
    // change — both the job clock and the pay shift hang off the same record.
    val me = people.firstOrNull { it.id == currentPersonId }
    val activeJobClock = me?.activeJobClock
    val activeClockIn = me?.activeClockIn
    val timeclockEntries by appState.timeclockEntries.collectAsState()
    val isPayClocking by appState.isPayClocking.collectAsState()
    val clockError by appState.clockError.collectAsState()

    // Keyed on the two inputs the getter reads, so the one definition in
    // AppState stays authoritative and recomposition still tracks it.
    val showPayClock = remember(orgSettings, me) { appState.showPayClock }

    // The pay-hours history is not part of loadAll() — it is a separate, larger
    // file that views pull when they need it. Without this the pay-period total
    // shows only the live shift until the worker's first punch of the session.
    LaunchedEffect(currentPersonId) { appState.refreshTimeclock(currentPersonId) }

    // 1-second ticker so the running timer + live hours update.
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }

    var isStopping by remember { mutableStateOf(false) }
    // Reset the "STOPPING…" indicator the moment the optimistic clear fires.
    LaunchedEffect(activeJobClock) {
        if (activeJobClock == null && isStopping) isStopping = false
    }

    val liveRunningHours = remember(activeJobClock, now) {
        computeLiveRunningHours(activeJobClock, now)
    }
    val weekHours = remember(jobs, currentPersonId, liveRunningHours) {
        computeWeekHours(jobs, currentPersonId, liveRunningHours)
    }
    val weeklyTarget = remember(orgSettings) {
        val t = orgSettings.hpd * max(1, orgSettings.workDays.size)
        if (t > 0) t else 40.0
    }
    val onPace = weekHours <= weeklyTarget

    val dailyBars = remember(now, liveRunningHours) { buildDailyBars(now, liveRunningHours) }
    val groups = remember(activeJobClock, jobs) { buildEntryGroups(activeJobClock, jobs) }

    // ── Pay-clock figures ────────────────────────────────────────────────────
    // Live hours on the OPEN shift, net of lunch, matching what the server will
    // write when the punch closes (hoursElapsedMinusPauses). Breaks are paid and
    // deliberately not deducted.
    val liveShiftHours = remember(activeClockIn, now) { appState.liveShiftHours(now) }
    // Keyed on the day rather than the 1s tick: the pay-period window only moves
    // at midnight, so refolding every completed punch each second to rediscover
    // that is work for nothing. Only the live shift needs per-second precision.
    val dayKey = now / 86_400_000L
    val completedPayHours = remember(timeclockEntries, currentPersonId, dayKey, orgSettings) {
        computeCompletedPayHours(timeclockEntries, currentPersonId, now, orgSettings)
    }
    val payPeriodHours = completedPayHours + liveShiftHours
    val periodTarget = remember(orgSettings) {
        if (orgSettings.payPeriodHourCap > 0) orgSettings.payPeriodHourCap else 80.0
    }
    val todayHours = remember(timeclockEntries, activeClockIn, now) { appState.hoursToday(now) }
    // Daily target = PAID hours in a standard day, not `hpd` — see
    // OrgSettings.paidHoursPerDay for why those are different numbers.
    val dailyTarget = remember(orgSettings) {
        orgSettings.paidHoursPerDay.takeIf { it > 0 } ?: 8.0
    }
    // Wall-clock elapsed on the open shift, for the CTA's live readout.
    val payElapsedLabel = remember(activeClockIn, now) {
        val start = activeClockIn?.clockIn?.let { parseFlexibleISO(it) }
        if (start == null) "0:00" else {
            val secs = max(0, ((now - start) / 1000).toInt())
            if (secs >= 3600) "%d:%02d:%02d".format(secs / 3600, (secs % 3600) / 60, secs % 60)
            else "%d:%02d".format(secs / 60, secs % 60)
        }
    }

    // PIN gate. `hasPin` is the flag the server sends in place of the stripped
    // `pin`, so it is the only field that answers this for a non-admin.
    val needsPin = me?.hasPin == true
    var pinFor by remember { mutableStateOf<String?>(null) }   // "in" | "out"
    var pinText by remember { mutableStateOf("") }
    var showClockOutConfirm by remember { mutableStateOf(false) }

    // Break rides its own in-flight flag, NOT isPayClocking: it goes through
    // startBreak/endBreak (presence only — the pay clock keeps running), and
    // sharing the pay flag would dim Lunch and Clock Out while a break request
    // was in the air.
    val ctx = LocalContext.current
    val isOnBreak = me?.activeBreak != null
    var breakBusy by remember { mutableStateOf(false) }
    LaunchedEffect(isOnBreak) { breakBusy = false }

    Scaffold(
        containerColor = Color.Transparent,
        topBar = {
            TRAQSHeader {
                TRAQSIconBtn(icon = TIcons.Gear, contentDescription = "Settings", onClick = onOpenSettings)
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(top = 8.dp, bottom = tabPillBottomInset),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { PageTitle("Time Clock") }

            // Two rings side by side: the whole pay period on the left, today on
            // the right. Both are time clocked in FOR PAY, minus lunch. Each is
            // its own card so the two numbers read as peers rather than one
            // being a footnote to the other. Mirrors iOS RingStatCard.
            //
            // With the pay clock disabled the org has no pay hours to report, so
            // the rings fall back to job time against the weekly target — the
            // number this page showed before the pay clock existed.
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    RingStatCard(
                        title = if (showPayClock) "Pay period" else "This week",
                        hours = if (showPayClock) payPeriodHours else weekHours,
                        target = if (showPayClock) periodTarget else weeklyTarget,
                        modifier = Modifier.weight(1f),
                    )
                    RingStatCard(
                        title = "Today",
                        hours = if (showPayClock) todayHours else liveRunningHours,
                        target = dailyTarget,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            item { DailyBarsCard(days = dailyBars) }

            // Sits below the bar graph so the hero number reads first, matching iOS.
            if (showPayClock) {
                item {
                    PayClockControls(
                        active = activeClockIn != null,
                        onLunch = activeClockIn?.onLunch == true,
                        elapsed = payElapsedLabel,
                        inFlight = isPayClocking,
                        clockOutBlocked = appState.clockOutBlockedByJob,
                        onClockIn = {
                            if (!isPayClocking) {
                                if (needsPin) { pinText = ""; pinFor = "in" }
                                else appState.payClockIn()
                            }
                        },
                        onClockOut = {
                            if (!isPayClocking) {
                                // Clock Out is the widest target on the page and the
                                // easiest to hit by accident — gate it behind the PIN,
                                // or at minimum a confirm.
                                if (needsPin) { pinText = ""; pinFor = "out" }
                                else showClockOutConfirm = true
                            }
                        },
                        onLunchToggle = { appState.payLunchToggle() },
                        onBreak = isOnBreak,
                        breakInFlight = breakBusy,
                        onBreakToggle = {
                            if (!breakBusy) {
                                breakBusy = true
                                if (isOnBreak) appState.endBreak(onCancelReminder = { BreakReminderScheduler.cancel(ctx) })
                                else appState.startBreak(onScheduleReminder = { m -> BreakReminderScheduler.schedule(ctx, m) })
                            }
                        },
                    )
                }
            }

            if (activeJobClock != null) {
                item { SectionTitle("Running") }
                item {
                    RunningEntryCard(
                        jobClock = activeJobClock,
                        now = now,
                        isStopping = isStopping,
                        onStop = {
                            if (!isStopping) {
                                isStopping = true
                                appState.jobClockOut()
                            }
                        }
                    )
                }
            }

            item { SectionTitle("Recent entries") }

            if (groups.isEmpty()) {
                item { HoursEmptyState() }
            } else {
                items(groups) { group -> EntryGroupCard(group) }
            }
        }
    }

    // PIN gate for clock in/out. The server verifies the PIN, so a wrong one
    // comes back 401 and lands in clockError; the dialog stays open on failure
    // rather than dismissing and losing the attempt.
    // The app's own pad, not a Material dialog with a text field — see
    // ClockPinPad. It owns the whole action: keypad → spinner → tick, all in the
    // one panel, and it closes itself only once that has played. A wrong PIN
    // springs it back to entry with an error rather than dismissing and losing
    // the attempt.
    pinFor?.let { direction ->
        val clockingIn = direction == "in"
        ClockPinPad(
            title = if (clockingIn) "Clock In" else "Clock Out",
            onClose = { pinFor = null; pinText = "" },
            onSubmit = { entered, done ->
                if (clockingIn) appState.payClockIn(entered, done)
                else appState.payClockOut(entered, done)
            }
        )
    }

    // No PIN set — a plain confirm is all that stands between a stray tap and
    // the end of someone's shift.
    if (showClockOutConfirm) {
        AlertDialog(
            onDismissRequest = { showClockOutConfirm = false },
            title = { Text("Clock out?", color = c.text) },
            text = { Text("This ends your paid shift for the day.", color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    showClockOutConfirm = false
                    appState.payClockOut()
                }) { Text("Clock Out", color = c.accent) }
            },
            dismissButton = {
                TextButton(onClick = { showClockOutConfirm = false }) { Text("Cancel", color = c.muted) }
            },
            containerColor = c.card
        )
    }

    clockError?.let { message ->
        AlertDialog(
            onDismissRequest = { appState.clearClockError() },
            title = { Text("Clock", color = c.text) },
            text = { Text(message, color = c.muted) },
            confirmButton = {
                TextButton(onClick = { appState.clearClockError() }) { Text("OK", color = c.accent) }
            },
            containerColor = c.card
        )
    }
}

// MARK: - Compute helpers

private fun computeLiveRunningHours(jc: ActiveJobClock?, now: Long): Double {
    if (jc == null) return 0.0
    val start = parseFlexibleISO(jc.clockIn) ?: return 0.0
    var ms = (now - start).toDouble()
    ms -= jc.totalPausedMs ?: 0.0
    val pausedAt = jc.pausedAt
    if (!pausedAt.isNullOrEmpty()) {
        val pStart = parseFlexibleISO(pausedAt)
        if (pStart != null) ms -= (now - pStart).toDouble()
    }
    return max(0.0, ms / 1000 / 3600)
}

// Weekly hours = sum of loggedHours on jobs the current user is on + live running.
private fun computeWeekHours(
    jobs: List<TRAQSJob>,
    currentPersonId: Int?,
    liveRunningHours: Double
): Double {
    val totalLogged = jobs.fold(0.0) { acc, job ->
        val onJob = if (currentPersonId != null) {
            job.team.contains(currentPersonId) || job.subs.any { panel ->
                panel.team.contains(currentPersonId) ||
                    panel.subs.any { op -> op.team.contains(currentPersonId) }
            }
        } else true
        if (onJob) acc + (job.loggedHours ?: 0.0) else acc
    }
    return totalLogged + liveRunningHours
}

// Completed pay punches for this person inside the current pay period. Rows
// carrying an eventType are lunch/break markers, not spans, and are skipped;
// `hours` on a real span is already net of lunch, computed server-side.
private fun computeCompletedPayHours(
    entries: List<TimeclockEntry>,
    currentPersonId: Int?,
    now: Long,
    settings: OrgSettings,
): Double {
    val (start, end) = computePeriodWindow(now, settings)
    // The window's end is a day stamp; count the whole of that final day.
    val endExclusive = Calendar.getInstance().apply {
        time = end; add(Calendar.DAY_OF_YEAR, 1)
    }.timeInMillis
    return entries.fold(0.0) { acc, e ->
        if (e.eventType != null || e.clockIn == null || e.clockOut == null) return@fold acc
        if (currentPersonId != null && !sameId(e.personId, currentPersonId)) return@fold acc
        val t = parseFlexibleISO(e.clockIn) ?: return@fold acc
        if (t < start.time || t >= endExclusive) acc else acc + (e.hours ?: 0.0)
    }
}

// Person ids are mixed string/number across the web, iOS and these JSON files —
// a row written by the kiosk can carry "12" where this app holds 12, and a
// string compare silently drops every one of that worker's punches. Compare the
// numbers when both sides parse, and fall back to text when they do not.
private fun sameId(a: String?, b: Int): Boolean {
    if (a == null) return false
    return a.trim().toDoubleOrNull()?.toInt()?.equals(b) ?: (a == b.toString())
}

data class DailyBar(val date: Date, val dow: String, val hours: Double, val isToday: Boolean)

private fun buildDailyBars(nowMs: Long, liveRunningHours: Double): List<DailyBar> {
    val cal = Calendar.getInstance()
    cal.timeInMillis = nowMs
    cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
    val today = cal.timeInMillis
    val dowChars = listOf("S", "M", "T", "W", "T", "F", "S")
    val out = mutableListOf<DailyBar>()
    for (i in 7 downTo 0) {
        val c2 = Calendar.getInstance().apply { timeInMillis = today; add(Calendar.DAY_OF_YEAR, -i) }
        val dow = dowChars[c2.get(Calendar.DAY_OF_WEEK) - 1]
        val h = if (i == 0) liveRunningHours else 0.0
        out.add(DailyBar(date = c2.time, dow = dow, hours = h, isToday = i == 0))
    }
    return out
}

data class TimeEntryRow(
    val id: String,
    val start: Date,
    val end: Date?,
    val jobTitle: String,
    val running: Boolean,
)

data class EntryGroupUI(val id: String, val label: String, val entries: List<TimeEntryRow>)

private fun buildEntryGroups(jc: ActiveJobClock?, jobs: List<TRAQSJob>): List<EntryGroupUI> {
    if (jc == null) return emptyList()
    val startMs = parseFlexibleISO(jc.clockIn) ?: return emptyList()
    val start = Date(startMs)
    val cal = Calendar.getInstance().apply {
        timeInMillis = startMs
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val dayKey = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)
    val label = SimpleDateFormat("EEE · MMM d", Locale.US).format(start)
    val job = jobs.firstOrNull { it.id == jc.jobId }
    val title = jc.jobTitle ?: job?.title ?: "Job"
    val entry = TimeEntryRow(id = jc.jobId, start = start, end = null, jobTitle = title, running = true)
    return listOf(EntryGroupUI(dayKey, label, listOf(entry)))
}

// MARK: - Components

@Composable
private fun SectionTitle(title: String) {
    val c = traQSColors
    Text(
        title.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        color = c.muted,
        letterSpacing = TTrack.section,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp)
    )
}

// Pay clock controls.
//
// Clocked out → one primary Clock In button. Clocked in → Lunch as a secondary
// (card fill, accent ring, accent text) with a full-width Clock Out beneath it.
// Lunch is a mid-shift adjustment rather than a decision, so it does not compete
// with Clock Out for the primary slot.
//
// Lunch and Break as one capsule, differing only in their label. Secondary by
// design — card fill, accent ring, accent text — because these are mid-shift
// adjustments, not decisions. Clock Out is the only primary in the group.
@Composable
private fun PayPill(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    busy: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(50.dp),
        shape = RoundedCornerShape(TRadius.lg),
        border = BorderStroke(1.dp, c.accent.copy(alpha = 0.45f)),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = c.card, contentColor = c.accent
        ),
        contentPadding = PaddingValues(horizontal = 8.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(color = c.accent, strokeWidth = 2.dp, modifier = Modifier.size(15.dp))
        } else {
            Icon(icon, contentDescription = null, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.width(6.dp))
        Text(
            label,
            fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
            maxLines = 1,
        )
    }
}

// Lunch and Break sit side by side because they are different things: LUNCH
// stops paid time (and pauses the job clock with it), BREAK is presence-only and
// the pay clock keeps running. One "pause" toggle would hide that difference.
@Composable
private fun PayClockControls(
    active: Boolean,
    onLunch: Boolean,
    elapsed: String,
    inFlight: Boolean,
    clockOutBlocked: Boolean,
    onClockIn: () -> Unit,
    onClockOut: () -> Unit,
    onLunchToggle: () -> Unit,
    onBreak: Boolean = false,
    breakInFlight: Boolean = false,
    onBreakToggle: () -> Unit = {},
) {
    val c = traQSColors
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (active) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PayPill(
                    icon = if (onLunch) TIcons.Play else TIcons.Utensils,
                    label = if (onLunch) "END LUNCH" else "LUNCH",
                    busy = false,
                    enabled = !inFlight,
                    onClick = onLunchToggle,
                    modifier = Modifier.weight(1f),
                )
                PayPill(
                    icon = if (onBreak) TIcons.Play else TIcons.Coffee,
                    label = if (onBreak) "END BREAK" else "BREAK",
                    busy = breakInFlight,
                    enabled = !breakInFlight,
                    onClick = onBreakToggle,
                    modifier = Modifier.weight(1f),
                )
            }

            // On lunch the paid clock is stopped and so is any running job —
            // say so, because the two timers elsewhere on this screen freeze and
            // that reads as a stuck screen otherwise.
            if (onLunch) {
                Text(
                    "On lunch — paid time and your job timer are paused",
                    fontSize = 11.sp,
                    color = c.muted,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            }

            Button(
                onClick = onClockOut,
                enabled = !inFlight && !clockOutBlocked,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(TRadius.lg),
                colors = ButtonDefaults.buttonColors(
                    containerColor = c.accent,
                    contentColor = Color.White,
                    disabledContainerColor = c.accent.copy(alpha = 0.4f),
                    disabledContentColor = Color.White.copy(alpha = 0.7f)
                )
            ) {
                if (inFlight) {
                    CircularProgressIndicator(
                        color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(16.dp)
                    )
                } else {
                    Icon(TIcons.Square, contentDescription = null, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    "CLOCK OUT · $elapsed",
                    fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp
                )
            }

            if (clockOutBlocked) {
                Text(
                    "Stop your job before clocking out",
                    fontSize = 11.sp,
                    color = c.muted,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            }
        } else {
            Button(
                onClick = onClockIn,
                enabled = !inFlight,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(TRadius.lg),
                colors = ButtonDefaults.buttonColors(
                    containerColor = c.accent,
                    contentColor = Color.White,
                    disabledContainerColor = c.accent.copy(alpha = 0.4f),
                    disabledContentColor = Color.White.copy(alpha = 0.7f)
                )
            ) {
                if (inFlight) {
                    CircularProgressIndicator(
                        color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(16.dp)
                    )
                } else {
                    Icon(TIcons.Play, contentDescription = null, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.width(8.dp))
                Text("CLOCK IN", fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp)
            }
        }
    }
}

// One hours figure as a ring: the number in the middle, its target under it, and
// the brand gradient swept round to show the ratio. Mirrors iOS RingStatCard.
//
// The ring caps at 100% by design — past the target the number keeps climbing but
// the arc stays full, because a ring that wraps past twelve o'clock reads as
// starting over rather than as overtime.
@Composable
private fun RingStatCard(
    title: String,
    hours: Double,
    target: Double,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    val pct = if (target > 0) min(100.0, hours / target * 100.0) else 0.0
    Column(
        modifier = modifier
            .frostedCard()
            .padding(horizontal = TInset.hero, vertical = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            title.uppercase(),
            fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = TTrack.section,
            color = c.muted, maxLines = 1,
        )
        Box(contentAlignment = Alignment.Center) {
            GradientRing(pct = pct, lineWidth = 11.dp, modifier = Modifier.size(106.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "%.1f".format(hours),
                    fontSize = 28.sp, fontWeight = FontWeight.Bold, color = c.text,
                )
                Text(
                    "/ %.0f h".format(target),
                    fontSize = 11.sp, color = c.muted,
                )
            }
        }
    }
}

// Pay period window — mirrors iOS HeroPayPeriodCard.periodWindow.
private fun computePeriodWindow(nowMs: Long, settings: OrgSettings): Pair<Date, Date> {
    val cal = Calendar.getInstance().apply {
        timeInMillis = nowMs
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val today = cal.time
    val anchor = settings.payPeriodStart?.let { parseFlexibleISO(it) }?.let { Date(it) } ?: today

    return when (settings.payPeriodType) {
        "weekly" -> {
            val weekday = cal.get(Calendar.DAY_OF_WEEK)  // Sun=1..Sat=7
            val toMonday = if (weekday == Calendar.SUNDAY) -6 else -(weekday - 2)
            val start = Calendar.getInstance().apply { time = today; add(Calendar.DAY_OF_YEAR, toMonday) }
            val end = Calendar.getInstance().apply { time = start.time; add(Calendar.DAY_OF_YEAR, 6) }
            start.time to end.time
        }
        "semimonthly" -> {
            val day = cal.get(Calendar.DAY_OF_MONTH)
            val monthStart = Calendar.getInstance().apply {
                time = today; set(Calendar.DAY_OF_MONTH, 1)
            }
            if (day <= 15) {
                val end = Calendar.getInstance().apply { time = monthStart.time; add(Calendar.DAY_OF_YEAR, 14) }
                monthStart.time to end.time
            } else {
                val start = Calendar.getInstance().apply { time = monthStart.time; add(Calendar.DAY_OF_YEAR, 15) }
                val nextMonth = Calendar.getInstance().apply { time = monthStart.time; add(Calendar.MONTH, 1) }
                val end = Calendar.getInstance().apply { time = nextMonth.time; add(Calendar.DAY_OF_YEAR, -1) }
                start.time to end.time
            }
        }
        else -> { // biweekly
            val daysBetween = ((today.time - anchor.time) / (24L * 60 * 60 * 1000)).toInt()
            val cycles = daysBetween / 14
            val start = Calendar.getInstance().apply { time = anchor; add(Calendar.DAY_OF_YEAR, cycles * 14) }
            val end = Calendar.getInstance().apply { time = start.time; add(Calendar.DAY_OF_YEAR, 13) }
            start.time to end.time
        }
    }
}

@Composable
private fun DailyBarsCard(days: List<DailyBar>) {
    val c = traQSColors
    val maxValue = 9.0
    TCard(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        radius = TRadius.hero,
    ) {
        Column(
            // The hero inset, not 14: on a 42dp corner the shape's edge is still
            // ~9dp inboard at the first line of text, so a tight pad leaves the
            // title and the bar ends riding the curve.
            modifier = Modifier.fillMaxWidth().padding(TInset.hero),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Sentence case at 17, NOT an uppercase tracked label — iOS
                // WeekBarsCard titles itself the way a card does, and the
                // uppercase treatment is reserved for section headers that sit
                // OUTSIDE a card.
                Text("This week", style = TTypo.h3(17.sp), color = c.text)
                Spacer(Modifier.weight(1f))
                Text("last 8 days", style = TTypo.xs(11.sp), color = c.muted)
            }
            Row(
                modifier = Modifier.fillMaxWidth().height(112.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                days.forEach { d ->
                    Column(
                        modifier = Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(88.dp),
                            contentAlignment = Alignment.BottomCenter
                        ) {
                            val barHeight = max(2.0, min(1.0, d.hours / maxValue) * 88).dp
                            val barColor = when {
                                d.isToday -> c.accent
                                d.hours == 0.0 -> c.border
                                else -> c.text
                            }
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(0.7f)
                                    .height(barHeight)
                                    .clip(RoundedCornerShape(TRadius.xs))
                                    .background(barColor)
                            )
                        }
                        Text(
                            d.dow,
                            fontSize = 11.sp,
                            color = if (d.isToday) c.text else c.muted,
                            fontWeight = if (d.isToday) FontWeight.Bold else FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RunningEntryCard(
    jobClock: ActiveJobClock,
    now: Long,
    isStopping: Boolean,
    onStop: () -> Unit,
) {
    val c = traQSColors
    val elapsedLabel = remember(jobClock, now) {
        val start = parseFlexibleISO(jobClock.clockIn) ?: return@remember "—"
        var ms = (now - start).toDouble()
        ms -= jobClock.totalPausedMs ?: 0.0
        jobClock.pausedAt?.let { p ->
            parseFlexibleISO(p)?.let { ms -= (now - it).toDouble() }
        }
        val secs = max(0, (ms / 1000).toInt())
        "%d:%02d:%02d".format(secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(TRadius.sm),
        colors = CardDefaults.cardColors(containerColor = c.accent.copy(alpha = 0.08f)),
        border = BorderStroke(1.dp, c.accent.copy(alpha = 0.45f))
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(modifier = Modifier.size(10.dp).clip(CircleShape).background(c.accent))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    jobClock.jobTitle ?: "Job",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.text,
                    maxLines = 1
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // A job clock paused by lunch keeps its elapsed frozen, so a
                    // badge still reading RUNNING next to a stopped timer looks
                    // like a bug. Say which state it is actually in.
                    val paused = jobClock.isPaused
                    Text(
                        if (paused) "PAUSED" else "RUNNING",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (paused) c.amber else c.accent,
                        modifier = Modifier
                            .background(
                                (if (paused) c.amber else c.accent).copy(alpha = 0.12f),
                                RoundedCornerShape(TRadius.xs)
                            )
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                    Text(
                        elapsedLabel,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = c.text
                    )
                }
            }
            Button(
                onClick = onStop,
                enabled = !isStopping,
                shape = RoundedCornerShape(TRadius.md),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 7.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = Color.White)
            ) {
                if (isStopping) {
                    CircularProgressIndicator(
                        color = Color.White,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("STOPPING…", fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                } else {
                    Icon(TIcons.Square, null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("STOP", fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
                }
            }
        }
    }
}

@Composable
private fun EntryGroupCard(group: EntryGroupUI) {
    val c = traQSColors
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(
            group.label.uppercase(),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = c.muted,
            letterSpacing = TTrack.section
        )
        TCard(
            modifier = Modifier.fillMaxWidth(),
            radius = TRadius.hero,
        ) {
            Column {
                group.entries.forEachIndexed { i, entry ->
                    EntryRow(entry)
                    if (i < group.entries.lastIndex) {
                        HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 22.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun EntryRow(entry: TimeEntryRow) {
    val c = traQSColors
    val tf = SimpleDateFormat("HH:mm", Locale.US)
    val range = "${tf.format(entry.start)} – ${entry.end?.let { tf.format(it) } ?: "live"}"
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Box(
            modifier = Modifier
                .width(4.dp)
                .height(28.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(c.accent)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(range, fontSize = 11.sp, color = c.text)
            Text(entry.jobTitle, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text, maxLines = 1)
        }
        if (entry.running) {
            Text(
                "● LIVE",
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                color = c.accent,
                modifier = Modifier
                    .background(c.accent.copy(alpha = 0.10f), RoundedCornerShape(TRadius.xs))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
    }
}

@Composable
private fun HoursEmptyState() {
    val c = traQSColors
    TCard(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        radius = TRadius.md,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("No recent entries", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.muted)
            Text(
                "Log time against a job to start tracking.",
                fontSize = 11.sp,
                color = c.muted
            )
        }
    }
}
