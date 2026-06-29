import SwiftUI

// MARK: - TRAQS Icon Set
// Map the desktop's Lucide-style icon names to SF Symbols of similar geometry.
// First-pass uses SF Symbols (system, scaled, stroked); we can replace with
// custom Path shapes later if specific glyphs need exact parity.

enum TIcon: String {
    case jobs, schedule, hours, stats, chat
    case search, plus, chev, chevDown, filter
    case pin, bolt, play, pause
    case dot, check, arrowUp, arrowDown
    case mic, paperclip, settings, send
    case person, map, list, cal, sparkle, bell, signOut
    case clients, team
    case select, trash, admin
    case gantt

    var sfName: String {
        switch self {
        case .jobs:      return "briefcase"
        case .schedule:  return "calendar"
        case .hours:     return "clock"
        case .stats:     return "chart.bar"
        case .chat:      return "message"
        case .search:    return "magnifyingglass"
        case .plus:      return "plus"
        case .chev:      return "chevron.right"
        case .chevDown:  return "chevron.down"
        case .filter:    return "line.3.horizontal.decrease"
        case .pin:       return "pin.fill"
        case .bolt:      return "bolt.fill"
        case .play:      return "play.fill"
        case .pause:     return "pause.fill"
        case .dot:       return "circle.fill"
        case .check:     return "checkmark"
        case .arrowUp:   return "arrow.up"
        case .arrowDown: return "arrow.down"
        case .mic:       return "mic"
        case .paperclip: return "paperclip"
        case .settings:  return "gearshape"
        case .send:      return "paperplane.fill"
        case .person:    return "person"
        case .map:       return "map"
        case .list:      return "list.bullet"
        case .cal:       return "calendar"
        case .sparkle:   return "sparkles"
        case .bell:      return "bell"
        case .signOut:   return "rectangle.portrait.and.arrow.right"
        case .clients:   return "building.2"
        case .team:      return "person.2"
        case .select:    return "checkmark.circle"
        case .trash:     return "trash"
        case .admin:     return "shield.lefthalf.filled"
        case .gantt:     return "chart.bar.xaxis"
        }
    }
}

struct TIconView: View {
    let icon: TIcon
    var size: CGFloat = 18
    var color: Color = Color(hex: T.ink)
    /// Roughly map stroke-weight semantics from the desktop SVG icons (1.5–2.0) onto
    /// SwiftUI symbol weight. SF Symbols don't have arbitrary stroke widths but
    /// `.regular` ↔ ~1.5, `.semibold` ↔ ~1.8, `.bold` ↔ ~2.0.
    var weight: Font.Weight = .medium

    var body: some View {
        // The gantt glyph is hand-drawn: three vertical bars side by side,
        // nudged up/down so they don't share a baseline. No axis line.
        if icon == .gantt {
            GanttGlyph(size: size, color: color)
        } else {
            Image(systemName: icon.sfName)
                .font(.system(size: size, weight: weight))
                .foregroundStyle(color)
        }
    }
}

// MARK: - Gantt glyph
// Three equal-length vertical bars set side by side and nudged up/down so they
// don't line up on a common baseline. No axis line.

struct GanttGlyph: View {
    var size: CGFloat = 18
    var color: Color = Color(hex: T.ink)

    /// Vertical offset per bar (fraction of `size`), left → right. Positive is
    /// down; the gentle stagger keeps the bars from sharing a baseline.
    private let offsets: [CGFloat] = [0.09, -0.02, -0.11]

    var body: some View {
        let barW = size * 0.15
        let barH = size * 0.50
        let spacing = size * 0.13
        HStack(spacing: spacing) {
            ForEach(offsets.indices, id: \.self) { i in
                Capsule(style: .continuous)
                    .fill(color)
                    .frame(width: barW, height: barH)
                    .offset(y: size * offsets[i])
            }
        }
        .frame(width: size, height: size)
    }
}
