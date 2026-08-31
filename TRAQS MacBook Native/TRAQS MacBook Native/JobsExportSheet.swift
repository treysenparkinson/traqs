import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - Export
//
// `exportSelOpen` (TRAQS.jsx:25601). A picker, not a dialog: rows are clicked to
// build a subset, and if NOTHING is selected the export takes everything
// currently visible — `exportData = selectedJobs.length > 0 ? selectedJobs :
// visibleJobs`. The footer says which of those two is about to happen.
//
// CSV and Word are real here. Both are text the web assembles by hand
// (`csvContent`, `wordContent`), so they port exactly; the browser hands the
// result to a download and this hands it to a save panel.
//
// PDF is NOT. The web's PDF is not a document, it is a freeform layout designer
// — `seedLayout`, `buildLayoutHtml`, a page model with undo history and a live
// preview. Drawn and refused, rather than shipping a different-looking PDF under
// the same button.

struct JobsExportSheet: View {
    @Environment(\.tqTheme) private var theme

    let jobs: [Job]
    let clients: [String: Client]
    let progress: JobsProgress.Index
    /// Arriving or leaving — see `TQModalPhase`.
    var phase: TQModalPhase = .presenting
    let dismiss: () -> Void

    @State private var search = ""
    @State private var selected: Set<String> = []
    @State private var saveError: String?

    /// `visibleJobs` — the filter narrows the LIST, not the selection. A job
    /// picked and then filtered out still exports, which is the web's behaviour
    /// and the reason the footer counts selection rather than what is on screen.
    private var visible: [Job] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return jobs }
        return jobs.filter { job in
            job.title.lowercased().contains(needle)
                || (job.jobNumber ?? "").contains(needle)
                || (job.clientId.flatMap { clients[$0]?.name } ?? "")
                    .lowercased().contains(needle)
        }
    }

    private var exporting: [Job] {
        let picked = jobs.filter { selected.contains($0.id) }
        return picked.isEmpty ? visible : picked
    }

    var body: some View {
        TQModal(width: 780, maxHeight: 660, phase: phase, dismiss: dismiss) {
            TQModalHeader(glyph: WebIcon.export, title: "Export Jobs",
                          subtitle: "Click rows to select — highlighted rows will be exported",
                          dismiss: dismiss) {
                if !selected.isEmpty {
                    Text("\(selected.count) selected")
                        .font(TFont.body(11, 700))
                        .foregroundStyle(theme.accent)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(theme.accent.opacity(0.12)))
                }
            }
            toolbar
            TQModalRule()
            list
            TQModalRule()
            footer
        }
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                WebGlyph(spec: WebIcon.search, size: 13, color: theme.textDim)
                TextField("Filter jobs\u{2026}", text: $search)
                    .textFieldStyle(.plain)
                    .font(TFont.body(12))
                    .foregroundStyle(theme.text)
                if !search.isEmpty {
                    Button { search = "" } label: {
                        Text("\u{2715}").font(.system(size: 10))
                            .foregroundStyle(theme.textDim)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .frame(width: 230)
            .background(Capsule().fill(theme.surface))
            .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))

            TQModalButton(label: allVisibleSelected ? "Clear visible" : "Select all",
                          style: .quiet) {
                if allVisibleSelected {
                    visible.forEach { selected.remove($0.id) }
                } else {
                    visible.forEach { selected.insert($0.id) }
                }
            }

            if !selected.isEmpty {
                TQModalButton(label: "Clear", style: .quiet) { selected = [] }
            }

            Spacer(minLength: 0)

            TQModalButton(label: "PDF (\(exporting.count))", style: .quiet,
                          enabled: false,
                          help: "The PDF export is a page-layout designer on the web — not ported yet") { }
            TQModalButton(label: "CSV (\(exporting.count))") { save(.csv) }
            TQModalButton(label: "Word (\(exporting.count))") { save(.word) }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
    }

    private var allVisibleSelected: Bool {
        !visible.isEmpty && visible.allSatisfy { selected.contains($0.id) }
    }

    // MARK: The list

    private var list: some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                if visible.isEmpty {
                    Text("No jobs match your filter")
                        .font(TFont.body(12))
                        .foregroundStyle(theme.textDim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                } else {
                    ForEach(visible) { job in row(job) }
                }
            }
            .padding(.vertical, 6)
        }
        .frame(maxHeight: .infinity)
    }

    private func row(_ job: Job) -> some View {
        let isSelected = selected.contains(job.id)
        let client = job.clientId.flatMap { clients[$0] }
        let statusColor = Color.hex(job.status.hex)

        return Button {
            if isSelected { selected.remove(job.id) } else { selected.insert(job.id) }
        } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(isSelected ? theme.accent : Color.clear)
                    .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(isSelected ? theme.accent : theme.border, lineWidth: 1.5))
                    .overlay {
                        if isSelected {
                            WebGlyph(spec: WebIcon.tick, size: 9, color: theme.accentText)
                        }
                    }
                    .frame(width: 16, height: 16)

                // The job's own colour, as a bar down the row's leading edge.
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.hex(job.color))
                    .frame(width: 3, height: 22)

                Text(job.title)
                    .font(TFont.body(13, 600))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                    .frame(width: 210, alignment: .leading)

                Text(job.jobNumber.map { "#\($0)" } ?? "\u{2014}")
                    .font(TFont.mono(11))
                    .foregroundStyle(theme.textDim)
                    .frame(width: 74, alignment: .leading)

                Text(client?.name ?? "\u{2014}")
                    .font(TFont.body(12))
                    .foregroundStyle(theme.textSec)
                    .lineLimit(1)
                    .frame(width: 118, alignment: .leading)

                HStack(spacing: 4) {
                    Circle().fill(statusColor).frame(width: 6, height: 6)
                    Text(job.status.rawValue)
                        .font(TFont.body(11))
                        .foregroundStyle(statusColor)
                        .lineLimit(1)
                }
                .frame(width: 96, alignment: .leading)

                Text("\(JobsDate.short(job.start)) \u{2192} \(JobsDate.short(job.end))")
                    .font(TFont.mono(11))
                    .foregroundStyle(theme.textDim)
                    .frame(width: 128, alignment: .leading)

                Spacer(minLength: 0)

                Text("\(progress[job.id])%")
                    .font(TFont.mono(11, 700))
                    .foregroundStyle(theme.textSec)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? theme.accent.opacity(0.09) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 10) {
            if let saveError {
                Text(saveError)
                    .font(TFont.body(12))
                    .foregroundStyle(theme.danger)
                    .lineLimit(2)
            } else if selected.isEmpty {
                Text("\(visible.count) job\(visible.count == 1 ? "" : "s") — click rows to select a subset")
                    .font(TFont.body(12))
                    .foregroundStyle(theme.textDim)
            } else {
                Text("\(selected.count) job\(selected.count == 1 ? "" : "s") selected for export")
                    .font(TFont.body(12))
                    .foregroundStyle(theme.textSec)
            }
            Spacer(minLength: 0)
            TQModalButton(label: "Cancel", style: .quiet, action: dismiss)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: Writing the file

    private enum Format {
        case csv, word
        var ext: String { self == .csv ? "csv" : "doc" }
        var type: UTType { self == .csv ? .commaSeparatedText : .html }
        var name: String { self == .csv ? "jobs_export.csv" : "jobs_export.doc" }
    }

    private func save(_ format: Format) {
        let table = JobsExportTable.build(exporting, clients: clients, progress: progress)
        let text = format == .csv ? table.csv() : table.wordHTML()

        // `NSSavePanel`, where the browser has a download. Same outcome, and the
        // Mac's version is the better one — the file lands where it was asked to
        // rather than in a Downloads folder.
        let panel = NSSavePanel()
        panel.nameFieldStringValue = format.name
        panel.allowedContentTypes = [format.type]
        panel.canCreateDirectories = true
        panel.title = "Export Jobs"

        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            dismiss()
        } catch {
            saveError = "Could not write the file: \(error.localizedDescription)"
        }
    }
}

// MARK: - The exported table
//
// `flatRows` (TRAQS.jsx:25634) — ONE ROW PER OPERATION, inheriting its job's and
// panel's columns, so the result opens as a flat sheet rather than a tree. A job
// with no panels still produces a row, and so does a panel with no operations;
// otherwise exporting would silently drop them.
//
// Pure, and separate from the view, because the shape of an export is the sort of
// thing that has to be checkable without opening a modal.

enum JobsExportTable {

    struct Table {
        let headers: [String]
        let rows: [[String]]
    }

    static let headers = [
        "Job #", "Job", "Client", "Job Status", "Job Priority", "Job Start",
        "Job End", "Job Due", "Job Hours", "Job % Done", "Job Notes",
        "Panel", "Panel Status", "Panel Start", "Panel End", "Panel Hours",
        "Op", "Op Status", "Op Priority", "Op Start", "Op End", "Op Hours",
        "Op % Done", "Op Notes",
    ]

    static func build(_ jobs: [Job], clients: [String: Client],
                      progress: JobsProgress.Index) -> Table {
        var rows: [[String]] = []

        for job in jobs {
            let jobBase: [String] = [
                job.jobNumber.map { "#\($0)" } ?? "",
                job.title,
                job.clientId.flatMap { clients[$0]?.name } ?? "",
                job.status.rawValue,
                job.pri.rawValue,
                job.start,
                job.end,
                job.dueDate ?? "",
                hours(JobsQuery.estimatedHours(of: job)),
                "\(progress[job.id])%",
                // Newlines would break a CSV row in two.
                job.notes.replacingOccurrences(of: "\n", with: " "),
            ]

            guard !job.subs.isEmpty else {
                rows.append(jobBase + Array(repeating: "", count: 13))
                continue
            }

            for panel in job.subs {
                let panelBase: [String] = [
                    panel.title, panel.status.rawValue, panel.start, panel.end,
                    hours(JobsQuery.estimatedHours(of: panel)),
                ]
                guard !panel.subs.isEmpty else {
                    rows.append(jobBase + panelBase + Array(repeating: "", count: 8))
                    continue
                }
                for op in panel.subs {
                    rows.append(jobBase + panelBase + [
                        op.title, op.status.rawValue, op.pri.rawValue,
                        op.start, op.end,
                        hours(JobsQuery.estimatedHours(of: op)),
                        "\(progress[op.id])%",
                        op.notes.replacingOccurrences(of: "\n", with: " "),
                    ])
                }
            }
        }
        return Table(headers: headers, rows: rows)
    }

    /// `_jobHrs(job) > 0 ? _jobHrs(job) + "h" : ""` — blank, not "0h", for
    /// nothing estimated.
    private static func hours(_ value: Double) -> String {
        value > 0 ? JobsDate.hours(value) + "h" : ""
    }
}

extension JobsExportTable.Table {

    /// Every field quoted and inner quotes doubled — the web's own rule, and the
    /// only one that survives a job title containing a comma.
    func csv() -> String {
        ([headers] + rows).map { row in
            row.map { "\"\($0.replacingOccurrences(of: "\"", with: "\"\""))\"" }
                .joined(separator: ",")
        }
        .joined(separator: "\n")
    }

    /// An HTML table saved as `.doc`. Word opens it, which is what the web relies
    /// on too — it is not a real `.docx` and does not pretend to be.
    func wordHTML() -> String {
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
                .replacingOccurrences(of: "\"", with: "&quot;")
        }
        let head = headers.map {
            "<th style=\"border:1px solid #ccc;padding:6px 10px;background:#f3f4f6;font-size:11px\">\(esc($0))</th>"
        }.joined()
        let body = rows.map { row in
            "<tr>" + row.map {
                "<td style=\"border:1px solid #ccc;padding:6px 10px;font-size:11px\">\(esc($0).isEmpty ? "\u{2014}" : esc($0))</td>"
            }.joined() + "</tr>"
        }.joined()
        return """
        <html><head><meta charset="utf-8"/></head>
        <body style="font-family:'DM Sans',sans-serif">
        <h2>TRAQS Job Export</h2>
        <table style="border-collapse:collapse"><thead><tr>\(head)</tr></thead><tbody>\(body)</tbody></table>
        </body></html>
        """
    }
}
