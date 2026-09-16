import SwiftUI

// MARK: - Remembering the column layout
//
// The web splits this in two, and the split is not arbitrary:
//
//   * ORDER, RENAMES, WIDTHS and GROUPING PREFERENCE go to `localStorage`
//     (`tq_col_order`, `tq_col_labels`, `tq_group_cols`) — how one person likes
//     their grid arranged, on one machine.
//   * CUSTOM COLUMNS go to `orgSettings.customCols` — a column somebody adds is
//     a column the whole org gets, because the VALUES live on the jobs and would
//     be orphaned otherwise.
//
// So the per-device half lives in `UserDefaults`, which is the same thing
// `localStorage` is, and the org half comes off `AppState.orgSettings`. The two
// are recombined into one `JobsColumnLayout` for the grid to read.

/// Isolation is left to the target's default, which this one sets to `MainActor`
/// (`SWIFT_DEFAULT_ACTOR_ISOLATION`). Spelling `@MainActor` here would be
/// redundant, and spelling `nonisolated` — which an earlier version did, to dodge
/// an imagined problem with the `@State` default value — makes this the one
/// mutable class in the app that is NOT on the main actor, which is worse.
@Observable
final class JobsColumnStore {

    /// The per-device half. Loaded once at init and written on every change —
    /// the web's `useEffect(… , [colOrder])`, which is the same eager write.
    private(set) var order: [JobColumn]
    private(set) var labels: [String: String]
    private(set) var widths: [String: CGFloat]
    private(set) var groupable: [String: Bool]

    /// `statusOpts` / `priOpts` — the colour and glyph each status and priority
    /// is drawn with.
    ///
    /// PER-USER, not per-org, and that is not a guess: on the web they sit in
    /// `localStorage` beside `colOrder` and `colLabels`, and go up in the same
    /// `saveUserSettings` bundle. So they belong here with the rest of the
    /// per-device half rather than in `orgSettings`.
    ///
    /// Keyed by NAME, because that is what the value on a job is.
    private(set) var statusOpts: [JobsSelectOption]
    private(set) var priOpts: [JobsSelectOption]

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Unknown ids are DROPPED and missing ones APPENDED, so a stored order
        // from an older build (or a newer one) still produces every column
        // exactly once. Without that, adding a standard column would make it
        // invisible to everyone who had ever reordered their grid.
        let stored = defaults.stringArray(forKey: Key.order) ?? []
        let known = stored.compactMap { JobColumn(rawValue: $0) }
        order = stored.isEmpty
            ? JobColumn.allCases
            : known + JobColumn.allCases.filter { !known.contains($0) }
        labels = defaults.dictionary(forKey: Key.labels) as? [String: String] ?? [:]
        groupable = defaults.dictionary(forKey: Key.groupable) as? [String: Bool] ?? [:]
        // A closure, not `CGFloat.init` — CGFloat has a dozen initialisers and an
        // unapplied reference to it cannot be resolved from the element type
        // alone ("ambiguous use of 'init'"). Same on the way out, below.
        widths = (defaults.dictionary(forKey: Key.widths) as? [String: Double] ?? [:])
            .mapValues { CGFloat($0) }
        statusOpts = Self.readOptions(defaults, Key.statusOpts) ?? Self.defaultStatusOpts
        priOpts = Self.readOptions(defaults, Key.priOpts) ?? Self.defaultPriOpts
    }

    /// Stored as JSON, matching the shape the web keeps in `localStorage` — an
    /// array of `{ name, color, icon }`. A decode failure falls back to the
    /// defaults rather than to an empty list, which would leave every pill grey.
    private static func readOptions(_ defaults: UserDefaults,
                                    _ key: String) -> [JobsSelectOption]? {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([JobsSelectOption].self, from: data),
              !decoded.isEmpty
        else { return nil }
        return decoded
    }

    /// `DEFAULT_STATUSES.map(n => ({ name: n, color: …, icon: … }))`. Built from
    /// the enum and `JobPalette`, so the defaults cannot drift from the ones the
    /// rest of the app draws with.
    static var defaultStatusOpts: [JobsSelectOption] {
        JobStatus.allCases.map {
            JobsSelectOption(name: $0.rawValue, color: $0.hex, icon: $0.emblem)
        }
    }

    /// The web gives priorities no icon, only a colour.
    static var defaultPriOpts: [JobsSelectOption] {
        Priority.allCases.map { JobsSelectOption(name: $0.rawValue, color: $0.hex) }
    }

    private enum Key {
        // Prefixed to match the web's own keys, so the two are recognisably the
        // same setting even though they cannot share storage.
        static let order = "tq_col_order"
        static let labels = "tq_col_labels"
        static let widths = "tq_col_widths"
        static let groupable = "tq_group_cols"
        // The web's own localStorage keys, so the two are recognisably the same
        // setting even though they cannot share storage.
        static let statusOpts = "tq_status_opts"
        static let priOpts = "tq_pri_opts"
    }

    // MARK: The status and priority palettes

    /// Colour and glyph by NAME, which is what a cell has to look up with.
    var statusStyles: [String: JobsSelectOption] {
        Dictionary(statusOpts.map { ($0.name, $0) }, uniquingKeysWith: { _, b in b })
    }

    var priorityStyles: [String: JobsSelectOption] {
        Dictionary(priOpts.map { ($0.name, $0) }, uniquingKeysWith: { _, b in b })
    }

    /// Save one of the two lists. NAMES ARE NOT WRITABLE — see
    /// `JobsOptionsEditor.namesLocked` for why — so this keeps the stored names
    /// and takes only the colour and the glyph, whatever the caller passed.
    func saveStatusPalette(_ options: [JobsSelectOption]) {
        statusOpts = Self.merged(into: statusOpts, from: options)
        writeOptions(statusOpts, Key.statusOpts)
    }

    func savePriorityPalette(_ options: [JobsSelectOption]) {
        priOpts = Self.merged(into: priOpts, from: options)
        writeOptions(priOpts, Key.priOpts)
    }

    /// Take colour and icon from `edited`, matched by POSITION, and keep every
    /// name. Position rather than name because the name field is locked, so the
    /// two lists are the same length in the same order — and matching by name
    /// would silently do nothing if that ever stopped being true.
    private static func merged(into stored: [JobsSelectOption],
                               from edited: [JobsSelectOption]) -> [JobsSelectOption] {
        stored.enumerated().map { index, option in
            guard index < edited.count else { return option }
            var next = option
            next.color = edited[index].color
            next.icon = edited[index].icon
            return next
        }
    }

    private func writeOptions(_ options: [JobsSelectOption], _ key: String) {
        guard let data = try? JSONEncoder().encode(options) else { return }
        defaults.set(data, forKey: key)
    }

    // MARK: Reading

    /// The device half and the org half, combined.
    ///
    /// `customCols` is passed in rather than read here so this class never
    /// observes AppState — the grid re-reads it whenever settings change, which
    /// is what should invalidate the columns.
    func layout(customColumns: [JobsCustomColumn]) -> JobsColumnLayout {
        var layout = JobsColumnLayout()
        layout.order = order
        layout.labels = labels
        layout.widths = widths
        layout.groupable = groupable
        layout.custom = customColumns
        return layout
    }

    // MARK: Writing
    //
    // Takes a whole layout and keeps the half it owns. The caller has already
    // produced the new layout through `JobsColumnLayout`'s own returning
    // methods, so nothing here has to know what changed.

    func save(_ layout: JobsColumnLayout) {
        if layout.order != order {
            order = layout.order
            defaults.set(order.map(\.rawValue), forKey: Key.order)
        }
        if layout.labels != labels {
            labels = layout.labels
            defaults.set(labels, forKey: Key.labels)
        }
        if layout.widths != widths {
            widths = layout.widths
            defaults.set(widths.mapValues { Double($0) }, forKey: Key.widths)
        }
        if layout.groupable != groupable {
            groupable = layout.groupable
            defaults.set(groupable, forKey: Key.groupable)
        }
    }

    /// A live resize, which fires on every pointer move.
    ///
    /// Deliberately does NOT write to disk — `save` does, once, when the drag
    /// ends. UserDefaults is cheap but not free, and a drag is a hundred writes.
    func previewWidth(_ id: String, _ width: CGFloat) {
        widths[id] = max(JobsColumnLayout.minWidth, width)
    }

    func commitWidths() {
        defaults.set(widths.mapValues { Double($0) }, forKey: Key.widths)
    }
}
