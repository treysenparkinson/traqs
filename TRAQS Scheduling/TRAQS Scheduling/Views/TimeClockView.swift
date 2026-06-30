import SwiftUI
import Combine

// MARK: - Hours V2 (Pay period) · TRAQS Revamp
// Lives in TimeClockView.swift / struct TimeClockView for back-compat.
// Per-job time tracking; no payroll clock-in on mobile (desktop-only).
// Visual: gradient progress ring hero + gradient weekly bars + frosted recent
// rows — matched to the Hours wireframe. All compute logic is unchanged.

// One shared ISO8601 formatter for the whole Hours tab.
private let isoFormatter: ISO8601DateFormatter = ISO8601DateFormatter()

struct TimeClockView: View {
    @Environment(AppState.self) private var appState
    @State private var now = Date()
    @State private var showSettings = false
    @State private var isStopping = false
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                // Sticky header (unchanged structure).
                TRAQSNavHeader {
                    IconBtn(icon: .settings, size: 18) { showSettings = true }
                }

                ScrollView {
                    VStack(spacing: 0) {

                    PageTitle(title: "Hours", subtitle: periodLabel)
                        .padding(.bottom, 10)

                    HeroRingCard(totalHours: weekHours,
                                 target: weeklyTarget,
                                 onPace: onPace)
                        .padding(.horizontal, 16)

                    WeekBarsCard(days: dailyBars)
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

                    TSectionTitle(title: "Recent")

                    VStack(spacing: 12) {
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

    // MARK: Compute (unchanged)

    private var activeJobClock: ActiveJobClock? { appState.myActiveJobClock }

    private var weekHours: Double {
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

    private var weeklyTarget: Double {
        let s = appState.orgSettings
        let target = s.hpd * Double(max(1, s.workDays.count))
        return target > 0 ? target : 40
    }

    private var onPace: Bool { weekHours <= weeklyTarget }

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

    // MARK: Pay-period window (moved up so it titles the page) — logic unchanged

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
                      : String(format: "%.1fh over", diff)
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
                Text(onPace ? "On track" : "Behind")
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

// MARK: - This week bars (gradient)

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
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
    }
}

private struct HoursEmptyState: View {
    var body: some View {
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
        .padding(22)
        .frostedCard()
    }
}
