package com.matrixsystems.traqs.services

import android.content.Context
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

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
        val ACCENT_PRESETS = listOf(
            "#3d7fff", "#7c3aed", "#10b981", "#f59e0b",
            "#f43f5e", "#ec4899", "#06b6d4", "#8b5cf6"
        )

        val BG_PRESETS = listOf(
            BgPreset(0, "Midnight", "#080d18", "#0d1424", "#111c30", "#1a2a45", "#e6ecf8", "#64748b", false),
            BgPreset(1, "Navy",     "#060c1c", "#0b1228", "#0f1934", "#182748", "#e6ecf8", "#64748b", false),
            BgPreset(2, "Charcoal", "#0a0a0a", "#141414", "#1c1c1c", "#2a2a2a", "#e8e8e8", "#6b7280", false),
            BgPreset(3, "Slate",    "#0d1117", "#161b22", "#1c2128", "#30363d", "#e6edf3", "#8b949e", false),
            BgPreset(4, "Forest",   "#070f09", "#0c1a0e", "#111f14", "#1a2e1c", "#e6f0e8", "#6b8f72", false),
            BgPreset(5, "Frost",    "#ffffff", "#f8fafc", "#f1f5f9", "#e2e8f0", "#0f172a", "#64748b", true),
            BgPreset(6, "Pearl",    "#fafaf9", "#f5f5f4", "#e7e5e4", "#d6d3d1", "#1c1917", "#78716c", true),
            BgPreset(7, "Silver",   "#f8f9fa", "#f1f3f5", "#e9ecef", "#dee2e6", "#212529", "#6c757d", true),
            BgPreset(8, "Linen",    "#faf7f2", "#f5f0e8", "#ede8df", "#d9d0c5", "#1a1510", "#7a6e62", true),
        )

        private const val PREFS_NAME = "traqs_theme_prefs"
        private const val KEY_ACCENT = "accent"
        private const val KEY_BG_PRESET = "bg_preset"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _accent = MutableStateFlow(prefs.getString(KEY_ACCENT, "#3d7fff") ?: "#3d7fff")
    val accent: StateFlow<String> = _accent.asStateFlow()

    private val _bgPresetId = MutableStateFlow(prefs.getInt(KEY_BG_PRESET, 0))
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
        setAccent("#3d7fff")
        setBgPreset(0)
    }
}
