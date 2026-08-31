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
    }

    private enum Key {
        // Prefixed to match the web's own keys, so the two are recognisably the
        // same setting even though they cannot share storage.
        static let order = "tq_col_order"
        static let labels = "tq_col_labels"
        static let widths = "tq_col_widths"
        static let groupable = "tq_group_cols"
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
