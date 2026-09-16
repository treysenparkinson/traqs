import SwiftUI

// MARK: - Edit Approval Steps
//
// `approvalModal` (TRAQS.jsx:27918). A list of steps, each a number-or-tick, a
// label field, an assignee picker and a remove button; plus "+ Add step", and a
// Save that refuses an empty list.
//
// SEEDED FROM WHATEVER CHAIN IS SHOWING, not from an empty list — that is the
// point of the feature. A panel running its default engineering steps opens here
// with those three already filled in and their signatures intact, so "add a
// fourth step" does not mean "retype the first three and lose who signed them".
// Saving then PROMOTES the panel to a custom `apprChain`; see
// `JobsApproval.settingChain` for why that is the intended outcome.
//
// Signed steps keep their signature through an edit. The web carries `done`,
// `by`, `byName` and `at` across in its `seed` and writes them back untouched,
// and this does the same by editing `ApprovalChainStep` values rather than
// rebuilding them — retyping a label must not un-sign the step.

struct JobsApprovalSheet: View {
    @Environment(\.tqTheme) private var theme

    /// The panel being edited, for the header.
    let title: String
    let people: [Person]
    /// The chain as it stands. Saving replaces it with whatever this becomes.
    let seed: [ApprovalChainStep]
    var phase: TQModalPhase = .presenting
    let save: ([ApprovalChainStep]) -> Void
    let dismiss: () -> Void

    @State private var steps: [ApprovalChainStep] = []
    /// Set once, from `seed`. Without the guard, every redraw while the sheet is
    /// open would throw away what has been typed.
    @State private var seeded = false

    /// `valid` — at least one step, and a step with no label is dropped on save,
    /// so a list of nothing but blanks is not a chain either.
    private var kept: [ApprovalChainStep] {
        steps.compactMap { step in
            let label = step.label.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !label.isEmpty else { return nil }
            var trimmed = step
            trimmed.label = label
            return trimmed
        }
    }

    private var valid: Bool { !kept.isEmpty }

    var body: some View {
        TQModal(width: 520, maxHeight: 600, phase: phase, dismiss: dismiss) {
            TQModalHeader(glyph: WebIcon.pencil, title: "Edit Approval Steps",
                          subtitle: title, dismiss: dismiss)
            TQModalRule()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Steps")
                            .font(TFont.body(11, 700))
                            .tracking(11 * -0.045)
                            .textCase(.uppercase)
                            .foregroundStyle(theme.textDim)
                        Spacer(minLength: 0)
                        addButton
                    }

                    if steps.isEmpty {
                        Text("No steps yet \u{2014} add the approval steps above.")
                            .font(TFont.body(12).italic())
                            .foregroundStyle(theme.textDim)
                            .padding(.vertical, 6)
                    } else {
                        VStack(spacing: 7) {
                            ForEach(steps.indices, id: \.self) { index in
                                stepRow(index)
                            }
                        }
                    }

                    if !valid {
                        Text("Add at least one approval step.")
                            .font(TFont.body(12, 500))
                            .foregroundStyle(theme.danger)
                    }
                }
                .padding(20)
            }

            TQModalRule()
            HStack(spacing: 10) {
                Spacer(minLength: 0)
                TQModalButton(label: "Cancel", style: .quiet) { dismiss() }
                TQModalButton(label: "Save", enabled: valid,
                              help: valid ? nil : "Add at least one approval step") {
                    save(kept)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
        }
        .onAppear {
            guard !seeded else { return }
            steps = seed
            seeded = true
        }
    }

    private var addButton: some View {
        Button {
            steps.append(ApprovalChainStep(label: ""))
        } label: {
            Text("+ Add step")
                .font(TFont.body(12, 700))
                .foregroundStyle(theme.accent)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Capsule().fill(Color.clear))
                // `1px dashed` on the web. SwiftUI's dash is on the stroke style.
                .overlay(Capsule().strokeBorder(
                    theme.accent.opacity(0.4),
                    style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func stepRow(_ index: Int) -> some View {
        // A signed step shows a tick instead of its number, and the whole point of
        // the seed: this survives the edit.
        let signed = steps[index].done

        return HStack(spacing: 8) {
            Group {
                if signed {
                    WebGlyph(spec: WebIcon.tick, size: 10, color: Color.hex("#10b981"))
                } else {
                    Text("\(index + 1)")
                        .font(TFont.body(11, 700))
                        .foregroundStyle(theme.textDim)
                }
            }
            .frame(width: 22, height: 22)
            .background(Circle().fill(signed ? Color.hex("#10b981").opacity(0.09)
                                             : theme.surface))
            .overlay(Circle().strokeBorder(signed ? Color.hex("#10b981").opacity(0.25)
                                                  : theme.border, lineWidth: 1))

            TextField("Step \(index + 1)", text: Binding(
                get: { steps.indices.contains(index) ? steps[index].label : "" },
                set: { if steps.indices.contains(index) { steps[index].label = $0 } }))
                .textFieldStyle(.plain)
                .font(TFont.body(13))
                .foregroundStyle(theme.text)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(Capsule().fill(theme.surface))
                .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))

            TQPersonPicker(people: people, selection: Binding(
                get: { steps.indices.contains(index) ? steps[index].assigneeId : nil },
                set: { if steps.indices.contains(index) { steps[index].assigneeId = $0 } }),
                           placeholder: "Anyone")
                .frame(width: 150)

            Button {
                guard steps.indices.contains(index) else { return }
                steps.remove(at: index)
            } label: {
                Text("\u{00D7}")
                    .font(TFont.body(14))
                    .foregroundStyle(theme.danger)
                    .frame(width: 26, height: 26)
                    .background(Circle().fill(Color.clear))
                    .overlay(Circle().strokeBorder(theme.border, lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Remove step")
        }
    }
}
