import SwiftUI

// MARK: - The Jobs list grid
//
// The web's "list" sub-view (TRAQS.jsx:11730-12340). Fixed-width columns, a
// column header per section, three levels of row, and the cell renderers at
// :11802.
//
// Every number is lifted, not chosen. `JobsGridMetrics` names them once so a cell
// cannot invent its own padding.

enum JobsGridMetrics {
    /// `cellBase` — `padding: "7px 10px"`, `fontSize: 13`.
    static let cellVPad: CGFloat = 7
    static let cellHPad: CGFloat = 10
    static let cellFont: CGFloat = 13

    /// `hdrCell` — 10pt/700, uppercase, `-0.045em`, `padding: "8px 10px"`.
    static let headerFont: CGFloat = 10
    static let headerVPad: CGFloat = 8
    static var headerTracking: CGFloat { headerFont * -0.045 }

    /// The header's bottom rule is heavier than a row's.
    static let headerRule: CGFloat = 1.5
    static let rowRule: CGFloat = 1

    /// `indent = level * 20`, and the name cell's own left padding: 22 at level 0,
    /// 20 below it.
    static let indentPerLevel: CGFloat = 20
    static let nameLeadTop: CGFloat = 22
    static let nameLeadNested: CGFloat = 20

    /// Rows self-size on the web. Pinned here because the grid is a stack of
    /// fixed-width columns rather than a real table, and rows that each size
    /// themselves make the column rules jitter between them.
    static let rowHeight: CGFloat = 36
    static let headerHeight: CGFloat = 31
}

// MARK: - What a cell needs that a row cannot carry
//
// Built ONCE per render in JobsPage and passed down as a plain value.
//
// This exists for speed, and the problem it fixes is not obvious: a cell that
// reads `@Environment(AppState.self)` registers an observation dependency on
// AppState for ITSELF. With eleven cells a row that is a few hundred observers on
// one object, and any change to any part of AppState invalidates every one of
// them. Dictionaries and an Int instead, so a cell's body touches nothing
// observable and SwiftUI can skip the whole row when nothing it uses changed.
struct JobsCellContext: Equatable {
    var clientsByID: [String: Client] = [:]
    var peopleByID: [String: Person] = [:]
    /// Progress per row, keyed by `JobGridRow.itemID`. Precomputed because the real
    /// figure reads logged hours and live job clocks off AppState, which is
    /// exactly what a cell must not do.
    ///
    /// Covers EVERY level, expanded or not — see `JobsProgress`. It used to be
    /// filled in only for what was on screen, which sounds cheaper and was the
    /// bug: it made the context change shape every time a row was expanded, so
    /// expanding one job invalidated every cell on the page and re-ran the walk
    /// for all of them.
    var percent = JobsProgress.Index()
    /// `TD`, resolved once — so every Due cell in a render agrees on what "today"
    /// is even if the render straddles midnight.
    var today: String = ""
}

// MARK: - Every rule in the grid, as one shape
//
// The column rules used to be an `.overlay` Rectangle on each cell and the row
// rules an overlay on each row. At eleven columns that is TWELVE shape views per
// row, and forty rows made it five hundred — every one its own layer for the
// compositor to walk on every scrolled frame. That was the largest single cost in
// this grid.
//
// The whole network is one Path instead. It can be, because both spacings are
// CONSTANTS: columns are fixed widths and rows are a fixed height, so there is
// nothing to measure and no reason for the lines to be children of the things
// they sit between.
struct JobsGridLines: Shape {
    let columnWidths: [CGFloat]
    let rowCount: Int

    func path(in rect: CGRect) -> Path {
        var path = Path()

        // Column rules, including one after the last column and after the "+"
        // cell — `borderRight` is on `hdrCell` and `cellBase` both, so the web
        // has a rule at every column's right edge.
        var x: CGFloat = 0
        for width in columnWidths {
            x += width
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x, y: rect.height))
        }
        x += JobColumn.addColumnWidth
        path.move(to: CGPoint(x: x, y: 0))
        path.addLine(to: CGPoint(x: x, y: rect.height))

        // Row rules. Below the header's own heavier rule, which is drawn
        // separately because it is 1.5 rather than 1.
        var y = JobsGridMetrics.headerHeight
        for _ in 0..<rowCount {
            y += JobsGridMetrics.rowHeight
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: x, y: y))
        }
        return path
    }
}

// MARK: - What a cell can do
//
// Closures rather than a shared observable object, and the distinction matters
// for the same reason `JobsCellContext` exists: a closure is only CALLED on
// interaction, never during a body evaluation, so passing one down does not make
// a cell an observer of anything it reaches.

struct JobsCellActions {
    /// Write one field. The row carries its own path — see `JobGridRow.editPath`.
    var commit: (JobGridRow, JobsEdit.Field) -> Void = { _, _ in }
    /// Write a CUSTOM column's value. Separate from `commit` because there is no
    /// `JobsEdit.Field` for it: a linked column writes the job field it names, an
    /// invented one writes `_cc_<id>` into `extras`, and `nil` clears it.
    var commitCustom: (JobGridRow, JobsCustomColumn, JSONValue?) -> Void = { _, _, _ in }
    /// Choosing Finished. The web never writes that status directly; it raises a
    /// completion request with the admins (:26530).
    var requestCompletion: (JobGridRow) -> Void = { _ in }
}

/// Which single cell is in edit mode. `gridCell` on the web — one at a time, app
/// wide, so clicking a second cell commits the first.
struct JobsEditTarget: Equatable {
    let rowID: String
    /// `JobsGridColumn.id` — a standard column's raw value, or `_cc_<id>`. A
    /// string rather than `JobColumn` because a custom column can be edited too
    /// and has no case to name.
    let columnID: String
}

// MARK: - A section
//
// One per project manager (TRAQS.jsx:12269): a clickable header — chevron,
// avatar, name, count — over a card holding that manager's jobs.
//
// `marginBottom: 20` between sections; the header is `padding: "4px 2px 8px"`
// with a `gap: 8`.

struct JobsSection<Header: View>: View {
    @Environment(\.tqTheme) private var theme

    let sectionID: String
    let jobs: [Job]
    /// Resolved from the LAYOUT — order, widths and renames already applied.
    /// See `JobsColumnLayout`.
    let columns: [JobsGridColumn]
    let align: JobColumn.Align
    /// How much room the section actually HAS, handed down from the page.
    ///
    /// It cannot be measured here, and that is worth stating because two
    /// attempts at measuring it both silently failed. Every view in this
    /// section's subtree — the card, the Group, even a `.frame(maxWidth:
    /// .infinity)` wrapper — ends up as wide as the grid, because a frame with
    /// an infinite maximum GROWS TO ITS CHILD when the child is wider than the
    /// proposal; it does not clamp to it. So a reader anywhere in here reports
    /// `totalWidth`, `available < totalWidth` is never true, and the scroller is
    /// never installed — the columns past the edge just get clipped by the
    /// card's own shape with no way to reach them.
    ///
    /// The page's own width is imposed by the window rather than by content, so
    /// that is the only honest place to measure it. See `JobsPage.pageSize`.
    let availableWidth: CGFloat
    let context: JobsCellContext
    let actions: JobsCellActions
    @Binding var editing: JobsEditTarget?
    /// The green ring and green count the Finished section uses. nil = accent.
    var accent: Color? = nil
    @Binding var sort: JobsSort
    @Binding var expanded: Set<String>
    @Binding var collapsed: Set<String>
    let selectMode: Bool
    @Binding var selected: Set<String>
    /// A right-click on a row, with the point in the page's coordinate space.
    /// Passed straight through — the section has no opinion about the menu.
    var secondaryClick: (JobGridRow, CGPoint) -> Void = { _, _ in }
    /// What the column header can do — sort, resize, reorder, and open its own
    /// menu. Passed through untouched; the section has no opinion about columns
    /// either.
    var columnActions = JobsColumnActions()
    /// Whatever sits between the chevron and the count — a name, an avatar and a
    /// name, or "✓ Finished". Generic, never AnyView: a type erasure here sits on
    /// the path of every glass shape inside the card.
    @ViewBuilder let header: () -> Header

    private var isCollapsed: Bool { collapsed.contains(sectionID) }
    private var tint: Color { accent ?? theme.accent }
    private var totalWidth: CGFloat {
        columns.reduce(0) { $0 + $1.width } + JobColumn.addColumnWidth
    }

    /// LAZY, and the fixed row height is what makes it work well: a LazyVStack
    /// has to guess at the height of what it has not built, and 36pt every time
    /// means it guesses right.
    ///
    /// It is lazy against the PAGE's vertical scroller, which is why the branch
    /// above matters — a LazyVStack inside a horizontal ScrollView has no
    /// vertical scroller to measure itself against and builds everything.
    private var grid: some View {
        let rows = JobGridRow.flatten(jobs, expanded: expanded)
        return LazyVStack(alignment: .leading, spacing: 0) {
            JobsColumnHeader(columns: columns, sort: $sort, actions: columnActions)
            ForEach(rows) { row in
                JobsGridRow(row: row, columns: columns, align: align,
                            context: context, actions: actions, editing: $editing,
                            expanded: $expanded,
                            selectMode: selectMode, selected: $selected)
            }
        }
        // ONE right-click catcher for the whole section, not one per row and one
        // per header cell.
        //
        // The catcher is an AppKit view, and the first version of this put one on
        // every row AND every header cell — eleven columns and a few hundred rows
        // is a few thousand NSViews whose only job is to notice a click that
        // almost never comes. That is the same kind of per-cell cost the grid
        // lines were collapsed into one Path to avoid.
        //
        // It can be one because the geometry is FIXED: a 31pt header, then rows
        // of exactly 36, and columns of known widths. So which row and which
        // column a point landed on is arithmetic, not a search.
        .overlay { hitCatcher(rows) }
        // The columns stop where they stop; the CARD runs full width, which is
        // what `width: 100%` on FrostCard over a `minWidth: minW` inner div gives
        // on the web.
        //
        // The HEIGHT is stated too, and that is not cosmetic. Once the columns
        // overflow, this stack sits inside a horizontal ScrollView, which offers
        // it an unbounded height — so it would otherwise have to build and
        // measure every row just to report how tall it is. Rows are a fixed 36
        // and the header a fixed 31 (the same constants `JobsGridLines` relies
        // on), so the answer is arithmetic and nothing has to be measured.
        .frame(width: totalWidth,
               height: JobsGridMetrics.headerHeight
                     + CGFloat(rows.count) * JobsGridMetrics.rowHeight,
               alignment: .topLeading)
        // ONE shape for every rule in the section — see JobsGridLines.
        .overlay {
            JobsGridLines(columnWidths: columns.map(\.width), rowCount: rows.count)
                .stroke(theme.border, lineWidth: JobsGridMetrics.rowRule)
                .allowsHitTesting(false)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
            if !isCollapsed { card }
        }
    }

    // MARK: Right-clicks, resolved by arithmetic

    /// Where the grid sits in the page's coordinate space, so a local hit can be
    /// reported as a page point for the menu to be placed at.
    @State private var gridOrigin: CGPoint = .zero

    private func hitCatcher(_ rows: [JobGridRow]) -> some View {
        TQRightClickCatcher { local in
            let page = CGPoint(x: gridOrigin.x + local.x, y: gridOrigin.y + local.y)

            if local.y < JobsGridMetrics.headerHeight {
                guard let column = column(atX: local.x) else { return }
                columnActions.openMenu(column, page)
                return
            }

            let index = Int((local.y - JobsGridMetrics.headerHeight)
                            / JobsGridMetrics.rowHeight)
            guard rows.indices.contains(index) else { return }
            secondaryClick(rows[index], page)
        }
        .onGeometryChange(for: CGPoint.self) {
            $0.frame(in: .named(JobsPage.menuSpace)).origin
        } action: { gridOrigin = $0 }
    }

    /// Walks the widths rather than dividing: columns are not a uniform width.
    /// A point past the last column is over the "+" cell, which is its own
    /// control and not a column, so this returns nil there.
    private func column(atX x: CGFloat) -> JobsGridColumn? {
        var edge: CGFloat = 0
        for column in columns {
            edge += column.width
            if x < edge { return column }
        }
        return nil
    }

    private var headerRow: some View {
        Button {
            withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.18)) {
                if isCollapsed { collapsed.remove(sectionID) } else { collapsed.insert(sectionID) }
            }
        } label: {
            HStack(spacing: 8) {
                WebGlyph(spec: WebIcon.chevronDown, size: 13, color: theme.textDim)
                    .rotationEffect(.degrees(isCollapsed ? -90 : 0))
                header()
                Text("\(jobs.count)")
                    .font(TFont.body(11, 700))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(tint.opacity(0.125)))   // "20"
            }
            .padding(.top, 4)
            .padding(.horizontal, 2)
            .padding(.bottom, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// `FrostCard` (TRAQS.jsx:2437) — `radiusLg`, a 1px border, and a SOLID
    /// `T.card` fill. Its own comment is worth keeping: the frost belongs to the
    /// glass rule now, gated on the Customize toggle, "so off means genuinely
    /// solid here." And NO shadow, which is a hard constraint rather than taste —
    /// the card sits inside the collapse wrapper's `overflow: hidden`, which clips
    /// a shadow to a square box and leaves four corner wedges.
    private var card: some View {
        // NO ScrollView when the columns already fit. A scroller that cannot
        // scroll is not free: it installs a clip and a scroll target, and five of
        // them on a page compete with the page's own for every trackpad gesture.
        //
        // MEASURE THE CONTAINER, NOT THE CONTENT — and that distinction is the
        // whole bug this had. `.onGeometryChange` used to sit directly on the
        // Group, which sizes to `grid`, which is pinned to `totalWidth`. So
        // `available` was ALWAYS exactly `totalWidth`, `available < totalWidth`
        // was never true, the scroller was never installed, and the columns past
        // the window edge were simply clipped away by the card's own shape with
        // no way to reach them.
        //
        // `.frame(maxWidth: .infinity)` first makes the container take the width
        // it is offered; the reader below then measures THAT.
        Group {
            if availableWidth > 0 && availableWidth < totalWidth - 0.5 {
                ScrollView(.horizontal) { grid }
                    // On the trackpad this scrolls with a two-finger swipe; the
                    // bar appears while it does.
                    .scrollIndicators(.automatic)
            } else {
                grid
            }
        }
        // Pinned to what the page said there is — NOT to `min(available,
        // totalWidth)`. Two things depend on it being the full width:
        //
        //   * the ScrollView needs a width SMALLER than its content, or it sizes
        //     to that content and never has anything to scroll;
        //   * the CARD runs full width even when the columns do not fill it,
        //     which is the web's `width: 100%` on FrostCard over a `minWidth`
        //     inner div. Sizing to the columns would leave a ragged right edge
        //     that moves as columns are added.
        .frame(width: availableWidth > 0 ? availableWidth : nil, alignment: .leading)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: TTheme.radiusLg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TTheme.radiusLg, style: .continuous)
                .strokeBorder(accent.map { $0.opacity(0.2) } ?? theme.border, lineWidth: 1)
        }
    }
}

// MARK: - What a column header can do
//
// Closures again, for the reason `JobsCellActions` gives: a header that reached
// for the store would observe it, and there is one header per SECTION — so five
// sections is five observers of the column layout, all invalidating together.

struct JobsColumnActions {
    /// A drag finished. `to` is an index into the full drawn list.
    var move: (_ id: String, _ to: Int) -> Void = { _, _ in }
    /// Live, on every pointer move — not persisted until `endResize`.
    var resize: (_ id: String, _ width: CGFloat) -> Void = { _, _ in }
    var endResize: () -> Void = { }
    /// Right-click, and double-click (which goes straight to rename).
    var openMenu: (_ column: JobsGridColumn, _ point: CGPoint) -> Void = { _, _ in }
    var rename: (_ column: JobsGridColumn, _ point: CGPoint) -> Void = { _, _ in }
    /// The trailing "+" cell.
    var addColumn: (_ point: CGPoint) -> Void = { _ in }
}

// MARK: - The column header
//
// `ColHeaders` (TRAQS.jsx:12190). Every header cell carries five interactions at
// once and they have to stay out of each other's way:
//
//   click        → sort, cycling asc → desc → off
//   drag         → reorder, but only WITHIN the standard or custom run
//   right-click  → the column menu
//   double-click → rename
//   the grip     → resize
//
// The web separates sort from drag by DISTANCE: `startColDrag` tracks the
// pointer, and a release that never moved 4px is treated as a click and sorts
// instead (:11800). Same rule here — `DragGesture(minimumDistance: 4)` never
// begins for a click, so the two cannot both fire.

struct JobsColumnHeader: View {
    @Environment(\.tqTheme) private var theme

    let columns: [JobsGridColumn]
    @Binding var sort: JobsSort
    var actions = JobsColumnActions()

    /// Which column is under the pointer mid-drag, as an index into `columns`.
    /// `colDropIdx` on the web — it draws an accent rule at the insertion point.
    @State private var dropIndex: Int?
    @State private var draggingID: String?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(columns.enumerated()), id: \.element.id) { index, col in
                cell(col, at: index)
            }
            addCell
        }
        .background(theme.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.border).frame(height: JobsGridMetrics.headerRule)
        }
    }

    // MARK: One header cell

    private func cell(_ col: JobsGridColumn, at index: Int) -> some View {
        HStack(spacing: 4) {
            Text(col.label)
                .font(TFont.body(JobsGridMetrics.headerFont, 700))
                .tracking(JobsGridMetrics.headerTracking)
                .textCase(.uppercase)
                .foregroundStyle(isSorted(col) ? theme.accent : theme.textDim)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: col.align.frameAlignment)

            // `⇅` at 0.35 opacity until this is the sorted column. It holds its
            // space either way, so turning sorting on does not nudge the label.
            Text(sortGlyph(col))
                .font(TFont.body(9))
                .foregroundStyle(isSorted(col) ? theme.accent : theme.textDim)
                .opacity(isSorted(col) ? 1 : 0.35)
        }
        .padding(.horizontal, JobsGridMetrics.cellHPad)
        // `paddingLeft: 22` on the Name header, matching its cells, so the label
        // sits over its own text rather than over the expand arrow.
        .padding(.leading, col.standard == .name
                 ? JobsGridMetrics.nameLeadTop - JobsGridMetrics.cellHPad : 0)
        // FIXED, both axes. Never a flexible frame — see JobsGridCell.
        .frame(width: col.width, height: JobsGridMetrics.headerHeight,
               alignment: .leading)
        .background(isSorted(col) ? theme.accent.opacity(0.07) : .clear)
        // The column being dragged fades; the one it would land before gets an
        // accent rule down its leading edge.
        .opacity(draggingID == col.id ? 0.4 : 1)
        .overlay(alignment: .leading) {
            if dropIndex == index, draggingID != col.id {
                Rectangle().fill(theme.accent).frame(width: 2)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { actions.rename(col, .zero) }
        .onTapGesture { sort = sort.cycled(col) }
        .gesture(dragGesture(col, at: index))
        // Right-click is caught by the section, not here — see
        // `JobsSection.hitCatcher`.
        .overlay(alignment: .trailing) { grip(col) }
        .help(helpText(col))
    }

    /// `minimumDistance: 4` — the same 4px threshold `startColDrag` uses to tell
    /// a reorder from a click. Below it the gesture never begins, so the tap
    /// gesture above keeps the event and sorts.
    private func dragGesture(_ col: JobsGridColumn, at index: Int) -> some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .named(JobsPage.menuSpace))
            .onChanged { value in
                draggingID = col.id
                dropIndex = slot(for: value.translation.width, from: index, of: col)
            }
            .onEnded { value in
                let target = slot(for: value.translation.width, from: index, of: col)
                draggingID = nil
                dropIndex = nil
                if target != index { actions.move(col.id, target) }
            }
    }

    /// Where the dragged column would land, walked out from where it started.
    ///
    /// Columns are not a uniform width, so this cannot be `translation / width`.
    /// It steps neighbour by neighbour, crossing one when the pointer has passed
    /// that neighbour's MIDPOINT — which is the same rule the web's loop applies
    /// with `me.clientX < r.left + r.width / 2`.
    ///
    /// Clamped to the dragged column's own RUN. A standard column dragged past
    /// the last one stops there rather than landing among the custom columns,
    /// where it would silently not move.
    private func slot(for dx: CGFloat, from index: Int, of col: JobsGridColumn) -> Int {
        let run = runBounds(for: col)
        var target = index
        var travelled: CGFloat = 0

        if dx > 0 {
            var next = index + 1
            while next < run.upperBound {
                travelled += columns[next].width
                if dx < travelled - columns[next].width / 2 { break }
                target = next
                next += 1
            }
        } else if dx < 0 {
            var next = index - 1
            while next >= run.lowerBound {
                travelled -= columns[next].width
                if dx > travelled + columns[next].width / 2 { break }
                target = next
                next -= 1
            }
        }
        return target
    }

    /// The half of the list this column may move within: the standard run, or
    /// the custom run after it.
    private func runBounds(for col: JobsGridColumn) -> Range<Int> {
        let firstCustom = columns.firstIndex { $0.isCustom } ?? columns.count
        return col.isCustom ? firstCustom..<columns.count : 0..<firstCustom
    }

    // MARK: The resize grip
    //
    // A 6pt strip on the column's trailing edge. `.onHover` swaps the cursor,
    // because a grip you cannot see has to announce itself somehow.

    private func grip(_ col: JobsGridColumn) -> some View {
        Rectangle()
            .fill(Color.clear)
            .frame(width: 6)
            .contentShape(Rectangle())
            // SwiftUI's own cursor, not `NSCursor.push()`/`pop()`.
            //
            // Driving the AppKit cursor stack from `.onHover` mutates AppKit
            // state from inside a SwiftUI update, which is what produces
            // "Invalid attempt to open a new transaction during CA commit …
            // NSCGSTransactionCreatedDuringCommitError" in the console. It also
            // leaks: a pointer that leaves during a drag never balances its push,
            // and the resize cursor sticks.
            .pointerStyle(.columnResize)
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { actions.resize(col.id, col.width + $0.translation.width) }
                    .onEnded { _ in actions.endResize() }
            )
    }

    // MARK: The "+" cell

    private var addCell: some View {
        Button { } label: {
            WebGlyph(spec: WebIcon.plus, size: 12, color: theme.textDim)
                .frame(width: JobColumn.addColumnWidth,
                       height: JobsGridMetrics.headerHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // The point comes from the button's own frame rather than from a click
        // location: this picker hangs UNDER the "+" like a dropdown, where the
        // row menu follows the pointer.
        .overlay {
            GeometryReader { geo in
                let frame = geo.frame(in: .named(JobsPage.menuSpace))
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        actions.addColumn(CGPoint(x: frame.minX, y: frame.maxY))
                    }
            }
        }
        .help("Add column")
    }

    // MARK: -

    private func isSorted(_ col: JobsGridColumn) -> Bool {
        guard let standard = col.standard else { return false }
        return sort.column == standard
    }

    private func sortGlyph(_ col: JobsGridColumn) -> String {
        guard isSorted(col) else { return "\u{21C5}" }      // ⇅
        return sort.ascending ? "\u{25B2}" : "\u{25BC}"     // ▲ ▼
    }

    private func helpText(_ col: JobsGridColumn) -> String {
        col.standard == nil
            ? "\(col.label) — drag to reorder, right-click for options"
            : "Sort by \(col.label) — drag to reorder, right-click for options"
    }
}

extension JobsSort {
    /// Sorting is only defined for the standard columns; a custom column has no
    /// comparator, so clicking its header does nothing rather than clearing the
    /// sort somebody set.
    func cycled(_ column: JobsGridColumn) -> JobsSort {
        guard let standard = column.standard else { return self }
        return cycled(standard)
    }
}

// MARK: - One row

struct JobsGridRow: View {
    @Environment(\.tqTheme) private var theme

    let row: JobGridRow
    let columns: [JobsGridColumn]
    let align: JobColumn.Align
    let context: JobsCellContext
    let actions: JobsCellActions
    @Binding var editing: JobsEditTarget?
    @Binding var expanded: Set<String>
    let selectMode: Bool
    @Binding var selected: Set<String>

    @State private var hovering = false

    var body: some View {
        HStack(spacing: 0) {
            ForEach(columns) { col in
                // Two cell families, dispatched here rather than inside one
                // giant cell: a standard column is a known field with its own
                // renderer, a custom one is a value looked up by key. Merging
                // them would put a `switch` over six value TYPES inside a
                // `switch` over eleven COLUMNS.
                switch col.kind {
                case .standard(let standard):
                    JobsGridCell(row: row, column: standard, width: col.width,
                                 align: align, context: context,
                                 actions: actions, editing: $editing,
                                 expanded: expanded, selected: selected,
                                 selectMode: selectMode)
                case .custom(let custom):
                    JobsCustomCell(row: row, column: custom, width: col.width,
                                   align: col.align, context: context,
                                   actions: actions, editing: $editing)
                }
            }
            // Matches the header's trailing "+" cell so both rows end together.
            Color.clear.frame(width: JobColumn.addColumnWidth,
                              height: JobsGridMetrics.rowHeight)
        }
        .background(background)
        // `opacity: isFinished && level === 0 ? 0.6 : 1`.
        .opacity(row.level == 0 && row.status == .finished ? 0.6 : 1)
        .onHover { hovering = $0 }
        // Before the gesture, so the whole row strip is hittable — including any
        // gap past the last column. Without it a click there hits nothing.
        .contentShape(Rectangle())
        .onTapGesture { tap() }
        // No right-click handling here — the SECTION catches those for every row
        // at once. See `JobsSection.hitCatcher`.
    }

    /// `T.accent + "0d"` on hover — 5%, deliberately faint: rows are frosted over
    /// the page background and anything stronger reads as a selection.
    private var background: Color {
        if selectMode && row.level == 0 && selected.contains(row.itemID) {
            return theme.accent.opacity(0.07)   // `T.accent + "12"`
        }
        return hovering ? theme.accent.opacity(0.05) : .clear
    }

    private func tap() {
        // A commit in progress takes the click. Otherwise clicking away from a
        // field you are editing also collapses the row under it.
        if editing != nil { editing = nil; return }
        if selectMode && row.level == 0 {
            if selected.contains(row.itemID) { selected.remove(row.itemID) }
            else { selected.insert(row.itemID) }
            return
        }
        guard row.hasChildren else { return }
        withAnimation(.easeOut(duration: 0.16)) {
            if expanded.contains(row.itemID) { expanded.remove(row.itemID) }
            else { expanded.insert(row.itemID) }
        }
    }
}

// MARK: - One cell
//
// THE CELL OWNS ITS WIDTH, and it is a FIXED frame. This is the fix for columns
// that drifted out of line on nested rows: a `#`, Client or Due cell has nothing
// to show below level 0, that produced an `EmptyView`, and an EmptyView takes no
// space no matter what flexible frame is wrapped around it — so every column
// after it slid left by that column's width, on that row only.
//
// Two rules follow, and both matter:
//   * the frame is `width:`/`height:`, never `maxWidth:`, so it cannot depend on
//     content at all;
//   * a blank cell renders `Color.clear`, never nothing.

private struct JobsGridCell: View {
    @Environment(\.tqTheme) private var theme

    let row: JobGridRow
    let column: JobColumn
    /// From the LAYOUT, not from `column.defaultWidth` — the column may have
    /// been resized. See `JobsColumnLayout`.
    let width: CGFloat
    let align: JobColumn.Align
    let context: JobsCellContext
    let actions: JobsCellActions
    @Binding var editing: JobsEditTarget?
    /// Read-only copies. A cell never writes these, and taking them as values
    /// rather than Bindings keeps a row's cells from invalidating each other.
    let expanded: Set<String>
    let selected: Set<String>
    let selectMode: Bool

    /// Per-cell, not page-level. A popover anchors to the view that presents it,
    /// and only one cell can be clicked at a time anyway.
    @State private var statusOpen = false
    @State private var dateOpen = false
    @State private var dueOpen = false

    var body: some View {
        content
            .padding(.horizontal, JobsGridMetrics.cellHPad)
            .padding(.vertical, JobsGridMetrics.cellVPad)
            .frame(width: width,
                   height: JobsGridMetrics.rowHeight,
                   alignment: cellAlignment)
            // THE WHOLE CELL IS THE TARGET, padding included.
            //
            // The web puts every cell's `onClick` on the cell DIV, so clicking
            // anywhere in the box opens the picker — not just on the pill or the
            // text. Hanging the gesture off the content instead left most of each
            // cell dead, and a click there fell through to the row and expanded it
            // rather than doing what the cell said it would.
            //
            // A cell with no action of its own gets the shape but no gesture, so
            // its clicks DO fall through to the row — which is also what the web
            // does, and is what makes clicking a job's Client or Hours cell expand
            // it.
            .contentShape(Rectangle())
            .modifier(JobsCellTap(action: wholeCellTap))
            // NO `.clipped()`. It was on all eleven cells, and a clip is a mask
            // layer — four hundred of them across a page, purely so nothing
            // overflows. Nothing does: every Text truncates, and the two pills
            // that could grow past their column now cap their own width. A mask
            // per cell to prevent overflow that cannot happen is the definition of
            // paying for nothing.
    }

    /// The width a cell has for content, after its own padding. Used where
    /// something has to be told not to outgrow its column.
    private var contentWidth: CGFloat {
        width - JobsGridMetrics.cellHPad * 2
    }

    // MARK: Edit plumbing

    private var isEditing: Bool {
        editing == JobsEditTarget(rowID: row.id, columnID: column.rawValue)
    }

    /// Enters edit mode only where the web allows it. `isEditable` holds the
    /// per-level rules in one place — see JobsEdit.
    private func beginEditing(_ field: JobsEdit.Field) {
        guard JobsEdit.isEditable(field, atLevel: row.level) else { return }
        editing = JobsEditTarget(rowID: row.id, columnID: column.rawValue)
    }

    private func commit(_ field: JobsEdit.Field) {
        editing = nil
        guard JobsEdit.isEditable(field, atLevel: row.level) else { return }
        actions.commit(row, field)
    }

    /// What clicking anywhere in this cell does, or nil to let the click reach
    /// the row. One place, so a cell's hit area and its behaviour cannot drift
    /// apart the way they had.
    ///
    /// Name is nil on purpose: a SINGLE click on a name belongs to the row (it
    /// expands), and only a double click starts editing the title — which the
    /// title text handles itself.
    private var wholeCellTap: (() -> Void)? {
        switch column {
        case .status:
            return { statusOpen = true }
        case .pri:
            // Level 0 only — `if (level === 0) cyclePri(item)`. Below that the
            // click belongs to the row.
            guard JobsEdit.isEditable(.priority(row.priority), atLevel: row.level)
            else { return nil }
            return { actions.commit(row, .priority(JobsEdit.nextPriority(after: row.priority))) }
        case .jobNum:
            guard row.level == 0 else { return nil }
            return { beginEditing(.jobNumber(row.job?.jobNumber ?? "")) }
        case .start, .end:
            return { dateOpen = true }
        case .due:
            guard row.level == 0 else { return nil }
            return { dueOpen = true }
        case .name, .client, .hrs, .progress, .team:
            return nil
        }
    }

    /// The cycling toggle moves the ordinary cells. Name, Priority and Progress
    /// keep their own — the web overrides `justifyContent` on each of those three,
    /// so the toggle never touched them either.
    private var cellAlignment: Alignment {
        switch column {
        case .name, .progress: return .leading
        case .pri:             return .center
        default:               return align.frameAlignment
        }
    }

    @ViewBuilder
    private var content: some View {
        switch column {
        case .name:     nameCell
        case .jobNum:   jobNumCell
        case .client:   clientCell
        case .status:   statusCell
        case .pri:      priorityCell
        case .start:    dateCell(row.start) { .start($0) }
        case .end:      dateCell(row.end) { .end($0) }
        case .due:      dueCell
        case .hrs:      hoursCell
        case .progress: progressCell
        case .team:     teamCell
        }
    }

    // MARK: Name

    private var nameCell: some View {
        HStack(spacing: 7) {
            // Holds its space when there are no children — `visibility: hidden`,
            // not `display: none`, so every title in the column starts at the
            // same x whether the row expands or not.
            // A Shape, not a WebGlyph. Every other glyph in the app can be a
            // Canvas because there are a handful on screen; this one is once per
            // row, and a Canvas is a drawing surface the renderer re-enters each
            // frame. Three points do not need one.
            JobsRowCaret()
                .stroke(theme.textDim,
                        style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                .frame(width: 10, height: 10)
                .rotationEffect(.degrees(expanded.contains(row.itemID) ? 90 : 0))
                .opacity(row.hasChildren ? 1 : 0)
                .allowsHitTesting(false)

            if row.level == 0 && selectMode {
                selectionDot
            } else if row.level == 0 {
                // `⠿` at 0.22 — the drag handle. Row reordering is not ported, so
                // this is the affordance without the behaviour; drawn anyway
                // because its width is what keeps titles aligned with the select
                // mode that replaces it.
                Text("\u{283F}")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textDim.opacity(0.22))
            } else if row.level == 1 {
                Circle().fill(Color.hex(row.status.hex).opacity(0.8))
                    .frame(width: 5, height: 5)
            } else {
                Circle().fill(theme.textDim.opacity(0.5))
                    .frame(width: 4, height: 4)
            }

            if isEditing {
                JobsInlineField(text: row.title,
                                font: TFont.body(row.level == 0 ? 13 : 12,
                                                 row.level == 0 ? 700 : (row.level == 1 ? 600 : 500)),
                                accent: theme.accent, ink: theme.text) { value in
                    commit(.title(value))
                } cancel: { editing = nil }
            } else {
                Text(row.title)
                    .font(TFont.body(row.level == 0 ? 13 : 12,
                                     row.level == 0 ? 700 : (row.level == 1 ? 600 : 500)))
                    .foregroundStyle(row.level == 2 ? theme.textSec : theme.text)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // DOUBLE click, not single — a single click belongs to the
                    // row, which expands it or picks it in select mode.
                    .onTapGesture(count: 2) {
                        if !selectMode { beginEditing(.title(row.title)) }
                    }
            }
        }
        // `paddingLeft: (level === 0 ? 22 : 20) + indent`, less the cell's own 10
        // which is already applied.
        .padding(.leading, (row.level == 0 ? JobsGridMetrics.nameLeadTop
                                           : JobsGridMetrics.nameLeadNested)
                 + CGFloat(row.level) * JobsGridMetrics.indentPerLevel
                 - JobsGridMetrics.cellHPad)
    }

    private var selectionDot: some View {
        let on = selected.contains(row.itemID)
        return Circle()
            .strokeBorder(on ? theme.accent : theme.border, lineWidth: 2)
            .background(Circle().fill(on ? theme.accent : .clear))
            .frame(width: 15, height: 15)
            .overlay {
                if on { WebGlyph(spec: WebIcon.tick, size: 7, color: .white) }
            }
    }

    // MARK: Number

    @ViewBuilder
    private var jobNumCell: some View {
        if isEditing {
            JobsInlineField(text: row.job?.jobNumber ?? "", font: TFont.mono(11, 600),
                            accent: theme.accent, ink: theme.text) { value in
                commit(.jobNumber(value))
            } cancel: { editing = nil }
        } else if let number = row.job?.jobNumber, !number.isEmpty {
            Text("#\(number)")
                .font(TFont.mono(11, 600))
                .foregroundStyle(theme.text)
                .lineLimit(1)
        } else if row.level == 0 {
            dash(11, mono: true)
        } else {
            // A panel has no number of its own and the web leaves the cell empty
            // — but EMPTY, not absent. See the note above `JobsGridCell`.
            Color.clear
        }
    }

    // MARK: Client

    @ViewBuilder
    private var clientCell: some View {
        if row.level == 0 {
            if let id = row.job?.clientId, let client = context.clientsByID[id] {
                HStack(spacing: 5) {
                    Circle().fill(Color.hex(client.color)).frame(width: 6, height: 6)
                    Text(client.name)
                        .font(TFont.body(12, 600))
                        .foregroundStyle(Color.hex(client.color))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            } else {
                dash(12)
            }
        } else if row.level == 1 {
            // A panel's client cell carries its op COUNT instead. Not an oversight
            // in the web — the column is wide, a panel has no client, so it is
            // reused.
            Text("\(row.childCount) op\(row.childCount == 1 ? "" : "s")")
                .font(TFont.body(11))
                .foregroundStyle(theme.textDim)
        } else {
            Color.clear
        }
    }

    // MARK: Status

    private var statusCell: some View {
        statusPill
            // The popover modifier is installed ONLY WHILE OPEN. Attached
            // unconditionally it is a presentation anchor that exists on every
            // cell of every row — four per row here, across status, start, end and
            // due — and they cost their keep whether or not anything is showing.
            .overlay {
                if statusOpen {
                    Color.clear.popover(isPresented: $statusOpen, arrowEdge: .bottom) {
                        JobsOptionList(options: JobsOptionList.statusOptions(),
                                       current: row.status.rawValue) { picked in
                            statusOpen = false
                            guard let status = JobStatus(rawValue: picked),
                                  status != row.status else { return }
                            // Finished never gets written straight in — it raises
                            // a completion request with the admins.
                            if JobsEdit.needsCompletionRequest(status) {
                                actions.requestCompletion(row)
                            } else {
                                actions.commit(row, .status(status))
                            }
                        }
                    }
                }
            }
    }

    private var statusPill: some View {
        let color = Color.hex(row.status.hex)
        return HStack(spacing: 5) {
            // A fixed 12pt slot, so the emblems — which differ in width despite
            // being one Unicode family — cannot shift the label between rows.
            Text(row.status.emblem)
                .font(TFont.body(11))
                .frame(width: 12)
            Text(row.status.rawValue)
                .font(TFont.body(10, 700))
                .tracking(10 * -0.045)
                .textCase(.uppercase)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        // `maxWidth: "100%"` on the web's pill. This is what makes dropping the
        // per-cell clip safe: the only thing in a cell that could grow past its
        // column now refuses to.
        .frame(maxWidth: contentWidth, alignment: .leading)
        .background(Capsule().fill(color.opacity(0.125)))                    // "20"
        .overlay(Capsule().strokeBorder(color.opacity(0.27), lineWidth: 1))  // "44"
    }

    // MARK: Priority

    private var priorityCell: some View {
        let color = Color.hex(row.priority.hex)
        let editable = JobsEdit.isEditable(.priority(row.priority), atLevel: row.level)
        return Text(row.priority.rawValue)
            .font(TFont.body(11, 700))
            .tracking(11 * -0.045)
            .textCase(.uppercase)
            .lineLimit(1)
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .frame(maxWidth: contentWidth)
            .background(Capsule().fill(color.opacity(0.10)))                 // "1a"
            .overlay(Capsule().strokeBorder(color.opacity(0.27), lineWidth: 1))
            // `cyclePri` — a click steps to the next priority and wraps. No
            // popover on the web; three values do not need a list. The click is
            // taken by the whole cell — see `wholeCellTap`.
    }

    // MARK: Dates

    /// Start and End. Both editable at every level.
    private func dateCell(_ day: String, _ field: @escaping (String) -> JobsEdit.Field)
        -> some View {
        Text(JobsDate.short(day))
            .font(TFont.mono(12))
            .foregroundStyle(theme.textSec)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: cellAlignment.horizontalOnly)
            .overlay {
                if dateOpen {
                    Color.clear.popover(isPresented: $dateOpen, arrowEdge: .bottom) {
                        JobsDatePopover(day: day) { picked in
                            dateOpen = false
                            actions.commit(row, field(picked))
                        }
                    }
                }
            }
    }

    @ViewBuilder
    private var dueCell: some View {
        if row.level == 0, let due = row.job?.dueDate, !due.isEmpty {
            let overdue = due < context.today
            let soon = !overdue && due <= JobsDate.adding(days: 3, to: context.today)
            Text(JobsDate.short(due) + (overdue ? " !" : ""))
                .font(TFont.mono(12, overdue ? 700 : 400))
                .foregroundStyle(overdue ? Color.hex("#ef4444")
                                 : (soon ? Color.hex("#f59e0b") : theme.textSec))
                .lineLimit(1)
                .overlay { duePopover(due) }
        } else if row.level == 0 {
            dash(12, mono: true)
                .overlay { duePopover("") }
        } else {
            Color.clear
        }
    }

    @ViewBuilder
    private func duePopover(_ due: String) -> some View {
        if dueOpen {
            Color.clear.popover(isPresented: $dueOpen, arrowEdge: .bottom) {
                JobsDatePopover(day: due, clearable: true) { picked in
                    dueOpen = false
                    actions.commit(row, .dueDate(picked.isEmpty ? nil : picked))
                }
            }
        }
    }

    // MARK: Hours

    @ViewBuilder
    private var hoursCell: some View {
        let hours = row.estimatedHours
        if hours > 0 {
            HStack(spacing: 3) {
                Text(JobsDate.hours(hours) + "h")
                    .font(TFont.mono(12, row.level == 1 ? 700 : 400))
                    .foregroundStyle(row.level == 1 ? theme.text : theme.textSec)
                    .lineLimit(1)
                // A panel also prints how many ops those hours are spread over.
                if row.level == 1 && row.childCount > 0 {
                    Text("/ \(row.childCount)")
                        .font(TFont.mono(10))
                        .foregroundStyle(theme.textDim)
                        .lineLimit(1)
                }
            }
        } else {
            dash(12, mono: true)
        }
    }

    // MARK: Progress

    private var progressCell: some View {
        let pct = context.percent[row.itemID]
        let color = Color.hex(ProgressRamp.hex(pct, belowForty: "#94a3b8"))
        let counts = row.finishedAndTotalOps
        // The bar's width is COMPUTED, not measured. A GeometryReader here is one
        // per row, and a reader is a layout container that re-proposes to its
        // child — the single biggest cost in a grid this shape. The column's width
        // is known and the padding is a constant, so there is nothing to measure.
        //
        // `contentWidth`, not `column.defaultWidth`: the Progress column can be
        // resized, and reading the default would leave the bar the original width
        // inside a narrower cell.
        let barWidth = contentWidth
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text("\(pct)%")
                    .font(TFont.body(10, 700))
                    .foregroundStyle(color)
                Spacer(minLength: 0)
                if counts.total > 0 {
                    Text(row.level == 0
                         ? "\(counts.finished)/\(counts.total) ops"
                         : "\(counts.finished)/\(counts.total)")
                        .font(TFont.body(9))
                        .foregroundStyle(theme.textDim)
                        .lineLimit(1)
                }
            }
            // Track is `T.border`; the fill stops at 100 — "bars stop at full; the
            // number carries the overrun."
            ZStack(alignment: .leading) {
                Capsule().fill(theme.border)
                Capsule().fill(color)
                    .frame(width: barWidth * ProgressRamp.barFraction(pct))
            }
            .frame(width: barWidth, height: 4)
        }
    }

    // MARK: Team

    @ViewBuilder
    private var teamCell: some View {
        if row.level == 0 {
            let members = row.team.compactMap { context.peopleByID[$0] }
            HStack(spacing: 4) {
                ForEach(members.prefix(4), id: \.id) { person in
                    JobsAvatar(person: person, size: 22).help(person.name)
                }
                if members.count > 4 {
                    Text("+\(members.count - 4)")
                        .font(TFont.body(10))
                        .foregroundStyle(theme.textDim)
                }
            }
        } else if let assignee = row.team.first, let person = context.peopleByID[assignee] {
            HStack(spacing: 5) {
                JobsAvatar(person: person, size: 18)
                Text(person.name.split(separator: " ").first.map(String.init) ?? person.name)
                    .font(TFont.body(11, 600))
                    .foregroundStyle(Color.hex(row.jobColor))
                    .lineLimit(1)
            }
        } else {
            Text("—")
                .font(TFont.body(11).italic())
                .foregroundStyle(theme.textDim)
        }
    }

    // MARK: Shared

    private func dash(_ size: CGFloat, mono: Bool = false) -> some View {
        Text("—")
            .font(mono ? TFont.mono(size) : TFont.body(size))
            .foregroundStyle(theme.textDim)
    }
}

/// `polyline points="3,2 7,5 3,8"` in its own 10x10 box — the row's expand arrow.
struct JobsRowCaret: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 10
        var p = Path()
        p.move(to: CGPoint(x: 3 * s, y: 2 * s))
        p.addLine(to: CGPoint(x: 7 * s, y: 5 * s))
        p.addLine(to: CGPoint(x: 3 * s, y: 8 * s))
        return p
    }
}

// MARK: - The team avatar
//
// Initials on the person's own colour, exactly as the sidebar's profile avatar
// does — see NativeShell. No photo lookup: the sidebar does not do one either,
// and half a column loading images while the rest shows initials looks worse than
// a consistent set of marks.

struct JobsAvatar: View {
    let person: Person
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(Color.hex(person.color))
            .frame(width: size, height: size)
            .overlay {
                Text(Initials.from(person.name))
                    .font(TFont.body(size * 0.34, 800))
                    .foregroundStyle(.white)
            }
    }
}

// MARK: - Dates and numbers, formatted the web's way

enum JobsDate {

    /// `TD` — today as a LOCAL `yyyy-MM-dd`. The web's `toDS` reads
    /// `getFullYear/getMonth/getDate`, so "overdue" turns over at the user's
    /// midnight rather than London's. `AppState.ymd` pins GMT for server date keys
    /// and is the wrong helper for this.
    static var todayKey: String { keyFormatter.string(from: Date()) }

    /// `safeDate` — `toLocaleDateString("en-US", { month: "short", day: "numeric" })`,
    /// so "Mar 10". An unparseable day gives the em dash the web gives, rather
    /// than today's date or a crash.
    static func short(_ day: String) -> String {
        guard let date = parse(day) else { return "—" }
        return shortFormatter.string(from: date)
    }

    /// `addD` — parsed at NOON, as every date helper in this app is, so a DST
    /// transition cannot shift the answer by a day.
    static func adding(days: Int, to day: String) -> String {
        guard let date = parse(day),
              let moved = Calendar.current.date(byAdding: .day, value: days, to: date)
        else { return day }
        return keyFormatter.string(from: moved)
    }

    /// One decimal, and no trailing ".0" — the web prints `7.5h` and `8h`, never
    /// `8.0h`, because `Math.round(x * 10) / 10` drops it in JavaScript.
    static func hours(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        return rounded == rounded.rounded()
            ? String(Int(rounded))
            : String(format: "%.1f", rounded)
    }

    /// A `Date` for a `yyyy-MM-dd` day, at noon — so a picker cannot round it
    /// into the previous day in a western timezone.
    static func date(from day: String) -> Date? { parse(day) }

    /// The inverse. Local, matching `todayKey`.
    static func key(from date: Date) -> String { keyFormatter.string(from: date) }

    private static func parse(_ day: String) -> Date? {
        guard !day.isEmpty else { return nil }
        return noonFormatter.date(from: day + "T12:00:00")
    }

    private static let noonFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static let shortFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        f.locale = Locale(identifier: "en_US")
        return f
    }()
}

extension JobColumn.Align {
    var frameAlignment: Alignment {
        switch self {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }
}

// MARK: - An optional tap
//
// `.onTapGesture` cannot be applied conditionally inside a view builder without
// changing the view's type, and a cell whose type depends on whether it happens
// to be interactive re-creates itself whenever that changes. A modifier that
// takes an optional closure keeps one type for every cell.
struct JobsCellTap: ViewModifier {
    let action: (() -> Void)?

    func body(content: Content) -> some View {
        // `allowsHitTesting` is NOT the lever here: the cell must stay hittable
        // either way, so that a cell with no action of its own still gives the
        // ROW something to receive the click on.
        if let action {
            content.onTapGesture(perform: action)
        } else {
            content
        }
    }
}
