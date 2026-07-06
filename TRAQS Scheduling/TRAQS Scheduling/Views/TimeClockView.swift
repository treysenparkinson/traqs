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
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                TRAQSNavHeader {
                    IconBtn(icon: .settings, size: 18) { showSettings = true }
                }

                ScrollViewReader { _ in
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

                        // ── Pay clock-in/out (admin opt-in via iosPayClockEnabled) ──
                        // Sits below the bar graph so the hero number reads first.
                        if appState.orgSettings.iosPayClockEnabled {
                            PayClockCTA(active: appState.payClockInActive,
                                        source: appState.payClockInSource,
                                        elapsed: payClockElapsed,
                                        inFlight: appState.isPayClocking,
                                        onToggle: {
                                            guard !appState.isPayClocking else { return }
                                            Task {
                                                if appState.payClockInActive { await appState.payClockOut() }
                                                else { await appState.payClockIn() }
                                            }
                                        })
                                .padding(.horizontal, 16)
                                .padding(.top, 14)
                        }
                    }
                    .padding(.bottom, 24)
                  }
                  .scrollIndicators(.hidden)
                  .topFadeMask()
                  .refreshable { await reload() }
                }
            }
            .onReceive(ticker) { now = $0 }
            // On-demand datasets (heavy): the live person/jobs come from loadAll
            // elsewhere; here we only pull this person's clock + job-session logs.
            .task {
                await appState.refreshTimeclock(personId: appState.currentPersonId)
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private func reload() async {
        await appState.loadAll()
        await appState.refreshTimeclock(personId: appState.currentPersonId)
    }

    // MARK: - Pay-clock compute (the hero)

    private var myId: String? { appState.currentPersonId }
    private var activePayClock: ActiveClockIn? { appState.currentPerson?.activeClockIn }

    /// Wall-clock elapsed for the pay-clock CTA (H:MM:SS once past an hour, else
    /// MM:SS). Driven by the 1s `now` ticker. Net-of-break hours live in the
    /// hero ring; this is just the CTA's live timer.
    private var payClockElapsed: String {
        guard let start = appState.payClockInStart else { return "0:00" }
        let secs = max(0, Int(now.timeIntervalSince(start)))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

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

    // MARK: - Pay-period window — from the org's time-clock settings

    // Single source of truth — AppState.payPeriodWindow (semi-monthly payDates
    // when configured, else legacy biweekly/weekly/semimonthly). Kept as a thin
    // property so the rest of the view (and the 1s `now` ticker) is unchanged.
    private var periodWindow: (start: Date, end: Date) {
        appState.payPeriodWindow(now: now)
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

// MARK: - Pay clock-in/out CTA (top of Hours; admin opt-in via iosPayClockEnabled)

private struct PayClockCTA: View {
    let active: Bool
    let source: String?
    let elapsed: String
    let inFlight: Bool
    let onToggle: () -> Void

    // Clocked in, but the open shift was started somewhere else (e.g. a kiosk).
    private var viaOtherSource: Bool { active && source != nil && source != "ios-app" }

    var body: some View {
        VStack(spacing: 8) {
            Button(action: onToggle) {
                HStack(spacing: 9) {
                    if inFlight {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: active ? "stop.circle.fill" : "play.circle.fill")
                            .font(.system(size: 17, weight: .semibold))
                    }
                    Text(active ? "Clock Out for Pay" : "Clock In for Pay")
                        .font(TTypo.xsBold(13)).tLabel(tracking: 0.6)
                    if active && !inFlight {
                        Text(elapsed).font(TTypo.monoBold(13)).tnum()
                    }
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Capsule().fill(Color(hex: active ? T.red : T.green)))
                .opacity(inFlight ? 0.6 : 1)
            }
            .buttonStyle(.plain)
            .disabled(inFlight)

            if viaOtherSource {
                Text("Clocked in via \(source ?? "another device")")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }
        }
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
