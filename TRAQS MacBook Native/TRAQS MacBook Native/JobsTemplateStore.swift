import SwiftUI

// MARK: - Job templates
//
// The New Job wizard's `TemplateDrop` and `Save Template` — a named set of
// panels and operations you can drop into a new job instead of retyping it.
//
// PER DEVICE AND PER ORG, which is where the web keeps them:
// `localStorage["tq_templates_" + orgCode]` (TRAQS.jsx:4637). Not org settings,
// so no permission is involved and nothing is posted; and keyed by org, so
// somebody in two orgs does not see one org's panel names offered in the other.
//
// The templates hold DRAFTS, not `Panel`s. A template is something to fill a
// form with, and the form's own types already carry exactly the fields it
// collects — colour, department, links, sign-off — while a `Panel` carries
// scheduling state a template must never bring with it.

struct JobTemplate: Codable, Identifiable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var panels: [PanelDraft]

    /// How the dropdown describes it under its name.
    var summary: String {
        let ops = panels.reduce(0) { $0 + $1.operations.count }
        let p = "\(panels.count) operation\(panels.count == 1 ? "" : "s")"
        guard ops > 0 else { return p }
        return "\(p) \u{00B7} \(ops) sub-operation\(ops == 1 ? "" : "s")"
    }
}

@Observable
final class JobsTemplateStore {

    private(set) var templates: [JobTemplate] = []

    private let defaults: UserDefaults
    private var orgCode: String = ""

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The web's own key, so the two are recognisably the same setting.
    private var key: String { "tq_templates_\(orgCode)" }

    /// Point the store at an org and load it. Idempotent — the sheet calls this
    /// on appear and the org rarely changes under it.
    func load(orgCode: String) {
        guard orgCode != self.orgCode || templates.isEmpty else { return }
        self.orgCode = orgCode
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([JobTemplate].self, from: data)
        else { templates = []; return }
        templates = decoded
    }

    /// Save the current form as a template.
    ///
    /// Panels with no name are dropped: they are rows somebody started and left,
    /// and a template that recreates three blank panels is worse than one that
    /// recreates none. Saving with a name that already exists REPLACES it, which
    /// is what people expect from a name they typed deliberately.
    func save(name rawName: String, panels: [PanelDraft]) {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let kept = panels.filter { !$0.title.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !name.isEmpty, !kept.isEmpty else { return }

        var next = templates
        let template = JobTemplate(name: name, panels: kept)
        if let i = next.firstIndex(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
            next[i] = JobTemplate(id: next[i].id, name: name, panels: kept)
        } else {
            next.append(template)
        }
        write(next)
    }

    func delete(_ id: String) {
        write(templates.filter { $0.id != id })
    }

    private func write(_ next: [JobTemplate]) {
        templates = next
        guard let data = try? JSONEncoder().encode(next) else { return }
        defaults.set(data, forKey: key)
    }
}

// MARK: - The dropdown
//
// `TemplateDrop` — load one, or delete one. The web puts a confirm behind the
// delete; this uses a two-stage press on the row's own × instead, which is the
// same protection without a second modal over the wizard.

struct TQTemplatePicker: View {
    @Environment(\.tqTheme) private var theme

    let templates: [JobTemplate]
    let load: (JobTemplate) -> Void
    let delete: (String) -> Void

    @State private var open = false
    /// The row whose × has been pressed once. A second press deletes it.
    @State private var confirming: String?

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 5) {
                WebGlyph(spec: WebIcon.listLines, size: 10, color: theme.textSec)
                Text("Templates")
                    .font(TFont.body(11, 600))
                    .foregroundStyle(theme.textSec)
                if !templates.isEmpty {
                    Text("\(templates.count)")
                        .font(TFont.body(10, 700))
                        .foregroundStyle(theme.accent)
                }
                WebGlyph(spec: WebIcon.chevronDown, size: 8, color: theme.textDim)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(theme.surface))
            .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help("Load a saved set of operations")
        .onChange(of: open) { _, nowOpen in if !nowOpen { confirming = nil } }
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 0) {
                if templates.isEmpty {
                    Text("No templates yet \u{2014} build a job\u{2019}s operations, then Save Template.")
                        .font(TFont.body(11))
                        .foregroundStyle(theme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                } else {
                    ForEach(templates) { row($0) }
                }
            }
            .padding(.vertical, 4)
            .frame(width: 260, alignment: .leading)
        }
    }

    private func row(_ template: JobTemplate) -> some View {
        let armed = confirming == template.id
        return HStack(spacing: 8) {
            Button {
                load(template)
                open = false
            } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(template.name)
                        .font(TFont.body(12, 600))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(template.summary)
                        .font(TFont.body(10))
                        .foregroundStyle(theme.textDim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button {
                if armed { delete(template.id); confirming = nil }
                else { confirming = template.id }
            } label: {
                Text(armed ? "Delete?" : "\u{00D7}")
                    .font(TFont.body(armed ? 10 : 13, armed ? 700 : 400))
                    .foregroundStyle(theme.danger)
                    .padding(.horizontal, armed ? 6 : 0)
                    .frame(minWidth: 20, minHeight: 20)
                    .background(armed ? Capsule().fill(theme.danger.opacity(0.10))
                                      : Capsule().fill(.clear))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(armed ? "Press again to delete" : "Delete this template")
        }
        .padding(.horizontal, 14).padding(.vertical, 7)
    }
}
