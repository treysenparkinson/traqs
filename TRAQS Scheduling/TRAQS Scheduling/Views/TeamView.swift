import SwiftUI

// MARK: - TeamView · TRAQS Revamp
// Frosted team roster matched to the Team wireframe: AmbientBackground canvas,
// TRAQSNavHeader + PageTitle, a presence filter chip row (All / On job / Break /
// Idle), and frosted rows with gradient avatars (+ presence dot) and a bright
// status TagPill. STYLING ONLY — every @State, binding, action closure, sheet,
// swipe action and toggle is preserved exactly; presence/status is *derived from
// existing Person fields* for display, mirroring AdminView's read-only convention.

// ── Presence derivation (read-only, mirrors AdminView.statusFor) ──────────────
private enum TeamPresence {
    case onJob, onBreak, idle, offline

    /// Read-only classification from already-loaded Person fields. No data is
    /// created or mutated — this is purely how the row presents itself.
    static func of(_ p: Person) -> TeamPresence {
        if p.activeBreak != nil { return .onBreak }
        if p.activeJobClock != nil { return .onJob }
        if p.activeClockIn != nil { return .idle }
        return .offline
    }

    /// Presence dot color per the design kit tokens.
    var dot: Color {
        switch self {
        case .onJob:   return Color(hex: T.presenceWork)
        case .onBreak: return Color(hex: T.presenceBreak)
        case .idle, .offline: return Color(hex: T.presenceIdle)
        }
    }

    var pillLabel: String {
        switch self {
        case .onJob:   return "On job"
        case .onBreak: return "Break"
        case .idle:    return "Idle"
        case .offline: return "Offline"
        }
    }

    var pillKind: TagKind {
        switch self {
        case .onJob:   return .indigo
        case .onBreak: return .amber
        case .idle, .offline: return .neutral
        }
    }
}

// ── Filter chip identity (presentation-only; not persisted) ───────────────────
private enum TeamFilter: CaseIterable {
    case all, onJob, onBreak, idle
    var label: String {
        switch self {
        case .all:     return "All"
        case .onJob:   return "On job"
        case .onBreak: return "Break"
        case .idle:    return "Idle"
        }
    }
    /// Whether a person with the given presence passes this filter.
    func matches(_ presence: TeamPresence) -> Bool {
        switch self {
        case .all:     return true
        case .onJob:   return presence == .onJob
        case .onBreak: return presence == .onBreak
        case .idle:    return presence == .idle || presence == .offline
        }
    }
}

// ── A frosted filter chip: active = gradient pill, inactive = white pill ──────
private struct TeamFilterChip: View {
    let label: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(TTypo.smBold(13))
                .foregroundStyle(active ? .white : Color(hex: T.ink))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    Capsule().fill(
                        active ? AnyShapeStyle(T.brandGradient())
                               : AnyShapeStyle(Color(hex: T.surface))
                    )
                )
                .overlay(
                    Capsule().stroke(active ? Color.clear : Color(hex: T.hair), lineWidth: 1)
                )
                .compositingGroup()
                .shadow(
                    color: active ? Color(hex: T.ctaGlowColor).opacity(T.ctaGlowOpacity * 0.6)
                                  : Color.black.opacity(T.raisedShadowOpacity),
                    radius: active ? T.ctaGlowRadius * 0.6 : T.raisedShadowRadius,
                    x: 0, y: active ? 4 : T.raisedShadowY
                )
        }
        .buttonStyle(.plain)
    }
}

struct TeamView: View {
    @Environment(AppState.self) private var appState
    @State private var showAddPerson = false
    @State private var personToEdit: Person? = nil
    @State private var personToDelete: Person? = nil
    @State private var showDeleteConfirm = false
    // Presentation-only client-side filter (no business logic touched).
    @State private var filter: TeamFilter = .all

    // Count subtitle from already-loaded data (display only).
    private var onClockCount: Int {
        appState.people.filter { TeamPresence.of($0) != .offline }.count
    }
    private var onJobCount: Int {
        appState.people.filter { TeamPresence.of($0) == .onJob }.count
    }
    private var subtitle: String {
        "\(onClockCount) on the clock · \(onJobCount) on a job"
    }

    private var filteredPeople: [Person] {
        appState.people.filter { filter.matches(TeamPresence.of($0)) }
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            VStack(spacing: 0) {
                // Sticky revamp header (wordmark + optional add action).
                TRAQSNavHeader {
                    if appState.isAdmin {
                        IconBtn(icon: .plus, size: 18) { showAddPerson = true }
                    }
                }

                ScrollView {
                    VStack(spacing: 0) {

                        PageTitle(title: "Team", subtitle: subtitle)
                            .padding(.top, pageTitleTopInset)
                            .padding(.bottom, 14)

                        // ── Filter chip row (active = gradient, inactive = white) ──
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(TeamFilter.allCases, id: \.self) { f in
                                    TeamFilterChip(label: f.label, active: filter == f) {
                                        filter = f
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                        .padding(.bottom, 14)

                        // ── Roster ──
                        LazyVStack(spacing: 12) {
                            ForEach(filteredPeople) { person in
                                PersonRow(person: person)
                                    .contextMenu {
                                        if appState.isAdmin {
                                            Button { personToEdit = person } label: {
                                                Label("Edit", systemImage: "pencil")
                                            }
                                            Button(role: .destructive) {
                                                personToDelete = person
                                                showDeleteConfirm = true
                                            } label: { Label("Delete", systemImage: "trash") }
                                        }
                                    }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
                .scrollIndicators(.hidden)
                .topFadeMask()
                .refreshable { await appState.loadAll() }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationTitle("Team")
        .sheet(isPresented: $showAddPerson) { PersonEditView(person: nil) }
        .sheet(item: $personToEdit) { person in PersonEditView(person: person) }
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
                }
                personToDelete = nil
            }
            Button("Cancel", role: .cancel) { personToDelete = nil }
        }
    }
}

// MARK: - PersonRow

struct PersonRow: View {
    @Environment(AppState.self) private var appState
    let person: Person
    @State private var isExpanded = false

    // Live read so toggles reflect current state without snap-back
    private var livePerson: Person? {
        appState.people.first(where: { $0.id == person.id })
    }

    var assignedOps: Int {
        let all = appState.jobs.flatMap { $0.subs }.flatMap { $0.subs }
        return all.filter { $0.team.contains(person.id) && $0.status != .finished }.count
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { String($0.prefix(1)).uppercased() }
        return parts.isEmpty ? "?" : parts.joined()
    }

    var body: some View {
        VStack(spacing: 0) {

            // ── Tappable header — whole card, always works ──
            Button {
                isExpanded.toggle()
            } label: {
                // Use live data so tags update immediately when toggled
                let live = appState.people.first(where: { $0.id == person.id }) ?? person
                let presence = TeamPresence.of(live)
                HStack(spacing: 12) {
                    Avatar(initials: initials(live.name),
                           size: 44,
                           gradient: true,
                           presence: presence.dot)

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(live.name)
                                .font(TTypo.smBold(15))
                                .foregroundStyle(Color(hex: T.ink))
                            if live.isAdmin {
                                TagPill(label: "Admin", kind: .magenta)
                            }
                            if live.isEngineer == true {
                                TagPill(label: "Eng", kind: .sky)
                            }
                        }
                        Text(live.role.isEmpty ? "\(assignedOps) active tasks" : live.role)
                            .font(TTypo.sm(13))
                            .foregroundStyle(Color(hex: T.muted))
                    }

                    Spacer()

                    TagPill(label: presence.pillLabel, kind: presence.pillKind)

                    TIconView(icon: .chevDown, size: 12, color: Color(hex: T.muted))
                        .frame(width: 16)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // ── Expanded permissions ──
            if isExpanded {
                SLine().padding(.horizontal, 14)

                VStack(spacing: 0) {

                    // Admin
                    HStack {
                        permLabel("Admin", icon: "shield.fill", tint: Color(hex: T.magenta))
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { appState.people.first(where: { $0.id == person.id })?.isAdmin ?? false },
                            set: { val in
                                var list = appState.people
                                if let i = list.firstIndex(where: { $0.id == person.id }) {
                                    list[i].userRole = val ? "admin" : "user"
                                    appState.updatePeople(list)
                                }
                            }
                        )).toggleStyle(GradientToggleStyle()).labelsHidden()
                    }
                    .padding(.vertical, 10)

                    SLine().padding(.leading, 48)

                    // Engineer
                    HStack {
                        permLabel("Engineer", icon: "wrench.and.screwdriver.fill", tint: Color(hex: T.accent))
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { appState.people.first(where: { $0.id == person.id })?.isEngineer ?? false },
                            set: { val in
                                var list = appState.people
                                if let i = list.firstIndex(where: { $0.id == person.id }) {
                                    list[i].isEngineer = val
                                    appState.updatePeople(list)
                                }
                            }
                        )).toggleStyle(GradientToggleStyle()).labelsHidden()
                    }
                    .padding(.vertical, 10)

                    SLine().padding(.leading, 48)

                    // Auto-Scheduling
                    HStack {
                        permLabel("Auto-Scheduling", icon: "brain", tint: Color(hex: T.lavender))
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { appState.people.first(where: { $0.id == person.id })?.autoSchedule ?? true },
                            set: { val in
                                var list = appState.people
                                if let i = list.firstIndex(where: { $0.id == person.id }) {
                                    list[i].autoSchedule = val
                                    appState.updatePeople(list)
                                }
                            }
                        )).toggleStyle(GradientToggleStyle()).labelsHidden()
                    }
                    .padding(.vertical, 10)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 6)
                .clipped()
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isExpanded)
        .frostedCard(radius: T.cornerMd)
    }

    // Leading-glyph + label for an expanded permission row.
    private func permLabel(_ title: String, icon: String, tint: Color) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 38 * 0.30, style: .continuous)
                .fill(tint.opacity(0.14))
                .frame(width: 36, height: 36)
                .overlay(Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint))
            Text(title)
                .font(TTypo.sm(14))
                .foregroundStyle(Color(hex: T.ink))
        }
    }

}

// MARK: - PersonDetailView

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

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { String($0.prefix(1)).uppercased() }
        return parts.isEmpty ? "?" : parts.joined()
    }

    var body: some View {
        ZStack {
            AmbientBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 16) {
                        Avatar(initials: initials(person.name),
                               size: 64,
                               gradient: true,
                               presence: TeamPresence.of(person).dot)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(person.name).font(TTypo.h2(22)).foregroundStyle(Color(hex: T.ink))
                            Text(person.role).font(TTypo.sm(14)).foregroundStyle(Color(hex: T.muted))
                            Text(person.email).font(TTypo.sm(12)).foregroundStyle(Color(hex: T.muted))
                        }
                        Spacer()
                    }
                    .padding(18)
                    .frostedCard(radius: T.cornerLg)

                    HStack(spacing: 12) {
                        StatCard(label: "Active Tasks", value: "\(assignedOps.filter { $0.op.status == .inProgress }.count)", color: Color(hex: T.statusInProgress))
                        StatCard(label: "Pending", value: "\(assignedOps.filter { $0.op.status == .pending }.count)", color: Color(hex: T.statusPending))
                        StatCard(label: "Capacity", value: "\(Int(person.cap))h/day", color: Color(hex: T.statusFinished))
                    }

                    if !person.timeOff.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Time Off").font(TTypo.h3(18)).foregroundStyle(Color(hex: T.ink))
                            ForEach(person.timeOff) { entry in
                                HStack(spacing: 8) {
                                    Circle()
                                        .fill(entry.type == "PTO" ? Color(hex: T.statusInProgress) : Color(hex: T.statusOnHold))
                                        .frame(width: 8, height: 8)
                                    Text(entry.type).font(TTypo.smBold(13)).foregroundStyle(Color(hex: T.ink))
                                    Text(entry.start.shortDate + " → " + entry.end.shortDate)
                                        .font(TTypo.sm(13)).foregroundStyle(Color(hex: T.muted))
                                    if let reason = entry.reason {
                                        Text("(\(reason))").font(TTypo.sm(13)).foregroundStyle(Color(hex: T.muted))
                                    }
                                }
                            }
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frostedCard(radius: T.cornerLg)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Assigned Work (\(assignedOps.count))").font(TTypo.h3(18)).foregroundStyle(Color(hex: T.ink))
                        ForEach(assignedOps, id: \.op.id) { item in
                            HStack(spacing: 10) {
                                Circle().fill(item.op.status.color).frame(width: 8, height: 8)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(item.job.title) / \(item.panel.title) / \(item.op.title)")
                                        .font(TTypo.sm(14))
                                        .foregroundStyle(Color(hex: T.ink))
                                    Text(item.op.start.shortDate + " → " + item.op.end.shortDate)
                                        .font(TTypo.sm(12)).foregroundStyle(Color(hex: T.muted))
                                }
                                Spacer()
                                StatusBadge(status: item.op.status)
                            }
                            .padding(12)
                            .frostedCard(radius: T.cornerMd)
                        }
                    }
                }
                .padding(16)
            }
        }
        .navigationTitle(person.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbarBackground(Color(hex: T.surface), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            if appState.isAdmin {
                ToolbarItem(placement: .primaryAction) {
                    Button("Edit") { showEdit = true }
                        .foregroundColor(Color(hex: T.accent))
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            PersonEditView(person: person)
        }
    }
}

// MARK: - StatCard

struct StatCard: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value).font(TTypo.h2(22)).foregroundStyle(color)
            Text(label).font(TTypo.sm(12)).foregroundStyle(Color(hex: T.muted))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .frostedCard(radius: T.cornerMd)
    }
}

// MARK: - PersonEditView

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
                            .font(TTypo.h3(18))
                            .foregroundStyle(Color(hex: T.ink))
                    }
                    .padding(32)
                    .frostedCard(radius: T.cornerLg)
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
        let updated = Person(
            id: person?.id ?? "p" + UUID().uuidString.prefix(8).lowercased(),
            name: name.trimmingCharacters(in: .whitespaces),
            role: role, email: email, cap: cap,
            color: color, userRole: userRole,
            adminPerms: person?.adminPerms,
            isEngineer: isEngineer,
            isTeamLead: isTeamLead,
            autoSchedule: person?.autoSchedule,
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
