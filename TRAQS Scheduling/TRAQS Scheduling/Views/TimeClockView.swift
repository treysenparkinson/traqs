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
    @Environment(AppNav.self) private var appNav
    @State private var now = Date()
    @State private var showPinPrompt = false
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                TRAQSNavHeader {
                    // Time Off lives here now (removed from the side drawer).
                    Button { appNav.openTimeOffPage = true } label: {
                        HStack(spacing: 6) {
                            TIconView(icon: .cal, size: 14, color: Color(hex: T.ink))
                            Text("Time Off")
                                .font(TTypo.smBold(13))
                                .foregroundStyle(Color(hex: T.ink))
                        }
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                        .glassEffect(.regular.interactive(), in: Capsule())
                    }
                    .buttonStyle(.plain)
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

                        // Live shift status — always shown when the pay clock is
                        // enabled for mobile (task 4), including a resting
                        // "Clocked out" state so the card never disappears.
                        if showPayClock {
                            PayStatusCard(active: appState.payClockInActive,
                                          onLunch: appState.payOnLunch,
                                          liveHours: liveShiftHours,
                                          source: appState.payClockInSource)
                                .padding(.horizontal, 16)
                                .padding(.top, 14)
                        }

                        WeekBarsCard(days: dailyBars)
                            .padding(.horizontal, 16)
                            .padding(.top, 14)

                        // ── Pay clock controls (admin opt-in via iosPayClockEnabled) ──
                        // Sits below the bar graph so the hero number reads first.
                        // Clocked out → one Clock In button. Clocked in → Lunch +
                        // Clock Out (task 1).
                        if showPayClock {
                            PayClockControls(active: appState.payClockInActive,
                                             onLunch: appState.payOnLunch,
                                             source: appState.payClockInSource,
                                             elapsed: payClockElapsed,
                                             inFlight: appState.isPayClocking,
                                             clockOutBlocked: appState.clockOutBlockedByJob,
                                             onClockIn: {
                                                 guard !appState.isPayClocking else { return }
                                                 // task 2: require the person's PIN if they have one set.
                                                 if appState.currentPerson?.hasPin == true {
                                                     showPinPrompt = true
                                                 } else {
                                                     Task { await appState.payClockIn() }
                                                 }
                                             },
                                             onClockOut: {
                                                 guard !appState.isPayClocking else { return }
                                                 Task { await appState.payClockOut() }
                                             },
                                             onLunchToggle: {
                                                 guard !appState.isPayClocking else { return }
                                                 Task { await appState.payLunchToggle() }
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

            // PIN entry for clock-in (task 2) — an overlay rather than a second
            // .sheet, since the view already presents the Settings sheet.
            if showPinPrompt {
                ClockInPinOverlay(
                    personName: appState.currentPerson?.name,
                    onCancel: { withAnimation(.easeOut(duration: 0.15)) { showPinPrompt = false } },
                    onSubmit: { pin in
                        let ok = await appState.payClockIn(pin: pin)
                        if ok { withAnimation(.easeOut(duration: 0.15)) { showPinPrompt = false } }
                        return ok
                    }
                )
                .transition(.opacity)
                .zIndex(10)
            }
        }
        .animation(.easeInOut(duration: 0.18), value: showPinPrompt)
    }

    private func reload() async {
        await appState.loadAll()
        await appState.refreshTimeclock(personId: appState.currentPersonId)
    }

    // MARK: - Pay-clock compute (the hero)

    private var myId: String? { appState.currentPersonId }
    private var activePayClock: ActiveClockIn? { appState.currentPerson?.activeClockIn }
    /// Pay clock UI shows only when the org enabled it AND the person is hourly —
    /// salaried employees don't punch a clock.
    private var showPayClock: Bool {
        appState.orgSettings.iosPayClockEnabled && !(appState.currentPerson?.isSalary ?? false)
    }

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

// MARK: - Pay clock controls (Hours; admin opt-in via iosPayClockEnabled)

// Clocked out → a single Clock In button on the signature brand gradient.
// Clocked in → a Lunch toggle + a red Clock Out, side by side (task 1). While a
// request is in flight both active buttons dim and disable.
private struct PayClockControls: View {
    let active: Bool
    let onLunch: Bool
    let source: String?
    let elapsed: String
    let inFlight: Bool
    var clockOutBlocked: Bool = false   // on a job → can't clock out yet
    let onClockIn: () -> Void
    let onClockOut: () -> Void
    let onLunchToggle: () -> Void

    // Indigo matches the "On lunch" status pill; green signals "back to work".
    private let lunchColor  = "#6366F1"

    // Clocked in, but the open shift was started somewhere else (e.g. a kiosk).
    private var viaOtherSource: Bool { active && source != nil && source != "ios-app" }

    var body: some View {
        VStack(spacing: 8) {
            if active {
                HStack(spacing: 10) {
                    Button(action: onLunchToggle) {
                        pill(icon: onLunch ? "play.circle.fill" : "fork.knife",
                             text: onLunch ? "End Lunch" : "Lunch",
                             fill: Color(hex: onLunch ? T.green : lunchColor))
                    }
                    .buttonStyle(.plain)
                    .disabled(inFlight)

                    Button(action: onClockOut) {
                        pill(icon: "stop.circle.fill", text: "Clock Out", fill: Color(hex: T.red))
                    }
                    .buttonStyle(.plain)
                    .disabled(inFlight || clockOutBlocked)
                    .opacity(clockOutBlocked ? 0.5 : 1)
                }
                .opacity(inFlight ? 0.6 : 1)

                if clockOutBlocked {
                    Text("Stop your job before clocking out")
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                }
            } else {
                Button(action: onClockIn) {
                    HStack(spacing: 9) {
                        if inFlight { ProgressView().tint(.white) }
                        else { Image(systemName: "play.circle.fill").font(.system(size: 17, weight: .semibold)) }
                        Text("Clock In").font(TTypo.xsBold(13)).tLabel(tracking: 0.6)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Capsule().fill(T.brandGradient()))
                    .opacity(inFlight ? 0.6 : 1)
                }
                .buttonStyle(.plain)
                .disabled(inFlight)
            }

            if viaOtherSource {
                Text("Clocked in via \(source ?? "another device")")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }
        }
    }

    // Shared capsule label for the two clocked-in buttons.
    private func pill(icon: String, text: String, fill: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold))
            Text(text).font(TTypo.xsBold(13)).tLabel(tracking: 0.6)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Capsule().fill(fill))
    }
}

// MARK: - Live pay-shift status (clocked in / lunch / break + elapsed)

// Always visible when the pay clock is enabled (task 4): shows Clocked in / On
// lunch with a live elapsed timer, or a resting "Clocked out" state.
private struct PayStatusCard: View {
    let active: Bool
    let onLunch: Bool
    let liveHours: Double
    let source: String?

    private var status: (label: String, kind: TagKind) {
        if !active { return ("Clocked out", .neutral) }
        if onLunch { return ("On lunch", .indigo) }
        return ("Clocked in", .green)
    }
    private var elapsedLabel: String {
        let secs = max(0, Int(liveHours * 3600))
        return String(format: "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    var body: some View {
        HStack(spacing: 12) {
            IconChip(icon: .hours, color: Color(hex: active ? T.accentGradientStart : T.muted))
            VStack(alignment: .leading, spacing: 4) {
                Text("This shift")
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                HStack(spacing: 8) {
                    TagPill(label: status.label, kind: status.kind, dot: active)
                    if active {
                        Text(elapsedLabel)
                            .font(TTypo.monoBold(13))
                            .foregroundStyle(Color(hex: T.ink))
                            .tnum()
                    } else {
                        Text("Not on the clock")
                            .font(TTypo.xs(12))
                            .foregroundStyle(Color(hex: T.muted))
                    }
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

// MARK: - Clock-in PIN overlay (task 2)

// A focused numeric PIN pad shown before clocking in when the person has a PIN
// set. `onSubmit` returns whether the PIN was accepted; a rejection clears the
// entry and shows "Incorrect PIN" so the worker can retry.
private struct ClockInPinOverlay: View {
    let personName: String?
    let onCancel: () -> Void
    let onSubmit: (String) async -> Bool

    @State private var pin = ""
    @State private var error: String?
    @State private var submitting = false
    private let maxDigits = 8

    private var keypadRows: [[String]] {
        [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["⌫", "0", "✓"]]
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { if !submitting { onCancel() } }

            VStack(spacing: 16) {
                VStack(spacing: 4) {
                    Text("Clock In")
                        .font(.custom(TFontName.bold.rawValue, size: 20))
                        .foregroundStyle(Color(hex: T.ink))
                    Text(personName.map { "Enter \($0)'s PIN" } ?? "Enter your PIN")
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: T.muted))
                }

                // PIN dots — at least four, growing with longer PINs.
                HStack(spacing: 12) {
                    ForEach(0..<max(pin.count, 4), id: \.self) { i in
                        Circle()
                            .fill(i < pin.count ? Color(hex: T.accentGradientStart) : Color(hex: T.progressTrack))
                            .frame(width: 12, height: 12)
                    }
                }
                .frame(height: 14)
                .animation(.easeOut(duration: 0.1), value: pin)

                if let error {
                    Text(error)
                        .font(TTypo.xs(12))
                        .foregroundStyle(Color(hex: T.red))
                }

                VStack(spacing: 10) {
                    ForEach(keypadRows, id: \.self) { row in
                        HStack(spacing: 10) {
                            ForEach(row, id: \.self) { key in keyButton(key) }
                        }
                    }
                }

                Button(action: { if !submitting { onCancel() } }) {
                    Text("Cancel")
                        .font(TTypo.smBold(14))
                        .foregroundStyle(Color(hex: T.muted))
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
            .padding(24)
            .frostedCard(radius: T.cornerHero)
            .frame(maxWidth: 320)
            .padding(.horizontal, 32)
            .opacity(submitting ? 0.7 : 1)
        }
    }

    private func keyButton(_ key: String) -> some View {
        let isSubmit = key == "✓"
        return Button(action: { tap(key) }) {
            Group {
                if isSubmit && submitting {
                    ProgressView().tint(.white)
                } else {
                    Text(key)
                        .font(.custom(TFontName.bold.rawValue, size: 24))
                        .foregroundStyle(isSubmit ? Color.white : Color(hex: T.ink))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isSubmit ? AnyShapeStyle(T.brandGradient())
                                   : AnyShapeStyle(Color(hex: T.progressTrack).opacity(0.4)))
            )
        }
        .buttonStyle(.plain)
        .disabled(submitting || (isSubmit && pin.isEmpty))
    }

    private func tap(_ key: String) {
        guard !submitting else { return }
        error = nil
        switch key {
        case "⌫": if !pin.isEmpty { pin.removeLast() }
        case "✓": submit()
        default:  if pin.count < maxDigits { pin.append(key) }
        }
    }

    private func submit() {
        guard !pin.isEmpty, !submitting else { return }
        submitting = true
        Task {
            let ok = await onSubmit(pin)
            submitting = false
            if !ok {
                error = "Incorrect PIN"
                pin = ""
            }
        }
    }
}
