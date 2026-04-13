import SwiftUI
import Combine

// MARK: - Root

struct TimeClockView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    VStack(spacing: 2) {
                        TRAQSNavLogo()
                        Text("Time Clock")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(Color(hex: T.muted))
                            .kerning(0.8)
                            .textCase(.uppercase)
                    }
                    Spacer()
                }
                .padding(.top, 20)
                .padding(.bottom, 14)
                .background(Color(hex: T.surface))

                Rectangle().fill(Color(hex: T.border)).frame(height: 1)

                if appState.isAdmin {
                    AdminTimeClockView()
                } else {
                    WorkerTimeClockView()
                }
            }
        }
    }
}

// MARK: - Worker View

private struct WorkerTimeClockView: View {
    @Environment(AppState.self) private var appState
    @State private var showReauthSheet = false

    // Source of truth: server-synced clock-in for the logged-in user
    private var myClockIn: ActiveClockIn? {
        appState.currentPerson?.activeClockIn
    }

    // Whether we have a PIN session in RAM (can perform actions)
    private var hasSession: Bool {
        appState.clockedInPersonId != nil
    }

    var body: some View {
        Group {
            if let clockIn = myClockIn {
                WorkerClockedView(clockIn: clockIn, hasSession: hasSession) {
                    showReauthSheet = true
                }
            } else {
                NotClockedView()
            }
        }
        .sheet(isPresented: $showReauthSheet) {
            ReauthSheet()
        }
    }
}

// MARK: - Clocked In (Worker)

private struct WorkerClockedView: View {
    @Environment(AppState.self) private var appState
    let clockIn: ActiveClockIn
    let hasSession: Bool
    let onReauth: () -> Void

    @State private var elapsedMinutes = 0
    private let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    // Use local session events (optimistic) when PIN active, else server data
    private var currentEvent: String? {
        let events = (hasSession ? appState.activeClockIn?.events : nil) ?? clockIn.events
        guard let last = events.last else { return nil }
        return ["lunchStart", "breakStart"].contains(last.type) ? last.type : nil
    }

    private var elapsedLabel: String {
        let h = elapsedMinutes / 60; let m = elapsedMinutes % 60
        return h > 0 ? String(format: "%dh %02dm", h, m) : String(format: "%dm", m)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Status header
                VStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 64))
                        .foregroundColor(Color(hex: T.statusFinished))
                    Text("Clocked In")
                        .font(.title.bold())
                        .foregroundColor(Color(hex: T.text))
                    if let name = appState.currentPerson?.name {
                        Text(name)
                            .font(.title3)
                            .foregroundColor(Color(hex: T.muted))
                    }
                    Text(elapsedLabel)
                        .font(.system(size: 42, weight: .bold, design: .monospaced))
                        .foregroundColor(Color(hex: T.accent))
                }
                .padding(.top, 24)

                // Job chips
                if !clockIn.jobRefs.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(clockIn.jobRefs, id: \.jobId) { ref in
                                Text(ref.jobName)
                                    .font(.caption.bold())
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .background(Color(hex: T.accent).opacity(0.12))
                                    .foregroundColor(Color(hex: T.accent))
                                    .cornerRadius(20)
                                    .overlay(Capsule().stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                }

                if hasSession {
                    // Event buttons
                    VStack(spacing: 12) {
                        if currentEvent == nil {
                            HStack(spacing: 12) {
                                tcEventButton("Start Lunch", action: "lunchStart")
                                tcEventButton("Start Break", action: "breakStart")
                            }
                        } else if currentEvent == "lunchStart" {
                            tcEventButton("End Lunch", action: "lunchEnd")
                        } else if currentEvent == "breakStart" {
                            tcEventButton("End Break", action: "breakEnd")
                        }
                    }
                    .padding(.horizontal, 16)

                    Spacer(minLength: 16)

                    Button {
                        Task { await appState.timeclockClockOut() }
                    } label: {
                        Text("Clock Out")
                            .font(.headline).frame(maxWidth: .infinity).padding()
                            .background(Color(hex: T.danger)).foregroundColor(.white)
                            .cornerRadius(12)
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                } else {
                    // No PIN session — need to re-auth to take actions
                    VStack(spacing: 12) {
                        HStack(spacing: 8) {
                            Image(systemName: "lock.fill")
                                .foregroundColor(Color(hex: T.muted))
                            Text("Re-enter your PIN to clock out or log breaks")
                                .font(.subheadline)
                                .foregroundColor(Color(hex: T.muted))
                                .multilineTextAlignment(.leading)
                        }
                        .padding(.horizontal, 24)

                        Button(action: onReauth) {
                            Text("Re-enter PIN")
                                .font(.subheadline.bold()).frame(maxWidth: .infinity).padding()
                                .background(Color(hex: T.accent).opacity(0.12))
                                .foregroundColor(Color(hex: T.accent))
                                .cornerRadius(12)
                                .overlay(RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
        .refreshable { await appState.loadAll() }
        .onReceive(timer) { _ in updateElapsed() }
        .onAppear { updateElapsed() }
    }

    private func updateElapsed() {
        guard let date = ISO8601DateFormatter().date(from: clockIn.clockIn) else { return }
        elapsedMinutes = Int(Date().timeIntervalSince(date)) / 60
    }

    @ViewBuilder
    private func tcEventButton(_ label: String, action: String) -> some View {
        Button {
            Task { await appState.timeclockSendEvent(action: action) }
        } label: {
            Text(label).font(.subheadline.bold()).frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(Color(hex: T.accent).opacity(0.12))
                .foregroundColor(Color(hex: T.accent))
                .cornerRadius(10)
                .overlay(RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 3))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Not Clocked In (Worker)

private struct NotClockedView: View {
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "clock")
                .font(.system(size: 64))
                .foregroundColor(Color(hex: T.border))
            Text("Not Clocked In")
                .font(.title2.bold())
                .foregroundColor(Color(hex: T.text))
            Text("Open the Jobs tab, expand a job, and tap \"Clock Into Job\" to start tracking time.")
                .font(.subheadline)
                .foregroundColor(Color(hex: T.muted))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }
}

// MARK: - Reauth Sheet (PIN re-entry to restore session for clock-out)

private struct ReauthSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var pinDigits = ""

    var body: some View {
        NavigationStack {
            PINEntryView(
                title: "Re-enter PIN",
                pinDigits: $pinDigits,
                onIdentified: { dismiss() }
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        appState.clockError = nil
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Admin View

private struct AdminTimeClockView: View {
    @Environment(AppState.self) private var appState
    @State private var showOnlyActive = false
    @State private var showReauthSheet = false

    private var myClockIn: ActiveClockIn? { appState.currentPerson?.activeClockIn }
    private var hasSession: Bool { appState.clockedInPersonId != nil }

    private var displayPeople: [Person] {
        let filtered = showOnlyActive
            ? appState.people.filter { $0.activeClockIn != nil }
            : appState.people
        return filtered.sorted { $0.name < $1.name }
    }

    private var clockedInCount: Int {
        appState.people.filter { $0.activeClockIn != nil }.count
    }

    var body: some View {
        VStack(spacing: 0) {
            // ── My status strip ──────────────────────────────────────────────
            HStack(spacing: 12) {
                if let ci = myClockIn {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(Color(hex: T.statusFinished))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("You're clocked in")
                            .font(.subheadline.bold())
                            .foregroundColor(Color(hex: T.text))
                        if !ci.jobRefs.isEmpty {
                            Text(ci.jobRefs.map { $0.jobName }.joined(separator: ", "))
                                .font(.caption)
                                .foregroundColor(Color(hex: T.muted))
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    if hasSession {
                        Button {
                            Task { await appState.timeclockClockOut() }
                        } label: {
                            Text("Clock Out")
                                .font(.caption.bold())
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Color(hex: T.danger).opacity(0.15))
                                .foregroundColor(Color(hex: T.danger))
                                .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button { showReauthSheet = true } label: {
                            Text("Re-enter PIN")
                                .font(.caption.bold())
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Color(hex: T.accent).opacity(0.12))
                                .foregroundColor(Color(hex: T.accent))
                                .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    Image(systemName: "clock")
                        .foregroundColor(Color(hex: T.muted))
                    Text("Not clocked in — use the Jobs tab to clock in")
                        .font(.subheadline)
                        .foregroundColor(Color(hex: T.muted))
                    Spacer()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color(hex: T.surface))

            Rectangle().fill(Color(hex: T.border)).frame(height: 1)

            // ── Team summary + filter ────────────────────────────────────────
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(clockedInCount) clocked in")
                        .font(.subheadline.bold())
                        .foregroundColor(Color(hex: T.text))
                    Text("of \(appState.people.count) people")
                        .font(.caption)
                        .foregroundColor(Color(hex: T.muted))
                }
                Spacer()
                Picker("", selection: $showOnlyActive) {
                    Text("All").tag(false)
                    Text("Active").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 140)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color(hex: T.surface))

            Rectangle().fill(Color(hex: T.border)).frame(height: 1)

            ScrollView {
                LazyVStack(spacing: 8) {
                    if displayPeople.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "person.slash")
                                .font(.system(size: 44))
                                .foregroundColor(Color(hex: T.border))
                            Text("Nobody currently clocked in")
                                .font(.subheadline)
                                .foregroundColor(Color(hex: T.muted))
                        }
                        .padding(.top, 60)
                    } else {
                        ForEach(displayPeople) { person in
                            PersonClockRow(person: person)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .refreshable { await appState.loadAll() }
        }
        .sheet(isPresented: $showReauthSheet) {
            ReauthSheet()
        }
    }
}

private struct PersonClockRow: View {
    let person: Person
    @State private var elapsedMinutes = 0
    private let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(hex: person.color))
                .frame(width: 42, height: 42)
                .overlay(
                    Text(String(person.name.prefix(1)).uppercased())
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(person.name)
                        .font(.subheadline.bold())
                        .foregroundColor(Color(hex: T.text))
                    if person.activeClockIn != nil {
                        Circle().fill(Color(hex: T.statusFinished)).frame(width: 6, height: 6)
                    }
                }

                if let clockIn = person.activeClockIn {
                    HStack(spacing: 4) {
                        Text(elapsedLabel)
                            .font(.caption.bold())
                            .foregroundColor(Color(hex: T.statusFinished))
                        if !clockIn.jobRefs.isEmpty {
                            Text("·").font(.caption).foregroundColor(Color(hex: T.muted))
                            Text(clockIn.jobRefs.map { $0.jobName }.joined(separator: ", "))
                                .font(.caption)
                                .foregroundColor(Color(hex: T.muted))
                                .lineLimit(1)
                        }
                    }
                    if let lastEvent = clockIn.events.last,
                       ["lunchStart", "breakStart"].contains(lastEvent.type) {
                        Text(lastEvent.type == "lunchStart" ? "On Lunch" : "On Break")
                            .font(.caption2.bold())
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color(hex: T.statusOnHold).opacity(0.2))
                            .foregroundColor(Color(hex: T.statusOnHold))
                            .cornerRadius(4)
                    }
                } else {
                    Text("Not clocked in")
                        .font(.caption)
                        .foregroundColor(Color(hex: T.muted))
                }
            }
            Spacer()
        }
        .padding(12)
        .background(Color(hex: T.card))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(
            person.activeClockIn != nil ? Color(hex: T.statusFinished).opacity(0.3) : Color(hex: T.border),
            lineWidth: 1))
        .onReceive(timer) { _ in updateElapsed() }
        .onAppear { updateElapsed() }
    }

    private func updateElapsed() {
        guard let s = person.activeClockIn?.clockIn,
              let d = ISO8601DateFormatter().date(from: s) else { elapsedMinutes = 0; return }
        elapsedMinutes = Int(Date().timeIntervalSince(d)) / 60
    }

    private var elapsedLabel: String {
        let h = elapsedMinutes / 60; let m = elapsedMinutes % 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }
}

// MARK: - PIN Entry (inside sheet)

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

// MARK: - Numpad Button

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
