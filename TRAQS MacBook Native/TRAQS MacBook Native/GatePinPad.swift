import SwiftUI

// MARK: - The kiosk's glass
//
// `GLASS` (App.jsx:295). Every window in the clock flow — PIN pad, "is this
// you", the clock-out choice, the success note — is this ONE panel. The web's
// note: "so the whole flow is a single sheet of glass rather than a keypad
// followed by white cards."
//
// This is the one place in the gate where real material is right, and the web is
// already doing it: `backdrop-filter: blur(56px) saturate(1.6) brightness(1.06)`
// over `rgba(255,255,255,.64)`. Its reasoning transfers directly — "blur alone
// only softens what's behind and stays see-through, while the diffuse quality of
// real frosted glass comes from the fill" — so this is `.ultraThinMaterial` PLUS
// a milky white fill, not one or the other.
struct GateGlassPanel<Content: View>: View {
    @ViewBuilder let content: () -> Content
    /// `tqPadIn .28s cubic-bezier(0.34, 1.4, 0.64, 1)` — an overshooting curve,
    /// so the panel arrives with a small bounce.
    @State private var shown = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 36, style: .continuous)
        return content()
            .background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(Color.white.opacity(0.64))
                }
            }
            .overlay(shape.stroke(Color.white.opacity(0.8), lineWidth: 1))
            .clipShape(shape)
            // The three shadows GLASS layers: a lit top lip, an inner glow, and
            // the ambient lift. The inset pair become an overlay stroke gradient;
            // the outer one is `0 24px 60px rgba(16,24,40,.16)`, halved for
            // SwiftUI's radius convention.
            .shadow(color: Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.16),
                    radius: 30, y: 24)
            .scaleEffect(shown ? 1 : 0.92)
            .opacity(shown ? 1 : 0)
            .onAppear {
                withAnimation(.timingCurve(0.34, 1.4, 0.64, 1, duration: 0.28)) { shown = true }
            }
    }
}

/// `GLASS_ERR` (App.jsx:313) — sized for LIGHT glass. The web's note: "The shared
/// ERR_BOX and SUCCESS_BOX carry pale text meant for a dark surface, which is
/// unreadable here."
struct GateGlassError: View {
    let message: String
    var body: some View {
        Text(message)
            .font(TFont.body(12.5))
            .foregroundStyle(Color.hex("#b91c1c"))
            .multilineTextAlignment(.center)
            .frame(maxWidth: 288)
            .padding(.top, 11)
    }
}

// MARK: - The PIN pad
//
// `PinKeypad` (App.jsx:787). 88pt round keys on a 3-column grid — the web's note:
// "same metrics as the in-app pad, so the kiosk and the signed-in keypad are the
// same object in two places."
struct GatePinPad: View {
    @Binding var value: String
    var accent: Color = GatePalette.blue
    var error: String?
    var loading: Bool
    let onSubmit: () -> Void
    let onClose: () -> Void

    /// PIN_MAX on the web.
    static let maxDigits = 8

    private let keySide: CGFloat = 88
    private let keyGap: CGFloat = 12

    var body: some View {
        GateGlassPanel {
            VStack(spacing: 0) {
                readout
                keypad
                submitButton
                if let error { GateGlassError(message: error) }
            }
            .padding(.top, 50)
            .padding(.horizontal, 32)
            .padding(.bottom, 30)
        }
        .overlay(alignment: .topTrailing) { closeButton }
        // The web binds the physical keyboard too — digits, Backspace, Enter,
        // Escape. A kiosk with a keyboard attached should not force mousing.
        .onKeyPress { press in handleKey(press) }
    }

    /// One dot per digit — never the digits themselves.
    private var readout: some View {
        Group {
            if value.isEmpty {
                Text("Enter PIN")
                    .font(TFont.body(14))
                    .foregroundStyle(GatePalette.stone)
            } else {
                HStack(spacing: 11) {
                    ForEach(0..<value.count, id: \.self) { _ in
                        Circle().fill(accent).frame(width: 16, height: 16)
                    }
                }
                .frame(maxWidth: 272)
            }
        }
        .frame(minHeight: 26)
        .padding(.bottom, 24)
    }

    private var keypad: some View {
        VStack(spacing: keyGap) {
            ForEach(0..<3) { row in
                HStack(spacing: keyGap) {
                    ForEach(1...3, id: \.self) { col in
                        key(String(row * 3 + col))
                    }
                }
            }
            HStack(spacing: keyGap) {
                // The empty cell under 7, so 0 sits centred and delete lands right.
                Color.clear.frame(width: keySide, height: keySide)
                key("0")
                deleteKey
            }
        }
        .padding(.bottom, 14)
    }

    private func key(_ digit: String) -> some View {
        GatePinKey(loading: loading) {
            Text(digit)
                .font(TFont.body(28, 700))
                .foregroundStyle(GatePalette.ink)
        } action: {
            press(digit)
        }
    }

    private var deleteKey: some View {
        GatePinKey(loading: loading) {
            // The web's own SVG, traced: a tag-shaped backspace with an X in it.
            GateBackspaceGlyph()
                .stroke(GatePalette.stone, style: StrokeStyle(lineWidth: 1.8,
                                                             lineCap: .round, lineJoin: .round))
                .frame(width: 30, height: 25)
        } action: {
            if !value.isEmpty { value.removeLast() }
        }
        .accessibilityLabel("Delete last digit")
    }

    private var submitButton: some View {
        Button(action: onSubmit) {
            Text(loading ? "Confirming…" : "Submit")
                .font(TFont.body(16, 700))
                .foregroundStyle(value.isEmpty ? GatePalette.stone : .white)
                .frame(maxWidth: 288)
                .padding(.vertical, 15)
                .gateGlass(value.isEmpty
                    ? Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.12)
                    : accent)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(loading || value.isEmpty)
        .opacity(loading ? 0.7 : 1)
        .animation(.easeInOut(duration: 0.15), value: value.isEmpty)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(GatePalette.stone)
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
        .padding(14)
    }

    private func press(_ digit: String) {
        guard value.count < Self.maxDigits else { return }
        value += digit
    }

    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        guard !loading, press.modifiers.isEmpty else { return .ignored }
        if let ch = press.characters.first, ch.isNumber {
            self.press(String(ch))
            return .handled
        }
        switch press.key {
        case .delete:
            if !value.isEmpty { value.removeLast() }
            return .handled
        case .return:
            onSubmit()
            return .handled
        case .escape:
            value = ""
            return .handled
        default:
            return .ignored
        }
    }
}

/// One key. Its own piece of glass, not a flat disc — the web's note: "it samples
/// the panel's already-frosted output, so the keys have depth against it."
private struct GatePinKey<Label: View>: View {
    let loading: Bool
    @ViewBuilder let label: () -> Label
    let action: () -> Void

    @State private var pressed = false

    var body: some View {
        Button(action: action) {
            label()
                .frame(width: 88, height: 88)
                // Each key its own piece of glass — which is what the web is
                // imitating with a per-key backdrop-filter. A Capsule on a square
                // frame IS a circle, and using one primitive keeps the pad from
                // handing the effect two unrelated shapes.
                .gateGlass(Color.white.opacity(pressed ? 0.5 : 0.22), in: Capsule())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .scaleEffect(pressed ? 0.93 : 1)
        .shadow(color: Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.07),
                radius: 5, y: 2)
        // transition: transform .1s ease, background .15s ease
        .animation(.easeInOut(duration: 0.1), value: pressed)
        .onLongPressGesture(minimumDuration: 0, pressing: { pressed = $0 }, perform: {})
    }
}

/// The backspace glyph, traced from the web's SVG (App.jsx:851) on its own 26×22
/// viewBox — copy-and-paste, not an SF Symbol lookalike.
struct GateBackspaceGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width / 26, rect.height / 22)
        let t = CGAffineTransform(scaleX: s, y: s)
        var p = Path()
        // M22.5 2H9.2 a2 2 0 0 0 -1.5 .7 L2 11 l5.7 8.3 a2 2 0 0 0 1.5 .7 H22.5
        // a2 2 0 0 0 2 -2 V4 a2 2 0 0 0 -2 -2 z
        p.move(to: CGPoint(x: 22.5, y: 2))
        p.addLine(to: CGPoint(x: 9.2, y: 2))
        p.addQuadCurve(to: CGPoint(x: 7.7, y: 2.7), control: CGPoint(x: 8.2, y: 2))
        p.addLine(to: CGPoint(x: 2, y: 11))
        p.addLine(to: CGPoint(x: 7.7, y: 19.3))
        p.addQuadCurve(to: CGPoint(x: 9.2, y: 20), control: CGPoint(x: 8.2, y: 20))
        p.addLine(to: CGPoint(x: 22.5, y: 20))
        p.addQuadCurve(to: CGPoint(x: 24.5, y: 18), control: CGPoint(x: 24.5, y: 20))
        p.addLine(to: CGPoint(x: 24.5, y: 4))
        p.addQuadCurve(to: CGPoint(x: 22.5, y: 2), control: CGPoint(x: 24.5, y: 2))
        p.closeSubpath()
        // The X inside it.
        p.move(to: CGPoint(x: 14, y: 8));  p.addLine(to: CGPoint(x: 18, y: 14))
        p.move(to: CGPoint(x: 18, y: 8));  p.addLine(to: CGPoint(x: 14, y: 14))
        return p.applying(t)
    }
}

// MARK: - Clock action metadata
//
// `CLOCK_MODE_META` (App.jsx:717) — the label, the big verb, its colour and the
// success line for each of the six actions.
enum GateClockAction: String, CaseIterable, Identifiable {
    case clockIn, clockOut, lunchStart, lunchEnd, breakStart, breakEnd
    var id: String { rawValue }

    var title: String {
        switch self {
        case .clockIn:    return "Clock In"
        case .clockOut:   return "Clock Out"
        case .lunchStart: return "Start Lunch"
        case .lunchEnd:   return "Back From Lunch"
        case .breakStart: return "Start Break"
        case .breakEnd:   return "End Break"
        }
    }
    var verb: String {
        switch self {
        case .clockIn:    return "IN"
        case .clockOut:   return "OUT"
        case .lunchStart: return "ON LUNCH"
        case .lunchEnd:   return "OFF LUNCH"
        case .breakStart: return "ON BREAK"
        case .breakEnd:   return "OFF BREAK"
        }
    }
    var verbColor: Color {
        switch self {
        case .clockIn, .lunchEnd: return .hex("#10b981")
        case .clockOut:           return .hex("#ef4444")
        case .lunchStart, .breakStart, .breakEnd: return .hex("#f59e0b")
        }
    }
    var successMessage: String {
        switch self {
        case .clockIn:    return "Clocked in successfully!"
        case .clockOut:   return "Clocked out successfully!"
        case .lunchStart: return "Lunch started!"
        case .lunchEnd:   return "Welcome back!"
        case .breakStart: return "Break started!"
        case .breakEnd:   return "Break ended!"
        }
    }
}

// MARK: - Clock In / Clock Out, the two big buttons
//
// App.jsx:1118 and :1129. 112pt tall, capped at 260 and set 36 apart.
struct GateClockActionButton: View {
    let title: String
    let caption: String
    let colors: [String]
    /// The glow's RGB, so the resting and hover opacities (.32 / .45) can share it.
    let glow: (Double, Double, Double)
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(title)
                    .font(TFont.body(26, 800))
                    .tracking(26 * 0.01)
                Text(caption)
                    .font(TFont.body(13, 600))
                    .opacity(0.9)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: 260, minHeight: 112)
            .padding(.vertical, 22)
            .padding(.horizontal, 24)
            .gateGlass(Color.hex(colors[0]))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .offset(y: hovering ? -2 : 0)
        .shadow(color: Color(red: glow.0/255, green: glow.1/255, blue: glow.2/255,
                             opacity: hovering ? 0.45 : 0.32),
                radius: hovering ? 15 : 12, y: hovering ? 12 : 8)
        .animation(.easeInOut(duration: 0.2), value: hovering)   // transition: all 0.2s
        .onHover { hovering = $0 }
    }
}

// MARK: - Clock Out's choice
//
// Clock Out is not one action. The web's note on why the success message tracks a
// separate value: "For Clock Out the worker now picks between 'lunchStart' (going
// to lunch) and 'clockOut' (end of day), so the meta we show on success depends
// on what they chose, not on clockMode."
struct GateClockOutChoice: View {
    let onLunch: () -> Void
    let onEndOfDay: () -> Void
    let onCancel: () -> Void

    var body: some View {
        GateGlassPanel {
            VStack(spacing: 18) {
                Text("Clocking out")
                    .font(TFont.body(20, 700))
                    .foregroundStyle(GatePalette.ink)
                Text("Heading to lunch, or done for the day?")
                    .font(TFont.body(13.5))
                    .foregroundStyle(GatePalette.stone)
                HStack(spacing: 16) {
                    GateClockActionButton(title: "Lunch", caption: "Back later",
                                          colors: ["#f59e0b", "#d97706"],
                                          glow: (245, 158, 11), action: onLunch)
                    GateClockActionButton(title: "End of day", caption: "Shift complete",
                                          colors: ["#ef4444", "#dc2626"],
                                          glow: (239, 68, 68), action: onEndOfDay)
                }
                Button("Cancel", action: onCancel)
                    .buttonStyle(.plain)
                    .font(TFont.body(13))
                    .foregroundStyle(GatePalette.stone)
            }
            .padding(40)
        }
    }
}
