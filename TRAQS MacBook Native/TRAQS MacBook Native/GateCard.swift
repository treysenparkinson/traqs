import SwiftUI

// MARK: - The gate's own look
//
// THE GATE DOES NOT READ `TTheme`. It carries its own palette, and that palette
// is copied from the web along with everything else. App.jsx:24 states why:
//
//   > The login screen renders before a theme is resolved, so it carries its own
//   > accent. Matches the sky the light ("frost") theme now uses, and the sky
//   > baked into the bars asset, so login and app agree.
//
// `@Environment(\.tqTheme)` IS reachable from these views. Using it would still
// be wrong: the gate runs before an org, a user, or a preference exists.
//
// Every value below is lifted from src/App.jsx, with the source line beside it.

enum GatePalette {
    /// `LOGIN_BLUE` (:27) — the gate's accent, matching the frost theme's sky and
    /// the sky baked into the bars asset.
    static let blue     = Color.hex("#38BDF8")
    /// `PAPER` (:82). The design's warmth is the point: "Deliberately not
    /// #fff/#0f172a — the design's warmth is what separates it from a generic
    /// auth screen."
    static let paper    = Color.hex("#EDEAE3")
    static let cardBg   = Color.hex("#FBFAF7")   // CARD_BG (:83)
    static let ink      = Color.hex("#0B0B0C")   // INK (:84)
    static let stone    = Color.hex("#8A867E")   // STONE (:85)
    /// HAIRLINE (:86) — `rgba(16,24,40,.08)`.
    static let hairline = Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.08)

    // Card chrome. Cooler than the paper ground, deliberately — the card is a
    // different material from the page it sits on.
    static let cardFill   = Color.white                  // CARD.background (:103)
    static let cardBorder = Color.hex("#e2e8f0")         // CARD.border (:105)
    static let footText   = Color.hex("#64748b")         // CARD_FOOTER.color (:124)
    /// CARD_FOOTER.borderTop — `rgba(15,23,42,0.06)`.
    static let footRule   = Color(red: 15/255, green: 23/255, blue: 42/255, opacity: 0.06)
    static let strapline  = Color.hex("#B4B0A7")         // PAPER_FOOT.color (:324)

    static let inputFill   = Color.white                 // INPUT_STYLE.background
    static let inputBorder = Color.hex("#cbd5e1")        // INPUT_STYLE.border
    static let inputText   = Color.hex("#0f172a")        // INPUT_STYLE.color
    static let spinnerLabel = Color.hex("#94a3b8")       // Spinner's label

    /// The band shared by CARD_HEADER and BTN — `linear-gradient(135deg,
    /// #4169e1, #06b6d4)`. One gradient, two uses, as on the web.
    static let band = LinearGradient(colors: [.hex("#4169e1"), .hex("#06b6d4")],
                                     startPoint: .topLeading, endPoint: .bottomTrailing)
    /// BTN.boxShadow — `0 4px 20px rgba(65,105,225,0.33)`, and its hover form.
    static let btnGlow      = Color(red: 65/255, green: 105/255, blue: 225/255, opacity: 0.33)
    static let btnGlowHover = Color(red: 65/255, green: 105/255, blue: 225/255, opacity: 0.44)
    static let spinnerTrack = Color(red: 65/255, green: 105/255, blue: 225/255, opacity: 0.2)
    static let spinnerHead  = Color.hex("#4169e1")
}

enum GateMetrics {
    static let pageVPad: CGFloat = 48        // PAGE.padding "48px 20px"
    static let pageHPad: CGFloat = 20
    static let cardMaxWidth: CGFloat = 420   // CARD.maxWidth
    static let cardRadius: CGFloat = 20      // CARD.borderRadius
    /// CARD.boxShadow — `0 24px 60px rgba(15,23,42,0.10)`. A CSS blur radius is
    /// twice SwiftUI's, so 60 becomes 30. Same conversion everywhere below.
    static let cardShadowRadius: CGFloat = 30
    static let cardShadowY: CGFloat = 24
    static let cardShadowOpacity: Double = 0.10

    static let headerPad = EdgeInsets(top: 32, leading: 28, bottom: 24, trailing: 28)
    static let bodyPad   = EdgeInsets(top: 28, leading: 28, bottom: 24, trailing: 28)
    static let footerPad = EdgeInsets(top: 12, leading: 24, bottom: 18, trailing: 24)

    static let straplineTopMargin: CGFloat = 16   // PAPER_FOOT.marginTop

    // INPUT_STYLE (:127)
    static let inputVPad: CGFloat = 12
    static let inputHPad: CGFloat = 14
    static let inputRadius: CGFloat = 10
    static let inputFontSize: CGFloat = 14

    // BTN (:140). A PILL, not a 10pt rect — the web's note: "every button on the
    // pre-login screens is a pill now… This is the shared BTN, so the whole flow
    // moves together."
    static let btnVPad: CGFloat = 13
    static let btnFontSize: CGFloat = 15
    static let btnTracking: CGFloat = 15 * 0.02   // letterSpacing "0.02em"
    static let btnGlowRadius: CGFloat = 10        // 20 / 2
    static let btnGlowY: CGFloat = 4
    static let btnGlowHoverRadius: CGFloat = 14   // 28 / 2
    static let btnGlowHoverY: CGFloat = 8
}

// MARK: - Glass, on the buttons
//
// The app's one sanctioned divergence from the web reaches the gate too: BUTTONS
// and TOGGLES are real Liquid Glass, tinted to the colour the web fills them
// with. Everything else here is copied flat.
//
// A tint is a single colour and the web's CTAs are gradients, so each button
// tints with its gradient's START — the same call the iOS app's `glassCTA` makes,
// and the reason its buttons read as the brand colour rather than as clear pills.
extension View {
    /// Native Liquid Glass, tinted and press-responsive.
    func gateGlass<S: InsettableShape>(_ tint: Color, in shape: S) -> some View {
        glassEffect(.regular.tint(tint).interactive(), in: shape)
    }
    /// The common case: a pill.
    func gateGlass(_ tint: Color) -> some View {
        gateGlass(tint, in: Capsule())
    }
}

/// The colour each gradient button tints its glass with — its first stop.
extension GatePalette {
    static let bandTint   = Color.hex("#4169e1")   // CARD_HEADER / BTN gradient start
    static let dangerTint = Color.hex("#ef4444")
    static let goTint     = Color.hex("#10b981")
    static let warnTint   = Color.hex("#f59e0b")
}

/// The full-window ground every step sits on. `PAGE` (:88).
struct GatePage<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        ZStack {
            GatePalette.paper.ignoresSafeArea()
            content()
                .padding(.vertical, GateMetrics.pageVPad)
                .padding(.horizontal, GateMetrics.pageHPad)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The white card. `CARD` (:100).
struct GateCard<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: GateMetrics.cardRadius, style: .continuous)
        return VStack(spacing: 0) { content() }
            .frame(maxWidth: GateMetrics.cardMaxWidth)
            .background(GatePalette.cardFill)
            .clipShape(shape)
            .overlay(shape.stroke(GatePalette.cardBorder, lineWidth: 1))
            .shadow(color: .black.opacity(GateMetrics.cardShadowOpacity),
                    radius: GateMetrics.cardShadowRadius, y: GateMetrics.cardShadowY)
    }
}

/// The gradient band at the top of a card. `CARD_HEADER` (:110).
struct GateCardHeader<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        content()
            .frame(maxWidth: .infinity)
            .padding(GateMetrics.headerPad)
            .background(GatePalette.band)
            // borderBottom: 1px solid rgba(255,255,255,0.1)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.white.opacity(0.1)).frame(height: 1)
            }
    }
}

/// `CARD_BODY` (:117) — just the padding, named so no step invents its own.
struct GateCardBody<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(GateMetrics.bodyPad)
    }
}

/// `CARD_FOOTER` (:119) — 11pt, centred, hairline above.
struct GateFooter: View {
    let text: String
    var body: some View {
        Text(text)
            .font(TFont.body(11))
            .foregroundStyle(GatePalette.footText)
            .frame(maxWidth: .infinity)
            .padding(GateMetrics.footerPad)
            .overlay(alignment: .top) {
                Rectangle().fill(GatePalette.footRule).frame(height: 1)
            }
    }
}

/// The mono strapline under the card. `PAPER_FOOT` (:318).
///
/// SF Mono is the FAITHFUL choice here, not a compromise: PAPER_FOOT asks for
/// 'JetBrains Mono', index.html never loads it, so the web is already falling
/// back to `ui-monospace` — which on macOS is SF Mono.
struct GateStrapline: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 10, design: .monospaced))
            .tracking(10 * 0.08)                 // letterSpacing ".08em"
            .foregroundStyle(GatePalette.strapline)
            .padding(.top, GateMetrics.straplineTopMargin)
    }
}

/// `INPUT_STYLE` (:127).
struct GateInput: View {
    let placeholder: String
    @Binding var text: String
    /// Upper-cases as you type — the org-code field does this.
    var uppercase: Bool = false
    var onSubmit: (() -> Void)? = nil

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(TFont.body(GateMetrics.inputFontSize))
            .foregroundStyle(GatePalette.inputText)
            .padding(.vertical, GateMetrics.inputVPad)
            .padding(.horizontal, GateMetrics.inputHPad)
            .background(
                RoundedRectangle(cornerRadius: GateMetrics.inputRadius, style: .continuous)
                    .fill(GatePalette.inputFill))
            .overlay(
                RoundedRectangle(cornerRadius: GateMetrics.inputRadius, style: .continuous)
                    .stroke(GatePalette.inputBorder, lineWidth: 1))
            .onSubmit { onSubmit?() }
            .onChange(of: text) { _, new in
                if uppercase {
                    let up = new.uppercased()
                    if up != new { text = up }
                }
            }
    }
}

/// `BtnPrimary` (:405) on `BTN` (:140). Full-width pill on the shared gradient,
/// lifting 1pt on hover with a stronger glow.
struct GatePrimaryButton: View {
    let title: String
    var loading: Bool = false
    var loadingLabel: String? = nil
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: { if !loading { action() } }) {
            Text(loading ? (loadingLabel ?? "Loading…") : title)
                .font(TFont.body(GateMetrics.btnFontSize, 700))
                .tracking(GateMetrics.btnTracking)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, GateMetrics.btnVPad)
                .gateGlass(GatePalette.bandTint)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .opacity(loading ? 0.7 : 1)
        .offset(y: (hovering && !loading) ? -1 : 0)
        .shadow(color: (hovering && !loading) ? GatePalette.btnGlowHover : GatePalette.btnGlow,
                radius: (hovering && !loading)
                    ? GateMetrics.btnGlowHoverRadius : GateMetrics.btnGlowRadius,
                y: (hovering && !loading) ? GateMetrics.btnGlowHoverY : GateMetrics.btnGlowY)
        // BTN's `transition: all 0.2s`.
        .animation(.easeInOut(duration: 0.2), value: hovering)
        .onHover { hovering = $0 }
    }
}

/// `Spinner` (:391) — a 48pt ring on the paper ground, one arc lit, spinning
/// 0.8s linear forever, with an optional label under it.
struct GateSpinner: View {
    var label: String? = nil
    @State private var angle: Double = 0

    var body: some View {
        GatePage {
            VStack(spacing: 20) {
                Circle()
                    .stroke(GatePalette.spinnerTrack, lineWidth: 3)
                    .overlay(
                        Circle()
                            .trim(from: 0, to: 0.25)   // border-top only
                            .stroke(GatePalette.spinnerHead,
                                    style: StrokeStyle(lineWidth: 3, lineCap: .butt))
                            .rotationEffect(.degrees(angle))
                    )
                    .frame(width: 48, height: 48)
                if let label {
                    Text(label)
                        .font(TFont.body(14))
                        .foregroundStyle(GatePalette.spinnerLabel)
                }
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) {
                angle = 360
            }
        }
    }
}

// MARK: - The PAPER language (the login redesign)
//
// A SECOND card language, and both are live. `LogoHeader`'s own note (App.jsx:327):
//
//   > `outside` renders the redesign's arrangement — lockup and greeting sit on
//   > the page above the card, not inside a coloured header band. The banded form
//   > is kept for the other auth steps, which still use CARD.
//
// So: the org-code step uses THIS — lockup and greeting on the paper ground, a
// warm off-white card below, a near-black pill button, mono uppercase labels.
// Login and the three rejection screens use the banded `GateCard` above. Do not
// unify them; the web has not.

enum GatePaperMetrics {
    /// This step is wider than the banded card's 420 (`maxWidth: 460` at :447).
    static let columnWidth: CGFloat = 460
    // PAPER_CARD (:210)
    static let cardRadius: CGFloat = 28
    static let cardPad = EdgeInsets(top: 30, leading: 32, bottom: 26, trailing: 32)
    /// `0 30px 70px rgba(16,24,40,.10)` — CSS blur is twice SwiftUI's.
    static let cardShadowRadius: CGFloat = 35
    static let cardShadowY: CGFloat = 30
    // PAPER_INPUT (:219)
    static let inputVPad: CGFloat = 13
    static let inputHPad: CGFloat = 15
    static let inputRadius: CGFloat = 14
    static let inputFontSize: CGFloat = 15
    // PAPER_LABEL (:232)
    static let labelSize: CGFloat = 10
    static let labelTracking: CGFloat = 10 * 0.16
    static let labelBottomGap: CGFloat = 8
    // PAPER_BTN (:242)
    static let btnVPad: CGFloat = 13
    static let btnFontSize: CGFloat = 15
    static let btnTracking: CGFloat = 15 * -0.01
    // The error box at :460
    static let errorRadius: CGFloat = 12
    static let errorPad = EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14)
}

extension GatePalette {
    /// PAPER_CARD's border — `rgba(16,24,40,.07)`.
    static let paperCardBorder = Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.07)
    /// PAPER_INPUT's resting border — `rgba(16,24,40,.12)`. Goes LOGIN_BLUE on focus.
    static let paperInputBorder = Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.12)
    // The error box (:460): rgba(239,68,68,.08) on rgba(239,68,68,.28), text #B42318.
    static let errorFill   = Color(red: 239/255, green: 68/255, blue: 68/255, opacity: 0.08)
    static let errorBorder = Color(red: 239/255, green: 68/255, blue: 68/255, opacity: 0.28)
    static let errorText   = Color.hex("#B42318")
}

/// `PAPER_CARD` (:210). Warm off-white, softer and rounder than the banded card,
/// and with no header band — the lockup sits above it on the page instead.
struct GatePaperCard<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: GatePaperMetrics.cardRadius, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(GatePaperMetrics.cardPad)
            .background(GatePalette.cardBg)
            .clipShape(shape)
            .overlay(shape.stroke(GatePalette.paperCardBorder, lineWidth: 1))
            .shadow(color: Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.10),
                    radius: GatePaperMetrics.cardShadowRadius, y: GatePaperMetrics.cardShadowY)
    }
}

/// `PAPER_LABEL` (:232) — mono, tiny, wide-tracked, uppercase, stone.
///
/// SF Mono again for the reason `GateStrapline` gives: PAPER_LABEL asks for
/// JetBrains Mono, index.html never loads it, so the web falls back to
/// ui-monospace and SF Mono is the match.
struct GatePaperLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: GatePaperMetrics.labelSize, design: .monospaced))
            .tracking(GatePaperMetrics.labelTracking)
            .foregroundStyle(GatePalette.stone)
            .padding(.bottom, GatePaperMetrics.labelBottomGap)
    }
}

/// `PAPER_INPUT` (:219). The border goes LOGIN_BLUE while focused — the web does
/// this with onFocus/onBlur handlers rather than a CSS rule.
struct GatePaperInput: View {
    let placeholder: String
    @Binding var text: String
    var uppercase: Bool = false
    var maxLength: Int? = nil
    var onSubmit: (() -> Void)? = nil

    @FocusState private var focused: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: GatePaperMetrics.inputRadius, style: .continuous)
        return TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .focused($focused)
            .font(TFont.body(GatePaperMetrics.inputFontSize))
            .foregroundStyle(GatePalette.ink)
            .padding(.vertical, GatePaperMetrics.inputVPad)
            .padding(.horizontal, GatePaperMetrics.inputHPad)
            .background(shape.fill(Color.white))
            .overlay(shape.stroke(focused ? GatePalette.blue : GatePalette.paperInputBorder,
                                  lineWidth: 1))
            .onSubmit { onSubmit?() }
            .onChange(of: text) { _, new in
                var v = new
                if uppercase { v = v.uppercased() }
                if let maxLength, v.count > maxLength { v = String(v.prefix(maxLength)) }
                if v != new { text = v }
            }
    }
}

/// `PAPER_BTN` (:242). Solid INK, not the gradient — that is what separates this
/// language from the banded one.
struct GatePaperButton: View {
    let title: String
    var loading: Bool = false
    var loadingLabel: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: { if !loading { action() } }) {
            Text(loading ? (loadingLabel ?? "Loading…") : title)
                .font(TFont.body(GatePaperMetrics.btnFontSize, 700))
                .tracking(GatePaperMetrics.btnTracking)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, GatePaperMetrics.btnVPad)
                // PAPER_BTN is solid INK on the web; as glass it tints with the
                // same colour, so the paper language keeps its near-black button
                // rather than borrowing the banded one's blue.
                .gateGlass(GatePalette.ink)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .opacity(loading ? 0.6 : 1)     // the org step's own disabled opacity
    }
}

/// The inline error box (:460).
struct GateErrorBox: View {
    let message: String
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: GatePaperMetrics.errorRadius, style: .continuous)
        return Text(message)
            .font(TFont.body(13))
            .foregroundStyle(GatePalette.errorText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(GatePaperMetrics.errorPad)
            .background(shape.fill(GatePalette.errorFill))
            .overlay(shape.stroke(GatePalette.errorBorder, lineWidth: 1))
    }
}
