import SwiftUI

// MARK: - The controls the New Job form is built from
//
// Small, and all the same shape on purpose: a pill matching `TQFieldChrome`, so a
// picker and a text field sit at the same height and share a border. The web gets
// that from one `InputField` component and a set of drop-downs that all inherit
// its chrome.

/// A day, as `yyyy-MM-dd`. Empty is allowed and reads as the placeholder.
///
/// A real `DatePicker` behind a popover, not a hand-built calendar: macOS can
/// theme its own, which is the reason the web had to draw `TraqsDatePicker` and
/// this does not.
struct TQDayField: View {
    @Environment(\.tqTheme) private var theme

    @Binding var day: String
    var placeholder: String = "\u{2014}"

    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 6) {
                WebGlyph(spec: WebIcon.calendarPin, size: 12,
                         color: day.isEmpty ? theme.textDim : theme.accent)
                Text(day.isEmpty ? placeholder : JobsDate.short(day))
                    .font(TFont.body(13))
                    .foregroundStyle(day.isEmpty ? theme.textDim : theme.text)
                Spacer(minLength: 0)
                if !day.isEmpty {
                    Button { day = "" } label: {
                        Text("\u{2715}").font(.system(size: 9))
                            .foregroundStyle(theme.textDim)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(theme.surface))
            .overlay(Capsule().strokeBorder(open ? theme.accent : theme.border,
                                            lineWidth: open ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            JobsDatePopover(day: day, clearable: true) { picked in
                open = false
                day = picked
            }
        }
    }
}

/// Someone from the roster. Searchable, because a roster is long.
struct TQPersonPicker: View {
    @Environment(\.tqTheme) private var theme

    let people: [Person]
    @Binding var selection: String?
    var placeholder = "Select\u{2026}"

    @State private var open = false
    @State private var search = ""

    private var chosen: Person? { people.first { $0.id == selection } }

    private var matches: [Person] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return people }
        return people.filter { $0.name.lowercased().contains(needle) }
    }

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 7) {
                if let chosen {
                    JobsAvatar(person: chosen, size: 18)
                    Text(chosen.name)
                        .font(TFont.body(13))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                } else {
                    Text(placeholder)
                        .font(TFont.body(13))
                        .foregroundStyle(theme.textDim)
                }
                Spacer(minLength: 0)
                WebGlyph(spec: WebIcon.chevronDown, size: 10, color: theme.textDim)
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(theme.surface))
            .overlay(Capsule().strokeBorder(open ? theme.accent : theme.border,
                                            lineWidth: open ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(spacing: 0) {
                TextField("Search people\u{2026}", text: $search)
                    .textFieldStyle(.plain)
                    .font(TFont.body(12))
                    .padding(.horizontal, 12).padding(.vertical, 9)
                Rectangle().fill(theme.border).frame(height: 1)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(matches) { person in
                            Button {
                                selection = person.id
                                open = false
                                search = ""
                            } label: {
                                HStack(spacing: 8) {
                                    JobsAvatar(person: person, size: 20)
                                    Text(person.name)
                                        .font(TFont.body(12))
                                        .foregroundStyle(theme.text)
                                    Spacer(minLength: 0)
                                    if person.id == selection {
                                        WebGlyph(spec: WebIcon.tick, size: 10,
                                                 color: theme.accent)
                                    }
                                }
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 240)
            }
            .frame(width: 260)
        }
    }
}

/// A client, or none. The dot carries the client's colour, as everywhere else.
struct TQClientPicker: View {
    @Environment(\.tqTheme) private var theme

    let clients: [Client]
    @Binding var selection: String?

    @State private var open = false
    @State private var search = ""

    private var chosen: Client? { clients.first { $0.id == selection } }

    private var matches: [Client] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return clients }
        return clients.filter { $0.name.lowercased().contains(needle) }
    }

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 7) {
                if let chosen {
                    Circle().fill(Color.hex(chosen.color)).frame(width: 8, height: 8)
                    Text(chosen.name).font(TFont.body(13))
                        .foregroundStyle(theme.text).lineLimit(1)
                } else {
                    Text("No client").font(TFont.body(13))
                        .foregroundStyle(theme.textDim)
                }
                Spacer(minLength: 0)
                WebGlyph(spec: WebIcon.chevronDown, size: 10, color: theme.textDim)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(theme.surface))
            .overlay(Capsule().strokeBorder(open ? theme.accent : theme.border,
                                            lineWidth: open ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(spacing: 0) {
                TextField("Search clients\u{2026}", text: $search)
                    .textFieldStyle(.plain)
                    .font(TFont.body(12))
                    .padding(.horizontal, 12).padding(.vertical, 9)
                Rectangle().fill(theme.border).frame(height: 1)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        // "No client" is a ROW, not the absence of one, so a
                        // client picked by mistake can be taken back off.
                        pickRow(id: nil, label: "No client", color: theme.textDim)
                        ForEach(matches) { client in
                            pickRow(id: client.id, label: client.name,
                                    color: Color.hex(client.color))
                        }
                    }
                }
                .frame(maxHeight: 240)
            }
            .frame(width: 260)
        }
    }

    private func pickRow(id: String?, label: String, color: Color) -> some View {
        Button {
            selection = id
            open = false
            search = ""
        } label: {
            HStack(spacing: 8) {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(label).font(TFont.body(12)).foregroundStyle(theme.text)
                Spacer(minLength: 0)
                if id == selection {
                    WebGlyph(spec: WebIcon.tick, size: 10, color: theme.accent)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A custom select column's value, on a form. The same list the grid's cell
/// opens — `JobsOptionList` — so the two cannot drift.
struct TQOptionPicker: View {
    @Environment(\.tqTheme) private var theme

    let options: [JobsSelectOption]
    @Binding var selection: String

    @State private var open = false

    private var chosen: JobsSelectOption? {
        options.first { $0.name == selection && !$0.isBlank }
    }

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 7) {
                if let chosen {
                    Text(chosen.icon ?? "\u{25CB}").font(TFont.body(12))
                        .foregroundStyle(chosen.color.map { Color.hex($0) } ?? theme.accent)
                    Text(chosen.name).font(TFont.body(13))
                        .foregroundStyle(theme.text)
                } else {
                    Text("\u{2014}").font(TFont.body(13)).foregroundStyle(theme.textDim)
                }
                Spacer(minLength: 0)
                WebGlyph(spec: WebIcon.chevronDown, size: 10, color: theme.textDim)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(theme.surface))
            .overlay(Capsule().strokeBorder(open ? theme.accent : theme.border,
                                            lineWidth: open ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            JobsOptionList(options: JobsOptionList.selectOptions(options,
                                                                 accent: theme.accent,
                                                                 dim: theme.textDim),
                           current: selection) { picked in
                open = false
                selection = picked
            }
        }
    }
}

struct TQCheckbox: View {
    @Environment(\.tqTheme) private var theme
    @Binding var on: Bool

    var body: some View {
        Button { on.toggle() } label: {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(on ? theme.accent : Color.clear)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(on ? theme.accent : theme.border, lineWidth: 1.5))
                .overlay {
                    if on { WebGlyph(spec: WebIcon.tick, size: 10, color: theme.accentText) }
                }
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
