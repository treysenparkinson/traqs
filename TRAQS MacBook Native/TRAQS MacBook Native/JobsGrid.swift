import SwiftUI

// MARK: - The Jobs list grid
//
// The web's "list" sub-view (TRAQS.jsx:11730-12340). A fixed-width column grid
// with a sticky header, three levels of row, and the cell renderers at :11802.
//
// Every number here is lifted, not chosen. `JobsGridMetrics` names them once so a
// cell cannot invent its own padding.

enum JobsGridMetrics {
    /// `cellBase` — `padding: "7px 10px"`, `fontSize: 13`.
    static let cellVPad: CGFloat = 7
    static let cellHPad: CGFloat = 10
    static let cellFont: CGFloat = 13

    /// `hdrCell` — 10pt/700, uppercase, `-0.045em`, `padding: "8px 10px"`.
    static let headerFont: CGFloat = 10
    static let headerVPad: CGFloat = 8
    static var headerTracking: CGFloat { headerFont * -0.045 }

    /// The header's own bottom rule is heavier than a row's.
    static let headerRule: CGFloat = 1.5
    static let rowRule: CGFloat = 1

    /// `indent = level * 20`, and the name cell's own left padding: 22 at level 0,
    /// 20 below it.
    static let indentPerLevel: CGFloat = 20
    static let nameLeadTop: CGFloat = 22
    static let nameLeadNested: CGFloat = 20

    /// A row's height is set by its content on the web. Pinned here because the
    /// grid is a stack of fixed-width columns rather than a real table, and rows
    /// that each size themselves make the column rules jitter between them.
    static let rowHeight: CGFloat = 36
}

// MARK: A section
//
// One per project manager (TRAQS.jsx:12269). A clickable header — chevron,
// avatar, name, count — over a card holding that manager's jobs.
//
// `marginBottom: 20` between sections; the header is `padding: "4px 2px 8px"`
// with a `gap: 8`.

struct JobsSection<Header: View>: View {
    @Environment(\.tqTheme) private var theme

    let sectionID: String
    let jobs: [Job]
    let columns: [JobColumn]
    let align: JobColumn.Align
    /// The green ring and green count the Finished section uses. nil = accent.
    var accent: Color? = nil
    @Binding var sort: JobsSort
    @Binding var expanded: Set<String>
    @Binding var collapsed: Set<String>
    let selectMode: Bool
    @Binding var selected: Set<String>
    /// Whatever sits between the chevron and the count — a name, an avatar and a
    /// name, or "✓ Finished". Generic, never AnyView: a type erasure here is on
    /// the path of every glass shape inside the card.
    @ViewBuilder let header: () -> Header

    private var isCollapsed: Bool { collapsed.contains(sectionID) }
    private var tint: Color { accent ?? theme.accent }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
            if !isCollapsed { card }
        }
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
    /// solid here."
    private var card: some View {
        // Horizontal scrolling is PER CARD, as on the web: FrostCard's inner
        // `tq-card-scroll` is `overflow: auto` and the columns are fixed widths.
        // The page does not scroll sideways — each section does.
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                JobsColumnHeader(columns: columns, sort: $sort)
                ForEach(JobRow.flatten(jobs, expanded: expanded)) { row in
                    JobsGridRow(row: row, columns: columns, align: align,
                                expanded: $expanded,
                                selectMode: selectMode, selected: $selected)
                }
            }
            .frame(width: totalWidth, alignment: .leading)
        }
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: TTheme.radiusLg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TTheme.radiusLg, style: .continuous)
                .strokeBorder(accent.map { $0.opacity(0.2) } ?? theme.border, lineWidth: 1)
        }
    }

    private var totalWidth: CGFloat {
        columns.reduce(0) { $0 + $1.defaultWidth } + JobColumn.addColumnWidth
    }
}

// MARK: The column header

struct JobsColumnHeader: View {
    @Environment(\.tqTheme) private var theme

    let columns: [JobColumn]
    @Binding var sort: JobsSort

    var body: some View {
        HStack(spacing: 0) {
            ForEach(columns) { col in
                Button { sort = sort.cycled(col) } label: {
                    HStack(spacing: 4) {
                        Text(col.label)
                            .font(TFont.body(JobsGridMetrics.headerFont, 700))
                            .tracking(JobsGridMetrics.headerTracking)
                            .textCase(.uppercase)
                            .foregroundStyle(sorted(col) ? theme.accent : theme.textDim)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: col.align.frameAlignment)

                        // `⇅` at 0.35 opacity until this is the sorted column. It
                        // holds its space either way, so turning sorting on does
                        // not nudge the label.
                        Text(sortGlyph(col))
                            .font(TFont.body(9))
                            .foregroundStyle(sorted(col) ? theme.accent : theme.textDim)
                            .opacity(sorted(col) ? 1 : 0.35)
                    }
                    .padding(.horizontal, JobsGridMetrics.cellHPad)
                    // `paddingLeft: 22` on the Name header, matching its cells, so
                    // the label sits over its own text rather than over the
                    // expand arrow.
                    .padding(.leading, col == .name
                             ? JobsGridMetrics.nameLeadTop - JobsGridMetrics.cellHPad : 0)
                    .padding(.vertical, JobsGridMetrics.headerVPad)
                    .frame(width: col.defaultWidth, alignment: .leading)
                    .background(sorted(col) ? theme.accent.opacity(0.07) : .clear)
                    .overlay(alignment: .trailing) {
                        Rectangle().fill(theme.border).frame(width: 1)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Sort by \(col.label)")
            }

            // The trailing "+" cell. Present so the header's width matches the
            // rows' and the last column's rule lands where it does on the web;
            // the column picker behind it is not ported.
            Text("+")
                .font(TFont.body(18, 400))
                .foregroundStyle(theme.textDim.opacity(0.5))
                .frame(width: JobColumn.addColumnWidth)
                .frame(maxHeight: .infinity)
                .help("Add column — not ported yet")
        }
        .background(theme.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.border).frame(height: JobsGridMetrics.headerRule)
        }
    }

    private func sorted(_ col: JobColumn) -> Bool { sort.column == col }

    private func sortGlyph(_ col: JobColumn) -> String {
        guard sorted(col) else { return "\u{21C5}" }        // ⇅
        return sort.ascending ? "\u{25B2}" : "\u{25BC}"     // ▲ ▼
    }
}

// MARK: One row

struct JobsGridRow: View {
    @Environment(\.tqTheme) private var theme

    let row: JobRow
    let columns: [JobColumn]
    let align: JobColumn.Align
    @Binding var expanded: Set<String>
    let selectMode: Bool
    @Binding var selected: Set<String>

    @State private var hovering = false

    var body: some View {
        HStack(spacing: 0) {
            ForEach(columns) { col in
                JobsGridCell(row: row, column: col, align: align,
                             expanded: $expanded,
                             selectMode: selectMode, selected: $selected)
                    .frame(width: col.defaultWidth)
                    .frame(height: JobsGridMetrics.rowHeight)
                    .overlay(alignment: .trailing) {
                        Rectangle().fill(theme.border).frame(width: 1)
                    }
            }
            Color.clear.frame(width: JobColumn.addColumnWidth)
        }
        .background(background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.border).frame(height: JobsGridMetrics.rowRule)
        }
        // `opacity: isFinished && level === 0 ? 0.6 : 1`.
        .opacity(row.level == 0 && row.status == .finished ? 0.6 : 1)
        .onHover { hovering = $0 }
        .onTapGesture { tap() }
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

// MARK: One cell

private struct JobsGridCell: View {
    @Environment(\.tqTheme) private var theme
    @Environment(AppState.self) private var appState

    let row: JobRow
    let column: JobColumn
    let align: JobColumn.Align
    @Binding var expanded: Set<String>
    let selectMode: Bool
    @Binding var selected: Set<String>

    var body: some View {
        content
            .padding(.horizontal, JobsGridMetrics.cellHPad)
            .padding(.vertical, JobsGridMetrics.cellVPad)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: cellAlignment)
            // `overflow: hidden` on `cellBase`. A status pill wider than its
            // column is cut at the column's edge rather than drawn across the
            // next one — which is what the 132pt Status column relies on.
            .clipped()
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
        case .start:    dateCell(row.start)
        case .end:      dateCell(row.end)
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
            WebGlyph(spec: WebIcon.rowCaret, size: 10, color: theme.textDim)
                .rotationEffect(.degrees(expanded.contains(row.itemID) ? 90 : 0))
                .opacity(row.hasChildren ? 1 : 0)
                .allowsHitTesting(false)

            if row.level == 0 && selectMode {
                selectionDot
            } else if row.level == 0 {
                // `⠿` at 0.22 — the drag handle. Row reordering is not ported, so
                // this is the affordance without the behaviour; drawn anyway
                // because its 13pt of width is what keeps titles aligned with
                // the select mode that replaces it.
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

            Text(row.title)
                .font(TFont.body(row.level == 0 ? 13 : 12,
                                 row.level == 0 ? 700 : (row.level == 1 ? 600 : 500)))
                .foregroundStyle(row.level == 2 ? theme.textSec : theme.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        // `paddingLeft: (level === 0 ? 22 : 20) + indent`, minus the cell's own
        // 10 which is already applied.
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
                if on {
                    WebGlyph(spec: WebIcon.tick, size: 7, color: .white)
                }
            }
    }

    // MARK: Number

    @ViewBuilder
    private var jobNumCell: some View {
        if let number = row.job?.jobNumber, !number.isEmpty {
            Text("#\(number)")
                .font(TFont.mono(11, 600))
                .foregroundStyle(theme.text)
        } else if row.level == 0 {
            dash(11, mono: true)
        }
        // Blank below level 0: a panel has no number of its own, and the web
        // leaves the cell empty rather than repeating the job's.
    }

    // MARK: Client

    @ViewBuilder
    private var clientCell: some View {
        if row.level == 0 {
            if let client = clientOf(row) {
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
            // A panel's client cell carries its op COUNT instead. Not an
            // oversight in the web — the column is wide and a panel has no
            // client, so it is reused.
            Text("\(row.childCount) op\(row.childCount == 1 ? "" : "s")")
                .font(TFont.body(11))
                .foregroundStyle(theme.textDim)
        }
    }

    private func clientOf(_ row: JobRow) -> Client? {
        guard let id = row.job?.clientId else { return nil }
        return appState.clients.first { $0.id == id }
    }

    // MARK: Status

    private var statusCell: some View {
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
        .background(Capsule().fill(color.opacity(0.125)))       // "20" = 12.5%
        .overlay(Capsule().strokeBorder(color.opacity(0.27), lineWidth: 1))  // "44"
    }

    // MARK: Priority

    private var priorityCell: some View {
        let color = Color.hex(row.priority.hex)
        return Text(row.priority.rawValue)
            .font(TFont.body(11, 700))
            .tracking(11 * -0.045)
            .textCase(.uppercase)
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Capsule().fill(color.opacity(0.10)))     // "1a"
            .overlay(Capsule().strokeBorder(color.opacity(0.27), lineWidth: 1))
    }

    // MARK: Dates

    @ViewBuilder
    private func dateCell(_ day: String) -> some View {
        Text(JobsDate.short(day))
            .font(TFont.mono(12))
            .foregroundStyle(theme.textSec)
    }

    @ViewBuilder
    private var dueCell: some View {
        if row.level == 0, let due = row.job?.dueDate, !due.isEmpty {
            let overdue = due < JobsDate.todayKey
            let soon = !overdue && due <= JobsDate.adding(days: 3, to: JobsDate.todayKey)
            Text(JobsDate.short(due) + (overdue ? " !" : ""))
                .font(TFont.mono(12, overdue ? 700 : 400))
                .foregroundStyle(overdue ? Color.hex("#ef4444")
                                 : (soon ? Color.hex("#f59e0b") : theme.textSec))
        } else if row.level == 0 {
            dash(12, mono: true)
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
                // A panel also prints how many ops those hours are spread over.
                if row.level == 1 && row.childCount > 0 {
                    Text("/ \(row.childCount) op\(row.childCount == 1 ? "" : "s")")
                        .font(TFont.mono(10))
                        .foregroundStyle(theme.textDim)
                }
            }
        } else {
            dash(12, mono: true)
        }
    }

    // MARK: Progress

    private var progressCell: some View {
        let pct = percent
        let color = Color.hex(ProgressRamp.hex(pct, belowForty: "#94a3b8"))
        let counts = row.finishedAndTotalOps
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("\(pct)%")
                    .font(TFont.body(10, 700))
                    .foregroundStyle(color)
                Spacer(minLength: 4)
                if counts.total > 0 {
                    Text(row.level == 0
                         ? "\(counts.finished)/\(counts.total) ops"
                         : "\(counts.finished)/\(counts.total)")
                        .font(TFont.body(9))
                        .foregroundStyle(theme.textDim)
                }
            }
            // The track is `T.border` and the fill stops at 100 — "bars stop at
            // full; the number carries the overrun".
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.border)
                    Capsule().fill(color)
                        .frame(width: geo.size.width * ProgressRamp.barFraction(pct))
                }
            }
            .frame(height: 4)
        }
        // `padding: "6px 10px"` — a point tighter than a normal cell, because
        // this one stacks two things.
        .padding(.vertical, -1)
    }

    private var percent: Int {
        switch row {
        case .job(let j):             return appState.jobPct(j)
        case .panel(let p, _, _):     return appState.panelPct(p)
        case .operation(let o, _, _, _):
            // No opPct on AppState; the pair it exposes is what panelPct sums.
            let est = JobsQuery.estimatedHours(of: o)
            guard est > 0 else { return 0 }
            if o.status == .finished { return 100 }
            return Int(((o.loggedHours ?? 0) / est * 100).rounded())
        }
    }

    // MARK: Team

    @ViewBuilder
    private var teamCell: some View {
        if row.level == 0 {
            let members = row.team.compactMap { id in
                appState.people.first { $0.id == id }
            }
            HStack(spacing: 4) {
                ForEach(members.prefix(4), id: \.id) { person in
                    JobsAvatar(person: person, size: 22)
                        .help(person.name)
                }
                if members.count > 4 {
                    Text("+\(members.count - 4)")
                        .font(TFont.body(10))
                        .foregroundStyle(theme.textDim)
                }
            }
        } else if let assignee = row.team.first,
                  let person = appState.people.first(where: { $0.id == assignee }) {
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

// MARK: - The team avatar
//
// Initials on the person's own colour, exactly as the sidebar's profile avatar
// does — see NativeShell. No photo lookup: the sidebar does not do one either,
// and half the column loading images while the other half shows initials looks
// worse than a consistent set of marks.

struct JobsAvatar: View {
    @Environment(\.tqTheme) private var theme
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

    /// `safeDate` — `toLocaleDateString("en-US", { month: "short", day: "numeric" })`,
    /// so "Mar 10". An unparseable day gives the em dash the web gives, rather
    /// than today's date or a crash.
    static func short(_ day: String) -> String {
        guard let date = parse(day) else { return "—" }
        return shortFormatter.string(from: date)
    }

    /// `TD` — today as a local `yyyy-MM-dd`. LOCAL, not GMT: the web's `toDS`
    /// reads `getFullYear/getMonth/getDate`, so "overdue" turns over at the
    /// user's midnight rather than London's. `AppState.ymd` pins GMT for server
    /// date keys and is the wrong helper for this.
    static var todayKey: String { keyFormatter.string(from: Date()) }

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
