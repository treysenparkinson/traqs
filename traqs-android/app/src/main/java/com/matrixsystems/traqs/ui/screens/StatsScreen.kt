package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.JobStatus
import com.matrixsystems.traqs.models.TRAQSJob
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.TCard
import com.matrixsystems.traqs.ui.theme.TRadius
import com.matrixsystems.traqs.ui.theme.tabPillBottomInset
import com.matrixsystems.traqs.ui.theme.TTrack
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlin.math.max
import kotlin.math.min

// Stats KPI dashboard — mirrors iOS MoreView. Admin-only; non-admins see a friendly empty state.

enum class StatsPeriod(val label: String) {
    THIS_WEEK("This week"),
    LAST_30_DAYS("Last 30 days"),
    ALL_TIME("All time");

    fun next(): StatsPeriod = when (this) {
        THIS_WEEK -> LAST_30_DAYS
        LAST_30_DAYS -> ALL_TIME
        ALL_TIME -> THIS_WEEK
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    appState: AppState,
    // Analytics doubles as the app's "more" surface, the way iOS MoreView does:
    // Schedule, Admin and Settings were rows on the side drawer this tab bar
    // replaced, and they need somewhere to live that is one tap from anywhere.
    onOpenAdmin: () -> Unit = {},
    onOpenTeam: () -> Unit = {},
    onOpenClients: () -> Unit = {},
    onOpenAnalytics: () -> Unit = {},
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()
    val orgSettings by appState.orgSettings.collectAsState()
    val isAdmin = appState.currentPerson?.isAdmin == true
    val currentPersonId = appState.currentPersonId
    var period by remember { mutableStateOf(StatsPeriod.THIS_WEEK) }

    // Whose numbers these are. null = the whole org.
    //
    // Everyone can see their OWN stats — this page used to be admin-only, which
    // left a worker with no way to see how their week was going. An admin gets
    // the picker and starts on Everyone, because the org view is what they open
    // this page for; a non-admin is pinned to themselves and never sees it.
    var scopeId by remember(isAdmin, currentPersonId) {
        mutableStateOf(if (isAdmin) null else currentPersonId)
    }
    var scopeMenuOpen by remember { mutableStateOf(false) }

    val scopedJobs = remember(jobs, scopeId) {
        val id = scopeId ?: return@remember jobs
        jobs.filter { job -> personOnJob(job, id) }
    }
    val scopeLabel = when (val id = scopeId) {
        null -> "Everyone"
        currentPersonId -> "You"
        else -> people.firstOrNull { it.id == id }?.name ?: "—"
    }

    Scaffold(
        containerColor = Color.Transparent,
        topBar = {
            TRAQSHeader {
                // iOS Stats period chip: PillBtn(compact) — capsule surface, hair stroke, raised shadow.
                Surface(
                    onClick = { period = period.next() },
                    shape = RoundedCornerShape(TRadius.md),
                    // Near-solid, not the card tint: a button has to read as an opaque
                    // object ON the glass, not as more glass. Matches TRAQSIconBtn.
                    color = c.surface.copy(alpha = 0.90f),
                    border = BorderStroke(1.dp, c.controlHairline),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(period.label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.text, letterSpacing = 0.6.sp)
                        Icon(TIcons.ChevronDown, null, tint = c.muted, modifier = Modifier.size(11.dp))
                    }
                }
                if (isAdmin) {
                    TRAQSIconBtn(
                        icon = TIcons.Shield,
                        contentDescription = "Admin",
                        onClick = onOpenAdmin
                    )
                }
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = tabPillBottomInset),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { PageTitle("Analytics", subtitle = scopeLabel) }

            // The scope picker, admins only. A non-admin has exactly one scope,
            // so a control that cannot change anything would just be furniture.
            if (isAdmin) {
                item {
                    Box(modifier = Modifier.padding(start = 16.dp, bottom = 4.dp)) {
                        TCard(radius = TRadius.md, rim = false, onClick = { scopeMenuOpen = true }) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(scopeLabel, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text)
                                Icon(TIcons.ChevronDown, null, tint = c.muted, modifier = Modifier.size(12.dp))
                            }
                        }
                        DropdownMenu(
                            expanded = scopeMenuOpen,
                            onDismissRequest = { scopeMenuOpen = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Everyone") },
                                onClick = { scopeId = null; scopeMenuOpen = false }
                            )
                            people.sortedBy { it.name }.forEach { p ->
                                DropdownMenuItem(
                                    text = { Text(if (p.id == currentPersonId) "${p.name} (you)" else p.name) },
                                    onClick = { scopeId = p.id; scopeMenuOpen = false }
                                )
                            }
                        }
                    }
                }
            }

            item {
                KpiGrid(
                    jobs = scopedJobs,
                    // One person's capacity when scoped to a person, the org's
                    // otherwise — utilisation against the whole org's hours is
                    // meaningless for a single worker.
                    peopleCount = if (scopeId == null) people.count { !it.isAdmin } else 1,
                    hpd = orgSettings.hpd,
                    workDays = orgSettings.workDays.size,
                )
            }
            item { SectionTitle("Hours billed", action = "14 DAYS") }
            item { HeroTrendCard(jobs = scopedJobs) }
            item { SectionTitle("Job mix", action = null) }
            item { JobMixCard(jobs = scopedJobs) }

            // The "more" surface, the way iOS MoreView is. These screens were
            // rows on the side drawer the tab bar replaced; without a home here
            // they are built, routed and unreachable.
            item { SectionTitle("More", action = null) }
            item {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    MoreRow(TIcons.Team, "Team", onOpenTeam)
                    MoreRow(TIcons.Briefcase, "Clients", onOpenClients)
                    MoreRow(TIcons.Analytics, "Detailed analytics", onOpenAnalytics)
                    if (isAdmin) MoreRow(TIcons.Shield, "Admin", onOpenAdmin)
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String, action: String?) {
    val c = traQSColors
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.muted, letterSpacing = TTrack.section)
        Spacer(Modifier.weight(1f))
        if (action != null) {
            Text(action, fontSize = 11.sp, color = c.muted)
        }
    }
}

@Composable
private fun MoreRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    val c = traQSColors
    TCard(modifier = Modifier.fillMaxWidth(), radius = TRadius.lg, rim = false, onClick = onClick) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(icon, null, tint = c.accent, modifier = Modifier.size(17.dp))
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text, modifier = Modifier.weight(1f))
            Icon(TIcons.ChevronRight, null, tint = c.muted, modifier = Modifier.size(14.dp))
        }
    }
}

// Is this person scheduled anywhere on this job — at job, panel or op level?
// Same containment test the Hours page uses for "my" jobs.
private fun personOnJob(job: TRAQSJob, personId: Int): Boolean =
    job.team.contains(personId) || job.subs.any { panel ->
        panel.team.contains(personId) || panel.subs.any { op -> op.team.contains(personId) }
    }

// MARK: - KPI Grid

@Composable
private fun KpiGrid(
    jobs: List<TRAQSJob>,
    peopleCount: Int,
    hpd: Double,
    workDays: Int,
) {
    val c = traQSColors
    val hoursThisWeek = jobs.sumOf { it.loggedHours ?: 0.0 }
    val jobsFinished = jobs.count { it.status == JobStatus.FINISHED }
    val total = max(1.0, max(1, peopleCount) * hpd * max(1, workDays))
    val utilization = min(100, ((hoursThisWeek / total) * 100).toInt())

    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KpiCard(
                modifier = Modifier.weight(1f),
                label = "Hours billed",
                value = "%.1f".format(hoursThisWeek),
                sub = "this wk",
                delta = "+12%",
                up = true,
                color = c.accent
            )
            KpiCard(
                modifier = Modifier.weight(1f),
                label = "Jobs done",
                value = "$jobsFinished",
                sub = "this wk",
                delta = "+4",
                up = true,
                color = c.text
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KpiCard(
                modifier = Modifier.weight(1f),
                label = "On-time rate",
                value = "92%",
                sub = "rolling 30d",
                delta = "−3%",
                up = false,
                color = c.danger
            )
            KpiCard(
                modifier = Modifier.weight(1f),
                label = "Utilization",
                value = "$utilization%",
                sub = "team avg",
                delta = "+5%",
                up = true,
                color = Color(0xFF10B981)
            )
        }
    }
}

@Composable
private fun KpiCard(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
    sub: String,
    delta: String,
    up: Boolean,
    color: Color,
) {
    val c = traQSColors
    TCard(
        modifier = modifier,
        radius = TRadius.lg,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(label.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.muted, letterSpacing = TTrack.section)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(value, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = c.text)
                Text(sub, fontSize = 11.sp, color = c.muted, modifier = Modifier.padding(bottom = 6.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(
                    if (up) TIcons.ArrowUp else TIcons.ArrowDown,
                    null, tint = color, modifier = Modifier.size(11.dp)
                )
                Text(delta, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = color)
                Text("vs last", fontSize = 11.sp, color = c.muted)
            }
        }
    }
}

// MARK: - Hero trend card

@Composable
private fun HeroTrendCard(jobs: List<TRAQSJob>) {
    val c = traQSColors
    val hours = jobs.sumOf { it.loggedHours ?: 0.0 }
    val base = max(8.0, hours / 6)
    val points = List(14) { i ->
        val t = i / 13.0
        base + t * (base * 0.6) + (i % 3) * 1.2
    }
    val total = points.sum().toInt()

    TCard(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        radius = TRadius.lg,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("$total", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = c.text)
                    Text("hours total", fontSize = 11.sp, color = c.muted, modifier = Modifier.padding(bottom = 4.dp))
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "+14% vs prior",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.accent,
                    modifier = Modifier
                        .background(c.accent.copy(alpha = 0.10f), RoundedCornerShape(TRadius.xs))
                        .border(1.dp, c.accent.copy(alpha = 0.5f), RoundedCornerShape(TRadius.xs))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                )
            }
            Sparkline(points = points)
            Row {
                Text("14 days ago", fontSize = 10.sp, color = c.muted)
                Spacer(Modifier.weight(1f))
                Text("today", fontSize = 10.sp, color = c.muted)
            }
        }
    }
}

@Composable
private fun Sparkline(points: List<Double>) {
    val c = traQSColors
    val maxV = (points.maxOrNull() ?: 1.0).coerceAtLeast(1.0)
    val minV = (points.minOrNull() ?: 0.0)
    val range = (maxV - minV).coerceAtLeast(0.0001)
    androidx.compose.foundation.Canvas(
        modifier = Modifier.fillMaxWidth().height(84.dp)
    ) {
        if (points.size < 2) return@Canvas
        val w = size.width
        val h = size.height
        val step = w / (points.size - 1)
        val path = Path()
        val fillPath = Path()
        points.forEachIndexed { i, v ->
            val x = i * step
            val y = h - ((v - minV) / range * h).toFloat()
            if (i == 0) { path.moveTo(x, y); fillPath.moveTo(x, h); fillPath.lineTo(x, y) }
            else { path.lineTo(x, y); fillPath.lineTo(x, y) }
        }
        fillPath.lineTo(w, h); fillPath.close()
        drawPath(path = fillPath, color = c.accent.copy(alpha = 0.12f))
        drawPath(path = path, color = c.accent, style = Stroke(width = 4f))
    }
}

// MARK: - Job mix card

@Composable
private fun JobMixCard(jobs: List<TRAQSJob>) {
    val c = traQSColors
    val palette = mapOf(
        "LAYOUT" to Color(0xFFD946EF),
        "INSTALL" to Color(0xFFD946EF),
        "WIRE" to Color(0xFF22D3EE),
        "CUT" to Color(0xFFEAB308),
        "INSPECT" to Color(0xFFA78BFA),
        "REPAIR" to Color(0xFFF59E0B),
        "CALLBACK" to Color(0xFFF43F5E),
        "CONTRACT" to Color(0xFF10B981),
    )

    val counts = mutableMapOf<String, Int>()
    jobs.forEach { job ->
        val label = deptLabelForJob(job)
        counts[label] = (counts[label] ?: 0) + 1
    }
    val total = max(1, counts.values.sum())
    val mix = counts.map { (k, v) ->
        Triple(k, ((v.toDouble() / total) * 100).toInt(), palette[k] ?: c.muted)
    }.sortedByDescending { it.second }

    TCard(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        radius = TRadius.lg,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (mix.isEmpty()) {
                Text("No jobs yet", fontSize = 13.sp, color = c.muted)
            } else {
                // Stacked bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(14.dp)
                        .clip(RoundedCornerShape(TRadius.xs))
                ) {
                    mix.forEach { (_, pct, col) ->
                        Box(
                            modifier = Modifier
                                .fillMaxHeight()
                                .weight(pct.coerceAtLeast(1).toFloat())
                                .background(col)
                        )
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    mix.forEach { (label, pct, col) ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(modifier = Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(col))
                            Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text)
                            Spacer(Modifier.weight(1f))
                            Text("$pct%", fontSize = 11.sp, color = c.text)
                        }
                    }
                }
            }
        }
    }
}

private fun deptLabelForJob(job: TRAQSJob): String {
    val key = job.title.lowercase()
    return when {
        "layout" in key -> "LAYOUT"
        "wire" in key -> "WIRE"
        "cut" in key -> "CUT"
        "inspect" in key -> "INSPECT"
        "repair" in key -> "REPAIR"
        "install" in key -> "INSTALL"
        "callback" in key -> "CALLBACK"
        "contract" in key -> "CONTRACT"
        else -> job.title.uppercase().ifEmpty { "OTHER" }
    }
}

// MARK: - Non-admin empty state

@Composable
private fun NonAdminEmpty() {
    val c = traQSColors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 80.dp, start = 32.dp, end = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(TIcons.Analytics, null, tint = c.border, modifier = Modifier.size(44.dp))
        Text("Stats are admin-only", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = c.text)
        Text("Check back when you're a dispatcher.", fontSize = 13.sp, color = c.muted)
    }
}
