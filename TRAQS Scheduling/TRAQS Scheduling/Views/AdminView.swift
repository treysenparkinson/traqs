import SwiftUI

// MARK: - AdminView · Live status board
//
// Admin-only dashboard for dispatchers. Full-page (NOT a sheet) so the
// stats tiles and section grids have room to breathe. Reads
// `appState.people` directly and inherits the 15s auto-refresh that
// keeps the board live without an explicit fetch loop.

private enum AdminFilter: String, CaseIterable {
    case live, byDept, today
    var label: String {
        switch self {
        case .live:   return "Live"
        case .byDept: return "By dept"
        case .today:  return "Today"
        }
    }
}

struct AdminView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var filter: AdminFilter = .live

    private var team: [Person] {
        appState.people.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    // Status buckets, computed via `statusFor` so each person lands in
    // exactly one column. Precedence: lunch > break > on-job > idle >
    // offline — a worker who's on lunch with a paused job clock shows
    // as Lunch (not double-counted as Break).
    private var onJob:   [Person] { team.filter { statusFor($0) == .onJob } }
    private var onBreak: [Person] { team.filter { statusFor($0) == .onBreak } }
    private var onLunch: [Person] { team.filter { statusFor($0) == .onLunch } }
    private var idle:    [Person] { team.filter { statusFor($0) == .idle } }
    private var offline: [Person] { team.filter { statusFor($0) == .offline } }

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                // Sticky header
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color(hex: T.ink))
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(Color(hex: T.surface)))
                            .overlay(Circle().stroke(Color(hex: T.hair), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        titleBlock
                        statTiles
                        filterPills
                        sections
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                }
                .refreshable { await appState.loadAll() }
                .scrollIndicators(.visible)
            }
        }
        // While the board is on-screen, poll faster than the fallback loop so a
        // clock-in/lunch/break from another device lands in seconds. Uses
        // deltaSyncNow (delta-sync + rehydrate) rather than the heavy full-GET
        // loadAll — the presence data lives on the `people` entity, which
        // delta-sync covers. The .task lifecycle cancels the loop on dismiss.
        .task {
            await appState.deltaSyncNow()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled else { break }
                await appState.deltaSyncNow()
            }
        }
    }

    // MARK: - Title + subtitle

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Live status")
                .font(.custom(TFontName.bold.rawValue, size: 30))
                .foregroundStyle(Color(hex: T.ink))
            // TimelineView re-renders every 30s so the time in the
            // subtitle stays visibly fresh — same primitive we use for
            // the elapsed timer on the Tasks page.
            TimelineView(.periodic(from: .now, by: 30)) { ctx in
                Text(subtitleString(at: ctx.date))
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
            }
        }
        .padding(.top, 4)
    }

    private func subtitleString(at date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "EEE · MMM d · h:mm a"
        return "\(f.string(from: date)) · auto-refresh"
    }

    // MARK: - Stat tiles

    private var statTiles: some View {
        // Five tiles — tighter spacing and trimmed padding inside the
        // tile so "OFFLINE" still fits on smaller phones (iPhone SE
        // class) without truncation.
        HStack(spacing: 6) {
            StatTile(count: onJob.count,   label: "ON JOB",  color: Color(hex: T.green))
            StatTile(count: onBreak.count, label: "BREAK",   color: Color(hex: T.orange))
            StatTile(count: onLunch.count, label: "LUNCH",   color: Color(hex: T.yellow))
            StatTile(count: idle.count,    label: "IDLE",    color: Color(hex: T.accent))
            StatTile(count: offline.count, label: "OFFLINE", color: Color(hex: T.muted))
        }
    }

    // MARK: - Filter pills (centered)

    private var filterPills: some View {
        HStack {
            Spacer()
            HStack(spacing: 6) {
                ForEach(AdminFilter.allCases, id: \.self) { f in
                    let on = filter == f
                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) { filter = f }
                    } label: {
                        Text(f.label)
                            .font(TTypo.smBold(13))
                            .foregroundStyle(on ? T.onGradient : Color(hex: T.ink))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(
                                Capsule().fill(
                                    on ? AnyShapeStyle(T.brandGradient())
                                       : AnyShapeStyle(Color(hex: T.surface))
                                )
                            )
                            .overlay(Capsule().stroke(on ? Color.clear : Color(hex: T.hair), lineWidth: 1))
                            .shadow(color: on ? Color(hex: T.ctaGlowColor).opacity(T.ctaGlowOpacity) : .clear,
                                    radius: on ? T.ctaGlowRadius : 0, x: 0, y: on ? T.ctaGlowY : 0)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer()
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var sections: some View {
        switch filter {
        case .live:
            liveSections
        case .byDept:
            ByDeptSection(people: team, jobsLookup: jobFor)
        case .today:
            TodaySection(people: team)
        }
    }

    @ViewBuilder
    private var liveSections: some View {
        if !onJob.isEmpty {
            SectionHeader(title: "On a job", count: onJob.count)
            VStack(spacing: 10) {
                ForEach(onJob) { p in
                    OnJobCard(person: p, job: jobFor(p))
                }
            }
        }
        if !onBreak.isEmpty {
            SectionHeader(title: "On break", count: onBreak.count)
            VStack(spacing: 10) {
                ForEach(onBreak) { OnBreakCard(person: $0, job: jobFor($0)) }
            }
        }
        if !onLunch.isEmpty {
            SectionHeader(title: "On lunch", count: onLunch.count)
            VStack(spacing: 10) {
                ForEach(onLunch) { OnLunchCard(person: $0, sinceISO: lunchStartFor($0)) }
            }
        }
        if !idle.isEmpty {
            SectionHeader(title: "Idle", count: idle.count)
            VStack(spacing: 10) {
                ForEach(idle) { IdleOrOfflineCard(person: $0, label: "Logged in, no active job", status: .idle) }
            }
        }
        if !offline.isEmpty {
            SectionHeader(title: "Offline", count: offline.count)
            VStack(spacing: 10) {
                ForEach(offline) { IdleOrOfflineCard(person: $0, label: "Not clocked in", status: .offline) }
            }
        }
    }

    private func jobFor(_ person: Person) -> Job? {
        guard let jobId = person.activeJobClock?.jobId else { return nil }
        return appState.jobs.first(where: { $0.id == jobId })
    }

    /// ISO timestamp of the active lunchStart event (no matching
    /// lunchEnd yet). Used by OnLunchCard for its elapsed timer.
    private func lunchStartFor(_ person: Person) -> String? {
        guard let events = person.activeClockIn?.events else { return nil }
        var openAt: String? = nil
        for e in events {
            if e.type == "lunchStart" { openAt = e.ts }
            else if e.type == "lunchEnd" { openAt = nil }
        }
        return openAt
    }

    private func statusFor(_ person: Person) -> WorkerStatus {
        // Lunch wins over everything — payroll-state event.
        if isOn(person, type: "lunch") { return .onLunch }
        // Break is now a standalone status set by the worker tapping
        // "Break" (the job clock keeps running). Presence-only: an
        // overrun past the configured duration still counts as on-break
        // until the worker ends it.
        if person.activeBreak != nil { return .onBreak }
        if person.activeJobClock != nil { return .onJob }
        if person.activeClockIn != nil { return .idle }
        return .offline
    }

    /// Sweeps through clock events to determine whether the latest
    /// `<type>Start` is unmatched by a subsequent `<type>End`.
    private func isOn(_ person: Person, type: String) -> Bool {
        guard let events = person.activeClockIn?.events else { return false }
        let start = "\(type)Start", end = "\(type)End"
        var active = false
        for e in events {
            if e.type == start { active = true }
            else if e.type == end { active = false }
        }
        return active
    }
}

private enum WorkerStatus {
    case onJob, onBreak, onLunch, idle, offline
}

// MARK: - Stat tile

private struct StatTile: View {
    let count: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(alignment: .center, spacing: 2) {
            Text("\(count)")
                .font(.custom(TFontName.bold.rawValue, size: 24))
                .foregroundStyle(color)
                .tnum()
            Text(label)
                .font(TTypo.xsBold(10))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 0.6)
                .minimumScaleFactor(0.8)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 4)
        .padding(.vertical, 12)
        .frostedCard(radius: T.cornerMd)
    }
}

// MARK: - Section header

private struct SectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.custom(TFontName.bold.rawValue, size: 22))
                .foregroundStyle(Color(hex: T.ink))
            Spacer()
            Text("\(count)")
                .font(TTypo.smBold(14))
                .foregroundStyle(Color(hex: T.muted))
                .tnum()
        }
        .padding(.top, 6)
    }
}

// MARK: - Cards

// Small "IN"/"OUT" clock badge for the top-right of a presence card. IN is
// green (clocked in for the shift); OUT is grey (not clocked in).
// A single IN/OUT pill with the live "clocked-in today" time baked in. Green
// "IN · 6h 12m" while working (pay-clock time since clock-in, minus lunch). On
// lunch it turns grey "OUT" but keeps the frozen worked time (lunch = clocked
// out, still on shift). Fully clocked out / offline → just "OUT", no time.
private struct ClockInStatus: View {
    let person: Person
    var body: some View {
        if person.activeClockIn != nil {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                pill(isIn: isClockedInNow(person),
                     time: hmLabel(clockedInSeconds(person, now: ctx.date) ?? 0))
            }
        } else {
            pill(isIn: false, time: nil)
        }
    }

    @ViewBuilder
    private func pill(isIn: Bool, time: String?) -> some View {
        let kind: TagKind = isIn ? .green : .neutral
        HStack(spacing: 5) {
            Circle().fill(kind.fg).frame(width: 6, height: 6)
            Text(isIn ? "IN" : "OUT")
                .font(TTypo.xsBold(11))
                .tLabel(tracking: 0.4)
                .foregroundStyle(kind.fg)
            if let time {
                Text(time)
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(kind.fg)
                    .tnum()
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(kind.bg))
    }
}

// The production-status pill with its live elapsed time baked in, mirroring
// ClockInStatus. Sits directly under the clock-in pill. "On job · 2h 30m"
// (indigo), "Break · 12m" / "Lunch · 25m" (amber). Idle has no timer, so it's
// just "Idle".
private struct ProductionPill: View {
    let label: String
    let kind: TagKind
    var sinceISO: String? = nil

    var body: some View {
        if let sinceISO {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                pill("\(label) · \(shortElapsed(sinceISO, now: ctx.date))")
            }
        } else {
            pill(label)
        }
    }

    @ViewBuilder
    private func pill(_ text: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(kind.fg).frame(width: 6, height: 6)
            Text(text)
                .font(TTypo.xsBold(11))
                .tLabel(tracking: 0.4)
                .foregroundStyle(kind.fg)
                .tnum()
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(kind.bg))
    }
}

private struct PersonAvatar: View {
    let person: Person
    var statusColor: Color = .clear

    private var initials: String {
        person.name.split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
            .joined()
    }

    var body: some View {
        Avatar(initials: initials,
               size: 38,
               gradient: true,
               presence: statusColor == .clear ? nil : statusColor,
               imageData: person.image)
    }
}

private struct OnJobCard: View {
    let person: Person
    let job: Job?

    private var sinceLabel: String { timeLabel(person.activeJobClock?.clockIn) }
    private var jobNumber: String? {
        guard let n = job?.jobNumber, !n.isEmpty else { return nil }
        return n
    }
    /// Department = the operation the worker is clocked into (e.g. LAYOUT).
    private var dept: String? {
        guard let op = person.activeJobClock?.opTitle, !op.isEmpty else { return nil }
        return op
    }
    /// Job details on one line: #number · client · dept · since.
    private var detailLine: String {
        var parts: [String] = []
        if let jobNumber { parts.append("#\(jobNumber)") }
        if let dept { parts.append(dept.uppercased()) }
        parts.append("since \(sinceLabel)")
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            // Worker — avatar + name (centered to each other) on the left edge.
            VStack(spacing: 6) {
                PersonAvatar(person: person, statusColor: Color(hex: T.presenceWork))
                Text(person.name)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            // Clock-in + On-job pills, with the job details on one line beneath.
            VStack(alignment: .trailing, spacing: 6) {
                ClockInStatus(person: person)
                ProductionPill(label: "On job", kind: .indigo,
                               sinceISO: person.activeJobClock?.clockIn)
                Text(detailLine)
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
                    .tnum()
                    .padding(.top, 2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frostedCard(radius: T.cornerMd)
    }
}

private struct OnBreakCard: View {
    let person: Person
    let job: Job?

    var body: some View {
        HStack(spacing: 12) {
            PersonAvatar(person: person, statusColor: Color(hex: T.presenceBreak))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(person.name)
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.ink))
                    if !person.role.isEmpty {
                        Text(person.role)
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 6) {
                ClockInStatus(person: person)
                ProductionPill(label: "Break", kind: .amber,
                               sinceISO: person.activeBreak?.startedAt)
            }
        }
        .padding(12)
        .frostedCard(radius: T.cornerMd)
    }
}

private struct OnLunchCard: View {
    let person: Person
    let sinceISO: String?

    var body: some View {
        HStack(spacing: 12) {
            PersonAvatar(person: person, statusColor: Color(hex: T.yellow))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(person.name)
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.ink))
                    if !person.role.isEmpty {
                        Text(person.role)
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 6) {
                ClockInStatus(person: person)
                ProductionPill(label: "Lunch", kind: .amber, sinceISO: sinceISO)
            }
        }
        .padding(12)
        .frostedCard(radius: T.cornerMd)
    }
}

private struct IdleOrOfflineCard: View {
    let person: Person
    let label: String
    /// When set, shows the top clock-status bar (Live board). Left nil by the
    /// By-dept / Today pivots, which reuse this row without a bar.
    var status: WorkerStatus? = nil

    var body: some View {
        HStack(spacing: 12) {
            PersonAvatar(person: person, statusColor: Color(hex: T.presenceIdle))
            VStack(alignment: .leading, spacing: 2) {
                Text(person.name)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                if !person.role.isEmpty {
                    Text(person.role)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 6) {
                ClockInStatus(person: person)
                // Live board: an "Idle" production pill (offline shows none —
                // the OUT clock pill says it). By-dept / Today (status nil):
                // keep the descriptive label they pass in.
                if status == .idle {
                    ProductionPill(label: "Idle", kind: .neutral)
                } else if status == nil {
                    Text(label)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
            }
        }
        .padding(12)
        .frostedCard(radius: T.cornerMd)
    }
}

// MARK: - Alternate views (placeholders for "By dept" / "Today" filters)
//
// Both show the same person rows in a different grouping. Keeping them
// intentionally lightweight — the Live view is the dispatcher's primary
// surface; these are convenience pivots and can be deepened later.

private struct ByDeptSection: View {
    let people: [Person]
    let jobsLookup: (Person) -> Job?

    private var grouped: [(String, [Person])] {
        let dict = Dictionary(grouping: people) { p -> String in
            let r = p.role.trimmingCharacters(in: .whitespaces)
            return r.isEmpty ? "Unassigned" : r
        }
        return dict.sorted { $0.key < $1.key }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(grouped, id: \.0) { dept, members in
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: dept, count: members.count)
                    VStack(spacing: 8) {
                        ForEach(members) { p in
                            IdleOrOfflineCard(person: p, label: statusLabel(p))
                        }
                    }
                }
            }
        }
    }

    private func statusLabel(_ p: Person) -> String {
        if let jc = p.activeJobClock {
            if jc.isPaused { return "On break" }
            return "On a job"
        }
        if p.activeClockIn != nil { return "Logged in" }
        return "Offline"
    }
}

private struct TodaySection: View {
    let people: [Person]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Today", count: people.count)
            VStack(spacing: 8) {
                ForEach(people) { p in
                    let label: String = {
                        guard let iso = p.activeClockIn?.clockIn else { return "Not in" }
                        return "Since \(timeLabel(iso))"
                    }()
                    IdleOrOfflineCard(person: p, label: label)
                }
            }
        }
    }
}

// MARK: - Time helpers

/// True while the person has an open lunchStart (on lunch = clocked out).
private func isOnLunch(_ person: Person) -> Bool {
    guard let events = person.activeClockIn?.events else { return false }
    var open = false
    for e in events {
        if e.type == "lunchStart" { open = true }
        else if e.type == "lunchEnd" { open = false }
    }
    return open
}

/// Clocked in for the day and not currently on lunch → the IN badge shows.
private func isClockedInNow(_ person: Person) -> Bool {
    person.activeClockIn != nil && !isOnLunch(person)
}

/// Live seconds on the pay clock today, excluding lunch. An open (in-progress)
/// lunch makes the running total and the lunch subtraction grow together, so
/// the value freezes for the duration of lunch. Nil when not clocked in.
private func clockedInSeconds(_ person: Person, now: Date) -> Int? {
    guard let c = person.activeClockIn, let start = Date.fromFlexibleISO8601(c.clockIn) else { return nil }
    let lunch = lunchPausedSeconds(c.events, now: now)
    return max(0, Int(now.timeIntervalSince(start) - lunch))
}

/// Total lunch seconds across the shift, counting an unmatched lunchStart as
/// running up to `now`.
private func lunchPausedSeconds(_ events: [ClockEvent], now: Date) -> TimeInterval {
    var paused: TimeInterval = 0
    var open: Date?
    for e in events {
        guard let t = Date.fromFlexibleISO8601(e.ts) else { continue }
        if e.type == "lunchStart" { open = t }
        else if e.type == "lunchEnd", let l = open { paused += max(0, t.timeIntervalSince(l)); open = nil }
    }
    if let l = open { paused += max(0, now.timeIntervalSince(l)) }
    return paused
}

/// "Xh Ym" from a second count.
private func hmLabel(_ seconds: Int) -> String {
    "\(seconds / 3600)h \((seconds % 3600) / 60)m"
}

/// "2h 30m" since an ISO timestamp, collapsing to "12m" under an hour.
private func shortElapsed(_ iso: String?, now: Date) -> String {
    guard let iso, let d = Date.fromFlexibleISO8601(iso) else { return "—" }
    let secs = max(0, Int(now.timeIntervalSince(d)))
    let h = secs / 3600, m = (secs % 3600) / 60
    return h > 0 ? "\(h)h \(m)m" : "\(m)m"
}

/// Formats an HH:MMa label from an ISO8601 timestamp string.
private func timeLabel(_ iso: String?) -> String {
    guard let iso, let d = Date.fromFlexibleISO8601(iso) else { return "—" }
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f.string(from: d)
}
