package com.matrixsystems.traqs.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import com.matrixsystems.traqs.ui.theme.traQSColors
import kotlinx.coroutines.delay

// iOS-exact splash: static wordmark, 0.7s hold, then 0.45s ease-in fade.
// Total = 1.2s before onFinished. Matches SplashView.swift line-for-line.

@Composable
fun SplashScreen(onFinished: () -> Unit) {
    val c = traQSColors
    val overallOpacity = remember { Animatable(1f) }

    LaunchedEffect(Unit) {
        delay(700)
        overallOpacity.animateTo(targetValue = 0f, animationSpec = tween(450, easing = EaseIn))
        onFinished()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(c.bg)
            .alpha(overallOpacity.value),
        contentAlignment = Alignment.Center
    ) {
        TRAQSLogo(height = 80.dp)
    }
}
