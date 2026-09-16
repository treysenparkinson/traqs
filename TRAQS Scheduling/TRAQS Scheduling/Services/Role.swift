import Foundation

// MARK: - Colour by what a thing MEANS
//
// The app has always had one accent, and every accented control took it. That
// is right for chrome and for "the primary action on this screen", and wrong
// for controls whose meaning is more specific than "primary" — which is why
// `GlassCTA` already carried a `tint:` override before this table existed:
//
//     "A STATE-coloured button passes its own instead: Clock Out and STOP are
//      red because red is what they mean, and tinting them with the accent
//      would turn 'end this' into just another blue button."
//
// This generalises that one precedent into four. The colours are the app
// icon's own bars, so a screen's colour is a brand colour rather than an
// invention — see `LogoPalette`.
//
// Hex rather than Color, and Foundation rather than SwiftUI, for the reason
// LogoPalette and JobPalette give: this has to compile wherever the test
// target and the macOS target do.

enum Role {

    /// Chrome: the tab bar, page headers, the liquid wash behind everything.
    ///
    /// The same value as the default accent, deliberately. Chrome is what the
    /// accent was always for, so `nav` is not an override at all — it is the
    /// accent, named, so a call site can say which of the two it means.
    static let nav = LogoPalette.sky

    /// Jobs: the clock-in and log-time controls, job popups, job detail and
    /// edit, scheduling a job. Anything whose subject is a JOB.
    static let job = LogoPalette.amber

    /// The calendar: gantt, reschedule, date selection. Anything whose subject
    /// is WHEN rather than what.
    static let calendar = LogoPalette.coral

    /// Status: the pills that say where something stands.
    ///
    /// Note this is the RESTING colour for status chrome, not a replacement for
    /// the per-status ramp — a pill still colours by which status it shows, and
    /// that ramp lives in `JobPalette`. Losing it would mean you could no longer
    /// spot a stuck job in a list without reading every label.
    static let status = LogoPalette.green
}
