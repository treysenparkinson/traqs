import Foundation

// MARK: - Types the state layer owns
//
// These lived in the Views layer while `AppState` and `AppNav` already stored
// and returned them, which meant the state layer depended UPWARD on the views.
// That went unnoticed while there was one app; the macOS app compiles this same
// Services directory without any of those view files, and the coupling surfaced
// immediately as "cannot find type in scope".
//
// Only the data moved. Anything that needs a `TIcon`, a `TagKind` or a colour is
// still declared beside the view that draws it, as an extension — see
// MainTabView, ClockActionBanner and TasksView.

/// The iOS tab bar's five tabs. Stored on `AppNav.selected`, which push deep
/// links write to, so it is navigation state rather than a view detail.
enum TTab: Int, CaseIterable, Hashable {
    // Home is the default landing tab (a daily debrief). The Jobs tab subsumes
    // the old Schedule tab: it toggles between list and gantt via `AppNav.jobsMode`.
    case home, jobs, hours, stats, chat

    var label: String {
        switch self {
        case .home:     return "Home"
        case .jobs:     return "Jobs"
        case .hours:    return "Time Clock"
        case .stats:    return "Analytics"
        case .chat:     return "Messages"
        }
    }
}

/// Derived from the person's shift time-clock (activeClockIn + its lunch/break
/// events) — computed by AppState, shown by whoever wants it.
enum ShiftStatus {
    case offline, clockedIn, lunch, onBreak

    var label: String {
        switch self {
        case .offline:   return "Offline"
        case .clockedIn: return "Clocked in"
        case .lunch:     return "Lunch"
        case .onBreak:   return "Break"
        }
    }
    var dot: Bool { self != .offline }
}

/// Which lunch/break transition just happened. Raised by the time-clock actions,
/// so it is state the banner reads rather than state the banner owns.
enum ClockActionBannerKind: Equatable {
    case lunchStarted, lunchEnded, breakStarted, breakEnded

    /// The dominant word — the thing they're meant to read at a glance.
    var word: String {
        switch self {
        case .lunchStarted, .lunchEnded: return "LUNCH"
        case .breakStarted, .breakEnded: return "BREAK"
        }
    }

    var state: String { started ? "STARTED" : "ENDED" }

    var started: Bool {
        switch self {
        case .lunchStarted, .breakStarted: return true
        case .lunchEnded, .breakEnded:     return false
        }
    }

    var icon: String {
        if !started { return "play.circle.fill" }
        switch self {
        case .lunchStarted: return "fork.knife"
        case .breakStarted: return "cup.and.saucer.fill"
        default:            return "play.circle.fill"
        }
    }

    /// One plain-language line under the shout, so there's no ambiguity about
    /// what it did to their pay.
    var subtitle: String {
        switch self {
        case .lunchStarted: return "Your pay clock is paused"
        case .lunchEnded:   return "Your pay clock is running again"
        case .breakStarted: return "You're still on the clock"
        case .breakEnded:   return "Welcome back"
        }
    }
}

/// The inbox filter. Stored on `AppNav.chatFilter`.
enum ChatFilter: String, CaseIterable, Hashable {
    case all, unread, dms, groups, mentions
    var label: String {
        switch self {
        case .all:      return "All"
        case .unread:   return "Unread"
        case .dms:      return "DMs"
        case .groups:   return "Groups"
        case .mentions: return "Mentions"
        }
    }
}

// MARK: - One scheduled task
//
// The canonical unit of work shown in the Jobs list. `op == nil` means the user
// is on `panel.team` but no specific op. Returned by AppState, so it belongs
// here rather than beside the card that happens to render it.
struct TaskAssignment: Identifiable {
    let job: Job
    let panel: Panel
    let op: Operation?
    /// Whether the current user is actually scheduled to this work. Defaults to
    /// true so existing "my tasks" call sites are unchanged; the ALL JOBS section
    /// passes `false` for jobs the user isn't assigned to.
    var isMine: Bool = true

    var id: String { "\(job.id)/\(panel.id)/\(op?.id ?? "panel")" }

    var title: String { op?.title.isEmpty == false ? op!.title : panel.title }
    var status: JobStatus { op?.status ?? panel.status }
    var hpd: Double { op?.hpd ?? panel.hpd }
    var startDate: Date? { (op?.start ?? panel.start).asDate }
    var endDate: Date? { (op?.end ?? panel.end).asDate }
}
