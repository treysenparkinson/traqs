package com.matrixsystems.traqs.ui.screens

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.services.ThemeSettings
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors

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
    var showLogoutConfirm by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TRAQSHeader(

                onAskTRAQS = onAskTRAQS,

            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Profile card
            item {
                Card(
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
                            Text(person?.name ?: "Unknown", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
                            Text(email ?: "", fontSize = 12.sp, color = c.muted)
                            person?.role?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, fontSize = 12.sp, color = c.muted)
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(4.dp)) }

            // Menu items
            item {
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
                }
            }

            item {
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
