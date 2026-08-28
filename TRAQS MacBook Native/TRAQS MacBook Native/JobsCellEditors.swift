import SwiftUI

// MARK: - The editors a grid cell opens
//
// Three pieces, matching the web's three ways of changing a cell: an inline
// field, a status list, and a date picker.

// MARK: An inline field
//
// `tq-sq tq-bare` — a bare input sitting in the cell with a 1.5px accent ring and
// no fill of its own, so the row's background shows through and the text does not
// jump as it becomes editable.
//
// Enter commits, Escape cancels, and losing focus commits — the web's own
// `onBlur` / `onKeyDown` pair. Committing on blur is the one people rely on:
// clicking straight into the next cell has to keep what was typed.

struct JobsInlineField: View {
    let text: String
    let font: Font
    let accent: Color
    let ink: Color
    let commit: (String) -> Void
    let cancel: () -> Void

    @State private var draft: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("", text: $draft)
            .textFieldStyle(.plain)
            .font(font)
            .foregroundStyle(ink)
            .focused($focused)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 8).strokeBorder(accent, lineWidth: 1.5))
            .frame(maxWidth: .infinity, alignment: .leading)
            .onSubmit { commit(draft) }
            // Escape. `.onExitCommand` is delivered to the focused view, which is
            // exactly what this is while it is being typed into.
            .onExitCommand { cancel() }
            .onChange(of: focused) { _, nowFocused in
                // Committing on blur, not discarding. Clicking into the next cell
                // has to keep what was typed.
                if !nowFocused { commit(draft) }
            }
            .onAppear {
                draft = text
                focused = true
            }
    }
}

// MARK: The status list
//
// `setStatusPopover` (TRAQS.jsx:11875) — every status as its own pill, the current
// one ringed. Finished is offered like any other; what happens when it is chosen
// is the caller's business, and it raises a completion request rather than writing
// the status (see JobsEdit.needsCompletionRequest).

struct JobsStatusPopover: View {
    @Environment(\.tqTheme) private var theme
    let current: JobStatus
    let pick: (JobStatus) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(JobStatus.allCases, id: \.self) { status in
                Button { pick(status) } label: {
                    let color = Color.hex(status.hex)
                    HStack(spacing: 7) {
                        Text(status.emblem)
                            .font(TFont.body(12))
                            .frame(width: 14)
                        Text(status.rawValue)
                            .font(TFont.body(12, status == current ? 700 : 500))
                        Spacer(minLength: 8)
                        if status == current {
                            WebGlyph(spec: WebIcon.tick, size: 9, color: color)
                        }
                    }
                    .foregroundStyle(color)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(width: 190, alignment: .leading)
                    .background(Capsule().fill(color.opacity(status == current ? 0.14 : 0.06)))
                    .overlay(Capsule().strokeBorder(
                        color.opacity(status == current ? 0.4 : 0.15), lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(10)
    }
}

// MARK: The date picker
//
// The web uses its own `TraqsDatePicker` — a hand-built calendar, because a
// browser's native picker cannot be themed. macOS has no such problem, so this is
// a real `DatePicker` in `.graphical` style: same job, native behaviour, and one
// less calendar to keep correct.
//
// Empty means unset, which only the Due column allows. Start and End always have
// a day, so `clearable` is off for them and no Clear button appears.

struct JobsDatePopover: View {
    @Environment(\.tqTheme) private var theme
    let day: String
    var clearable: Bool = false
    let pick: (String) -> Void

    @State private var selection = Date()

    var body: some View {
        VStack(spacing: 10) {
            DatePicker("", selection: $selection, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()

            HStack(spacing: 8) {
                if clearable {
                    Button { pick("") } label: {
                        Text("Clear")
                            .font(TFont.body(12, 600))
                            .foregroundStyle(theme.danger)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(theme.danger.opacity(0.08)))
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
                Button { pick(JobsDate.key(from: selection)) } label: {
                    Text("Set")
                        .font(TFont.body(12, 700))
                        .foregroundStyle(theme.accentText)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(theme.accent))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(12)
        .frame(width: 280)
        .onAppear {
            // An unset or unparseable day opens on TODAY rather than on 1 January
            // 2001, which is where a bare `Date()` default would land after a
            // failed parse.
            selection = JobsDate.date(from: day) ?? Date()
        }
    }
}

// MARK: -

extension Alignment {
    /// The horizontal half of a cell alignment, for a `Text` that has to fill its
    /// cell to stay clickable but must not stretch vertically.
    var horizontalOnly: Alignment {
        switch horizontal {
        case .trailing: return .trailing
        case .center:   return .center
        default:        return .leading
        }
    }
}
