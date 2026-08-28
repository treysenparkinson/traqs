import Foundation

// MARK: - What a status and a priority look like
//
// `DEFAULT_STA_C` / `DEFAULT_STA_ICON` / `DEFAULT_PRI_C` (TRAQS.jsx:166-170).
//
// These are the DEFAULTS. The web lets an org edit its own status and priority
// lists, and the live ones shadow these as `STA_C`/`PRI_C` inside the component
// (:5072). Nothing here reads org settings yet, so a renamed status will fall
// back — which is the same fallback the web takes (`STA_C[s] || T.textDim`) and
// is why the accessor returns nil rather than a colour of its own invention.
//
// Shared rather than Mac-only: iOS draws status pills too, and a second copy of
// this table is how the two start disagreeing about what "On Hold" looks like.

extension JobStatus {

    /// `DEFAULT_STA_C`. Hex, not a Color, so this file needs no SwiftUI and can
    /// live where the test target compiles.
    var hex: String {
        switch self {
        case .notStarted: return "#94a3b8"
        case .pending:    return "#a78bfa"
        case .inProgress: return "#3b82f6"
        case .onHold:     return "#f59e0b"
        case .finished:   return "#10b981"
        }
    }

    /// `DEFAULT_STA_ICON`, and the web's reason for the odd choice of glyphs:
    /// "All emblems drawn from the same geometric-circle family (U+25CB-U+25D5)
    /// so they render at a uniform size; a fill progression reads as increasing
    /// status." Any other symbol set breaks the alignment of the pill's icon slot.
    var emblem: String {
        switch self {
        case .notStarted: return "\u{25CB}"   // ○
        case .pending:    return "\u{25D4}"   // ◔
        case .inProgress: return "\u{25D1}"   // ◑
        case .onHold:     return "\u{25D5}"   // ◕
        case .finished:   return "\u{25CF}"   // ●
        }
    }
}

extension Priority {
    /// `DEFAULT_PRI_C`.
    var hex: String {
        switch self {
        case .low:    return "#10b981"
        case .medium: return "#f59e0b"
        case .high:   return "#f43f5e"
        }
    }
}

// MARK: - The progress ramp
//
// `pctRampColor` / `pctBarWidth` (TRAQS.jsx:683).

enum ProgressRamp {

    /// `PCT_OVERDUE` — amber, and the web's note on why it needs no status check:
    /// "Above 100 the work is over estimate and still open; completion pins to
    /// exactly 100."
    static let overdue = "#f59e0b"

    /// `belowForty` is passed in because the callers differ: the Jobs grid uses
    /// slate for a barely-started job, where a red would read as a failure.
    static func hex(_ pct: Int, belowForty: String) -> String {
        if pct > 100 { return overdue }
        if pct >= 80 { return "#10b981" }
        if pct >= 40 { return "#f59e0b" }
        return belowForty
    }

    /// "Bars stop at full; the number carries the overrun."
    static func barFraction(_ pct: Int) -> Double {
        Double(min(100, max(0, pct))) / 100
    }
}
