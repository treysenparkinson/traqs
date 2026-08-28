import SwiftUI

// MARK: - Native, Split, Web
//
// The project's premise is that the Mac app is a visual COPY of the Netlify site,
// with only the buttons diverging. That premise needs checking on every screen,
// and it was previously unfalsifiable: the Native-UI toggle swapped the whole
// window, so a comparison meant flipping back and forth and trusting memory.
//
// Split renders both halves side by side. This is the mode the port is meant to be
// done in — Native and Web are for using the thing.
//
// The web half stays until the last screen lands.
enum ParityMode: String, CaseIterable, Identifiable {
    case native, split, web
    var id: String { rawValue }
    var label: String {
        switch self {
        case .native: return "Native"
        case .split:  return "Split"
        case .web:    return "Web"
        }
    }
}

struct ParityView<Web: View>: View {
    @Binding var mode: ParityMode
    /// Generic, not AnyView: the native half's header carries glass, and a type
    /// erasure on that path degrades the morph (see GlassControls, precondition 2).
    @ViewBuilder let web: () -> Web

    var body: some View {
        switch mode {
        case .native:
            NativeShell()
        case .web:
            web()
        case .split:
            // HSplitView rather than an HStack: the divider is draggable, so one
            // half can be widened to inspect a detail without leaving the mode.
            HSplitView {
                NativeShell()
                    .frame(minWidth: 420)
                web()
                    .frame(minWidth: 420)
            }
        }
    }
}
