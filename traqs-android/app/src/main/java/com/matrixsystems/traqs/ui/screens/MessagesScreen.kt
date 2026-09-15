package com.matrixsystems.traqs.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.models.ChatGroup
import com.matrixsystems.traqs.models.Message
import com.matrixsystems.traqs.models.Person
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.ThreadRoster
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.TRadius
import com.matrixsystems.traqs.ui.theme.TTrack
import com.matrixsystems.traqs.ui.theme.TTypo
import com.matrixsystems.traqs.ui.theme.frostedCard
import com.matrixsystems.traqs.ui.theme.glassControl
import com.matrixsystems.traqs.ui.theme.glassSurfaceTint
import com.matrixsystems.traqs.ui.theme.tabPillBottomInset
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.launch
import java.util.UUID

enum class ChatFilter(val label: String) {
    ALL("All"), UNREAD("Unread"), DMS("DMs"), GROUPS("Groups"), MENTIONS("Mentions")
}

// ============================================================================
// Messages
//
// The inbox is ONE page: the "Messages" page title over a single sheet that
// holds every thread as a flat row, separated by hairlines. It is deliberately
// NOT a stack of per-thread cards - every row carrying its own shape and shadow
// made the inbox read as a pile of things to look AT, where threads are a list
// you scan down. This mirrors iOS MessagesView (`LazyVStack(spacing: 0)` on a
// `frostedSheetTop` sheet), which is the layout of record.
// ============================================================================

/** Air between the title and the sheet's lip - THE dial for how far down the inbox sits. */
private val SHEET_TOP_INSET = 16.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagesScreen(
    appState: AppState,
    navController: NavHostController? = null,
    onAskTRAQS: () -> Unit = {},
    /** Tells the shell to hide the floating tab pill while a thread is open. */
    onThreadOpenChanged: (Boolean) -> Unit = {},
) {
    val c = traQSColors
    val messages by appState.messages.collectAsState()
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()
    val groups by appState.groups.collectAsState()
    val isLoading by appState.isLoading.collectAsState()
    val threadReadAt by appState.threadReadAt.collectAsState()
    val currentPersonId = appState.currentPersonId
    var isManualRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(isLoading) { if (!isLoading) isManualRefreshing = false }
    var selectedThreadKey by remember { mutableStateOf<String?>(null) }
    var showDeleteFor by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf(ChatFilter.ALL) }
    var searchOpen by remember { mutableStateOf(false) }
    var searchText by remember { mutableStateOf("") }

    // Mark read when the thread list is shown
    LaunchedEffect(selectedThreadKey) {
        if (selectedThreadKey == null) appState.markMessagesRead()
    }
    // The floating tab pill hides inside a thread — it would sit on top of the
    // composer otherwise.
    LaunchedEffect(selectedThreadKey) { onThreadOpenChanged(selectedThreadKey != null) }
    // Leaving the tab entirely always restores the bar, however we left.
    DisposableEffect(Unit) { onDispose { onThreadOpenChanged(false) } }

    fun displayTitle(key: String, lastMsg: Message?): String = when {
        key.startsWith("dm:") -> {
            val ids = key.removePrefix("dm:").split("_").mapNotNull { it.toIntOrNull() }
            val otherId = ids.firstOrNull { it != currentPersonId } ?: ids.firstOrNull()
            people.firstOrNull { it.id == otherId }?.name ?: "Direct Message"
        }
        // Group threads are keyed by id (web parity); resolve id OR name - legacy
        // threads were keyed by name - to the group's DISPLAY name, which falls
        // back to its members when the group was never named. Reading `.name`
        // directly here is what rendered most groups as a raw UUID.
        key.startsWith("group:") -> {
            val ref = key.removePrefix("group:")
            groups.firstOrNull { it.id == ref || it.name == ref }
                ?.displayName(people, currentPersonId) ?: "Group"
        }
        key.startsWith("job:") -> jobs.firstOrNull { it.id == lastMsg?.jobId }?.title
            ?: "Job: ${key.removePrefix("job:")}"
        key.startsWith("panel:") -> "Panel: ${key.removePrefix("panel:")}"
        key.startsWith("op:") -> "Op: ${key.removePrefix("op:")}"
        else -> key
    }

    // Group messages by threadKey, newest conversation first.
    val threads = remember(messages, filter, searchText, people, groups, threadReadAt) {
        val all = messages.groupBy { it.threadKey }
            .entries
            .sortedByDescending { it.value.maxOfOrNull { m -> m.timestamp } ?: "" }
        val byFilter = when (filter) {
            ChatFilter.ALL -> all
            ChatFilter.UNREAD -> all.filter { appState.unreadCount(it.key, it.value) > 0 }
            ChatFilter.DMS -> all.filter { it.key.startsWith("dm:") }
            ChatFilter.GROUPS -> all.filter { !it.key.startsWith("dm:") }
            ChatFilter.MENTIONS -> emptyList()  // No mention metadata yet
        }
        if (searchText.isBlank()) byFilter
        else byFilter.filter { (key, msgs) ->
            val title = displayTitle(key, msgs.maxByOrNull { it.timestamp })
            val last = msgs.maxByOrNull { it.timestamp }?.text ?: ""
            title.contains(searchText, true) || last.contains(searchText, true)
        }
    }

    showDeleteFor?.let { threadKey ->
        AlertDialog(
            onDismissRequest = { showDeleteFor = null },
            title = { Text("Delete Thread", color = c.text) },
            text = { Text("Delete this message thread? This cannot be undone.", color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    appState.deleteThread(threadKey)
                    showDeleteFor = null
                }) { Text("Delete", color = c.danger) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteFor = null }) { Text("Cancel", color = c.muted) }
            },
            containerColor = c.card
        )
    }

    val openKey = selectedThreadKey
    if (openKey != null) {
        ThreadView(
            threadKey = openKey,
            appState = appState,
            onBack = { selectedThreadKey = null },
            onOpenThread = { selectedThreadKey = it }
        )
        return
    }

    val listState = rememberLazyListState()

    Scaffold(
        containerColor = Color.Transparent,
        topBar = {
            TRAQSHeader {
                TRAQSIconBtn(
                    icon = TIcons.Search,
                    contentDescription = "Search",
                    iconColor = if (searchOpen) c.accent else null
                ) {
                    searchOpen = !searchOpen
                    if (!searchOpen) searchText = ""
                }
                TRAQSIconBtn(
                    icon = TIcons.Plus,
                    contentDescription = "New conversation",
                    iconColor = c.accent
                ) { /* TODO: new DM/group compose sheet */ }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            PageTitle("Messages")

            AnimatedVisibility(
                visible = searchOpen,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                        .glassControl(CircleShape)
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(TIcons.Search, null, tint = c.muted, modifier = Modifier.size(15.dp))
                    Box(Modifier.weight(1f)) {
                        if (searchText.isEmpty()) {
                            Text("Search conversations...", style = TTypo.sm(14.sp), color = c.muted)
                        }
                        BasicTextField(
                            value = searchText,
                            onValueChange = { searchText = it },
                            singleLine = true,
                            textStyle = LocalTextStyle.current.merge(TTypo.sm(14.sp)).copy(color = c.text),
                            cursorBrush = SolidColor(c.accent),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            ChatFilterPills(selected = filter, onSelect = { filter = it })

            Spacer(Modifier.height(SHEET_TOP_INSET))

            // The sheet: rounded lip at the top, running clean off the bottom
            // edge. ONE surface for the whole list, not one per row — and the
            // app's own glass, so the frosted toggle and the liquid background
            // reach it like every other card.
            PullToRefreshBox(
                isRefreshing = isManualRefreshing,
                onRefresh = { isManualRefreshing = true; appState.loadAll() },
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(topStart = TRadius.hero, topEnd = TRadius.hero))
                    .background(c.surface.copy(alpha = if (c.frosted) glassSurfaceTint else 1f))
            ) {
                if (threads.isEmpty()) {
                    ChatEmptyState(filter = filter, searching = searchText.isNotBlank())
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        // Clears the floating tab pill, which sits over the list.
                        contentPadding = PaddingValues(top = 8.dp, bottom = tabPillBottomInset)
                    ) {
                        threads.forEachIndexed { idx, entry ->
                            val (threadKey, msgs) = entry
                            item(key = threadKey) {
                                // Between rows only: no line above the first (it
                                // would sit just under the sheet's lip) or below
                                // the last.
                                if (idx > 0) {
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .height(1.dp)
                                            .background(c.border.copy(alpha = 0.55f))
                                    )
                                }
                                val lastMsg = msgs.maxByOrNull { it.timestamp }
                                ChannelRow(
                                    threadKey = threadKey,
                                    displayTitle = displayTitle(threadKey, lastMsg),
                                    lastMessage = lastMsg,
                                    participants = ThreadRoster.participants(
                                        threadKey, msgs, people, groups
                                    ),
                                    myId = currentPersonId,
                                    unreadCount = appState.unreadCount(threadKey, msgs),
                                    onClick = {
                                        appState.markThreadRead(threadKey)
                                        selectedThreadKey = threadKey
                                    },
                                    onLongClick = { showDeleteFor = threadKey }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatEmptyState(filter: ChatFilter, searching: Boolean) {
    val c = traQSColors
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Spacer(Modifier.height(60.dp))
        Icon(TIcons.Chat, null, tint = c.border, modifier = Modifier.size(44.dp))
        Text(
            when {
                searching -> "No matches"
                filter == ChatFilter.MENTIONS -> "No mentions"
                filter == ChatFilter.UNREAD -> "Inbox zero"
                else -> "No conversations yet"
            },
            style = TTypo.h3(18.sp), color = c.text
        )
        Text("Start one with the + button.", style = TTypo.sm(13.sp), color = c.muted)
    }
}

@Composable
private fun ChatFilterPills(selected: ChatFilter, onSelect: (ChatFilter) -> Unit) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        ChatFilter.entries.forEach { f ->
            val on = selected == f
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .then(
                        if (on) Modifier.background(
                            Brush.horizontalGradient(c.brandGradient), CircleShape
                        )
                        else Modifier.glassControl(CircleShape)
                    )
                    .clickable { onSelect(f) }
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text(
                    f.label,
                    style = TTypo.xsBold(12.sp),
                    color = if (on) c.onGradient else c.text
                )
            }
        }
    }
}

/**
 * One inbox row: a DM shows the other person's avatar, anything else shows the
 * overlapping stack of everyone in it. Flat - the sheet underneath carries the
 * surface, the hairline above carries the separation.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChannelRow(
    threadKey: String,
    displayTitle: String,
    lastMessage: Message?,
    participants: List<Person>,
    myId: Int?,
    unreadCount: Int,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {}
) {
    val c = traQSColors
    val isDM = threadKey.startsWith("dm:")
    // The row's identity mark. One constant because a DM avatar, a group's stack
    // and the fallback all have to line up in the same column.
    val avatarSize = 52.dp
    val stackAvatarSize = 30.dp

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            // The row's height, and the main dial for how substantial the list
            // feels now the hairlines are doing the separating.
            .padding(horizontal = 18.dp, vertical = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        when {
            // A DM shows the OTHER person's own colour, so it's clearly a 1:1
            // chat. Resolved by id, not by matching the title string - two people
            // sharing a name would have picked whichever came first.
            isDM -> TAvatar(
                initials = initialsFrom(displayTitle),
                size = avatarSize,
                fill = participants.firstOrNull { it.id != myId }?.let { personBrush(it.color) }
            )
            participants.isNotEmpty() -> ParticipantStack(
                people = participants,
                avatarSize = stackAvatarSize,
                maxShown = 3,
                // minWidth, NOT width: three overlapping avatars are wider than
                // one, and a fixed frame doesn't clip - the cluster simply spills
                // out of it and sits on top of the thread title.
                modifier = Modifier.widthIn(min = avatarSize)
            )
            else -> TAvatar(initials = "#", size = avatarSize)
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // The title takes ALL the leftover width, which is what pins the
                // timestamp to the right edge in one straight column down the
                // list. It was `weight(1f, fill = false)` followed by a
                // `Spacer(weight 1f)`: two weighted children split the free space
                // evenly, so the spacer only pushed the stamp half way and the
                // half a short title didn't use was left as slack — every row's
                // timestamp landed somewhere different depending on how long its
                // title happened to be. The preview/badge row below has always
                // used a plain `weight(1f)`, which is why those DID line up.
                Text(
                    displayTitle,
                    style = TTypo.smBold(15.sp), color = c.text,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                lastMessage?.timestamp?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.width(8.dp))
                    Text(threadDateStamp(it), style = TTypo.xs(11.sp), color = c.muted, maxLines = 1)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    lastMessage?.text.orEmpty(),
                    style = TTypo.xs(13.sp), color = c.muted,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (unreadCount > 0) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "$unreadCount",
                        style = TTypo.xsBold(11.sp), color = c.onGradient,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Brush.horizontalGradient(c.brandGradient), CircleShape)
                            .padding(horizontal = 7.dp, vertical = 3.dp)
                    )
                }
            }
        }
    }
}

// ============================================================================
// Thread
// ============================================================================

/** A cluster of consecutive messages, headed by the time it started. */
private data class MessageSection(
    val id: String,
    val header: String,
    val messages: MutableList<Message>
)

/**
 * Split a thread into time clusters. A new section begins on a new calendar day
 * or after a gap of more than an hour - the same rule iOS uses.
 */
private fun sectionize(messages: List<Message>): List<MessageSection> {
    val out = mutableListOf<MessageSection>()
    for (m in messages) {
        val last = out.lastOrNull()
        val lastTs = last?.messages?.lastOrNull()?.timestamp
        val sameCluster = lastTs != null && withinOneHourSameDay(lastTs, m.timestamp)
        if (sameCluster) last!!.messages.add(m)
        else out.add(MessageSection(m.id, sectionStamp(m.timestamp), mutableListOf(m)))
    }
    return out
}

/** True when `b` follows `a` on the same calendar day and less than an hour later. */
private fun withinOneHourSameDay(a: String, b: String): Boolean {
    val dayA = a.substringBefore('T')
    val dayB = b.substringBefore('T')
    if (dayA.isEmpty() || dayA != dayB) return false
    val ma = isoMillis(a) ?: return false
    val mb = isoMillis(b) ?: return false
    return mb - ma in 0 until 60 * 60 * 1000L
}

private fun isoMillis(ts: String): Long? =
    runCatching {
        val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
        f.timeZone = java.util.TimeZone.getTimeZone("UTC")
        f.parse(ts.take(19))?.time
    }.getOrNull()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadView(
    threadKey: String,
    appState: AppState,
    onBack: () -> Unit,
    onOpenThread: (String) -> Unit = {}
) {
    val c = traQSColors
    val scope = rememberCoroutineScope()
    val allMessages by appState.messages.collectAsState()
    val people by appState.people.collectAsState()
    val groups by appState.groups.collectAsState()
    val jobs by appState.jobs.collectAsState()
    val person = appState.currentPerson
    val myId = appState.currentPersonId

    var inputText by remember { mutableStateOf("") }
    var showMembers by remember { mutableStateOf(false) }
    var showAddPeople by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    val messages = remember(allMessages, threadKey) {
        allMessages.filter { it.threadKey == threadKey }.sortedBy { it.timestamp }
    }
    val sections = remember(messages) { sectionize(messages) }
    val participants = remember(threadKey, messages, people, groups) {
        ThreadRoster.participants(threadKey, messages, people, groups)
    }

    /** The group this thread IS, when it's a group thread and the group has loaded. */
    val editableGroup: ChatGroup? = remember(threadKey, groups) {
        if (!threadKey.startsWith("group:")) null
        else {
            val ref = threadKey.removePrefix("group:")
            groups.firstOrNull { it.id == ref || it.name == ref }
        }
    }

    val isDM = threadKey.startsWith("dm:")
    val title = remember(threadKey, people, groups, jobs, messages) {
        when {
            isDM -> {
                val ids = threadKey.removePrefix("dm:").split("_").mapNotNull { it.toIntOrNull() }
                val otherId = ids.firstOrNull { it != myId } ?: ids.firstOrNull()
                people.firstOrNull { it.id == otherId }?.name ?: "Direct Message"
            }
            threadKey.startsWith("group:") ->
                editableGroup?.displayName(people, myId) ?: "Group"
            threadKey.startsWith("job:") ->
                jobs.firstOrNull { it.id == messages.firstOrNull()?.jobId }?.title
                    ?: "Job: ${threadKey.removePrefix("job:")}"
            threadKey.startsWith("panel:") -> "Panel: ${threadKey.removePrefix("panel:")}"
            threadKey.startsWith("op:") -> "Op: ${threadKey.removePrefix("op:")}"
            else -> threadKey
        }
    }

    // Adding people is supported for group chats (edit the roster) and DMs (spin
    // up a group). Job/panel/op membership comes from the job team.
    val canAddPeople = threadKey.startsWith("group:") || isDM

    // Follow the conversation, and keep the read cursor at its newest message so
    // the inbox badge stays clear while you're sitting in the thread.
    LaunchedEffect(messages.size) {
        if (messages.isEmpty()) return@LaunchedEffect
        appState.markThreadRead(threadKey)
        // One item per section header plus one per message.
        listState.animateScrollToItem(sections.size + messages.size - 1)
    }

    val statusBar = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val headerHeight = statusBar + THREAD_BAR_HEIGHT + THREAD_HEADER_FADE

    if (showAddPeople) {
        val group = editableGroup
        if (group != null) {
            EditGroupPopup(
                group = group,
                people = people,
                myId = myId,
                onDismiss = { showAddPeople = false },
                onSave = { name, memberIds ->
                    scope.launch { appState.updateGroup(group.id, name, memberIds) }
                }
            )
        } else {
            AddPeoplePopup(
                people = people,
                excludedIds = participants.map { it.id }.toSet(),
                onDismiss = { showAddPeople = false },
                onAdd = { ids ->
                    // DM + picks spins up a GROUP and opens it; the original DM
                    // stays intact. Unnamed on purpose so the title derives from
                    // whoever is in it and stays right as people are added.
                    if (ids.isNotEmpty() && isDM) {
                        showMembers = false
                        val members = (participants.map { it.id } + ids).distinct()
                        scope.launch {
                            appState.createGroup("", members)?.let { onOpenThread("group:${it.id}") }
                        }
                    }
                }
            )
        }
    }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = {
                if (person != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            // ONE inset, not two: `imePadding()` on top of
                            // `navigationBarsPadding()` double-pads while the
                            // keyboard is up, because the IME inset already
                            // covers the nav bar. The union takes whichever is
                            // taller.
                            .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.Bottom,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .glassControl(RoundedCornerShape(TRadius.md))
                                .padding(horizontal = 16.dp, vertical = 12.dp)
                        ) {
                            if (inputText.isEmpty()) {
                                Text("Message...", style = TTypo.sm(14.sp), color = c.muted)
                            }
                            BasicTextField(
                                value = inputText,
                                onValueChange = { inputText = it },
                                maxLines = 5,
                                textStyle = LocalTextStyle.current.merge(TTypo.sm(14.sp))
                                    .copy(color = c.text),
                                cursorBrush = SolidColor(c.accent),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        val canSend = inputText.isNotBlank()
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(
                                    if (canSend) Brush.horizontalGradient(c.brandGradient)
                                    else SolidColor(c.muted.copy(alpha = 0.4f)),
                                    CircleShape
                                )
                                .clickable(enabled = canSend) {
                                    val msg = Message(
                                        id = UUID.randomUUID().toString(),
                                        threadKey = threadKey,
                                        scope = messages.firstOrNull()?.scope
                                            ?: if (isDM) "dm" else "group",
                                        jobId = messages.firstOrNull()?.jobId,
                                        text = inputText.trim(),
                                        authorId = person.id,
                                        authorName = person.name,
                                        authorColor = person.color,
                                        // Everyone in the thread, not just me -
                                        // the server routes delivery off this.
                                        participantIds = participants.map { it.id }
                                            .ifEmpty { listOf(person.id) },
                                        attachments = emptyList(),
                                        timestamp = java.text.SimpleDateFormat(
                                            "yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US
                                        ).apply {
                                            timeZone = java.util.TimeZone.getTimeZone("UTC")
                                        }.format(java.util.Date())
                                    )
                                    appState.sendMessage(msg)
                                    inputText = ""
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                TIcons.Send, "Send",
                                tint = if (canSend) c.onGradient else c.muted,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }
        ) { padding ->
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding()),
                // Room at the top for the header plate, which floats over the
                // list so messages scroll UNDER its fade.
                contentPadding = PaddingValues(
                    top = headerHeight + 8.dp,
                    bottom = 24.dp,
                    start = 16.dp,
                    end = 16.dp
                ),
                // The list's breathing room. Bubbles sat 8dp apart, which read as
                // one solid block of text; a conversation needs air between turns
                // for the sender changes to be legible at a glance.
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                if (messages.isEmpty()) {
                    item {
                        Text(
                            "No messages yet. Say hello!",
                            style = TTypo.sm(14.sp), color = c.muted,
                            modifier = Modifier.fillMaxWidth().padding(top = 40.dp)
                        )
                    }
                }
                sections.forEach { section ->
                    item(key = "hdr_${section.id}") { SectionTimeHeader(section.header) }
                    items(section.messages.size, key = { section.messages[it].id }) { i ->
                        val msg = section.messages[i]
                        MessageBubble(
                            message = msg,
                            isMe = msg.authorId == myId,
                            author = people.firstOrNull { it.id == msg.authorId }
                        )
                    }
                }
            }
        }

        // Members dropdown - pills slide out beneath the header when the identity
        // is tapped.
        //
        // BELOW the header plate in the stack, deliberately. Its scrim covers the
        // whole top of the screen, so drawn above the plate it dimmed the back
        // button and the title along with the conversation - the one thing that
        // must stay crisp, since it's what you tap to close the popover again.
        // iOS gets this for free (the header lives in its own UIWindow above the
        // page); here the order is the mechanism. The pills themselves start
        // below the plate, so nothing of the popover is hidden by it.
        ThreadMembersPopover(
            visible = showMembers,
            participants = participants,
            canAddPeople = canAddPeople,
            isGroup = editableGroup != null,
            topInset = headerHeight,
            onDismiss = { showMembers = false },
            onAddPeople = { showAddPeople = true }
        )

        // Header plate, floating over the list.
        ThreadHeaderPlate(
            title = title,
            isDM = isDM,
            myId = myId,
            participants = participants,
            onBack = onBack,
            onTapIdentity = { showMembers = !showMembers }
        )
    }
}

/** Centered, muted time label above each message cluster. */
@Composable
private fun SectionTimeHeader(text: String) {
    val c = traQSColors
    Text(
        text,
        style = TTypo.xsBold(11.sp),
        letterSpacing = TTrack.pill,
        color = c.muted,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp),
        textAlign = TextAlign.Center
    )
}

/**
 * One message. The bubble is 22dp on three corners with a 6dp tuck on the BOTTOM
 * corner nearest the sender, so it points back at whoever wrote it - matching
 * iOS and the web app. Tap to reveal the timestamp.
 */
@Composable
private fun MessageBubble(message: Message, isMe: Boolean, author: Person?) {
    val c = traQSColors
    var showTimestamp by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(
        topStart = 22.dp, topEnd = 22.dp,
        bottomStart = if (isMe) 22.dp else 6.dp,
        bottomEnd = if (isMe) 6.dp else 22.dp
    )

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isMe) Alignment.End else Alignment.Start
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = if (isMe) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Bottom
        ) {
            if (!isMe) {
                TAvatar(
                    initials = initialsFrom(message.authorName),
                    size = 28.dp,
                    fill = personBrush(author?.color ?: message.authorColor)
                )
                Spacer(Modifier.width(8.dp))
            }
            Column(
                horizontalAlignment = if (isMe) Alignment.End else Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.widthIn(max = 300.dp)
            ) {
                // Sender's name above their bubble - same as iOS, so a group
                // thread stays readable when several people are talking.
                if (!isMe) {
                    Text(
                        message.authorName,
                        style = TTypo.xs(11.sp),
                        color = c.muted,
                        modifier = Modifier.padding(start = 4.dp)
                    )
                }
                Box(
                    modifier = Modifier
                        .then(
                            // Mine keeps the solid brand gradient; received
                            // messages are the app's frosted glass. That contrast
                            // is what makes the two sides read apart at a glance.
                            if (isMe) Modifier
                                .clip(shape)
                                .background(Brush.horizontalGradient(c.brandGradient), shape)
                            else Modifier.frostedCard(radius = 22.dp, rim = false)
                        )
                        .clickable(
                            indication = null,
                            interactionSource = remember { MutableInteractionSource() }
                        ) { showTimestamp = !showTimestamp }
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                ) {
                    Text(
                        message.text,
                        style = TTypo.sm(14.sp),
                        color = if (isMe) c.onGradient else c.text
                    )
                }
            }
        }
        if (showTimestamp) {
            Text(
                messageStamp(message.timestamp),
                style = TTypo.xs(10.sp),
                color = c.muted,
                modifier = Modifier.padding(
                    start = if (isMe) 0.dp else 36.dp,
                    end = if (isMe) 4.dp else 0.dp,
                    top = 4.dp
                )
            )
        }
    }
}
