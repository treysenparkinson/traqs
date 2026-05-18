import SwiftUI
import Combine

// MARK: - Root

struct TimeClockView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()
            VStack(spacing: 0) {
                TimeClockHeader()
                if appState.isAdmin {
                    AdminTimeClockView()
                } else {
                    WorkerTimeClockView()
                }
            }
        }
    }
}

private struct TimeClockHeader: View {
    var body: some View {
        TRAQSNavHeader(tabName: "Time Clock")
    }
}

// MARK: - Worker

private struct WorkerTimeClockView: View {
    @Environment(AppState.self) private var appState
    @State private var showJobPicker = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                PayrollStatusCard(clockIn: appState.currentPerson?.activeClockIn)
                    .padding(.top, 20)

                JobTimeSection(showJobPicker: $showJobPicker)

                Spacer(minLength: 24)
            }
            .padding(.horizontal, 16)
        }
        .refreshable { await appState.loadAll() }
        .sheet(isPresented: $showJobPicker) {
            JobPickerSheet(isPresented: $showJobPicker)
        }
    }
}

// MARK: - Payroll Status Card (read-only)

private struct PayrollStatusCard: View {
    let clockIn: ActiveClockIn?
    @State private var now = Date()
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var elapsedLabel: String {
        guard let iso = clockIn?.clockIn,
              let start = ISO8601DateFormatter().date(from: iso) else { return "—" }
        let secs = max(0, Int(now.timeIntervalSince(start)))
        let h = secs / 3600
        let m = (secs % 3600) / 60
        let s = secs % 60
        return String(format: "%d:%02d:%02d", h, m, s)
    }

    private var startedAt: String? {
        guard let iso = clockIn?.clockIn,
              let d = ISO8601DateFormatter().date(from: iso) else { return nil }
        let f = DateFormatter(); f.dateFormat = "h:mm a"
        return f.string(from: d)
    }

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                Circle()
                    .fill(clockIn != nil ? Color(hex: T.statusFinished) : Color(hex: T.muted))
                    .frame(width: 8, height: 8)
                Text(clockIn != nil ? "Clocked In" : "Not Clocked In")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: T.muted))
                    .kerning(0.6)
                    .textCase(.uppercase)
                Spacer()
            }

            if clockIn != nil {
                Text(elapsedLabel)
                    .font(.system(size: 48, weight: .bold, design: .monospaced))
                    .foregroundColor(Color(hex: T.text))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentTransition(.numericText())

                if let s = startedAt {
                    HStack(spacing: 6) {
                        Image(systemName: "clock")
                            .font(.system(size: 11))
                            .foregroundColor(Color(hex: T.muted))
                        Text("Started \(s)")
                            .font(.system(size: 12))
                            .foregroundColor(Color(hex: T.muted))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "desktopcomputer")
                        .foregroundColor(Color(hex: T.muted))
                    Text("Clock in from the desktop")
                        .font(.subheadline)
                        .foregroundColor(Color(hex: T.muted))
                    Spacer()
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(hex: T.card))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(hex: T.border), lineWidth: 1)
        )
        .onReceive(timer) { now = $0 }
    }
}

// MARK: - Job Time Section

private struct JobTimeSection: View {
    @Environment(AppState.self) private var appState
    @Binding var showJobPicker: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text("Job Time")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Color(hex: T.muted))
                    .kerning(0.8)
                    .textCase(.uppercase)
                Spacer()
            }
            .padding(.horizontal, 4)

            if let jc = appState.myActiveJobClock {
                ActiveJobClockCard(jobClock: jc)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.96)),
                                            removal: .opacity))
            } else {
                NotOnJobCard(showJobPicker: $showJobPicker)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.96)),
                                            removal: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.22), value: appState.myActiveJobClock)
    }
}

// MARK: - Active Job Clock Card

private struct ActiveJobClockCard: View {
    @Environment(AppState.self) private var appState
    let jobClock: ActiveJobClock

    @State private var now = Date()
    @State private var working = false
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var elapsedLabel: String {
        guard let start = ISO8601DateFormatter().date(from: jobClock.clockIn) else { return "—" }
        var ms = now.timeIntervalSince(start) * 1000
        ms -= (jobClock.totalPausedMs ?? 0)
        if let pAt = jobClock.pausedAt, let pStart = ISO8601DateFormatter().date(from: pAt) {
            ms -= now.timeIntervalSince(pStart) * 1000
        }
        let secs = max(0, Int(ms / 1000))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        return String(format: "%d:%02d:%02d", h, m, s)
    }

    private var titleLine: String {
        jobClock.jobTitle ?? "Job"
    }

    private var subtitleLine: String? {
        var parts: [String] = []
        if let p = jobClock.panelTitle, !p.isEmpty { parts.append(p) }
        if let o = jobClock.opTitle, !o.isEmpty { parts.append(o) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Circle()
                    .fill(jobClock.isPaused ? Color(hex: T.statusOnHold) : Color(hex: T.accent))
                    .frame(width: 8, height: 8)
                Text(jobClock.isPaused ? "Paused" : "Working")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(jobClock.isPaused ? Color(hex: T.statusOnHold) : Color(hex: T.accent))
                    .kerning(0.6)
                    .textCase(.uppercase)
                Spacer()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(titleLine)
                    .font(.headline)
                    .foregroundColor(Color(hex: T.text))
                    .lineLimit(2)
                if let sub = subtitleLine {
                    Text(sub)
                        .font(.subheadline)
                        .foregroundColor(Color(hex: T.muted))
                        .lineLimit(2)
                }
            }

            Text(elapsedLabel)
                .font(.system(size: 42, weight: .bold, design: .monospaced))
                .foregroundColor(Color(hex: T.text))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentTransition(.numericText())

            HStack(spacing: 10) {
                Button {
                    Task {
                        working = true
                        if jobClock.isPaused { await appState.jobResume() }
                        else { await appState.jobPause() }
                        working = false
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: jobClock.isPaused ? "play.fill" : "pause.fill")
                        Text(jobClock.isPaused ? "Resume" : "Pause")
                    }
                    .font(.subheadline.bold())
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Color(hex: T.accent).opacity(0.14))
                    .foregroundColor(Color(hex: T.accent))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10)
                        .stroke(Color(hex: T.accent).opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(working)

                Button {
                    Task {
                        working = true
                        await appState.jobClockOut()
                        working = false
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "stop.fill")
                        Text("Clock Out")
                    }
                    .font(.subheadline.bold())
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Color(hex: T.danger).opacity(0.14))
                    .foregroundColor(Color(hex: T.danger))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10)
                        .stroke(Color(hex: T.danger).opacity(0.35), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(working)
            }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: T.card)))
        .overlay(RoundedRectangle(cornerRadius: 16)
            .stroke(Color(hex: T.accent).opacity(0.35), lineWidth: 1))
        .onReceive(timer) { now = $0 }
    }
}

// MARK: - Not On Job Card

private struct NotOnJobCard: View {
    @Binding var showJobPicker: Bool

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "briefcase")
                .font(.system(size: 32, weight: .light))
                .foregroundColor(Color(hex: T.muted))
            Text("Not working a job")
                .font(.subheadline)
                .foregroundColor(Color(hex: T.muted))

            Button {
                withAnimation { showJobPicker = true }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "play.fill")
                    Text("Clock Into Job")
                }
                .font(.subheadline.bold())
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Color(hex: T.accent))
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: T.card)))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: T.border), lineWidth: 1))
    }
}

// MARK: - Job Picker Sheet

private struct JobPickerSheet: View {
    @Environment(AppState.self) private var appState
    @Binding var isPresented: Bool

    @State private var selectedJob: Job?
    @State private var selectedPanel: Panel?
    @State private var working = false

    private var myJobs: [Job] {
        guard let me = appState.currentPersonId else { return [] }
        return appState.jobs
            .filter { job in
                job.status != .finished &&
                (job.team.contains(me) ||
                 job.subs.contains { p in p.team.contains(me) || p.subs.contains { $0.team.contains(me) } })
            }
            .sorted { ($0.jobNumber ?? "") < ($1.jobNumber ?? "") }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()
                if let job = selectedJob {
                    if let panel = selectedPanel {
                        OpListView(job: job, panel: panel, working: $working) { op in
                            startClock(job: job, panel: panel, op: op)
                        }
                    } else {
                        PanelListView(job: job, working: $working,
                                      onPanel: { selectedPanel = $0 },
                                      onJobOnly: { startClock(job: job, panel: nil, op: nil) })
                    }
                } else {
                    JobListView(jobs: myJobs, onPick: { selectedJob = $0 })
                }
            }
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                if selectedJob != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            if selectedPanel != nil { selectedPanel = nil }
                            else { selectedJob = nil }
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                    }
                }
            }
        }
    }

    private var navTitle: String {
        if let p = selectedPanel { return p.title }
        if let j = selectedJob { return j.title }
        return "Pick a Job"
    }

    private func startClock(job: Job, panel: Panel?, op: Operation?) {
        guard !working else { return }
        working = true
        Task {
            await appState.jobClockIn(
                jobId: job.id,
                panelId: panel?.id,
                opId: op?.id,
                jobTitle: job.title,
                panelTitle: panel?.title,
                opTitle: op?.title
            )
            working = false
            isPresented = false
        }
    }
}

private struct JobListView: View {
    let jobs: [Job]
    let onPick: (Job) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                if jobs.isEmpty {
                    EmptyState(icon: "tray", text: "No active jobs assigned to you")
                        .padding(.top, 80)
                } else {
                    ForEach(jobs) { job in
                        PickerRow(
                            color: Color(hex: job.color),
                            title: job.title,
                            subtitle: job.displayNumber.isEmpty ? nil : job.displayNumber,
                            trailing: "chevron.right",
                            action: { onPick(job) }
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }
}

private struct PanelListView: View {
    let job: Job
    @Binding var working: Bool
    let onPanel: (Panel) -> Void
    let onJobOnly: () -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                Button {
                    onJobOnly()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "play.fill")
                            .foregroundColor(Color(hex: T.accent))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Clock into entire job")
                                .font(.subheadline.bold())
                                .foregroundColor(Color(hex: T.text))
                            Text("No specific panel or operation")
                                .font(.caption)
                                .foregroundColor(Color(hex: T.muted))
                        }
                        Spacer()
                    }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: T.accent).opacity(0.08)))
                    .overlay(RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(working)

                if !job.subs.isEmpty {
                    Text("Or pick a panel")
                        .font(.caption)
                        .foregroundColor(Color(hex: T.muted))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 10)
                        .padding(.horizontal, 4)
                }

                ForEach(job.subs) { panel in
                    PickerRow(
                        color: Color(hex: T.statusInProgress),
                        title: panel.title,
                        subtitle: panel.subs.isEmpty ? "No operations" : "\(panel.subs.count) operation\(panel.subs.count == 1 ? "" : "s")",
                        trailing: "chevron.right",
                        action: { onPanel(panel) }
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }
}

private struct OpListView: View {
    let job: Job
    let panel: Panel
    @Binding var working: Bool
    let onPick: (Operation) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                if panel.subs.isEmpty {
                    EmptyState(icon: "tray", text: "No operations in this panel")
                        .padding(.top, 60)
                } else {
                    ForEach(panel.subs) { op in
                        PickerRow(
                            color: Color(hex: op.status == .inProgress ? T.statusInProgress : T.muted),
                            title: op.title,
                            subtitle: op.status.rawValue,
                            trailing: "play.fill",
                            action: { onPick(op) }
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }
}

private struct PickerRow: View {
    let color: Color
    let title: String
    let subtitle: String?
    let trailing: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Circle().fill(color).frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.bold())
                        .foregroundColor(Color(hex: T.text))
                        .lineLimit(1)
                    if let s = subtitle {
                        Text(s)
                            .font(.caption)
                            .foregroundColor(Color(hex: T.muted))
                            .lineLimit(1)
                    }
                }
                Spacer()
                Image(systemName: trailing)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(hex: T.muted))
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: T.card)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct EmptyState: View {
    let icon: String
    let text: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 40, weight: .light))
                .foregroundColor(Color(hex: T.border))
            Text(text)
                .font(.subheadline)
                .foregroundColor(Color(hex: T.muted))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Admin View (read-only payroll, team summary)

private struct AdminTimeClockView: View {
    @Environment(AppState.self) private var appState
    @State private var showOnlyActive = false
    @State private var showJobPicker = false

    private var clockedInCount: Int {
        appState.people.filter { $0.activeClockIn != nil }.count
    }

    private var onJobCount: Int {
        appState.people.filter { $0.activeJobClock != nil }.count
    }

    private var displayPeople: [Person] {
        let filtered = showOnlyActive
            ? appState.people.filter { $0.activeClockIn != nil || $0.activeJobClock != nil }
            : appState.people
        return filtered.sorted { $0.name < $1.name }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                PayrollStatusCard(clockIn: appState.currentPerson?.activeClockIn)
                    .padding(.top, 16)

                JobTimeSection(showJobPicker: $showJobPicker)

                // Team summary
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Team")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(hex: T.muted))
                            .kerning(0.8)
                            .textCase(.uppercase)
                        Spacer()
                        Picker("", selection: $showOnlyActive) {
                            Text("All").tag(false)
                            Text("Active").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 140)
                    }
                    .padding(.horizontal, 4)

                    HStack(spacing: 10) {
                        StatPill(icon: "checkmark.circle.fill",
                                 color: Color(hex: T.statusFinished),
                                 label: "\(clockedInCount) clocked in")
                        StatPill(icon: "briefcase.fill",
                                 color: Color(hex: T.accent),
                                 label: "\(onJobCount) on a job")
                    }

                    LazyVStack(spacing: 8) {
                        if displayPeople.isEmpty {
                            EmptyState(icon: "person.slash", text: "Nobody active")
                                .padding(.top, 40)
                        } else {
                            ForEach(displayPeople) { person in
                                PersonClockRow(person: person)
                            }
                        }
                    }
                }

                Spacer(minLength: 24)
            }
            .padding(.horizontal, 16)
        }
        .refreshable { await appState.loadAll() }
        .sheet(isPresented: $showJobPicker) {
            JobPickerSheet(isPresented: $showJobPicker)
        }
    }
}

private struct StatPill: View {
    let icon: String
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).foregroundColor(color)
            Text(label)
                .font(.caption.bold())
                .foregroundColor(Color(hex: T.text))
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Capsule().fill(color.opacity(0.12)))
        .overlay(Capsule().stroke(color.opacity(0.3), lineWidth: 1))
    }
}

private struct PersonClockRow: View {
    let person: Person
    @State private var now = Date()
    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    private var clockedInElapsed: String? {
        guard let iso = person.activeClockIn?.clockIn,
              let d = ISO8601DateFormatter().date(from: iso) else { return nil }
        let mins = Int(now.timeIntervalSince(d)) / 60
        let h = mins / 60, m = mins % 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(hex: person.color))
                .frame(width: 38, height: 38)
                .overlay(Text(String(person.name.prefix(1)).uppercased())
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white))

            VStack(alignment: .leading, spacing: 4) {
                Text(person.name)
                    .font(.subheadline.bold())
                    .foregroundColor(Color(hex: T.text))

                HStack(spacing: 6) {
                    if person.activeClockIn != nil {
                        Circle().fill(Color(hex: T.statusFinished)).frame(width: 6, height: 6)
                        Text(clockedInElapsed ?? "—")
                            .font(.caption.bold())
                            .foregroundColor(Color(hex: T.statusFinished))
                    }
                    if let jc = person.activeJobClock {
                        if person.activeClockIn != nil {
                            Text("·").foregroundColor(Color(hex: T.muted))
                        }
                        Image(systemName: jc.isPaused ? "pause.fill" : "briefcase.fill")
                            .font(.caption2)
                            .foregroundColor(Color(hex: T.accent))
                        Text(jc.jobTitle ?? "Job")
                            .font(.caption)
                            .foregroundColor(Color(hex: T.muted))
                            .lineLimit(1)
                    }
                    if person.activeClockIn == nil && person.activeJobClock == nil {
                        Text("Off the clock")
                            .font(.caption)
                            .foregroundColor(Color(hex: T.muted))
                    }
                }
            }
            Spacer()
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: T.card)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(
            (person.activeClockIn != nil || person.activeJobClock != nil)
                ? Color(hex: T.statusFinished).opacity(0.3)
                : Color(hex: T.border),
            lineWidth: 1))
        .onReceive(timer) { now = $0 }
    }
}

// MARK: - Legacy PIN entry (kept for kiosk re-auth flows that may still be invoked)

struct PINEntryView: View {
    @Environment(AppState.self) private var appState
    let title: String
    @Binding var pinDigits: String
    let onIdentified: () -> Void

    private let columns = Array(repeating: GridItem(.flexible()), count: 3)
    private let digits = ["1","2","3","4","5","6","7","8","9","Clear","0","Enter"]

    private var maskedDisplay: String {
        guard !pinDigits.isEmpty else { return " " }
        return (0..<pinDigits.count).map { _ in "●" }.joined(separator: "  ")
    }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()
            VStack(spacing: 28) {
                Spacer()
                Text(maskedDisplay)
                    .font(.system(size: 30, weight: .bold, design: .monospaced))
                    .foregroundColor(Color(hex: T.text))
                    .frame(height: 44)

                if let err = appState.clockError {
                    Text(err).font(.caption).foregroundColor(Color(hex: T.danger))
                        .multilineTextAlignment(.center).padding(.horizontal, 32)
                }

                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(digits, id: \.self) { digit in
                        NumpadButton(label: digit) { handleTap(digit) }
                    }
                }
                .padding(.horizontal, 48)
                Spacer()
            }
            .overlay {
                if appState.isClockingIn {
                    Color.black.opacity(0.35).ignoresSafeArea()
                    ProgressView().tint(Color(hex: T.accent)).scaleEffect(1.5)
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func handleTap(_ label: String) {
        switch label {
        case "Clear":
            pinDigits = ""; appState.clockError = nil
        case "Enter":
            guard pinDigits.count >= 4 else { return }
            Task {
                await appState.timeclockIdentify(pin: pinDigits)
                if appState.clockedInPersonId != nil { onIdentified() }
            }
        default:
            if pinDigits.count < 10 { pinDigits += label; appState.clockError = nil }
        }
    }
}

struct NumpadButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label).font(.title2.bold()).frame(maxWidth: .infinity).frame(height: 58)
                .background(Color(hex: T.card))
                .foregroundColor(
                    label == "Clear" ? Color(hex: T.danger) :
                    label == "Enter" ? Color(hex: T.accent) :
                    Color(hex: T.text))
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
