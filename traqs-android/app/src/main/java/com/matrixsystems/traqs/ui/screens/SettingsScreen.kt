package com.matrixsystems.traqs.ui.screens

import android.app.Activity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.matrixsystems.traqs.services.AppState
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.ui.navigation.Screen
import com.matrixsystems.traqs.ui.theme.traQSColors

// Settings — mirrors iOS SettingsView. Theme & accent, account info, about, sign out.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    appState: AppState,
    authManager: AuthManager,
    navController: NavHostController,
    activity: Activity,
    onDismiss: () -> Unit,
) {
    val c = traQSColors
    val person = appState.currentPerson
    val orgCode by appState.orgCode.collectAsState()
    val ctx = LocalContext.current
    val versionName = remember {
        runCatching {
            val pm = ctx.packageManager
            pm.getPackageInfo(ctx.packageName, 0).versionName
        }.getOrNull() ?: "—"
    }
    val versionCode = remember {
        runCatching {
            val pm = ctx.packageManager
            @Suppress("DEPRECATION")
            pm.getPackageInfo(ctx.packageName, 0).versionCode
        }.getOrNull()?.toString() ?: "—"
    }

    Scaffold(containerColor = c.bg) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .statusBarsPadding()
                .background(c.bg),
            contentPadding = PaddingValues(bottom = 32.dp)
        ) {
            // Header: title + close (matches iOS SettingsView)
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Settings", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.text)
                    Spacer(Modifier.weight(1f))
                    TRAQSIconBtn(icon = Icons.Default.Close, contentDescription = "Close", onClick = onDismiss)
                }
            }

            // Appearance
            item { SectionLabel("Appearance") }
            item {
                SettingsRow(
                    icon = Icons.Default.AutoAwesome,
                    title = "Theme & accent",
                    subtitle = "Customize colors and palette",
                    onClick = { navController.navigate(Screen.Customize.route) }
                )
            }

            // Account
            item { Spacer(Modifier.height(16.dp)) }
            item { SectionLabel("Account") }
            person?.let {
                item { SettingsDetailRow("Signed in as", it.name) }
                if (it.email.isNotEmpty()) item { SettingsDetailRow("Email", it.email) }
                if (it.role.isNotEmpty()) item { SettingsDetailRow("Role", it.role) }
            }
            item { SettingsDetailRow("Organization", orgCode.ifEmpty { "—" }) }

            // About
            item { Spacer(Modifier.height(16.dp)) }
            item { SectionLabel("About") }
            item { SettingsDetailRow("Version", versionName) }
            item { SettingsDetailRow("Build", versionCode) }

            // Sign out
            item { Spacer(Modifier.height(20.dp)) }
            item {
                Surface(
                    onClick = {
                        authManager.logout(activity)
                        onDismiss()
                        navController.navigate("login") { popUpTo(0) { inclusive = true } }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    shape = RoundedCornerShape(24.dp),
                    color = c.danger.copy(alpha = 0.10f),
                    border = BorderStroke(1.dp, c.danger.copy(alpha = 0.30f))
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 14.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Logout, null, tint = c.danger, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("SIGN OUT", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.danger, letterSpacing = 1.0.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(title: String) {
    val c = traQSColors
    Text(
        title.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        color = c.muted,
        letterSpacing = 1.4.sp,
        modifier = Modifier.padding(start = 24.dp, top = 4.dp, bottom = 8.dp)
    )
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    onClick: () -> Unit
) {
    val c = traQSColors
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
        shape = RoundedCornerShape(12.dp),
        color = c.surface,
        border = BorderStroke(1.dp, c.border)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(width = 36.dp, height = 28.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(c.accent.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, null, tint = c.accent, modifier = Modifier.size(16.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.text)
                subtitle?.let { Text(it, fontSize = 11.sp, color = c.muted) }
            }
            Icon(Icons.Default.ChevronRight, null, tint = c.muted, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun SettingsDetailRow(label: String, value: String) {
    val c = traQSColors
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 20.dp, bottom = 8.dp),
        shape = RoundedCornerShape(12.dp),
        color = c.surface,
        border = BorderStroke(1.dp, c.border)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, fontSize = 13.sp, color = c.muted)
            Spacer(Modifier.weight(1f))
            Text(value, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.text)
        }
    }
}
