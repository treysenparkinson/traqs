import SwiftUI

// MARK: - The page, copied from the web app
//
// Every number here is lifted from TRAQS.jsx, not chosen — see `TPageMetrics`.
//
// ONE implementation, and the web app already paid for the lesson. Its comment
// above `pageHead` (TRAQS.jsx:12771):
//
//   > One implementation on purpose: a second hand-rolled copy drifted by 0.8px
//   > because it omitted minHeight, and the title visibly jumped when you moved
//   > between pages.
//
// `Right` is a GENERIC parameter, never AnyView. The header's right cluster is
// where the app's one sanctioned divergence lives — real Liquid Glass buttons —
// and `glassEffectID` needs the view carrying a glass shape to be continuous. A
// single type erasure anywhere on that path turns the morph into a cross-fade.

/// The web app's page measurements, in one place so a screen cannot invent its own.
enum TPageMetrics {
    /// `frostScroll`'s default `pad` — "34px 32px 28px" (TRAQS.jsx:12791).
    static let padTop: CGFloat = 34
    static let padSide: CGFloat = 32
    static let padBottom: CGFloat = 28

    /// `pageHeader` (TRAQS.jsx:12731). `minHeight` is the header row's signature —
    /// the web app identifies its own header rows by it — and it is the number the
    /// drifting copy omitted.
    static let headerMinHeight: CGFloat = 50
    static let headerGap: CGFloat = 22
    static let headerBottomMargin: CGFloat = 18

    /// `pageTitleStyle` (TRAQS.jsx:12711). Weight 900 there; the browser clamps it
    /// to the heaviest loaded face, 800 — see `TFontName.face(forWebWeight:)`.
    static let titleSize: CGFloat = 44
    static let titleWeight: Int = 900
    /// `letterSpacing: "-0.07em"` — em-relative on the web, so points here.
    static var titleTracking: CGFloat { titleSize * -0.07 }
    static let titleLineHeight: CGFloat = 1.1

    /// `FIELD_COL_W` (TRAQS.jsx:12756). For form FIELDS ONLY. Pages themselves
    /// fill the panel edge to edge — that is what carries the background and keeps
    /// gaps off the right and bottom — and titles stay in the top-left corner.
    static let fieldColumnWidth: CGFloat = 1180
}

struct TPage<Right: View, Content: View>: View {
    @Environment(\.tqTheme) private var theme

    private let title: String
    private let onBack: (() -> Void)?
    private let scrolls: Bool
    private let right: () -> Right
    private let content: () -> Content

    /// `scrolls: false` for a page whose CONTENT scrolls itself.
    ///
    /// Most pages on the web are wrapped in `frostScroll(...)` — one scroller
    /// around the whole page — and those take the default. Jobs is not: it is
    /// `<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection:
    /// "column" }}>{renderTasks()}</div>` (TRAQS.jsx:25055), because its grid
    /// needs its own scroller for the sticky column header to stick to. Nesting
    /// that inside this one would give the page two vertical scrollers.
    init(_ title: String,
         onBack: (() -> Void)? = nil,
         scrolls: Bool = true,
         @ViewBuilder right: @escaping () -> Right,
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.onBack = onBack
        self.scrolls = scrolls
        self.right = right
        self.content = content
    }

    var body: some View {
        Group {
            if scrolls { ScrollView(.vertical) { stack } } else { stack }
        }
        // Never an opaque background. The content panel paints the theme's bg
        // behind every page, so a page that fills its own hides it — which on the
        // web is exactly what went wrong with the liquid and image backgrounds.
        .background(Color.clear)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var stack: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            // Fills the remaining height ONLY when the page owns its scrolling.
            // Inside a ScrollView an infinite max height is a contradiction: the
            // scroller offers unbounded space, so the content takes all of it and
            // the page can never scroll.
            content()
                .frame(maxHeight: scrolls ? nil : .infinity)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, TPageMetrics.padTop)
        .padding(.horizontal, TPageMetrics.padSide)
        .padding(.bottom, TPageMetrics.padBottom)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: TPageMetrics.headerGap) {
            // Back LEADS the row, ahead of the title. Per the web app: a page you
            // can go back from puts Back in the same spot every time, and putting
            // it after the title would move it with the title's length.
            if let onBack { TBackButton(action: onBack) }

            Text(title)
                .font(TFont.body(TPageMetrics.titleSize, TPageMetrics.titleWeight))
                .tracking(TPageMetrics.titleTracking)
                .lineSpacing(TPageMetrics.titleSize * (TPageMetrics.titleLineHeight - 1))
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)

            // `right` is whatever used to sit in the top-left — a toolbar,
            // filters, a count. It moves to the right of the title, and takes the
            // remaining width so it can wrap.
            right()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: TPageMetrics.headerMinHeight)
        .padding(.bottom, TPageMetrics.headerBottomMargin)
    }
}

extension TPage where Right == EmptyView {
    /// A page with no header controls.
    init(_ title: String,
         onBack: (() -> Void)? = nil,
         scrolls: Bool = true,
         @ViewBuilder content: @escaping () -> Content) {
        self.init(title, onBack: onBack, scrolls: scrolls,
                  right: { EmptyView() }, content: content)
    }
}

// MARK: - Back
//
// `backBtn` (TRAQS.jsx:12762). Solid tokens only — no translucent colour that
// could resolve white-on-white; it reads the same whatever it sits on, hover
// included.
//
// NOT glass, deliberately, even though it is a button. It is one of the elements
// the web app already opts out of its own button chrome, and the sanctioned
// divergence is the header's ACTION buttons, not its navigation.
struct TBackButton: View {
    @Environment(\.tqTheme) private var theme
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                WebGlyph(spec: WebIcon.back, size: 16, color: theme.text)
                Text("Back")
                    .font(TFont.body(13, 700))
                    .foregroundStyle(theme.text)
            }
            .padding(.leading, 12)
            .padding(.trailing, 16)
            .padding(.vertical, 8)
            .background(Capsule().fill(hovering ? theme.surface : theme.card))
            .overlay(Capsule().stroke(theme.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .onHover { hovering = $0 }
    }
}
