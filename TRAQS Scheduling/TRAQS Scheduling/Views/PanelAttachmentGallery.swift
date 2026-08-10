import SwiftUI

/// Thumbnail strip for a panel's attachments, with a swipeable full-screen
/// viewer. PanelPhotoSheet has been uploading end-of-job photos for a while,
/// but nothing on iOS could open them again — only chat attachments had a
/// viewer. Reads panel.attachments straight from the job tree; no new API.
struct PanelAttachmentGallery: View {
    let attachments: [PanelAttachment]
    @State private var openedIndex: Int?

    private let thumb: CGFloat = 56

    var body: some View {
        if !attachments.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(attachments.count == 1 ? "1 photo" : "\(attachments.count) photos")
                    .font(TTypo.xs(11))
                    .foregroundStyle(Color(hex: T.muted))
                    .tLabel(tracking: 0.8)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(attachments.enumerated()), id: \.element.key) { index, a in
                            Button { openedIndex = index } label: {
                                thumbnail(for: a)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
            // item: rather than isPresented: so the pager opens on the tapped
            // photo instead of always starting at the first.
            .fullScreenCover(item: Binding(
                get: { openedIndex.map { GalleryStart(index: $0) } },
                set: { openedIndex = $0?.index }
            )) { start in
                PanelAttachmentPager(attachments: attachments, startIndex: start.index)
            }
        }
    }

    @ViewBuilder
    private func thumbnail(for a: PanelAttachment) -> some View {
        let isImage = (a.mimeType ?? "").hasPrefix("image/")
        ZStack {
            if isImage, let url = Attachment.viewURL(for: a.key) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        Image(systemName: "photo").foregroundStyle(Color(hex: T.muted))
                    default:
                        ProgressView().tint(Color(hex: T.muted))
                    }
                }
            } else {
                Image(systemName: "doc")
                    .font(.system(size: 18))
                    .foregroundStyle(Color(hex: T.muted))
            }
        }
        .frame(width: thumb, height: thumb)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color(hex: T.hair), lineWidth: 1)
        )
    }
}

/// Identifiable wrapper so `fullScreenCover(item:)` can carry the tapped index.
private struct GalleryStart: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Swipeable pager across every attachment on the panel.
private struct PanelAttachmentPager: View {
    let attachments: [PanelAttachment]
    let startIndex: Int
    @State private var selection: Int = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TabView(selection: $selection) {
            ForEach(Array(attachments.enumerated()), id: \.element.key) { index, a in
                AttachmentViewer(panelAttachment: a)
                    .tag(index)
            }
        }
        #if os(iOS)
        .tabViewStyle(.page(indexDisplayMode: attachments.count > 1 ? .automatic : .never))
        #endif
        .ignoresSafeArea()
        .onAppear { selection = startIndex }
    }
}
