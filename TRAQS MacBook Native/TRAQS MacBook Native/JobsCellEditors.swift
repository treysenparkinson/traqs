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

// MARK: - The option list every picker opens
//
// `statusPopover` (TRAQS.jsx:26307) and `ccSelectPopover` (:26333) are the same
// control over different lists, so they are one component here.
//
// Exactly what the web draws, and it is NOT a stack of chips — that is what this
// replaced. It is a plain list on a card:
//
//   card   `T.card`, 1px `T.border`, `radiusSm`, `padding: 4px 0`, min-width 168,
//          shadow `0 8px 28px rgba(0,0,0,0.35)`, entering with `menuIn` 0.15s
//   row    `padding: 8px 14px`, `gap: 8`, a 13pt icon in the option's colour, a
//          13pt label, and a tick on the current one
//   state  current row sits on `colour + "12"`; hover is `colour + "18"`
//
// Two motions, and they are different in kind:
//
//   ENTER  each row plays `toolDrop` — 7pt up, fading in, 0.14s — staggered 38ms
//          apart, REVERSED when the menu opened upward so the deal always travels
//          away from the pointer. Same rule as the context menus; `TQMenuCascade`
//          already implements it.
//   PICK   the chosen row FLASHES (`optFlash`: a tint that rises and falls while
//          the row scales 1 → 1.025 → 0.99 → 1) and the commit waits 150ms for it.
//          A pass-through animation, so it is keyframed — `withAnimation` would
//          interpolate straight from rest to rest and show nothing.

struct JobsOptionRow: Identifiable, Equatable {
    /// The value committed when this row is picked. Empty clears.
    let value: String
    let label: String
    let icon: String?
    let color: Color
    /// Drawn, and refused, with a reason on hover. Finished is this for a
    /// non-approver: the web makes them go through Request Completion instead.
    var enabled: Bool = true
    var help: String? = nil

    var id: String { value.isEmpty ? "__none__" : value }

    static func == (a: JobsOptionRow, b: JobsOptionRow) -> Bool {
        a.value == b.value && a.label == b.label && a.icon == b.icon
            && a.enabled == b.enabled
    }
}

struct JobsOptionList: View {
    @Environment(\.tqTheme) private var theme

    let options: [JobsOptionRow]
    /// The value currently on the cell. Matched by `value`, so "" is "none".
    let current: String
    /// True when the menu opened ABOVE its anchor — reverses the row cascade.
    var up: Bool = false
    let pick: (String) -> Void

    /// Which row is mid-flash. `dropFlashKey` on the web.
    ///
    /// It IS cleared, and the version that did not was a latch waiting to happen:
    /// the tap guard below refuses a second pick while `flashing` is set, and the
    /// justification for never clearing it was that "picking closes the popover,
    /// so the row goes away" — an assumption about SwiftUI view lifetime that
    /// nothing guarantees. Any reuse of this view and every pick after the first
    /// is swallowed in silence.
    ///
    /// The reason it was left set is real, though: `flashing` cannot also be the
    /// keyframe trigger, because clearing it would flip that trigger a second time
    /// and replay the flash on the way out. So the trigger is `flashTick`, which
    /// only ever counts up.
    @State private var flashing: String?
    @State private var flashTick = 0
    @State private var hovering: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                row(option, at: index)
            }
        }
        // `padding: "4px 0"` — vertical only, so a row's tint runs the full width.
        .padding(.vertical, 4)
        .frame(minWidth: 168, alignment: .leading)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: TTheme.radiusSm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TTheme.radiusSm, style: .continuous)
                .strokeBorder(theme.border, lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.35), radius: 14, y: 8)
    }

    private func row(_ option: JobsOptionRow, at index: Int) -> some View {
        let isCurrent = option.value == current
        let isFlashing = flashing == option.id
        // The trigger is the counter, NOT `isFlashing` — see `flashTick`.
        let tick = isFlashing ? flashTick : 0

        return HStack(spacing: 8) {
            Text(option.icon ?? "")
                .font(TFont.body(13))
                .foregroundStyle(option.color)
                .frame(width: 13, alignment: .center)

            Text(option.label)
                .font(TFont.body(13, isCurrent ? 600 : 400))
                .foregroundStyle(isCurrent ? option.color : theme.text)
                .lineLimit(1)

            Spacer(minLength: 8)

            if isCurrent {
                WebGlyph(spec: WebIcon.tick, size: 12, color: option.color)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(wash(option, isCurrent: isCurrent, flashing: isFlashing))
        .opacity(option.enabled ? 1 : 0.45)
        .contentShape(Rectangle())
        .onHover { hovering = $0 ? option.id : (hovering == option.id ? nil : hovering) }
        .onTapGesture {
            guard option.enabled, !isCurrent, flashing == nil else { return }
            flash(option)
        }
        .help(option.help ?? "")
        // The entrance, shared with the context menus.
        .modifier(TQMenuCascade(index: index, total: options.count, up: up))
        // The flash. Scale passes THROUGH 1.025 and 0.99 and returns to 1, so it
        // has to be keyframed — see the note at the top of this section.
        //
        // The track is UNCONDITIONAL. Wrapping it in `if isFlashing` is what the
        // obvious version does and the type checker cannot even diagnose it
        // ("failed to produce diagnostic for expression"): `KeyframesBuilder` has
        // no empty branch to build, so the else side has no type. The trigger is
        // what decides whether anything plays — a keyframeAnimator sits at its
        // initial value until the trigger CHANGES, so a row that is not flashing
        // holds at scale 1 and costs nothing.
        .keyframeAnimator(initialValue: CGFloat(1), trigger: tick) { view, scale in
            view.scaleEffect(scale)
        } keyframes: { _ in
            KeyframeTrack {
                CubicKeyframe(1.025, duration: 0.06)
                CubicKeyframe(0.99, duration: 0.045)
                CubicKeyframe(1.0, duration: 0.045)
            }
        }
    }

    /// `optFlash` tints toward the option's colour and back; otherwise the
    /// current row sits on `+"12"` and a hovered one on `+"18"`.
    private func wash(_ option: JobsOptionRow, isCurrent: Bool, flashing: Bool) -> Color {
        if flashing { return option.color.opacity(0.19) }          // `a30` at peak
        if isCurrent { return option.color.opacity(0.07) }          // `+"12"`
        if hovering == option.id, option.enabled { return option.color.opacity(0.09) } // `+"18"`
        return .clear
    }

    /// Flash first, commit after. The 150ms is the web's own `setTimeout` — it is
    /// what makes a pick feel acknowledged rather than instantaneous-and-gone.
    private func flash(_ option: JobsOptionRow) {
        flashing = option.id
        flashTick += 1
        Task {
            try? await Task.sleep(for: .milliseconds(150))
            pick(option.value)
            // Released whether or not the pick closed anything, so the guard in
            // `onTapGesture` cannot latch this list shut. Clearing it does not
            // replay the flash: the keyframe trigger is `flashTick`.
            flashing = nil
        }
    }
}

// MARK: The status list

extension JobsOptionList {
    /// Every status, in the web's order.
    ///
    /// Finished is offered like any other and what happens when it is chosen is
    /// the caller's business — it raises a completion request rather than writing
    /// the status (`JobsEdit.needsCompletionRequest`).
    /// `styles` is this user's `statusOpts` — colour and glyph overrides keyed by
    /// name. The LIST itself is `JobStatus.allCases`, not the override list:
    /// names are not editable, because a job stores its status as a string that
    /// has to decode back into the enum. See `JobsOptionsEditor.namesLocked`.
    @MainActor static func statusOptions(
        styles: [String: JobsSelectOption] = [:]) -> [JobsOptionRow] {
        JobStatus.allCases.map { status in
            let style = styles[status.rawValue]
            return JobsOptionRow(value: status.rawValue, label: status.rawValue,
                                 icon: style?.icon ?? status.emblem,
                                 color: Color.hex(style?.color ?? status.hex))
        }
    }

    /// A custom select column's list. The blank sentinel becomes the CLEAR row.
    @MainActor
    static func selectOptions(_ options: [JobsSelectOption],
                              accent: Color, dim: Color) -> [JobsOptionRow] {
        options.map { option in
            option.isBlank
                ? JobsOptionRow(value: "", label: "None", icon: "\u{2014}", color: dim)
                : JobsOptionRow(value: option.name, label: option.name,
                                icon: option.icon ?? "\u{25CB}",
                                color: option.color.map { Color.hex($0) } ?? accent)
        }
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
