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
    /// PIN pad for clocking OUT — separate from `showPinPrompt` so the two pads
    /// can't ever be confused about which action they're confirming.
    @State private var showClockOutPin = false
    /// Fallback for people with no PIN set: a plain are-you-sure before the
    /// full-width Clock Out button ends their shift.
    @State private var showClockOutConfirm = false
    /// The big LUNCH / BREAK confirmation currently on screen, if any.
    @State private var banner: ClockActionBannerKind?
    /// In-flight guard for the Break pill. Break goes through `startBreak`/
    /// `endBreak` (presence-only), NOT the pay clock, so it has its own flag
    /// rather than riding on `appState.isPayClocking`.
    @State private var breakBusy = false
    /// Bumped on every data rehydrate so this view re-renders when `peoplKe`
    /// changes live (e.g. an admin flips this person's mobile clock-in
    /// permission) — see .onReceive below.
    @State private var liveRefresh = 0
    /// `@State`, NOT `let`. As a stored `let`, this publisher was a brand-new
    /// object every time the view struct was rebuilt by its parent, so SwiftUI
    /// compared TimeClockView as "changed" and re-evaluated this entire body on
    /// EVERY nav-bar tap — even taps going to a different tab. @State storage is
    /// excluded from that comparison and is created once.
    @State private var ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        // Read the live-synced slices DIRECTLY in body so a permission/clock
        // change re-renders immediately. SwiftUI doesn't reliably track
        // @Observable reads that happen only inside computed properties
        // (showPayClock reads appState.canClockInOut), so the pay-clock CTA
        // wasn't appearing until an app reopen when the permission was enabled.
        let _ = liveRefresh
        let _ = appState.people.count
        return ZStack {
            // Page content, grouped so the PIN pads and the lunch/break shout
            // can blur it while staying sharp themselves. These are in-hierarchy
            // overlays, so unlike the end-job photo cover they blur their own
            // page directly instead of going through appNav.modalBlur.
            Group {
                PageBackground()

                VStack(spacing: 0) {
                    // No header here — the shell owns the one persistent GlassHeader
                    // (§2). The spacer reserves its height so the scroll view's FRAME
                    // starts below the header, which is what actually stops content
                    // riding up over the wordmark and the header controls. Insetting
                    // the scroll CONTENT instead (`.safeAreaPadding(.top)`) left the
                    // frame spanning to the top of the screen, so rows scrolled under
                    // the glass — fine while `topFadeMask` still faded them out, and
                    // plainly wrong once it became a no-op. Every other tab reserves
                    // the header this way; Analytics is the reference.
                    Color.clear.frame(height: GlassHeader.height)

                    ScrollViewReader { _ in
                      ScrollView {
                        VStack(spacing: 0) {

                            PageTitle(title: "Time Clock")
                                .padding(.top, pageTitleTopInset)
                                .padding(.bottom, 10)

                            // ── Pay-clock hours: two rings side by side ──
                            // Left: the whole pay period. Right: today only. Both are
                            // time clocked in for pay, minus lunch. Each is its own
                            // card so the two numbers read as peers.
                            HStack(spacing: 12) {
                                RingStatCard(title: "Pay period",
                                             hours: payPeriodHours,
                                             target: periodTarget)
                                RingStatCard(title: "Today",
                                             hours: todayHours,
                                             target: dailyTarget)
                            }
                            .padding(.horizontal, 16)

                            WeekBarsCard(days: dailyBars)
                                .padding(.horizontal, 16)
                                .padding(.top, 14)

                            // ── Pay clock controls (admin opt-in via iosPayClockEnabled) ──
                            // Sits below the bar graph so the hero number reads first.
                            // Clocked out → one Clock In button. Clocked in → Lunch +
                            // Break side by side, with a full-width Clock Out beneath.
                            // Open break the Break toggle below can't reach —
                            // see OpenBreakCard. Shown only when that toggle is
                            // absent, so the two never double up.
                            if appState.isOnBreak && !(showPayClock && appState.payClockInActive) {
                                OpenBreakCard(startedAtISO: appState.myActiveBreak?.startedAt,
                                              inFlight: breakBusy) {
                                    guard !breakBusy else { return }
                                    breakBusy = true
                                    Task {
                                        let ok = await appState.endBreak()
                                        breakBusy = false
                                        if ok { showBanner(.breakEnded) }
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.top, 14)
                            }

                            if showPayClock {
                                PayClockControls(active: appState.payClockInActive,
                                                 onLunch: appState.payOnLunch,
                                                 onBreak: appState.isOnBreak,
                                                 elapsed: payClockElapsed,
                                                 inFlight: appState.isPayClocking,
                                                 breakInFlight: breakBusy,
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
                                                     // Clock Out is full-width now, so it's the easiest
                                                     // thing on the page to hit by mistake — gate it
                                                     // behind the PIN pad, or at minimum a confirm.
                                                     if appState.currentPerson?.hasPin == true {
                                                         showClockOutPin = true
                                                     } else {
                                                         showClockOutConfirm = true
                                                     }
                                                 },
                                                 onLunchToggle: {
                                                     guard !appState.isPayClocking else { return }
                                                     let starting = !appState.payOnLunch
                                                     Task {
                                                         if await appState.payLunchToggle() {
                                                             showBanner(starting ? .lunchStarted : .lunchEnded)
                                                         }
                                                     }
                                                 },
                                                 onBreakToggle: {
                                                     guard !breakBusy else { return }
                                                     let starting = !appState.isOnBreak
                                                     breakBusy = true
                                                     Task {
                                                         let ok = starting ? await appState.startBreak()
                                                                           : await appState.endBreak()
                                                         breakBusy = false
                                                         if ok { showBanner(starting ? .breakStarted : .breakEnded) }
                                                     }
                                                 })
                                    .padding(.horizontal, 16)
                                    .padding(.top, 14)
                            }
                        }
                        .padding(.bottom, 24)
                      }
                      .scrollIndicators(.visible)
                      .topFadeMask()
                      .refreshable { await reload() }
                    }
                }
                .onReceive(ticker) { if appNav.selected == .hours { now = $0 } }   // only tick while visible
                // Force a re-render when live sync rehydrates data (e.g. an admin just
                // enabled this person's mobile clock-in permission) so the pay-clock
                // CTA appears without needing an app reopen.
                .onReceive(NotificationCenter.default.publisher(for: .traqsDataRehydrated)) { _ in
                    liveRefresh &+= 1
                }
                // On-demand datasets (heavy): the live person/jobs come from loadAll
                // elsewhere; here we only pull this person's clock + job-session logs.
                .task {
                    await appState.refreshTimeclock(personId: appState.currentPersonId)
                }
            }
            .modalPageBlur(showPinPrompt || showClockOutPin || banner != nil)

            // PIN entry for clock-in (task 2) — an overlay rather than a second
            // .sheet, since the view already presents the Settings sheet.
            if showPinPrompt {
                ClockPinOverlay(
                    title: "Clock In",
                    personName: appState.currentPerson?.name,
                    onClose: { withTransaction(.noAnimation) { showPinPrompt = false } },
                    // showsOverlay: false — the pad shows the spinner and the
                    // checkmark itself; the full-screen card would land on top.
                    onSubmit: { pin in await appState.payClockIn(pin: pin, showsOverlay: false) }
                )
                // Entry is the pad's OWN spring (see ClockPinOverlay.appear) —
                // an insertion transition here would cross-fade on top of it and
                // fight the scale. Removal still fades.
                .transition(.identity)   // the pad animates itself — see ModalPop
                .zIndex(10)
            }

            // Same pad, guarding clock-OUT. Server-verified: a wrong PIN comes
            // back 401 and the pad stays open for a retry.
            if showClockOutPin {
                ClockPinOverlay(
                    title: "Clock Out",
                    personName: appState.currentPerson?.name,
                    onClose: { withTransaction(.noAnimation) { showClockOutPin = false } },
                    onSubmit: { pin in await appState.payClockOut(pin: pin, showsOverlay: false) }
                )
                // Entry is the pad's OWN spring (see ClockPinOverlay.appear) —
                // an insertion transition here would cross-fade on top of it and
                // fight the scale. Removal still fades.
                .transition(.identity)   // the pad animates itself — see ModalPop
                .zIndex(10)
            }

            // The big LUNCH / BREAK shout. Sits above the PIN pads so a banner
            // triggered mid-flow is never buried.
            if let banner {
                ClockActionBanner(kind: banner) {
                    withTransaction(.noAnimation) { self.banner = nil }
                }
                .id(banner)
                .transition(.identity)
                .zIndex(20)
            }
        }
        // Confirm fallback for people with no PIN set — still guards the
        // full-width Clock Out button against a stray tap.
        .alert("Clock out?", isPresented: $showClockOutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Clock Out", role: .destructive) {
                Task { await appState.payClockOut() }
            }
        } message: {
            Text("This ends your shift for the day.")
        }
        // Hide the bottom nav pill while either PIN pad is up; it slides back in
        // (MainTabView animates hideTabBar) when the pad is dismissed.
        //
        // The lunch/break shout is different: the bar STAYS, and blurs along
        // with the page behind it instead of sliding away. The shout is centered
        // and the bar sits at the bottom edge, so they never overlap.
        .onChange(of: showPinPrompt)   { _, _ in syncTabBar() }
        .onChange(of: showClockOutPin) { _, _ in syncTabBar() }
        .onChange(of: banner)          { _, _ in syncTabBar() }
        .onDisappear {
            appNav.hideTabBar = false
            appNav.blurChrome = false
        }
    }

    private func syncTabBar() {
        appNav.hideTabBar = showPinPrompt || showClockOutPin
        // The SAME condition as `.modalPageBlur` above, deliberately — the glass
        // header has to blur with the page it sits over, and the PIN pads used to
        // be missing from this line, which left the TRAQS wordmark and the Time
        // Off button sharp over a blurred page. (The nav pill slides away for the
        // pads rather than blurring, which is `hideTabBar`'s job above.)
        appNav.blurChrome = showPinPrompt || showClockOutPin || banner != nil
    }

    /// Show the big confirmation. Replaces whatever is on screen so a fast
    /// Lunch→Break tap reads the second action, not a stale first one.
    private func showBanner(_ kind: ClockActionBannerKind) {
        withTransaction(.noAnimation) { banner = kind }
    }

    private func reload() async {
        await appState.loadAll()
        await appState.refreshTimeclock(personId: appState.currentPersonId)
    }

    // MARK: - Pay-clock compute (the hero)

    private var myId: String? { appState.currentPersonId }
    private var activePayClock: ActiveClockIn? { appState.currentPerson?.activeClockIn }
    /// Pay clock UI shows only when the org enabled it, the person is hourly
    /// (salaried employees don't punch a clock), AND the worker has clock in/out
    /// permission (set per-person in the desktop "Worker Permissions" panel).
    private var showPayClock: Bool {
        appState.orgSettings.iosPayClockEnabled
            && !(appState.currentPerson?.isSalary ?? false)
            && appState.canClockInOut
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

    /// Pay-period total: completed spans (already net of lunch, computed
    /// server-side) + the live current shift.
    private var payPeriodHours: Double {
        payEntriesInPeriod.reduce(0.0) { $0 + ($1.hours ?? 0) } + liveShiftHours
    }

    /// Live hours for the current pay shift. Delegates to AppState so there is
    /// ONE pay-hours implementation on iOS — this view used to carry its own
    /// copy that still deducted breaks, which put every ring here 0.5h/day below
    /// the Home card, the Stats page, and the server's finalised punch.
    private var liveShiftHours: Double {
        appState.liveShiftHours(now: now)
    }

    /// Today's pay-clock hours. Delegates to AppState so this ring shows the
    /// exact same number as the Home page's "Today's hours" card — they were
    /// two implementations that disagreed whenever a shift crossed midnight
    /// (AppState credits the live shift to the day it STARTED; the copy that
    /// used to live here credited it to today regardless).
    private var todayHours: Double {
        appState.hoursToday(now: now)
    }

    /// Daily target = PAID hours in a standard day: the scheduled shift block
    /// minus the unpaid lunch, breaks left in (they're paid). Not `hpd` — that's
    /// a scheduling capacity number that ignores lunch, so a 07:00–16:00 shop
    /// with a 1h lunch reads 9 there but should target 8 here.
    private var dailyTarget: Double {
        let h = appState.orgSettings.paidHoursPerDay
        return h > 0 ? h : 8
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
        // Bucket hours by start-of-day in ONE pass (was: re-filter all entries
        // 8× and re-parse each date 8× inside the loop).
        let entries = myCompletedEntries
        var byDay: [Date: Double] = [:]
        for e in entries {
            guard let ed = isoDay(e.clockIn) else { continue }
            byDay[cal.startOfDay(for: ed), default: 0] += (e.hours ?? 0)
        }
        var out: [DailyBar] = []
        for i in stride(from: 7, through: 0, by: -1) {
            let d = cal.date(byAdding: .day, value: -i, to: today) ?? today
            let dow = ["S","M","T","W","T","F","S"][cal.component(.weekday, from: d) - 1]
            var h = byDay[cal.startOfDay(for: d)] ?? 0
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

    // Cached formatters — allocating an ISO8601DateFormatter per call was a
    // hot-path cost (parseISO runs per entry during body evaluation).
    private static let isoDateOnly: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; return f
    }()
    private static let isoFull = ISO8601DateFormatter()
    private func parseISO(_ s: String) -> Date? {
        Self.isoDateOnly.date(from: s) ?? Self.isoFull.date(from: s)
    }

    private var periodLabel: String {
        let w = periodWindow
        let f = DateFormatter(); f.dateFormat = "MMM d"
        return "Pay period · \(f.string(from: w.start)) – \(f.string(from: w.end))"
    }
}

// MARK: - Hours ring card (one per timeframe)

// A titled gradient progress ring. Used twice, side by side: "Pay period" and
// "Today". Deliberately just the label and the number — the on-track / hours-
// left readout that used to sit beside the period ring was dropped so the two
// cards stay symmetrical and the numbers carry the page.
private struct RingStatCard: View {
    let title: String
    let hours: Double
    let target: Double

    private var pct: Double { target > 0 ? min(100, hours / target * 100) : 0 }

    var body: some View {
        VStack(spacing: 12) {
            Text(title)
                .font(TTypo.xsBold(11))
                .tLabel(tracking: 1.4)
                .foregroundStyle(Color(hex: T.muted))
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            ZStack {
                GradientRing(pct: pct, lineWidth: 11)
                    .frame(width: 106, height: 106)
                VStack(spacing: 0) {
                    Text(String(format: "%.1f", hours))
                        .font(.custom(TFontName.bold.rawValue, size: 28))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                    Text(String(format: "/ %.0f h", target))
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                        .tnum()
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .padding(.horizontal, T.insetHero)
        .frostedCard()
    }
}

// MARK: - Open break escape hatch

// A break never auto-expires and `endBreak()` is the only thing that clears it,
// but the Break toggle lives inside PayClockControls — so it disappears the
// moment the worker clocks out, and never renders at all when the org has the
// pay clock disabled (or the person is salaried / lacks clock permission). In
// any of those cases an open break was unreachable from the phone and the
// worker read "On Break" indefinitely on every status board. This card renders
// exactly when that toggle can't.
private struct OpenBreakCard: View {
    let startedAtISO: String?
    let inFlight: Bool
    let onEnd: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "cup.and.saucer.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color(hex: T.amber))

            VStack(alignment: .leading, spacing: 2) {
                // Counts up past the configured duration on purpose — an
                // overrun should be obvious rather than silently capped.
                TimelineView(.periodic(from: .now, by: 60)) { ctx in
                    Text(headline(now: ctx.date))
                        .font(TTypo.xsBold(13))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                }
                Text("End your break to clear this status.")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
            }

            Spacer(minLength: 8)

            Button(action: onEnd) {
                HStack(spacing: 6) {
                    if inFlight { ProgressView().controlSize(.small).tint(T.onColor(T.amber)) }
                    Text("End Break").font(TTypo.xsBold(12)).tLabel(tracking: 0.4)
                }
                .foregroundStyle(T.onColor(T.amber))
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Capsule().fill(Color(hex: T.amber)))
            }
            .buttonStyle(.plain)
            .disabled(inFlight)
            .opacity(inFlight ? 0.6 : 1)
        }
        .frame(maxWidth: .infinity)
        .padding(14)
        .frostedCard(radius: T.cornerMd)
    }

    private func headline(now: Date) -> String {
        guard let iso = startedAtISO, let started = Date.fromFlexibleISO8601(iso) else { return "On break" }
        let secs = max(0, Int(now.timeIntervalSince(started)))
        let h = secs / 3600, m = (secs % 3600) / 60
        return h > 0 ? "On break · \(h)h \(m)m" : "On break · \(m)m"
    }
}

// MARK: - Pay clock controls (Hours; admin opt-in via iosPayClockEnabled)

// Clocked out → a single Clock In button on the signature brand gradient.
// Clocked in → Lunch + Break side by side, with a full-width Clock Out
// underneath. Lunch pauses paid time; Break is presence-only (the pay clock
// keeps running), which is why they're separate controls rather than one
// "pause" toggle. Clock Out is the widest target on the page, so it's PIN-gated
// by the caller. While a request is in flight the affected buttons dim.
private struct PayClockControls: View {
    /// Observed so the pill labels below re-colour when the frosted-glass
    /// toggle flips — `glassCTALabel` reads a global SwiftUI can't track.
    @Environment(ThemeSettings.self) private var theme
    let active: Bool
    let onLunch: Bool
    let onBreak: Bool
    let elapsed: String
    let inFlight: Bool
    var breakInFlight: Bool = false
    var clockOutBlocked: Bool = false   // on a job → can't clock out yet
    let onClockIn: () -> Void
    let onClockOut: () -> Void
    let onLunchToggle: () -> Void
    let onBreakToggle: () -> Void

    var body: some View {
        _ = theme.frostedGlass; _ = theme.accent
        return VStack(spacing: 8) {
            if active {
                HStack(spacing: 10) {
                    Button(action: onLunchToggle) {
                        pill(icon: onLunch ? "play.circle.fill" : "fork.knife",
                             text: onLunch ? "End Lunch" : "Lunch",
                             tint: nil)
                    }
                    .buttonStyle(.plain)
                    .disabled(inFlight)
                    .opacity(inFlight ? 0.6 : 1)

                    Button(action: onBreakToggle) {
                        pill(icon: onBreak ? "play.circle.fill" : "cup.and.saucer.fill",
                             text: onBreak ? "End Break" : "Break",
                             tint: nil,
                             busy: breakInFlight)
                    }
                    .buttonStyle(.plain)
                    .disabled(breakInFlight)
                    .opacity(breakInFlight ? 0.6 : 1)
                }

                Button(action: onClockOut) {
                    pill(icon: "stop.circle.fill", text: "Clock Out", tint: Color(hex: T.accent))
                }
                .buttonStyle(.plain)
                .disabled(inFlight || clockOutBlocked)
                .opacity(inFlight ? 0.6 : (clockOutBlocked ? 0.5 : 1))

                if clockOutBlocked {
                    Text("Stop your job before clocking out")
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                }
            } else {
                // Tinted Liquid Glass, matching the Start buttons on the job
                // cards — the two things a worker presses to begin work now
                // read as the same object.
                //
                // Through GradientCTA rather than hand-rolled with `.glassCTA()`
                // so the label colour follows the paint: glass is tinted with
                // the FLAT accent and wants `T.onAccent`, the solid fallback is
                // a gradient and wants `T.onGradient`. Judging a mid-brightness
                // accent against the wrong one of those lands on the wrong side
                // of the black/white flip.
                GradientCTA(glass: true,
                            disabled: inFlight,
                            dimmed: inFlight,
                            verticalPadding: 14,
                            action: onClockIn) {
                    HStack(spacing: 9) {
                        if inFlight { ProgressView().progressViewStyle(.circular) }
                        else { Image(systemName: "play.circle.fill").font(.system(size: 17, weight: .semibold)) }
                        Text("Clock In").font(TTypo.xsBold(13)).tLabel(tracking: 0.6)
                    }
                }
            }

        }
    }

    /// Lunch, Break and Clock Out as one capsule, differing only in their glass.
    ///
    /// `tint: nil` is PLAIN glass and ink — Lunch and Break take it. They are
    /// mid-shift adjustments, not decisions, and colouring them (accent, or the
    /// old indigo/amber/green state pairs) put three competing verdicts on a row
    /// where nothing needs deciding. It routes through `glassControl` rather
    /// than `glassCTA` because `glassCTA(tint: nil)` means "use the accent", not
    /// "use no tint".
    ///
    /// Clock Out passes the ACCENT. It was red, which read as a warning about an
    /// action every shift ends with; the PIN gate on the caller is what actually
    /// guards it.
    private func pill(icon: String, text: String, tint: Color?,
                      busy: Bool = false) -> some View {
        let label = tint.map(glassCTALabel) ?? Color(hex: T.ink)
        return HStack(spacing: 8) {
            if busy {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(label)
                    .scaleEffect(0.7)
            } else {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold))
            }
            Text(text).font(TTypo.xsBold(13)).tLabel(tracking: 0.6)
        }
        .foregroundStyle(label)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .glassControl(in: Capsule(), tint: tint)
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
                        // Exact hours logged that day, to the 100th.
                        Text(String(format: "%.2f", d.hours))
                            .font(TTypo.mono(9))
                            .foregroundStyle(d.isToday ? Color(hex: T.ink) : Color(hex: T.muted))
                            .tnum()
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
        .padding(T.insetHero)
        .frostedCard()
    }
}

// MARK: - Clock PIN overlay (task 2)

private struct ClockPinOverlay: View {
    @Environment(ThemeSettings.self) private var theme
    let title: String
    let personName: String?
    /// Closes the pad. Called for cancel AND for a successful PIN — the pad
    /// runs its own exit animation first, so the page must NOT dismiss it
    /// itself from `onSubmit`.
    let onClose: () -> Void
    let onSubmit: (String) async -> Bool

    @State private var pin = ""
    @State private var error: String?
    /// Where the pad is in its own flow.
    ///
    /// The pad used to stay up, dimmed to 0.7, while `payClockIn` raised the
    /// full-screen loading card over it — two overlays for one action. It runs
    /// the whole thing itself now: the keypad gives way to the spinner in the
    /// same panel, the spinner becomes a checkmark, and only then does the pad
    /// leave. A wrong PIN springs it back to `.entry`, which is why it can't
    /// simply close on submit.
    @State private var phase: PadPhase = .entry
    private var submitting: Bool { phase != .entry }
    /// Bumped on every key press so `.sensoryFeedback` fires a tap haptic each time.
    @State private var tapTick = 0
    /// Drives the shared modal entrance/exit — see ModalPop. The pad owns both;
    /// the page presenting it must not animate.
    @State private var appear = false
    private let maxDigits = 8
    private let keySize: CGFloat = 78
    private let keySpacing: CGFloat = 18
    /// This pad is where the app's radius was set: it went to 46 first, the rest
    /// of the scale followed, and `glassPanel`'s default is now this same value.
    /// Kept as a named constant because the close-X inset below depends on it.
    private let padRadius: CGFloat = 46
    /// A hair below the app-wide popup tint (`modalSurfaceTint`) — the one dial
    /// for how much of the page shows through the pad. It can run thinner than
    /// the other popups because it's mostly big round keys with air between
    /// them: there's very little fine text here for a busy backdrop to disturb.
    private let padSurfaceTint: Double = 0.12
    /// Side of the square the pad becomes once the PIN is submitted — see
    /// `progressContent`.
    private let padSquareSide: CGFloat = 168

    private let digitRows: [[String]] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]]

    var body: some View {
        // Touch the theme so a live Customize accent change re-renders the
        // surface tint below (the T.* tokens aren't observable on their own).
        // frostedGlass too — the confirm key's label colour follows its paint.
        _ = theme.accent; _ = theme.frostedGlass
        return ZStack {
            // Dimmed and blurred, the same backdrop as the break/lunch banner
            // and the end-job photo prompt. Its tint is lighter than the flat
            // 0.32 this used to be: the card is real glass and a heavy scrim is
            // what it blurs, so the blur now does the separating and extra tint
            // would only turn the frost muddy.
            ModalScrim { if !submitting { close() } }

            VStack(spacing: 18) {
                if phase == .entry { entryContent } else { progressContent }
            }

            .padding(30)
            // The same material the break/lunch banner and the end-job photo
            // prompt use, and it FOLLOWS THE FROSTED-GLASS TOGGLE the same way.
            // It is NOT .frostedCard(), which despite the name is an opaque
            // surface fill with no blur, and left the PIN pad reading as a flat
            // panel next to those popups even with the glass on.
            //
            // The shared modal recipe (see GlassPanel), rebuilt here for
            // one reason: this pad sits a touch more transparent than the rest.
            // It's mostly big round keys with air between them, so it can let
            // more of the blurred page through before the content starts to
            // swim — `glassSurfaceTint` stays where it is for every other
            // surface in the app.
            .background {
                let shape = RoundedRectangle(cornerRadius: padRadius, style: .continuous)
                ZStack {
                    if T.glassEnabled {
                        shape.fill(.ultraThinMaterial)
                        shape.fill(Color(hex: T.surface).opacity(padSurfaceTint))
                    } else {
                        shape.fill(Color(hex: T.surface))
                    }
                }
            }
            // The app-wide glass edge (see `specularRim` in Primitives). This
            // pad is where the recipe came from; it now takes the shared one so
            // there is a single place to tune it.
            //
            // The edge ONLY. There was also a radial sheen washing in from the
            // top-left corner — that read as white paint across the face of the
            // glass rather than as light, and is gone for good.
            // Collapses to the flat hairline with the Customize toggle, in step
            // with the fill above — the pad follows the switch like every other
            // popup (see `GlassPanel`).
            .glassRim(RoundedRectangle(cornerRadius: padRadius, style: .continuous))
            // Modals float, so they carry their own lift — same as GlassPanel.
            .shadow(color: .black.opacity(0.22), radius: 24, x: 0, y: 10)
            // Accent bloom — a halo in the org's colour on top of the neutral
            // drop shadow above, so the pad glows onto the blurred page. This is
            // the only thing here still doing "glow"; it tints from the edge
            // outward rather than laying light over the glass.
            .shadow(color: Color(hex: T.accentGradientStart).opacity(0.34), radius: 36)
            // Cancel/close = a Liquid Glass X anchored INSIDE the card's top-left
            // (attached before the outer frame/padding so it sits on the card,
            // not floating out in the dimmed backdrop).
            .overlay(alignment: .topLeading) {
                // Gone once the request is out — there is nothing to cancel from
                // here any more, and a live X beside a spinner invites a tap
                // that would only orphan the action.
                if phase == .entry {
                    Button { close() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color(hex: T.ink))
                            .frame(width: 40, height: 40)
                            .glassEffect(.regular.interactive(), in: Circle())
                    }
                    .buttonStyle(.plain)
                    // Nudged in from 14: the corner radius above is big enough now
                    // that a 40pt circle at 14 would ride the curve.
                    .padding(18)
                }
            }
            .frame(maxWidth: 360)
            .padding(.horizontal, 20)
            // Physical tap feedback on every key.
            .sensoryFeedback(.impact(weight: .light), trigger: tapTick)
                .modalPop(appear)
        }
        // Take the WHOLE screen, safe area included. Without this the pad
        // centred itself in whatever box it was dropped into and the parent's
        // implicit animation slid it down from the top into the real centre;
        // now it's already at the true centre on the first frame and only the
        // spring below moves it. Same fix the break/lunch banner has.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .onAppear { withAnimation(modalPopAnimation) { appear = true } }
    }

    /// Title, dots, error and keypad — the pad at rest.
    @ViewBuilder
    private var entryContent: some View {
        VStack(spacing: 4) {
            Text(title)
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
                    .fill(i < pin.count ? Color(hex: T.accentGradientStart) : T.controlFillStrong)
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

        // Circular, tap-friendly keypad. Action row: Delete (⌫) · 0 · Confirm (✓).
        VStack(spacing: keySpacing) {
            ForEach(digitRows, id: \.self) { row in
                HStack(spacing: keySpacing) {
                    ForEach(row, id: \.self) { digitKey($0) }
                }
            }
            HStack(spacing: keySpacing) {
                // Backspace, not an X — this rubs out the last digit, and
                // an X next to the card's cancel X read as a second way
                // to close the pad rather than an edit key.
                actionKey(icon: "delete.backward", filled: false) {
                    if !pin.isEmpty { pin.removeLast(); error = nil }
                }
                digitKey("0")
                actionKey(icon: "checkmark", filled: true) { submit() }
            }
        }
    }

    /// Working and landed. The panel keeps its glass and shrinks around this,
    /// so the pad becomes the confirmation rather than handing off to one.
    ///
    /// A SQUARE. At rest the pad is a tall keypad-shaped rectangle; once the
    /// action is committed there is one mark and one word in it, and holding the
    /// keypad's proportions left them stranded in a wide empty panel. The outer
    /// padding is uniform, so a square here makes the whole panel square.
    private var progressContent: some View {
        VStack(spacing: 16) {
            ClockProgressMark(done: phase == .done)
            Text(phase == .done ? doneTitle : title)
                .font(.custom(TFontName.bold.rawValue, size: 17))
                .foregroundStyle(Color(hex: T.ink))
                .contentTransition(.opacity)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(width: padSquareSide, height: padSquareSide)
    }

    /// "Clock In" → "Clocked In". The pad is told a verb; this is its past tense.
    private var doneTitle: String {
        title.hasSuffix("In") ? "Clocked In" : "Clocked Out"
    }

    /// Animates out first, THEN lets the page remove us — the shared modal exit.
    private func close() {
        modalPopDismiss({ appear = $0 }) { onClose() }
    }

    // A round digit key.
    private func digitKey(_ d: String) -> some View {
        Button {
            tapTick += 1
            guard !submitting, pin.count < maxDigits else { return }
            error = nil
            pin.append(d)
        } label: {
            Text(d)
                .font(.custom(TFontName.bold.rawValue, size: 27))
                .foregroundStyle(Color(hex: T.ink))
                .frame(width: keySize, height: keySize)
                // Neutral Liquid Glass, the same material as every other round
                // control in the app. NOT the hand-rolled `specularRim` these
                // carried before they were flattened — twelve hand-rimmed discs
                // packed three-across read as texture rather than as buttons.
                // System glass gives each key its own edge and press response
                // without that.
                .glassKeyBackground(filled: false)
        }
        .buttonStyle(.plain)
        .disabled(submitting)
    }

    // A round action key: delete (⌫, neutral glass) or confirm (✓, tinted glass).
    private func actionKey(icon: String, filled: Bool, action: @escaping () -> Void) -> some View {
        let isConfirm = icon == "checkmark"
        return Button {
            tapTick += 1
            guard !submitting else { return }
            action()
        } label: {
            // The confirm key is the same tinted Liquid Glass as Clock In and
            // the Start buttons — tinted with the FLAT accent, so its label is
            // judged against that.
            let onFill = glassCTALabel()
            Group {
                if isConfirm && submitting {
                    ProgressView().tint(onFill)
                } else {
                    Image(systemName: icon)
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(filled ? onFill : Color(hex: T.ink))
                }
            }
            .frame(width: keySize, height: keySize)
            // Confirm takes the tinted CTA glass; delete takes the neutral
            // glass, matching the digits above it — see `glassKeyBackground`.
            .glassKeyBackground(filled: filled)
        }
        .buttonStyle(.plain)
        .disabled(submitting || (isConfirm && pin.isEmpty))
    }

    private func submit() {
        guard !pin.isEmpty, !submitting else { return }
        withAnimation(padPhaseAnimation) { phase = .working }
        Task {
            let ok = await onSubmit(pin)
            if ok {
                withAnimation(padPhaseAnimation) { phase = .done }
                // Long enough for the tick to draw and be read, then the pad
                // leaves on its usual exit.
                try? await Task.sleep(nanoseconds: 850_000_000)
                close()
            } else {
                pin = ""
                withAnimation(padPhaseAnimation) { phase = .entry }
                error = "Incorrect PIN"
            }
        }
    }
}

/// Where the PIN pad is in its own flow — see `ClockPinOverlay.phase`.
private enum PadPhase { case entry, working, done }

/// The curve the pad resizes on as the keypad gives way to the progress mark.
/// A spring, so the panel settles into its new height rather than stepping.
private let padPhaseAnimation: Animation = .spring(response: 0.36, dampingFraction: 0.82)
