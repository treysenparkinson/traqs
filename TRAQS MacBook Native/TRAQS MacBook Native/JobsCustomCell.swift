import SwiftUI

// MARK: - A custom column's cell
//
// `customCols.map(...)` inside GridRow (TRAQS.jsx:12106). Six shapes, chosen by
// the column's type, plus two special cases that are not really types at all:
//
//   activity  — computed and read-only, the newest signature on this row's
//               approval chain. No stored field backs it, so it never commits.
//   color     — a swatch, and only on a PANEL row. The web draws nothing at the
//               other two levels.
//   checkbox  — a toggle, written back as the STRING "true"/"false", which is
//               what `commitEdit(id, key, String(!checked))` sends.
//   select    — a picker, styled like the Status column rather than a native
//               menu, because a native one renders in the system font.
//   date      — the date popover.
//   text/number — an inline field.
//
// Where the value lives depends on the column: a LINKED column reads the job
// field it names (`poNumber`, `notes`, …), an invented one reads `_cc_<id>` out
// of `JSONExtras`. `JobsCustomValue` is the one place that knows the difference.

struct JobsCustomCell: View {
    @Environment(\.tqTheme) private var theme

    let row: JobGridRow
    let column: JobsCustomColumn
    let width: CGFloat
    let align: JobColumn.Align
    let context: JobsCellContext
    let actions: JobsCellActions
    @Binding var editing: JobsEditTarget?

    @State private var pickerOpen = false
    @State private var dateOpen = false

    var body: some View {
        content
            .padding(.horizontal, JobsGridMetrics.cellHPad)
            .padding(.vertical, JobsGridMetrics.cellVPad)
            // FIXED, both axes, and a blank cell renders `Color.clear` rather
            // than nothing — the rule JobsGridCell's header explains: an
            // EmptyView takes no space whatever frame wraps it, and every column
            // after it slides left on that row only.
            .frame(width: width, height: JobsGridMetrics.rowHeight,
                   alignment: align.frameAlignment)
    }

    private var columnID: String { "_cc_\(column.id)" }
    private var isEditing: Bool {
        editing == JobsEditTarget(rowID: row.id, columnID: columnID)
    }

    /// The raw value for this row, wherever it lives.
    private var value: JSONValue? { JobsCustomValue.read(column, from: row) }
    private var text: String { value?.text ?? "" }

    @ViewBuilder
    private var content: some View {
        switch column.type {
        case .activity: activityCell
        case .checkbox: checkboxCell
        case .select:
            // A list column with no list has nothing to pick from, so it falls
            // back to a plain field rather than opening an empty popover.
            if column.options.isEmpty { textCell } else { selectCell }
        case .date:     dateCell
        case .text, .number:
            // `color` is a text-typed linked column that the web draws as a
            // SWATCH instead — one of two places a linked column's type does not
            // decide its cell.
            if column.fieldKey == "color" { colorCell } else { textCell }
        }
    }

    // MARK: Activity — read-only
    //
    // `apprActivity` (TRAQS.jsx:12357). A computed column: the newest thing that
    // happened to this row's approval, as a verb, a step, who, and when. Nothing
    // backs it, so it never commits and has no editor.
    //
    // Resolved in the CONTEXT rather than here — it reads `orgSettings` for the
    // sign-off templates and the step labels, and it walks every panel for a job
    // row. See `JobsApproval.activity`.
    //
    // An em dash when a row has no approval history at all, which is what the web
    // draws — and what this column drew unconditionally before the chain was
    // ported.

    @ViewBuilder
    private var activityCell: some View {
        if let activity = context.activity[row.itemID] {
            HStack(spacing: 4) {
                Text(activity.verb)
                    .font(TFont.body(11, 700))
                    .foregroundStyle(activity.verbHex.map { Color.hex($0) } ?? theme.text)
                    .lineLimit(1)
                    .layoutPriority(1)

                if !activity.step.isEmpty {
                    Text(activity.step)
                        .font(TFont.body(11))
                        .foregroundStyle(theme.textSec)
                        .lineLimit(1)
                }

                if !activity.byName.isEmpty {
                    Text("\u{00B7} \(activity.byName)")
                        .font(TFont.body(10))
                        .foregroundStyle(theme.textDim)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .help(activityTip(activity))
        } else {
            dash
        }
    }

    private func activityTip(_ activity: ApprovalActivity) -> String {
        let when = JobsDate.stampShort(activity.at)
        let head = [activity.verb, activity.step]
            .filter { !$0.isEmpty }.joined(separator: " ")
        let who = activity.byName.isEmpty ? "" : " by \(activity.byName)"
        return when.isEmpty ? head + who : "\(head)\(who) \u{00B7} \(when)"
    }

    // MARK: Colour — panel rows only

    @ViewBuilder
    private var colorCell: some View {
        if row.level == 1, !text.isEmpty {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(Color.hex(text))
                .frame(width: 18, height: 18)
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(theme.border, lineWidth: 1))
        } else {
            Color.clear
        }
    }

    // MARK: Checkbox

    private var checkboxCell: some View {
        let on = value.map { v -> Bool in
            if case .bool(let b) = v { return b }
            return v.text == "true"
        } ?? false

        return Button {
            // The STRING, not a bool — `String(!checked)` is what the web writes,
            // and a real boolean here would read back as unchecked on the web's
            // `val === "true"` test.
            actions.commitCustom(row, column, .string(on ? "false" : "true"))
        } label: {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(on ? theme.accent : Color.clear)
                .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .strokeBorder(on ? theme.accent : theme.border, lineWidth: 1.5))
                .overlay {
                    if on { WebGlyph(spec: WebIcon.tick, size: 9, color: theme.accentText) }
                }
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Select

    private var selectCell: some View {
        let selected = column.options.first { $0.name == text && !$0.isBlank }
        let tint = selected?.color.map { Color.hex($0) } ?? theme.textDim

        return Group {
            if let selected {
                HStack(spacing: 4) {
                    if let icon = selected.icon, !icon.isEmpty {
                        Text(icon).font(TFont.body(11))
                    }
                    Text(selected.name)
                        .font(TFont.body(11, 700))
                        .lineLimit(1)
                }
                .foregroundStyle(tint)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(Capsule().fill(tint.opacity(0.13)))
                .overlay(Capsule().strokeBorder(tint.opacity(0.45), lineWidth: 1))
                // Never wider than the column, so a long option cannot push the
                // grid's rules out of line.
                .frame(maxWidth: width - JobsGridMetrics.cellHPad * 2, alignment: .leading)
            } else {
                dash
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { pickerOpen = true }
        // Unconditional — the same rule, and the same fix, as the status cell.
        // Installing it only while open destroyed the anchor in the update that
        // dismissed the popover, which left the list on screen unable to commit.
        .popover(isPresented: $pickerOpen, arrowEdge: .bottom) {
            JobsOptionList(
                options: JobsOptionList.selectOptions(column.options,
                                                      accent: theme.accent,
                                                      dim: theme.textDim),
                current: text) { picked in
                pickerOpen = false
                actions.commitCustom(row, column,
                                     picked.isEmpty ? nil : .string(picked))
            }
        }
    }

    // MARK: Date

    private var dateCell: some View {
        Group {
            if text.isEmpty { dash } else {
                Text(JobsDate.short(text))
                    .font(TFont.body(JobsGridMetrics.cellFont))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { dateOpen = true }
        .popover(isPresented: $dateOpen, arrowEdge: .bottom) {
            JobsDatePopover(day: text, clearable: true) { picked in
                dateOpen = false
                actions.commitCustom(row, column,
                                     picked.isEmpty ? nil : .string(picked))
            }
        }
    }

    // MARK: Text and number

    @ViewBuilder
    private var textCell: some View {
        if isEditing {
            JobsInlineField(text: text,
                            font: TFont.body(JobsGridMetrics.cellFont),
                            accent: theme.accent, ink: theme.text) { typed in
                editing = nil
                commitTyped(typed)
            } cancel: {
                editing = nil
            }
        } else {
            Group {
                if text.isEmpty { dash } else {
                    Text(text)
                        .font(column.type == .number
                              ? TFont.mono(JobsGridMetrics.cellFont)
                              : TFont.body(JobsGridMetrics.cellFont))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: align.frameAlignment)
            .contentShape(Rectangle())
            .onTapGesture {
                guard column.type.isEditable else { return }
                editing = JobsEditTarget(rowID: row.id, columnID: columnID)
            }
        }
    }

    /// A number column stores a NUMBER when what was typed is one, and the typed
    /// string when it is not — matching what the web ends up with, where a typed
    /// value arrives as a string and an imported one as a number. Blank clears.
    private func commitTyped(_ typed: String) {
        let trimmed = typed.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            actions.commitCustom(row, column, nil)
            return
        }
        if column.type == .number, let n = Double(trimmed) {
            actions.commitCustom(row, column, .number(n))
        } else {
            actions.commitCustom(row, column, .string(trimmed))
        }
    }

    private var dash: some View {
        Text("\u{2014}")
            .font(TFont.body(JobsGridMetrics.cellFont))
            .foregroundStyle(theme.textDim)
    }
}

// MARK: - Where a custom column's value lives
//
// The one place that knows a linked column reads a job field and an invented one
// reads `_cc_<id>`. Both directions, so a cell never has to.

enum JobsCustomValue {

    /// Read for a row. Panels and operations have none of the linked JOB fields,
    /// so a linked column is blank below level 0 — which is what the web shows,
    /// since `item[col.fieldKey]` is simply undefined there.
    static func read(_ column: JobsCustomColumn, from row: JobGridRow) -> JSONValue? {
        guard let field = column.fieldKey else {
            return extras(of: row)[storageKey(column)]
        }
        switch row {
        case .job(let job):              return jobField(field, of: job)
        case .panel(let p, _, _):        return p.extras[field]
        case .operation(let o, _, _, _): return o.extras[field]
        }
    }

    static func storageKey(_ column: JobsCustomColumn) -> String {
        column.fieldKey ?? "_cc_\(column.id)"
    }

    /// The five linked fields that ARE modelled on `Job`. Anything else the
    /// catalogue names falls through to `extras`, which is where an unmodelled
    /// field now lives.
    private static func jobField(_ key: String, of job: Job) -> JSONValue? {
        switch key {
        case "poNumber":  return job.poNumber.map { JSONValue.string($0) }
        case "jobType":   return job.jobType.map { JSONValue.string($0) }
        case "hpd":       return .number(job.hpd)
        case "notes":     return job.notes.isEmpty ? nil : .string(job.notes)
        case "color":     return job.color.isEmpty ? nil : .string(job.color)
        default:          return job.extras[key]
        }
    }

    private static func extras(of row: JobGridRow) -> JSONExtras {
        switch row {
        case .job(let j):                return j.extras
        case .panel(let p, _, _):        return p.extras
        case .operation(let o, _, _, _): return o.extras
        }
    }

    // MARK: Writing

    /// Apply a custom-column edit to a job, purely.
    ///
    /// Mirrors `JobsEdit.apply`: a path says WHERE, the column and value say
    /// WHAT. A path that no longer resolves returns the job untouched.
    static func apply(_ column: JobsCustomColumn, _ value: JSONValue?,
                      at path: JobsEditPath, in job: Job) -> Job {
        var job = job
        let key = storageKey(column)

        switch path {
        case .job:
            if let field = column.fieldKey {
                writeJobField(field, value, &job)
            } else {
                job.extras.set(key, value)
            }
        case .panel(let panelID):
            guard let i = job.subs.firstIndex(where: { $0.id == panelID }) else { return job }
            job.subs[i].extras.set(key, value)
        case .operation(let panelID, let opID):
            guard let p = job.subs.firstIndex(where: { $0.id == panelID }),
                  let o = job.subs[p].subs.firstIndex(where: { $0.id == opID })
            else { return job }
            job.subs[p].subs[o].extras.set(key, value)
        }
        return job
    }

    /// A linked column writes the real field, so editing "PO #" in the grid
    /// changes the job's PO number rather than shadowing it with a copy.
    private static func writeJobField(_ key: String, _ value: JSONValue?,
                                      _ job: inout Job) {
        let text = value?.text ?? ""
        switch key {
        case "poNumber": job.poNumber = text.isEmpty ? nil : text
        case "jobType":  job.jobType = text.isEmpty ? nil : text
        case "notes":    job.notes = text
        case "color":    if !text.isEmpty { job.color = text }
        case "hpd":      if let n = Double(text) { job.hpd = n }
        // `apprActivity` is computed — there is nothing to write. Anything else
        // the catalogue grows goes to extras, which round-trips whatever it is.
        case "apprActivity": break
        default: job.extras.set(key, value)
        }
    }
}
