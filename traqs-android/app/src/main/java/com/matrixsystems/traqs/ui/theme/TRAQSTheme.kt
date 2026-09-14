package com.matrixsystems.traqs.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.matrixsystems.traqs.R
import com.matrixsystems.traqs.services.BgPreset
import com.matrixsystems.traqs.services.ThemeSettings

// DM Sans typography — matches iOS TFontName entries (Regular/Medium/SemiBold/Bold/ExtraBold).
private val fontProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)

private val dmSans = GoogleFont("DM Sans")

// The five weights iOS bundles, and the SAME five: Regular / Medium / SemiBold /
// Bold / ExtraBold.
//
// The last one was registered as Black (900). DM Sans ships ExtraBold at 800, so
// asking for 900 made the provider fall back to the nearest face it had — which
// is why the wordmark and page titles came out a half-weight lighter here than
// on iOS.
internal val DMSans = androidx.compose.ui.text.font.FontFamily(
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.Normal),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.Medium),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.SemiBold),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.Bold),
    Font(googleFont = dmSans, fontProvider = fontProvider, weight = FontWeight.ExtraBold),
)

private val dmSansFamily = DMSans

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

// Mirrors iOS T color tokens (TRAQSTheme.swift). Brand-locked tokens stay constant;
// surface tokens are theme-driven by ThemeSettings.
data class TRAQSColors(
    val bg: Color,
    val surface: Color,
    val card: Color,
    val border: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val isLight: Boolean = true,
    // Brand-locked semantic colors — match iOS T.* values exactly.
    val danger: Color = Color(0xFFEF4444),           // T.red / T.danger
    val eng: Color = Color(0xFFA78BFA),              // T.eng (lavender)
    val magenta: Color = Color(0xFFFF1FB4),          // T.magenta
    val cyan: Color = Color(0xFF06B6D4),             // T.cyan
    val yellow: Color = Color(0xFFEAB308),           // T.yellow
    val lavender: Color = Color(0xFFA78BFA),         // T.lavender
    val amber: Color = Color(0xFFF59E0B),            // T.amber
    val green: Color = Color(0xFF10B981),            // T.green
    val orange: Color = Color(0xFFF97316),           // T.orange
    val red: Color = Color(0xFFEF4444),              // T.red
    val statusNotStarted: Color = Color(0xFF94A3B8),
    val statusPending: Color = Color(0xFFA78BFA),
    val statusInProgress: Color = Color(0xFF3B82F6), // mirrors accent
    val statusOnHold: Color = Color(0xFFEAB308),
    val statusFinished: Color = Color(0xFF10B981),
    val priLow: Color = Color(0xFF10B981),
    val priMedium: Color = Color(0xFFEAB308),
    val priHigh: Color = Color(0xFFEF4444),

    // ── Signature gradient (DERIVED from accent — never hardcode at call sites) ──
    val gradStart: Color = Color(0xFF3B82F6),
    val gradEnd: Color = Color(0xFF1E5FBF),
    val ctaGlow: Color = Color(0xFF3B82F6),
    val glowBlob: Color = Color(0xFF1E5FBF),

    // ── Specular rim — the app-wide glass edge ──
    //
    // A glare across the top lip, a darker band down the sides, then the bottom
    // lip lit again: light entering the top of a bubble of glass and bouncing
    // back out of the bottom. Top AND bottom lit is what makes a surface read as
    // glass rather than a rectangle with a highlight on it.
    //
    // Preset-driven, because one set of numbers cannot serve a near-white page
    // and a near-black one: on light presets the lips run near-full white and
    // the side band is a definite grey, since a subtle edge on a near-white card
    // is no edge at all.
    val rimTop: Float = 0.95f,
    val rimBot: Float = 0.80f,
    val rimSide: Color = Color(0xFFA6ADB9),
    val rimLip: Float = 0.20f,
    val rimWidth: Dp = 1.4.dp,

    // ── Nav bar paint (the floating tab pill) ──
    //
    // The pill gets its OWN tint rather than sharing the card tint, because it
    // is the one surface that has to hold five small glyphs legible against
    // whatever page is drifting underneath it. Each preset pushes the bar AWAY
    // from its page — near-solid white on White, near-black on Charcoal — so the
    // icons read at full contrast either way.
    val navTint: Color = Color(0xFFFFFFFF),
    val navTintOpacity: Float = 0.82f,
    val navSolid: Color = Color(0xFFFFFFFF),

    // Chart tracks. Preset-driven: a single mid-grey read as a dirty smudge on
    // light surfaces and vanished into dark ones.
    val progressTrack: Color = Color(0xFFF7F9FD),

    // ── Bright semantic pills (tint bg + same-hue text) ──
    val pillIndigoBg: Color = Color(0xFFE7E3FB), val pillIndigoFg: Color = Color(0xFF6B5BE0),
    val pillAmberBg: Color = Color(0xFFFBEFD6), val pillAmberFg: Color = Color(0xFFC9881F),
    val pillGreenBg: Color = Color(0xFFD8F2DE), val pillGreenFg: Color = Color(0xFF2F9E54),
    val pillNeutralBg: Color = Color(0xFFECEDF2), val pillNeutralFg: Color = Color(0xFF8A8A95),
) {
    // Legible ink for content sitting on a solid accent fill.
    val onAccent: Color get() = accent.readableText

    // Legible ink for content on the brand gradient. Judged from the AVERAGE
    // brightness of the two stops so the pick is right whether the content rides
    // the light end or the dark end.
    val onGradient: Color
        get() = if ((gradStart.perceivedBrightness + gradEnd.perceivedBrightness) / 2 > 140)
            Color.Black else Color.White

    // Neutral control fill for something sitting ON a card — a keypad key, a
    // disabled button. Ink at low alpha rather than a fixed grey, so it darkens a
    // light surface and lightens a dark one.
    val controlFill: Color get() = text.copy(alpha = 0.10f)
    val controlHairline: Color get() = text.copy(alpha = 0.07f)

    val brandGradient: List<Color> get() = listOf(gradStart, gradEnd)
}

// Default = iOS "White" preset (LIGHT canonical theme).
val LocalTRAQSColors = staticCompositionLocalOf {
    TRAQSColors(
        bg = Color(0xFFF4F6FA),
        surface = Color(0xFFFFFFFF),
        card = Color(0xFFFFFFFF),
        border = Color(0xFFE6E8EE),
        text = Color(0xFF0B0B0C),
        muted = Color(0xFF6E6E73),
        accent = Color(0xFF3B82F6),
        isLight = true,
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

fun BgPreset.toTRAQSColors(accent: String): TRAQSColors {
    // statusInProgress should mirror the accent (matches iOS T.statusInProgress).
    val accentColor = parseColor(accent)
    val end = deriveGradientEnd(accentColor)
    return TRAQSColors(
        bg = parseColor(bg),
        surface = parseColor(surface),
        card = parseColor(card),
        border = parseColor(border),
        text = parseColor(text),
        muted = parseColor(muted),
        accent = accentColor,
        isLight = isLight,
        statusInProgress = accentColor,
        gradStart = accentColor,
        gradEnd = end,
        ctaGlow = accentColor,
        glowBlob = end,
        // Same rim shape both ways; what changes is how hard each part works.
        // See the rim block on TRAQSColors — mirrors iOS applyRimToT.
        rimTop = if (isLight) 0.95f else 0.70f,
        rimBot = if (isLight) 0.80f else 0.50f,
        rimSide = if (isLight) Color(0xFFA6ADB9) else Color(0xFF151515),
        rimLip = if (isLight) 0.20f else 0.18f,
        rimWidth = if (isLight) 1.4.dp else 1.2.dp,
        // Mirrors iOS applyNavToT. Opacities run higher than iOS throughout
        // because there is no backdrop blur under them here.
        navTint = if (isLight) Color(0xFFFFFFFF) else Color(0xFF101010),
        navTintOpacity = if (isLight) 0.82f else 0.78f,
        navSolid = if (isLight) Color(0xFFFFFFFF) else Color(0xFF171717),
        progressTrack = if (isLight) Color(0xFFF7F9FD) else Color(0xFF2E2E2E),
        pillIndigoBg = if (isLight) Color(0xFFE7E3FB) else Color(0xFF322C4D),
        pillIndigoFg = if (isLight) Color(0xFF6B5BE0) else Color(0xFFA99BF5),
        pillAmberBg = if (isLight) Color(0xFFFBEFD6) else Color(0xFF473A22),
        pillAmberFg = if (isLight) Color(0xFFC9881F) else Color(0xFFE8B45C),
        pillGreenBg = if (isLight) Color(0xFFD8F2DE) else Color(0xFF1F3D2B),
        pillGreenFg = if (isLight) Color(0xFF2F9E54) else Color(0xFF5CC57F),
        pillNeutralBg = if (isLight) Color(0xFFECEDF2) else Color(0xFF2C2C30),
        pillNeutralFg = if (isLight) Color(0xFF8A8A95) else Color(0xFF9A9AA4),
    )
}

@Composable
fun TRAQSTheme(
    themeSettings: ThemeSettings,
    content: @Composable () -> Unit
) {
    val accentHex by themeSettings.accent.collectAsState()
    val bgPresetId by themeSettings.bgPresetId.collectAsState()

    val preset = ThemeSettings.BG_PRESETS.firstOrNull { it.id == bgPresetId } ?: ThemeSettings.BG_PRESETS[0]
    val traQSColors = preset.toTRAQSColors(accentHex)

    val colorScheme = if (preset.isLight) {
        lightColorScheme(
            primary = traQSColors.accent,
            background = traQSColors.bg,
            surface = traQSColors.surface,
            onBackground = traQSColors.text,
            onSurface = traQSColors.text,
        )
    } else {
        darkColorScheme(
            primary = traQSColors.accent,
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
