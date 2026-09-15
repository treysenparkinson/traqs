package com.matrixsystems.traqs.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

// The app's icon set, traced from the WEB app (src/TRAQS.jsx) rather than taken
// from Material.
//
// Every glyph in TRAQS.jsx is an inline Feather-style SVG: a 24-unit viewBox,
// no fill, 2-unit stroke, round caps and joins. Material's filled icons are a
// different language entirely — solid silhouettes against thin open strokes —
// so the Android app read as a different product next to the site and the iOS
// build, both of which use these.
//
// The path data below is copied VERBATIM out of TRAQS.jsx and parsed with
// `addPathNodes`, so these are the same curves the site draws, not a redraw of
// them. When an icon changes on the web, copy the new `d` string here; do not
// eyeball a replacement.
//
// Stroke and fill are declared black and recoloured by `Icon(tint = …)`, which
// applies a ColorFilter over the whole vector.

private val Ink = SolidColor(Color.Black)

/**
 * A stroked Feather glyph.
 *
 * @param sw stroke width in viewport units — 2 for almost everything; the chat
 *   bubble uses 1.85 with a tighter viewBox, see [TIcons.Chat].
 * @param vb viewport size. The chat bubble alone deviates (22.2, centred on
 *   12,12) because a circle reads smaller than the square-ish glyphs beside it
 *   at the same bounding box; the tighter box scales it ~8% larger.
 * @param off viewBox origin offset, applied as a translation.
 */
private fun feather(
    name: String,
    vararg d: String,
    sw: Float = 2f,
    vb: Float = 24f,
    off: Float = 0f,
    filled: List<String> = emptyList(),
): ImageVector = ImageVector.Builder(
    name = name,
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = vb,
    viewportHeight = vb,
).apply {
    addGroup(translationX = -off, translationY = -off)
    // Solid marks first so the strokes draw over them, matching the SVG's
    // document order.
    filled.forEach { addPath(addPathNodes(it), fill = Ink) }
    d.forEach {
        addPath(
            addPathNodes(it),
            stroke = Ink,
            strokeLineWidth = sw,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
    clearGroup()
}.build()

object TIcons {
    // Sidebar "dashboard" — a house with a doorway.
    val Home: ImageVector = feather(
        "home",
        "M3 9.3L12 3l9 6.3V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
        "M9.2 21 L9.2 12.8 L14.8 12.8 L14.8 21",
    )

    // Sidebar "tasks" — three bulleted rules, the bullets solid. The third rule
    // is deliberately short (8.2 against 12.2), which is what makes it read as a
    // list rather than a menu glyph.
    val Jobs: ImageVector = feather(
        "jobs",
        "M8.8 3.9h12.2", "M8.8 12h12.2", "M8.8 20.1h8.2",
        filled = listOf(
            "M5.4 3.9a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z",
            "M5.4 12a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z",
            "M5.4 20.1a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z",
        ),
    )

    // Sidebar "timestamp" — a clock face reading roughly 12:18.
    val Clock: ImageVector = feather(
        "clock",
        "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
        "M12 6.6 L12 12 L15.6 13.8",
    )

    // Sidebar "analytics" — three bars, tallest in the middle.
    val Analytics: ImageVector = feather(
        "analytics",
        "M18.4 21V9.75", "M12 21V3", "M5.6 21v-6.75",
    )

    // Sidebar "messages" — a ROUND bubble with a floating tail. Deliberately not
    // the rounded-rectangle bubble used elsewhere in the web app, and not the
    // iOS tab bar's SF Symbol: the round one is the wanted look in the nav.
    val Chat: ImageVector = feather(
        "chat",
        "M21 11.5c0 4.29-4.04 7.76-9 7.76-1.08 0-2.12-.17-3.08-.47L4.2 20.8l1.2-3.46C3.9 15.8 3 13.8 3 11.5 3 7.3 7 3.8 12 3.8s9 3.47 9 7.7z",
        sw = 1.85f, vb = 22.2f, off = 0.9f,
    )

    val Search: ImageVector = feather(
        "search",
        "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z",
        "M21 21 L16.65 16.65",
    )

    val Plus: ImageVector = feather("plus", "M12 5v14", "M5 12h14")

    val Close: ImageVector = feather("close", "M18 6 L6 18", "M6 6 L18 18")

    val Gear: ImageVector = feather(
        "gear",
        "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
        "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    )

    // Sidebar "schedule" — a calendar tile. The web draws today's date INSIDE
    // it as live text; that is not expressible as a static vector, so this is
    // the tile with a plain rule where the number would sit.
    val Calendar: ImageVector = feather(
        "calendar",
        "M3 8.2a5.2 5.2 0 0 1 5.2-5.2h7.6A5.2 5.2 0 0 1 21 8.2v7.6a5.2 5.2 0 0 1-5.2 5.2H8.2A5.2 5.2 0 0 1 3 15.8z",
        "M3.3 8.4h17.4",
    )

    // Sidebar "employees".
    val Team: ImageVector = feather(
        "team",
        "M13.8 7.4a4.4 4.4 0 1 1-8.8 0 4.4 4.4 0 0 1 8.8 0z",
        "M3 21a6.4 6.4 0 0 1 12.8 0",
        "M15.6 5.6a3.1 3.1 0 0 1 0 6.2",
        "M17.2 14.6a6.2 6.2 0 0 1 3.8 6.4",
    )

    val ChevronRight: ImageVector = feather("chevronRight", "M9 18 L15 12 L9 6")
    val ChevronDown: ImageVector = feather("chevronDown", "M6 9 L12 15 L18 9")
    val ChevronLeft: ImageVector = feather("chevronLeft", "M15 18 L9 12 L15 6")
    val ChevronUp: ImageVector = feather("chevronUp", "M18 15 L12 9 L6 15")

    // ── The rest of the Feather set the app draws on ──────────────────────
    // Standard Feather paths, same library the web app pulls its inline SVGs
    // from. Keep new additions inside the 3..21 box so they optically match the
    // sidebar glyphs above — raw Feather paths disagree wildly on extent.

    val ArrowLeft: ImageVector = feather("arrowLeft", "M19 12H5", "M12 19 L5 12 L12 5")
    val ArrowRight: ImageVector = feather("arrowRight", "M5 12h14", "M12 5 L19 12 L12 19")
    val ArrowUp: ImageVector = feather("arrowUp", "M12 19V5", "M5 12 L12 5 L19 12")
    val ArrowDown: ImageVector = feather("arrowDown", "M12 5v14", "M19 12 L12 19 L5 12")

    val Check: ImageVector = feather("check", "M20 6 L9 17 L4 12")

    // Backspace (feather "delete"). NOT an arrow: on the PIN pad this rubs out
    // the last digit, and a plain left arrow beside the pad's cancel X read as a
    // second way to go back rather than as an edit key.
    val Backspace: ImageVector = feather(
        "backspace",
        "M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z",
        "M18 9l-6 6",
        "M12 9l6 6"
    )
    val CheckCircle: ImageVector = feather(
        "checkCircle",
        "M22 11.08V12a10 10 0 1 1-5.93-9.14",
        "M22 4 L12 14.01 L9 11.01",
    )
    val XCircle: ImageVector = feather(
        "xCircle",
        "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z", "M15 9l-6 6", "M9 9l6 6",
    )
    val Circle: ImageVector = feather("circle", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z")
    val Minus: ImageVector = feather("minus", "M5 12h14")

    val Play: ImageVector = feather("play", "M5 3 L19 12 L5 21 Z")
    val PlayCircle: ImageVector = feather(
        "playCircle",
        "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z", "M10 8 L16 12 L10 16 Z",
    )
    val Square: ImageVector = feather("square", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z")
    val Pause: ImageVector = feather("pause", "M6 4h4v16H6z", "M14 4h4v16h-4z")

    val Lock: ImageVector = feather(
        "lock",
        "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
        "M7 11V7a5 5 0 0 1 10 0v4",
    )
    val Edit: ImageVector = feather("edit", "M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z")
    val Trash: ImageVector = feather(
        "trash",
        "M3 6h18",
        "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    )
    val Send: ImageVector = feather("send", "M22 2 L11 13", "M22 2 L15 22 L11 13 L2 9 Z")
    val Mail: ImageVector = feather(
        "mail",
        "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
        "M22 6 L12 13 L2 6",
    )
    val Phone: ImageVector = feather(
        "phone",
        "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
    )

    val User: ImageVector = feather(
        "user",
        "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",
        "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
    )
    val UserPlus: ImageVector = feather(
        "userPlus",
        "M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2",
        "M12.5 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
        "M20 8v6", "M23 11h-6",
    )
    val Briefcase: ImageVector = feather(
        "briefcase",
        "M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z",
        "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
    )
    val Layers: ImageVector = feather(
        "layers",
        "M12 2 L2 7 L12 12 L22 7 Z", "M2 17 L12 22 L22 17", "M2 12 L12 17 L22 12",
    )
    val Shield: ImageVector = feather("shield", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z")
    val Tool: ImageVector = feather(
        "tool",
        "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
    )
    val Coffee: ImageVector = feather(
        "coffee",
        "M18 8h1a4 4 0 0 1 0 8h-1",
        "M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z",
        "M6 1v3", "M10 1v3", "M14 1v3",
    )
    // Lunch. Feather has no cutlery glyph and the web app has no lunch icon of
    // its own, so this is drawn to the same idea as the iOS `fork.knife`
    // symbol — a three-tine fork beside a knife. Lunch and Break must not share
    // the coffee cup: they are different punches (lunch stops paid time, a
    // break does not) and one glyph for both hides that.
    val Utensils: ImageVector = feather(
        "utensils",
        "M7 3v7a3 3 0 0 0 3 3v8", "M7 3v5", "M10 3v5",
        "M17 3c-1.3 1.6-2 3.7-2 5.8 0 1.6.8 2.9 2 3.2V21",
    )

    val Eye: ImageVector = feather(
        "eye",
        "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z",
        "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    )
    val EyeOff: ImageVector = feather(
        "eyeOff",
        "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24",
        "M1 1l22 22",
    )
    val LogOut: ImageVector = feather(
        "logOut",
        "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
        "M16 17 L21 12 L16 7", "M21 12H9",
    )
    // The AI / "Ask TRAQS" spark. Feather has no sparkles glyph; the web uses a
    // lightning bolt for its AI affordances, so this is `zap`.
    val Spark: ImageVector = feather("spark", "M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 Z")
}
