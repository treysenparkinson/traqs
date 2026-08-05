import SwiftUI
import Combine

// MARK: - Home (the default landing tab)
// A "good morning" page: a big greeting, today's clocked-in hours, live shift
// status, and a suggested job with a "Jump to job" button that switches to the
// Jobs tab (where the timer lives). Home never starts/logs time itself.

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Environment(AppNav.self) private var appNav

    var body: some View {
        ZStack {
            PageBackground()

            VStack(spacing: 0) {
                TRAQSNavHeader {
                    // Account controls (top-right): Admin · Settings · Profile.
                    HomeHeaderControls()
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {

                        // Page title — personal greeting, same muted
                        // faded-to-transparent style as every other tab.
                        PageTitle(title: greeting)
                            .padding(.top, pageTitleTopInset)
                            .padding(.bottom, 10)

                        // Today's date + this week (today highlighted). Only has
                        // to change at midnight, so it ticks once a minute.
                        LiveClock(every: 60, tab: .home) { now in
                            TodayDateCard(now: now)
                        }
                        .padding(.horizontal, 16)

                        // Live shift status + new messages — two square cards side
                        // by side. The shift card took over the slot Today's hours
                        // used to hold; the full-width status bar that used to sit
                        // under this row is gone, since it said the same thing.
                        // Today's hours still lives on the Time Clock page.
                        HStack(spacing: 12) {
                            LiveClock(every: 1, tab: .home) { now in
                                ShiftStatusHero(status: appState.myShiftStatus,
                                                liveHours: appState.liveShiftHours(now: now)) {
                                    withAnimation(.easeInOut(duration: 0.22)) { appNav.selected = .hours }
                                }
                            }
                            NewMessagesCard(senders: unreadBySender) {
                                withAnimation(.easeInOut(duration: 0.22)) { appNav.selected = .chat }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 14)

                        // Today's job. The section header above this is gone — the
                        // card titles itself, matching the two square cards above.
                        if let s = suggested {
                            SuggestedJobCard(task: s, isActive: isActive(s), onJump: jumpToJobs)
                                .padding(.horizontal, 16)
                                .padding(.top, 14)
                                .padding(.bottom, 28)
                        } else {
                            HomeEmpty(text: "Nothing scheduled for today.")
                                .padding(.horizontal, 16)
                                .padding(.top, 14)
                                .padding(.bottom, 28)
                        }
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

    /// Active job if clocked in, else the next "up next" task today, else the first.
    private var suggested: TaskAssignment? {
        appState.activeTaskAssignment
            ?? today.first(where: { $0.status == .notStarted })
            ?? today.first
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
        let f = DateFormatter.display("MMMM d, yyyy")
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
            // No "TODAY'S DATE" label above this — the date and the week strip
            // under it say what the card is. Leading-aligned like every other
            // card's heading, set by an explicit frame rather than the VStack's
            // alignment so the week strip below is unaffected either way.
            Text(dateLine)
                .font(.custom(TFontName.bold.rawValue, size: 22))
                .foregroundStyle(Color(hex: T.ink))
                .frame(maxWidth: .infinity, alignment: .leading)

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

// MARK: - Live shift hero (square, left of Messages)

// Replaces the old Today's-hours ring in this slot AND the full-width status bar
// that used to sit below it: same square footprint, but the live elapsed timer
// is the hero and the status pill sits under it.
private struct ShiftStatusHero: View {
    let status: ShiftStatus
    let liveHours: Double
    /// Taps jump to the Time Clock tab, where the shift can actually be acted on.
    let onOpen: () -> Void

    private var elapsed: String {
        let secs = max(0, Int(liveHours * 3600))
        return String(format: "%d:%02d:%02d", secs / 3600, (secs % 3600) / 60, secs % 60)
    }

    var body: some View {
        Button(action: onOpen) {
            VStack(spacing: 10) {
                // Title sits at the box's leading edge like every other card's.
                // The clock and pill below stay centred — that's the VStack's own
                // alignment, which this frame deliberately overrides only here.
                Text("This shift")
                    .font(.custom(TFontName.bold.rawValue, size: 15))
                    .foregroundStyle(Color(hex: T.ink))
                    .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 0)

                // The running clock — the whole point of the card, so it carries
                // the space the icon chip used to take. Placeholder dashes when
                // off the clock keep the card the same height whether or not a
                // shift is open.
                Text(status == .offline ? "--:--:--" : elapsed)
                    .font(TTypo.monoBold(30))
                    .foregroundStyle(Color(hex: status == .offline ? T.muted : T.ink))
                    .tnum()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                TagPill(label: status.label, kind: status.kind, dot: status.dot)

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(16)
            .frostedCard()
            .aspectRatio(1, contentMode: .fit)
        }
        .buttonStyle(.plain)
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
                    .frame(maxWidth: .infinity, alignment: .leading)

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

// MARK: - Suggested job card

private struct SuggestedJobCard: View {
    let task: TaskAssignment
    let isActive: Bool
    let onJump: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            // Task pills and job name both start at the leading edge, matching the
            // other Home cards. The CTA below stays full-width.
            HStack(spacing: 8) {
                TagPill(label: task.title.uppercased(), kind: .indigo)
                TagPill(label: isActive ? "Active" : "Up next",
                        kind: isActive ? .indigo : .green, dot: isActive)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(task.job.title.isEmpty ? task.title : task.job.title)
                .font(.custom(TFontName.bold.rawValue, size: 20))
                .foregroundStyle(Color(hex: T.ink))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

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
