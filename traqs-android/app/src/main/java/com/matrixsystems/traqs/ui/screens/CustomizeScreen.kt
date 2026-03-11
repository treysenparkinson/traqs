package com.matrixsystems.traqs.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.services.ThemeSettings
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import androidx.compose.foundation.border

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomizeScreen(themeSettings: ThemeSettings, onBack: () -> Unit) {
    val c = traQSColors
    val currentAccent by themeSettings.accent.collectAsState()
    val currentBgId by themeSettings.bgPresetId.collectAsState()

    Scaffold(
        containerColor = c.bg,
        topBar = {
            TopAppBar(
                title = { Text("Customize", fontWeight = FontWeight.Bold, color = c.text) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = c.accent)
                    }
                },
                actions = {
                    TextButton(onClick = { themeSettings.reset() }) {
                        Text("Reset", color = c.muted)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = c.surface)
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(c.bg),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Live preview card
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Preview", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.text)
                    val previewAccent = try { parseColor(currentAccent) } catch (_: Exception) { c.accent }
                    val preset = ThemeSettings.BG_PRESETS.firstOrNull { it.id == currentBgId } ?: ThemeSettings.BG_PRESETS.first()
                    val previewBg = try { parseColor(preset.bg) } catch (_: Exception) { c.bg }
                    val previewSurface = try { parseColor(preset.surface) } catch (_: Exception) { c.surface }
                    val previewText = try { parseColor(preset.text) } catch (_: Exception) { c.text }
                    val previewBorder = try { parseColor(preset.border) } catch (_: Exception) { c.border }
                    val previewMuted = try { parseColor(preset.muted) } catch (_: Exception) { c.muted }

                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(previewBg, RoundedCornerShape(12.dp))
                            .border(1.dp, previewBorder, RoundedCornerShape(12.dp))
                    ) {
                        // Fake nav bar
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(previewSurface, RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("TRAQS", fontWeight = FontWeight.Black, fontSize = 16.sp, color = previewAccent)
                            Box(
                                modifier = Modifier.size(28.dp).clip(CircleShape).background(previewAccent),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.AutoAwesome, null, tint = Color.White, modifier = Modifier.size(14.dp))
                            }
                        }
                        // Fake job row
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(10.dp)
                                .background(previewSurface, RoundedCornerShape(8.dp))
                                .border(1.dp, previewBorder, RoundedCornerShape(8.dp))
                                .padding(10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Sample Job #001", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = previewText)
                                Text("In Progress · 3 panels", fontSize = 11.sp, color = previewMuted)
                            }
                            Box(
                                modifier = Modifier
                                    .background(previewAccent.copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                                    .padding(horizontal = 7.dp, vertical = 3.dp)
                            ) {
                                Text("Active", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = previewAccent)
                            }
                        }
                    }
                }
            }

            // Accent color
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Accent Color", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.text)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(ThemeSettings.ACCENT_PRESETS) { hex ->
                            val color = parseColor(hex)
                            val isSelected = currentAccent == hex
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(color)
                                    .then(
                                        if (isSelected) Modifier.border(3.dp, Color.White, CircleShape)
                                        else Modifier
                                    )
                                    .clickable { themeSettings.setAccent(hex) }
                            ) {
                                if (isSelected) {
                                    Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.align(Alignment.Center).size(18.dp))
                                }
                            }
                        }
                    }
                }
            }

            // Background theme
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Background Theme", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.text)
                    ThemeSettings.BG_PRESETS.forEach { preset ->
                        val isSelected = currentBgId == preset.id
                        val bgColor = parseColor(preset.bg)
                        val textColor = parseColor(preset.text)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(bgColor, RoundedCornerShape(10.dp))
                                .border(
                                    2.dp,
                                    if (isSelected) c.accent else parseColor(preset.border),
                                    RoundedCornerShape(10.dp)
                                )
                                .clickable { themeSettings.setBgPreset(preset.id) }
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(preset.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = textColor)
                                Text(
                                    if (preset.isLight) "Light theme" else "Dark theme",
                                    fontSize = 11.sp,
                                    color = parseColor(preset.muted)
                                )
                            }
                            if (isSelected) {
                                Icon(Icons.Default.CheckCircle, null, tint = c.accent, modifier = Modifier.size(20.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}
