package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.models.JobStatus
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.ShiftStatus
import androidx.compose.ui.unit.TextUnit
import com.matrixsystems.traqs.ui.theme.*
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*

// Home — the default landing tab. A port of iOS Views/HomeView.
//
// A "good morning" page: a big greeting, today's date and week, live shift
// status, who is waiting on a reply, and today's job with a button through to
// it. Home never starts or logs time itself — that lives on Jobs and the Time
// Clock, and duplicating it here would mean two places to get the clock wrong.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    appState: AppState,
    onOpenHours: () -> Unit,
    onOpenChat: () -> Unit,
    onOpenJobs: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()
    val messages by appState.messages.collectAsState()
    val currentPersonId = appState.currentPersonId
    val me = people.firstOrNull { it.id == currentPersonId }

    // Home is the landing tab, so it pulls what its hero needs: the pay-clock
    // history and org settings are not part of loadAll().
    LaunchedEffect(currentPersonId) {
        appState.refreshTimeclock(currentPersonId)
        appState.refreshOrgSettings()
    }

    // One tick a second — the shift timer is the point of this page. "Today"
    // only rolls over at midnight, so the date card reads the clock directly
    // rather than riding this.
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) { now = System.currentTimeMillis(); delay(1000) }
    }

    val firstName = me?.name?.trim()?.split(" ")?.firstOrNull().orEmpty()
    val greeting = if (firstName.isEmpty()) "Hello" else "Hello, $firstName"

    val shiftStatus = remember(people, currentPersonId, now) { appState.myShiftStatus }
    val liveHours = remember(people, currentPersonId, now) { appState.liveShiftHours(now) }
    val senders = remember(messages, currentPersonId) { appState.unreadSenders }

    // Active job if clocked into one, else the next not-started task today, else
    // whatever today holds. Mirrors iOS HomeView.suggested.
    val suggested = remember(jobs, currentPersonId, now) {
        val mine = computeMyTasks(jobs, currentPersonId, "")
        val today = mine.filter { it.overlapsDay(startOfDay(now)) }
        val activeJobId = me?.activeJobClock?.jobId
        mine.firstOrNull { activeJobId != null && it.job.id == activeJobId }
            ?: today.firstOrNull { it.status == JobStatus.NOT_STARTED }
            ?: today.firstOrNull()
    }
    val isActive = me?.activeJobClock != null && suggested?.job?.id == me.activeJobClock?.jobId

    // The shell paints PageBackground behind every tab, so this screen adds only
    // its own chrome. The header is what keeps the greeting clear of the status
    // bar — without it the title sat under the system clock.
    Scaffold(
        containerColor = Color.Transparent,
        topBar = {
            TRAQSHeader {
                // Settings lives here, as the signed-in person's own face —
                // "my account" is a better home for it than the Analytics tab,
                // and a photo says whose account it is without a label.
                Box(Modifier.clip(CircleShape).clickable(onClick = onOpenSettings)) {
                    Avatar(person = me, size = 38.dp)
                }
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(top = 4.dp, bottom = tabPillBottomInset),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item { PageTitle(greeting) }

            item { TodayDateCard(now) }

            // Two square cards side by side: the live shift on the left, who is
            // waiting on you on the right.
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    ShiftStatusHero(
                        status = shiftStatus,
                        liveHours = liveHours,
                        onOpen = onOpenHours,
                        modifier = Modifier.weight(1f)
                    )
                    NewMessagesCard(
                        senders = senders,
                        onOpen = onOpenChat,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            item {
                if (suggested != null) {
                    SuggestedJobCard(
                        title = suggested.title,
                        jobTitle = suggested.job.title.ifEmpty { suggested.title },
                        isActive = isActive,
                        onJump = onOpenJobs,
                    )
                } else {
                    HomeEmpty("Nothing scheduled for today.")
                }
            }
        }
    }
}

// The big display title at the top of a page. Mirrors iOS PageTitle: 56pt
// ExtraBold with -4 tracking — the negative tracking is not decoration, it is
// what keeps a two-word title on one line at that size.
//
// `size`/`tracking` are overridable for the same reason iOS exposes them: a
// longer title (Approval Queue) drops to 34/-2 rather than wrapping.
@Composable
fun PageTitle(
    title: String,
    subtitle: String? = null,
    size: TextUnit = 56.sp,
    tracking: TextUnit = (-4).sp,
) {
    val c = traQSColors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = pageTitleTopInset, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(
            title,
            style = TTypo.wordmark(size).copy(
                // Two things were padding the top of every page title, and
                // together they read as a heavy forehead above the words:
                //
                //  · `includeFontPadding` — a legacy Android metric that adds
                //    the font's full ascent/descent ABOVE the cap height. On a
                //    56sp display face that is a lot of nothing.
                //  · the default line height, which at this size reserves
                //    leading for a second line the title never has.
                //
                // SwiftUI does neither, which is why the same 56pt title sits
                // tight under the header on iOS. `lineHeight = size` trims it to
                // the glyphs; `Trim.Both` removes what's left at both ends.
                platformStyle = PlatformTextStyle(includeFontPadding = false),
                lineHeight = size,
                lineHeightStyle = LineHeightStyle(
                    alignment = LineHeightStyle.Alignment.Center,
                    trim = LineHeightStyle.Trim.Both
                )
            ),
            letterSpacing = tracking,
            color = c.text,
        )
        subtitle?.let { Text(it, style = TTypo.sm(13.sp), color = c.muted) }
    }
}

// Space above a page title, under the header. Matches iOS pageTitleTopInset.
// Space above a page title, under the header. Zero: the header now trims its
// own bottom padding to the wordmark glyph (see TRAQSHeader), so any inset here
// is added on top of margin the art already carries.
val pageTitleTopInset = 0.dp

// ── Today's date + week strip ──────────────────────────────────────────────

@Composable
private fun TodayDateCard(now: Long) {
    val c = traQSColors
    val dateLine = remember(now / 60_000L) {
        SimpleDateFormat("MMMM d, yyyy", Locale.US).format(Date(now)).uppercase()
    }
    // Sunday-first week containing today, matching the iOS strip.
    val weekDays = remember(now / 60_000L) {
        val start = Calendar.getInstance().apply {
            timeInMillis = startOfDay(now)
            add(Calendar.DAY_OF_YEAR, -(get(Calendar.DAY_OF_WEEK) - 1))
        }
        (0 until 7).map { i ->
            Calendar.getInstance().apply {
                timeInMillis = start.timeInMillis
                add(Calendar.DAY_OF_YEAR, i)
            }
        }
    }
    val todayStart = startOfDay(now)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .frostedCard()
            .padding(TInset.hero),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // No "TODAY'S DATE" label above this — the date and the strip under it
        // say what the card is.
        Text(dateLine, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.text)

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val dowChars = listOf("S", "M", "T", "W", "T", "F", "S")
            weekDays.forEach { d ->
                val isToday = startOfDay(d.timeInMillis) == todayStart
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(TRadius.sm))
                        .then(
                            if (isToday) Modifier.background(
                                Brush.verticalGradient(c.brandGradient),
                                RoundedCornerShape(TRadius.sm)
                            ) else Modifier
                        )
                        .padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    Text(
                        dowChars[d.get(Calendar.DAY_OF_WEEK) - 1],
                        fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp,
                        color = if (isToday) c.onGradient else c.muted
                    )
                    Text(
                        "${d.get(Calendar.DAY_OF_MONTH)}",
                        fontSize = 14.sp, fontWeight = FontWeight.Bold,
                        color = if (isToday) c.onGradient else c.text
                    )
                }
            }
        }
    }
}

// ── Live shift hero ────────────────────────────────────────────────────────

@Composable
private fun ShiftStatusHero(
    status: ShiftStatus,
    liveHours: Double,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    val elapsed = remember(liveHours) {
        val secs = maxOf(0, (liveHours * 3600).toInt())
        "%d:%02d:%02d".format(secs / 3600, (secs % 3600) / 60, secs % 60)
    }
    Column(
        modifier = modifier
            .aspectRatio(1f)
            .frostedCard()
            .clickable(onClick = onOpen)
            .padding(TInset.hero),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "This shift",
            fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.text,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.weight(1f))
        // Placeholder dashes when off the clock keep the card the same height
        // whether or not a shift is open.
        Text(
            if (status == ShiftStatus.OFFLINE) "--:--:--" else elapsed,
            fontSize = 26.sp, fontWeight = FontWeight.Bold,
            color = if (status == ShiftStatus.OFFLINE) c.muted else c.text,
            maxLines = 1,
        )
        TagPill(label = status.label, kind = status.tagKind(), dot = status.dot)
        Spacer(Modifier.weight(1f))
    }
}

private fun ShiftStatus.tagKind(): TagKind = when (this) {
    ShiftStatus.OFFLINE -> TagKind.NEUTRAL
    ShiftStatus.CLOCKED_IN -> TagKind.GREEN
    ShiftStatus.LUNCH -> TagKind.INDIGO
    ShiftStatus.ON_BREAK -> TagKind.AMBER
}

// ── New messages hero ──────────────────────────────────────────────────────

@Composable
private fun NewMessagesCard(
    senders: List<Triple<Int, String, Int>>,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = traQSColors
    Column(
        modifier = modifier
            .aspectRatio(1f)
            .frostedCard()
            .clickable(onClick = onOpen)
            .padding(TInset.hero),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Messages", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.text)

        if (senders.isEmpty()) {
            Spacer(Modifier.weight(1f))
            // Tick and label stay on ONE line: this card is a square roughly
            // 166dp wide, so once the inset went to TInset.hero there was only
            // ~120dp of room and the label wrapped into a stacked row.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    TIcons.CheckCircle, contentDescription = null,
                    tint = c.green, modifier = Modifier.size(15.dp)
                )
                Text(
                    "No new messages",
                    fontSize = 13.sp, color = c.muted,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.weight(1f))
        } else {
            // One small row per person with unread messages: name + count.
            senders.take(3).forEach { (_, name, count) ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        name, fontSize = 13.sp, color = c.text,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "$count",
                        fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.onGradient,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Brush.horizontalGradient(c.brandGradient), CircleShape)
                            .padding(horizontal = 7.dp, vertical = 2.dp)
                    )
                }
            }
            if (senders.size > 3) {
                Text("+${senders.size - 3} more", fontSize = 11.sp, color = c.muted)
            }
            Spacer(Modifier.weight(1f))
        }
    }
}

// ── Today's job ────────────────────────────────────────────────────────────

@Composable
private fun SuggestedJobCard(
    title: String,
    jobTitle: String,
    isActive: Boolean,
    onJump: () -> Unit,
) {
    val c = traQSColors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .frostedCard()
            .padding(TInset.hero),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TagPill(label = title, kind = TagKind.INDIGO)
            TagPill(
                label = if (isActive) "Active" else "Up next",
                kind = if (isActive) TagKind.INDIGO else TagKind.GREEN,
                dot = isActive,
            )
        }
        Text(
            jobTitle, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = c.text,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        GradientCTA(
            onClick = onJump,
            modifier = Modifier.fillMaxWidth(),
            verticalPadding = 12.dp,
        ) {
            Icon(
                TIcons.ArrowRight, contentDescription = null,
                tint = c.onGradient, modifier = Modifier.size(16.dp)
            )
            Spacer(Modifier.width(6.dp))
            Text(
                if (isActive) "Go to your job" else "Jump to job",
                fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.onGradient
            )
        }
    }
}

@Composable
private fun HomeEmpty(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .frostedCard(radius = TRadius.md)
            // Inset INSIDE the card, not just vertically: with only vertical
            // padding the text started at the card's own left edge and the
            // rounded corner clipped its first character.
            .padding(horizontal = TInset.md, vertical = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 13.sp, color = traQSColors.muted)
    }
}
