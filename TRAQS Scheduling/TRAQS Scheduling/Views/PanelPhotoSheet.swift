import SwiftUI
import PhotosUI
import UIKit
import UniformTypeIdentifiers

// MARK: - End-job panel photo
//
// Shown when a worker taps STOP on a job card (see TasksView / TaskCardV1).
// The attachment step comes BEFORE the job actually ends: the worker adds a
// photo of the finished panel, then "End Job" uploads it (AppState
// .attachPanelPhoto) and clocks them out. Presented as a faded, dimmed overlay
// with a small centered card — not a full screen. Skippable for now; the plan
// is to require the photo later (just gate the End Job button on `hasPhoto`).

/// Identifies the panel a clock-out photo should attach to. `Identifiable` so
/// it can drive a `.fullScreenCover(item:)`.
struct PanelPhotoTarget: Identifiable, Equatable {
    let jobId: String
    let panelId: String
    let panelTitle: String
    let opId: String?
    var id: String { "\(jobId):\(panelId)" }
}

// MARK: - Overlay

struct EndJobPhotoOverlay: View {
    let target: PanelPhotoTarget
    /// Called when the overlay is done. `clockOut == true` means End/Skip (the
    /// photo, if any, is already uploaded) and the caller should clock out;
    /// `false` means the worker cancelled (tapped outside) — leave the job
    /// running. The caller also dismisses the overlay here. Done this way
    /// rather than `@Environment(\.dismiss)` + an in-overlay clock-out, which
    /// hung when the presenting card re-rendered as the job's state changed.
    let onClose: (_ clockOut: Bool) -> Void

    @Environment(AppState.self) private var appState

    private struct PickedFile: Equatable { let data: Data; let name: String; let mime: String }

    @State private var pickedImage: UIImage?
    @State private var pickedFile: PickedFile?
    @State private var photoItem: PhotosPickerItem?
    @State private var showSourceDialog = false
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var showLibrary = false
    @State private var isWorking = false
    @State private var errorText: String?
    @State private var appear = false   // drives the fade/scale-in

    private var hasPhoto: Bool { pickedImage != nil || pickedFile != nil }

    var body: some View {
        ZStack {
            // Dimmed backdrop. Tapping it cancels the end-job (nothing has
            // happened yet — the clock-out only fires from the buttons below).
            Color.black.opacity(appear ? 0.45 : 0)
                .ignoresSafeArea()
                .onTapGesture { if !isWorking { onClose(false) } }

            card
                .scaleEffect(appear ? 1 : 0.92)
                .opacity(appear ? 1 : 0)
        }
        .presentationBackground(.clear)   // let the jobs screen show through
        .onAppear { withAnimation(.easeOut(duration: 0.22)) { appear = true } }
        .confirmationDialog("Add a photo", isPresented: $showSourceDialog, titleVisibility: .visible) {
            Button("Take Photo") {
                if UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
                else { errorText = "No camera available on this device." }
            }
            Button("Photo Album") { showLibrary = true }
            Button("Choose File") { showFiles = true }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in pickedImage = image; pickedFile = nil; errorText = nil }
                .ignoresSafeArea()
        }
        .photosPicker(isPresented: $showLibrary, selection: $photoItem, matching: .images)
        .fileImporter(isPresented: $showFiles,
                      allowedContentTypes: [.image, .pdf, .plainText, .commaSeparatedText, .data],
                      allowsMultipleSelection: false) { handleFileImport($0) }
        .onChange(of: photoItem) { _, item in loadLibraryItem(item) }
    }

    // MARK: Card

    private var card: some View {
        VStack(spacing: 14) {
            Text("Please take a picture of your panel before ending.")
                .font(TTypo.bodyBold(15))
                .foregroundStyle(Color(hex: T.text))
                .multilineTextAlignment(.center)

            Text(target.panelTitle)
                .font(TTypo.sm(12))
                .foregroundStyle(Color(hex: T.muted))

            attachmentSquare

            if let errorText {
                Text(errorText)
                    .font(TTypo.xs(12))
                    .foregroundStyle(Color(hex: T.red))
                    .multilineTextAlignment(.center)
            }

            // End Job — enabled once a photo is attached. Uploads, then ends.
            Button { endJob(withPhoto: true) } label: {
                HStack(spacing: 7) {
                    if isWorking {
                        ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(0.8)
                        Text("Ending…")
                    } else {
                        Image(systemName: "stop.fill")
                        Text("End Job")
                    }
                }
                .font(TTypo.bodyBold(15))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(RoundedRectangle(cornerRadius: T.cornerMd)
                    .fill(Color(hex: T.accent).opacity(hasPhoto ? 1 : 0.35)))
            }
            .buttonStyle(.plain)
            .disabled(!hasPhoto || isWorking)

            // Bypass — optional for now.
            Button("Skip — end without photo") { endJob(withPhoto: false) }
                .font(TTypo.xs(12))
                .foregroundStyle(Color(hex: T.muted))
                .disabled(isWorking)
        }
        .padding(20)
        .frame(maxWidth: 320)
        .background(RoundedRectangle(cornerRadius: T.cornerLg).fill(Color(hex: T.surface)))
        .overlay(RoundedRectangle(cornerRadius: T.cornerLg).stroke(Color(hex: T.border), lineWidth: 1))
        .padding(.horizontal, 32)
    }

    /// The square attachment window: dashed dropzone with a "+", or the chosen
    /// photo/file once selected. Tapping it opens the source action sheet.
    private var attachmentSquare: some View {
        Button { showSourceDialog = true } label: {
            ZStack {
                RoundedRectangle(cornerRadius: T.cornerMd)
                    .fill(Color(hex: T.bg))
                RoundedRectangle(cornerRadius: T.cornerMd)
                    .strokeBorder(Color(hex: T.border),
                                  style: StrokeStyle(lineWidth: 2, dash: hasPhoto ? [] : [6]))

                if let img = pickedImage {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 176, height: 176)
                        .clipShape(RoundedRectangle(cornerRadius: T.cornerMd))
                } else if pickedFile != nil {
                    VStack(spacing: 8) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 34))
                            .foregroundStyle(Color(hex: T.accent))
                        Text("File attached")
                            .font(TTypo.xs(12))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                } else {
                    Image(systemName: "plus")
                        .font(.system(size: 46, weight: .light))
                        .foregroundStyle(Color(hex: T.accent))
                }
            }
            .frame(width: 176, height: 176)
            .contentShape(RoundedRectangle(cornerRadius: T.cornerMd))
        }
        .buttonStyle(.plain)
        .disabled(isWorking)
    }

    // MARK: Source handlers

    private func loadLibraryItem(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            let data = try? await item.loadTransferable(type: Data.self)
            await MainActor.run {
                if let data, let img = UIImage(data: data) {
                    pickedImage = img; pickedFile = nil; errorText = nil
                } else {
                    errorText = "Couldn't load that photo. Try another."
                }
            }
        }
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else {
                errorText = "Couldn't read that file."; return
            }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            if mime.hasPrefix("image/"), let img = UIImage(data: data) {
                pickedImage = img; pickedFile = nil   // route through the downscale path
            } else {
                pickedFile = PickedFile(data: data, name: url.lastPathComponent, mime: mime); pickedImage = nil
            }
            errorText = nil
        case .failure(let error):
            errorText = error.localizedDescription
        }
    }

    // MARK: End the job

    /// Upload the photo (if any) and attach it to the panel, then hand back to
    /// the caller to dismiss + clock out. On upload failure the overlay stays
    /// open with an error so the worker can retry or skip — the job is not
    /// ended until an attach succeeds (or they skip).
    private func endJob(withPhoto: Bool) {
        isWorking = true
        errorText = nil
        Task {
            do {
                if withPhoto {
                    if let img = pickedImage {
                        guard let data = ImageDownscaler.jpeg(from: img) else {
                            throw NSError(domain: "TRAQS", code: 0,
                                          userInfo: [NSLocalizedDescriptionKey: "Couldn't process that photo."])
                        }
                        try await appState.attachPanelPhoto(
                            jobId: target.jobId, panelId: target.panelId, opId: target.opId,
                            filename: filename(ext: "jpg"), mimeType: "image/jpeg", data: data)
                    } else if let file = pickedFile {
                        let ext = (file.name as NSString).pathExtension
                        try await appState.attachPanelPhoto(
                            jobId: target.jobId, panelId: target.panelId, opId: target.opId,
                            filename: filename(ext: ext.isEmpty ? "dat" : ext), mimeType: file.mime, data: file.data)
                    }
                }
                await MainActor.run { isWorking = false; onClose(true) }
            } catch {
                await MainActor.run { isWorking = false; errorText = error.localizedDescription }
            }
        }
    }

    /// "<PanelName>_<yyyy-MM-dd>.<ext>", with "_N" for same-day repeats.
    private func filename(ext: String) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        let stem = "\(target.panelTitle)_\(fmt.string(from: Date()))"
            .replacingOccurrences(of: " ", with: "_")
        let existing = appState.panelAttachmentCount(jobId: target.jobId, panelId: target.panelId, stemPrefix: stem)
        let suffix = existing > 0 ? "_\(existing + 1)" : ""
        return "\(stem)\(suffix).\(ext)"
    }
}

// MARK: - Image downscaling

/// Resize to a max edge of ~1600px and JPEG-encode at 0.82 quality so phone
/// photos stay well under the 8 MB attachment cap. Mirrors the web app's
/// canvas-based `downscaleImage`.
enum ImageDownscaler {
    static func jpeg(from image: UIImage, maxEdge: CGFloat = 1600, quality: CGFloat = 0.82) -> Data? {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxEdge ? maxEdge / longest : 1
        let newSize = CGSize(width: (image.size.width * scale).rounded(),
                             height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1   // newSize is already in pixels
        let resized = UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
        return resized.jpegData(compressionQuality: quality)
    }
}

// MARK: - Camera

/// UIKit camera bridge — SwiftUI has no native camera capture. Returns the
/// captured image via the callback; does nothing if the user cancels.
struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onCapture(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
