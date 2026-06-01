package com.matrixsystems.traqs.ui.screens

import android.app.Activity
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import kotlinx.coroutines.launch

// Side-drawer navigation matching iOS MainTabView.
// Five wireframe tabs (Jobs / Schedule / Hours / Stats / Chat) plus
// Admin (admin-only) and Settings rows, with a profile + logout footer.

// Tab icons mirror iOS TIcon SF Symbols: briefcase, calendar, clock, chart.bar, message.
enum class TTab(val label: String, val icon: ImageVector) {
    JOBS("Jobs", Icons.Default.BusinessCenter),     // iOS: briefcase
    SCHEDULE("Schedule", Icons.Default.CalendarMonth), // iOS: calendar
    HOURS("Hours", Icons.Default.Schedule),         // iOS: clock
    STATS("Stats", Icons.Default.BarChart),         // iOS: chart.bar
    CHAT("Chat", Icons.Default.ChatBubbleOutline),  // iOS: message
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    authManager: AuthManager,
    appState: AppState,
    themeSettings: ThemeSettings,
    navController: NavHostController,
    activity: Activity
) {
    val c = traQSColors
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    // iOS defaults to .schedule; mirror that.
    var selected by rememberSaveable { mutableStateOf(TTab.SCHEDULE) }

    LaunchedEffect(Unit) { appState.loadAll() }

    val openDrawer: () -> Unit = { scope.launch { drawerState.open() } }
    val closeDrawer: () -> Unit = { scope.launch { drawerState.close() } }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            SideMenu(
                appState = appState,
                authManager = authManager,
                activity = activity,
                selected = selected,
                onSelect = { tab ->
                    selected = tab
                    closeDrawer()
                },
                onClose = closeDrawer,
                onOpenSettings = {
                    closeDrawer()
                    navController.navigate(Screen.Settings.route)
                },
                onOpenAdmin = {
                    closeDrawer()
                    navController.navigate(Screen.Admin.route)
                }
            )
        }
    ) {
        CompositionLocalProvider(LocalDrawerToggle provides openDrawer) {
            // Tab content with a quick fade between tabs (matches iOS .transition(.opacity))
            AnimatedContent(
                targetState = selected,
                transitionSpec = { fadeIn() togetherWith fadeOut() },
                label = "tab"
            ) { tab ->
                Box(modifier = Modifier.fillMaxSize().background(c.bg)) {
                    when (tab) {
                        TTab.JOBS -> JobsScreen(
                            appState = appState,
                            navController = navController,
                            onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                        )
                        TTab.SCHEDULE -> GanttScreen(
                            appState = appState,
                            navController = navController,
                            onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                        )
                        TTab.HOURS -> TimeClockScreen(
                            appState = appState,
                            onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) },
                            onOpenSettings = { navController.navigate(Screen.Settings.route) }
                        )
                        TTab.STATS -> StatsScreen(appState = appState)
                        TTab.CHAT -> MessagesScreen(
                            appState = appState,
                            navController = navController,
                            onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                        )
                    }
                }
            }
        }
    }
}

// MARK: - Side menu (drawer content)

@Composable
private fun SideMenu(
    appState: AppState,
    authManager: AuthManager,
    activity: Activity,
    selected: TTab,
    onSelect: (TTab) -> Unit,
    onClose: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenAdmin: () -> Unit,
) {
    val c = traQSColors
    val person = appState.currentPerson
    val email by authManager.userEmail.collectAsState()

    ModalDrawerSheet(
        drawerContainerColor = c.surface,
        drawerShape = RoundedCornerShape(0.dp),
        modifier = Modifier.width(280.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxHeight()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            // Header: wordmark + close (matches iOS SideMenu)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 24.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TRAQSLogo(height = 60.dp)
                Spacer(Modifier.weight(1f))
                TRAQSIconBtn(icon = Icons.Default.Close, contentDescription = "Close", onClick = onClose)
            }

            // Tab rows
            Column(modifier = Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                TTab.entries.forEach { tab ->
                    SideMenuRow(
                        icon = tab.icon,
                        label = tab.label,
                        isOn = selected == tab,
                        onClick = { onSelect(tab) }
                    )
                }
            }

            // Divider
            HorizontalDivider(
                color = c.border,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
            )

            // Admin + Settings — Admin shows the team live-status board.
            Column(modifier = Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SideMenuRow(
                    icon = Icons.Default.AdminPanelSettings,
                    label = "Admin",
                    isOn = false,
                    onClick = onOpenAdmin
                )
                SideMenuRow(
                    icon = Icons.Default.Settings,
                    label = "Settings",
                    isOn = false,
                    onClick = onOpenSettings
                )
            }

            Spacer(Modifier.weight(1f))

            // Profile + logout footer
            ProfileFooter(
                person = person,
                email = email,
                orgName = appState.orgCode.collectAsState().value,
                onLogout = {
                    authManager.logout(activity)
                    onClose()
                }
            )
        }
    }
}

@Composable
private fun SideMenuRow(
    icon: ImageVector,
    label: String,
    isOn: Boolean,
    onClick: () -> Unit
) {
    val c = traQSColors
    val bgColor = if (isOn) c.accent.copy(alpha = 0.06f) else Color.Transparent
    val iconBg = if (isOn) c.accent.copy(alpha = 0.16f) else Color.Transparent
    val tint = if (isOn) c.accent else c.muted
    val textColor = if (isOn) c.text else c.muted
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(bgColor)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(
            modifier = Modifier
                .size(width = 36.dp, height = 28.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(iconBg)
                .then(if (isOn) Modifier.border(1.dp, c.accent.copy(alpha = 0.24f), RoundedCornerShape(14.dp)) else Modifier),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
        }
        Text(
            label,
            fontSize = 15.sp,
            color = textColor,
            fontWeight = if (isOn) FontWeight.Bold else FontWeight.Medium
        )
    }
}

@Composable
private fun ProfileFooter(
    person: com.matrixsystems.traqs.models.Person?,
    email: String?,
    orgName: String,
    onLogout: () -> Unit,
) {
    val c = traQSColors
    val initials = remember(person) {
        (person?.name ?: "—").split(" ").take(2)
            .map { it.firstOrNull()?.uppercaseChar()?.toString() ?: "" }
            .joinToString("")
    }
    val personColor = try { parseColor(person?.color ?: "#7c3aed") } catch (_: Exception) { c.accent }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Avatar
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(personColor),
            contentAlignment = Alignment.Center
        ) {
            Text(initials, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
        }

        Column(modifier = Modifier.weight(1f)) {
            if (orgName.isNotEmpty()) {
                Text(
                    orgName.uppercase(),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = c.muted,
                    letterSpacing = 0.8.sp,
                    maxLines = 1
                )
            }
            Text(
                person?.name ?: "—",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = c.text,
                maxLines = 1
            )
            val displayEmail = email ?: person?.email
            if (!displayEmail.isNullOrEmpty()) {
                Text(displayEmail, fontSize = 11.sp, color = c.muted, maxLines = 1)
            }
        }

        // Logout button
        IconButton(
            onClick = onLogout,
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(c.danger.copy(alpha = 0.10f))
                .border(1.dp, c.danger.copy(alpha = 0.30f), CircleShape)
        ) {
            Icon(Icons.Default.Logout, "Sign out", tint = c.danger, modifier = Modifier.size(14.dp))
        }
    }
}
