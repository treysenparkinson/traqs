import SwiftUI
import AppKit   // NSColor, for the option colour wells

// MARK: - The column header's own menus
//
// Three of them, and they are separate things:
//
//   `colCtxMenu`  (TRAQS.jsx:26149) — right-click a header. 224 wide.
//   `renameCol`   (:26120)          — a small popover with one field.
//   `colPickerOpen` (:11368)        — the "+" cell's add-column panel.
//
// The submenus (Edit Options, Add Column Left/Right) expand INLINE rather than
// flying out sideways, which is what the web does and is the right call on a
// 224pt card: a flyout at that width has nowhere to go.

// MARK: What the menus can do

struct JobsColumnMenuActions {
    var rename: (JobsGridColumn) -> Void = { _ in }
    var insert: (_ column: JobsCustomColumn, _ beside: JobsGridColumn,
                 _ side: JobsColumnLayout.InsertSide) -> Void = { _, _, _ in }
    var toggleGroupable: (JobsGridColumn) -> Void = { _ in }
    var delete: (JobsGridColumn) -> Void = { _ in }
    /// The options editor's Save. Replaces the whole list at once.
    var setOptions: (_ column: JobsCustomColumn, _ options: [JobsSelectOption]) -> Void = { _, _ in }
}

// MARK: The context menu

struct JobsColumnMenu: View {
    @Environment(\.tqTheme) private var theme

    let column: JobsGridColumn
    let isGroupable: Bool
    let placement: MenuPlacement.Context
    let actions: JobsColumnMenuActions
    let dismiss: () -> Void

    /// Which disclosure is open — only ever one. `colCtxMenu.subMenu`.
    @State private var open: Submenu?

    private enum Submenu: Equatable { case options, addLeft, addRight }

    /// The options editor exists for a column with a LIST behind it: the two
    /// standard ones the web lets you edit (`status`, `pri`) and any custom
    /// select column. Everything else has nothing to list.
    private var editsOptions: Bool {
        if let standard = column.standard { return standard == .status || standard == .pri }
        return column.custom?.type == .select && column.custom?.fieldKey == nil
    }

    var body: some View {
        TQMenuCard(up: placement.up, width: TQMenuMetrics.columnMenuWidth,
                   maxHeight: placement.maxHeight) {
            if editsOptions { optionsSection }

            JobsColumnMenuRow(glyph: WebIcon.pencil, label: "Rename Column",
                              cascade: cascade(1)) {
                dismiss()
                actions.rename(column)
            }

            addSection(.left)
            addSection(.right)

            JobsColumnMenuRow(glyph: nil, label: "Use for grouping",
                              checked: isGroupable, cascade: cascade(4)) {
                actions.toggleGroupable(column)
            }

            TQMenuDivider()

            JobsColumnMenuRow(glyph: WebIcon.trashColumn, label: "Delete Column",
                              destructive: true, cascade: cascade(5)) {
                dismiss()
                actions.delete(column)
            }
        }
    }

    /// Six slots, whether or not every row is drawn. The stagger is 38ms, so a
    /// gap in the sequence is 38ms of nothing rather than a visible fault — and
    /// the alternative, numbering only the rows that render, means the options
    /// section and Rename both claim index 0 and deal together.
    private func cascade(_ i: Int) -> TQMenuCascade {
        TQMenuCascade(index: i, total: 6, up: placement.up)
    }

    // MARK: Edit Options

    @ViewBuilder
    private var optionsSection: some View {
        JobsColumnMenuRow(glyph: WebIcon.listLines, label: "Edit Options",
                          disclosed: open == .options, cascade: cascade(0)) {
            withAnimation(.easeOut(duration: 0.18)) {
                open = open == .options ? nil : .options
            }
        }

        if open == .options {
            JobsOptionsEditor(
                title: optionsTitle,
                options: currentOptions,
                // Standard status and priority lists live in org settings, which
                // this app does not write yet. Shown, and refused, rather than
                // offering a Save that silently drops the change.
                editable: column.isCustom,
                cancel: { withAnimation(.easeOut(duration: 0.18)) { open = nil } },
                save: { list in
                    if let custom = column.custom { actions.setOptions(custom, list) }
                    withAnimation(.easeOut(duration: 0.18)) { open = nil }
                })
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private var optionsTitle: String {
        switch column.standard {
        case .status: return "Status Options"
        case .pri:    return "Priority Options"
        default:      return "List Options"
        }
    }

    private var currentOptions: [JobsSelectOption] {
        if let custom = column.custom { return custom.options }
        // The standard lists, as the built-in enums define them — the web reads
        // `statusOpts` / `priOpts` off org settings, which is where a customised
        // list would come from once this app can write them.
        switch column.standard {
        case .status:
            return JobStatus.allCases.map {
                JobsSelectOption(name: $0.rawValue, color: $0.hex, icon: $0.emblem)
            }
        case .pri:
            // No icon: `hasIcon` is false for priority on the web — "status and
            // custom lists carry an icon; priority is colour-only".
            return Priority.allCases.map {
                JobsSelectOption(name: $0.rawValue, color: $0.hex)
            }
        default:
            return []
        }
    }

    // MARK: Add Column Left / Right

    @ViewBuilder
    private func addSection(_ side: JobsColumnLayout.InsertSide) -> some View {
        let mine: Submenu = side == .left ? .addLeft : .addRight
        JobsColumnMenuRow(glyph: WebIcon.plus,
                          label: "Add Column \(side == .left ? "Left" : "Right")",
                          disclosed: open == mine,
                          cascade: cascade(side == .left ? 2 : 3)) {
            withAnimation(.easeOut(duration: 0.18)) { open = open == mine ? nil : mine }
        }

        if open == mine {
            JobsNewColumnPalette { column in
                dismiss()
                actions.insert(column, self.column, side)
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }
}

// MARK: - A column-menu row
//
// Tighter than the row menu's — `padding: 10px 14px`, 13pt, `gap: 8`, a 12pt
// glyph. Also carries the two things a row menu never needs: a checkbox (Use for
// grouping) and a disclosure chevron.

struct JobsColumnMenuRow: View {
    @Environment(\.tqTheme) private var theme

    var glyph: GlyphSpec?
    let label: String
    /// Draws a checkbox in the icon gutter instead of a glyph.
    var checked: Bool? = nil
    /// Rotates a trailing chevron and tints the row while its submenu is open.
    var disclosed: Bool? = nil
    var destructive = false
    var cascade = TQMenuCascade()
    let action: () -> Void

    @State private var hovering = false

    private var isOpen: Bool { disclosed == true }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                gutter
                Text(label)
                    .font(TFont.body(13, 500))
                    .foregroundStyle(destructive ? theme.danger
                                     : isOpen ? theme.accent : theme.text)
                Spacer(minLength: 0)
                if disclosed != nil {
                    WebGlyph(spec: WebIcon.chevronRight, size: 10,
                             color: isOpen ? theme.accent : theme.textDim)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(wash)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .modifier(cascade)
    }

    @ViewBuilder
    private var gutter: some View {
        if let checked {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(checked ? theme.accent : Color.clear)
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(checked ? theme.accent : theme.border, lineWidth: 1.5))
                .overlay {
                    if checked { WebGlyph(spec: WebIcon.tick, size: 8, color: theme.accentText) }
                }
                .frame(width: 14, height: 14)
        } else if let glyph {
            WebGlyph(spec: glyph, size: 12,
                     color: destructive ? theme.danger : theme.textSec)
                .frame(width: 14)
        } else {
            Color.clear.frame(width: 14, height: 14)
        }
    }

    private var wash: Color {
        if isOpen { return theme.accent.opacity(0.08) }
        guard hovering else { return .clear }
        return destructive ? theme.danger.opacity(0.08) : theme.hover
    }
}

// MARK: - Picking what a new column is
//
// The type row and the templates from `Add Column Left/Right`'s submenu
// (TRAQS.jsx:26253). Shared with the "+" picker, which offers the same
// templates under its own heading.

struct JobsNewColumnPalette: View {
    @Environment(\.tqTheme) private var theme
    let pick: (JobsCustomColumn) -> Void

    /// The four basic types, in the web's order. `select` is not here on purpose
    /// — a list column with no options is useless, so it arrives via a template
    /// or via the "+" picker's named form.
    private let basics: [JobsColumnType] = [.text, .number, .date, .checkbox]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            heading("Column Type")
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 6),
                                GridItem(.flexible(), spacing: 6)],
                      alignment: .leading, spacing: 6) {
                ForEach(basics, id: \.self) { type in
                    chip(shortLabel(type)) {
                        pick(JobsCustomColumn(id: UUID().uuidString,
                                              label: shortLabel(type), type: type))
                    }
                }
            }

            heading("Templates")
            ForEach(JobsColumnTemplates.all) { template in
                Button { pick(template.makeColumn()) } label: {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(theme.accent.opacity(0.55))
                            .frame(width: 6, height: 6)
                        Text(template.label)
                            .font(TFont.body(12))
                            .foregroundStyle(theme.text)
                        Spacer(minLength: 0)
                        Text(template.type.label)
                            .font(TFont.body(10))
                            .foregroundStyle(theme.textDim)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(theme.surface)
    }

    /// The palette's own short names — "Checkbox", not the type's "Dropdown
    /// (List)" phrasing, which only makes sense next to a picker.
    private func shortLabel(_ type: JobsColumnType) -> String {
        switch type {
        case .text: return "Text"
        case .number: return "Number"
        case .date: return "Date"
        case .checkbox: return "Checkbox"
        case .select: return "List"
        case .activity: return "Activity"
        }
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(TFont.body(10, 700))
            .tracking(10 * -0.045)
            .textCase(.uppercase)
            .foregroundStyle(theme.textDim)
    }

    private func chip(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(TFont.body(11, 600))
                .foregroundStyle(theme.text)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(theme.border, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - The options editor
//
// `Edit Options` (TRAQS.jsx:26179). A colour swatch, an icon, a name and a
// delete per option, plus Add — edited on a DRAFT and applied on Save, so
// Cancel really cancels. `dirty` gates the Save button, as the web's does.

struct JobsOptionsEditor: View {
    @Environment(\.tqTheme) private var theme

    let title: String
    let options: [JobsSelectOption]
    /// False for the built-in status and priority lists: they live in org
    /// settings, which this app does not write yet. Shown read-only rather than
    /// hidden, so the menu does not silently differ from the web's.
    var editable: Bool = true
    let cancel: () -> Void
    let save: ([JobsSelectOption]) -> Void

    @State private var draft: [JobsSelectOption] = []

    private var dirty: Bool { draft != options }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(TFont.body(10, 700))
                .tracking(10 * -0.045)
                .textCase(.uppercase)
                .foregroundStyle(theme.textDim)

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(Array(draft.enumerated()), id: \.offset) { index, option in
                        if option.isBlank {
                            Text("(blank / none)")
                                .font(TFont.body(11))
                                .foregroundStyle(theme.textDim)
                                .padding(.vertical, 3)
                        } else {
                            optionRow(index)
                        }
                    }
                }
            }
            .frame(maxHeight: 190)

            if editable {
                Button { draft.append(.next(at: draft.count)) } label: {
                    HStack(spacing: 5) {
                        WebGlyph(spec: WebIcon.plus, size: 9, color: theme.accent)
                        Text("Add option").font(TFont.body(11, 600))
                            .foregroundStyle(theme.accent)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 8) {
                Button("Cancel", action: cancel)
                    .buttonStyle(.plain)
                    .font(TFont.body(11, 600))
                    .foregroundStyle(theme.textSec)
                Spacer(minLength: 0)
                Button { save(draft) } label: {
                    Text(dirty ? "Save \u{2022}" : "Save")
                        .font(TFont.body(11, 700))
                        .foregroundStyle(theme.accentText)
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .background(Capsule().fill(theme.accent))
                }
                .buttonStyle(.plain)
                .disabled(!dirty || !editable)
                .opacity(dirty && editable ? 1 : 0.45)
                .help(editable
                      ? (dirty ? "Apply changes" : "No changes to save")
                      : "Built-in lists live in org settings, which this app cannot write yet")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(theme.surface)
        .onAppear { draft = options }
    }

    private func optionRow(_ index: Int) -> some View {
        HStack(spacing: 6) {
            ColorPicker("", selection: Binding(
                get: { Color.hex(draft[index].color ?? "#94a3b8") },
                set: { draft[index].color = $0.toHexString() }
            ), supportsOpacity: false)
            .labelsHidden()
            .frame(width: 22)
            .disabled(!editable)

            TextField("", text: Binding(
                get: { draft[index].icon ?? "" },
                // Two characters, so an emoji fits and a word does not — the
                // web's `e.target.value.slice(0, 2)`.
                set: { draft[index].icon = String($0.prefix(2)) }
            ))
            .textFieldStyle(.plain)
            .font(TFont.body(11))
            .frame(width: 24)
            .disabled(!editable)

            TextField("", text: Binding(
                get: { draft[index].name },
                set: { draft[index].name = $0 }
            ))
            .textFieldStyle(.plain)
            .font(TFont.body(11))
            .foregroundStyle(theme.text)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Capsule().fill(theme.card))
            .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))
            .disabled(!editable)

            Button { draft.remove(at: index) } label: {
                Text("\u{00D7}")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.danger)
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.plain)
            .disabled(!editable)
            .opacity(editable ? 1 : 0.3)
        }
    }
}

// MARK: - The "+" cell's picker
//
// `colPickerOpen` (TRAQS.jsx:11368) — three sections: link a job field, start
// from a template, or name your own. 280 wide against the web's 300, which is
// the same panel without a scrollbar gutter.

struct JobsColumnPicker: View {
    @Environment(\.tqTheme) private var theme

    let layout: JobsColumnLayout
    let add: (JobsCustomColumn) -> Void
    let dismiss: () -> Void

    @State private var newLabel = ""
    @State private var newType: JobsColumnType = .text

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            section("Link to Job Field") {
                ForEach(JobsFieldCatalog.all) { entry in
                    let added = layout.hasLinkedField(entry.fieldKey)
                    Button {
                        guard !added else { return }
                        dismiss()
                        add(entry.makeColumn())
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(entry.label)
                                    .font(TFont.body(12, 600))
                                    .foregroundStyle(theme.text)
                                Text(entry.detail)
                                    .font(TFont.body(10))
                                    .foregroundStyle(theme.textDim)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 6)
                            Text(added ? "Added \u{2713}" : "+ Add")
                                .font(TFont.body(10, 700))
                                .foregroundStyle(added ? theme.textDim : theme.accent)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(added)
                    .opacity(added ? 0.55 : 1)
                }
            }

            section("Templates") {
                ForEach(JobsColumnTemplates.all) { template in
                    let added = layout.hasTemplate(template.label)
                    Button {
                        guard !added else { return }
                        dismiss()
                        add(template.makeColumn())
                    } label: {
                        HStack(spacing: 8) {
                            Circle().fill(theme.accent.opacity(0.55))
                                .frame(width: 6, height: 6)
                            Text(template.label)
                                .font(TFont.body(12))
                                .foregroundStyle(theme.text)
                            Spacer(minLength: 0)
                            Text(added ? "\u{2713}" : "+")
                                .font(TFont.body(12, 700))
                                .foregroundStyle(added ? theme.textDim : theme.accent)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(added)
                    .opacity(added ? 0.55 : 1)
                }
            }

            section("Custom Column") {
                TextField("Column name\u{2026}", text: $newLabel)
                    .textFieldStyle(.plain)
                    .font(TFont.body(12))
                    .foregroundStyle(theme.text)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Capsule().fill(theme.card))
                    .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))
                    .onSubmit(commitNew)

                HStack(spacing: 8) {
                    Picker("", selection: $newType) {
                        // Every type EXCEPT activity, which is computed and
                        // cannot be created — it only arrives linked.
                        ForEach(JobsColumnType.allCases.filter { $0 != .activity },
                                id: \.self) { type in
                            Text(type.label).tag(type)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)

                    Button(action: commitNew) {
                        Text("Add")
                            .font(TFont.body(12, 700))
                            .foregroundStyle(theme.accentText)
                            .padding(.horizontal, 14).padding(.vertical, 6)
                            .background(Capsule().fill(theme.accent))
                    }
                    .buttonStyle(.plain)
                    .disabled(newLabel.trimmingCharacters(in: .whitespaces).isEmpty)
                    .opacity(newLabel.trimmingCharacters(in: .whitespaces).isEmpty ? 0.45 : 1)
                }
            }
        }
        .padding(14)
        .frame(width: 280)
    }

    /// A new list column starts with the blank sentinel and two placeholders, as
    /// the web's does — an empty list column cannot be filled in from its own
    /// cell, so it would be dead until someone opened the options editor.
    private func commitNew() {
        let label = newLabel.trimmingCharacters(in: .whitespaces)
        guard !label.isEmpty else { return }
        let options: [JobsSelectOption] = newType == .select
            ? [JobsSelectOption(name: JobsSelectOption.blankName),
               .next(at: 0), .next(at: 1)]
            : []
        dismiss()
        add(JobsCustomColumn(id: UUID().uuidString, label: label,
                             type: newType, options: options))
        newLabel = ""
    }

    @ViewBuilder
    private func section(_ title: String,
                         @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(TFont.body(10, 700))
                .tracking(10 * -0.045)
                .textCase(.uppercase)
                .foregroundStyle(theme.textDim)
            content()
        }
    }
}

// MARK: - Rename
//
// `renameCol` (TRAQS.jsx:26120). One field, Enter commits, Escape cancels, and
// the field selects its whole contents on open so typing replaces the name.
//
// The web's version is DRAGGABLE, because it is a floating div that can land
// over the column it renames. This one is a popover anchored under the header
// cell, which cannot cover its own anchor — so there is nothing to drag it out
// of the way of.

struct JobsRenamePopover: View {
    @Environment(\.tqTheme) private var theme

    let column: JobsGridColumn
    /// The column's own label, so clearing the field restores it rather than
    /// leaving the header blank.
    let defaultLabel: String
    let commit: (String) -> Void
    let cancel: () -> Void

    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Rename Column")
                .font(TFont.body(10, 700))
                .tracking(10 * -0.045)
                .textCase(.uppercase)
                .foregroundStyle(theme.textDim)

            TextField(defaultLabel, text: $draft)
                .textFieldStyle(.plain)
                .font(TFont.body(13))
                .foregroundStyle(theme.text)
                .focused($focused)
                .padding(.horizontal, 8).padding(.vertical, 6)
                .background(Capsule().fill(theme.card))
                .overlay(Capsule().strokeBorder(
                    focused ? theme.accent : theme.border, lineWidth: 1))
                .onSubmit { commit(draft) }
                .onExitCommand(perform: cancel)

            Text("Leave empty to restore \u{201C}\(defaultLabel)\u{201D}.")
                .font(TFont.body(10))
                .foregroundStyle(theme.textDim)
        }
        .padding(12)
        .frame(width: 220)
        .onAppear {
            draft = column.label
            focused = true
        }
    }
}

// MARK: -

extension Color {
    /// `#RRGGBB` for the options editor's colour wells, which have to store a
    /// string the web can read back.
    ///
    /// Via `NSColor` in sRGB. `Color.toHex()` in the shared services is
    /// `#if canImport(UIKit)` and returns nil on macOS, so it cannot be used
    /// here.
    func toHexString() -> String {
        let ns = NSColor(self).usingColorSpace(.sRGB) ?? .black
        let r = Int((ns.redComponent * 255).rounded())
        let g = Int((ns.greenComponent * 255).rounded())
        let b = Int((ns.blueComponent * 255).rounded())
        return String(format: "#%02x%02x%02x", r, g, b)
    }
}
