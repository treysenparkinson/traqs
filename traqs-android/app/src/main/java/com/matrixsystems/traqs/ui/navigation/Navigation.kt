package com.matrixsystems.traqs.ui.navigation

import android.app.Activity
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.services.ThemeSettings
import com.matrixsystems.traqs.ui.screens.*

sealed class Screen(val route: String) {
    object Splash : Screen("splash")
    object Login : Screen("login")
    object OrgCode : Screen("org_code")
    object Main : Screen("main")
    object JobDetail : Screen("job_detail/{jobId}") {
        fun createRoute(jobId: String) = "job_detail/$jobId"
    }
    object JobEdit : Screen("job_edit/{jobId}") {
        fun createRoute(jobId: String?) = "job_edit/${jobId ?: "new"}"
    }
    object AskTRAQS : Screen("ask_traqs")
    object Analytics : Screen("analytics")
    object Customize : Screen("customize")
    object Team : Screen("team")
    object Gantt : Screen("gantt")
}

@Composable
fun TRAQSNavGraph(
    authManager: AuthManager,
    appState: AppState,
    themeSettings: ThemeSettings
) {
    val navController = rememberNavController()
    val context = LocalContext.current
    val activity = context as Activity

    val isAuthenticated by authManager.isAuthenticated.collectAsState()
    val orgCode by appState.orgCode.collectAsState()

    val realDestination = when {
        !isAuthenticated -> Screen.Login.route
        orgCode.isEmpty() -> Screen.OrgCode.route
        else -> Screen.Main.route
    }

    NavHost(
        navController = navController,
        startDestination = Screen.Splash.route,
        enterTransition = { fadeIn(tween(500)) },
        exitTransition  = { fadeOut(tween(0)) }
    ) {
        composable(
            Screen.Splash.route,
            enterTransition = { EnterTransition.None },
            exitTransition  = { ExitTransition.None }
        ) {
            SplashScreen(
                onFinished = {
                    navController.navigate(realDestination) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Login.route) {
            LoginScreen(
                authManager = authManager,
                onLoginSuccess = {
                    navController.navigate(Screen.OrgCode.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
                activity = activity
            )
        }

        composable(Screen.OrgCode.route) {
            OrgCodeScreen(
                authManager = authManager,
                appState = appState,
                onSuccess = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.OrgCode.route) { inclusive = true }
                    }
                },
                onSignOut = {
                    authManager.logout(activity)
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Main.route) {
            MainScreen(
                authManager = authManager,
                appState = appState,
                themeSettings = themeSettings,
                navController = navController,
                activity = activity
            )
        }

        composable(Screen.JobDetail.route) { backStack ->
            val jobId = backStack.arguments?.getString("jobId") ?: return@composable
            val job = appState.jobs.collectAsState().value.firstOrNull { it.id == jobId }
                ?: return@composable
            JobDetailScreen(
                job = job,
                appState = appState,
                navController = navController
            )
        }

        composable(Screen.JobEdit.route) { backStack ->
            val jobId = backStack.arguments?.getString("jobId")
            val job = if (jobId == "new") null
                      else appState.jobs.collectAsState().value.firstOrNull { it.id == jobId }
            JobEditScreen(
                job = job,
                appState = appState,
                onDismiss = { navController.popBackStack() }
            )
        }

        composable(Screen.AskTRAQS.route) {
            AskTRAQSScreen(
                appState = appState,
                onDismiss = { navController.popBackStack() }
            )
        }

        composable(Screen.Analytics.route) {
            AnalyticsScreen(
                appState = appState,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Customize.route) {
            CustomizeScreen(
                themeSettings = themeSettings,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Team.route) {
            TeamScreen(
                appState = appState,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Gantt.route) {
            GanttScreen(
                appState = appState,
                navController = navController,
                onAskTRAQS = { navController.navigate(Screen.AskTRAQS.route) }
            )
        }
    }
}
