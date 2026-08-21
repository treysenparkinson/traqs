import SwiftUI

/// Multi-select crew picker, shared by the job editor and the op cards.
///
/// Eligibility mirrors AvailabilityCheckView's rule: real people (user or admin)
/// who aren't excluded from scheduling. Rows are grouped by department, because
/// the iOS Operation model carries no `requiredDepartment` the way the desktop's
/// does — there is nothing to hard-lock against here, so the department is
/// surfaced as structure rather than enforced as a filter. If a department lock
/// is ever added to the model, this is the one place that needs to change.
struct TeamPicker: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let title: String
    /// Current selection, edited locally and handed back on Done.
    @State private var selected: Set<String>
    let onSave: (Set<String>) -> Void

    init(title: String, initial: [String], onSave: @escaping (Set<String>) -> Void) {
        self.title = title
        self._selected = State(initialValue: Set(initial))
        self.onSave = onSave
    }

    /// No tombstone check: the people GET runs filterLive server-side, so a
    /// soft-deleted person never reaches the device.
    private var eligible: [Person] {
        appState.people.filter {
            ($0.userRole == "user" || $0.userRole == "admin") && $0.isAutoSchedulable
        }
    }

    /// (department, people) sorted by department then name. Blank departments
    /// collect under "No department" so nobody is silently unreachable.
    private var grouped: [(String, [Person])] {
        Dictionary(grouping: eligible) { p -> String in
            let d = p.role.trimmingCharacters(in: .whitespaces)
            return d.isEmpty ? "No department" : d
        }
        .map { ($0.key, $0.value.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }) }
        .sorted { $0.0.localizedCaseInsensitiveCompare($1.0) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                if selected.isEmpty {
                    Text("Nobody assigned")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(grouped, id: \.0) { dept, members in
                    Section(dept) {
                        ForEach(members) { person in
                            Button {
                                if selected.contains(person.id) { selected.remove(person.id) }
                                else { selected.insert(person.id) }
                            } label: {
                                HStack(spacing: 10) {
                                    Circle()
                                        .fill(Color(hex: person.color))
                                        .frame(width: 10, height: 10)
                                    Text(person.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if selected.contains(person.id) {
                                        Image(systemName: "checkmark")
                                            .font(.footnote.weight(.semibold))
                                            .foregroundStyle(Color(hex: T.accent))
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onSave(selected); dismiss() }
                }
            }
        }
    }
}

/// Compact read-only summary of an assigned crew — coloured dots plus names,
/// used on rows that open a TeamPicker.
struct TeamSummary: View {
    @Environment(AppState.self) private var appState
    let ids: [String]

    private var members: [Person] {
        ids.compactMap { id in appState.people.first { $0.id == id } }
    }

    var body: some View {
        if members.isEmpty {
            Text("Unassigned")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            HStack(spacing: 6) {
                ForEach(members.prefix(4)) { p in
                    Circle().fill(Color(hex: p.color)).frame(width: 8, height: 8)
                }
                Text(members.map(\.name).joined(separator: ", "))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}
