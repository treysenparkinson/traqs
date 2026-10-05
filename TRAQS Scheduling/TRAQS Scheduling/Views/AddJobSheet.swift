import SwiftUI

/// The Jobs header's "+": a simple task — name, who's on it, and when.
///
/// One day → pick the start and end time. More than one day → no times; each
/// working day is a full productive day for everyone on it (see
/// `SimpleJob.totalHours`). The job it writes is the web's
/// simple-job shape, so the desktop schedules and draws it the same way — see
/// `SimpleJob`.
struct AddJobSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var team: [String] = []
    // Instants, read in the shop's zone by the pickers and by ymd — see GanttView.selectedDate.
    @State private var startDate = Date()
    @State private var endDate = Date()
    /// Only the time-of-day is read from these two.
    @State private var startTime = Date()
    @State private var endTime = Date()
    @State private var showTeamPicker = false
    /// On: one date and a start/end time. Off: start and end dates, full days.
    @State private var oneDay = true
    @FocusState private var titleFocused: Bool

    private var day: DayWindow { WorkDayClock.day(from: appState.orgSettings) }

    private var isOneDay: Bool { oneDay }

    private var draft: SimpleJob.Draft {
        SimpleJob.Draft(title: title, team: team,
                        start: AppState.ymd(startDate, in: ShopTime.current.zone),
                        end: AppState.ymd(isOneDay ? startDate : endDate, in: ShopTime.current.zone),
                        startHour: Self.hour(of: startTime),
                        endHour: Self.hour(of: endTime),
                        fullDays: !oneDay)
    }

    private var valid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !team.isEmpty
            && (!isOneDay || draft.endHour > draft.startHour)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("e.g. Cabinet install", text: $title)
                        .focused($titleFocused)
                        .submitLabel(.done)
                }

                Section("Who's on it") {
                    Button { showTeamPicker = true } label: {
                        HStack {
                            TeamSummary(ids: team)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }

                Section("Dates") {
                    Toggle("One day", isOn: $oneDay.animation(.easeInOut(duration: 0.2)))
                    if oneDay {
                        DatePicker("Date", selection: $startDate, displayedComponents: .date)
                    } else {
                        DatePicker("Start", selection: $startDate, displayedComponents: .date)
                        DatePicker("End", selection: $endDate, in: startDate..., displayedComponents: .date)
                    }
                }

                if isOneDay {
                    Section("Time") {
                        DatePicker("Start", selection: $startTime, displayedComponents: .hourAndMinute)
                        DatePicker("End", selection: $endTime, displayedComponents: .hourAndMinute)
                    }
                }
            }
            // Days and times are the shop's: the pickers show its clock, so 08:00 here is the
            // 08:00 the schedule draws, wherever the phone is.
            .environment(\.timeZone, ShopTime.current.zone)
            .navigationTitle("New Job")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add() }
                        .disabled(!valid)
                }
            }
            .sheet(isPresented: $showTeamPicker) {
                TeamPicker(title: "Who's on it", initial: team) { picked in
                    // Keep the roster's order rather than the Set's.
                    team = appState.people.map(\.id).filter(picked.contains)
                }
            }
            .onChange(of: startDate) { _, new in
                if endDate < new { endDate = new }
            }
            .onChange(of: oneDay) { _, on in
                // Off means a run of days, so offer one: end the day after.
                if !on, !(endDate > startDate) {
                    endDate = ShopTime.current.calendar.date(byAdding: .day, value: 1, to: startDate) ?? startDate
                }
            }
            .onAppear {
                // The web's defaults: start of the working day, eight hours on
                // (or the end of the day, whichever comes first).
                let s = appState.orgSettings.workStartHour
                startTime = Self.time(s)
                endTime = Self.time(min(appState.orgSettings.workEndHour, s + 8))
                titleFocused = true
            }
        }
    }

    private func add() {
        guard valid else { return }
        let job = SimpleJob.makeJob(draft, day: day,
                                    calendar: WorkCalendar(workDays: appState.orgSettings.workDays,
                                                           holidays: appState.orgSettings.holidays),
                                    color: JobColors.next(),
                                    createdBy: appState.currentPersonId)
        // No client-side notify, same as the web's simple job: tasks.js pushes
        // "assigned" server-side when it sees the new team.
        appState.updateJob(job)
        dismiss()
    }

    // MARK: - Time ↔ hours

    /// 1:30pm → 13.5.
    private static func hour(of date: Date) -> Double {
        let c = ShopTime.current.calendar.dateComponents([.hour, .minute], from: date)
        return Double(c.hour ?? 0) + Double(c.minute ?? 0) / 60
    }

    /// 13.5 → today at 1:30pm.
    private static func time(_ hour: Double) -> Date {
        let minutes = Int((hour * 60).rounded())
        return ShopTime.current.calendar.date(bySettingHour: minutes / 60, minute: minutes % 60,
                                     second: 0, of: Date()) ?? Date()
    }
}
