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
                .scrollIndicators(.hidden)
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
                            .foregroundStyle(on ? .white : Color(hex: T.ink))
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
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(onJob) { OnJobCard(person: $0, job: jobFor($0)) }
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
                ForEach(idle) { IdleOrOfflineCard(person: $0, label: "Logged in, no active job") }
            }
        }
        if !offline.isEmpty {
            SectionHeader(title: "Offline", count: offline.count)
            VStack(spacing: 10) {
                ForEach(offline) { IdleOrOfflineCard(person: $0, label: "Not clocked in") }
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

    private var role: String { person.role.isEmpty ? "" : person.role }
    private var sinceLabel: String { timeLabel(person.activeJobClock?.clockIn) }

    /// `#412 · M. Lopez · INSTALL` style summary — falls back gracefully
    /// when any of the three pieces are missing.
    private var jobLine: String {
        var parts: [String] = []
        if let n = job?.jobNumber, !n.isEmpty { parts.append("#\(n)") }
        if let title = job?.title ?? person.activeJobClock?.jobTitle, !title.isEmpty { parts.append(title) }
        if let op = person.activeJobClock?.opTitle, !op.isEmpty { parts.append(op.uppercased()) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                PersonAvatar(person: person, statusColor: Color(hex: T.presenceWork))
                VStack(alignment: .leading, spacing: 1) {
                    Text(person.name)
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                    if !role.isEmpty {
                        Text(role)
                            .font(TTypo.xs(11))
                            .foregroundStyle(Color(hex: T.muted))
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                TagPill(label: "On job", kind: .indigo)
            }

            HStack(spacing: 6) {
                Circle().fill(Color(hex: T.green)).frame(width: 6, height: 6)
                // Per-second tick so "2h 14m" visibly rolls forward
                // without waiting on the next people.json refresh.
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    Text(elapsedSince(person.activeJobClock?.clockIn, now: ctx.date))
                        .font(TTypo.smBold(13))
                        .foregroundStyle(Color(hex: T.green))
                        .tnum()
                }
                Spacer(minLength: 4)
                Text("since \(sinceLabel)")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tnum()
            }

            if !jobLine.isEmpty {
                Text(jobLine)
                    .font(TTypo.smBold(12))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
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
                HStack(spacing: 5) {
                    Image(systemName: "cup.and.saucer.fill")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color(hex: T.orange))
                    // "Xm on break" with a "· Nm over" tail once past the
                    // configured duration, so dispatchers can spot overruns.
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text(breakLabel(at: ctx.date))
                            .font(TTypo.smBold(13))
                            .foregroundStyle(Color(hex: T.orange))
                            .tnum()
                    }
                }
            }
            Spacer(minLength: 0)
            TagPill(label: "Break", kind: .amber)
        }
        .padding(12)
        .frostedCard(radius: T.cornerMd)
    }

    private func breakLabel(at now: Date) -> String {
        let elapsed = elapsedSince(person.activeBreak?.startedAt, now: now)
        guard let left = person.activeBreak?.secondsLeft(at: now) else { return "\(elapsed) on break" }
        if left < 0 {
            return "\(elapsed) on break · \(-left / 60)m over"
        }
        return "\(elapsed) on break"
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
                HStack(spacing: 5) {
                    Image(systemName: "fork.knife")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color(hex: T.yellow))
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text("\(elapsedSince(sinceISO, now: ctx.date)) on lunch")
                            .font(TTypo.smBold(13))
                            .foregroundStyle(Color(hex: T.yellow))
                            .tnum()
                    }
                }
            }
            Spacer(minLength: 0)
            TagPill(label: "Lunch", kind: .amber)
        }
        .padding(12)
        .frostedCard(radius: T.cornerMd)
    }
}

private struct IdleOrOfflineCard: View {
    let person: Person
    let label: String

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
            Text(label)
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
                .lineLimit(1)
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

/// Formats an HH:MMa label from an ISO8601 timestamp string.
private func timeLabel(_ iso: String?) -> String {
    guard let iso, let d = Date.fromFlexibleISO8601(iso) else { return "—" }
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f.string(from: d)
}

/// Renders the duration since `iso` as "Xh Ym". `now` defaults to the
/// current wall clock; callers wrapped in a TimelineView pass the
/// scheduler's tick date so the label updates every second without
/// touching the rest of the view.
private func elapsedSince(_ iso: String?, now: Date = Date()) -> String {
    guard let iso, let d = Date.fromFlexibleISO8601(iso) else { return "—" }
    let secs = max(0, Int(now.timeIntervalSince(d)))
    let h = secs / 3600
    let m = (secs % 3600) / 60
    return "\(h)h \(m)m"
}
