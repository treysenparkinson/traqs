package com.matrixsystems.traqs

import android.app.Application
import androidx.compose.runtime.*
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.services.ThemeSettings
import com.matrixsystems.traqs.ui.navigation.TRAQSNavGraph
import com.matrixsystems.traqs.ui.theme.TRAQSTheme
import com.onesignal.OneSignal
import com.onesignal.debug.LogLevel

class TRAQSApp : Application() {
    override fun onCreate() {
        super.onCreate()
        OneSignal.Debug.logLevel = LogLevel.NONE
        OneSignal.initWithContext(this, AppConfig.OneSignal.APP_ID)
    }
}

// Convenience accessor for AppConfig in this package
private object AppConfig {
    object OneSignal {
        const val APP_ID = com.matrixsystems.traqs.services.AppConfig.OneSignal.APP_ID
    }
}

@Composable
fun TRAQSRoot() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val authManager = remember { AuthManager(context) }
    val appState = remember { AppState(context) }
    val themeSettings = remember { ThemeSettings(context) }

    val isAuthenticated by authManager.isAuthenticated.collectAsState()
    val accessToken by authManager.accessToken.collectAsState()
    val orgCode by appState.orgCode.collectAsState()
    val currentPersonId = appState.currentPersonId

    // Auto-configure on resume when we already have stored credentials
    LaunchedEffect(isAuthenticated, accessToken, orgCode) {
        val token = accessToken
        if (isAuthenticated && token != null && orgCode.isNotEmpty()) {
            appState.matchEmail = authManager.userEmail.value
            appState.configure(token, orgCode)
        }
    }

    // OneSignal login when person matched
    LaunchedEffect(currentPersonId) {
        if (currentPersonId != null) {
            OneSignal.login(currentPersonId.toString())
        }
    }

    TRAQSTheme(themeSettings = themeSettings) {
        TRAQSNavGraph(
            authManager = authManager,
            appState = appState,
            themeSettings = themeSettings
        )
    }
}
