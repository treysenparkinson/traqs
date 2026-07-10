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
            AmbientBackground()

            VStack(spacing: 0) {
                // Sticky header. Calendar jumps weeks; the person button (admins)
                // picks a worker to view their personal stats.
                TRAQSNavHeader {
                    if appState.isAdmin { workerMenu }
                    weekMenu
                }
                .overlay(alignment: .center) {
                    if let name = selectedWorkerName {
                        Text("\(name)'s Stats")
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

                            statGrid
                                .padding(.horizontal, 16)

                            EfficiencyCard(percent: "\(efficiencyPercent(for: nil))%", days: efficiencyDays(for: nil),
                                           info: "Job hours logged ÷ pay hours for the week across everyone (e.g. 30 logged of 40 paid = 75%). The bars show each day's pay hours (left) vs job hours (right); the number above each day is the difference.")
                                .padding(.horizontal, 16)
                                .padding(.top, 16)

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

                            // This person's own efficiency for the selected week.
                            EfficiencyCard(percent: "\(efficiencyPercent(for: pid))%", days: efficiencyDays(for: pid),
                                           info: "Job hours logged ÷ pay hours for the week (e.g. 30 logged of 40 paid = 75%). The bars show each day's pay hours (left) vs job hours (right); the number above each day is the difference.")
                                .padding(.horizontal, 16)
                                .padding(.top, 16)
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
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                RunningEntryCard(jobClock: active, now: context.date,
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
                        .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.hidden)
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
        .task {
            await appState.refreshJobSessions(personId: appState.currentPersonId)
            // Own pay hours so a non-admin's personal Efficiency has data (admins
            // overwrite with the whole-org pull below).
            await appState.refreshTimeclock(personId: appState.currentPersonId)
            guard appState.isAdmin else { return }
            await appState.refreshTimeclock(personId: nil)
            await appState.refreshJobSessions(personId: nil)
        }
    }

    // MARK: Title (Stats + selected week in accent)

    private var statsTitle: some View {
        HStack(alignment: .center, spacing: 10) {
            Text("Stats")
                .font(.custom(TFontName.extrabold.rawValue, size: 56))
                .tracking(-4)
                .foregroundStyle(Color(hex: T.ink))
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
        guard let interval = cal.dateInterval(of: .weekOfYear, for: weekAnchor) else { return "" }
        let start = interval.start
        let last = cal.date(byAdding: .day, value: -1, to: interval.end) ?? interval.end
        let mdd = DateFormatter(); mdd.dateFormat = "MMM d"
        if cal.isDate(start, equalTo: last, toGranularity: .month) {
            let dOnly = DateFormatter(); dOnly.dateFormat = "d"
            return "\(mdd.string(from: start))–\(dOnly.string(from: last))"
        }
        return "\(mdd.string(from: start)) – \(mdd.string(from: last))"
    }

    // MARK: Utilization (team average of each worker's assigned ÷ capacity)

    private var weekInterval: DateInterval {
        Calendar.current.dateInterval(of: .weekOfYear, for: weekAnchor)
            ?? DateInterval(start: weekAnchor, duration: 7 * 86_400)
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
        let avg = workers.reduce(0.0) { acc, p in
            acc + min(100.0, assignedHours(personId: p.id, in: week) / capacity * 100.0)
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

    private var statGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12),
                            GridItem(.flexible(), spacing: 12)], spacing: 12) {
            StatBox(label: "Utilization", value: "\(utilizationPercent)%",
                    info: "Share of the team's scheduled capacity that's booked with work this week. Each worker's assigned job hours ÷ their weekly capacity (hours-per-day × workdays), capped at 100%, then averaged across the team.")
            StatBox(label: "Task Switching", value: "\(taskSwitchingCount)", caption: "jobs touched this week",
                    info: "How many distinct jobs the team touched this week. A job clocked out of and back into still counts once.")
            StatBox(label: "Reworks", value: "—",
                    info: "Rework hits: when a completed job sent to buyoff is brought back because a task was done wrong, the person who did that task takes one rework hit — one per hit. Not tracked yet (awaiting the rework button).")
            StatBox(label: "Idle Time", value: fmtIdle(idleHours), caption: "clocked in, off jobs",
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

    /// Start-of-week dates for the last 8 weeks (this week first).
    private var weekStarts: [Date] {
        let cal = Calendar.current
        guard let thisStart = cal.dateInterval(of: .weekOfYear, for: Date())?.start else { return [] }
        return (0..<8).compactMap { cal.date(byAdding: .day, value: -7 * $0, to: thisStart) }
    }
    private func weekLabel(_ start: Date) -> String {
        let cal = Calendar.current
        let end = cal.date(byAdding: .day, value: 6, to: start) ?? start
        let f = DateFormatter(); f.dateFormat = "MMM d"
        let range = "\(f.string(from: start)) – \(f.string(from: end))"
        return sameWeek(start, Date()) ? "This week · \(range)" : range
    }
    private func sameWeek(_ a: Date, _ b: Date) -> Bool {
        Calendar.current.isDate(a, equalTo: b, toGranularity: .weekOfYear)
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
            StatBox(label: "Hours", value: String(format: "%.1fh", jobPeriodHours), caption: "this pay period",
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
            let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]
            return f.date(from: dateStr)
        }
        return nil
    }

    /// The seven days of the selected week with pay + job hours. `personId` nil =
    /// everyone (team efficiency); otherwise that person's own efficiency.
    func efficiencyDays(for personId: String?) -> [EffDay] {
        let cal = Calendar.current
        let week = weekInterval
        let dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        let pays = payEntries(for: personId)
        let sessions = appState.jobSessions.filter { personId == nil || $0.personId == personId }
        var out: [EffDay] = []
        for offset in 0..<7 {
            guard let day = cal.date(byAdding: .day, value: offset, to: week.start) else { continue }
            let pay = pays.reduce(0.0) { acc, e in
                guard let ed = dayOf(e.clockIn, e.date) else { return acc }
                return cal.isDate(ed, inSameDayAs: day) ? acc + (e.hours ?? 0) : acc
            }
            let job = sessions.reduce(0.0) { acc, s in
                guard let sd = dayOf(s.clockIn, s.date) else { return acc }
                return cal.isDate(sd, inSameDayAs: day) ? acc + (s.hours ?? 0) : acc
            }
            let label = dows[cal.component(.weekday, from: day) - 1]
            out.append(EffDay(label: label, pay: pay, job: job))
        }
        return out
    }

    /// Efficiency = week job hours ÷ week pay hours (e.g. 30 logged of 40 paid = 75%).
    func efficiencyPercent(for personId: String?) -> Int {
        let days = efficiencyDays(for: personId)
        let totalPay = days.reduce(0.0) { $0 + $1.pay }
        let totalJob = days.reduce(0.0) { $0 + $1.job }
        guard totalPay > 0 else { return 0 }
        return Int((totalJob / totalPay * 100).rounded())
    }

    /// Idle time = paid clocked-in hours NOT logged onto a job for the week
    /// (everyone) — the complement of Efficiency. Uses gross pay hours (lunch/
    /// break not subtracted — same basis as Efficiency).
    var idleHours: Double {
        let days = efficiencyDays(for: nil)
        let pay = days.reduce(0.0) { $0 + $1.pay }
        let job = days.reduce(0.0) { $0 + $1.job }
        return max(0, pay - job)
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
    /// Daily difference shown above the bars (job − pay).
    var diff: Double { job - pay }
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
    private let maxValue: Double = 9   // a full workday ≈ a full bar (matches Hours)

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ForEach(days) { d in
                VStack(spacing: 6) {
                    Text(String(format: "%+.2f", d.diff))
                        .font(TTypo.mono(9))
                        .foregroundStyle(d.diff < 0 ? Color(hex: T.red) : Color(hex: T.green))
                        .tnum()
                    HStack(alignment: .bottom, spacing: 3) {
                        bar(value: d.pay, base: Color(hex: T.accentGradientStart))
                        bar(value: d.job, base: Color(hex: T.accentGradientEnd))
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
    private func bar(value: Double, base: Color) -> some View {
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
            Text("Stats are admin-only")
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
