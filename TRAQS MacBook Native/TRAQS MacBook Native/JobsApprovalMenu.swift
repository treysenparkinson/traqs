import SwiftUI

// MARK: - The Approval cell's own right-click menu
//
// `approvalCtx` (TRAQS.jsx:27895). Two rows, and they are about the CHAIN rather
// than about the row, which is why this is not part of `JobsRowMenu`:
//
//   Edit / Add Steps        — opens the step editor, seeded from whatever chain
//                             is showing
//   Reset to default steps  — only when the panel is running a CUSTOM chain;
//                             drops it and falls back to the sign-off template or
//                             the engineering steps underneath
//
// A panel running a sign-off TEMPLATE gets a third shape on the web — "Edit
// «name» Steps", which jumps into org settings' template editor. That editor is
// not ported, and editing a template changes every panel using it, so the row is
// drawn and disabled with a reason rather than silently absent: a menu that is
// missing a row people know about reads as a bug too.

struct JobsApprovalMenuTarget: Equatable {
    var point: CGPoint
    var jobID: String
    var panelID: String
    /// The panel's title — the menu's own header, `headerTitle` on the web.
    var title: String
    var state: ApprovalState

    /// Only a CUSTOM chain can be reset; the other two shapes are the default.
    var hasCustomChain: Bool { state.kind == .chain }

    var isTemplate: Bool {
        if case .signOff = state.kind { return true }
        return false
    }
}

struct JobsApprovalMenuActions {
    var editSteps: (JobsApprovalMenuTarget) -> Void = { _ in }
    var resetChain: (JobsApprovalMenuTarget) -> Void = { _ in }
}

struct JobsApprovalMenu: View {
    @Environment(\.tqTheme) private var theme

    let target: JobsApprovalMenuTarget
    let placement: MenuPlacement.Context
    var actions = JobsApprovalMenuActions()
    let dismiss: () -> Void

    var body: some View {
        TQMenuCard(up: placement.up, width: TQMenuMetrics.rowMenuWidth,
                   maxHeight: placement.maxHeight) {
            header

            if target.isTemplate {
                JobsColumnMenuRow(
                    glyph: WebIcon.pencil,
                    label: "Edit \u{201C}\(target.title)\u{201D} Steps",
                    enabled: false,
                    help: "Editing a sign-off template changes every panel using it — the template editor is not ported yet",
                    cascade: cascade(0)) { }
            }

            JobsColumnMenuRow(glyph: WebIcon.pencil, label: "Edit / Add Steps",
                              cascade: cascade(target.isTemplate ? 1 : 0)) {
                dismiss()
                actions.editSteps(target)
            }

            if target.hasCustomChain {
                TQMenuDivider()
                JobsColumnMenuRow(glyph: WebIcon.revert,
                                  label: "Reset to default steps",
                                  cascade: cascade(target.isTemplate ? 2 : 1)) {
                    dismiss()
                    actions.resetChain(target)
                }
            }
        }
    }

    /// The panel this chain belongs to, and how far along it is. The web's menu
    /// carries `headerTitle` for the same reason: a right-click that lands one row
    /// off is otherwise indistinguishable from one that landed right.
    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(target.title)
                    .font(TFont.body(13, 700))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Text("\(target.state.done)/\(target.state.total) signed")
                    .font(TFont.body(11))
                    .foregroundStyle(theme.textDim)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)

            Rectangle().fill(theme.border).frame(height: 1)
        }
    }

    /// Three slots whether or not every row draws, so a gap in the sequence is
    /// 38ms of nothing rather than a visible fault — the same rule
    /// `JobsColumnMenu.cascade` follows.
    private func cascade(_ index: Int) -> TQMenuCascade {
        TQMenuCascade(index: index, total: 3, up: placement.up)
    }
}
