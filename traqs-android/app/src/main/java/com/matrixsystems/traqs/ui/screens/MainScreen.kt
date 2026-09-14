package com.matrixsystems.traqs.ui.screens

import android.app.Activity
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.services.ThemeSettings
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.navigation.TRAQSTabBar
import com.matrixsystems.traqs.ui.navigation.TTab
import com.matrixsystems.traqs.ui.theme.NavBarScrim

// The app shell — a port of iOS MainTabView.
//
// Owns three things and nothing else: the ONE page background every tab is
// translucent onto, the tab content, and the floating tab bar over it. The
// side drawer this replaced is gone entirely; navigation is the bar, and the
// two rows the drawer carried that are not tabs (Admin, Settings) moved into
// the Analytics tab's header, which is where iOS keeps its "more" surface.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    authManager: AuthManager,
    appState: AppState,
    themeSettings: ThemeSettings,
    navController: NavHostController,
    activity: Activity
) {
    // Home is the landing tab, matching iOS.
    var selected by rememberSaveable { mutableStateOf(TTab.HOME) }
    val unreadCount by appState.unreadCount.collectAsState()
    // Dropped while a message thread is open — its composer owns the bottom of
    // the screen there. See MessagesScreen.onThreadOpenChanged.
    var hideTabBar by remember { mutableStateOf(false) }
    var jobsMode by rememberSaveable { mutableStateOf(JobsMode.LIST) }

    LaunchedEffect(Unit) { appState.loadAll() }

    // The page canvas is painted once for the whole nav graph (see Navigation.kt)
    // so pushed screens share it and the blobs' drift is never restarted.
    Box(Modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = selected,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "tab"
        ) { tab ->
            when (tab) {
                TTab.HOME -> HomeScreen(
                    appState = appState,
                    onOpenHours = { selected = TTab.HOURS },
                    onOpenChat = { selected = TTab.CHAT },
                    onOpenJobs = { selected = TTab.JOBS },
                    onOpenSettings = { navController.navigate(Screen.Settings.route) },
                )
                // Jobs owns BOTH the list and the schedule, toggled in its
                // header — the same shape as iOS, where the Jobs tab subsumed
                // the old Schedule tab via AppNav.jobsMode. The mode lives here
                // so it survives a tab switch.
                TTab.JOBS -> if (jobsMode == JobsMode.LIST) {
                    JobsScreen(
                        appState = appState,
                        navController = navController,
                        onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) },
                        jobsMode = jobsMode,
                        onToggleMode = { jobsMode = it },
                    )
                } else {
                    GanttScreen(
                        appState = appState,
                        navController = navController,
                        onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) },
                        jobsMode = jobsMode,
                        onToggleMode = { jobsMode = it },
                    )
                }
                TTab.HOURS -> TimeClockScreen(
                    appState = appState,
                    onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) },
                    onOpenSettings = { navController.navigate(Screen.Settings.route) }
                )
                TTab.CHAT -> MessagesScreen(
                    appState = appState,
                    navController = navController,
                    onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) },
                    onThreadOpenChanged = { hideTabBar = it },
                )
                TTab.STATS -> StatsScreen(
                    appState = appState,
                    onOpenAdmin = { navController.navigate(Screen.Admin.route) },
                    onOpenTeam = { navController.navigate(Screen.Team.route) },
                    onOpenClients = { navController.navigate(Screen.Clients.route) },
                    onOpenAnalytics = { navController.navigate(Screen.Analytics.route) },
                )
            }
        }

        if (!hideTabBar) {
            // Behind the bar, above the content: the scrim has to sit between
            // them, so it is drawn here rather than with the page background.
            NavBarScrim(Modifier.align(Alignment.BottomCenter))
            TRAQSTabBar(
                selected = selected,
                onSelect = { selected = it },
                chatBadge = unreadCount,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 12.dp),
            )
        }
    }
}
