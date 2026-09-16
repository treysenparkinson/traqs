import SwiftUI

struct JobEditView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let job: Job?

    @State private var title = ""
    @State private var jobNumber = ""
    @State private var poNumber = ""
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(7 * 86400)
    @State private var dueDate: Date? = nil
    @State private var status: JobStatus = .notStarted
    @State private var priority: Priority = .medium
    @State private var selectedClientId: String? = nil
    @State private var notes = ""
    @State private var color = "#7c3aed"
    @State private var editDeps: Set<String> = []
    @State private var isSaving = false
    @State private var team: [String] = []
    @State private var showTeamPicker = false

    private var isEditing: Bool { job != nil }

    private var canEditDeps: Bool {
        appState.can(.editJobs)
    }

    /// Handing work to a different person is a reassignment, which is its own
    /// toggle — separate from editing the job's other fields.
    private var canEditTeam: Bool {
        appState.can(.reassign)
    }

    private var otherJobs: [Job] {
        appState.jobs.filter { $0.id != (job?.id ?? "") }.sorted { $0.title < $1.title }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Job Info") {
                    TextField("Job Title", text: $title)
                    TextField("Job Number", text: $jobNumber)
                        .keyboardType(.numberPad)
                    TextField("PO Number", text: $poNumber)
                }

                Section("Dates") {
                    DatePicker("Start", selection: $start, displayedComponents: .date)
                    DatePicker("End", selection: $end, displayedComponents: .date)
                    Toggle("Has Due Date", isOn: Binding(
                        get: { dueDate != nil },
                        set: { dueDate = $0 ? Date() : nil }
                    ))
                    if dueDate != nil {
                        DatePicker("Due Date", selection: Binding(
                            get: { dueDate ?? Date() },
                            set: { dueDate = $0 }
                        ), displayedComponents: .date)
                    }
                }

                Section("Details") {
                    Picker("Status", selection: $status) {
                        ForEach(JobStatus.allCases, id: \.self) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    Picker("Priority", selection: $priority) {
                        ForEach(Priority.allCases, id: \.self) { p in
                            Label(p.rawValue, systemImage: "circle.fill")
                                .foregroundStyle(p.color)
                                .tag(p)
                        }
                    }
                    Picker("Client", selection: $selectedClientId) {
                        Text("None").tag(Optional<String>.none)
                        ForEach(appState.clients) { c in
                            Text(c.name).tag(Optional(c.id))
                        }
                    }
                    HStack {
                        Text("Color")
                        Spacer()
                        ColorPicker("", selection: Binding(
                            get: { Color(hex: color) },
                            set: { color = $0.toHex() ?? color }
                        ), supportsOpacity: false)
                        .labelsHidden()
                    }
                }

                Section("Dependencies") {
                    if canEditDeps {
                        ForEach(otherJobs) { other in
                            Button {
                                if editDeps.contains(other.id) {
                                    editDeps.remove(other.id)
                                } else {
                                    editDeps.insert(other.id)
                                }
                            } label: {
                                HStack {
                                    Image(systemName: editDeps.contains(other.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundColor(editDeps.contains(other.id) ? Color(hex: T.accent) : Color(hex: T.muted))
                                    Text(other.title)
                                        .foregroundColor(Color(hex: T.text))
                                    Spacer()
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        let depJobs = otherJobs.filter { editDeps.contains($0.id) }
                        if depJobs.isEmpty {
                            Text("No dependencies")
                                .font(.caption)
                                .foregroundColor(Color(hex: T.muted))
                        } else {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(depJobs) { depJob in
                                        Text(depJob.title)
                                            .font(.caption)
                                            .padding(.horizontal, 10).padding(.vertical, 4)
                                            .background(Color(hex: T.border))
                                            .foregroundColor(Color(hex: T.text))
                                            .cornerRadius(8)
                                    }
                                }
                            }
                        }
                    }
                }

                // Team was previously preserved verbatim and only editable on
                // desktop, which forced a trip to a laptop to reassign work.
                if canEditTeam {
                    Section("Team") {
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
                }

                Section("Notes") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 80)
                }
            }
            .sheet(isPresented: $showTeamPicker) {
                TeamPicker(title: "Job Team", initial: team) { picked in
                    team = Array(picked)
                }
            }
            .navigationTitle(isEditing ? "Edit Job" : "New Job")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { save() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
            }
        }
        .onAppear { populateFields() }
    }

    private func populateFields() {
        guard let job else {
            color = appState.nextAutoColor()
            return
        }
        title = job.title
        jobNumber = job.jobNumber ?? ""
        poNumber = job.poNumber ?? ""
        start = job.start.asDate ?? Date()
        end = job.end.asDate ?? Date()
        dueDate = job.dueDate?.asDate
        status = job.status
        priority = job.pri
        selectedClientId = job.clientId
        notes = job.notes
        color = job.color
        editDeps = Set(job.deps)
        team = job.team
    }

    private func save() {
        isSaving = true
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        // Start from the EXISTING job and mutate only the edited fields, so
        // fields this editor doesn't surface — loggedHours, projectManagerId,
        // finishRequest, finishRequests, team, hpd, subs, moveLog, jobType — are
        // preserved. Rebuilding via the memberwise init dropped them to nil and
        // updateJob persists the whole object, silently wiping the PM assignment
        // and any pending completion requests on every edit.
        var updated = job ?? Job(id: UUID().uuidString, title: "",
                                 start: df.string(from: start), end: df.string(from: end))
        updated.title = title.trimmingCharacters(in: .whitespaces)
        updated.jobNumber = jobNumber.isEmpty ? nil : jobNumber
        updated.poNumber = poNumber.isEmpty ? nil : poNumber
        updated.start = df.string(from: start)
        updated.end = df.string(from: end)
        updated.dueDate = dueDate.map { df.string(from: $0) }
        updated.status = status
        updated.pri = priority
        updated.color = color
        updated.notes = notes
        updated.clientId = selectedClientId
        updated.deps = Array(editDeps)
        // Only written when the user may reassign; otherwise the existing team
        // rides through untouched exactly as before.
        if canEditTeam { updated.team = team }
        let clientName = appState.clients.first(where: { $0.id == selectedClientId })?.name
        appState.updateJob(updated, sendNotification: true, clientName: clientName)
        isSaving = false
        dismiss()
    }
}

// `String.asDate` and `ScheduleDateParser` live in Services/ScheduleDate.swift.
// They are pure date logic that AppState and TaskAssignment both need, and the
// macOS app compiles Services without any of these view files.
