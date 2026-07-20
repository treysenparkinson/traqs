import SwiftUI
import Combine

// MARK: - Home (the default landing tab)
// A "good morning" page: a big greeting, today's clocked-in hours, live shift
// status, and a suggested job with a "Jump to job" button that switches to the
// Jobs tab (where the timer lives). Home never starts/logs time itself.

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav
    @State private var now = Date()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                TRAQSNavHeader {
                    // Profile: name on the left, avatar on the right.
                    HStack(spacing: 8) {
                        Text(personName)
                            .font(TTypo.smBold(14))
                            .foregroundStyle(Color(hex: T.ink))
                            .lineLimit(1)
                        Avatar(initials: initials, size: 34, gradient: true,
                               imageData: appState.currentPerson?.image)
                    }
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {

                        // Page title — personal greeting, same muted
                        // faded-to-transparent style as every other tab.
                        PageTitle(title: greeting)
                            .padding(.top, pageTitleTopInset)
                            .padding(.bottom, 10)

                        // Today's date + this week (today highlighted).
                        TodayDateCard(now: now)
                            .padding(.horizontal, 16)

                        // Today's hours + new messages — two square cards side by side.
                        HStack(spacing: 12) {
                            HoursTodayHero(hoursToday: appState.hoursToday(now: now),
                                           dayPct: dayPct)
                            NewMessagesCard(senders: unreadBySender) {
                                withAnimation(.easeInOut(duration: 0.22)) { appNav.selected = .chat }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 14)

                        // Live shift status (clocked in / lunch / break + elapsed).
                        ClockStatusCard(status: appState.myShiftStatus,
                                        liveHours: appState.liveShiftHours(now: now))
                            .padding(.horizontal, 16)
                            .padding(.top, 14)

                        // Suggested job for the day.
                        TSectionTitle(title: "Suggested for today")
                        if let s = suggested {
                            SuggestedJobCard(task: s, isActive: isActive(s), onJump: jumpToJobs)
                                .padding(.horizontal, 16)
                                .padding(.bottom, 28)
                        } else {
                            HomeEmpty(text: "Nothing scheduled for today.")
                                .padding(.horizontal, 16)
                                .padding(.bottom, 28)
                        }
                    }
                    .padding(.top, 4)
                }
                .scrollIndicators(.visible)
                .topFadeMask()
                .refreshable { await reload() }
            }
            .onReceive(ticker) { now = $0 }
            // Home is the landing tab; pull the pay-clock entries + settings the
            // hero needs (jobs/people come from the app-level loadAll).
            .task {
                appState.foregroundSync()   // pull the latest jobs/people on open
                await appState.refreshTimeclock(personId: appState.currentPersonId)
                await appState.refreshOrgSettings()
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

    private var initials: String {
        let parts = (appState.currentPerson?.name ?? "—")
            .split(separator: " ")
            .prefix(2)
            .map { String($0.prefix(1)).uppercased() }
        return parts.joined()
    }

    /// Unread messages grouped by sender (person name + count), most first.
    /// Mirrors AppState.totalUnreadMessages but keeps the per-author breakdown.
    private var unreadBySender: [(id: String, name: String, count: Int)] {
        guard let myId = appState.currentPersonId else { return [] }
        var counts: [String: (name: String, count: Int)] = [:]
        for (key, msgs) in Dictionary(grouping: appState.messages, by: { $0.threadKey }) {
            let readAt = appState.threadReadAt[key].flatMap { Date.fromFlexibleISO8601($0) } ?? .distantPast
            for m in msgs where m.authorId != myId {
                if (Date.fromFlexibleISO8601(m.timestamp) ?? .distantPast) > readAt {
                    let prev = counts[m.authorId]
                    counts[m.authorId] = (name: m.authorName, count: (prev?.count ?? 0) + 1)
                }
            }
        }
        return counts.map { (id: $0.key, name: $0.value.name, count: $0.value.count) }
            .sorted { $0.count > $1.count }
    }

    private var today: [TaskAssignment] { appState.todayTasks(now: now) }

    /// Active job if clocked in, else the next "up next" task today, else the first.
    private var suggested: TaskAssignment? {
        appState.activeTaskAssignment
            ?? today.first(where: { $0.status == .notStarted })
            ?? today.first
    }

    private func isActive(_ task: TaskAssignment) -> Bool {
        appState.myActiveJobClock != nil && appState.activeTaskAssignment?.id == task.id
    }

    /// Today's hours toward the daily target (drives the ring).
    private var dayPct: Double {
        let hpd = appState.orgSettings.hpd
        guard hpd > 0 else { return 0 }
        return min(100, appState.hoursToday(now: now) / hpd * 100)
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

// MARK: - Today's date + week strip

private struct TodayDateCard: View {
    let now: Date

    private var weekDays: [Date] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        let weekday = cal.component(.weekday, from: today)   // 1 = Sun … 7 = Sat
        let start = cal.date(byAdding: .day, value: -(weekday - 1), to: today) ?? today
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }

    private var dateLine: String {
        let f = DateFormatter(); f.dateFormat = "MMMM d, yyyy"
        return f.string(from: now).uppercased()
    }

    private func dow(_ d: Date) -> String {
        ["S", "M", "T", "W", "T", "F", "S"][Calendar.current.component(.weekday, from: d) - 1]
    }
    private func dayNum(_ d: Date) -> String {
        String(Calendar.current.component(.day, from: d))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("TODAY'S DATE")
                    .font(TTypo.xsBold(11))
                    .tLabel(tracking: 1.4)
                    .foregroundStyle(Color(hex: T.muted))
                Text(dateLine)
                    .font(.custom(TFontName.bold.rawValue, size: 22))
                    .foregroundStyle(Color(hex: T.ink))
            }

            HStack(spacing: 6) {
                ForEach(weekDays, id: \.self) { d in
                    let isToday = Calendar.current.isDate(d, inSameDayAs: now)
                    VStack(spacing: 5) {
                        Text(dow(d))
                            .font(TTypo.xsBold(10))
                            .tLabel(tracking: 0.5)
                            .foregroundStyle(isToday ? T.onGradient : Color(hex: T.muted))
                        Text(dayNum(d))
                            .font(TTypo.smBold(14))
                            .foregroundStyle(isToday ? T.onGradient : Color(hex: T.ink))
                            .tnum()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background {
                        if isToday {
                            RoundedRectangle(cornerRadius: T.cornerSm, style: .continuous)
                                .fill(T.brandGradient(start: .top, end: .bottom))
                                .shadow(color: Color(hex: T.ctaGlowColor).opacity(0.35),
                                        radius: 8, x: 0, y: 3)
                        }
                    }
                }
            }
        }
        .padding(16)
        .frostedCard()
    }
}

// MARK: - Hours today hero

private struct HoursTodayHero: View {
    let hoursToday: Double
    let dayPct: Double

    var body: some View {
        VStack(spacing: 10) {
            Text("Today's hours")
                .font(.custom(TFontName.bold.rawValue, size: 15))
                .foregroundStyle(Color(hex: T.ink))
                .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
            ZStack {
                GradientRing(pct: dayPct, lineWidth: 10)
                    .frame(width: 96, height: 96)
                VStack(spacing: 0) {
                    Text(String(format: "%.1f", hoursToday))
                        .font(.custom(TFontName.bold.rawValue, size: 28))
                        .foregroundStyle(Color(hex: T.ink))
                        .tnum()
                    Text("h today")
                        .font(TTypo.xs(10))
                        .foregroundStyle(Color(hex: T.muted))
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(16)
        .frostedCard()
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - New messages hero (square, right of Today's hours)

private struct NewMessagesCard: View {
    let senders: [(id: String, name: String, count: Int)]
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Messages")
                    .font(.custom(TFontName.bold.rawValue, size: 15))
                    .foregroundStyle(Color(hex: T.ink))
                    .frame(maxWidth: .infinity, alignment: .center)

                if senders.isEmpty {
                    Spacer(minLength: 0)
                    HStack(spacing: 7) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Color(hex: T.green))
                        Text("No new messages!")
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .frame(maxWidth: .infinity)
                    Spacer(minLength: 0)
                } else {
                    // One small tab per person with unread messages: name + count.
                    VStack(spacing: 6) {
                        ForEach(senders.prefix(3), id: \.id) { s in
                            HStack(spacing: 6) {
                                Text(s.name)
                                    .font(TTypo.sm(13))
                                    .foregroundStyle(Color(hex: T.ink))
                                    .lineLimit(1)
                                Spacer(minLength: 4)
                                Text("\(s.count)")
                                    .font(.custom(TFontName.bold.rawValue, size: 12))
                                    .foregroundStyle(T.onGradient)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(T.brandGradient()))
                            }
                        }
                        if senders.count > 3 {
                            Text("+\(senders.count - 3) more")
                                .font(TTypo.xs(11))
                                .foregroundStyle(Color(hex: T.muted))
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(16)
            .frostedCard()
            .aspectRatio(1, contentMode: .fit)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Live shift status

private struct ClockStatusCard: View {
    let status: ShiftStatus
    let liveHours: Double

    private var elapsed: String {
        let secs = max(0, Int(liveHours * 3600))
        return String(format: "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    var body: some View {
        HStack(spacing: 12) {
            IconChip(icon: .hours,
                     color: Color(hex: status == .offline ? T.muted : T.accentGradientStart))
            VStack(alignment: .leading, spacing: 4) {
                Text(status == .offline ? "Not clocked in" : "This shift")
                    .font(TTypo.smBold(14))
                    .foregroundStyle(Color(hex: T.ink))
                HStack(spacing: 8) {
                    TagPill(label: status.label, kind: status.kind, dot: status.dot)
                    if status != .offline {
                        Text(elapsed)
                            .font(TTypo.monoBold(13))
                            .foregroundStyle(Color(hex: T.ink))
                            .tnum()
                    }
                }
            }
            Spacer(minLength: 8)
        }
        .padding(14)
        .frostedCard()
    }
}

// MARK: - Suggested job card

private struct SuggestedJobCard: View {
    let task: TaskAssignment
    let isActive: Bool
    let onJump: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                TagPill(label: task.title.uppercased(), kind: .indigo)
                TagPill(label: isActive ? "Active" : "Up next",
                        kind: isActive ? .indigo : .green, dot: isActive)
                Spacer(minLength: 0)
            }
            Text(task.job.title.isEmpty ? task.title : task.job.title)
                .font(.custom(TFontName.bold.rawValue, size: 20))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
            GradientCTA(verticalPadding: 12, action: onJump) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.forward")
                    Text(isActive ? "Go to your job" : "Jump to job")
                        .font(TTypo.smBold(14))
                }
            }
        }
        .padding(16)
        .frostedCard()
    }
}

private struct HomeEmpty: View {
    let text: String
    var body: some View {
        Text(text)
            .font(TTypo.sm(13))
            .foregroundStyle(Color(hex: T.muted))
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 22)
            .frostedCard(radius: T.cornerMd)
    }
}
