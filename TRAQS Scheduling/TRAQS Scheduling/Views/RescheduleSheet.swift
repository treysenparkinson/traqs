import SwiftUI

/// Tap-driven reschedule for a panel or an operation.
///
/// Deliberately no drag interaction: dragging a bar is a desktop affordance and
/// doesn't survive the move to a phone, so dates are picked, not dragged.
struct RescheduleSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let title: String
    let jobId: String
    let unitId: String
    let currentStart: String
    let currentEnd: String

    @State private var start = Date()
    @State private var end = Date()
    @State private var pushDependents = true

    private var delta: Int {
        guard let from = ScheduleDateParser.parse(currentStart) else { return 0 }
        return Calendar.current.dateComponents([.day], from: from, to: start).day ?? 0
    }

    private var hasDependents: Bool {
        appState.hasDependents(unitId: unitId, jobId: jobId)
    }

    /// Only meaningful when the unit actually moves — resizing the end alone
    /// leaves everything downstream where it is.
    private var offersPush: Bool { hasDependents && delta != 0 }

    private var deltaLabel: String {
        let d = delta
        if d == 0 { return "Same start date" }
        let unit = abs(d) == 1 ? "day" : "days"
        return d > 0 ? "Moves \(d) \(unit) later" : "Moves \(abs(d)) \(unit) earlier"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Dates") {
                    DatePicker("Start", selection: $start, displayedComponents: .date)
                    DatePicker("End", selection: $end, in: start..., displayedComponents: .date)
                    Text(deltaLabel)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if offersPush {
                    Section {
                        Toggle("Push dependent work", isOn: $pushDependents)
                    } footer: {
                        Text("Everything scheduled after this one shifts by the same \(abs(delta)) \(abs(delta) == 1 ? "day" : "days").")
                    }
                }
            }
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        appState.rescheduleUnit(
                            jobId: jobId,
                            unitId: unitId,
                            newStart: AppState.ymd(start),
                            newEnd: AppState.ymd(max(end, start)),
                            pushDependents: offersPush && pushDependents
                        )
                        dismiss()
                    }
                }
            }
            .onAppear {
                start = ScheduleDateParser.parse(currentStart) ?? Date()
                end = ScheduleDateParser.parse(currentEnd) ?? start
            }
        }
    }
}
