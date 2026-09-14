package com.matrixsystems.traqs.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

// Port of the iOS type scale (Services/Typography.swift).
//
// DM Sans throughout, five weights. Sizes and weights match iOS TTypo exactly so
// the same element is the same size on both platforms; iOS `tracking` is in
// points and Compose `letterSpacing` in sp is likewise absolute, so tracking
// values carry across 1:1 with no conversion.
//
// Where a caller needs a size other than the default, pass it — the defaults are
// the values iOS uses when it calls the helper bare.
object TTypo {
    // Brand wordmark — only the splash still sets type for this; the header uses
    // the image lockup.
    fun wordmark(size: TextUnit = 28.sp) = style(FontWeight.ExtraBold, size)

    // Display title at the top of a page. See PageTitle for the -4 tracking that
    // goes with it.
    fun h1(size: TextUnit = 32.sp) = style(FontWeight.Bold, size)

    // Hero numbers in cards.
    fun h2(size: TextUnit = 26.sp) = style(FontWeight.Bold, size)

    // Section titles, card titles.
    fun h3(size: TextUnit = 22.sp) = style(FontWeight.Bold, size)

    fun body(size: TextUnit = 15.sp) = style(FontWeight.Medium, size)
    fun bodyBold(size: TextUnit = 15.sp) = style(FontWeight.Bold, size)

    // Secondary text.
    fun sm(size: TextUnit = 14.sp) = style(FontWeight.Medium, size)
    fun smBold(size: TextUnit = 14.sp) = style(FontWeight.Bold, size)

    // Caption / chip / label. Usually uppercase with tracking — see `label`.
    fun xs(size: TextUnit = 12.sp) = style(FontWeight.SemiBold, size)
    fun xsBold(size: TextUnit = 12.sp) = style(FontWeight.Bold, size)

    // Tiny — tab labels, badges.
    fun xxs(size: TextUnit = 10.sp) = style(FontWeight.Bold, size)

    // "Mono" — DM Sans Medium standing in for the desktop product's JetBrains
    // Mono (timestamps, durations, percentages). ONE typeface app-wide; digit
    // columns stay aligned because DM Sans figures are tabular by default.
    fun mono(size: TextUnit = 12.sp) = style(FontWeight.Medium, size)
    fun monoBold(size: TextUnit = 12.sp) = style(FontWeight.Bold, size)

    // The uppercase tracked treatment iOS applies with `.tLabel(tracking:)`.
    // Compose has no textCase modifier, so CALL SITES must uppercase the string
    // themselves — this only carries the metrics.
    //
    // The tracking values in use, so a new label picks the right one rather than
    // inventing an eighth: 1.4 section headers · 1.0 in-card status labels ·
    // 0.8/0.6 button labels · 0.4 tag pills.
    fun label(size: TextUnit = 12.sp, tracking: TextUnit = 1.4.sp) =
        style(FontWeight.Bold, size).copy(letterSpacing = tracking)

    private fun style(weight: FontWeight, size: TextUnit) =
        TextStyle(fontFamily = DMSans, fontWeight = weight, fontSize = size)
}

// Tracking constants, named so the intent is readable at the call site.
object TTrack {
    val section = 1.4.sp    // SECTION HEADERS
    val status = 1.0.sp     // in-card status labels (TRACKING, PROGRESS)
    val button = 0.6.sp     // button labels
    val pill = 0.4.sp       // tag pills
}
