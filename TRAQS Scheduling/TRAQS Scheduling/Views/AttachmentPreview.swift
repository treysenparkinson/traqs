import SwiftUI
import UIKit
import QuickLook

// Attachment preview, lifted out of MessagesView so panel attachments can use
// it too. Both types were fileprivate there, which is why the panel photos
// uploaded by PanelPhotoSheet had no viewer at all.
//
// Generalised to (key, filename) because panels carry PanelAttachment while
// chat carries Attachment; the two structs are field-compatible but distinct.
// The Attachment convenience init keeps the existing MessagesView call site
// source-compatible.

struct AttachmentViewer: View {
    let attachmentKey: String
    let filename: String
    @Environment(\.dismiss) private var dismiss

    init(key: String, filename: String) {
        self.attachmentKey = key
        self.filename = filename
    }

    /// Chat call sites keep their existing `AttachmentViewer(attachment:)` form.
    init(attachment: Attachment) {
        self.init(key: attachment.key, filename: attachment.filename)
    }

    /// Panel photos (PanelAttachment) — same shape, different type.
    init(panelAttachment a: PanelAttachment) {
        self.init(key: a.key, filename: a.filename)
    }

    private enum LoadState: Equatable {
        case loading
        case ready(URL)
        case failed(String)
    }
    @State private var state: LoadState = .loading

    var body: some View {
        ZStack {
            PageBackground()
            switch state {
            case .loading:
                VStack(spacing: 14) {
                    ProgressView().tint(Color(hex: T.muted))
                    Text("Loading \(filename)…")
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                }
            case .ready(let fileURL):
                QuickLookPreview(url: fileURL, onDone: { dismiss() })
                    .ignoresSafeArea()
            case .failed(let msg):
                VStack(spacing: 14) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 34))
                        .foregroundStyle(Color(hex: T.muted))
                    Text(msg)
                        .font(TTypo.sm(13))
                        .foregroundStyle(Color(hex: T.muted))
                        .multilineTextAlignment(.center)
                    HStack(spacing: 18) {
                        Button("Retry") { Task { await load() } }
                            .foregroundStyle(Color(hex: T.accent))
                        Button("Close") { dismiss() }
                            .foregroundStyle(Color(hex: T.muted))
                    }
                    .font(TTypo.smBold(15))
                    .buttonStyle(.plain)
                }
                .padding(40)
            }
        }
        .task { await load() }
    }

    private func load() async {
        state = .loading
        guard let remote = Attachment.viewURL(for: attachmentKey) else {
            state = .failed("This attachment can't be opened."); return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: remote)
            // Write into a unique temp subfolder using the real filename, so
            // QuickLook infers the right type and a Save/Share exports a
            // sensibly-named file.
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let safeName = filename.isEmpty ? "attachment" : filename
            let fileURL = dir.appendingPathComponent(safeName)
            try data.write(to: fileURL, options: .atomic)
            state = .ready(fileURL)
        } catch {
            state = .failed("Couldn't load this attachment.\n\(error.localizedDescription)")
        }
    }
}

/// Wraps `QLPreviewController` in a nav controller so it gets a Done button and
/// its native Share action (→ Save to Files / Save Image / Copy / AirDrop).
struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(url: url, onDone: onDone) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let preview = QLPreviewController()
        preview.dataSource = context.coordinator
        preview.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: context.coordinator,
            action: #selector(Coordinator.doneTapped))
        return UINavigationController(rootViewController: preview)
    }

    func updateUIViewController(_ vc: UINavigationController, context: Context) {
        context.coordinator.onDone = onDone
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        var onDone: () -> Void
        init(url: URL, onDone: @escaping () -> Void) { self.url = url; self.onDone = onDone }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
        @objc func doneTapped() { onDone() }
    }
}
