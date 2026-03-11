package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.ui.theme.traQSColors

@Composable
fun LoadingScreen() {
    val c = traQSColors
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(c.bg),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            TRAQSLogo(
                useDefaultSize = false,
                modifier = Modifier
                    .fillMaxWidth(0.75f)
                    .aspectRatio(225f / 40f)
            )
            Text(
                "Scheduling & Production Management",
                fontSize = 13.sp,
                color = c.muted
            )
            Spacer(Modifier.height(8.dp))
            CircularProgressIndicator(
                color = c.accent,
                modifier = Modifier.size(28.dp),
                strokeWidth = 3.dp
            )
        }
    }
}
