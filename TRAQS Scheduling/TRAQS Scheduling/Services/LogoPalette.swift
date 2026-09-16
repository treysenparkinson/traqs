import Foundation

// MARK: - The app icon's palette
//
// Sampled from the centre pixel of each bar in the shipped asset
// (`AppIcon.icon/Assets/traqs-bars-candy-v2.png`, sRGB), which landed in
// commit 241d2f7. The icon and the app are meant to be the same four colours;
// this is where that is written down once so the two cannot drift.
//
// Hex rather than Color, Foundation rather than SwiftUI, for the reason
// JobPalette gives: this has to compile wherever the test target does.

enum LogoPalette {

    static let coral = "#FF826A"   // bar 1 — top
    static let amber = "#F4B61E"   // bar 2
    static let sky   = "#41C9FA"   // bar 3 — full width, the hero
    static let green = "#1E8D6F"   // bar 4 — bottom, shortest

    /// Top → bottom, exactly as the icon draws them. `TRAQSBarsMark` indexes
    /// this positionally, so the order is the logo's geometry rather than a
    /// convenience — reordering it redraws the mark.
    static let ordered = [coral, amber, sky, green]
}
