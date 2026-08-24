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
    /// Observed so a live Customize preset change re-tints `T.wellFill` below —
    /// the T.* globals it reads aren't observable on their own. Same reason
    /// FrostedCard and GlassPanel touch the theme.
    @Environment(ThemeSettings.self) private var theme

    private struct PickedFile: Equatable { let data: Data; let name: String; let mime: String }

    @State private var pickedImage: UIImage?
    @State private var pickedFile: PickedFile?
    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var showLibrary = false
    @State private var isWorking = false
    @State private var errorText: String?
    @State private var appear = false     // drives the fade/scale-in
    /// Whether the Liquid Glass source menu is expanded out of the "+".
    @State private var menuOpen = false
    /// Ties the "+" and the three source pills together so the glass morphs
    /// between them instead of cross-fading.
    @Namespace private var glassNS

    private var hasPhoto: Bool { pickedImage != nil || pickedFile != nil }

    var body: some View {
        ZStack {
            // Invisible tap-catcher. The page behind is blurred by MainTabView
            // via appNav.modalBlur — this cover is its own presentation, so it
            // can't blur the page itself (see the note above ModalScrim).
            //
            // A tap cancels the end-job (nothing has happened yet — the
            // clock-out only fires from the buttons below), except while the
            // menu is open, where a tap is far more likely aimed at dismissing
            // the menu than at abandoning the clock-out.
            ModalScrim {
                guard !isWorking else { return }
                if menuOpen { setMenu(false) } else { dismiss(clockOut: false) }
            }

            card.modalPop(appear)
        }
        .presentationBackground(.clear)   // let the jobs screen show through
        .onAppear {
            // The shared modal entrance (see ModalPop). The cover itself is
            // presented with animations disabled (see TaskCardV1's STOP action),
            // so this spring is the ONLY entrance animation — which is exactly
            // the condition the other two modals now reproduce.
            withAnimation(modalPopAnimation) { appear = true }
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
            Text("Please take a picture of your panel.")
                .font(TTypo.bodyBold(15))
                .foregroundStyle(Color(hex: T.text))
                .multilineTextAlignment(.center)

            Text(target.panelTitle)
                .font(TTypo.sm(12))
                .foregroundStyle(Color(hex: T.muted))

            attachmentArea

            if let errorText {
                Text(errorText)
                    .font(TTypo.xs(12))
                    .foregroundStyle(Color(hex: T.red))
                    .multilineTextAlignment(.center)
            }

            // End Job — enabled once a photo is attached. Uploads, then ends.
            // Restyled to the signature gradient CTA; dims (not greyed) until a
            // photo is attached, stays vivid with the "Ending…" spinner while
            // uploading. Action / disabled gating unchanged.
            GradientCTA(disabled: !hasPhoto || isWorking,
                        dimmed: !hasPhoto,
                        verticalPadding: 13,
                        action: { endJob(withPhoto: true) }) {
                HStack(spacing: 7) {
                    if isWorking {
                        ProgressView().progressViewStyle(.circular).tint(T.onGradient).scaleEffect(0.8)
                        Text("Ending…")
                    } else {
                        Image(systemName: "stop.fill")
                        Text("End Job")
                    }
                }
                .font(TTypo.bodyBold(15))
            }

            // Bypass — optional for now.
            Button("Skip — end without photo") { endJob(withPhoto: false) }
                .font(TTypo.xs(12))
                .foregroundStyle(Color(hex: T.muted))
                .disabled(isWorking)
        }
        .padding(T.insetHero)
        // Headroom for the cancel X. The X now sits 18pt in from a 46pt corner
        // and is 36pt across, so it runs to 54pt down the card — this puts the
        // first line of the message at 70pt, clearing it by 16 instead of
        // landing right against it.
        .padding(.top, 46)
        .frame(maxWidth: 320)
        // Real frosted glass at the break/lunch banner's radius — this used to
        // be .frostedCard(), which despite the name is an opaque surface fill
        // with no blur, so this modal read as a flat panel next to the banner
        // and the PIN pad.
        .glassPanel()
        // Cancel, anchored INSIDE the card's top-left (attached after the glass
        // but before the outer frame/padding, so it sits on the card rather than
        // floating out in the backdrop). Same placement as the PIN pad's X.
        .overlay(alignment: .topLeading) { cancelButton }
        .padding(.horizontal, 32)
    }

    /// Backing out of the end-job was previously only possible by tapping the
    /// backdrop, which nothing advertised. This makes it obvious.
    private var cancelButton: some View {
        Button { dismiss(clockOut: false) } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color(hex: T.ink))
                .frame(width: 36, height: 36)
                .glassEffect(.regular.interactive(), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(isWorking)
        // 12 put the button hard against the glass edge once the panel radius
        // went to 46 — the corner arc curls in behind it. 18 matches the clock
        // PIN pad's X and leaves ~14pt between the button and the arc.
        .padding(18)
    }

    // MARK: Attachment area + Liquid Glass source menu

    /// The square attachment window: dashed dropzone holding a glass "+", or
    /// the chosen photo/file once selected. Tapping it expands the "+" into the
    /// three source pills.
    ///
    /// The whole thing lives in a `GlassEffectContainer` so the "+" and the
    /// pills — which share `glassNS` via `.glassEffectID` — morph into each
    /// other rather than cross-fading. This replaced a `.confirmationDialog`,
    /// whose stock action sheet looked unrelated to every other surface here.
    private var attachmentArea: some View {
        _ = theme.bgPresetId
        let shape = RoundedRectangle(cornerRadius: T.cornerMd)
        return GlassEffectContainer(spacing: 16) {
            ZStack {
                // Recessed well, no border — the dashed dropzone outline it used
                // to carry read as clutter next to the glass "+". T.wellFill,
                // not a flat pill tint: this has to be DARKER than the card on
                // every preset, and the old fixed lavender came out lighter than
                // the card on the dark ones.
                shape.fill(T.wellFill)

                if let img = pickedImage {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 176, height: 176)
                        .clipShape(shape)
                } else if pickedFile != nil {
                    VStack(spacing: 8) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 34))
                            .foregroundStyle(Color(hex: T.accent))
                        Text("File attached")
                            .font(TTypo.xs(12))
                            .foregroundStyle(Color(hex: T.muted))
                    }
                }

                if menuOpen {
                    // Catches taps that land in the dropzone but miss a pill —
                    // those mean "never mind", not "cancel the clock-out".
                    Rectangle()
                        .fill(.clear)
                        .contentShape(Rectangle())
                        .onTapGesture { setMenu(false) }

                    sourceMenu
                } else {
                    openMenuButton
                }
            }
            .frame(width: 176, height: 176)
        }
    }

    /// Closed state. The full square stays tappable (as it did when this opened
    /// an action sheet), so an already-attached photo can be replaced; the glass
    /// "+" is only drawn when there's nothing attached yet.
    private var openMenuButton: some View {
        Button { setMenu(true) } label: {
            ZStack {
                if !hasPhoto {
                    Image(systemName: "plus")
                        .font(.system(size: 34, weight: .light))
                        .foregroundStyle(Color(hex: T.accent))
                        .frame(width: 78, height: 78)
                        .glassEffect(.regular.interactive(), in: Circle())
                        .glassEffectID("source.anchor", in: glassNS)
                }
            }
            .frame(width: 176, height: 176)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isWorking)
    }

    /// Open state — the three sources as glass capsules. Each keeps its own
    /// `glassEffectID` so the container can split the "+" into them and merge
    /// them back on close.
    private var sourceMenu: some View {
        VStack(spacing: 10) {
            sourcePill("Take Photo", icon: "camera", id: "source.camera") {
                if UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
                else { errorText = "No camera available on this device." }
            }
            sourcePill("Photo Album", icon: "photo.on.rectangle", id: "source.library") {
                showLibrary = true
            }
            sourcePill("Choose File", icon: "folder", id: "source.files") {
                showFiles = true
            }
        }
        .padding(.horizontal, 14)
    }

    private func sourcePill(_ title: String,
                            icon: String,
                            id: String,
                            action: @escaping () -> Void) -> some View {
        Button {
            setMenu(false)
            action()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                Text(title).font(TTypo.bodyBold(14))
            }
            .foregroundStyle(Color(hex: T.ink))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .glassEffect(.regular.interactive(), in: Capsule())
            .glassEffectID(id, in: glassNS)
        }
        .buttonStyle(.plain)
        .disabled(isWorking)
    }

    /// Open/close the source menu. The animation is what drives the glass
    /// morph — without it the pills would simply pop in.
    private func setMenu(_ open: Bool) {
        withAnimation(.spring(response: 0.38, dampingFraction: 0.74)) { menuOpen = open }
    }

    // MARK: Dismissal

    /// Fade out, THEN hand back to the caller. The cover is presented and
    /// cleared with animations disabled so it never slides, which means the
    /// card has to run its own exit — otherwise it would vanish in one frame.
    private func dismiss(clockOut: Bool) {
        modalPopDismiss({ appear = $0 }) { onClose(clockOut) }
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
                await MainActor.run { isWorking = false; dismiss(clockOut: true) }
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
