import SwiftUI
import Combine

// MARK: - Hours V3 (Pay period) · TRAQS Revamp
// The hero/main number is PAY-CLOCK hours — time clocked in for pay on the
// desktop time clock, minus lunch/break, for the configured pay period. Job
// time (hours logged ON jobs) lives in its own "Job Hours" section at the
// bottom, with a dated log scoped to the same pay period. The pay period comes
// straight from the org's time-clock settings (weekly/biweekly/semimonthly).

// One shared ISO8601 formatter for the whole Hours tab.
private let isoFormatter: ISO8601DateFormatter = ISO8601DateFormatter()

struct TimeClockView: View {
    @Environment(AppState.self) private var appState
    @State private var now = Date()
    @State private var showSettings = false
    @State private var showTimeOffSheet = false
    @State private var isStopping = false
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                TRAQSNavHeader {
                    IconBtn(icon: .settings, size: 18) { showSettings = true }
                }

                ScrollView {
                    VStack(spacing: 0) {

                        PageTitle(title: "Hours", subtitle: periodLabel)
                            .padding(.top, pageTitleTopInset)
                            .padding(.bottom, 10)

                        // ── Pay-clock hours (the hero) ──
                        // Time clocked in for pay (desktop), minus lunch/break,
                        // for the current pay period.
                        HeroRingCard(totalHours: payPeriodHours,
                                     target: periodTarget,
                                     onPace: payPeriodHours <= periodTarget)
                            .padding(.horizontal, 16)

                        // Live current shift (only while clocked in for pay).
                        if let pay = activePayClock {
                            PayStatusCard(clock: pay, liveHours: liveShiftHours)
                                .padding(.horizontal, 16)
                                .padding(.top, 14)
                        }

                        WeekBarsCard(days: dailyBars)
                            .padding(.horizontal, 16)
                            .padding(.top, 14)

                        // ── Job Hours (separate; only time logged ON jobs) ──
                        TSectionTitle(title: "Job Hours")

                        if let active = activeJobClock {
                            RunningEntryCard(jobClock: active, now: now,
                                             isStopping: isStopping,
                                             onStop: {
                                                 guard !isStopping else { return }
                                                 isStopping = true
                                                 Task {
                                                     await appState.jobClockOut()
                                                     isStopping = false
                                                 }
                                             })
                            .padding(.horizontal, 16)
                            .padding(.bottom, 4)
                        }

                        VStack(spacing: 12) {
                            JobHoursSummaryRow(periodHours: jobPeriodHours,
                                               sessions: jobSessionsInPeriod.count)
                            ForEach(jobSessionGroups) { group in
                                EntryGroupCard(group: group)
                            }
                            if jobSessionsInPeriod.isEmpty && activeJobClock == nil {
                                HoursEmptyState()
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)

                        // ── Time Off (PTO/UTO requests) ──
                        // Submit a request → admins approve/deny on the desktop.
                        // Approved requests flow into the schedule + accountant export.
                        TSectionTitle(title: "Time Off")

                        VStack(spacing: 12) {
                            GradientCTA(disabled: false, dimmed: false, fullWidth: true,
                                        verticalPadding: 13, action: { showTimeOffSheet = true }) {
                                HStack(spacing: 7) {
                                    Image(systemName: "calendar.badge.plus")
                                    Text("REQUEST TIME OFF").font(TTypo.xsBold(12)).tLabel(tracking: 0.8)
                                }
                            }
                            ForEach(myTimeOffRequests) { req in
                                TimeOffRequestCard(request: req) {
                                    Task { await appState.cancelTimeOff(id: req.id) }
                                }
                            }
                            if myTimeOffRequests.isEmpty {
                                TimeOffEmptyState()
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.hidden)
                .topFadeMask()
                .refreshable { await reload() }
            }
            .onReceive(ticker) { now = $0 }
            // On-demand datasets (heavy): the live person/jobs come from loadAll
            // elsewhere; here we only pull this person's clock + job-session logs.
            .task {
                await appState.refreshTimeclock(personId: appState.currentPersonId)
                await appState.refreshJobSessions(personId: appState.currentPersonId)
                await appState.refreshTimeOffRequests()
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showTimeOffSheet) {
            RequestTimeOffSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private func reload() async {
        await appState.loadAll()
        await appState.refreshTimeclock(personId: appState.currentPersonId)
        await appState.refreshJobSessions(personId: appState.currentPersonId)
        await appState.refreshTimeOffRequests()
    }

    /// My time-off requests, pending first, then newest start date.
    private var myTimeOffRequests: [TimeOffRequest] {
        let order: [String: Int] = ["pending": 0, "approved": 1, "denied": 2, "cancelled": 3]
        return appState.timeOffRequests.sorted { a, b in
            let oa = order[a.status] ?? 9, ob = order[b.status] ?? 9
            if oa != ob { return oa < ob }
            return a.start > b.start
        }
    }

    // MARK: - Pay-clock compute (the hero)

    private var myId: String? { appState.currentPersonId }
    private var activePayClock: ActiveClockIn? { appState.currentPerson?.activeClockIn }
    private var activeJobClock: ActiveJobClock? { appState.myActiveJobClock }

    private func isoDay(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return Date.fromFlexibleISO8601(iso)
    }

    /// All my completed pay-clock spans (any date).
    private var myCompletedEntries: [TimeclockEntry] {
        appState.timeclockEntries.filter { e in
            e.eventType == nil && e.clockIn != nil && e.clockOut != nil
                && (myId == nil || e.personId == myId)
        }
    }

    /// Completed pay-clock spans inside the configured pay period.
    private var payEntriesInPeriod: [TimeclockEntry] {
        let w = periodWindow
        let end = Calendar.current.date(byAdding: .day, value: 1, to: w.end) ?? w.end
        return myCompletedEntries.filter { e in
            guard let d = isoDay(e.clockIn) ?? parseISO(e.date ?? "") else { return false }
            return d >= w.start && d < end
        }
    }

    /// Pay-period total: completed spans (already net of lunch/break, computed
    /// server-side) + the live current shift.
    private var payPeriodHours: Double {
        payEntriesInPeriod.reduce(0.0) { $0 + ($1.hours ?? 0) } + liveShiftHours
    }

    /// Live hours for the current pay shift — counts while clocked in, pauses
    /// for lunch/break, mirroring the server's hoursElapsedMinusPauses.
    private var liveShiftHours: Double {
        guard let c = activePayClock, let s = Date.fromFlexibleISO8601(c.clockIn) else { return 0 }
        let totalMs = now.timeIntervalSince(s) * 1000
        return max(0, (totalMs - pausedMs(c.events, end: now)) / 3_600_000)
    }

    private func pausedMs(_ events: [ClockEvent], end: Date) -> Double {
        var paused = 0.0
        var lunchOpen: Date?
        var breakOpen: Date?
        for ev in events {
            guard let t = Date.fromFlexibleISO8601(ev.ts) else { continue }
            switch ev.type {
            case "lunchStart": lunchOpen = t
            case "lunchEnd":   if let l = lunchOpen { paused += max(0, t.timeIntervalSince(l) * 1000); lunchOpen = nil }
            case "breakStart": breakOpen = t
            case "breakEnd":   if let b = breakOpen { paused += max(0, t.timeIntervalSince(b) * 1000); breakOpen = nil }
            default: break
            }
        }
        if let l = lunchOpen { paused += max(0, end.timeIntervalSince(l) * 1000) }
        if let b = breakOpen { paused += max(0, end.timeIntervalSince(b) * 1000) }
        return paused
    }

    /// Pay-period target = the soft hours cap configured on the desktop's Time
    /// Clock settings (`orgSettings.payPeriodHourCap`, default 80). Hours past
    /// this read as overtime. Set per-org on the web so every device matches.
    private var periodTarget: Double {
        let cap = appState.orgSettings.payPeriodHourCap
        return cap > 0 ? cap : 80
    }

    /// Pay-clock hours per day for the last 8 days (the bar chart).
    private var dailyBars: [DailyBar] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        var out: [DailyBar] = []
        for i in stride(from: 7, through: 0, by: -1) {
            let d = cal.date(byAdding: .day, value: -i, to: today) ?? today
            let dow = ["S","M","T","W","T","F","S"][cal.component(.weekday, from: d) - 1]
            var h = myCompletedEntries.reduce(0.0) { acc, e in
                guard let ed = isoDay(e.clockIn) else { return acc }
                return cal.isDate(ed, inSameDayAs: d) ? acc + (e.hours ?? 0) : acc
            }
            if i == 0 { h += liveShiftHours }
            out.append(DailyBar(date: d, dow: dow, hours: h, isToday: i == 0))
        }
        return out
    }

    // MARK: - Job-hours compute (separate section)

    /// Live hours of the in-progress job clock (independent of the pay clock).
    private var liveJobHours: Double {
        guard let jc = activeJobClock, let s = Date.fromFlexibleISO8601(jc.clockIn) else { return 0 }
        var ms = now.timeIntervalSince(s) * 1000
        ms -= (jc.totalPausedMs ?? 0)
        if let p = jc.pausedAt, let pStart = Date.fromFlexibleISO8601(p) {
            ms -= now.timeIntervalSince(pStart) * 1000
        }
        return max(0, ms / 1000 / 3600)
    }

    /// My completed job sessions inside the pay period, newest first.
    private var jobSessionsInPeriod: [JobSession] {
        let w = periodWindow
        let end = Calendar.current.date(byAdding: .day, value: 1, to: w.end) ?? w.end
        return appState.jobSessions
            .filter { s in
                guard myId == nil || s.personId == myId else { return false }
                guard let d = isoDay(s.clockIn) ?? parseISO(s.date ?? "") else { return false }
                return d >= w.start && d < end
            }
            .sorted { ($0.clockIn ?? "") > ($1.clockIn ?? "") }
    }

    private var jobPeriodHours: Double {
        jobSessionsInPeriod.reduce(0.0) { $0 + ($1.hours ?? 0) } + liveJobHours
    }

    /// Job sessions grouped by day for the dated log.
    private var jobSessionGroups: [EntryGroup] {
        let cal = Calendar.current
        let df = DateFormatter(); df.dateFormat = "EEE · MMM d"
        let groups = Dictionary(grouping: jobSessionsInPeriod) { s -> Date in
            cal.startOfDay(for: isoDay(s.clockIn) ?? Date())
        }
        return groups.keys.sorted(by: >).map { day in
            let items = (groups[day] ?? []).map { s -> TimeEntry in
                let job = appState.jobs.first(where: { $0.id == s.jobId })
                let dept = job.map(deptForJob) ?? (label: "JOB", color: Color(hex: T.magenta))
                return TimeEntry(id: s.id,
                                 start: isoDay(s.clockIn) ?? day,
                                 end: isoDay(s.clockOut),
                                 jobTitle: s.jobTitle ?? job?.title ?? "Job",
                                 deptLabel: dept.label,
                                 deptColor: dept.color,
                                 running: false,
                                 hours: s.hours)
            }
            return EntryGroup(id: isoFormatter.string(from: day),
                              label: df.string(from: day),
                              entries: items)
        }
    }

    // MARK: - Pay-period window — from the org's time-clock settings

    private var periodWindow: (start: Date, end: Date) {
        let s = appState.orgSettings
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        let anchor = s.payPeriodStart.flatMap(parseISO) ?? today
        switch s.payPeriodType {
        case "weekly":
            let weekday = cal.component(.weekday, from: today)
            let toMonday = weekday == 1 ? -6 : -(weekday - 2)
            let start = cal.date(byAdding: .day, value: toMonday, to: today) ?? today
            let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
            return (start, end)
        case "semimonthly":
            let day = cal.component(.day, from: today)
            let comps = cal.dateComponents([.year, .month], from: today)
            let monthStart = cal.date(from: comps) ?? today
            if day <= 15 {
                let end = cal.date(byAdding: .day, value: 14, to: monthStart) ?? today
                return (monthStart, end)
            } else {
                let start = cal.date(byAdding: .day, value: 15, to: monthStart) ?? today
                let nextMonth = cal.date(byAdding: .month, value: 1, to: monthStart) ?? today
                let end = cal.date(byAdding: .day, value: -1, to: nextMonth) ?? today
                return (start, end)
            }
        default: // biweekly
            let days = cal.dateComponents([.day], from: anchor, to: today).day ?? 0
            let cycles = days / 14
            let start = cal.date(byAdding: .day, value: cycles * 14, to: anchor) ?? today
            let end = cal.date(byAdding: .day, value: 13, to: start) ?? today
            return (start, end)
        }
    }

    private func parseISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    private var periodLabel: String {
        let w = periodWindow
        let f = DateFormatter(); f.dateFormat = "MMM d"
        return "Pay period · \(f.string(from: w.start)) – \(f.string(from: w.end))"
    }
}

// MARK: - Hero: gradient progress ring + status

private struct HeroRingCard: View {
    let totalHours: Double
    let target: Double
    let onPace: Bool

    private var pct: Double { target > 0 ? min(100, totalHours / target * 100) : 0 }
    private var deltaLabel: String {
        let diff = abs(target - totalHours)
        return onPace ? String(format: "%.1fh left", diff)
                      : String(format: "+%.1fh overtime", diff)
    }

    var body: some View {
        HStack(spacing: 18) {
            ZStack {
                GradientRing(pct: pct, lineWidth: 12)
                    .frame(width: 116, height: 116)
                VStack(spacing: 0) {
                    Text(String(format: "%.1f", totalHours))
                        .font(.custom(TFontName.bold.rawValue, size: 30))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                    Text(String(format: "/ %.0f h", target))
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("THIS PERIOD")
                    .font(TTypo.xsBold(11))
                    .tLabel(tracking: 1.4)
                    .foregroundStyle(Color(hex: T.muted))
                Text(onPace ? "On track" : "Overtime")
                    .font(.custom(TFontName.bold.rawValue, size: 22))
                    .foregroundStyle(Color(hex: T.ink))
                TagPill(label: deltaLabel, kind: onPace ? .green : .amber, dot: false)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frostedCard()
    }
}

// MARK: - Live pay-shift status (clocked in / lunch / break + elapsed)

private struct PayStatusCard: View {
    let clock: ActiveClockIn
    let liveHours: Double

    private var status: (label: String, kind: TagKind, dot: Bool) {
        switch clock.events.last?.type {
        case "lunchStart": return ("On lunch", .indigo, true)
        case "breakStart": return ("On break", .amber, true)
        default:           return ("Clocked in", .green, true)
        }
    }
    private var elapsedLabel: String {
        let secs = max(0, Int(liveHours * 3600))
        return String(format: "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    var body: some View {
        HStack(spacing: 12) {
            IconChip(icon: .hours, color: Color(hex: T.accentGradientStart))
            VStack(alignment: .leading, spacing: 4) {
                Text("This shift")
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                HStack(spacing: 8) {
                    TagPill(label: status.label, kind: status.kind, dot: status.dot)
                    Text(elapsedLabel)
                        .font(TTypo.monoBold(13))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                }
            }
            Spacer(minLength: 8)
        }
        .padding(14)
        .frostedCard()
    }
}

// MARK: - This week bars (gradient) — pay-clock hours per day

struct DailyBar: Identifiable {
    var id: Date { date }
    let date: Date
    let dow: String
    let hours: Double
    let isToday: Bool
}

private struct WeekBarsCard: View {
    let days: [DailyBar]
    private let maxValue: Double = 9

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("This week")
                    .font(.custom(TFontName.bold.rawValue, size: 17))
                    .foregroundStyle(Color(hex: T.ink))
                Spacer()
                Text("last 8 days")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(days) { d in
                    VStack(spacing: 6) {
                        VStack {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(d.hours > 0 || d.isToday
                                      ? AnyShapeStyle(T.brandGradient(start: .bottom, end: .top))
                                      : AnyShapeStyle(Color(hex: T.progressTrack)))
                                .frame(height: max(8, min(1, d.hours / maxValue) * 96))
                                .frame(minHeight: d.hours == 0 && !d.isToday ? 8 : nil)
                        }
                        .frame(height: 96)
                        Text(d.dow)
                            .font(TTypo.xs(11))
                            .foregroundStyle(d.isToday ? Color(hex: T.ink) : Color(hex: T.muted))
                            .fontWeight(d.isToday ? .bold : .medium)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(16)
        .frostedCard()
    }
}

// MARK: - Job-hours period summary

private struct JobHoursSummaryRow: View {
    let periodHours: Double
    let sessions: Int

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("THIS PAY PERIOD")
                    .font(TTypo.xsBold(11))
                    .tLabel(tracking: 1.4)
                    .foregroundStyle(Color(hex: T.muted))
                Text(String(format: "%.2f h on jobs", periodHours))
                    .font(.custom(TFontName.bold.rawValue, size: 17))
                    .foregroundStyle(Color(hex: T.ink))
                    .tnum()
            }
            Spacer()
            Text("\(sessions) session\(sessions == 1 ? "" : "s")")
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
    }
}

// MARK: - Running entry card (frosted, gradient STOP)

private struct RunningEntryCard: View {
    let jobClock: ActiveJobClock
    let now: Date
    let isStopping: Bool
    let onStop: () -> Void

    private var elapsedLabel: String {
        guard let s = Date.fromFlexibleISO8601(jobClock.clockIn) else { return "—" }
        var ms = now.timeIntervalSince(s) * 1000
        ms -= (jobClock.totalPausedMs ?? 0)
        if let p = jobClock.pausedAt, let pStart = Date.fromFlexibleISO8601(p) {
            ms -= now.timeIntervalSince(pStart) * 1000
        }
        let secs = max(0, Int(ms / 1000))
        return String(format: "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    var body: some View {
        HStack(spacing: 12) {
            IconChip(icon: .hours, color: Color(hex: T.accentGradientStart))
            VStack(alignment: .leading, spacing: 4) {
                Text(jobClock.jobTitle ?? "Job")
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                HStack(spacing: 8) {
                    TagPill(label: "RUNNING", kind: .indigo, dot: true)
                    Text(elapsedLabel)
                        .font(TTypo.monoBold(13))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                }
            }
            Spacer(minLength: 8)
            GradientCTA(disabled: isStopping, dimmed: false, fullWidth: false,
                        verticalPadding: 8, action: onStop) {
                HStack(spacing: 5) {
                    if isStopping {
                        ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(0.6)
                        Text("STOPPING…").font(TTypo.xsBold(11)).tLabel(tracking: 0.8)
                    } else {
                        Image(systemName: "stop.fill")
                        Text("STOP").font(TTypo.xsBold(11)).tLabel(tracking: 0.8)
                    }
                }
            }
            .fixedSize()
        }
        .padding(14)
        .frostedCard()
    }
}

// MARK: - Recent entries (used by the Job Hours dated log)

struct TimeEntry: Identifiable {
    let id: String
    let start: Date
    let end: Date?
    let jobTitle: String
    let deptLabel: String
    let deptColor: Color
    let running: Bool
    var hours: Double? = nil
}

struct EntryGroup: Identifiable {
    let id: String
    let label: String
    let entries: [TimeEntry]
}

private struct EntryGroupCard: View {
    let group: EntryGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(group.label)
                .font(TTypo.xsBold(11))
                .foregroundStyle(Color(hex: T.muted))
                .tLabel(tracking: 1.4)
            VStack(spacing: 0) {
                ForEach(group.entries.indices, id: \.self) { i in
                    EntryRow(entry: group.entries[i])
                    if i < group.entries.count - 1 {
                        SLine().padding(.leading, 60)
                    }
                }
            }
            .frostedCard(radius: T.cornerMd)
        }
    }
}

private struct EntryRow: View {
    let entry: TimeEntry

    private var timeRange: String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        let s = f.string(from: entry.start)
        let e = entry.end.map(f.string(from:)) ?? "live"
        return "\(s) – \(e)"
    }

    var body: some View {
        HStack(spacing: 12) {
            IconChip(icon: .hours, color: entry.deptColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.jobTitle)
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
                Text(timeRange)
                    .font(TTypo.mono(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tnum()
            }
            Spacer(minLength: 8)
            if entry.running {
                TagPill(label: "LIVE", kind: .indigo, dot: true)
            } else if let h = entry.hours {
                Text(String(format: "%.2fh", h))
                    .font(TTypo.monoBold(13))
                    .foregroundStyle(Color(hex: T.ink))
                    .tnum()
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }
}

private struct HoursEmptyState: View {
    var body: some View {
        VStack(spacing: 8) {
            TIconView(icon: .hours, size: 24, color: Color(hex: T.muted))
            Text("No job time this pay period")
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.muted))
            Text("Start a job from the Jobs tab to log time.")
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
        }
        .frame(maxWidth: .infinity)
        .padding(22)
        .frostedCard()
    }
}

// MARK: - Time Off request card (one per request, with status + cancel)

private struct TimeOffRequestCard: View {
    let request: TimeOffRequest
    let onCancel: () -> Void

    private var typeColor: Color { request.type == "UTO" ? Color(hex: "#F59E0B") : Color(hex: "#10B981") }
    private var statusPill: (label: String, kind: TagKind, dot: Bool) {
        switch request.status {
        case "approved":  return ("Approved", .green, false)
        case "denied":    return ("Denied", .magenta, false)
        case "cancelled": return ("Cancelled", .neutral, false)
        default:          return ("Pending", .amber, true)
        }
    }
    private var rangeLabel: String {
        let out = DateFormatter(); out.dateFormat = "MMM d"
        let inF = ISO8601DateFormatter(); inF.formatOptions = [.withFullDate]
        let sL = inF.date(from: request.start).map(out.string(from:)) ?? request.start
        let eL = inF.date(from: request.end).map(out.string(from:)) ?? request.end
        return request.start == request.end ? sL : "\(sL) – \(eL)"
    }

    var body: some View {
        HStack(spacing: 12) {
            IconChip(icon: .cal, color: typeColor)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(request.type)
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.ink))
                    TagPill(label: statusPill.label, kind: statusPill.kind, dot: statusPill.dot)
                }
                Text(rangeLabel)
                    .font(TTypo.xs(12))
                    .foregroundStyle(Color(hex: T.muted))
                if request.status == "denied", let r = request.denialReason, !r.isEmpty {
                    Text("“\(r)”")
                        .font(TTypo.xs(11))
                        .italic()
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(2)
                } else if !request.note.isEmpty {
                    Text(request.note)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if request.status != "cancelled" {
                Button(action: onCancel) {
                    Text(request.status == "pending" ? "Cancel" : "Remove")
                        .font(TTypo.xsBold(11))
                        .tLabel(tracking: 0.4)
                        .foregroundStyle(Color(hex: T.muted))
                        .padding(.horizontal, 11).padding(.vertical, 6)
                        .background(Capsule().stroke(Color(hex: T.hair), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frostedCard(radius: T.cornerMd)
    }
}

private struct TimeOffEmptyState: View {
    var body: some View {
        VStack(spacing: 8) {
            TIconView(icon: .cal, size: 24, color: Color(hex: T.muted))
            Text("No time-off requests")
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.muted))
            Text("Tap “Request time off” to submit PTO or UTO.")
                .font(TTypo.xs(11))
                .foregroundStyle(Color(hex: T.muted))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(22)
        .frostedCard()
    }
}

// MARK: - Request Time Off sheet (date range + PTO/UTO + note)

private struct RequestTimeOffSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var type = "PTO"
    @State private var start = Date()
    @State private var end = Date()
    @State private var note = ""
    @State private var submitting = false
    @State private var error: String?

    private static let ymd: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private var validRange: Bool {
        let cal = Calendar.current
        return cal.startOfDay(for: end) >= cal.startOfDay(for: start)
    }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Request Time Off")
                        .font(TTypo.h3(20))
                        .foregroundStyle(Color(hex: T.ink))
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 18)

                VStack(alignment: .leading, spacing: 8) {
                    Text("TYPE")
                        .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                        .foregroundStyle(Color(hex: T.muted))
                    Picker("", selection: $type) {
                        Text("PTO · paid").tag("PTO")
                        Text("UTO · unpaid").tag("UTO")
                    }
                    .pickerStyle(.segmented)
                }

                VStack(spacing: 4) {
                    DatePicker(selection: $start, displayedComponents: .date) {
                        Text("Start").font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.ink))
                    }
                    .tint(Color(hex: T.accentGradientStart))
                    SLine()
                    DatePicker(selection: $end, in: start..., displayedComponents: .date) {
                        Text("End").font(TTypo.smBold(14)).foregroundStyle(Color(hex: T.ink))
                    }
                    .tint(Color(hex: T.accentGradientStart))
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frostedCard(radius: T.cornerMd)

                VStack(alignment: .leading, spacing: 8) {
                    Text("NOTE (OPTIONAL)")
                        .font(TTypo.xsBold(11)).tLabel(tracking: 1.4)
                        .foregroundStyle(Color(hex: T.muted))
                    TextField("Reason…", text: $note, axis: .vertical)
                        .lineLimit(1...3)
                        .font(TTypo.sm(14))
                        .foregroundStyle(Color(hex: T.ink))
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).fill(Color(hex: T.surface)))
                        .overlay(RoundedRectangle(cornerRadius: T.cornerMd, style: .continuous).stroke(Color(hex: T.hair), lineWidth: 1))
                }

                if let error {
                    Text(error)
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: "#DC2626"))
                }

                Spacer()

                GradientCTA(disabled: submitting || !validRange,
                            dimmed: submitting || !validRange,
                            fullWidth: true, verticalPadding: 14, action: submit) {
                    HStack(spacing: 7) {
                        if submitting {
                            ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(0.7)
                        }
                        Text(submitting ? "SUBMITTING…" : "SUBMIT REQUEST")
                            .font(TTypo.smBold(14)).tLabel(tracking: 0.8)
                    }
                }
                .padding(.bottom, 18)
            }
            .padding(.horizontal, 20)
        }
    }

    private func submit() {
        guard !submitting, validRange else { return }
        submitting = true
        error = nil
        let s = Self.ymd.string(from: start)
        let e = Self.ymd.string(from: end)
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                try await appState.submitTimeOff(type: type, start: s, end: e, note: n)
                submitting = false
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                submitting = false
            }
        }
    }
}
