package com.matrixsystems.traqs.ui.screens

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.services.AuthManager
import com.matrixsystems.traqs.ui.theme.traQSColors

@Composable
fun LoginScreen(
    authManager: AuthManager,
    activity: Activity,
    onLoginSuccess: () -> Unit
) {
    val c = traQSColors
    val isAuthenticated by authManager.isAuthenticated.collectAsState()
    val isLoading by authManager.isLoading.collectAsState()
    val error by authManager.error.collectAsState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) onLoginSuccess()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(c.bg)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.weight(1f))

            // Logo + tagline
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                TRAQSLogo(height = 80.dp)
                Text(
                    text = "Scheduling & Production Management",
                    fontSize = 13.sp,
                    color = c.muted,
                    textAlign = TextAlign.Center,
                    letterSpacing = 0.8.sp
                )
            }

            Spacer(Modifier.weight(1f))

            // Sign in button (capsule, sky accent — matches iOS LoginView)
            Column(
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(bottom = 48.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (isLoading) {
                    CircularProgressIndicator(color = c.accent, modifier = Modifier.size(36.dp))
                } else {
                    Button(
                        onClick = { authManager.login(activity) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        shape = RoundedCornerShape(28.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                    ) {
                        Icon(Icons.Default.Lock, null, tint = Color.White, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = "Sign in with Auth0",
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            color = Color.White
                        )
                    }
                }

                error?.let {
                    Text(
                        text = it,
                        color = c.danger,
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center
                    )
                }
            }
        }
    }
}
