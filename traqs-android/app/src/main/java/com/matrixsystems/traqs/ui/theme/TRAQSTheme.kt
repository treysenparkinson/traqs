package com.matrixsystems.traqs.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import com.matrixsystems.traqs.R
import com.matrixsystems.traqs.services.BgPreset
import com.matrixsystems.traqs.services.ThemeSettings

private val fontProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)

private val dmSans = GoogleFont("DM Sans")

private val dmSansFamily = androidx.compose.ui.text.font.FontFamily(
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.Normal),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.Medium),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.SemiBold),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.Bold),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.Black),
)

private val dmSansTypography = Typography(
    displayLarge = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Bold),
    displayMedium = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Bold),
    displaySmall = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Bold),
    headlineLarge = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Bold),
    headlineMedium = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Normal),
    bodyMedium = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Normal),
    bodySmall = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontFamily = dmSansFamily, fontWeight = FontWeight.Normal),
)

// Colors derived at runtime from ThemeSettings — similar to T.* in iOS
data class TRAQSColors(
    val bg: Color,
    val surface: Color,
    val card: Color,
    val border: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val isLight: Boolean = false,
    val danger: Color = Color(0xFFF43F5E),
    val eng: Color = Color(0xFF7C3AED),
    val statusNotStarted: Color = Color(0xFF94A3B8),
    val statusPending: Color = Color(0xFFA78BFA),
    val statusInProgress: Color = Color(0xFF3B82F6),
    val statusOnHold: Color = Color(0xFFF59E0B),
    val statusFinished: Color = Color(0xFF10B981),
    val priLow: Color = Color(0xFF10B981),
    val priMedium: Color = Color(0xFFF59E0B),
    val priHigh: Color = Color(0xFFF43F5E)
)

val LocalTRAQSColors = staticCompositionLocalOf {
    TRAQSColors(
        bg = Color(0xFF080D18),
        surface = Color(0xFF0D1424),
        card = Color(0xFF111C30),
        border = Color(0xFF1A2A45),
        text = Color(0xFFE6ECF8),
        muted = Color(0xFF64748B),
        accent = Color(0xFF3D7FFF)
    )
}

fun parseColor(hex: String): Color {
    return try {
        val clean = hex.trimStart('#')
        val value = clean.toLong(16)
        when (clean.length) {
            6 -> Color(0xFF000000 or value)
            8 -> Color(value)
            else -> Color.Gray
        }
    } catch (_: Exception) { Color.Gray }
}

fun BgPreset.toTRAQSColors(accent: String) = TRAQSColors(
    bg = parseColor(bg),
    surface = parseColor(surface),
    card = parseColor(card),
    border = parseColor(border),
    text = parseColor(text),
    muted = parseColor(muted),
    accent = parseColor(accent),
    isLight = isLight
)

@Composable
fun TRAQSTheme(
    themeSettings: ThemeSettings,
    content: @Composable () -> Unit
) {
    val accentHex by themeSettings.accent.collectAsState()
    val bgPresetId by themeSettings.bgPresetId.collectAsState()

    val preset = ThemeSettings.BG_PRESETS.firstOrNull { it.id == bgPresetId } ?: ThemeSettings.BG_PRESETS[0]
    val traQSColors = preset.toTRAQSColors(accentHex)

    val accentColor = traQSColors.accent
    val colorScheme = if (preset.isLight) {
        lightColorScheme(
            primary = accentColor,
            background = traQSColors.bg,
            surface = traQSColors.surface,
            onBackground = traQSColors.text,
            onSurface = traQSColors.text,
        )
    } else {
        darkColorScheme(
            primary = accentColor,
            background = traQSColors.bg,
            surface = traQSColors.surface,
            onBackground = traQSColors.text,
            onSurface = traQSColors.text,
        )
    }

    CompositionLocalProvider(LocalTRAQSColors provides traQSColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = dmSansTypography,
            content = content
        )
    }
}

// Convenient accessor
val traQSColors: TRAQSColors
    @Composable get() = LocalTRAQSColors.current
