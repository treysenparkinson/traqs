package com.matrixsystems.traqs.ui.screens

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.navigationBarsPadding
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
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.weight(1f))

            // Logo centered at the top half
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                TRAQSLogo(height = 80.dp)
                Text(
                    text = "Scheduling & Production Management",
                    fontSize = 14.sp,
                    color = c.muted,
                    textAlign = TextAlign.Center
                )
            }

            Spacer(Modifier.weight(1f))

            // Sign in button
            Column(
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(bottom = 32.dp),
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
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.accent)
                    ) {
                        Text(
                            text = "Sign In",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
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
