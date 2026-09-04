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
//
// ASSIGNMENT, and where it sits.
//
// The web puts it in step 3 — you pick people there, against an availability
// check. Step 2 has no assignee input at all. Porting that faithfully left this
// sheet unable to assign ANYBODY, ever, because the Mac's only exit from step 2
// is Save for Later: every job created here reached TRAQS Cloud with an empty
// team and no way to fill it.
//
// So Dept and Assignee are on the step-2 rows here. It is a divergence and a
// deliberate one — the alternative is a create-job form that cannot say who is
// doing the work. What is NOT ported is what those pickers are for on the web:
// the availability check that says whether the person is free, the AI
// suggestion, and the packer. Step 3 remains disabled and says so.
//
// A DEPARTMENT FILTERS THE ASSIGNEE LIST, which is why Dept sits to its left on
// every row: choose the department, then choose from its members.
//
// WHAT THE LEVELS ARE CALLED, and it is not what the model calls them.
//
// The model says job → PANEL → OPERATION, and every type, field and variable
// here keeps those names. The INTERFACE says job → Operation → Sub-operation,
// which is what the web's own wizard says: its panel-level placeholder is
// "Operation name", its add button "+ Add Operation", and its child rows
// "Sub-operation".
//
// So a `PanelDraft` is labelled "Operation" on screen. That mismatch is
// deliberate and worth leaving alone: renaming the model would touch `Panel`,
// `panelID`, `panel.subs` and the whole approval and scheduling layer on both
// platforms, to rename a thing the SERVER also calls a panel. Renaming the
// labels costs nothing and is what people asked for.
//
// If a string here says "panel", it is a bug.
//
// STEP 2 NOW CARRIES THE WHOLE ROW, matching the web's: colour, name, quantity,
// hours, department, assignees, sign-off template, dependency links, and
// drag-to-reorder for operations — plus job templates above the list.
//
// Two of those differ from the web on purpose:
//
//   * `scheduleTeamMode` — its "1 Person per Op" / "Full Team per Op" toggle —
//     has no equivalent, because the pickers here hold SEVERAL people. The
//     toggle exists there to widen a single-selection control; a multi-select
//     one makes it a setting with nothing to switch.
//   * "Create new Department" is not offered from this form. On the web it
//     writes `orgSettings.roles` straight from the wizard, which would POST org
//     settings for everyone, mid-form, from a job that may still be cancelled.
//
// What remains unported is step 3 itself: the availability check that says
// whether the people picked here are actually free, the AI suggestion, and the
// packer that lays operations onto real days.

struct JobsNewJobSheet: View {
    @Environment(\.tqTheme) private var theme

    let people: [Person]
    let clients: [Client]
    let customColumns: [JobsCustomColumn]
    /// `orgSettings.roles` — the department list the Dept pickers offer.
    var departments: [String] = []
    /// `orgSettings.signOffTemplates` — the approval chains a panel can start on.
    var signOffTemplates: [SignOffTemplate] = []
    /// The org whose job templates this form offers. Per device AND per org, as
    /// the web keeps them — see `JobsTemplateStore`.
    var orgCode: String = ""
    /// Everything step 3 needs to find a window: what else is already booked,
    /// the work calendar, and today. Passed in rather than reached for, so this
    /// sheet still touches no AppState.
    var scheduling = JobsSchedulingContext()
    /// Called with a finished job. The caller writes it — this sheet never
    /// touches AppState.
    let create: (Job) -> Void
    var phase: TQModalPhase = .presenting
    let dismiss: () -> Void

    @State private var step = 1
    @State private var draft = JobDraft()
    @State private var panels: [PanelDraft] = []
    @State private var templateStore = JobsTemplateStore()
    /// Step 3. nil until the check has been run.
    @State private var windows: [ScheduleWindow]?
    @State private var checking = false
    /// The job the windows were computed AGAINST, kept so "Use This Schedule"
    /// applies them to that exact instance.
    ///
    /// Not a nicety: `build()` mints a fresh id for every quantity copy after
    /// the first, so calling it twice produces different operation ids. The
    /// placements name the ids from the first call, so applying them to a second
    /// build would silently drop every copy past the original — a job with
    /// `qty: 12` would come out with one panel scheduled and eleven blank.
    @State private var scheduledDraft: Job?
    /// The name being typed into Save Template, or nil while it is not open.
    @State private var savingTemplate: String?

    var body: some View {
        TQModal(width: 720, maxHeight: 680, phase: phase, dismiss: dismiss) {
            header
            TQModalRule()
            ScrollView(.vertical) {
                Group {
                    switch step {
                    case 1:  detailsStep
                    case 2:  operationsStep
                    default: scheduleStep
                    }
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
                      subtitle: {
                          switch step {
                          case 1:  return "Job details"
                          case 2:  return nil
                          default: return "Pick a start date \u{2014} people are assigned with it"
                          }
                      }(),
                      dismiss: dismiss) {
            HStack(spacing: 6) {
                // THREE dots, because the wizard has three steps — and all
                // three are reachable now.
                stepDot(1); stepDot(2); stepDot(3)
                Text("Step \(step) of 3")
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
            templateBar
            if panels.isEmpty {
                VStack(spacing: 8) {
                    WebGlyph(spec: WebIcon.emptyJobs, size: 32, color: theme.textDim)
                        .opacity(0.4)
                    Text("No operations yet")
                        .font(TFont.body(14, 700))
                        .foregroundStyle(theme.text)
                    Text("A job needs at least one operation before it can be saved.")
                        .font(TFont.body(12))
                        .foregroundStyle(theme.textDim)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
            }

            ForEach($panels) { $panel in
                PanelEditor(panel: $panel, people: people,
                            departments: departments,
                            signOffTemplates: signOffTemplates) {
                    panels.removeAll { $0.id == panel.id }
                }
            }

            Button { panels.append(PanelDraft()) } label: {
                HStack(spacing: 6) {
                    WebGlyph(spec: WebIcon.plus, size: 11, color: theme.accent)
                    Text("Add Operation").font(TFont.body(12, 700))
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
                Text("\(panels.count) operation\(panels.count == 1 ? "" : "s") on the form "
                     + "\u{2192} \(totalPanels) will be created, from the quantities set above.")
                    .font(TFont.body(11))
                    .foregroundStyle(theme.accent)
            }
        }
    }

    private var totalPanels: Int { panels.reduce(0) { $0 + max(1, $1.quantity) } }

    // MARK: Templates
    //
    // `TemplateDrop` + `Save Template`, the pair the web puts above the operation
    // list. Loading APPENDS rather than replaces — the web's `loadTemplate` does
    // the same, so two templates can be stacked into one job.

    private var templateBar: some View {
        HStack(spacing: 8) {
            Text("Operations")
                .font(TFont.body(11, 700))
                .tracking(11 * -0.045)
                .textCase(.uppercase)
                .foregroundStyle(theme.textDim)

            Spacer(minLength: 0)

            TQTemplatePicker(templates: templateStore.templates,
                             load: { template in
                                 withAnimation(.easeOut(duration: 0.2)) {
                                     // Fresh ids, links remapped with them, so
                                     // loading the same template twice cannot
                                     // collide — see `PanelDraft.reIdentified`.
                                     panels.append(contentsOf:
                                        template.panels.map { $0.reIdentified() })
                                 }
                             },
                             delete: { templateStore.delete($0) })

            if savingTemplate == nil {
                Button { savingTemplate = "" } label: {
                    Text("Save Template")
                        .font(TFont.body(11, 700))
                        .foregroundStyle(theme.accent)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(theme.accent.opacity(0.07)))
                        .overlay(Capsule().strokeBorder(theme.accent.opacity(0.3),
                                                        lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(!hasNamedPanel)
                .opacity(hasNamedPanel ? 1 : 0.4)
                .help(hasNamedPanel ? "Save these operations for reuse"
                      : "Name at least one operation first")
            } else {
                saveTemplateField
            }
        }
        .onAppear { templateStore.load(orgCode: orgCode) }
    }

    /// The web gates Save Template on `subs.some(p => p.title?.trim())` — a
    /// template of unnamed panels recreates nothing worth having.
    private var hasNamedPanel: Bool {
        panels.contains { !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    @ViewBuilder
    private var saveTemplateField: some View {
        HStack(spacing: 5) {
            TextField("Template name\u{2026}", text: Binding(
                get: { savingTemplate ?? "" }, set: { savingTemplate = $0 }))
                .textFieldStyle(.plain)
                .font(TFont.body(11))
                .frame(width: 130)
                .onSubmit { commitTemplate() }
            Button(action: commitTemplate) {
                Text("Save")
                    .font(TFont.body(11, 700))
                    .foregroundStyle(theme.accentText)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Capsule().fill(theme.accent))
            }
            .buttonStyle(.plain)
            .disabled((savingTemplate ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
            Button { savingTemplate = nil } label: {
                Text("\u{00D7}").font(.system(size: 12)).foregroundStyle(theme.textDim)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Capsule().fill(theme.surface))
        .overlay(Capsule().strokeBorder(theme.accent, lineWidth: 1))
    }

    private func commitTemplate() {
        guard let name = savingTemplate else { return }
        templateStore.save(name: name, panels: panels)
        savingTemplate = nil
    }

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
            } else if step == 2 {
                TQModalButton(label: "\u{2190} Back", style: .quiet) {
                    withAnimation(.snappy(duration: 0.22)) { step = 1 }
                }
                Spacer(minLength: 0)
                // SAVE FOR LATER FIRST, then Schedule & Assign. Swapped from the
                // other order: the primary action on this step is scheduling, and
                // the primary action belongs on the right where the eye and the
                // pointer finish.
                TQModalButton(label: "Save for Later", style: .quiet,
                              enabled: !panels.isEmpty,
                              help: panels.isEmpty ? "Add at least one operation"
                                    : "Create it now and schedule it later from TRAQS Cloud") {
                    create(build())
                    dismiss()
                }
                TQModalButton(label: "Schedule & Assign \u{2192}",
                              enabled: canSchedule,
                              help: scheduleBlockedReason) {
                    withAnimation(.snappy(duration: 0.22)) { step = 3 }
                    runAvailabilityCheck()
                }
            } else {
                TQModalButton(label: "\u{2190} Back", style: .quiet) {
                    withAnimation(.snappy(duration: 0.22)) { step = 2 }
                    windows = nil
                }
                Spacer(minLength: 0)
                TQModalButton(label: "Save for Later", style: .quiet,
                              help: "Create it unscheduled instead") {
                    create(build())
                    dismiss()
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: Step 3 — Schedule & Assign

    /// What the scheduler needs from outside this sheet.
    struct JobsSchedulingContext {
        var people: [Person] = []
        var jobs: [Job] = []
        var calendar = WorkCalendar()
        var orgHpd: Double = 7.5
        var departments: [String] = []
        /// `TD`. Held rather than read at use, so the whole step agrees on the
        /// day even if it straddles midnight.
        var today: String = ""
    }

    private var canSchedule: Bool {
        !panels.isEmpty && panels.contains { panel in
            !panel.title.trimmingCharacters(in: .whitespaces).isEmpty
                || panel.operations.contains { !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }
        }
    }

    private var scheduleBlockedReason: String? {
        if panels.isEmpty { return "Add at least one operation" }
        if !canSchedule { return "Name an operation first" }
        return nil
    }

    /// Build the job as it stands, ask for windows, and show them.
    ///
    /// Off the main actor would be wrong here and right later: the walk is
    /// bounded at 200 candidate days and is arithmetic over a dictionary, so it
    /// is milliseconds. If a very large org ever makes it visible, the fix is to
    /// hop it — not to trim the scan.
    private func runAvailabilityCheck() {
        checking = true
        windows = nil
        let draftJob = build()
        scheduledDraft = draftJob
        let units = JobsScheduler.units(of: draftJob, orgHpd: scheduling.orgHpd,
                                        departmentNames: Set(scheduling.departments))
        let crew = JobsScheduler.schedulableCrew(scheduling.people)
        let bookings = JobsScheduler.bookingIndex(
            JobsScheduler.bookings(in: scheduling.jobs, people: scheduling.people,
                                   excluding: draftJob.id))

        let found = JobsScheduler.windows(JobsScheduler.Request(
            units: units, crew: crew, calendar: scheduling.calendar,
            bookings: bookings,
            today: scheduling.today.isEmpty ? JobsDate.todayKey : scheduling.today))

        withAnimation(.easeOut(duration: 0.2)) {
            windows = found
            checking = false
        }
    }

    @ViewBuilder
    private var scheduleStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            if checking {
                VStack(spacing: 12) {
                    ProgressView().controlSize(.small)
                    Text("Checking availability\u{2026}")
                        .font(TFont.body(13))
                        .foregroundStyle(theme.textSec)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 44)
            } else if let windows {
                if windows.isEmpty {
                    noWindows
                } else {
                    Text("Soonest start dates")
                        .font(TFont.body(11, 700))
                        .tracking(11 * -0.045)
                        .textCase(.uppercase)
                        .foregroundStyle(theme.textDim)
                    ForEach(windows) { window in
                        windowCard(window)
                    }
                }
            }
        }
    }

    private var noWindows: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("No window found")
                .font(TFont.body(14, 700))
                .foregroundStyle(theme.danger)
            Text("Nobody is free for long enough in the next 200 working days. "
                 + "Save it for later and schedule it from TRAQS Cloud, or free somebody up.")
                .font(TFont.body(12))
                .foregroundStyle(theme.textSec)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(theme.danger.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(theme.danger.opacity(0.25), lineWidth: 1))
    }

    private func windowCard(_ window: ScheduleWindow) -> some View {
        let named = { (id: String) in
            scheduling.people.first { $0.id == id }?.name ?? id
        }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(JobsDate.short(window.start)) \u{2192} \(JobsDate.short(window.end))")
                        .font(TFont.body(14, 700))
                        .foregroundStyle(theme.text)
                    Text("\(window.totalDays) working day\(window.totalDays == 1 ? "" : "s")")
                        .font(TFont.body(11))
                        .foregroundStyle(theme.textDim)
                }
                Spacer(minLength: 0)
                TQModalButton(label: "Use This Schedule") {
                    // The job the windows were computed against — see
                    // `scheduledDraft` for why this cannot be a fresh `build()`.
                    guard let base = scheduledDraft else { return }
                    create(JobsScheduler.applying(window, to: base))
                    dismiss()
                }
            }

            // Who each unit landed on — the part that makes this "and Assign"
            // rather than just a date.
            VStack(alignment: .leading, spacing: 3) {
                ForEach(window.placements, id: \.unitID) { place in
                    HStack(spacing: 6) {
                        Text(unitTitle(place.unitID))
                            .font(TFont.body(11, 600))
                            .foregroundStyle(theme.text)
                            .lineLimit(1)
                        Text(JobsDate.short(place.start))
                            .font(TFont.mono(10))
                            .foregroundStyle(theme.textDim)
                        Spacer(minLength: 0)
                        Text(place.team.map(named).joined(separator: ", "))
                            .font(TFont.body(11))
                            .foregroundStyle(theme.accent)
                            .lineLimit(1)
                    }
                }
            }
            .padding(.top, 2)

            if !window.busy.isEmpty {
                Text("Busy: " + window.busy.map(named).joined(separator: ", "))
                    .font(TFont.body(10))
                    .foregroundStyle(theme.textDim)
                    .strikethrough()
                    .lineLimit(1)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(theme.border, lineWidth: 1))
    }

    /// The title of a unit by id, for the placement list. Looked up on the FORM
    /// rather than on the built job, so an unnamed row still reads as something.
    private func unitTitle(_ id: String) -> String {
        for panel in panels {
            if panel.id == id {
                return panel.title.isEmpty ? "Operation" : panel.title
            }
            for op in panel.operations where op.id == id {
                return op.title.isEmpty ? "Sub-operation" : op.title
            }
        }
        return "Operation"
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
                      // `job.team` is what the grid's Team column shows at level
                      // 0 and what a notification is addressed to. Derived from
                      // the rows rather than left empty: a job created with three
                      // people on it that reported none would be wrong on the
                      // page it lands on.
                      team: assignedPeople(),
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
    /// Everyone assigned to any row on the form, de-duplicated and in the order
    /// they appear. The project manager is NOT included — the web keeps
    /// `projectManagerId` separate from `team`.
    private func assignedPeople() -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for panel in panels {
            for id in panel.team + panel.operations.flatMap(\.team)
            where !id.isEmpty && seen.insert(id).inserted {
                ordered.append(id)
            }
        }
        return ordered
    }

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
                         : "\(base)-\(String(format: "%03d", i + 1))",
                    // Only meaningful on a leaf panel; with operations the grid
                    // sums theirs. Written either way, as the web does.
                    hpd: draft.hours)
                // Ids are rewritten on every copy after the first, so a
                // dependency has to be remapped with them — pointing at the
                // ORIGINAL operation would link copy 2 back to copy 1.
                var idFor: [String: String] = [:]
                for op in draft.operations {
                    idFor[op.id] = i == 0 ? op.id : UUID().uuidString
                }
                panel.subs = draft.operations.map { op in
                    var operation = Operation.empty(
                        id: idFor[op.id] ?? op.id,
                        title: op.title, hpd: op.hours)
                    operation.team = op.team
                    operation.deps = draft.dependencies(of: op.id).compactMap { idFor[$0] }
                    if !op.department.isEmpty {
                        operation.extras.set("requiredDepartment", .string(op.department))
                    }
                    return operation
                }
                if let mode = draft.depsMode, draft.liveLinks.count > 1 {
                    panel.extras.set("depsMode", .string(mode))
                }
                // The panel's own assignment, and only when it is a leaf — a
                // panel with operations carries the team on each of them, and
                // holding both is the state the web warns about.
                if draft.operations.isEmpty { panel.team = draft.team }
                if !draft.color.isEmpty { panel.extras.set("color", .string(draft.color)) }
                if let template = draft.signOffTemplateID {
                    // An EMPTY record set: the template's steps exist and none is
                    // signed, which is what `JobsApproval.state` reads as a chain
                    // with everything outstanding. The web seeds it the same way —
                    // a key with an object under it, not a populated one.
                    panel.extras.set("signOffs", .object([template: .object([:])]))
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

struct PanelDraft: Identifiable, Codable, Equatable {
    /// `var`, not `let`, so a template can be loaded into fresh ids — see
    /// `reIdentified`.
    var id = UUID().uuidString
    var title = ""
    /// `qty` — how many copies of this panel to create. The web caps it at 999.
    var quantity = 1
    /// `requiredDepartment`. It was here and nothing ever set it — `build()`
    /// wrote it to `extras` from a field the form never showed.
    var department = ""
    /// `panel.team`. Only meaningful when the panel has no operations: with
    /// operations the assignment belongs on each one, which is what the web's
    /// own warning says ("N workers assigned directly to this panel — but
    /// sub-operations now exist").
    var team: [String] = []
    /// `panel.color`. Empty until somebody picks one, and only then written —
    /// a panel without one inherits the job's, which is what the grid draws.
    var color = ""
    /// `panel.signOffs` — which sign-off template this panel runs, if any.
    ///
    /// The web lets a panel carry several; the Approval column can only show ONE
    /// (`forPanel` takes the first template with an entry), so offering more than
    /// one here would let somebody set up something the grid cannot display.
    var signOffTemplateID: String?
    /// Which operations are linked to each other — `sub.deps`.
    ///
    /// A SET of ids rather than per-operation `deps` arrays, because the web's
    /// model is a mutual GROUP: every linked operation lists all the others.
    /// Storing the group once and deriving `deps` at build time cannot produce
    /// the half-linked states an array-per-row can, and it removes the need for
    /// the web's `__pending__` sentinel — which exists only so the first
    /// operation ticked reads as linked before a second one is.
    var linkedOperations: Set<String> = []
    /// `panel.depsMode` — nil (free) · "unlocked" · "locked". Set to "unlocked"
    /// by the first link, exactly as the web does, and cleared when the last one
    /// goes.
    var depsMode: String?

    /// The linked ids that still name an operation that EXISTS, in the
    /// operations' own order.
    ///
    /// Deleting a linked operation would otherwise leave its id in the group:
    /// the pill would count it, and a group of "two" could survive with one real
    /// member. Everything reads this rather than the raw set.
    var liveLinks: [String] {
        operations.map(\.id).filter { linkedOperations.contains($0) }
    }

    /// `deps` for one operation: everyone else in the group, or nothing when it
    /// is not in it. A group of ONE is not a dependency, so it produces none.
    func dependencies(of operationID: String) -> [String] {
        let live = liveLinks
        guard live.count > 1, live.contains(operationID) else { return [] }
        return live.filter { $0 != operationID }
    }

    /// A copy with fresh ids throughout, links remapped with them.
    ///
    /// Loading a template APPENDS its panels to the form, and the same template
    /// can be loaded twice — so the ids in it cannot be reused, and a dependency
    /// group has to follow the new ones or it would point at the first copy's
    /// operations. Exactly the remapping `expandedPanels` does for quantity.
    func reIdentified() -> PanelDraft {
        var copy = self
        copy.id = UUID().uuidString
        var idFor: [String: String] = [:]
        copy.operations = operations.map { op in
            var next = op
            next.id = UUID().uuidString
            idFor[op.id] = next.id
            return next
        }
        copy.linkedOperations = Set(linkedOperations.compactMap { idFor[$0] })
        return copy
    }

    /// Drop an operation and anything that referred to it.
    mutating func removeOperation(_ operationID: String) {
        operations.removeAll { $0.id == operationID }
        linkedOperations.remove(operationID)
        if liveLinks.count < 2 {
            linkedOperations.removeAll()
            depsMode = nil
        }
    }

    /// Tick or untick one operation, keeping `depsMode` in step — the web writes
    /// both together and they disagree if only one moves.
    mutating func toggleLink(_ operationID: String) {
        if linkedOperations.contains(operationID) {
            linkedOperations.remove(operationID)
            if liveLinks.count < 2 {
                linkedOperations.removeAll()
                depsMode = nil
            }
        } else {
            linkedOperations.insert(operationID)
            if depsMode == nil, liveLinks.count > 1 { depsMode = "unlocked" }
        }
    }
    /// `panel.hpd`, used only when the panel has no operations. With them the
    /// figure is their SUM and is not editable — the web shows the same.
    var hours: Double = 7.5
    var operations: [OperationDraft] = []

    /// What the Hrs column will show for this panel.
    var totalHours: Double {
        operations.isEmpty ? hours : operations.reduce(0) { $0 + $1.hours }
    }
}

struct OperationDraft: Identifiable, Codable, Equatable {
    var id = UUID().uuidString
    var title = ""
    /// `op.hpd` — the TOTAL productive hours for the operation, not a daily rate.
    /// See `opHrs` in the grid: the web displays it directly and multiplying by
    /// days was the legacy bug that inflated every multi-day operation.
    var hours: Double = 7.5
    var department = ""
    /// `op.team`. An ARRAY, so the web's "Full Team per Op" is expressible —
    /// `scheduleTeamMode` toggles between one person and the whole team there,
    /// and a picker that holds several makes the toggle unnecessary rather than
    /// unimplemented.
    var team: [String] = []
}

// MARK: One panel on the form

private struct PanelEditor: View {
    @Environment(\.tqTheme) private var theme

    @Binding var panel: PanelDraft
    let people: [Person]
    let departments: [String]
    let signOffTemplates: [SignOffTemplate]
    let remove: () -> Void

    /// Which operation row a drag is currently over.
    @State private var dropTarget: String?
    @State private var depsOpen = false

    /// Move one operation to where another sits. Same rule as the grid's row
    /// reorder — dropping onto a row below you lands after it, onto one above
    /// takes its place — expressed directly here because the list is short and
    /// held in an array rather than behind an id order.
    private func move(_ dragged: String, onto target: String) {
        guard let from = panel.operations.firstIndex(where: { $0.id == dragged }),
              let to = panel.operations.firstIndex(where: { $0.id == target })
        else { return }
        withAnimation(.easeOut(duration: 0.18)) {
            let moved = panel.operations.remove(at: from)
            let insertAt = panel.operations.firstIndex { $0.id == target }
                .map { from < to ? $0 + 1 : $0 } ?? to
            panel.operations.insert(moved, at: min(insertAt, panel.operations.count))
        }
    }

    /// Who a row may be assigned to.
    ///
    /// A DEPARTMENT FILTERS THE LIST. When a row names one, only that
    /// department's members are offered — the standing rule for this app, and
    /// the reason Dept sits to the left of Assignee on the row: it is the thing
    /// you choose first.
    ///
    /// A department nobody belongs to falls back to the whole roster rather than
    /// offering an empty menu, which would read as broken.
    private func candidates(for department: String) -> [Person] {
        guard !department.isEmpty else { return people }
        // `Person.role` IS the department. Its decoder prefers the raw
        // `department` key and falls back to the legacy `role` — the same
        // `p.department ?? p.role ?? ""` the web normalises with — so the field
        // is named for the older shape and holds the newer one.
        let inDept = people.filter { $0.role == department }
        return inDept.isEmpty ? people : inDept
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                // `panel.color` — the 14pt dot the web puts left of the name, and
                // what the schedule draws this panel's bars in.
                TQColorSwatch(hex: $panel.color, size: 18,
                              help: panel.color.isEmpty
                                    ? "Colour \u{2014} inherits the job\u{2019}s until set"
                                    : "Colour \u{2014} \(panel.color)")

                TextField("Operation name\u{2026}", text: $panel.title)
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

                // HOURS, editable only while the panel has no operations — with
                // them the figure is their sum, which is exactly what the web
                // shows (`panelHpdSum`, read-only and accent-coloured).
                hoursField

                Button(action: remove) {
                    WebGlyph(spec: WebIcon.trash, size: 13, color: theme.danger)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Remove this operation")
            }

            ForEach($panel.operations) { $op in
                // ONE line, in the same order as the panel row above it: name,
                // then the pickers, then hours, then remove. It was two lines
                // with Dept and Assignee stretched underneath, which made an
                // operation look like a section rather than a row.
                HStack(spacing: 8) {
                        // `⠿ Drag to reorder` — the web makes each sub-operation
                        // row draggable within its panel. Handle-only here, for
                        // the same reason the grid's row reorder is: the row is
                        // full of text fields and a whole-row drag would fight
                        // selecting text in them.
                        Text("\u{283F}")
                            .font(.system(size: 11))
                            .foregroundStyle(theme.textDim.opacity(0.45))
                            .padding(.leading, 2)
                            .contentShape(Rectangle())
                            .pointerStyle(.grabActive)
                            .draggable(op.id) {
                                Text(op.title.isEmpty ? "Sub-operation" : op.title)
                                    .font(TFont.body(11, 600))
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .background(Capsule().fill(theme.accent.opacity(0.16)))
                            }
                            .help("Drag to reorder")
                        TextField("Sub-operation name\u{2026}", text: $op.title)
                            .textFieldStyle(.plain)
                            .font(TFont.body(12))
                            .foregroundStyle(theme.text)
                            .frame(maxWidth: .infinity)

                        // Dept then Assignee, in that order because the first
                        // filters the second.
                        TQDepartmentPicker(department: $op.department,
                                           departments: departments)
                            .frame(width: 104)
                        TQPeoplePicker(people: candidates(for: op.department),
                                       selection: $op.team)
                            .frame(width: 150)

                        HStack(spacing: 3) {
                            TextField("7.5", value: $op.hours, format: .number)
                                .textFieldStyle(.plain)
                                .font(TFont.mono(11))
                                .frame(width: 30)
                                .multilineTextAlignment(.trailing)
                            Text("h").font(TFont.body(10)).foregroundStyle(theme.textDim)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(Capsule().fill(theme.surface))
                        .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))

                        Button {
                            panel.removeOperation(op.id)
                        } label: {
                            Text("\u{2715}").font(.system(size: 10))
                                .foregroundStyle(theme.textDim)
                                .frame(width: 20, height: 20)
                        }
                        .buttonStyle(.plain)
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(theme.bg.opacity(0.5)))
                .overlay(alignment: .top) {
                    if dropTarget == op.id {
                        Rectangle().fill(theme.accent).frame(height: 2)
                    }
                }
                .dropDestination(for: String.self) { ids, _ in
                    dropTarget = nil
                    guard let dragged = ids.first, dragged != op.id else { return false }
                    move(dragged, onto: op.id)
                    return true
                } isTargeted: { over in
                    dropTarget = over ? op.id : (dropTarget == op.id ? nil : dropTarget)
                }
            }

            HStack(spacing: 8) {
                Button { panel.operations.append(OperationDraft()) } label: {
                    HStack(spacing: 5) {
                        WebGlyph(spec: WebIcon.plus, size: 9, color: theme.textSec)
                        Text("Add Sub-operation").font(TFont.body(11, 600))
                            .foregroundStyle(theme.textSec)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Spacer(minLength: 0)

                // The panel's own department and assignees, ON THIS ROW with the
                // other per-panel pickers rather than on a line of their own —
                // full width they read as two more fields of the form, which is
                // not what they are.
                //
                // Only while the panel has NO operations: once it does the
                // assignment belongs on each one, and the web says so in its own
                // warning ("N workers assigned directly to this panel — but
                // sub-operations now exist").
                if panel.operations.isEmpty {
                    TQDepartmentPicker(department: $panel.department,
                                       departments: departments)
                        .frame(width: 104)
                    TQPeoplePicker(people: candidates(for: panel.department),
                                   selection: $panel.team)
                        .frame(width: 150)
                }

                // `Dependencies` — only once there are two operations to link.
                if panel.operations.count >= 2 { dependencyPicker }

                // `Sign-Off` — which approval chain this panel starts life with.
                // Seeds `panel.signOffs[templateId]`, which is exactly what the
                // Approval column then reads; see JobsApproval's precedence.
                TQSignOffPicker(selection: $panel.signOffTemplateID,
                                templates: signOffTemplates)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(theme.border, lineWidth: 1))
    }

    /// The `Dependencies` pill and its list.
    ///
    /// Linking is MUTUAL: ticking two operations makes each depend on the other,
    /// which is the web's group model. The lock mode below it is what the row
    /// menu's dependency toggle cycles on an existing job —
    ///
    ///   unlocked  the group moves together, and may be re-ordered
    ///   locked    the group moves together and keeps its order
    ///
    /// — and it only appears once something is actually linked, because a mode
    /// with no group is a setting about nothing.
    @ViewBuilder
    private var dependencyPicker: some View {
        let linked = panel.liveLinks.count
        Button { depsOpen = true } label: {
            HStack(spacing: 5) {
                WebGlyph(spec: linked > 1 ? WebIcon.lockClosed : WebIcon.lockOpen,
                         size: 10, color: linked > 1 ? theme.accent : theme.textDim)
                Text(linked > 1 ? "\(linked) linked" : "Dependencies")
                    .font(TFont.body(11, linked > 1 ? 700 : 400))
                    .foregroundStyle(linked > 1 ? theme.accent : theme.textDim)
                WebGlyph(spec: WebIcon.chevronDown, size: 8, color: theme.textDim)
            }
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(linked > 1 ? theme.accent.opacity(0.07) : .clear))
            .overlay(Capsule().strokeBorder(
                linked > 1 ? theme.accent.opacity(0.35) : theme.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help("Link sub-operations so they schedule together")
        .popover(isPresented: $depsOpen, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Link sub-operations")
                    .font(TFont.body(10, 700))
                    .tracking(10 * -0.045)
                    .textCase(.uppercase)
                    .foregroundStyle(theme.textDim)
                    .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 4)

                ForEach(panel.operations) { op in
                    linkRow(op)
                }

                if panel.liveLinks.count > 1 {
                    Rectangle().fill(theme.border).frame(height: 1)
                        .padding(.vertical, 4)
                    modeRow("unlocked", "Unlocked", WebIcon.lockOpen,
                            "They move together and can be reordered")
                    modeRow("locked", "Locked", WebIcon.lockClosed,
                            "They move together and keep their order")
                }
            }
            .padding(.vertical, 4)
            .frame(width: 250, alignment: .leading)
        }
    }

    private func linkRow(_ op: OperationDraft) -> some View {
        let on = panel.linkedOperations.contains(op.id)
        return Button {
            panel.toggleLink(op.id)
        } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(on ? theme.accent : .clear)
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(on ? theme.accent : theme.border, lineWidth: 2))
                    .overlay { if on { WebGlyph(spec: WebIcon.tick, size: 8, color: .white) } }
                    .frame(width: 16, height: 16)
                Text(op.title.isEmpty ? "Unnamed" : op.title)
                    .font(TFont.body(12, on ? 600 : 400))
                    .foregroundStyle(on ? theme.accent
                                     : (op.title.isEmpty ? theme.textDim : theme.text))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func modeRow(_ mode: String, _ label: String,
                         _ glyph: GlyphSpec, _ help: String) -> some View {
        let on = panel.depsMode == mode
        return Button { panel.depsMode = mode } label: {
            HStack(spacing: 8) {
                WebGlyph(spec: glyph, size: 11, color: on ? theme.accent : theme.textDim)
                Text(label)
                    .font(TFont.body(12, on ? 600 : 400))
                    .foregroundStyle(on ? theme.accent : theme.text)
                Spacer(minLength: 0)
                if on { WebGlyph(spec: WebIcon.tick, size: 10, color: theme.accent) }
            }
            .padding(.horizontal, 14).padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }

    /// `panel.hpd` while the panel is a leaf; `panelHpdSum` once it has
    /// operations, read-only and accent-coloured exactly as the web draws it.
    @ViewBuilder
    private var hoursField: some View {
        HStack(spacing: 3) {
            if panel.operations.isEmpty {
                TextField("7.5", value: $panel.hours, format: .number)
                    .textFieldStyle(.plain)
                    .font(TFont.mono(12))
                    .frame(width: 34)
                    .multilineTextAlignment(.trailing)
            } else {
                Text(JobsDate.hours(panel.totalHours))
                    .font(TFont.mono(12, 700))
                    .foregroundStyle(theme.accent)
                    .frame(width: 34, alignment: .trailing)
            }
            Text("h")
                .font(TFont.body(10))
                .foregroundStyle(panel.operations.isEmpty ? theme.textDim : theme.accent)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(Capsule().fill(theme.surface))
        .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))
        .help(panel.operations.isEmpty
              ? "Estimated total hours for this operation"
              : "Sum of its operations\u{2019} hours")
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

    /// `t.scheduledLater`. Not a modelled field — it rides on `Job.extras`, and
    /// before that existed this read was always false on the Mac because saving
    /// stripped the flag.
    ///
    /// Static and non-private because the GRID asks it too: a job waiting in the
    /// cloud shows PENDING in its Start and End cells instead of a date, at every
    /// level. One reader, so the two cannot disagree about what the flag means —
    /// the server has written it as both a bool and the string "true".
    static func isScheduledLater(_ job: Job) -> Bool {
        switch job.extras["scheduledLater"] {
        case .bool(let b):   return b
        case .string(let s): return s == "true"
        default:             return false
        }
    }

    /// `tasks.filter(t => t.scheduledLater)`.
    private var pending: [Job] { jobs.filter(Self.isScheduledLater) }

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
                Text("\(job.subs.count) operation\(job.subs.count == 1 ? "" : "s") \u{00B7} \(ops) sub-operation\(ops == 1 ? "" : "s")"
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
