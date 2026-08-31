import SwiftUI

// MARK: - New Job
//
// `renderModal()` (TRAQS.jsx:21529) is a THREE-step wizard and the third step is
// most of it: an availability check against every assignee, an AI schedule
// suggestion (`suggestSchedule`, which posts to the `ai-schedule` function), a
// per-operation override calendar, and a packer that lays the operations onto
// real days. None of that is ported.
//
// What IS ported is the whole of the other path through the same wizard, and it
// is a complete one rather than a stub:
//
//   step 1  the job's details          (:22054)
//   step 2  its panels and operations  (:22095)
//   then    "Save for Later" (:22801), which writes the job with
//           `scheduledLater: true` and closes.
//
// That is the web's own escape hatch from step 2, not something invented here,
// and it is what puts a job into TRAQS Cloud — the list of jobs waiting to be
// scheduled. So the two modals in this file are one loop: create a job here,
// find it there.
//
// The step-2 QUANTITY expansion is ported too, because leaving it out would
// silently create one panel where the form said twelve: a panel with `qty` n is
// written out as n copies, the first keeping its id and the rest named
// `Base-002`, `Base-003`… exactly as `expanded` does at :22801.

struct JobsNewJobSheet: View {
    @Environment(\.tqTheme) private var theme

    let people: [Person]
    let clients: [Client]
    let customColumns: [JobsCustomColumn]
    /// Called with a finished job. The caller writes it — this sheet never
    /// touches AppState.
    let create: (Job) -> Void
    var phase: TQModalPhase = .presenting
    let dismiss: () -> Void

    @State private var step = 1
    @State private var draft = JobDraft()
    @State private var panels: [PanelDraft] = []

    var body: some View {
        TQModal(width: 720, maxHeight: 680, phase: phase, dismiss: dismiss) {
            header
            TQModalRule()
            ScrollView(.vertical) {
                Group {
                    if step == 1 { detailsStep } else { operationsStep }
                }
                .padding(20)
                // `stepIn 0.22s` — the step slides in from the side it came
                // from, so going back reads as going back.
                .transition(.asymmetric(
                    insertion: .move(edge: step == 1 ? .leading : .trailing)
                        .combined(with: .opacity),
                    removal: .opacity))
                .id(step)
            }
            .frame(maxHeight: .infinity)
            TQModalRule()
            footer
        }
    }

    // MARK: Header

    private var header: some View {
        TQModalHeader(glyph: WebIcon.emptyJobs, title: "New Job",
                      subtitle: step == 1
                        ? "Job details"
                        : "Panels and operations — add at least one",
                      dismiss: dismiss) {
            HStack(spacing: 6) {
                stepDot(1); stepDot(2)
                Text("Step \(step) of 2")
                    .font(TFont.body(11, 600))
                    .foregroundStyle(theme.textDim)
            }
        }
    }

    private func stepDot(_ n: Int) -> some View {
        Capsule()
            .fill(step >= n ? theme.accent : theme.border)
            .frame(width: step == n ? 18 : 7, height: 7)
            .animation(.snappy(duration: 0.2), value: step)
    }

    // MARK: Step 1 — details

    private var detailsStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            TQField(label: "Job Name", required: true) {
                TextField("e.g. Bay 3 Switchgear", text: $draft.title)
                    .textFieldStyle(.plain)
                    .modifier(TQFieldChrome())
            }

            HStack(spacing: 12) {
                TQField(label: "Job #") {
                    TextField("e.g. 2024-001", text: $draft.jobNumber)
                        .textFieldStyle(.plain).modifier(TQFieldChrome())
                }
                TQField(label: "PO #") {
                    TextField("e.g. PO-8821", text: $draft.poNumber)
                        .textFieldStyle(.plain).modifier(TQFieldChrome())
                }
            }

            HStack(alignment: .top, spacing: 12) {
                TQField(label: "Due Date (Customer)") {
                    TQDayField(day: $draft.dueDate, placeholder: "No due date")
                }
                TQField(label: "Project Manager", required: true) {
                    // REQUIRED, and the web enforces it the same way — Next is
                    // disabled without one, because the default grid groups every
                    // job by its manager.
                    TQPersonPicker(people: people, selection: $draft.projectManagerId,
                                   placeholder: "Select project manager\u{2026}")
                }
            }

            TQField(label: "Client") {
                TQClientPicker(clients: clients, selection: $draft.clientId)
            }

            // Only the INVENTED columns. A linked one already edits a real job
            // field that this form covers, so offering both would be two inputs
            // for one value.
            let invented = customColumns.filter { $0.fieldKey == nil }
            if !invented.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(invented) { column in
                        TQField(label: column.label) {
                            customField(column)
                        }
                    }
                }
            }

            TQField(label: "Notes") {
                TextEditor(text: $draft.notes)
                    .font(TFont.body(13))
                    .scrollContentBackground(.hidden)
                    .frame(height: 72)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(theme.surface))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(theme.border, lineWidth: 1))
            }
        }
    }

    @ViewBuilder
    private func customField(_ column: JobsCustomColumn) -> some View {
        switch column.type {
        case .select:
            TQOptionPicker(options: column.options,
                           selection: Binding(
                            get: { draft.custom[column.storageKey] ?? "" },
                            set: { draft.custom[column.storageKey] = $0 }))
        case .checkbox:
            TQCheckbox(on: Binding(
                get: { draft.custom[column.storageKey] == "true" },
                set: { draft.custom[column.storageKey] = $0 ? "true" : "false" }))
        case .date:
            TQDayField(day: Binding(
                get: { draft.custom[column.storageKey] ?? "" },
                set: { draft.custom[column.storageKey] = $0 }), placeholder: "\u{2014}")
        default:
            TextField("\u{2014}", text: Binding(
                get: { draft.custom[column.storageKey] ?? "" },
                set: { draft.custom[column.storageKey] = $0 }))
                .textFieldStyle(.plain).modifier(TQFieldChrome())
        }
    }

    // MARK: Step 2 — panels and operations

    private var operationsStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            if panels.isEmpty {
                VStack(spacing: 8) {
                    WebGlyph(spec: WebIcon.emptyJobs, size: 32, color: theme.textDim)
                        .opacity(0.4)
                    Text("No panels yet")
                        .font(TFont.body(14, 700))
                        .foregroundStyle(theme.text)
                    Text("A job needs at least one panel before it can be saved.")
                        .font(TFont.body(12))
                        .foregroundStyle(theme.textDim)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
            }

            ForEach($panels) { $panel in
                PanelEditor(panel: $panel) {
                    panels.removeAll { $0.id == panel.id }
                }
            }

            Button { panels.append(PanelDraft()) } label: {
                HStack(spacing: 6) {
                    WebGlyph(spec: WebIcon.plus, size: 11, color: theme.accent)
                    Text("Add panel").font(TFont.body(12, 700))
                        .foregroundStyle(theme.accent)
                }
                .padding(.horizontal, 14).padding(.vertical, 9)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(theme.accent.opacity(0.4),
                                  style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if totalPanels != panels.count {
                // Quantity expansion is easy to miss on the form, and it is the
                // difference between one panel and ninety-six.
                Text("\(panels.count) panel\(panels.count == 1 ? "" : "s") on the form "
                     + "\u{2192} \(totalPanels) will be created, from the quantities set above.")
                    .font(TFont.body(11))
                    .foregroundStyle(theme.accent)
            }
        }
    }

    private var totalPanels: Int { panels.reduce(0) { $0 + max(1, $1.quantity) } }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 10) {
            if step == 1 {
                TQModalButton(label: "Cancel", style: .quiet, action: dismiss)
                Spacer(minLength: 0)
                TQModalButton(label: "Next: Operations \u{2192}",
                              enabled: canLeaveStepOne,
                              help: canLeaveStepOne ? nil
                                    : "A job needs a name and a project manager") {
                    withAnimation(.snappy(duration: 0.22)) { step = 2 }
                }
            } else {
                TQModalButton(label: "\u{2190} Back", style: .quiet) {
                    withAnimation(.snappy(duration: 0.22)) { step = 1 }
                }
                Spacer(minLength: 0)
                TQModalButton(label: "Schedule & Assign \u{2192}", style: .quiet,
                              enabled: false,
                              help: "Scheduling needs the availability check and the packer — not ported yet") { }
                TQModalButton(label: "Save for Later",
                              enabled: !panels.isEmpty,
                              help: panels.isEmpty ? "Add at least one panel" : nil) {
                    create(build())
                    dismiss()
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private var canLeaveStepOne: Bool {
        !draft.title.trimmingCharacters(in: .whitespaces).isEmpty
            && draft.projectManagerId != nil
    }

    // MARK: Building the job

    /// `scheduledLater: true`, and no dates on the panels or operations.
    ///
    /// That is exactly what the web's Save-for-Later writes (`stripDT` removes
    /// `start`, `end`, `team` and `qty` from every level before saving) — the
    /// scheduling step is what puts them on, so writing today's date here would
    /// look like a scheduled job that nobody scheduled.
    private func build() -> Job {
        var job = Job(id: UUID().uuidString,
                      title: draft.title.trimmingCharacters(in: .whitespaces),
                      jobNumber: draft.jobNumber.isEmpty ? nil : draft.jobNumber,
                      poNumber: draft.poNumber.isEmpty ? nil : draft.poNumber,
                      start: "", end: "",
                      dueDate: draft.dueDate.isEmpty ? nil : draft.dueDate,
                      status: .notStarted,
                      pri: .medium,
                      team: [],
                      color: JobColors.next(),
                      notes: draft.notes,
                      clientId: draft.clientId,
                      subs: expandedPanels(),
                      projectManagerId: draft.projectManagerId)

        job.extras.set("scheduledLater", .bool(true))
        for (key, value) in draft.custom where !value.isEmpty {
            job.extras.set(key, .string(value))
        }
        return job
    }

    /// `qty` expanded. The first copy keeps the id typed against; the rest get
    /// fresh ones and a `-002` suffix, and their operations get fresh ids too —
    /// duplicate ids across panels are what silently drop rows from a `ForEach`.
    private func expandedPanels() -> [Panel] {
        panels.flatMap { draft -> [Panel] in
            let count = max(1, min(999, draft.quantity))
            let base = draft.title.replacingOccurrences(
                of: "-\\d+$", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)

            return (0..<count).map { i in
                var panel = Panel.empty(
                    id: i == 0 ? draft.id : UUID().uuidString,
                    title: count == 1 ? draft.title
                         : "\(base)-\(String(format: "%03d", i + 1))")
                panel.subs = draft.operations.map { op in
                    Operation.empty(id: i == 0 ? op.id : UUID().uuidString,
                                    title: op.title, hpd: op.hours)
                }
                if !draft.department.isEmpty {
                    panel.extras.set("requiredDepartment", .string(draft.department))
                }
                return panel
            }
        }
    }
}

// MARK: - The form's own state
//
// Drafts, not models. A half-filled form is not a Job — it has no id, no dates
// and possibly no panels — and giving it the real type would mean a `Job` that
// cannot be saved existing in the app.

struct JobDraft {
    var title = ""
    var jobNumber = ""
    var poNumber = ""
    var dueDate = ""
    var projectManagerId: String?
    var clientId: String?
    var notes = ""
    /// Custom-column values, keyed by `_cc_<id>`.
    var custom: [String: String] = [:]
}

struct PanelDraft: Identifiable {
    let id = UUID().uuidString
    var title = ""
    /// `qty` — how many copies of this panel to create. The web caps it at 999.
    var quantity = 1
    var department = ""
    var operations: [OperationDraft] = []
}

struct OperationDraft: Identifiable {
    let id = UUID().uuidString
    var title = ""
    /// `op.hpd` — the TOTAL productive hours for the operation, not a daily rate.
    /// See `opHrs` in the grid: the web displays it directly and multiplying by
    /// days was the legacy bug that inflated every multi-day operation.
    var hours: Double = 7.5
}

// MARK: One panel on the form

private struct PanelEditor: View {
    @Environment(\.tqTheme) private var theme

    @Binding var panel: PanelDraft
    let remove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                TextField("Panel name\u{2026}", text: $panel.title)
                    .textFieldStyle(.plain)
                    .modifier(TQFieldChrome())

                HStack(spacing: 4) {
                    Text("QTY")
                        .font(TFont.body(9, 700))
                        .foregroundStyle(theme.textDim)
                    TextField("1", value: $panel.quantity, format: .number)
                        .textFieldStyle(.plain)
                        .font(TFont.mono(12))
                        .frame(width: 38)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(Capsule().fill(theme.surface))
                .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))

                Button(action: remove) {
                    WebGlyph(spec: WebIcon.trash, size: 13, color: theme.danger)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Remove this panel")
            }

            ForEach($panel.operations) { $op in
                HStack(spacing: 8) {
                    Circle().fill(theme.textDim.opacity(0.4))
                        .frame(width: 4, height: 4)
                        .padding(.leading, 6)
                    TextField("Operation name\u{2026}", text: $op.title)
                        .textFieldStyle(.plain)
                        .font(TFont.body(12))
                        .foregroundStyle(theme.text)
                    HStack(spacing: 3) {
                        TextField("7.5", value: $op.hours, format: .number)
                            .textFieldStyle(.plain)
                            .font(TFont.mono(11))
                            .frame(width: 34)
                            .multilineTextAlignment(.trailing)
                        Text("h").font(TFont.body(10)).foregroundStyle(theme.textDim)
                    }
                    Button {
                        panel.operations.removeAll { $0.id == op.id }
                    } label: {
                        Text("\u{2715}").font(.system(size: 10))
                            .foregroundStyle(theme.textDim)
                            .frame(width: 20, height: 20)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(theme.bg.opacity(0.5)))
            }

            Button { panel.operations.append(OperationDraft()) } label: {
                HStack(spacing: 5) {
                    WebGlyph(spec: WebIcon.plus, size: 9, color: theme.textSec)
                    Text("Add operation").font(TFont.body(11, 600))
                        .foregroundStyle(theme.textSec)
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(theme.border, lineWidth: 1))
    }
}

// MARK: - TRAQS Cloud
//
// `bcModalState` (TRAQS.jsx:25028) — the cloud button on the Jobs toolbar. Not an
// importer, which the name suggests: it is the list of jobs saved WITHOUT a
// schedule (`scheduledLater`), waiting for someone to place them.
//
// Full-bleed on the web (`position: fixed; inset: 0`), because it is a place you
// go rather than a dialog you answer.

struct JobsCloudSheet: View {
    @Environment(\.tqTheme) private var theme

    let jobs: [Job]
    let clients: [String: Client]
    var phase: TQModalPhase = .presenting
    let dismiss: () -> Void

    /// `tasks.filter(t => t.scheduledLater)`. Not a modelled field — it rides on
    /// `Job.extras`, and before that existed this list was always empty on the
    /// Mac because saving stripped the flag.
    private var pending: [Job] {
        jobs.filter { job in
            switch job.extras["scheduledLater"] {
            case .bool(let b):   return b
            case .string(let s): return s == "true"
            default:             return false
            }
        }
    }

    var body: some View {
        TQModal(width: 640, maxHeight: 560, phase: phase, dismiss: dismiss) {
            TQModalHeader(glyph: WebIcon.cloud, title: "TRAQS Cloud",
                          subtitle: pending.isEmpty ? nil
                            : "\(pending.count) job\(pending.count == 1 ? "" : "s") waiting to be scheduled",
                          dismiss: dismiss)
            TQModalRule()

            if pending.isEmpty {
                VStack(spacing: 10) {
                    WebGlyph(spec: WebIcon.calendarPin, size: 40, color: theme.textDim)
                        .opacity(0.35)
                    Text("No jobs pending scheduling")
                        .font(TFont.body(13))
                        .foregroundStyle(theme.textDim)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 60)
            } else {
                ScrollView(.vertical) {
                    LazyVStack(spacing: 8) {
                        ForEach(pending) { job in row(job) }
                    }
                    .padding(20)
                }
                .frame(maxHeight: .infinity)
            }
        }
    }

    private func row(_ job: Job) -> some View {
        let client = job.clientId.flatMap { clients[$0] }
        let ops = job.subs.reduce(0) { $0 + $1.subs.count }

        return HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.hex(job.color))
                .frame(width: 3, height: 30)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 7) {
                    Text(job.title)
                        .font(TFont.body(13, 700))
                        .foregroundStyle(theme.text)
                    if let number = job.jobNumber {
                        Text("#\(number)")
                            .font(TFont.mono(10, 600))
                            .foregroundStyle(theme.textDim)
                    }
                }
                Text("\(job.subs.count) panel\(job.subs.count == 1 ? "" : "s") \u{00B7} \(ops) operation\(ops == 1 ? "" : "s")"
                     + (client.map { " \u{00B7} \($0.name)" } ?? ""))
                    .font(TFont.body(11))
                    .foregroundStyle(theme.textDim)
            }

            Spacer(minLength: 8)

            // The web's row opens the wizard at its scheduling step. That step is
            // not ported, so this says so rather than opening a form that cannot
            // finish the job it was opened for.
            Text("Schedule \u{2192}")
                .font(TFont.body(11, 700))
                .foregroundStyle(theme.textDim)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Capsule().fill(theme.bg.opacity(0.6)))
                .opacity(0.5)
                .help("Scheduling needs the availability check and the packer — not ported yet")
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(theme.border, lineWidth: 1))
    }
}
