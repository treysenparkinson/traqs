package com.matrixsystems.traqs.services

import android.content.Context
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// MARK: - Background Presets
// Mirrors iOS ThemeSettings.swift exactly: 4 neutral backgrounds, default
// is preset 100 ("White") — LIGHT canonical theme matching the wireframes.

data class BgPreset(
    val id: Int,
    val name: String,
    val bg: String,
    val surface: String,
    val card: String,
    val border: String,
    val text: String,
    val muted: String,
    val isLight: Boolean
)

class ThemeSettings(private val context: Context) : ViewModel() {

    companion object {
        // Accent presets — same order/colors as iOS ThemeSettings.accentPresets.
        val ACCENT_PRESETS = listOf(
            "#3B82F6", // Sky (default) — TRAQS Light
            "#7c3aed", // Purple
            "#10b981", // Green
            "#f59e0b", // Amber
            "#f43f5e", // Red
            "#FF1FB4", // Magenta
            "#06b6d4", // Cyan
            "#8b5cf6", // Violet
        )

        // Background presets — ONE light and ONE dark. Grey (10) and Black (12)
        // were retired: Grey sat close enough to White that the frosted surfaces
        // could not separate from it, and Black crushed the specular rim's
        // bottom lip into the page. The IDs are left unused rather than
        // renumbered so a saved server-side setting from another client still
        // resolves — anything not in this list falls back to White below.
        val BG_PRESETS = listOf(
            BgPreset(100, "White",    "#F4F6FA", "#FFFFFF", "#FFFFFF", "#E6E8EE", "#0B0B0C", "#6E6E73", true),
            BgPreset(11,  "Charcoal", "#1F1F1F", "#2A2A2A", "#333333", "#3F3F3F", "#E8E8E8", "#9CA3AF", false),
        )

        const val DEFAULT_BG_PRESET_ID = 100
        const val DEFAULT_ACCENT = "#3B82F6"

        private const val PREFS_NAME = "traqs_theme_prefs"
        private const val KEY_ACCENT = "accent"
        private const val KEY_BG_PRESET = "bg_preset"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _accent = MutableStateFlow(prefs.getString(KEY_ACCENT, DEFAULT_ACCENT) ?: DEFAULT_ACCENT)
    val accent: StateFlow<String> = _accent.asStateFlow()

    // If a saved id isn't one of the 4 current presets, fall back to White.
    // Mirrors iOS migration of older preset ids.
    private val _bgPresetId = MutableStateFlow(
        prefs.getInt(KEY_BG_PRESET, DEFAULT_BG_PRESET_ID).let { saved ->
            if (BG_PRESETS.any { it.id == saved }) saved else DEFAULT_BG_PRESET_ID
        }
    )
    val bgPresetId: StateFlow<Int> = _bgPresetId.asStateFlow()

    val currentBgPreset: BgPreset get() = BG_PRESETS.firstOrNull { it.id == _bgPresetId.value } ?: BG_PRESETS[0]

    val isLightTheme: Boolean get() = currentBgPreset.isLight

    fun setAccent(hex: String) {
        _accent.value = hex
        prefs.edit().putString(KEY_ACCENT, hex).apply()
    }

    fun setBgPreset(id: Int) {
        _bgPresetId.value = id
        prefs.edit().putInt(KEY_BG_PRESET, id).apply()
    }

    fun reset() {
        setAccent(DEFAULT_ACCENT)
        setBgPreset(DEFAULT_BG_PRESET_ID)
    }
}
