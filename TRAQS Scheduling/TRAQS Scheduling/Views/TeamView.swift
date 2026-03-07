import SwiftUI

struct TeamView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedPersonId: Int? = nil
    @State private var showAddPerson = false
    @State private var personToEdit: Person? = nil
    @State private var personToDelete: Person? = nil
    @State private var showDeleteConfirm = false

    var body: some View {
        NavigationSplitView {
            ZStack {
                Color(hex: T.bg).ignoresSafeArea()

                List(appState.people, selection: $selectedPersonId) { person in
                    PersonRow(person: person)
                        .tag(person.id)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                personToDelete = person
                                showDeleteConfirm = true
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                personToEdit = person
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            .tint(Color(hex: T.accent))
                        }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Team")
            .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showAddPerson = true } label: {
                        Image(systemName: "plus")
                            .foregroundColor(Color(hex: T.accent))
                    }
                }
            }
        } detail: {
            if let id = selectedPersonId,
               let person = appState.people.first(where: { $0.id == id }) {
                PersonDetailView(person: person)
            } else {
                ZStack {
                    Color(hex: T.bg).ignoresSafeArea()
                    ContentUnavailableView("Select a Team Member", systemImage: "person", description: Text("Choose a team member to view their schedule."))
                }
            }
        }
        .sheet(isPresented: $showAddPerson) {
            PersonEditView(person: nil)
        }
        .sheet(item: $personToEdit) { person in
            PersonEditView(person: person)
        }
        .confirmationDialog(
            "Delete \(personToDelete?.name ?? "this person")?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let p = personToDelete {
                    var list = appState.people
                    list.removeAll { $0.id == p.id }
                    appState.updatePeople(list)
                    if selectedPersonId == p.id { selectedPersonId = nil }
                }
                personToDelete = nil
            }
            Button("Cancel", role: .cancel) { personToDelete = nil }
        }
    }
}

struct PersonRow: View {
    @Environment(AppState.self) private var appState
    let person: Person

    var assignedOps: Int {
        appState.jobs.flatMap { $0.subs }.flatMap { $0.subs }
            .filter { $0.team.contains(person.id) && $0.status != .finished }
            .count
    }

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(hex: person.color))
                .frame(width: 40, height: 40)
                .overlay(
                    Text(String(person.name.prefix(1)).uppercased())
                        .font(.headline.bold()).foregroundColor(.white)
                )
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(person.name).font(.subheadline.bold()).foregroundColor(Color(hex: T.text))
                    if person.isAdmin {
                        Text("Admin").font(.caption2.bold())
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color(hex: T.eng).opacity(0.2))
                            .foregroundColor(Color(hex: T.eng))
                            .cornerRadius(4)
                    }
                    if person.isEngineer == true {
                        Text("Eng").font(.caption2.bold())
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color(hex: T.statusInProgress).opacity(0.2))
                            .foregroundColor(Color(hex: T.statusInProgress))
                            .cornerRadius(4)
                    }
                }
                Text(person.role).font(.caption).foregroundColor(Color(hex: T.muted))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(assignedOps) tasks").font(.caption).foregroundColor(Color(hex: T.muted))
                Text("\(Int(person.cap))h/day").font(.caption2).foregroundColor(Color(hex: T.muted))
            }
        }
        .padding(12)
        .background(Color(hex: T.card))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: T.border), lineWidth: 1))
    }
}

struct PersonDetailView: View {
    @Environment(AppState.self) private var appState
    let person: Person
    @State private var showEdit = false

    var assignedOps: [(job: Job, panel: Panel, op: Operation)] {
        appState.jobs.flatMap { job in
            job.subs.flatMap { panel in
                panel.subs
                    .filter { $0.team.contains(person.id) }
                    .map { (job, panel, $0) }
            }
        }
        .sorted { $0.op.start < $1.op.start }
    }

    var body: some View {
        ZStack {
            Color(hex: T.bg).ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header card
                    HStack(spacing: 16) {
                        Circle()
                            .fill(Color(hex: person.color))
                            .frame(width: 64, height: 64)
                            .overlay(
                                Text(String(person.name.prefix(1)).uppercased())
                                    .font(.largeTitle.bold()).foregroundColor(.white)
                            )
                        VStack(alignment: .leading, spacing: 4) {
                            Text(person.name).font(.title2.bold()).foregroundColor(Color(hex: T.text))
                            Text(person.role).foregroundColor(Color(hex: T.muted))
                            Text(person.email).font(.caption).foregroundColor(Color(hex: T.muted))
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color(hex: T.card))
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))

                    // Stats
                    HStack(spacing: 12) {
                        StatCard(label: "Active Tasks", value: "\(assignedOps.filter { $0.op.status == .inProgress }.count)", color: Color(hex: T.statusInProgress))
                        StatCard(label: "Pending", value: "\(assignedOps.filter { $0.op.status == .pending }.count)", color: Color(hex: T.statusPending))
                        StatCard(label: "Capacity", value: "\(Int(person.cap))h/day", color: Color(hex: T.statusFinished))
                    }

                    // Time off
                    if !person.timeOff.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Time Off").font(.headline).foregroundColor(Color(hex: T.text))
                            ForEach(person.timeOff) { entry in
                                HStack {
                                    Circle()
                                        .fill(entry.type == "PTO" ? Color(hex: T.statusInProgress) : Color(hex: T.statusOnHold))
                                        .frame(width: 8, height: 8)
                                    Text(entry.type).font(.caption.bold()).foregroundColor(Color(hex: T.text))
                                    Text(entry.start.shortDate + " → " + entry.end.shortDate)
                                        .font(.caption).foregroundColor(Color(hex: T.muted))
                                    if let reason = entry.reason {
                                        Text("(\(reason))").font(.caption).foregroundColor(Color(hex: T.muted))
                                    }
                                }
                            }
                        }
                        .padding()
                        .background(Color(hex: T.card))
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: T.border), lineWidth: 1))
                    }

                    // Assigned operations
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Assigned Work (\(assignedOps.count))").font(.headline).foregroundColor(Color(hex: T.text))
                        ForEach(assignedOps, id: \.op.id) { item in
                            HStack {
                                Circle().fill(item.op.status.color).frame(width: 8, height: 8)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(item.job.title) / \(item.panel.title) / \(item.op.title)")
                                        .font(.subheadline)
                                        .foregroundColor(Color(hex: T.text))
                                    Text(item.op.start.shortDate + " → " + item.op.end.shortDate)
                                        .font(.caption).foregroundColor(Color(hex: T.muted))
                                }
                                Spacer()
                                StatusBadge(status: item.op.status)
                            }
                            .padding(10)
                            .background(Color(hex: T.card))
                            .cornerRadius(8)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: T.border), lineWidth: 1))
                        }
                    }
                }
                .padding()
            }
        }
        .navigationTitle(person.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { showEdit = true }
                    .foregroundColor(Color(hex: T.accent))
            }
        }
        .sheet(isPresented: $showEdit) {
            PersonEditView(person: person)
        }
    }
}

struct StatCard: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value).font(.title2.bold()).foregroundColor(color)
            Text(label).font(.caption).foregroundColor(Color(hex: T.muted))
        }
        .frame(maxWidth: .infinity)
        .padding(12)
        .background(color.opacity(0.1))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(0.25), lineWidth: 1))
    }
}

struct PersonEditView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let person: Person?

    @State private var name = ""
    @State private var role = ""
    @State private var email = ""
    @State private var cap: Double = 8.0
    @State private var userRole = "user"
    @State private var isEngineer = false
    @State private var isTeamLead = false
    @State private var color = "#7c3aed"
    @State private var showSuccess = false

    private let colorOptions = ["#7c3aed","#4f46e5","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#8b5cf6"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Info") {
                    TextField("Name", text: $name)
                    TextField("Role", text: $role)
                    TextField("Email", text: $email).keyboardType(.emailAddress)
                }
                Section("Settings") {
                    Picker("User Role", selection: $userRole) {
                        Text("User").tag("user")
                        Text("Admin").tag("admin")
                    }
                    Stepper("Capacity: \(Int(cap))h/day", value: $cap, in: 1...16, step: 0.5)
                    Toggle("Is Engineer", isOn: $isEngineer)
                    Toggle("Is Team Lead", isOn: $isTeamLead)
                }
                Section("Color") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(colorOptions, id: \.self) { c in
                                Circle().fill(Color(hex: c)).frame(width: 32, height: 32)
                                    .overlay(color == c ? Image(systemName: "checkmark").foregroundColor(.white).font(.caption.bold()) : nil)
                                    .onTapGesture { color = c }
                            }
                        }.padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle(person == nil ? "Add Person" : "Edit Person")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .overlay {
                if showSuccess {
                    VStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(Color(hex: T.statusFinished).opacity(0.15))
                                .frame(width: 72, height: 72)
                            Image(systemName: "checkmark")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundColor(Color(hex: T.statusFinished))
                        }
                        Text("Saved")
                            .font(.headline.bold())
                            .foregroundColor(Color(hex: T.text))
                    }
                    .padding(32)
                    .background(Color(hex: T.card))
                    .cornerRadius(20)
                    .shadow(color: .black.opacity(0.3), radius: 20)
                    .transition(.scale.combined(with: .opacity))
                }
            }
        }
        .onAppear { populate() }
    }

    private func populate() {
        guard let p = person else { return }
        name = p.name; role = p.role; email = p.email
        cap = p.cap; userRole = p.userRole
        isEngineer = p.isEngineer ?? false
        isTeamLead = p.isTeamLead ?? false
        color = p.color
    }

    private func save() {
        let maxId = appState.people.map { $0.id }.max() ?? 0
        let updated = Person(
            id: person?.id ?? maxId + 1,
            name: name.trimmingCharacters(in: .whitespaces),
            role: role, email: email, cap: cap,
            color: color, userRole: userRole,
            adminPerms: person?.adminPerms,
            isEngineer: isEngineer,
            isTeamLead: isTeamLead,
            teamNumber: person?.teamNumber,
            timeOff: person?.timeOff ?? [],
            pushToken: person?.pushToken
        )
        var list = appState.people
        if let i = list.firstIndex(where: { $0.id == updated.id }) {
            list[i] = updated
        } else {
            list.append(updated)
        }
        appState.updatePeople(list)
        withAnimation(.spring(duration: 0.3)) { showSuccess = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            dismiss()
        }
    }
}
