package com.matrixsystems.traqs.ui.screens

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavHostController
import androidx.navigation.compose.*
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.services.ThemeSettings
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.traQSColors

sealed class BottomTab(val route: String, val label: String, val icon: ImageVector) {
    object Home : BottomTab("tab_home", "Schedule", Icons.Default.Home)
    object Jobs : BottomTab("tab_jobs", "Jobs", Icons.Default.Checklist)
    object Clients : BottomTab("tab_clients", "Clients", Icons.Default.Business)
    object Messages : BottomTab("tab_messages", "Messages", Icons.Default.Forum)
    object More : BottomTab("tab_more", "More", Icons.Default.MoreHoriz)
}

val BOTTOM_TABS = listOf(
    BottomTab.Home, BottomTab.Jobs, BottomTab.Clients, BottomTab.Messages, BottomTab.More
)

@Composable
fun MainScreen(
    authManager: AuthManager,
    appState: AppState,
    themeSettings: ThemeSettings,
    navController: NavHostController,
    activity: Activity
) {
    val c = traQSColors
    val tabNavController = rememberNavController()
    val currentBackStack by tabNavController.currentBackStackEntryAsState()
    val currentRoute = currentBackStack?.destination?.route
    val unreadCount by appState.unreadCount.collectAsState()

    LaunchedEffect(Unit) {
        appState.loadAll()
    }

    Scaffold(
        containerColor = c.bg,
        bottomBar = {
            NavigationBar(containerColor = c.surface) {
                BOTTOM_TABS.forEach { tab ->
                    NavigationBarItem(
                        selected = currentRoute == tab.route,
                        onClick = {
                            tabNavController.navigate(tab.route) {
                                popUpTo(tabNavController.graph.startDestinationId) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            if (tab == BottomTab.Messages && unreadCount > 0) {
                                BadgedBox(badge = { Badge { Text("$unreadCount") } }) {
                                    Icon(tab.icon, contentDescription = tab.label)
                                }
                            } else {
                                Icon(tab.icon, contentDescription = tab.label)
                            }
                        },
                        label = { Text(tab.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = c.accent,
                            selectedTextColor = c.accent,
                            indicatorColor = c.accent.copy(alpha = 0.12f),
                            unselectedIconColor = c.muted,
                            unselectedTextColor = c.muted
                        )
                    )
                }
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            NavHost(
                navController = tabNavController,
                startDestination = BottomTab.Home.route,
                modifier = Modifier.fillMaxSize()
            ) {
                composable(BottomTab.Home.route) {
                    HomeScreen(
                        appState = appState,
                        navController = navController,
                        onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                    )
                }
                composable(BottomTab.Jobs.route) {
                    JobsScreen(
                        appState = appState,
                        navController = navController,
                        onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                    )
                }
                composable(BottomTab.Clients.route) {
                    ClientsScreen(
                        appState = appState,
                        navController = navController,
                        onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                    )
                }
                composable(BottomTab.Messages.route) {
                    MessagesScreen(
                        appState = appState,
                        navController = navController,
                        onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                    )
                }
                composable(BottomTab.More.route) {
                    MoreScreen(
                        appState = appState,
                        authManager = authManager,
                        themeSettings = themeSettings,
                        navController = navController,
                        activity = activity,
                        onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
                    )
                }
            }

        }
    }
}
