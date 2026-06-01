package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import com.matrixsystems.traqs.models.Message
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.util.UUID

enum class ChatFilter(val label: String) {
    ALL("All"), UNREAD("Unread"), DMS("DMs"), GROUPS("Groups"), MENTIONS("Mentions")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessagesScreen(
    appState: AppState,
    navController: NavHostController? = null,
    onAskTRAQS: () -> Unit = {}
) {
    val c = traQSColors
    val messages by appState.messages.collectAsState()
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()
    val groups by appState.groups.collectAsState()
    val isLoading by appState.isLoading.collectAsState()
    val currentPersonId = appState.currentPersonId
    var isManualRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(isLoading) { if (!isLoading) isManualRefreshing = false }
    var selectedThreadKey by remember { mutableStateOf<String?>(null) }
    var showDeleteFor by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf(ChatFilter.ALL) }

    // Mark read when thread list is shown
    LaunchedEffect(selectedThreadKey) {
        if (selectedThreadKey == null) appState.markMessagesRead()
    }

    // Group messages by threadKey
    val threads = remember(messages, filter) {
        val all = messages.groupBy { it.threadKey }
            .entries
            .sortedByDescending { it.value.maxOf { m -> m.timestamp } }
        when (filter) {
            ChatFilter.ALL -> all
            ChatFilter.UNREAD -> all  // No per-thread read state yet — pass-through
            ChatFilter.DMS -> all.filter { it.key.startsWith("dm:") }
            ChatFilter.GROUPS -> all.filter { it.key.startsWith("group:") }
            ChatFilter.MENTIONS -> emptyList()  // No mention metadata yet
        }
    }

    fun displayTitle(key: String, lastMsg: Message?): String {
        return when {
            key.startsWith("dm:") -> {
                val ids = key.removePrefix("dm:").split("_").mapNotNull { it.toIntOrNull() }
                val otherId = ids.firstOrNull { it != currentPersonId } ?: ids.firstOrNull()
                people.firstOrNull { it.id == otherId }?.name ?: "Direct Message"
            }
            key.startsWith("group:") -> {
                val ref = key.removePrefix("group:")
                groups.firstOrNull { it.name == ref || it.id == ref }?.name ?: ref
            }
            key.startsWith("job:") -> jobs.firstOrNull { it.id == lastMsg?.jobId }?.title ?: "Job: ${key.removePrefix("job:")}"
            key.startsWith("panel:") -> "Panel: ${key.removePrefix("panel:")}"
            key.startsWith("op:") -> "Op: ${key.removePrefix("op:")}"
            else -> key
        }
    }

    showDeleteFor?.let { threadKey ->
        val c = traQSColors
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

    if (selectedThreadKey != null) {
        val thread = messages.filter { it.threadKey == selectedThreadKey }
        val threadMsg = thread.firstOrNull()
        val title = when {
            threadMsg?.scope == "job" -> jobs.firstOrNull { it.id == threadMsg.jobId }?.title ?: threadMsg.threadKey
            else -> threadMsg?.threadKey ?: selectedThreadKey ?: ""
        }
        ThreadView(
            title = title,
            messages = thread,
            appState = appState,
            threadKey = selectedThreadKey!!,
            onBack = { selectedThreadKey = null }
        )
    } else {
        Scaffold(
            containerColor = c.bg,
            topBar = {
                TRAQSHeader {
                    TRAQSIconBtn(icon = Icons.Default.Search, contentDescription = "Search") { /* search inline below */ }
                    TRAQSIconBtn(icon = Icons.Default.Add, contentDescription = "New conversation", iconColor = c.accent) { /* TODO: new DM/group */ }
                }
            }
        ) { padding ->
            PullToRefreshBox(
                isRefreshing = isManualRefreshing,
                onRefresh = { isManualRefreshing = true; appState.loadAll() },
                modifier = Modifier.fillMaxSize().padding(padding)
            ) {
            if (threads.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No messages yet", color = c.muted)
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().background(c.bg),
                    contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item { ChatFilterPills(selected = filter, onSelect = { filter = it }) }
                    items(threads, key = { it.key }) { (threadKey, msgs) ->
                        val lastMsg = msgs.maxByOrNull { it.timestamp }
                        ThreadRow(
                            threadKey = threadKey,
                            displayTitle = displayTitle(threadKey, lastMsg),
                            lastMessage = lastMsg,
                            unreadCount = msgs.size,
                            onClick = { selectedThreadKey = threadKey },
                            onLongClick = { showDeleteFor = threadKey }
                        )
                    }
                }
            }
            } // PullToRefreshBox
        }
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
            Surface(
                onClick = { onSelect(f) },
                shape = RoundedCornerShape(20.dp),
                color = if (on) c.accent else c.surface,
                border = BorderStroke(1.dp, if (on) c.accent else c.border)
            ) {
                Text(
                    f.label,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (on) Color.White else c.text,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ThreadRow(
    threadKey: String,
    displayTitle: String,
    lastMessage: Message?,
    unreadCount: Int,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {}
) {
    val c = traQSColors
    val authorColor = lastMessage?.authorColor?.let { try { parseColor(it) } catch (_: Exception) { c.accent } } ?: c.accent

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = c.card),
        border = BorderStroke(1.dp, c.border)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Avatar — initials of the resolved title for DMs, # tile for groups, hash for job/panel/op
            val initials = displayTitle.split(" ").take(2)
                .map { it.firstOrNull()?.uppercaseChar()?.toString() ?: "" }
                .joinToString("")
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape).background(authorColor),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    initials.ifEmpty { "#" },
                    fontWeight = FontWeight.Bold, color = Color.White, fontSize = 14.sp
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    displayTitle,
                    fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.text, maxLines = 1
                )
                lastMessage?.let {
                    Text(
                        "${it.authorName}: ${it.text}",
                        fontSize = 12.sp, color = c.muted, maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                    )
                }
            }
            if (unreadCount > 0) {
                Text(
                    "$unreadCount",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    modifier = Modifier
                        .background(c.accent, CircleShape)
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadView(
    title: String,
    messages: List<Message>,
    appState: AppState,
    threadKey: String,
    onBack: () -> Unit
) {
    val c = traQSColors
    val person = appState.currentPerson
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TopAppBar(
                title = { Text(title, fontWeight = FontWeight.Bold, color = c.text, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = c.accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = c.surface)
            )
        },
        bottomBar = {
            if (person != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(c.surface)
                        .padding(12.dp)
                        .navigationBarsPadding(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        placeholder = { Text("Message…", color = c.muted) },
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = c.text,
                            unfocusedTextColor = c.text,
                            focusedContainerColor = c.bg,
                            unfocusedContainerColor = c.bg,
                            focusedBorderColor = c.accent,
                            unfocusedBorderColor = c.border
                        ),
                        shape = RoundedCornerShape(20.dp),
                        singleLine = true
                    )
                    IconButton(
                        onClick = {
                            if (inputText.isNotBlank()) {
                                val msg = Message(
                                    id = UUID.randomUUID().toString(),
                                    threadKey = threadKey,
                                    scope = messages.firstOrNull()?.scope ?: "job",
                                    jobId = messages.firstOrNull()?.jobId,
                                    text = inputText.trim(),
                                    authorId = person.id,
                                    authorName = person.name,
                                    authorColor = person.color,
                                    participantIds = listOf(person.id),
                                    attachments = emptyList(),
                                    timestamp = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
                                        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                                        .format(java.util.Date())
                                )
                                appState.sendMessage(msg)
                                inputText = ""
                            }
                        },
                        enabled = inputText.isNotBlank()
                    ) {
                        Icon(Icons.Default.Send, "Send", tint = if (inputText.isNotBlank()) c.accent else c.muted)
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(messages.sortedBy { it.timestamp }, key = { it.id }) { msg ->
                val isMine = msg.authorId == appState.currentPerson?.id
                val authorColor = try { parseColor(msg.authorColor) } catch (_: Exception) { c.accent }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start
                ) {
                    if (!isMine) {
                        Box(
                            modifier = Modifier.size(28.dp).clip(CircleShape).background(authorColor),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(msg.authorName.take(1).uppercase(), fontSize = 11.sp, color = Color.White, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(8.dp))
                    }
                    Column(horizontalAlignment = if (isMine) Alignment.End else Alignment.Start) {
                        if (!isMine) Text(msg.authorName, fontSize = 11.sp, color = c.muted, modifier = Modifier.padding(start = 4.dp))
                        Box(
                            modifier = Modifier
                                .background(
                                    if (isMine) c.accent else c.surface,
                                    RoundedCornerShape(
                                        topStart = 14.dp, topEnd = 14.dp,
                                        bottomStart = if (isMine) 14.dp else 4.dp,
                                        bottomEnd = if (isMine) 4.dp else 14.dp
                                    )
                                )
                                .padding(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Text(msg.text, fontSize = 14.sp, color = if (isMine) Color.White else c.text)
                        }
                    }
                }
            }
        }
    }
}
