import SwiftUI

// MARK: - Midnight Theme Constants
// Matches the TRAQS web app Midnight color palette exactly.

enum T {
    // Backgrounds (mutable so ThemeSettings can override at runtime)
    static var bg      = "#080d18"
    static var surface = "#0d1424"
    static var card    = "#111c30"
    static var border  = "#1a2a45"

    // Text (mutable so light themes can override)
    static var text    = "#e6ecf8"
    static var muted   = "#64748b"

    // Accent (mutable)
    static var accent  = "#3d7fff"
    static let danger  = "#f43f5e"

    // Engineering (purple accent, distinct from general accent)
    static let eng     = "#7c3aed"

    // Status colors
    static let statusNotStarted = "#94a3b8"
    static let statusPending    = "#a78bfa"
    static let statusInProgress = "#3b82f6"
    static let statusOnHold     = "#f59e0b"
    static let statusFinished   = "#10b981"

    // Priority colors
    static let priLow    = "#10b981"
    static let priMedium = "#f59e0b"
    static let priHigh   = "#f43f5e"
}
