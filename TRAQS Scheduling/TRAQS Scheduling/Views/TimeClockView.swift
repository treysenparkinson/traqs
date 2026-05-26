import SwiftUI
import Combine

// MARK: - Hours V1 (Pay period) · TRAQS Light
// Lives in TimeClockView.swift / struct TimeClockView for back-compat.
// Per-job time tracking; no payroll clock-in on mobile (desktop-only).

// One shared ISO8601 formatter for the whole Hours tab. The view recomputes
// every second from the ticker, so freshly allocating a formatter on every
// elapsed-label tick or weekHours pass was both wasteful and (under load on
// older devices) a likely cause of the intermittent stalls/errors on this tab.
private let isoFormatter: ISO8601DateFormatter = ISO8601DateFormatter()

struct TimeClockView: View {
    @Environment(AppState.self) private var appState
    @State private var now = Date()
    @State private var showSettings = false
    @State private var isStopping = false
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            VStack(spacing: 0) {
                // Sticky header.
                TRAQSNavHeader {
                    IconBtn(icon: .settings, size: 18) { showSettings = true }
                }
                .background(Color(hex: T.bg))

                ScrollView {
                    VStack(spacing: 0) {

                    HeroPayPeriodCard(totalHours: weekHours,
                                      target: weeklyTarget,
                                      onPace: onPace,
                                      now: now,
                                      settings: appState.orgSettings)
                    .padding(.horizontal, 16)
                    .padding(.top, 4)

                    DailyBarsCard(days: dailyBars)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)

                    if let active = activeJobClock {
                        TSectionTitle(title: "Running")
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

                    TSectionTitle(title: "Recent entries")

                    VStack(spacing: 14) {
                        ForEach(groupedEntries) { group in
                            EntryGroupCard(group: group)
                        }
                        if groupedEntries.isEmpty {
                            HoursEmptyState()
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.hidden)
                .refreshable { await appState.loadAll() }
            }
            .onReceive(ticker) { now = $0 }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    // MARK: Compute

    private var activeJobClock: ActiveJobClock? { appState.myActiveJobClock }

    /// Total hours billed this calendar week (sum of job.loggedHours that the
    /// current user worked on — currently we don't have per-entry breakdown,
    /// so this is a best-effort: sum each job's loggedHours that the user is
    /// a member of. Plus live running clock.)
    private var weekHours: Double {
        // Safe optional binding instead of `me!` force unwraps inside escaping
        // closures — the previous short-circuit pattern (`me == nil || … me! …`)
        // was logically sound but fragile, and the most likely candidate for
        // the intermittent runtime errors on this tab.
        let totalLogged = appState.jobs.reduce(0.0) { acc, job in
            let onJob: Bool
            if let me = appState.currentPersonId {
                onJob = job.team.contains(me)
                    || job.subs.contains { panel in
                        panel.team.contains(me) || panel.subs.contains { $0.team.contains(me) }
                    }
            } else {
                onJob = true
            }
            return onJob ? acc + (job.loggedHours ?? 0) : acc
        }
        return totalLogged + liveRunningHours
    }

    private var liveRunningHours: Double {
        guard let jc = activeJobClock,
              let s = Date.fromFlexibleISO8601(jc.clockIn) else { return 0 }
        var ms = now.timeIntervalSince(s) * 1000
        ms -= (jc.totalPausedMs ?? 0)
        if let p = jc.pausedAt, let pStart = Date.fromFlexibleISO8601(p) {
            ms -= now.timeIntervalSince(pStart) * 1000
        }
        return max(0, ms / 1000 / 3600)
    }

    /// Weekly target = org's hours-per-day × number of work days. Falls back to 40 if the
    /// org config is malformed.
    private var weeklyTarget: Double {
        let s = appState.orgSettings
        let target = s.hpd * Double(max(1, s.workDays.count))
        return target > 0 ? target : 40
    }

    private var onPace: Bool { weekHours <= weeklyTarget }

    /// Last 8 days of activity, today highlighted in sky.
    /// Until we track per-day entries we approximate with the running clock placed today.
    private var dailyBars: [DailyBar] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        var out: [DailyBar] = []
        for i in stride(from: 7, through: 0, by: -1) {
            let d = cal.date(byAdding: .day, value: -i, to: today) ?? today
            let dow = ["S","M","T","W","T","F","S"][cal.component(.weekday, from: d) - 1]
            let h: Double = (i == 0 ? liveRunningHours : 0)
            out.append(DailyBar(date: d, dow: dow, hours: h, isToday: i == 0))
        }
        return out
    }

    /// Grouped entries — derived from any active job clock for now.
    /// A real per-entry data feed would replace this.
    private var groupedEntries: [EntryGroup] {
        guard let jc = activeJobClock,
              let s = Date.fromFlexibleISO8601(jc.clockIn) else { return [] }
        let cal = Calendar.current
        let day = cal.startOfDay(for: s)
        let df = DateFormatter(); df.dateFormat = "EEE · MMM d"
        let job = appState.jobs.first(where: { $0.id == jc.jobId })
        let dept: (label: String, color: Color) =
            job.map(deptForJob) ?? (label: "JOB", color: Color(hex: T.magenta))
        let entry = TimeEntry(id: jc.jobId,
                              start: s,
                              end: nil,
                              jobTitle: jc.jobTitle ?? job?.title ?? "Job",
                              deptLabel: dept.label,
                              deptColor: dept.color,
                              running: true)
        return [EntryGroup(id: isoFormatter.string(from: day),
                           label: df.string(from: s),
                           entries: [entry])]
    }
}

// MARK: - Hero card (ink-filled, paper text)

private struct HeroPayPeriodCard: View {
    let totalHours: Double
    let target: Double
    let onPace: Bool
    let now: Date
    let settings: OrgSettings

    /// Window for the current pay period.
    /// - weekly: Mon → Sun containing today (or aligned to payPeriodStart day-of-week if set).
    /// - biweekly: 14-day window anchored on payPeriodStart (falls back to two weeks back).
    /// - semimonthly: 1st → 15th or 16th → end-of-month.
    private var periodWindow: (start: Date, end: Date) {
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        let anchor = settings.payPeriodStart.flatMap(parseISO) ?? today
        switch settings.payPeriodType {
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

    private var leftLabel: String {
        String(format: "%.1f left to weekly target", max(0, target - totalHours))
    }

    var body: some View {
        SBox(size: .lg, fill: Color(hex: T.ink), stroke: Color(hex: T.ink)) {
            VStack(alignment: .leading, spacing: 6) {
                Text(periodLabel)
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.paper).opacity(0.7))
                    .tLabel(tracking: 1.4)

                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text(String(format: "%.2f", totalHours))
                        .font(.custom(TFontName.bold.rawValue, size: 48))
                        .foregroundStyle(Color(hex: T.paper))
                        .tnum()
                    Text("hours")
                        .font(TTypo.h3(18))
                        .foregroundStyle(Color(hex: T.paper).opacity(0.7))
                }

                HStack(spacing: 12) {
                    Text(leftLabel)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.paper).opacity(0.7))
                    Text(onPace ? "· on pace" : "· behind")
                        .font(TTypo.xsBold(11))
                        .foregroundStyle(Color(hex: onPace ? T.sky : T.orange))
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Daily bars card

struct DailyBar: Identifiable {
    var id: Date { date }
    let date: Date
    let dow: String
    let hours: Double
    let isToday: Bool
}

private struct DailyBarsCard: View {
    let days: [DailyBar]
    private let maxValue: Double = 9

    var body: some View {
        SBox(size: .md, raised: true) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Daily")
                        .font(TTypo.xsBold(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .tLabel(tracking: 1.2)
                    Spacer()
                    Text("last 8 days")
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                }
                HStack(alignment: .bottom, spacing: 8) {
                    ForEach(days) { d in
                        VStack(spacing: 6) {
                            GeometryReader { _ in
                                VStack {
                                    Spacer()
                                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                                        .fill(d.isToday ? Color(hex: T.sky)
                                              : (d.hours == 0 ? Color(hex: T.hair) : Color(hex: T.ink)))
                                        .frame(height: max(2, min(1, d.hours / maxValue) * 88))
                                }
                            }
                            .frame(height: 88)
                            Text(d.dow)
                                .font(TTypo.xs(11))
                                .foregroundStyle(d.isToday ? Color(hex: T.ink) : Color(hex: T.muted))
                                .fontWeight(d.isToday ? .bold : .medium)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(14)
        }
    }
}

// MARK: - Running entry card (sky chip + live elapsed)

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
        SBox(size: .md, sky: true) {
            HStack(spacing: 10) {
                Circle().fill(Color(hex: T.sky)).frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 4) {
                    Text(jobClock.jobTitle ?? "Job")
                        .font(TTypo.smBold(13))
                        .foregroundStyle(Color(hex: T.ink))
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        Chip(label: "RUNNING",
                             fill: Color(hex: T.sky).opacity(0.12),
                             stroke: Color(hex: T.sky),
                             color: Color(hex: T.sky))
                        Text(elapsedLabel)
                            .font(TTypo.monoBold(13))
                            .foregroundStyle(Color(hex: T.ink))
                            .tnum()
                    }
                }
                Spacer()
                Button(action: onStop) {
                    HStack(spacing: 5) {
                        if isStopping {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(.white)
                                .scaleEffect(0.6)
                            Text("STOPPING…").font(TTypo.xsBold(11)).tLabel(tracking: 0.8)
                        } else {
                            Image(systemName: "stop.fill")
                            Text("STOP").font(TTypo.xsBold(11)).tLabel(tracking: 0.8)
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Capsule().fill(Color(hex: T.sky)))
                }
                .buttonStyle(.plain)
                .disabled(isStopping)
            }
            .padding(12)
        }
    }
}

// MARK: - Recent entries

struct TimeEntry: Identifiable {
    let id: String
    let start: Date
    let end: Date?
    let jobTitle: String
    let deptLabel: String
    let deptColor: Color
    let running: Bool
}

struct EntryGroup: Identifiable {
    let id: String
    let label: String
    let entries: [TimeEntry]
}

private struct EntryGroupCard: View {
    let group: EntryGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(group.label)
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.4)
                Spacer()
            }
            SBox(size: .md, raised: true) {
                VStack(spacing: 0) {
                    ForEach(group.entries.indices, id: \.self) { i in
                        EntryRow(entry: group.entries[i])
                        if i < group.entries.count - 1 {
                            SLine().padding(.leading, 22)
                        }
                    }
                }
            }
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
        HStack(spacing: 10) {
            Rectangle().fill(entry.deptColor).frame(width: 4, height: 28).cornerRadius(2)
            VStack(alignment: .leading, spacing: 2) {
                Text(timeRange)
                    .font(TTypo.mono(11))
                    .foregroundStyle(Color(hex: T.ink))
                    .tnum()
                Text(entry.jobTitle)
                    .font(TTypo.smBold(13))
                    .foregroundStyle(Color(hex: T.ink))
                    .lineLimit(1)
            }
            Spacer()
            if entry.running {
                Chip(label: "● LIVE",
                     fill: Color(hex: T.sky).opacity(0.10),
                     stroke: Color(hex: T.sky),
                     color: Color(hex: T.sky))
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }
}

private struct HoursEmptyState: View {
    var body: some View {
        SBox(size: .md, dashed: true) {
            VStack(spacing: 8) {
                TIconView(icon: .hours, size: 24, color: Color(hex: T.muted))
                Text("No recent entries")
                    .font(TTypo.smBold(13))
                    .foregroundStyle(Color(hex: T.muted))
                Text("Log time against a job to start tracking.")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }
            .frame(maxWidth: .infinity)
            .padding(20)
        }
    }
}
