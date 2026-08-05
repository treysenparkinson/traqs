import SwiftUI

// One shared ISO8601 formatter for the Past Jobs log (mirrors the Hours tab).
private let isoFormatter: ISO8601DateFormatter = ISO8601DateFormatter()

// MARK: - Stats V2 (org metrics) · TRAQS
// Admin/dispatcher dashboard. NEW metric set — values are PLACEHOLDERS ("—")
// until each is wired, one at a time:
//   1. Utilization    — % (small box)
//   2. Task Switching — jobs touched today (small box)
//   3. Over-hours     — count (small box) that expands a list of jobs whose
//                       logged ACTUAL hours ran past the admin-set EST hours
//   4. Reworks        — count (small box)
//   5. Idle Time      — pay time clocked in but not logged onto a job (small box)
//   6. Efficiency     — % (hero) + per-day bars for the current week: pay hours
//                       vs job hours, with the daily difference above each day
// Non-admins see a friendly empty state.

struct MoreView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav
    /// Any day within the week being shown; defaults to the current week. The
    /// calendar button in the header repoints this to jump to another week.
    @State private var weekAnchor: Date = Date()
    @State private var overHoursExpanded = false
    /// Drives the STOP affordance on the live "Past Jobs" running-clock card.
    @State private var isStopping = false
    /// Admin-only: pick a worker to view THEIR personal stats. nil = the org
    /// dashboard (admins) / your own stats (everyone else).
    @State private var selectedWorkerId: String? = nil

    var body: some View {
        ZStack {
            PageBackground()

            VStack(spacing: 0) {
                // Sticky header. Calendar jumps weeks; the person button (admins)
                // picks a worker to view their personal stats.
                TRAQSNavHeader {
                    if appState.isAdmin { workerMenu }
                    weekMenu
                }
                .overlay(alignment: .center) {
                    if let name = selectedWorkerName {
                        Text("\(name)'s Analytics")
                            .font(TTypo.smBold(15))
                            .foregroundStyle(Color(hex: T.ink))
                            .lineLimit(1)
                            .padding(.horizontal, 60)   // keep clear of the edge buttons
                            .allowsHitTesting(false)
                    }
                }

                ScrollView {
                    VStack(spacing: 0) {
                        if appState.isAdmin && selectedWorkerId == nil {
                            statsTitle
                                .padding(.top, pageTitleTopInset)
                                .padding(.bottom, 16)

                            // Ticks every 5s so the stat grid (Idle) + Efficiency
                            // graph grow live while anyone is clocked in.
                            //
                            // Utilization and Task Switching are computed HERE,
                            // outside the closure: they're weekly aggregates that
                            // don't depend on `now`, and each is a full walk of
                            // the job tree / job sessions. Inside the closure they
                            // re-ran every 5 seconds for no reason. Captured
                            // values refresh on real data changes instead.
                            let utilization = utilizationPercent
                            let switching = taskSwitchingCount
                            PausableTimeline(tab: .stats, interval: 5) { date in
                                // ONE walk of the week, shared by Idle and
                                // Efficiency — this used to run three times.
                                let days = efficiencyDays(for: nil, now: date)
                                VStack(spacing: 16) {
                                    statGrid(utilization: utilization,
                                             switching: switching,
                                             idle: idleHours(from: days))
                                        .padding(.horizontal, 16)
                                    EfficiencyCard(percent: "\(efficiencyPercent(from: days))%",
                                                   days: days,
                                                   info: "Job hours logged ÷ working hours for the week across everyone, where working hours = paid time minus paid breaks. Breaks are excluded so taking them can't cap anyone below 100%. The bars show each day's pay hours (left) vs job hours (right); the number above each day is job hours against working time.")
                                        .padding(.horizontal, 16)
                                }
                            }

                            // Over-hours tab pinned at the bottom; tapping it
                            // drops its list down beneath it at the page's end.
                            VStack(spacing: 12) {
                                OverHoursTab(value: "\(overHoursItems.count)", expanded: overHoursExpanded) {
                                    withAnimation(.easeInOut(duration: 0.22)) { overHoursExpanded.toggle() }
                                }
                                if overHoursExpanded {
                                    OverHoursList(jobs: overHoursItems)
                                        .transition(.opacity.combined(with: .move(edge: .top)))
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 16)
                            .padding(.bottom, 24)
                        } else if let pid = statsPersonId {
                            // Personal stats — your own (non-admin) or a worker an
                            // admin picked from the person button.
                            statsTitle
                                .padding(.top, pageTitleTopInset)
                                .padding(.bottom, 16)
                            personalStatGrid(for: pid)
                                .padding(.horizontal, 16)
                                .padding(.bottom, 8)

                            // This person's own efficiency for the selected week —
                            // ticks every 5s so it grows live while they're clocked in.
                            PausableTimeline(tab: .stats, interval: 5) { date in
                                let days = efficiencyDays(for: pid, now: date)   // once, not twice
                                EfficiencyCard(percent: "\(efficiencyPercent(from: days))%",
                                               days: days,
                                               info: "Job hours logged ÷ working hours for the week, where working hours = paid time minus paid breaks. Breaks are excluded so taking them can't cap you below 100%. The bars show each day's pay hours (left) vs job hours (right); the number above each day is job hours against working time.")
                                    .padding(.horizontal, 16)
                                    .padding(.top, 16)
                            }
                        }

                        // ── Past Jobs (this user's own job-clock history) ──
                        // Shown to everyone: their completed job sessions for
                        // the current pay period, plus a live card if a job
                        // clock is running. Scoped to the current person.
                        TSectionTitle(title: "Past Jobs")

                        if let active = activeJobClock, isViewingSelf {
                            // Own ticker so the per-second elapsed re-renders ONLY
                            // this card — not MoreView's whole (admin-heavy) body.
                            // Only when viewing yourself — STOP acts on the current
                            // user, so we don't show it for an admin-selected worker.
                            PausableTimeline(tab: .stats, interval: 1) { date in
                                RunningEntryCard(jobClock: active, now: date,
                                                 isStopping: isStopping,
                                                 onStop: {
                                                     guard !isStopping else { return }
                                                     isStopping = true
                                                     Task {
                                                         await appState.jobClockOut()
                                                         isStopping = false
                                                     }
                                                 })
                            }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 4)
                        }

                        // Evaluate the session pipeline ONCE (each of these
                        // properties re-filters + re-sorts the whole jobSessions
                        // array; they were hit 3× per render).
                        let sessions = jobSessionsInPeriod
                        let groups = jobSessionGroups
                        // Lazy: only on-screen day-group cards build.
                        LazyVStack(spacing: 12) {
                            JobHoursSummaryRow(periodHours: jobPeriodHours,
                                               sessions: sessions.count)
                            ForEach(groups) { group in
                                EntryGroupCard(group: group)
                            }
                            if sessions.isEmpty && activeJobClock == nil {
                                HoursEmptyState()
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.visible)
                .topFadeMask()
            }
        }
        // Everyone: this person's own job sessions feed the "Past Jobs" history.
        // Runs FIRST so the admin org-wide fetch below overwrites it (both write
        // the same `jobSessions` array) — admins keep whole-org data for the team
        // stats, and Past Jobs re-filters it to the current person in-view.
        //
        // Whole-org pay-clock + job-session history (heavy) so the team stats
        // cover everyone. Lifetime data → changing the selected week just
        // re-filters locally, no refetch.
        // Refresh on open — timeclock + job sessions pulled CONCURRENTLY (one
        // combined update, not four staggered spurts). The data is also warmed
        // in the background by loadAll, so it's usually already populated here.
        .task { appState.warmStatsData() }
    }

    // MARK: Title (Analytics + selected week in accent)

    private var statsTitle: some View {
        HStack(alignment: .center, spacing: 10) {
            Text("Analytics")
                .font(.custom(TFontName.extrabold.rawValue, size: 56))
                .tracking(-4)
                .foregroundStyle(Color(hex: T.ink))
                // "Analytics" is nearly twice the width of the old "Stats" and
                // shares this row with the week range, so it shrinks to fit on
                // narrower phones rather than truncating or pushing the week off.
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Spacer(minLength: 8)
            Text(weekLabel)
                .font(TTypo.smBold(15))
                .foregroundStyle(Color(hex: T.accent))
                .tnum()
        }
        .padding(.horizontal, 16)
    }

    /// The selected week's date range, e.g. "Jun 30 – Jul 6" (or "Jul 1–7"
    /// when the week stays within one month).
    private var weekLabel: String {
        let cal = Calendar.current
        let interval = StatsMath.weekInterval(containing: weekAnchor, calendar: cal)
        let start = interval.start
        let last = cal.date(byAdding: .day, value: -1, to: interval.end) ?? interval.end
        let mdd = DateFormatter.display("MMM d")
        if cal.isDate(start, equalTo: last, toGranularity: .month) {
            let dOnly = DateFormatter.display("d")
            return "\(mdd.string(from: start))–\(dOnly.string(from: last))"
        }
        return "\(mdd.string(from: start)) – \(mdd.string(from: last))"
    }

    // MARK: Utilization (team average of each worker's assigned ÷ capacity)

    /// Monday–Sunday, matching the desktop's analytics week. `.weekOfYear` would
    /// start Sunday under en_US and split Sunday's hours across platforms.
    private var weekInterval: DateInterval {
        StatsMath.weekInterval(containing: weekAnchor, calendar: Calendar.current)
    }

    /// Team-average utilization for the selected week: each worker's assigned
    /// job hours ÷ their weekly capacity (org hpd × workdays), capped at 100%,
    /// averaged across workers. Assigned hours = each task's estimated hours
    /// (`hpd`), the same estimate the progress bars use.
    /// NOTE: if `hpd` turns out to mean hours-PER-DAY rather than a task total,
    /// only `taskEstHours` needs to change (× business-day span).
    private var utilizationPercent: Int {
        let s = appState.orgSettings
        let capacity = max(1.0, s.hpd * Double(max(1, s.workDays.count)))
        let workers = appState.people.filter { !$0.isAdmin }
        guard !workers.isEmpty else { return 0 }
        let week = weekInterval

        // Walk the job tree ONCE, accumulating hours per person, rather than
        // re-walking every job → panel → op for each worker. Was
        // O(workers × tasks) — with ~20 workers that re-parsed and re-tested the
        // same tasks 20 times per render, on a view that ticks every 1–5s.
        var hoursByPerson: [String: Double] = [:]
        for job in appState.jobs {
            for panel in job.subs {
                if panel.subs.isEmpty {
                    guard taskOverlaps(panel.start, panel.end, week) else { continue }
                    let h = taskEstHours(panel.hpd)
                    for pid in panel.team { hoursByPerson[pid, default: 0] += h }
                } else {
                    for op in panel.subs {
                        guard taskOverlaps(op.start, op.end, week) else { continue }
                        let h = taskEstHours(op.hpd)
                        for pid in op.team { hoursByPerson[pid, default: 0] += h }
                    }
                }
            }
        }

        let avg = workers.reduce(0.0) { acc, p in
            acc + min(100.0, (hoursByPerson[p.id] ?? 0) / capacity * 100.0)
        } / Double(workers.count)
        return Int(avg.rounded())
    }

    private func assignedHours(personId: String, in week: DateInterval) -> Double {
        var total = 0.0
        for job in appState.jobs {
            for panel in job.subs {
                if panel.subs.isEmpty {
                    if panel.team.contains(personId), taskOverlaps(panel.start, panel.end, week) {
                        total += taskEstHours(panel.hpd)
                    }
                } else {
                    for op in panel.subs where op.team.contains(personId) {
                        if taskOverlaps(op.start, op.end, week) { total += taskEstHours(op.hpd) }
                    }
                }
            }
        }
        return total
    }

    /// Estimated hours for one task. Treats `hpd` as the task's total estimate
    /// (matches AppState.opHoursPair). Single spot to change if it's per-day.
    private func taskEstHours(_ hpd: Double) -> Double {
        hpd > 0 ? hpd : appState.orgSettings.hpd
    }

    /// True when a task's [start, end] overlaps the selected week.
    private func taskOverlaps(_ startStr: String, _ endStr: String, _ week: DateInterval) -> Bool {
        guard let s = startStr.asDate, let e = endStr.asDate else { return false }
        return s < week.end && e >= week.start
    }

    // MARK: Small stat boxes (Utilization wired; rest are placeholders)

    /// Takes its numbers ALREADY COMPUTED rather than deriving them itself.
    ///
    /// This sits inside a 5s timeline. When it computed `utilizationPercent` and
    /// `taskSwitchingCount` internally, those full job-tree / job-session walks
    /// re-ran every 5 seconds — even though both are WEEKLY aggregates that
    /// don't depend on `now` at all. The caller now evaluates them once per body
    /// evaluation (i.e. on real data changes) and the tick only refreshes Idle.
    private func statGrid(utilization: Int, switching: Int, idle: Double) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12),
                            GridItem(.flexible(), spacing: 12)], spacing: 12) {
            StatBox(label: "Utilization", value: "\(utilization)%",
                    info: "Share of the team's scheduled capacity that's booked with work this week. Each worker's assigned job hours ÷ their weekly capacity (hours-per-day × workdays), capped at 100%, then averaged across the team.")
            StatBox(label: "Task Switching", value: "\(switching)",
                    info: "How many distinct jobs the team touched this week. A job clocked out of and back into still counts once.")
            StatBox(label: "Reworks", value: "—",
                    info: "Rework hits: when a completed job sent to buyoff is brought back because a task was done wrong, the person who did that task takes one rework hit — one per hit. Not tracked yet (awaiting the rework button).")
            StatBox(label: "Idle Time", value: fmtIdle(idle),
                    info: "Paid clocked-in time not logged onto any job this week — pay hours minus job hours.")
        }
    }

    // MARK: Personal stats (your own, or an admin-selected worker)

    /// Whose personal view (stat grid + Past Jobs) is shown: the admin-selected
    /// worker, else the current user.
    private var statsPersonId: String? {
        appState.isAdmin ? (selectedWorkerId ?? appState.currentPersonId) : appState.currentPersonId
    }
    private var statsPerson: Person? {
        guard let pid = statsPersonId else { return nil }
        return appState.people.first { $0.id == pid }
    }
    private var isViewingSelf: Bool { statsPersonId == appState.currentPersonId }
    /// Name shown centered in the header while an admin views a specific worker.
    private var selectedWorkerName: String? {
        guard let id = selectedWorkerId else { return nil }
        return appState.people.first { $0.id == id }?.name
    }

    // MARK: - Header glass menus (worker picker + week picker)

    /// Liquid-glass person button → native menu of workers (admins). "Everyone"
    /// returns to the org dashboard; the current selection is checked.
    private var workerMenu: some View {
        Menu {
            Picker("Worker", selection: $selectedWorkerId) {
                Text("Everyone").tag(String?.none)
                ForEach(appState.people.sorted { $0.name < $1.name }) { p in
                    Text(p.name).tag(String?.some(p.id))
                }
            }
        } label: {
            glassHeaderIcon(.person)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        // Own shadow tied to the button so it doesn't drop out for a frame when
        // the menu dismisses (the system glass shadow briefly disappears there).
        .shadow(color: .black.opacity(0.12), radius: 5, x: 0, y: 3)
    }

    /// Liquid-glass calendar button → native menu of recent weeks; picking one
    /// repoints the stats week. The current week is checked.
    private var weekMenu: some View {
        Menu {
            ForEach(weekStarts, id: \.self) { start in
                Button { weekAnchor = start } label: {
                    if sameWeek(start, weekAnchor) {
                        Label(weekLabel(start), systemImage: "checkmark")
                    } else {
                        Text(weekLabel(start))
                    }
                }
            }
        } label: {
            glassHeaderIcon(.cal)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .shadow(color: .black.opacity(0.12), radius: 5, x: 0, y: 3)
    }

    /// The menu label glyph. The native `.glass` button style (on the Menu)
    /// supplies the circular glass chrome and morphs it into the dropdown, so the
    /// button itself becomes the menu (no separate placeholder circle).
    private func glassHeaderIcon(_ icon: TIcon) -> some View {
        TIconView(icon: icon, size: 18, color: Color(hex: T.ink))
            .frame(width: 22, height: 22)
    }

    /// Start-of-week (Monday) dates for the last 8 weeks, this week first.
    private var weekStarts: [Date] {
        let cal = Calendar.current
        let thisStart = StatsMath.weekInterval(containing: Date(), calendar: cal).start
        return (0..<8).compactMap { cal.date(byAdding: .day, value: -7 * $0, to: thisStart) }
    }
    private func weekLabel(_ start: Date) -> String {
        let cal = Calendar.current
        let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
        let f = DateFormatter.display("MMM d")
        let range = "\(f.string(from: start)) – \(f.string(from: end))"
        return sameWeek(start, Date()) ? "This week · \(range)" : range
    }
    /// Compared by Monday-anchored week start, not `.weekOfYear` — otherwise on a
    /// Sunday the picker checkmark and the "This week" label point at the week
    /// that is about to begin rather than the one being shown.
    private func sameWeek(_ a: Date, _ b: Date) -> Bool {
        let cal = Calendar.current
        return StatsMath.weekInterval(containing: a, calendar: cal).start
            == StatsMath.weekInterval(containing: b, calendar: cal).start
    }

    /// Operations a person is assigned to (leaf ops across all jobs).
    private func ops(for personId: String) -> [Operation] {
        appState.jobs.flatMap { $0.subs }.flatMap { $0.subs }.filter { $0.team.contains(personId) }
    }
    /// A person's utilization for the selected week (assigned ÷ capacity).
    private func utilizationPercent(for personId: String) -> Int {
        let s = appState.orgSettings
        let capacity = max(1.0, s.hpd * Double(max(1, s.workDays.count)))
        return Int(min(100.0, assignedHours(personId: personId, in: weekInterval) / capacity * 100.0).rounded())
    }
    @ViewBuilder
    private func personalStatGrid(for personId: String) -> some View {
        let pOps = ops(for: personId)
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12),
                            GridItem(.flexible(), spacing: 12)], spacing: 12) {
            StatBox(label: "Utilization", value: "\(utilizationPercent(for: personId))%",
                    info: "Share of scheduled capacity booked with work this week — assigned job hours ÷ weekly capacity (hours-per-day × workdays), capped at 100%.")
            StatBox(label: "Jobs Done", value: "\(pOps.filter { $0.status == .finished }.count)",
                    info: "Operations they're assigned to that are finished.")
            StatBox(label: "In Progress", value: "\(pOps.filter { $0.status == .inProgress }.count)",
                    info: "Operations they're assigned to that are currently in progress.")
            StatBox(label: "Hours", value: String(format: "%.1fh", jobPeriodHours),
                    info: "Job hours logged this pay period.")
        }
    }

    // MARK: Over-hours (jobs whose logged actual > estimated)

    /// Jobs currently over estimate: est = Σ of the job's op/panel `hpd`,
    /// actual = Σ of its ops' `loggedHours` (cumulative all-time — so this is a
    /// current-state metric, NOT week-scoped). Admins see every over job; a
    /// non-admin sees only jobs they're on / logged time to.
    private var overHoursItems: [OverHoursJob] {
        let mineOnly = !appState.isAdmin
        let myId = appState.currentPersonId
        var items: [OverHoursJob] = []
        for job in appState.jobs {
            var est = 0.0, actual = 0.0
            for panel in job.subs {
                if panel.subs.isEmpty {
                    est += panel.hpd > 0 ? panel.hpd : appState.orgSettings.hpd
                } else {
                    for op in panel.subs {
                        est += op.hpd > 0 ? op.hpd : appState.orgSettings.hpd
                        actual += op.loggedHours ?? 0
                    }
                }
            }
            guard est > 0, actual > est else { continue }
            if mineOnly && !personOnJob(job, myId) { continue }
            items.append(OverHoursJob(title: job.title, est: est, actual: actual))
        }
        return items.sorted { $0.over > $1.over }
    }

    /// Whether the person is assigned anywhere in the job or logged time on it.
    private func personOnJob(_ job: Job, _ personId: String?) -> Bool {
        guard let pid = personId else { return false }
        if job.team.contains(pid) { return true }
        for panel in job.subs {
            if panel.team.contains(pid) { return true }
            for op in panel.subs where op.team.contains(pid) { return true }
        }
        return appState.jobSessions.contains { $0.jobId == job.id && $0.personId == pid }
    }

}

// MARK: - Efficiency (job hours ÷ pay hours) · MoreView

private extension MoreView {
    /// Pay-clock work rows (exclude lunch/break event rows). `personId` nil =
    /// everyone (org view); otherwise just that person's rows.
    func payEntries(for personId: String?) -> [TimeclockEntry] {
        appState.timeclockEntries.filter {
            $0.eventType == nil && $0.clockIn != nil && $0.clockOut != nil
                && (personId == nil || $0.personId == personId)
        }
    }

    /// Best calendar day for a row: its ISO clockIn, else its "YYYY-MM-DD" date.
    func dayOf(_ iso: String?, _ dateStr: String?) -> Date? {
        if let iso, let d = Date.fromFlexibleISO8601(iso) { return d }
        if let dateStr, !dateStr.isEmpty {
            return Self.isoDateOnly.date(from: dateStr)   // cached; was allocated per call
        }
        return nil
    }
    static let isoDateOnly: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; return f
    }()

    /// Hours currently accruing from OPEN clocks, attributed to the calendar day
    /// the clock started. Pay = elapsed of an open pay shift minus LUNCH — the
    /// same basis a finalised punch uses (`pausedMsFromEvents` server-side).
    /// Breaks are deliberately NOT subtracted here: they are paid time, so they
    /// stay in pay and come out of production only. Job = elapsed of an open job
    /// clock, minus paused time (which now includes both lunch and breaks).
    /// `personId` nil = everyone (team view). This is what makes the graph grow
    /// live while someone is clocked in.
    func liveAccrual(for personId: String?, now: Date) -> [(day: Date, pay: Double, job: Double, brk: Double)] {
        var out: [(day: Date, pay: Double, job: Double, brk: Double)] = []
        for p in appState.people where personId == nil || p.id == personId {
            if let c = p.activeClockIn, !c.clockIn.isEmpty, let s = Date.fromFlexibleISO8601(c.clockIn) {
                var ms = now.timeIntervalSince(s) * 1000
                var lunchOpen: Date? = nil
                for ev in c.events.sorted(by: { $0.ts < $1.ts }) {
                    guard let t = Date.fromFlexibleISO8601(ev.ts) else { continue }
                    if ev.type == "lunchStart" {
                        lunchOpen = t
                    } else if ev.type == "lunchEnd", let open = lunchOpen {
                        ms -= max(0, t.timeIntervalSince(open) * 1000)
                        lunchOpen = nil
                    }
                }
                // Still on lunch: close the open range at `now`, as the server does at clock-out.
                if let open = lunchOpen { ms -= max(0, now.timeIntervalSince(open) * 1000) }
                // Break time inside the OPEN shift, so the denominator excludes it
                // live rather than only once the punch is finalised.
                var brkMs: Double = 0
                var breakOpen: Date? = nil
                for ev in c.events.sorted(by: { $0.ts < $1.ts }) {
                    guard let t = Date.fromFlexibleISO8601(ev.ts) else { continue }
                    if ev.type == "breakStart" {
                        breakOpen = t
                    } else if ev.type == "breakEnd", let open = breakOpen {
                        brkMs += max(0, t.timeIntervalSince(open) * 1000)
                        breakOpen = nil
                    }
                }
                if let open = breakOpen { brkMs += max(0, now.timeIntervalSince(open) * 1000) }
                out.append((s, max(0, ms / 1000 / 3600), 0, max(0, brkMs / 1000 / 3600)))
            }
            if let jc = p.activeJobClock, !jc.clockIn.isEmpty, let s = Date.fromFlexibleISO8601(jc.clockIn) {
                var ms = now.timeIntervalSince(s) * 1000
                ms -= (jc.totalPausedMs ?? 0)
                if let pa = jc.pausedAt, let ps = Date.fromFlexibleISO8601(pa) {
                    ms -= now.timeIntervalSince(ps) * 1000
                }
                out.append((s, 0, max(0, ms / 1000 / 3600), 0))
            }
        }
        return out
    }

    /// The seven days of the selected week with pay + job hours. `personId` nil =
    /// everyone (team efficiency); otherwise that person's own efficiency. `now`
    /// drives the LIVE portion: open clocks add their elapsed to their start day,
    /// so passing a ticking `now` grows the bars in real time.
    func efficiencyDays(for personId: String?, now: Date = Date()) -> [EffDay] {
        let cal = Calendar.current
        let week = weekInterval
        let dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        let pays = payEntries(for: personId)
        let sessions = appState.jobSessions.filter { personId == nil || $0.personId == personId }
        let live = liveAccrual(for: personId, now: now)
        // Bucket by start-of-day in ONE pass (was: 7× reduce over all rows, each
        // re-parsing every row's date — O(7·N) date parses per call, ×3 per render).
        var payByDay: [Date: Double] = [:]
        for e in pays {
            guard let ed = dayOf(e.clockIn, e.date) else { continue }
            payByDay[cal.startOfDay(for: ed), default: 0] += (e.hours ?? 0)
        }
        var jobByDay: [Date: Double] = [:]
        for s in sessions {
            guard let sd = dayOf(s.clockIn, s.date) else { continue }
            jobByDay[cal.startOfDay(for: sd), default: 0] += (s.hours ?? 0)
        }
        // Paid break time per day, paired from the breakStart/breakEnd event rows
        // — actual records only, never an assumed 30min. Pairing happens PER
        // PERSON inside StatsMath: on the org view these rows cover the whole
        // shop, and a single shared cursor lost most of the break time whenever
        // two people were on break at once.
        let breakByDay = StatsMath.breakHoursByDay(
            appState.timeclockEntries
                .filter { (personId == nil || $0.personId == personId)
                    && ($0.eventType == "breakStart" || $0.eventType == "breakEnd") }
                .compactMap { e -> StatsMath.BreakRow? in
                    guard let ts = e.timestamp, let d = Date.fromFlexibleISO8601(ts) else { return nil }
                    return StatsMath.BreakRow(personId: e.personId, type: e.eventType ?? "", t: d)
                },
            calendar: cal)
        var out: [EffDay] = []
        for offset in 0..<7 {
            guard let day = cal.date(byAdding: .day, value: offset, to: week.start) else { continue }
            let key = cal.startOfDay(for: day)
            var pay = payByDay[key] ?? 0
            var job = jobByDay[key] ?? 0
            var brk = breakByDay[key] ?? 0
            for a in live where cal.isDate(a.day, inSameDayAs: day) {
                pay += a.pay
                job += a.job
                brk += a.brk
            }
            let label = dows[cal.component(.weekday, from: day) - 1]
            out.append(EffDay(label: label, pay: pay, job: job, breakHours: brk))
        }
        return out
    }

    /// Efficiency = week job hours ÷ week pay hours (e.g. 30 logged of 40 paid = 75%).
    func efficiencyPercent(for personId: String?, now: Date = Date()) -> Int {
        efficiencyPercent(from: efficiencyDays(for: personId, now: now))
    }

    /// Idle time = paid clocked-in hours NOT logged onto a job for the week
    /// (everyone) — the complement of Efficiency. Pay is net of LUNCH but
    /// includes breaks (breaks are paid); production is net of lunch AND breaks.
    /// So a worker who takes their full breaks and logs everything else shows a
    /// baseline idle of the break time itself — 0.5h/day on a 9h window with
    /// 2x15m. That is the intended semantic, not a gap to chase. Live via `now`.
    func idleHours(now: Date = Date()) -> Double {
        idleHours(from: efficiencyDays(for: nil, now: now))
    }

    /// Derive from an ALREADY-COMPUTED week so callers that also need the days
    /// (or the efficiency percentage) don't walk every pay entry and job session
    /// a second and third time — `efficiencyDays` used to run 3× per tick.
    func idleHours(from days: [EffDay]) -> Double {
        let working = days.reduce(0.0) { $0 + $1.workingHours }
        let job = days.reduce(0.0) { $0 + $1.job }
        return max(0, working - job)
    }

    /// Same, for the efficiency percentage.
    func efficiencyPercent(from days: [EffDay]) -> Int {
        let working = days.reduce(0.0) { $0 + $1.workingHours }
        let totalJob = days.reduce(0.0) { $0 + $1.job }
        // Denominator <= 0 means no clocked time, or malformed data recording more
        // break than pay. Either way there is no working time to be a fraction of.
        guard working > 0 else {
            let totalPay = days.reduce(0.0) { $0 + $1.pay }
            let totalBreak = days.reduce(0.0) { $0 + $1.breakHours }
            if totalPay > 0 && totalBreak > totalPay {
                print("[stats] break time (\(totalBreak)h) exceeds pay (\(totalPay)h) — efficiency reported as 0")
            }
            return 0
        }
        return Int((totalJob / working * 100).rounded())
    }

    /// Paid break time across the period. Not surfaced yet; kept so a future
    /// "of your paid time, X was breaks" line needs no recomputation.
    func breakHours(from days: [EffDay]) -> Double {
        days.reduce(0.0) { $0 + $1.breakHours }
    }

    /// "3h 12m" — idle rounded to the minute.
    func fmtIdle(_ hours: Double) -> String {
        let totalMin = Int((hours * 60).rounded())
        return "\(totalMin / 60)h \(totalMin % 60)m"
    }

    /// Task switching = distinct jobs touched in the selected week (a job
    /// clocked out of and back into still counts once). Team-wide for now.
    var taskSwitchingCount: Int {
        let cal = Calendar.current
        let week = weekInterval
        var jobIds = Set<String>()
        for s in appState.jobSessions where !s.jobId.isEmpty {
            guard let d = dayOf(s.clockIn, s.date) else { continue }
            if d >= week.start && d < week.end { jobIds.insert(s.jobId) }
        }
        return jobIds.count
    }
}

// MARK: - Past Jobs compute (this user's own job-clock history) · MoreView
// Moved verbatim from TimeClockView's "Job Hours" section. Scoped to the
// CURRENT person and windowed to the org's pay period (not the Stats week).

private extension MoreView {
    var myId: String? { appState.currentPersonId }
    /// The viewed person's running job clock (self, or an admin-selected worker).
    var activeJobClock: ActiveJobClock? { statsPerson?.activeJobClock }

    /// Live hours of the in-progress job clock (independent of the pay clock).
    var liveJobHours: Double {
        guard let jc = activeJobClock, let s = Date.fromFlexibleISO8601(jc.clockIn) else { return 0 }
        let nowDate = Date()
        var ms = nowDate.timeIntervalSince(s) * 1000
        ms -= (jc.totalPausedMs ?? 0)
        if let p = jc.pausedAt, let pStart = Date.fromFlexibleISO8601(p) {
            ms -= nowDate.timeIntervalSince(pStart) * 1000
        }
        return max(0, ms / 1000 / 3600)
    }

    /// My completed job sessions inside the pay period, newest first.
    var jobSessionsInPeriod: [JobSession] {
        let w = periodWindow
        let end = Calendar.current.date(byAdding: .day, value: 1, to: w.end) ?? w.end
        return appState.jobSessions
            .filter { s in
                guard let pid = statsPersonId, s.personId == pid else { return false }
                guard let d = isoDay(s.clockIn) ?? parseISO(s.date ?? "") else { return false }
                return d >= w.start && d < end
            }
            .sorted { ($0.clockIn ?? "") > ($1.clockIn ?? "") }
    }

    var jobPeriodHours: Double {
        jobSessionsInPeriod.reduce(0.0) { $0 + ($1.hours ?? 0) } + liveJobHours
    }

    /// Job sessions grouped by day for the dated log.
    var jobSessionGroups: [EntryGroup] {
        let cal = Calendar.current
        let df = DateFormatter.display("EEE · MMM d")
        let groups = Dictionary(grouping: jobSessionsInPeriod) { s -> Date in
            // Fall back to the session's `date` (as jobSessionsInPeriod does) before
            // today, so a session with a nil clockIn isn't misfiled under today.
            cal.startOfDay(for: isoDay(s.clockIn) ?? parseISO(s.date ?? "") ?? Date())
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

    /// Pay-period boundaries from the org's time-clock settings (same source
    /// TimeClockView uses). Fresh Date() — the window only shifts at pay-period
    /// boundaries, so it needs no per-second ticker.
    var periodWindow: (start: Date, end: Date) {
        appState.payPeriodWindow(now: Date())
    }

    func isoDay(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return Date.fromFlexibleISO8601(iso)
    }

    func parseISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}

// MARK: - Small stat box (compact frosted: label + big number + optional caption)

private struct StatBox: View {
    let label: String
    let value: String
    var caption: String? = nil
    var info: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 4) {
                Text(label.uppercased())
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.0)
                Spacer(minLength: 2)
                if !info.isEmpty { InfoButton(text: info) }
            }
            Text(value)
                .font(.custom(TFontName.bold.rawValue, size: 30))
                .foregroundStyle(Color(hex: T.ink))
                .tnum()
            if let caption {
                Text(caption)
                    .font(TTypo.xs(10))
                    .foregroundStyle(Color(hex: T.muted))
                    .lineLimit(1)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        .frostedCard(radius: T.cornerMd)
    }
}

/// Small "i" that pops down a stat's description (what it is + how it's recorded).
private struct InfoButton: View {
    let text: String
    @State private var show = false

    var body: some View {
        Button { show.toggle() } label: {
            Image(systemName: "info.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(hex: T.muted))
        }
        .buttonStyle(.plain)
        .popover(isPresented: $show) {
            Text(text)
                .font(TTypo.sm(13))
                .foregroundStyle(Color(hex: T.ink))
                .multilineTextAlignment(.leading)
                .padding(16)
                .frame(width: 264)
                .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Over-hours tab (full-width bar → drops its list down beneath it)

private struct OverHoursTab: View {
    let value: String
    let expanded: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text("OVER-HOURS")
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.2)
                Text(value)
                    .font(TTypo.smBold(15))
                    .foregroundStyle(Color(hex: T.ink))
                    .tnum()
                Spacer(minLength: 8)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(hex: T.muted))
                    .rotationEffect(.degrees(expanded ? 180 : 0))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity)
            .frostedCard(radius: T.cornerMd)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Over-hours dropdown (est vs actual per job)

struct OverHoursJob: Identifiable {
    let id = UUID()
    let title: String
    let est: Double      // admin-set estimate (Σ op hpd)
    let actual: Double   // hours actually logged (Σ op loggedHours)
    var over: Double { max(0, actual - est) }
}

/// Compact hours label: "26h" / "5.5h".
private func fmtHours(_ v: Double) -> String {
    v == v.rounded() ? String(format: "%.0fh", v) : String(format: "%.1fh", v)
}

private struct OverHoursList: View {
    let jobs: [OverHoursJob]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("JOB").tLabel(tracking: 1.0)
                Spacer()
                Text("EST").tLabel(tracking: 1.0).frame(width: 46, alignment: .trailing)
                Text("ACT").tLabel(tracking: 1.0).frame(width: 46, alignment: .trailing)
                Text("OVER").tLabel(tracking: 1.0).frame(width: 52, alignment: .trailing)
            }
            .font(TTypo.xsBold(10))
            .foregroundStyle(Color(hex: T.muted))
            .padding(.horizontal, 14).padding(.vertical, 10)

            Rectangle().fill(Color(hex: T.hair)).frame(height: 1)

            if jobs.isEmpty {
                Text("No jobs over their estimate.")
                    .font(TTypo.xs(12))
                    .foregroundStyle(Color(hex: T.muted))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            } else {
                ForEach(jobs) { OverHoursRow(job: $0) }
            }
        }
        .frostedCard(radius: T.cornerMd)
    }
}

private struct OverHoursRow: View {
    let job: OverHoursJob

    var body: some View {
        HStack(spacing: 8) {
            Text(job.title)
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
            Spacer()
            Text(fmtHours(job.est))
                .font(TTypo.sm(13))
                .foregroundStyle(Color(hex: T.muted))
                .tnum()
                .frame(width: 46, alignment: .trailing)
            Text(fmtHours(job.actual))
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.ink))
                .tnum()
                .frame(width: 46, alignment: .trailing)
            Text("+" + fmtHours(job.over))
                .font(TTypo.smBold(13))
                .foregroundStyle(Color(hex: T.amber))
                .tnum()
                .frame(width: 52, alignment: .trailing)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }
}

// MARK: - Efficiency (parent % + weekly pay-vs-job bars)

struct EffDay: Identifiable {
    var id: String { label }
    let label: String
    let pay: Double
    let job: Double
    /// Paid break time for the day, from actual breakStart/breakEnd records — no
    /// assumed 30min. Excluded from the efficiency denominator because breaks are
    /// mandatory paid downtime a worker cannot convert into production; counting
    /// them would cap everyone at ~93.75% for following the rules. Kept as its own
    /// field so "of your paid time, X was breaks" is available to future UI.
    let breakHours: Double

    /// Time the worker could actually have been producing: paid time minus the
    /// breaks they were required to take. Clamped at 0 — malformed data can
    /// record more break than pay.
    var workingHours: Double { max(0, pay - breakHours) }

    /// Daily difference shown above the bars: production against working time,
    /// so a day spent entirely on jobs reads 0 rather than minus the break.
    var diff: Double { job - workingHours }
}

private struct EfficiencyCard: View {
    let percent: String
    let days: [EffDay]
    var info: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text("EFFICIENCY")
                    .font(TTypo.xsBold(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 1.2)
                Spacer()
                if !info.isEmpty { InfoButton(text: info) }
            }
            Text(percent)
                .font(.custom(TFontName.bold.rawValue, size: 40))
                .foregroundStyle(Color(hex: T.ink))
                .tnum()

            WeeklyBars(days: days)

            HStack(spacing: 16) {
                legend(color: Color(hex: T.accentGradientStart), text: "Pay hours")
                legend(color: Color(hex: T.accentGradientEnd), text: "Job hours")
                Spacer()
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frostedCard(radius: T.cornerHero)
    }

    private func legend(color: Color, text: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 12, height: 12)
            Text(text).font(TTypo.xs(11)).foregroundStyle(Color(hex: T.muted))
        }
    }
}

private struct WeeklyBars: View {
    let days: [EffDay]
    private let barsHeight: CGFloat = 96

    var body: some View {
        // Scale to the tallest bar in THIS dataset. A fixed per-person ceiling
        // (this was 9h, "a full workday ≈ a full bar") pegged every bar on the
        // org dashboard, where each bar sums the whole shop — 15 workers put
        // ~120h/day against a 9h ceiling, so all fourteen bars drew full height
        // and the chart carried no information. Computed once here rather than
        // per bar: the view sits inside a 5s timeline.
        let maxValue = StatsMath.barMax(days.flatMap { [$0.pay, $0.job] })
        HStack(alignment: .bottom, spacing: 8) {
            ForEach(days) { d in
                VStack(spacing: 6) {
                    Text(String(format: "%+.2f", d.diff))
                        .font(TTypo.mono(9))
                        .foregroundStyle(d.diff < 0 ? Color(hex: T.red) : Color(hex: T.green))
                        .tnum()
                    HStack(alignment: .bottom, spacing: 3) {
                        bar(value: d.pay, max: maxValue, base: Color(hex: T.accentGradientStart))
                        bar(value: d.job, max: maxValue, base: Color(hex: T.accentGradientEnd))
                    }
                    .frame(height: barsHeight)
                    Text(d.label)
                        .font(TTypo.xs(11))
                        .foregroundStyle(Color(hex: T.muted))
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    /// One bar, styled like the Hours-page day bars: rounded, vertical-gradient
    /// fill grown from the bottom, with a short muted stub when there's no data.
    private func bar(value: Double, max maxValue: Double, base: Color) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(value > 0
                      ? AnyShapeStyle(LinearGradient(colors: [base, base.opacity(0.6)],
                                                     startPoint: .bottom, endPoint: .top))
                      : AnyShapeStyle(Color(hex: T.progressTrack)))
                .frame(height: max(6, min(1, value / maxValue) * barsHeight))
        }
        .frame(height: barsHeight)
    }
}

// MARK: - Non-admin empty state

private struct NonAdminEmpty: View {
    var body: some View {
        VStack(spacing: 12) {
            TIconView(icon: .stats, size: 44, color: Color(hex: T.hair))
            Text("Analytics are admin-only")
                .font(TTypo.h3(18))
                .foregroundStyle(Color(hex: T.ink))
            Text("Check back when you're a dispatcher.")
                .font(TTypo.sm(13))
                .foregroundStyle(Color(hex: T.muted))
        }
        .frame(maxWidth: .infinity)
        .padding(32)
    }
}

// MARK: - Past Jobs subviews (moved from the Hours page's Job Hours section)

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
                        ProgressView().progressViewStyle(.circular).tint(T.onGradient).scaleEffect(0.6)
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

// MARK: - Recent entries (used by the Past Jobs dated log)

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
        let f = DateFormatter.display("HH:mm")
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
