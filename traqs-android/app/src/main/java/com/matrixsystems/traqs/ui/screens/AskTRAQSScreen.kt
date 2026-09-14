package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.ui.theme.TRadius
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.frostedCard
import com.matrixsystems.traqs.ui.theme.glassSurfaceTint
import com.matrixsystems.traqs.ui.theme.traQSColors
import com.google.gson.Gson

data class ChatMessage(val role: String, val content: String) // "user" | "assistant"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AskTRAQSScreen(appState: AppState, onDismiss: () -> Unit) {
    val c = traQSColors
    val jobs by appState.jobs.collectAsState()
    val people by appState.people.collectAsState()
    var messages by remember { mutableStateOf(listOf<ChatMessage>()) }
    var inputText by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    val currentPerson = appState.currentPerson
    val isAdmin = currentPerson?.isAdmin ?: false

    val systemPrompt = remember(jobs, people, isAdmin) {
        val date = java.text.SimpleDateFormat("yyyy-MM-dd").format(java.util.Date())
        if (isAdmin) {
            """You are TRAQS AI, a scheduling and production management assistant with full edit capabilities.
Current date: $date
Jobs: ${Gson().toJson(jobs.take(20))}
People: ${Gson().toJson(people)}
You can help the user describe changes to jobs, schedules, and team assignments. Provide actionable recommendations."""
        } else {
            """You are TRAQS AI, a read-only scheduling assistant.
Current date: $date
Jobs: ${Gson().toJson(jobs.take(20))}
People: ${Gson().toJson(people)}
Help with scheduling questions and workload analysis. You cannot make changes — for edits, ask an admin."""
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Scaffold(
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(TIcons.Spark, null, tint = c.accent, modifier = Modifier.size(20.dp))
                        Text("Ask TRAQS", fontWeight = FontWeight.Bold, color = c.text)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(TIcons.ArrowLeft, "Back", tint = c.accent)
                    }
                },
                actions = {
                    if (messages.isNotEmpty()) {
                        IconButton(onClick = { messages = emptyList() }) {
                            Icon(TIcons.Trash, "Clear", tint = c.muted)
                        }
                    }
                },
                // Transparent: the nav graph paints ONE page canvas and every screen
                // floats on it. An opaque bar here cut a white slab across the
                // top of that canvas on every pushed screen.
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent)
            )
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(c.surface.copy(alpha = glassSurfaceTint))
                    .padding(12.dp)
                    .navigationBarsPadding(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    placeholder = { Text("Ask about your schedule…", color = c.muted, fontSize = 13.sp) },
                    modifier = Modifier.weight(1f),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = c.text,
                        unfocusedTextColor = c.text,
                        focusedContainerColor = c.bg,
                        unfocusedContainerColor = c.bg,
                        focusedBorderColor = c.accent,
                        unfocusedBorderColor = c.border
                    ),
                    shape = RoundedCornerShape(TRadius.md),
                    maxLines = 3
                )
                IconButton(
                    onClick = {
                        val text = inputText.trim()
                        if (text.isBlank() || isLoading) return@IconButton
                        messages = messages + ChatMessage("user", text)
                        inputText = ""
                        isLoading = true
                        appState.askAI(
                            system = systemPrompt,
                            userMessage = text,
                            onResult = { reply ->
                                messages = messages + ChatMessage("assistant", reply)
                                isLoading = false
                            },
                            onError = { err ->
                                messages = messages + ChatMessage("assistant", "Error: $err")
                                isLoading = false
                            }
                        )
                    },
                    enabled = inputText.isNotBlank() && !isLoading
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(color = c.accent, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(TIcons.Send, "Send", tint = if (inputText.isNotBlank()) c.accent else c.muted)
                    }
                }
            }
        }
    ) { padding ->
        if (messages.isEmpty() && !isLoading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(contentAlignment = Alignment.TopEnd) {
                        Icon(TIcons.Spark, null, tint = c.accent, modifier = Modifier.size(48.dp))
                        if (!isAdmin) {
                            Icon(TIcons.Lock, null, tint = c.muted, modifier = Modifier.size(16.dp))
                        }
                    }
                    Text("Ask TRAQS", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.text)
                    Text(
                        if (isAdmin) "Get AI-powered scheduling insights" else "Read-only view — ask an admin to make changes",
                        color = c.muted, fontSize = 13.sp
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            "Who has the most capacity this week?",
                            "Which jobs are at risk of running late?",
                            "Summarize current workload"
                        ).forEach { suggestion ->
                            SuggestionChip(
                                onClick = { inputText = suggestion },
                                label = { Text(suggestion, fontSize = 12.sp, color = c.accent) },
                                border = SuggestionChipDefaults.suggestionChipBorder(
                                    enabled = true,
                                    borderColor = c.accent.copy(alpha = 0.4f)
                                ),
                                colors = SuggestionChipDefaults.suggestionChipColors(containerColor = c.surface)
                            )
                        }
                    }
                }
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(messages) { msg ->
                    val isUser = msg.role == "user"
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
                    ) {
                        if (!isUser) {
                            Box(
                                modifier = Modifier.size(28.dp)
                                    .background(c.accent, androidx.compose.foundation.shape.CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(TIcons.Spark, null, tint = Color.White, modifier = Modifier.size(14.dp))
                            }
                            Spacer(Modifier.width(8.dp))
                        }
                        Box(
                            modifier = Modifier
                                .background(
                                    if (isUser) c.accent else c.surface,
                                    RoundedCornerShape(TRadius.sm)
                                )
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                                .widthIn(max = 300.dp)
                        ) {
                            Text(
                                msg.content,
                                fontSize = 14.sp,
                                color = if (isUser) Color.White else c.text
                            )
                        }
                    }
                }
                if (isLoading) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(color = c.accent, modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text("Thinking…", fontSize = 13.sp, color = c.muted)
                        }
                    }
                }
            }
        }
    }
}
