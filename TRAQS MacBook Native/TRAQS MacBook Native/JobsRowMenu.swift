import SwiftUI

// MARK: - The Jobs grid's right-click menu
//
// `ctxMenu` (TRAQS.jsx:27939), the `"job-detail"` source. One menu for all three
// levels, and most of what is in it is conditional on which level was clicked and
// on what that row has underneath it.
//
// The web decides those conditions inline, re-walking `tasks` several times per
// row to answer "what panel owns this op". Here the walk happens ONCE, when the
// click lands, and the answers travel with the target — so the menu view is pure
// and cannot reach for AppState while it is being drawn.

// MARK: What was clicked

/// A panel's `depsMode`. Not modelled on `Panel` — the web writes it as a loose
/// string and it reaches Swift through `JSONExtras`.
enum JobsDepsMode: String {
    /// No links at all. `depsMode` absent, or anything unrecognised.
    case free
    /// First and last op are anchors, the middle floats.
    case unlocked
    /// Every op moves as one block.
    case locked

    init(_ raw: String?) { self = JobsDepsMode(rawValue: raw ?? "") ?? .free }

    /// One control cycling three states, in the web's own order (:27995).
    var next: JobsDepsMode {
        switch self {
        case .locked:   return .free
        case .free:     return .unlocked
        case .unlocked: return .locked
        }
    }

    var glyph: GlyphSpec {
        switch self {
        case .free:     return WebIcon.lockFree
        case .locked:   return WebIcon.lockClosed
        case .unlocked: return WebIcon.lockOpen
        }
    }

    /// The web's `toggleTitle` — it names the state AND what clicking does next,
    /// because the glyph alone cannot say which of three it is.
    var help: String {
        switch self {
        case .free:     return "Dependencies: Free — click for Unlocked"
        case .locked:   return "Dependencies: Locked — click for Free"
        case .unlocked: return "Dependencies: Unlocked — click to Lock"
        }
    }

    var isOn: Bool { self != .free }
}

/// A resolved right-click. Everything the menu needs, worked out at click time.
struct JobsRowMenuTarget: Equatable {
    var point: CGPoint
    var row: JobRow

    /// The owning job, whatever level was clicked. The header shows the JOB's
    /// title even on an operation row — the op's own title goes in the subtitle,
    /// under its panel's.
    var jobID: String
    var jobTitle: String
    var panelID: String?
    var panelTitle: String?

    /// `liveChildCount` — read from state, not from the row, because a row is a
    /// snapshot and may predate the last edit. Gates "Request Completion", which
    /// the web offers only on a leaf.
    var childCount: Int
    /// How many operations share this one's panel. Two or more is what unlocks
    /// the dependency controls.
    var siblingOpCount: Int
    var depsMode: JobsDepsMode

    var isOperation: Bool { row.level == 2 }
    var isPanel: Bool { row.level == 1 }
    var isJob: Bool { row.level == 0 }

    /// `showDepToggle` (:27992).
    var showsDependencyToggle: Bool { isOperation && siblingOpCount >= 2 }
}

/// What the menu can do. Closures for the same reason `JobsCellActions` uses
/// them — the menu never becomes an observer of anything.
struct JobsRowMenuActions {
    var requestCompletion: (JobRow) -> Void = { _ in }
    var delete: (JobRow) -> Void = { _ in }
    var cycleDependencyMode: (JobsRowMenuTarget) -> Void = { _ in }
    var openChat: (JobRow) -> Void = { _ in }
    var goToSchedule: (String) -> Void = { _ in }
}

// MARK: The menu

struct JobsRowMenu: View {
    @Environment(\.tqTheme) private var theme

    let target: JobsRowMenuTarget
    let placement: MenuPlacement.Context
    let actions: JobsRowMenuActions
    let dismiss: () -> Void

    var body: some View {
        // Counted up front so the cascade can reverse when the menu flipped
        // above the pointer. The web counts the rendered rows out of the DOM for
        // the same reason and cannot know the number until it has painted; here
        // the conditions are all on `target`, so it is knowable in advance.
        let rows = visibleRows
        return TQMenuCard(up: placement.up, width: TQMenuMetrics.rowMenuWidth,
                          maxHeight: placement.maxHeight) {
            header
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if row.startsGroup { TQMenuDivider() }
                TQMenuRow(glyph: row.glyph, label: row.label, sub: row.sub,
                          destructive: row.destructive,
                          cascade: .init(index: index, total: rows.count,
                                         up: placement.up),
                          enabled: row.enabled, help: row.help) {
                    dismiss()
                    row.run()
                }
            }
        }
    }

    // MARK: The header
    //
    // `padding: 14px 16px`, a bottom rule, the title at 15/700, the op's
    // `panel · op` line under it at 11, then the date range at 11 in textDim —
    // and the icon buttons pinned right.

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(target.isOperation ? target.jobTitle : target.row.title)
                        .font(TFont.body(15, 700))
                        .foregroundStyle(theme.text)
                        .lineLimit(2)

                    if target.isOperation {
                        Text(target.panelTitle.map { "\($0) · \(target.row.title)" }
                             ?? target.row.title)
                            .font(TFont.body(11, 600))
                            .foregroundStyle(theme.textSec)
                            .lineLimit(2)
                    }

                    Text(dateLine)
                        .font(TFont.body(11))
                        .foregroundStyle(theme.textDim)
                }
                Spacer(minLength: 0)
                headerButtons
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)

            Rectangle().fill(theme.border).frame(height: 1)
        }
    }

    /// `fm(start) → fm(end)` plus `· Nh/day` when the row carries one.
    private var dateLine: String {
        let range = "\(JobsDate.short(target.row.start)) → \(JobsDate.short(target.row.end))"
        let hpd = target.row.estimatedHours
        guard target.isOperation, hpd > 0 else { return range }
        // `JobsDate.hours` gives the NUMBER — "7.5", "8" — so the unit is added
        // here, exactly as the web's `· ${it.hpd}h/day` does.
        return range + " · \(JobsDate.hours(hpd))h/day"
    }

    private var headerButtons: some View {
        HStack(spacing: 6) {
            // Opening the job for editing is the three-step wizard, which is not
            // ported. Drawn and refused rather than left live — the convention
            // this app already follows for an unported destination.
            headerButton(WebIcon.pencil, "Edit — the job editor is not ported yet",
                         enabled: false) { }

            headerButton(WebIcon.messages, "Open Chat") {
                dismiss()
                actions.openChat(target.row)
            }

            headerButton(WebIcon.bell, "Send Reminder — not ported yet",
                         enabled: false) { }

            if target.showsDependencyToggle {
                headerButton(target.depsMode.glyph, target.depsMode.help,
                             tinted: target.depsMode.isOn) {
                    actions.cycleDependencyMode(target)
                }
            }
        }
    }

    /// 26pt squares — smaller than the toolbar's 34, which is the web's own
    /// sizing for a button that sits inside a menu rather than on a page.
    private func headerButton(_ glyph: GlyphSpec, _ help: String,
                              enabled: Bool = true, tinted: Bool = false,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WebGlyph(spec: glyph, size: 13,
                     color: tinted ? theme.accent : theme.textSec)
                .frame(width: 26, height: 26)
                .background(Circle().fill(tinted ? theme.accent.opacity(0.09) : theme.surface))
                .overlay(Circle().strokeBorder(tinted ? theme.accent : theme.border,
                                               lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .help(help)
    }

    // MARK: The rows
    //
    // Built as data rather than as a `@ViewBuilder` of conditionals, because the
    // cascade needs each row's INDEX among the rows that actually rendered — and
    // a ViewBuilder cannot count its own branches. The web solves the same
    // problem with a mutable counter threaded through every call site (`ci()`);
    // a list is the same idea without the shared mutable state.

    private struct Row: Identifiable {
        let id: String
        let glyph: GlyphSpec
        let label: String
        var sub: String? = nil
        var destructive = false
        var startsGroup = false
        var enabled = true
        var help: String? = nil
        var run: () -> Void = { }
    }

    private var visibleRows: [Row] {
        var rows: [Row] = []

        rows.append(Row(id: "details", glyph: WebIcon.eye, label: "View Details",
                        enabled: false,
                        help: "The job details page is not ported yet"))

        rows.append(Row(id: "schedule", glyph: WebIcon.calendarPin,
                        label: "Take me to schedule",
                        sub: "Jump to this job on the schedule") {
            actions.goToSchedule(target.jobID)
        })

        // Only an operation with siblings has anything to depend ON.
        if target.isOperation, target.siblingOpCount >= 2 {
            rows.append(Row(id: "deps", glyph: WebIcon.lockOpen,
                            label: "Add/Edit Dependencies",
                            sub: "Manage dependency links between sub-ops",
                            enabled: false,
                            help: "The dependencies editor is not ported yet"))
        }

        rows.append(Row(id: "reschedule", glyph: WebIcon.calendarDays,
                        label: "Reschedule",
                        sub: "Reopen job to pick a new start date",
                        enabled: false,
                        help: "Rescheduling needs the job wizard, not ported yet"))

        // `hpd > 1` — there is nothing to split an hour into.
        if target.isOperation, target.row.estimatedHours > 1,
           target.row.status != .finished {
            rows.append(Row(id: "split", glyph: WebIcon.split, label: "Split Job",
                            sub: "Divide this op into two at a set hour",
                            enabled: false,
                            help: "The split dialog is not ported yet"))
        }

        if target.isOperation, target.row.status != .finished {
            rows.append(Row(id: "worked", glyph: WebIcon.clock,
                            label: "Set Worked Hours",
                            sub: "Manually mark hours done (greys out that portion)",
                            enabled: false,
                            help: "The worked-hours dialog is not ported yet"))
        }

        // A leaf only. Asking to finish a row that still has open children is
        // what the child rows are for.
        if target.childCount == 0 {
            rows.append(Row(id: "complete", glyph: WebIcon.flag,
                            label: "Request Completion",
                            sub: "Send to all admins for review and approval") {
                actions.requestCompletion(target.row)
            })
        }

        rows.append(Row(id: "delete", glyph: WebIcon.trash, label: "Delete",
                        sub: "Permanently remove this item",
                        destructive: true, startsGroup: true) {
            actions.delete(target.row)
        })

        return rows
    }
}
