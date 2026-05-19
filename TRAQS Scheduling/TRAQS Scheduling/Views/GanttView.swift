import SwiftUI
import Combine

// MARK: - Schedule V1 (Day timeline) · TRAQS Light
// Lives in GanttView.swift / struct GanttView for back-compat (MainTabView routes
// the Schedule tab to this view). Re-styled to the TRAQS Light language —
// 7AM–6PM vertical hour grid, department-stripe blocks, sky NOW line.

struct GanttView: View {
    @Environment(AppState.self) private var appState

    @State private var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    @State private var segment: ScheduleSegment = .day
    @State private var now: Date = Date()
    @State private var showAddJob = false
    @State private var showDatePicker = false
    private let cal = Calendar.current
    private let nowTimer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    enum ScheduleSegment: String, CaseIterable, Hashable { case day, week
        var label: String { rawValue.capitalized }
    }

    var body: some View {
        NavigationStack {
        ZStack(alignment: .top) {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                // Sticky header.
                TRAQSNavHeader {
                    IconBtn(icon: .cal, size: 18) { showDatePicker = true }
                    if appState.isAdmin {
                        IconBtn(icon: .plus, size: 18) { showAddJob = true }
                    }
                }
                .background(Color(hex: T.bg))

                ScrollView {
                    VStack(spacing: 0) {

                    // Segmented Day/Week/Agenda — V1 default is Day
                    HStack { Spacer()
                        Segmented(
                            options: ScheduleSegment.allCases,
                            labels: Dictionary(uniqueKeysWithValues: ScheduleSegment.allCases.map { ($0, $0.label) }),
                            selection: $segment)
                        Spacer()
                    }
                    .padding(.bottom, 10)

                    if segment == .day {
                        DateSelector(date: $selectedDate)
                            .padding(.bottom, 10)
                        statStrip
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                        DayTimeline(date: selectedDate,
                                    now: now,
                                    blocks: blocks(for: selectedDate),
                                    workStart: appState.orgSettings.workStartHour,
                                    workEnd: appState.orgSettings.workEndHour,
                                    lunchStart: appState.orgSettings.lunchStartHour,
                                    lunchDurationH: Double(appState.orgSettings.lunch.durationMinutes) / 60)
                            .transition(.opacity)
                    } else {
                        WeekHeaderBar(weekDates: weekDates, selected: $selectedDate)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 10)
                        WeekGrid(weekDates: weekDates,
                                 today: cal.startOfDay(for: Date()),
                                 now: now,
                                 workStart: appState.orgSettings.workStartHour,
                                 workEnd: appState.orgSettings.workEndHour,
                                 blocksFor: { blocks(for: $0) })
                            .padding(.horizontal, 12)
                            .padding(.bottom, 6)
                        WeekLegendRow(blocks: weekDates.flatMap { blocks(for: $0) })
                            .padding(.horizontal, 16)
                            .padding(.bottom, 24)
                            .transition(.opacity)
                    }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .animation(.easeInOut(duration: 0.18), value: segment)
        .onReceive(nowTimer) { _ in now = Date() }
        .sheet(isPresented: $showAddJob) { JobEditView(job: nil) }
        .sheet(isPresented: $showDatePicker) {
            // Jump-to-date picker — wireframe Day view doesn't have an inline
            // calendar; the calendar icon in the header opens this sheet.
            DatePickerSheet(selection: $selectedDate)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .navigationDestination(for: Job.self) { JobDetailView(job: $0) }
        .navigationDestination(for: ScheduleFocus.self) { focus in
            JobDetailView(job: focus.job,
                          highlightPanelId: focus.panelId,
                          highlightOpId: focus.opId)
        }
        .toolbar(.hidden, for: .navigationBar)
        }
    }

    // MARK: 3-stat strip (Jobs / Tasks / Est) — matches the wireframe layout

    private var statStrip: some View {
        let bs = blocks(for: selectedDate)
        let jobCount = Set(bs.map { $0.jobId }).count
        let estHours = bs.reduce(0.0) { $0 + ($1.end - $1.start) }
        return HStack(spacing: 8) {
            statCard("JOBS",  "\(jobCount)")
            statCard("TASKS", "\(bs.count)")
            statCard("EST.",  String(format: "%.1f h", estHours))
        }
    }

    private func statCard(_ label: String, _ value: String) -> some View {
        SBox(size: .sm, raised: true) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted)).tLabel(tracking: 1.0)
                Text(value).font(TTypo.h3(18)).foregroundStyle(Color(hex: T.ink)).tnum()
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Week dates (Mon→Sun around selectedDate)

    private var weekDates: [Date] {
        let weekday = cal.component(.weekday, from: selectedDate)
        let toMon = weekday == 1 ? -6 : -(weekday - 2)
        guard let mon = cal.date(byAdding: .day, value: toMon, to: cal.startOfDay(for: selectedDate))
        else { return [] }
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: mon) }
    }

    // MARK: Data → schedule blocks
    //
    // Our schema doesn't carry time-of-day on panels/ops, so blocks are PACKED
    // sequentially starting at workStart (7am), each sized by its hpd. Lunch is
    // reserved at noon→1pm. Tasks overflow the work day cap at 6pm.

    private func blocks(for date: Date) -> [ScheduleBlock] {
        let day = cal.startOfDay(for: date)
        let dayEnd = cal.date(byAdding: .day, value: 1, to: day) ?? day
        let me = appState.currentPersonId

        var items: [_ScheduleItem] = []

        for job in appState.jobs {
            for panel in job.subs {
                guard panel.start.asDate.map({ $0 < dayEnd }) ?? false,
                      panel.end.asDate.map({ $0 >= day }) ?? false
                else { continue }

                let myOps = panel.subs.filter { op in
                    guard op.start.asDate.map({ $0 < dayEnd }) ?? false,
                          op.end.asDate.map({ $0 >= day }) ?? false
                    else { return false }
                    return me == nil || op.team.contains(me!)
                }

                if !myOps.isEmpty {
                    for op in myOps {
                        let (lbl, col) = deptForOp(op, fallback: deptColor(for: job, panel: panel))
                        items.append(_ScheduleItem(
                            job: job, panel: panel, op: op,
                            title: op.title.isEmpty ? panel.title : op.title,
                            subtitle: job.title,
                            color: col,
                            typeLabel: lbl,
                            hpd: max(op.hpd > 0 ? op.hpd : panel.hpd, 0.5)))
                    }
                } else if me == nil
                          || panel.team.contains(me!)
                          || job.team.contains(me!) {
                    items.append(_ScheduleItem(
                        job: job, panel: panel, op: nil,
                        title: panel.title.isEmpty ? job.title : panel.title,
                        subtitle: job.title,
                        color: deptColor(for: job, panel: panel),
                        typeLabel: deptLabel(for: job, panel: panel),
                        hpd: max(panel.hpd > 0 ? panel.hpd : 1.0, 0.5)))
                }
            }
        }
        items.sort { ($0.job.jobNumber ?? "") + $0.panel.id < ($1.job.jobNumber ?? "") + $1.panel.id }

        // Pack sequentially from workStart, splitting around lunch.
        // We do NOT cap at workEnd — if more work is scheduled than fits in
        // the standard day, the timeline expands so every task is still
        // visible. Previously any task that would have started past 5pm got
        // silently dropped, which is what the "missing jobs" reports were.
        let s = appState.orgSettings
        let workStart:  Double = s.workStartHour
        let lunchStart: Double = s.lunchStartHour
        let lunchEnd:   Double = s.lunchStartHour + Double(s.lunch.durationMinutes) / 60

        var cursor = workStart
        var out: [ScheduleBlock] = []
        for item in items {
            var remaining = item.hpd

            // Skip past lunch if the cursor lands inside it.
            if cursor >= lunchStart && cursor < lunchEnd { cursor = lunchEnd }

            // First chunk: up to lunchStart (if we're before lunch) or unbounded.
            let firstCapEdge = cursor < lunchStart ? lunchStart : .infinity
            let firstChunk = min(remaining, firstCapEdge - cursor)
            if firstChunk > 0.01 {
                out.append(makeBlock(item, start: cursor, end: cursor + firstChunk))
                cursor += firstChunk
                remaining -= firstChunk
            }
            // Second chunk: anything left after lunch.
            if remaining > 0.01, cursor >= lunchStart, cursor <= lunchEnd {
                cursor = lunchEnd
                out.append(makeBlock(item, start: cursor, end: cursor + remaining))
                cursor += remaining
            }
        }
        return out
    }

    private func makeBlock(_ it: _ScheduleItem, start: Double, end: Double) -> ScheduleBlock {
        let clientName = it.job.clientId
            .flatMap { cid in appState.clients.first(where: { $0.id == cid })?.name }
            .flatMap { $0.isEmpty ? nil : $0 }
        return ScheduleBlock(
            id: "\(it.panel.id)/\(it.op?.id ?? "panel")/\(Int(start * 60))",
            job: it.job,
            jobId: it.job.id,
            jobNumber: it.job.jobNumber ?? "",
            panelId: it.panel.id,
            opId: it.op?.id,
            // Headline = customer when we have one, else fall back to the job title.
            // Subtitle then carries the task (op or panel) the user is on.
            title: clientName ?? it.job.title,
            subtitle: it.title,
            color: it.color,
            typeLabel: it.typeLabel,
            start: start, end: end)
    }

    private func deptForOp(_ op: Operation, fallback: Color) -> (String, Color) {
        let key = op.title.lowercased()
        switch key {
        case _ where key.contains("layout"):  return ("LAYOUT",  Color(hex: T.magenta))
        case _ where key.contains("wire"):    return ("WIRE",    Color(hex: T.cyan))
        case _ where key.contains("cut"):     return ("CUT",     Color(hex: T.yellow))
        case _ where key.contains("inspect"): return ("INSPECT", Color(hex: T.lavender))
        case _ where key.contains("repair"):  return ("REPAIR",  Color(hex: T.amber))
        case _ where key.contains("install"): return ("INSTALL", Color(hex: T.magenta))
        case _ where key.contains("callback"):return ("CALLBACK", Color(hex: T.red))
        case _ where key.contains("contract"):return ("CONTRACT", Color(hex: T.green))
        default: return (op.title.uppercased(), fallback)
        }
    }

    private func deptColor(for job: Job, panel: Panel) -> Color {
        let key = (job.jobType ?? panel.title).lowercased()
        switch key {
        case _ where key.contains("layout"):  return Color(hex: T.magenta)
        case _ where key.contains("wire"):    return Color(hex: T.cyan)
        case _ where key.contains("cut"):     return Color(hex: T.yellow)
        case _ where key.contains("inspect"): return Color(hex: T.lavender)
        case _ where key.contains("repair"):  return Color(hex: T.amber)
        case _ where key.contains("install"): return Color(hex: T.magenta)
        case _ where key.contains("callback"):return Color(hex: T.red)
        case _ where key.contains("contract"):return Color(hex: T.green)
        default:                              return Color(hex: job.color)
        }
    }

    private func deptLabel(for job: Job, panel: Panel) -> String {
        if let t = job.jobType, !t.isEmpty { return t.uppercased() }
        if !panel.title.isEmpty { return panel.title.uppercased() }
        return "JOB"
    }
}

// Bridge struct so `makeBlock` can accept items packed inside `blocks(for:)`.
// (`Item` is private to the function scope; this typealias surfaces it.)
private struct _ScheduleItem {
    let job: Job
    let panel: Panel
    let op: Operation?
    let title: String
    let subtitle: String
    let color: Color
    let typeLabel: String
    let hpd: Double
}

// MARK: - Schedule block model

struct ScheduleBlock: Identifiable, Equatable {
    let id: String
    let job: Job              // full reference so tapping a block can push the detail view
    let jobId: String
    let jobNumber: String
    let panelId: String       // panel this block represents
    let opId: String?         // op within the panel, when the user is on an op's team
    let title: String
    let subtitle: String
    let color: Color
    let typeLabel: String
    let start: Double         // hours-of-day, e.g. 8.5
    let end: Double

    static func == (lhs: ScheduleBlock, rhs: ScheduleBlock) -> Bool { lhs.id == rhs.id }
}

/// Carrier used by NavigationLink → JobDetailView so the detail view knows
/// which panel / op to highlight + auto-expand.
struct ScheduleFocus: Hashable {
    let job: Job
    let panelId: String?
    let opId: String?
}

// MARK: - Date selector (◂ DATE ▸) + Today pill

private struct DateSelector: View {
    @Binding var date: Date
    private let cal = Calendar.current

    private var subTitle: String {
        cal.isDateInToday(date) ? "Today"
            : cal.isDateInTomorrow(date) ? "Tomorrow"
            : cal.isDateInYesterday(date) ? "Yesterday"
            : DateFormatter.dayShort.string(from: date).uppercased()
    }
    private var mainTitle: String {
        DateFormatter.dayFull.string(from: date)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            // Left: chevron · date · chevron
            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    date = cal.date(byAdding: .day, value: -1, to: date) ?? date
                }
            } label: {
                TIconView(icon: .chev, size: 11, color: Color(hex: T.ink))
                    .scaleEffect(x: -1)
                    .padding(6)
                    .background(Circle().fill(Color(hex: T.surface)))
                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 0) {
                Text(subTitle)
                    .font(.custom(TFontName.bold.rawValue, size: 9))
                    .kerning(1.3)
                    .textCase(.uppercase)
                    .foregroundStyle(Color(hex: T.muted))
                Text(mainTitle)
                    .font(.custom(TFontName.bold.rawValue, size: 14))
                    .foregroundStyle(Color(hex: T.ink))
            }

            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    date = cal.date(byAdding: .day, value: 1, to: date) ?? date
                }
            } label: {
                TIconView(icon: .chev, size: 11, color: Color(hex: T.ink))
                    .padding(6)
                    .background(Circle().fill(Color(hex: T.surface)))
                    .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
            }
            .buttonStyle(.plain)

            Spacer()

            // Right: TODAY pill (always present)
            PillBtn("TODAY", compact: true) {
                withAnimation(.easeInOut(duration: 0.22)) {
                    date = cal.startOfDay(for: Date())
                }
            }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Day timeline

private struct DayTimeline: View {
    let date: Date
    let now: Date
    let blocks: [ScheduleBlock]
    /// Org-aware shift window (overrides the previously hardcoded 8a–5p / 12–1 lunch).
    let workStart: Double
    let workEnd: Double
    let lunchStart: Double
    let lunchDurationH: Double
    private let pxPerHour: CGFloat = 56
    private let cal = Calendar.current

    private var startHour: Double { workStart }

    /// Hard-cap the timeline at the org's workEnd. Any blocks the packer puts
    /// past this point are clipped — the schedule's visible window must match
    /// the configured shift, not silently scroll into the evening.
    private var endHour: Double { workEnd }

    var body: some View {
        let totalH = endHour - startHour
        let height = CGFloat(totalH + 1) * pxPerHour

        return HStack(alignment: .top, spacing: 8) {
            // Hour labels
            VStack(alignment: .leading, spacing: 0) {
                ForEach(0...Int(totalH), id: \.self) { i in
                    let h = Int(startHour) + i
                    let ampm = h < 12 ? "AM" : "PM"
                    let display = ((h + 11) % 12) + 1
                    Text("\(display) \(ampm)")
                        .font(TTypo.mono(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                        .frame(height: pxPerHour, alignment: .topLeading)
                }
            }
            .frame(width: 42)

            // Lane
            ZStack(alignment: .topLeading) {
                // Hour rules
                VStack(spacing: 0) {
                    ForEach(0...Int(totalH), id: \.self) { _ in
                        VStack(spacing: 0) {
                            Rectangle().fill(Color(hex: T.hair)).frame(height: 1)
                            Spacer().frame(height: pxPerHour - 1)
                        }
                    }
                }
                .frame(height: height, alignment: .top)

                // Lunch ghost block (dashed, muted) — driven by orgSettings.lunch
                let lunchTop = CGFloat(lunchStart - startHour) * pxPerHour + 2
                let lunchHeight = CGFloat(lunchDurationH) * pxPerHour - 4
                LunchGhostBlock(height: max(20, lunchHeight))
                    .padding(.horizontal, 6)
                    .offset(y: lunchTop)

                // Blocks — tap to push the job detail. Blocks whose start is
                // already past workEnd are dropped (nothing to show); blocks
                // that overflow workEnd are clamped to the visible lane so the
                // schedule never bleeds past the configured shift.
                ForEach(blocks.filter { $0.start < endHour }) { b in
                    let clampedEnd = min(b.end, endHour)
                    let top = CGFloat(b.start - startHour) * pxPerHour + 2
                    let h = max(20, CGFloat(clampedEnd - b.start) * pxPerHour - 4)
                    NavigationLink(value: ScheduleFocus(job: b.job, panelId: b.panelId, opId: b.opId)) {
                        ScheduleBlockView(block: b, height: h)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 6)
                    .offset(y: top)
                }

                // NOW line — only on today.
                // Pill sits INSIDE the lane (no longer in the hour-label gutter),
                // so it can't collide with the hour label at the same row.
                if cal.isDateInToday(date) {
                    let nowHour = hourOfDay(now)
                    if nowHour >= startHour, nowHour <= endHour {
                        let y = CGFloat(nowHour - startHour) * pxPerHour
                        ZStack(alignment: .leading) {
                            Rectangle()
                                .fill(Color(hex: T.sky).opacity(0.55))
                                .frame(height: 1)
                            Text("NOW")
                                .font(.custom(TFontName.bold.rawValue, size: 9))
                                .kerning(0.6)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Capsule().fill(Color(hex: T.sky)))
                                .offset(y: -1)
                                .padding(.leading, 4)
                        }
                        .offset(y: y)
                        .allowsHitTesting(false)
                    }
                }
            }
            .frame(height: height, alignment: .top)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 32)
    }

    private func hourOfDay(_ d: Date) -> Double {
        let comps = cal.dateComponents([.hour, .minute], from: d)
        return Double(comps.hour ?? 0) + Double(comps.minute ?? 0) / 60
    }
}

private struct LunchGhostBlock: View {
    let height: CGFloat
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "fork.knife")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color(hex: T.muted))
            Text("Lunch")
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.0)
            Spacer()
        }
        .frame(height: height, alignment: .center)
        .padding(.horizontal, 12)
        .background(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous).fill(.clear))
        .overlay(
            RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .foregroundStyle(Color(hex: T.hair))
        )
    }
}

private struct ScheduleBlockView: View {
    let block: ScheduleBlock
    let height: CGFloat

    /// Density tiers — keeps short blocks readable without spilling over their bounds.
    private var density: Density {
        if height < 36 { return .tiny }       // ½-hour slots: one tight row
        if height < 64 { return .compact }    // ~1-hour: dept tag + title
        return .full                          // larger: dept tag + title + subtitle
    }
    private enum Density { case tiny, compact, full }

    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(block.color).frame(width: 5)
            content
                .padding(.horizontal, 10)
                .padding(.vertical, density == .tiny ? 4 : 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: height, alignment: .top)
        .background(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous).fill(Color(hex: T.surface)))
        .overlay(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
        // Clip so any subview that doesn't measure exactly to height can't bleed
        // into the row below.
        .clipShape(RoundedRectangle(cornerRadius: T.cornerBlock, style: .continuous))
    }

    @ViewBuilder
    private var content: some View {
        switch density {
        case .tiny:
            // One row: dept label + title side-by-side, both clipped.
            HStack(spacing: 6) {
                Circle().fill(block.color).frame(width: 6, height: 6)
                Text(block.typeLabel)
                    .font(TTypo.xsBold(10))
                    .foregroundStyle(Color(hex: T.ink))
                    .tLabel(tracking: 0.6)
                    .lineLimit(1)
                Text(block.title)
                    .font(TTypo.smBold(12))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
        case .compact:
            VStack(alignment: .leading, spacing: 2) {
                JobTypeTag(label: block.typeLabel, color: block.color)
                Text(block.title)
                    .font(TTypo.smBold(13))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
            }
        case .full:
            VStack(alignment: .leading, spacing: 3) {
                JobTypeTag(label: block.typeLabel, color: block.color)
                Text(block.title)
                    .font(TTypo.smBold(13))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                if !block.subtitle.isEmpty, block.subtitle != block.title {
                    Text(block.subtitle)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
            }
        }
    }
}

// MARK: - Week view (7-column grid) · matches wireframe V2

private struct WeekHeaderBar: View {
    let weekDates: [Date]
    @Binding var selected: Date
    private let cal = Calendar.current

    private var rangeLabel: String {
        let f = DateFormatter(); f.dateFormat = "MMM d"
        guard let first = weekDates.first, let last = weekDates.last else { return "" }
        return "\(f.string(from: first)) – \(f.string(from: last))"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(rangeLabel)
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.4)
            Spacer()
            PillBtn("TODAY", compact: true) {
                withAnimation(.easeInOut(duration: 0.22)) {
                    selected = cal.startOfDay(for: Date())
                }
            }
        }
    }
}

private struct WeekGrid: View {
    let weekDates: [Date]
    let today: Date
    let now: Date
    let workStart: Double
    let workEnd: Double
    let blocksFor: (Date) -> [ScheduleBlock]

    private var startHour: Double { workStart }
    private let pxPerHour: CGFloat = 36
    private let gutter:    CGFloat = 24
    private let cal = Calendar.current

    /// Hard-cap at workEnd. Overflow blocks are clipped — the week grid
    /// should mirror the configured shift, not silently expand.
    private var endHour: Double { workEnd }

    var body: some View {
        VStack(spacing: 0) {
            headerRow.padding(.bottom, 4)
            gridRow
        }
    }

    private var height: CGFloat { CGFloat(endHour - startHour) * pxPerHour }
    private var hourCount: Int { Int(endHour - startHour) }

    private var headerRow: some View {
        HStack(spacing: 2) {
            Spacer().frame(width: gutter)
            ForEach(weekDates, id: \.self) { d in
                DayHeaderCell(day: d, isToday: cal.isDateInToday(d))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var gridRow: some View {
        HStack(alignment: .top, spacing: 2) {
            timeGutter
            ForEach(weekDates, id: \.self) { d in
                WeekDayColumn(
                    day: d,
                    height: height,
                    startHour: startHour,
                    endHour: endHour,
                    pxPerHour: pxPerHour,
                    isToday: cal.isDateInToday(d),
                    now: now,
                    blocks: blocksFor(d))
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var timeGutter: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<hourCount, id: \.self) { i in
                Text("\(((Int(startHour) + i + 11) % 12) + 1)")
                    .font(TTypo.mono(9))
                    .foregroundStyle(Color(hex: T.muted))
                    .tnum()
                    .frame(height: pxPerHour, alignment: .topLeading)
            }
        }
        .frame(width: gutter, height: height, alignment: .topLeading)
    }
}

private struct DayHeaderCell: View {
    let day: Date
    let isToday: Bool
    private let cal = Calendar.current

    private var dow: String {
        let f = DateFormatter(); f.dateFormat = "EEE"
        return String(f.string(from: day).prefix(1))
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(dow)
                .font(TTypo.xsBold(11))
                .foregroundStyle(isToday ? .white : Color(hex: T.ink))
            Text("\(cal.component(.day, from: day))")
                .font(TTypo.xs(11))
                .foregroundStyle(isToday ? Color.white.opacity(0.85) : Color(hex: T.muted))
                .tnum()
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background(
            UnevenRoundedRectangle(
                cornerRadii: .init(topLeading: 8, bottomLeading: 0, bottomTrailing: 0, topTrailing: 8),
                style: .continuous)
                .fill(isToday ? Color(hex: T.sky) : .clear)
        )
    }
}

private struct WeekDayColumn: View {
    let day: Date
    let height: CGFloat
    let startHour: Double
    let endHour: Double
    let pxPerHour: CGFloat
    let isToday: Bool
    let now: Date
    let blocks: [ScheduleBlock]
    private let cal = Calendar.current

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Day column background: faint sky tint on today
            Rectangle()
                .fill(isToday ? Color(hex: T.sky).opacity(0.07) : .clear)

            // Hour rules (every 2 hours visible to keep the column readable at this scale)
            VStack(spacing: 0) {
                ForEach(0..<Int(endHour - startHour), id: \.self) { i in
                    VStack(spacing: 0) {
                        Rectangle()
                            .fill(Color(hex: T.hair).opacity(i % 2 == 0 ? 1.0 : 0.5))
                            .frame(height: 1)
                        Spacer().frame(height: pxPerHour - 1)
                    }
                }
            }

            // Event rectangles painted by time range — clamped to endHour so
            // blocks never bleed past the configured shift.
            ForEach(blocks.filter { $0.start < endHour }) { b in
                let clampedEnd = min(b.end, endHour)
                let top = CGFloat(b.start - startHour) * pxPerHour + 1
                let h = max(2, CGFloat(clampedEnd - b.start) * pxPerHour - 2)
                NavigationLink(value: ScheduleFocus(job: b.job, panelId: b.panelId, opId: b.opId)) {
                    WeekBlockTile(block: b, height: h)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 2)
                .offset(y: top)
            }

            // NOW line on today
            if isToday {
                let nowHour = hourOfDay(now)
                if nowHour >= startHour, nowHour <= endHour {
                    let y = CGFloat(nowHour - startHour) * pxPerHour
                    HStack(spacing: 0) {
                        Circle().fill(Color(hex: T.ink)).frame(width: 6, height: 6)
                            .offset(y: -3)
                        Rectangle().fill(Color(hex: T.ink)).frame(height: 1.5)
                    }
                    .offset(y: y)
                    .allowsHitTesting(false)
                }
            }
        }
        .frame(height: height)
        .overlay(
            Rectangle().fill(Color(hex: T.hair)).frame(width: 1),
            alignment: .leading
        )
        .clipped()
    }

    private func hourOfDay(_ d: Date) -> Double {
        let comps = cal.dateComponents([.hour, .minute], from: d)
        return Double(comps.hour ?? 0) + Double(comps.minute ?? 0) / 60
    }
}

/// Inline week-grid tile. Shows as much info as the slot height allows:
///   • ≥ 26pt: dept label (e.g. "WIRE")
///   • ≥ 44pt: + job number
///   • ≥ 64pt: + customer / job title
/// Below the threshold it's a clean colored bar so the column stays readable.
private struct WeekBlockTile: View {
    let block: ScheduleBlock
    let height: CGFloat

    private var showLabel:  Bool { height >= 26 }
    private var showJobNum: Bool { height >= 44 && !block.jobNumber.isEmpty }
    private var showTitle:  Bool { height >= 64 }

    /// White text reads well over magenta/cyan/yellow/etc.; for the soft
    /// lavender swatch we fall back to ink so it's not washed out.
    private var textColor: Color {
        // Heuristic: yellow is the lone "light" swatch — flip to ink there.
        block.color == Color(hex: T.yellow) ? Color(hex: T.ink) : .white
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if showLabel {
                Text(block.typeLabel)
                    .font(.custom(TFontName.bold.rawValue, size: 9))
                    .kerning(0.6)
                    .lineLimit(1)
                    .foregroundStyle(textColor)
            }
            if showJobNum {
                Text("#\(block.jobNumber)")
                    .font(.custom(TFontName.medium.rawValue, size: 9))
                    .lineLimit(1)
                    .foregroundStyle(textColor.opacity(0.85))
            }
            if showTitle {
                Text(block.title)
                    .font(.custom(TFontName.bold.rawValue, size: 10))
                    .lineLimit(2)
                    .foregroundStyle(textColor)
            }
        }
        .padding(.horizontal, showLabel ? 4 : 0)
        .padding(.vertical, showLabel ? 3 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .frame(height: height)
        .background(
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(block.color.opacity(0.92))
        )
        .contentShape(Rectangle())
    }
}

private struct WeekLegendRow: View {
    let blocks: [ScheduleBlock]

    /// Distinct (color, label) pairs across the week.
    private var entries: [(label: String, color: Color)] {
        var seen = Set<String>()
        var out: [(String, Color)] = []
        for b in blocks where !seen.contains(b.typeLabel) {
            seen.insert(b.typeLabel)
            out.append((b.typeLabel, b.color))
        }
        return out.sorted { $0.0 < $1.0 }
    }

    var body: some View {
        if entries.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: 10) {
                ForEach(entries, id: \.label) { e in
                    JobTypeTag(label: e.label, color: e.color)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - DatePickerSheet — jump to any day from the calendar header icon

private struct DatePickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: Date

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()
            VStack(spacing: 16) {
                Text("Jump to date")
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.4)
                    .padding(.top, 18)

                DatePicker("", selection: $selection, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                    .tint(Color(hex: T.sky))
                    .padding(.horizontal, 16)

                Button {
                    dismiss()
                } label: {
                    Text("DONE")
                        .font(TTypo.xsBold(13))
                        .tLabel(tracking: 0.8)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(Color(hex: T.sky)))
                        .shadow(color: Color(hex: T.sky).opacity(T.skyShadowOpacity),
                                radius: T.skyShadowRadius, x: 0, y: T.skyShadowY)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
    }
}

// MARK: - DateFormatter helpers

private extension DateFormatter {
    static let dayShort: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE · MMM d"; return f
    }()
    static let dayFull: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE · MMM d"; return f
    }()
}

// MARK: - String → Date helper (already used elsewhere in the codebase)
// (Kept here as a typed-key convenience; the canonical extension lives in AppState.swift.)
