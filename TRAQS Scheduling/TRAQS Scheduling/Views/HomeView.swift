import SwiftUI
import Combine

// MARK: - Home (the default landing tab)
// Wireframes v2 screen 01: title · this week · status tiles · today list. Every
// row and "Full schedule" switch to the Jobs tab (where the timer lives). Home
// never starts/logs time itself.

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav

    var body: some View {
        ZStack {
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

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {

                        // Title + this week. Both only change at the shop's
                        // midnight, so they ride the once-a-minute clock.
                        LiveClock(every: 60, tab: .home) { now in
                            VStack(alignment: .leading, spacing: 0) {
                                // The greeting reads larger than other pages' titles; the
                                // day and date head the week strip instead of a meta.
                                RvTitle(title: greeting, size: 46)

                                VStack(alignment: .leading, spacing: 0) {
                                    RvSection(ShopTime.current.formatter("EEEE, MMM d").string(from: now),
                                              action: "Full schedule", top: 0, perform: jumpToJobs)
                                    HomeWeekStrip(now: now)
                                }
                                .padding(.horizontal, Rv.side)
                            }
                        }

                        // Status — live shift + messages, two pastel tiles.
                        // Today's hours still lives on the Time Clock page.
                        VStack(alignment: .leading, spacing: 0) {
                            RvSection("STATUS")
                            RvTileGrid {
                                LiveClock(every: 1, tab: .home) { now in
                                    ShiftTile(status: appState.myShiftStatus,
                                              liveHours: appState.liveShiftHours(now: now),
                                              pauseSeconds: appState.livePauseSeconds(now: now)) {
                                        withAnimation(.easeInOut(duration: 0.22)) { appNav.selected = .hours }
                                    }
                                }
                                MessagesTile(senders: unreadBySender) {
                                    withAnimation(.easeInOut(duration: 0.22)) { appNav.selected = .chat }
                                }
                            }
                        }
                        .padding(.horizontal, Rv.side)

                        // Today's work.
                        Group {
                            if !appState.isBusinessTier {
                                // Basic: a schedule, not a job clock — today's shift
                                // and the next one, and a way to the full list.
                                BasicShiftsCard(onJump: jumpToJobs)
                            } else {
                                businessToday
                            }
                        }
                        .padding(.horizontal, Rv.side)
                        .padding(.bottom, 28)
                    }
                    .padding(.top, 4)
                }
                .scrollIndicators(.visible)
                .topFadeMask()
                .refreshable { await reload() }
            }
            // Home is the landing tab; pull the pay-clock entries + settings the
            // hero needs (jobs/people come from the app-level loadAll).
            .task {
                appState.foregroundSync()   // pull the latest jobs/people on open
                await appState.refreshTimeclock(personId: appState.currentPersonId)
                await appState.refreshOrgSettings()
            }
        }
    }

    // MARK: - Business: today's list

    /// The active job (if clocked in) first, then today's tasks in their
    /// existing order. Every row jumps to the Jobs list, where the timer lives.
    @ViewBuilder
    private var businessToday: some View {
        let rows = todayRows
        VStack(alignment: .leading, spacing: 0) {
            RvSection(title: "TODAY") {
                RvSectionAction(label: rows.count == 1 ? "1 item" : "\(rows.count) items")
            }
            if rows.isEmpty {
                Text("Nothing scheduled for today.")
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 16)
            } else {
                ForEach(rows, id: \.id) { task in
                    Button(action: jumpToJobs) {
                        RvRow {
                            RvDot(color: task.job.color.isEmpty ? Color(hex: T.accent) : Color(hex: task.job.color))
                            RvRowText(title: task.job.title.isEmpty ? task.title : task.job.title,
                                      subtitle: subtitle(for: task))
                            if isActive(task) {
                                RvTag(text: "ON JOB",
                                      foreground: Color(hex: T.accent),
                                      background: Color(hex: T.accent).opacity(0.14))
                            }
                            RvChevron()
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Data

    private var personName: String { appState.currentPerson?.name ?? "" }

    /// First name only, for the friendly Home greeting.
    private var firstName: String {
        personName.split(separator: " ").first.map(String.init) ?? ""
    }

    /// Home page title: "Hello, <first name>" once the person loads, else "Hello".
    private var greeting: String {
        firstName.isEmpty ? "Hello" : "Hello, \(firstName)"
    }

    /// Unread messages grouped by sender (person name + count), most first.
    /// Reads AppState's cache — this used to be a duplicate O(messages) scan
    /// recomputed on every HomeView render (and the 1s ticker made that every
    /// second). The scan now runs once per data change, shared with the nav
    /// bar's badge count.
    private var unreadBySender: [(id: String, name: String, count: Int)] {
        appState.unreadSenders
    }

    /// "Today" only rolls over at midnight, so this reads the clock directly
    /// instead of riding a per-second ticker that invalidated the whole body.
    private var today: [TaskAssignment] { appState.todayTasks(now: Date()) }

    /// Today's list: the active job (if clocked in) first, then today's tasks
    /// in their existing order, without repeating the active one.
    private var todayRows: [TaskAssignment] {
        let tasks = today
        guard let active = appState.activeTaskAssignment else { return tasks }
        return [active] + tasks.filter { $0.id != active.id }
    }

    /// "Panel/task · Oct 5" — the task's own name under the job title, and its
    /// scheduled dates.
    private func subtitle(for task: TaskAssignment) -> String {
        let start = task.op?.start ?? task.panel.start
        let end = task.op?.end ?? task.panel.end
        let dates = start.isEmpty ? "" : JobShifts.dateLabel(start: start, end: end.isEmpty ? start : end)
        return [task.title, dates].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func isActive(_ task: TaskAssignment) -> Bool {
        appState.myActiveJobClock != nil && appState.activeTaskAssignment?.id == task.id
    }

    // MARK: - Actions

    private func reload() async {
        await appState.loadAll()
        await appState.refreshTimeclock(personId: appState.currentPersonId)
        await appState.refreshOrgSettings()
    }

    private func jumpToJobs() {
        withAnimation(.easeInOut(duration: 0.22)) {
            appNav.jobsMode = .list   // the Start/Log-time control lives on the Jobs list card
            appNav.selected = .jobs
        }
    }
}

// MARK: - This week strip

/// The Sunday-to-Saturday week around `now`, today on the accent disc. Week and
/// "today" are both the SHOP's, not the device's.
private struct HomeWeekStrip: View {
    let now: Date

    private var weekDays: [Date] {
        let cal = ShopTime.current.calendar
        let today = cal.startOfDay(for: now)
        let weekday = cal.component(.weekday, from: today)   // 1 = Sun … 7 = Sat
        let start = cal.date(byAdding: .day, value: -(weekday - 1), to: today) ?? today
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }

    private func dow(_ d: Date) -> String {
        ["S", "M", "T", "W", "T", "F", "S"][ShopTime.current.calendar.component(.weekday, from: d) - 1]
    }
    private func dayNum(_ d: Date) -> String {
        String(ShopTime.current.calendar.component(.day, from: d))
    }

    var body: some View {
        let cal = ShopTime.current.calendar
        RvWeekStrip(days: weekDays.map { d in
            RvWeekStrip.Day(id: String(Int(d.timeIntervalSince1970)),
                            letter: dow(d),
                            number: dayNum(d),
                            isOn: cal.isDate(d, inSameDayAs: now))
        })
    }
}

// MARK: - Shift tile

/// Live shift status. On lunch or break the clock shows how long the pause has
/// run — the shift total is paused (lunch) or beside the point (break) until
/// they're back. Taps jump to the Time Clock tab.
private struct ShiftTile: View {
    let status: ShiftStatus
    let liveHours: Double
    let pauseSeconds: Double
    let onOpen: () -> Void

    private var isPaused: Bool { status == .lunch || status == .onBreak }

    private var statusText: String {
        switch status {
        case .offline:   return "Offline"
        case .clockedIn: return "Clocked in"
        case .lunch:     return "On lunch"
        case .onBreak:   return "On break"
        }
    }

    private var elapsed: String {
        let secs = max(0, Int(isPaused ? pauseSeconds : liveHours * 3600))
        return String(format: "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    var body: some View {
        RvTile(eyebrow: "SHIFT",
               // Offline says so in the big slot; the sub line would only repeat it.
               value: status == .offline ? "Offline" : elapsed,
               sub: status == .offline ? nil : statusText,
               tint: .lavender,
               action: onOpen) {
            if status.dot {
                RvDot(color: Color(hex: isPaused ? T.amber : T.green))
                    .padding(.top, 3)
            }
        }
    }
}

// MARK: - Messages tile

private struct MessagesTile: View {
    let senders: [(id: String, name: String, count: Int)]
    let onOpen: () -> Void

    private var total: Int { senders.reduce(0) { $0 + $1.count } }

    private var subText: String {
        switch senders.count {
        case 0:  return "All caught up"
        case 1:  return "from \(senders[0].name)"
        default: return "from \(senders.count) people"
        }
    }

    var body: some View {
        RvTile(eyebrow: "MESSAGES",
               value: "\(total)",
               sub: subText,
               tint: .mint,
               action: onOpen)
    }
}

// MARK: - Basic: today's shift and the next one

/// Basic tier's TODAY section: today's shifts and the next one, as cardless
/// rows. Every row, and the section action, go to the schedule.
struct BasicShiftsCard: View {
    @Environment(AppState.self) private var appState
    let onJump: () -> Void

    private var myShifts: [JobShifts.Shift] {
        let me = appState.currentPersonId
        return JobShifts.all(in: appState.jobs.filter { $0.status != .finished },
                             day: WorkDayClock.day(from: appState.orgSettings))
            .filter { $0.personId == me }
    }

    /// The shop's day, so the card turns over at the shop's midnight. It took the UTC day,
    /// which rolled to tomorrow's shifts at 18:00 in Denver.
    static func today(now: Date, org: OrgSettings) -> String { ShopTime(org: org).day(now) }

    var body: some View {
        let today = Self.today(now: Date(), org: appState.orgSettings)
        let mine = myShifts
        // Covering today, earliest first — a multi-day shift that started
        // yesterday is still today's.
        let todays = mine.filter { $0.start <= today && $0.end >= today }
            .sorted { $0.startHour < $1.startHour }
        let next = mine.filter { $0.start > today }
            .min { ($0.start, $0.startHour) < ($1.start, $1.startHour) }

        return VStack(alignment: .leading, spacing: 0) {
            RvSection("TODAY", action: "See my schedule", perform: onJump)

            if todays.isEmpty {
                Text("No shift today")
                    .font(TTypo.sm(13))
                    .foregroundStyle(Color(hex: T.muted))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 16)
            } else {
                ForEach(todays) { shiftRow($0, showDate: !$0.isOneDay) }
            }

            if let next {
                RvSection("NEXT SHIFT")
                shiftRow(next, showDate: true)
            }
        }
    }

    private func shiftRow(_ s: JobShifts.Shift, showDate: Bool) -> some View {
        let time = JobShifts.timeLabel(start: s.startHour, end: s.endHour)
        let sub = showDate ? "\(JobShifts.dateLabel(start: s.start, end: s.end)) · \(time)" : time
        let hex = appState.jobs.first(where: { $0.id == s.jobId })?.color ?? ""
        return Button(action: onJump) {
            RvRow {
                RvDot(color: Color(hex: hex.isEmpty ? T.accent : hex))
                RvRowText(title: s.jobTitle, subtitle: sub)
                RvChevron()
            }
        }
        .buttonStyle(.plain)
    }
}
