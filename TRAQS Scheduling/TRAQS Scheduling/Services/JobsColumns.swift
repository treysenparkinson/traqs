import CoreGraphics
import Foundation

// MARK: - The Jobs grid's columns, as data
//
// `JobColumn` describes the twelve standard columns and nothing else, which was
// right while the grid was fixed. It is not enough now: the web lets a column be
// reordered, resized, renamed, hidden and deleted, and lets new ones be added —
// linked to a job field, from a template, or invented.
//
// So the grid stops asking `JobColumn.allCases` and starts asking a LAYOUT. This
// file is that layout, and it is pure: no view, no storage, no AppState. What
// persists it is the caller's business (`JobsColumnStore`), which is also why the
// rules can be exercised on their own.
//
// The three web sources this replaces:
//
//   colOrder   (:5021) — the standard columns' order, minus any deleted. localStorage.
//   colLabels  (:5039) — per-column rename overrides. localStorage.
//   colWidths  (:4818) — [26, 200, 80, …, 36]; index 0 is a lead gutter, 1…12 are
//                        the standard columns read at `1 + col.i`, 13… are the
//                        custom ones, and the last is the "+" cell.
//   customCols (:4902) — orgSettings.customCols, so these are ORG-WIDE and shared,
//                        unlike the three above.
//
// The width array is not copied. Positional indices into a flat array that also
// holds two non-columns is exactly the sort of thing that goes wrong silently —
// the web has to write `colWidths[1 + c.i]` and `prev.slice(13, len - 1)` to use
// it. Widths live on the column here.

// MARK: What a custom column is

/// `customCols[]` — a column somebody added.
///
/// Two kinds, told apart by `fieldKey`:
///   * `fieldKey != nil` — LINKED to a real job field (`FIELD_COL_CATALOG`, :91).
///     Editing the cell edits the job.
///   * `fieldKey == nil` — its own value, stored on the job under `_cc_<id>`.
///     Those keys are dynamic, so they reach Swift through `JSONExtras`.
struct JobsCustomColumn: Identifiable, Equatable, Codable, Sendable {
    var id: String
    var label: String
    var type: JobsColumnType
    var options: [JobsSelectOption]
    var fieldKey: String?

    init(id: String, label: String, type: JobsColumnType,
         options: [JobsSelectOption] = [], fieldKey: String? = nil) {
        self.id = id; self.label = label; self.type = type
        self.options = options; self.fieldKey = fieldKey
    }

    /// Where this column's value lives on a job. A linked column reads the field
    /// it names; an invented one reads `_cc_<id>`.
    var storageKey: String { fieldKey ?? "_cc_\(id)" }

    /// Lenient, like every other model here: an unknown `type` becomes text
    /// rather than dropping the column, and options may be bare strings from
    /// before they carried a colour.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id       = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        label    = (try? c.decode(String.self, forKey: .label)) ?? ""
        type     = (try? c.decode(JobsColumnType.self, forKey: .type)) ?? .text
        fieldKey = try? c.decodeIfPresent(String.self, forKey: .fieldKey)
        options  = (try? c.decode([JobsSelectOption].self, forKey: .options)) ?? []
    }
}

/// `col.type`. `activity` is the odd one — computed and read-only, the newest
/// signature on the row's approval chain, with no stored field behind it.
enum JobsColumnType: String, Codable, CaseIterable, Sendable {
    case text, number, date, select, checkbox, activity

    var label: String {
        switch self {
        case .text:     return "Text"
        case .number:   return "Number"
        case .date:     return "Date"
        case .select:   return "Dropdown (List)"
        case .checkbox: return "Checkbox"
        case .activity: return "Activity"
        }
    }

    /// `doInsert`'s widths (:26231).
    var defaultWidth: CGFloat {
        switch self {
        case .checkbox: return 80
        case .number:   return 90
        default:        return 120
        }
    }

    /// Nothing to edit on a computed column.
    var isEditable: Bool { self != .activity }
}

/// One entry in a select column's list.
///
/// `toOptObjs` (:194) — the web stores these as EITHER a bare string (legacy) or
/// `{name, color, icon}`, and normalises on read. Decoding handles both so the
/// rest of the app only ever sees the object form.
struct JobsSelectOption: Equatable, Codable, Hashable, Sendable {
    var name: String
    var color: String?
    var icon: String?

    init(name: String, color: String? = nil, icon: String? = nil) {
        self.name = name; self.color = color; self.icon = icon
    }

    init(from decoder: Decoder) throws {
        if let bare = try? decoder.singleValueContainer().decode(String.self) {
            // A legacy string. `toOptObjs` gives it a palette colour and the
            // default ring icon — EXCEPT the blank sentinel, which stays bare so
            // it renders as an empty cell rather than a coloured chip.
            self = bare == JobsSelectOption.blankName
                ? JobsSelectOption(name: bare)
                : JobsSelectOption(name: bare, color: nil, icon: "\u{25CB}")
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name  = (try? c.decode(String.self, forKey: .name)) ?? ""
        color = try? c.decodeIfPresent(String.self, forKey: .color)
        icon  = try? c.decodeIfPresent(String.self, forKey: .icon)
    }

    /// The "no value" entry. The web keeps it in the list rather than outside it,
    /// so a list column can always be cleared from its own picker.
    static let blankName = "\u{2014}"          // —
    var isBlank: Bool { name == JobsSelectOption.blankName }

    /// `OPT_PALETTE` (:189), cycled by position — what a newly added option gets.
    static let palette = ["#3b82f6", "#10b981", "#f59e0b", "#f43f5e", "#a78bfa",
                          "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6"]

    static func next(at index: Int) -> JobsSelectOption {
        JobsSelectOption(name: "New \(index + 1)",
                         color: palette[index % palette.count],
                         icon: "\u{25CB}")
    }
}

// MARK: One column on screen

/// A standard column or a custom one, with the width and label actually in force.
///
/// Built by `JobsColumnLayout`, never by hand — the resolved label folds in the
/// rename override, and the resolved width folds in a resize.
struct JobsGridColumn: Identifiable, Equatable {
    enum Kind: Equatable {
        case standard(JobColumn)
        case custom(JobsCustomColumn)
    }

    var kind: Kind
    var label: String
    var width: CGFloat

    /// Stable across a rename or a resize, and unique across both kinds — the
    /// key everything else (sort, group preference, drag) is stored against.
    var id: String {
        switch kind {
        case .standard(let c): return c.rawValue
        case .custom(let c):   return "_cc_\(c.id)"
        }
    }

    var standard: JobColumn? { if case .standard(let c) = kind { return c } else { return nil } }
    var custom: JobsCustomColumn? { if case .custom(let c) = kind { return c } else { return nil } }
    var isCustom: Bool { custom != nil }

    var align: JobColumn.Align {
        switch kind {
        case .standard(let c): return c.align
        // `number` right-aligns for the same reason `hrs` does; a checkbox
        // centres because the box has no text to line up.
        case .custom(let c):
            switch c.type {
            case .number:   return .trailing
            case .checkbox: return .center
            default:        return .leading
            }
        }
    }
}

// MARK: The layout

/// Everything about the grid's columns: which, in what order, how wide, called
/// what, and which may be grouped by.
///
/// A VALUE. The view holds one and writes a new one; nothing here mutates in
/// place behind a reference, which keeps "the columns changed" a change SwiftUI
/// can see.
struct JobsColumnLayout: Equatable, Sendable {
    /// `colOrder` — the standard columns still shown, in order. A column deleted
    /// from the header menu is REMOVED from here rather than flagged hidden,
    /// which is what the web does, and is why re-adding one is a fresh insert.
    var order: [JobColumn] = JobColumn.allCases

    /// `colLabels` — rename overrides. Absent means the column's own label.
    var labels: [String: String] = [:]

    /// Resized widths, by column id. Absent means the default.
    var widths: [String: CGFloat] = [:]

    /// `customCols`. Org-wide, so these arrive from settings rather than from
    /// this device.
    var custom: [JobsCustomColumn] = []

    /// `groupColPref` — per-column overrides of `GROUPABLE_STD`. Absent means the
    /// default for that column.
    var groupable: [String: Bool] = [:]

    init() {}

    // MARK: Reading

    /// The columns to draw, standard ones first and then the custom ones — the
    /// order the web's body renders its two groups in, and the reason a column
    /// can only be dragged WITHIN its own group.
    var columns: [JobsGridColumn] {
        order.map { col in
            JobsGridColumn(kind: .standard(col),
                           label: labels[col.rawValue] ?? col.label,
                           width: widths[col.rawValue] ?? col.defaultWidth)
        } + custom.map { col in
            let id = "_cc_\(col.id)"
            return JobsGridColumn(kind: .custom(col),
                                  label: labels[id] ?? col.label,
                                  width: widths[id] ?? col.type.defaultWidth)
        }
    }

    /// Total drawn width, including the trailing "+" cell.
    var totalWidth: CGFloat {
        columns.reduce(0) { $0 + $1.width } + JobColumn.addColumnWidth
    }

    /// `GROUPABLE_STD` (:210) with the user's overrides on top.
    ///
    /// Name is excluded (one section per job), progress and team do not bucket,
    /// and client has its own section in the grouping dropdown already.
    func isGroupable(_ id: String) -> Bool {
        if let override = groupable[id] { return override }
        return JobsColumnLayout.groupableByDefault(id)
    }

    static func groupableByDefault(_ id: String) -> Bool {
        if id.hasPrefix("_cc_") { return true }
        return ["status", "pri", "due", "start", "end", "jobNum", "hrs"].contains(id)
    }

    /// Whether a linked column for this job field is already on the grid — what
    /// greys a `FIELD_COL_CATALOG` entry out as "Added ✓".
    func hasLinkedField(_ fieldKey: String) -> Bool {
        custom.contains { $0.fieldKey == fieldKey }
    }

    /// Whether a template has already been used. Matched on LABEL, and only
    /// against unlinked columns, exactly as the web does (:11397) — two
    /// templates can share a type, so the type is not the identity.
    func hasTemplate(_ label: String) -> Bool {
        custom.contains { $0.label == label && $0.fieldKey == nil }
    }

    // MARK: Writing
    //
    // Every one returns a new layout. A `mutating` API would be shorter and would
    // also let a caller do half an edit; these cannot be half-applied.

    /// A resize. Floored at a width that still shows a sort arrow — the web's
    /// own `Math.max(60, …)` in `startColResize`.
    func resizing(_ id: String, to width: CGFloat) -> Self {
        var next = self
        next.widths[id] = max(JobsColumnLayout.minWidth, width)
        return next
    }

    static let minWidth: CGFloat = 60

    /// A rename. Clearing it, or setting it back to the column's own label,
    /// REMOVES the override rather than storing a duplicate — so a column whose
    /// default label later changes follows it again.
    func renaming(_ id: String, to raw: String, defaultLabel: String) -> Self {
        var next = self
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name == defaultLabel {
            next.labels.removeValue(forKey: id)
        } else {
            next.labels[id] = name
        }
        return next
    }

    func togglingGroupable(_ id: String) -> Self {
        var next = self
        next.groupable[id] = !isGroupable(id)
        return next
    }

    /// Move a column to a new slot AMONG ITS OWN KIND.
    ///
    /// `to` is the column's FINAL index in the full drawn list — where it should
    /// end up, not where to splice it before removing it. That distinction is
    /// where this went wrong once: the web works in pre-removal insertion
    /// indices and pays for it with an `if (from < to) to--` correction, while
    /// the header here reports a final position (it walks neighbours until the
    /// pointer has passed one's midpoint). Applying the web's correction to a
    /// final index cancels out a one-place move to the right entirely — the
    /// column would snap back and the drag would look broken.
    ///
    /// So: remove first, then clamp against what is LEFT and insert there.
    ///
    /// Standard and custom columns are two separate runs, and a drag that
    /// crossed between them would reorder nothing while looking like it had —
    /// so a target outside the dragged column's own run is clamped into it.
    func moving(_ id: String, to target: Int) -> Self {
        var next = self
        let standardCount = order.count

        if let col = JobColumn(rawValue: id), let from = order.firstIndex(of: col) {
            next.order.remove(at: from)
            next.order.insert(col, at: min(max(0, target), next.order.count))
            return next
        }

        guard let from = custom.firstIndex(where: { "_cc_\($0.id)" == id }) else { return self }
        let moved = next.custom.remove(at: from)
        // The custom run starts after the standard one, so the drawn index has
        // to come back down into this array's own coordinates.
        next.custom.insert(moved, at: min(max(0, target - standardCount), next.custom.count))
        return next
    }

    /// Delete. A standard column leaves `order`; a custom one leaves `custom`
    /// and takes its stored width and rename with it, so re-adding starts clean.
    func removing(_ id: String) -> Self {
        var next = self
        if let col = JobColumn(rawValue: id) {
            next.order.removeAll { $0 == col }
        } else {
            next.custom.removeAll { "_cc_\($0.id)" == id }
        }
        next.widths.removeValue(forKey: id)
        next.labels.removeValue(forKey: id)
        next.groupable.removeValue(forKey: id)
        return next
    }

    /// Insert a new custom column.
    ///
    /// `beside` positions it relative to an existing column. The web's rule when
    /// the anchor is a STANDARD column: left puts it at the front of the custom
    /// run and right puts it at the back — because a custom column cannot sit
    /// among the standard ones (:26232).
    func inserting(_ column: JobsCustomColumn, beside anchor: String? = nil,
                   side: InsertSide = .right) -> Self {
        var next = self

        // Beside another custom column: right where it was asked for.
        if let anchor, let at = custom.firstIndex(where: { "_cc_\($0.id)" == anchor }) {
            next.custom.insert(column, at: side == .left ? at : at + 1)
            return next
        }

        // Beside a STANDARD column, or nothing in particular. A custom column
        // cannot sit among the standard ones, so "left" means the front of the
        // custom run and "right" means the back.
        if anchor != nil, side == .left {
            next.custom.insert(column, at: 0)
        } else {
            next.custom.append(column)
        }
        return next
    }

    enum InsertSide { case left, right }

    /// Replace one custom column — `updateCustomCol`, used by the options editor.
    func updatingCustom(_ id: String, _ change: (inout JobsCustomColumn) -> Void) -> Self {
        var next = self
        guard let i = next.custom.firstIndex(where: { $0.id == id }) else { return self }
        change(&next.custom[i])
        return next
    }
}

// MARK: - What can be added

/// `FIELD_COL_CATALOG` (:91) — job fields offered as ready-made linked columns.
enum JobsFieldCatalog {
    struct Entry: Identifiable, Equatable {
        var fieldKey: String
        var label: String
        var type: JobsColumnType
        var width: CGFloat
        var detail: String
        var id: String { fieldKey }
    }

    static let all: [Entry] = [
        .init(fieldKey: "poNumber", label: "PO #", type: .text, width: 100,
              detail: "Purchase order number"),
        .init(fieldKey: "jobType", label: "Job Type", type: .text, width: 110,
              detail: "Type or category of job"),
        .init(fieldKey: "hpd", label: "Hrs/Day", type: .number, width: 80,
              detail: "Hours per day capacity"),
        .init(fieldKey: "notes", label: "Notes", type: .text, width: 180,
              detail: "Free-form job notes"),
        .init(fieldKey: "color", label: "Color", type: .text, width: 70,
              detail: "Job color tag"),
        // Computed and read-only — no stored job field sits behind this key.
        .init(fieldKey: "apprActivity", label: "Activity", type: .activity, width: 210,
              detail: "Latest approval step signed"),
    ]
}

/// `COL_TEMPLATES` (:35) — starting points for a new column.
enum JobsColumnTemplates {
    struct Template: Identifiable, Equatable {
        var label: String
        var type: JobsColumnType
        var width: CGFloat
        var options: [String]
        var id: String { label }

        var selectOptions: [JobsSelectOption] {
            guard type == .select else { return [] }
            return options.enumerated().map { i, name in
                name == JobsSelectOption.blankName
                    ? JobsSelectOption(name: name)
                    : JobsSelectOption(name: name,
                                       color: JobsSelectOption.palette[i % JobsSelectOption.palette.count],
                                       icon: "\u{25CB}")
            }
        }
    }

    static let blank = JobsSelectOption.blankName

    static let all: [Template] = [
        .init(label: "Status", type: .select, width: 130,
              options: [blank, "Not Started", "In Progress", "On Hold", "Done", "Blocked"]),
        .init(label: "Priority", type: .select, width: 110,
              options: [blank, "Low", "Medium", "High", "Critical"]),
        .init(label: "Phase", type: .select, width: 130,
              options: [blank, "Design", "Fabrication", "Installation", "Review", "Closeout"]),
        .init(label: "Category", type: .select, width: 120,
              options: [blank, "Electrical", "Mechanical", "Civil", "Structural", "Other"]),
        .init(label: "Approval", type: .select, width: 120,
              options: [blank, "Pending", "Approved", "Rejected", "N/A"]),
        .init(label: "Checkbox", type: .checkbox, width: 80, options: []),
        .init(label: "Rating", type: .number, width: 80, options: []),
        .init(label: "Budget", type: .number, width: 100, options: []),
        .init(label: "Contact", type: .text, width: 140, options: []),
    ]
}

extension JobsColumnTemplates.Template {
    /// A column from this template, with a fresh id.
    func makeColumn(id: String = UUID().uuidString) -> JobsCustomColumn {
        JobsCustomColumn(id: id, label: label, type: type, options: selectOptions)
    }
}

extension JobsFieldCatalog.Entry {
    func makeColumn(id: String = UUID().uuidString) -> JobsCustomColumn {
        JobsCustomColumn(id: id, label: label, type: type, fieldKey: fieldKey)
    }
}
