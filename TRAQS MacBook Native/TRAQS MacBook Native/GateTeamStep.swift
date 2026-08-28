import SwiftUI

// MARK: - The team kiosk
//
// `TeamSelectStep` (App.jsx:864). Two views behind one screen — a roster you sign
// in from, and a PIN clock you punch from — because this is a SHARED-DEVICE
// screen: a Mac sitting in the shop, not somebody's own machine.
//
// The roster is here; the clock view and its PIN pad are in GatePinPad.

/// Presence, derived exactly as the web derives it (`getStatus`, App.jsx:1006).
enum GatePresence {
    case offline, online, lunch, onBreak

    /// online = clocked in with no open lunch/break. The LAST lunch or break
    /// event decides, which is why this walks the list backwards rather than
    /// asking whether any start exists.
    static func of(_ person: Person) -> GatePresence {
        guard let clockIn = person.activeClockIn else { return .offline }
        let events = clockIn.events
        if events.last(where: { $0.type == "lunchStart" || $0.type == "lunchEnd" })?.type
            == "lunchStart" { return .lunch }
        if events.last(where: { $0.type == "breakStart" || $0.type == "breakEnd" })?.type
            == "breakStart" { return .onBreak }
        return .online
    }

    /// STATUS_STYLE (App.jsx:1017) — the label and the avatar's corner dot.
    var label: String {
        switch self {
        case .offline: return "Offline"
        case .online:  return "Online"
        case .lunch:   return "Lunch"
        case .onBreak: return "Break"
        }
    }
    var dot: Color {
        switch self {
        case .offline: return .hex("#94a3b8")
        case .online:  return .hex("#10b981")
        case .lunch, .onBreak: return .hex("#f59e0b")
        }
    }
    var isOnline: Bool { self != .offline }
}

// MARK: - One face

/// `PersonBtn` (App.jsx:1021).
///
/// The web's note on why this is two elements and not three: "The status pill is
/// gone: the design puts presence on the avatar as a corner dot and folds the
/// wording into the role line, which keeps the row to two elements instead of
/// three."
struct GatePersonButton: View {
    let person: Person
    let onTap: () -> Void
    @State private var hovering = false

    private var presence: GatePresence { .of(person) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                avatar
                VStack(alignment: .leading, spacing: 1) {   // marginTop: 1
                    Text(person.name)
                        .font(TFont.body(15, 700))
                        .tracking(15 * -0.01)
                        .foregroundStyle(GatePalette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(subline)
                        .font(TFont.body(12, presence.isOnline ? 600 : 400))
                        .foregroundStyle(presence.isOnline
                                         ? Color.hex("#16A34A") : GatePalette.stone)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(hovering ? GatePalette.blue.opacity(0.5)   // `${LOGIN_BLUE}80`
                                     : GatePalette.paperCardBorder, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .offset(y: hovering ? -2 : 0)
        .shadow(color: Color(red: 16/255, green: 24/255, blue: 40/255,
                             opacity: hovering ? 0.10 : 0),
                radius: hovering ? 12 : 0, y: hovering ? 10 : 0)
        // transition: transform .15s ease, box-shadow .15s, border-color .15s
        .animation(.easeInOut(duration: 0.15), value: hovering)
        .onHover { hovering = $0 }
    }

    private var avatar: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle()
                .fill(person.color.isEmpty ? GatePalette.blue : Color.hex(person.color))
                .frame(width: 42, height: 42)
                .overlay {
                    Text(GateInitials.of(person.name))
                        .font(TFont.body(14, 700))
                        .foregroundStyle(.white)
                }
            // The presence dot, on the avatar rather than in a pill.
            Circle()
                .fill(presence.isOnline ? presence.dot : Color.hex("#C9C5BC"))
                .frame(width: 11, height: 11)
                .overlay(Circle().stroke(Color.white, lineWidth: 2))
                .offset(x: 1, y: 1)          // right: -1, bottom: -1
        }
        .frame(width: 42, height: 42)
    }

    /// Online folds the status INTO the role line; offline just states the role.
    /// `person.role` is the department — Models.swift:764 decodes desktop's
    /// `department` into it and prefers that over the legacy `role`.
    private var subline: String {
        let roleOrDept = person.isAdmin ? "Admin" : person.role
        if presence.isOnline {
            return [presence.label, roleOrDept.isEmpty ? nil : roleOrDept]
                .compactMap { $0 }.joined(separator: " · ")
        }
        return roleOrDept.isEmpty ? "No department" : roleOrDept
    }
}

/// `getInitials` (App.jsx:955) — first and last initial.
enum GateInitials {
    static func of(_ name: String) -> String {
        let parts = name.split(separator: " ").filter { !$0.isEmpty }
        guard let first = parts.first?.first else { return "" }
        guard parts.count > 1, let last = parts.last?.first else {
            return String(first).uppercased()
        }
        return (String(first) + String(last)).uppercased()
    }
}

// MARK: - Section eyebrow

/// `SectionLabel` (App.jsx:1073) — mono uppercase, with a hairline rule running
/// to the right edge. The web's note: "the design's section marker, replacing the
/// plain label + separate divider", and "The section rule now carries the
/// separation the divider used to."
struct GateSectionLabel: View {
    let label: String
    var first: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Text(label.uppercased())
                .font(.system(size: 10, design: .monospaced))
                .tracking(10 * 0.16)
                .foregroundStyle(GatePalette.stone)
            Rectangle().fill(GatePalette.hairline).frame(height: 1)
        }
        .padding(.horizontal, 2)
        .padding(.top, first ? 0 : 26)     // margin: first ? "0 2px 12px" : "26px 2px 12px"
        .padding(.bottom, 12)
    }
}

// MARK: - The step

struct GateTeamStep: View {
    let orgCode: String
    let orgName: String?
    /// Tapping a face. The host turns this into a login with `login_hint` AND
    /// remembers the person, so a mismatch can be caught later.
    let onPersonTapped: (Person) -> Void
    let onAdminLogin: () -> Void
    let onSwitch: () -> Void

    @State private var roster: [Person] = []
    @State private var view: KioskView = .login

    // The clock flow. `requested` is what the person pressed; `performed` is what
    // actually happened, and they are NOT the same thing — Clock Out offers
    // "going to lunch" or "end of day", so the success message has to follow the
    // second. The web keeps a separate `completedAction` for exactly this.
    @State private var requested: GateClockAction?
    @State private var performed: GateClockAction?
    @State private var pin = ""
    @State private var pinError: String?
    @State private var pinBusy = false
    @State private var identified: APIService.TimeclockIdentifyResponse?

    enum KioskView { case login, clock }

    /// The card's width animates between the two views on the rail's own curve.
    /// The web's comment is worth keeping, because the number is not arbitrary:
    /// "the clock view holds two 260px buttons and a 36px gap = 556, and with
    /// border-box that has to clear 40px of padding AND 1px of border per side —
    /// 638. Set it to 636 and the row is 2px short, which silently wraps the
    /// buttons into a stack. 644 leaves a few px of slack."
    private var cardMaxWidth: CGFloat { view == .clock ? 644 : 1060 }

    private var admins: [Person] { roster.filter { $0.userRole == "admin" } }
    private var employees: [Person] { roster.filter { $0.userRole != "admin" } }

    var body: some View {
        GatePage {
            ScrollView {
                VStack(spacing: 0) {
                    header
                    card
                }
                .frame(maxWidth: 1060)
                .frame(maxWidth: .infinity)
            }
        }
        .overlay(alignment: .bottomTrailing) { viewToggle }
        .overlay { if requested != nil { padOverlay } }
        .task { await refresh() }
        // The 5s poll — see `poll()`.
        .task(id: view) { await poll() }
    }

    /// The pad, over a dimmed page. One sheet of glass for the whole flow — see
    /// `GateGlassPanel`.
    @ViewBuilder
    private var padOverlay: some View {
        ZStack {
            Color.black.opacity(0.10).ignoresSafeArea()
                .onTapGesture { if !pinBusy { closePad() } }
            if let done = performed {
                GateGlassPanel {
                    VStack(spacing: 8) {
                        Text(done.verb)
                            .font(TFont.body(34, 800))
                            .foregroundStyle(done.verbColor)
                        Text(done.successMessage)
                            .font(TFont.body(14.5, 700))
                            .foregroundStyle(Color.hex("#047857"))
                    }
                    .padding(40)
                }
                .task {
                    // Long enough to read, then out of the way — this is a kiosk
                    // and the next person is waiting.
                    try? await Task.sleep(for: .seconds(2.2))
                    closePad()
                }
            } else if identified != nil, requested == .clockOut {
                GateClockOutChoice(
                    onLunch: { runChoice(.lunchStart) },
                    onEndOfDay: { runChoice(.clockOut) },
                    onCancel: closePad)
            } else {
                GatePinPad(value: $pin,
                           accent: requested?.verbColor ?? GatePalette.blue,
                           error: pinError,
                           loading: pinBusy,
                           onSubmit: submitPin,
                           onClose: closePad)
            }
        }
    }

    private func runChoice(_ action: GateClockAction) {
        guard let who = identified else { return }
        pinBusy = true
        Task {
            do { try await perform(action, personId: who.personId) }
            catch {
                pinBusy = false
                pinError = "That didn't go through. Try again."
            }
        }
    }

    private func closePad() {
        requested = nil
        performed = nil
        identified = nil
        pin = ""
        pinError = nil
        pinBusy = false
    }

    private var header: some View {
        VStack(spacing: 22) {
            GateLockup(size: 84)
            switchPill
            VStack(spacing: 0) {
                Text(view == .clock ? "Clock In / Out" : "Who are you?")
                    .font(TFont.body(20, 700))
                    .tracking(20 * -0.02)
                    .foregroundStyle(GatePalette.ink)
                Text(view == .clock
                     ? "Pick your name to clock in or out."
                     : "Pick your name to log in or clock in.")
                    .font(TFont.body(13.5))
                    .foregroundStyle(GatePalette.stone)
                    .padding(.top, 5)
            }
            .multilineTextAlignment(.center)
        }
        .padding(.bottom, 28)
    }

    /// The org chip that doubles as "switch organization" (App.jsx:972).
    private var switchPill: some View {
        Button(action: onSwitch) {
            HStack(spacing: 8) {
                Circle().fill(Color.hex("#22C55E")).frame(width: 7, height: 7)
                Text(orgName ?? orgCode)
                    .font(TFont.body(13, 600))
                    .foregroundStyle(GatePalette.ink)
                Text("Switch")
                    .font(TFont.body(13, 500))
                    .foregroundStyle(GatePalette.stone)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(GatePalette.paperInputBorder)
                            .frame(width: 1)
                    }
                    .padding(.leading, 2)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().stroke(
                Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.1), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .shadow(color: Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.05),
                radius: 3, y: 2)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if view == .login { rosterContent } else { clockContent }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 32).padding(.horizontal, 40).padding(.bottom, 26)
        .background(GatePalette.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous)
            .stroke(GatePalette.paperCardBorder, lineWidth: 1))
        .shadow(color: Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.10),
                radius: 35, y: 30)
        .frame(maxWidth: cardMaxWidth)
        .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.28), value: view)
    }

    @ViewBuilder
    private var rosterContent: some View {
        if roster.isEmpty {
            VStack(spacing: 16) {
                Text("No team members yet.")
                    .font(TFont.body(14))
                    .foregroundStyle(GatePalette.footText)
                GatePrimaryButton(title: "Admin Login", action: onAdminLogin)
                    .frame(maxWidth: 260)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if !admins.isEmpty {
                    GateSectionLabel(label: "Admins", first: true)
                    grid(admins)
                }
                if !employees.isEmpty {
                    GateSectionLabel(label: "Employees", first: admins.isEmpty)
                    grid(employees)
                }
            }
            .padding(.bottom, 4)
        }
    }

    /// `repeat(auto-fill, minmax(210px, 1fr))` with a 10pt gap.
    private func grid(_ people: [Person]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 10)], spacing: 10) {
            ForEach(people, id: \.id) { p in
                GatePersonButton(person: p) { onPersonTapped(p) }
            }
        }
    }

    // MARK: The clock view

    /// Two big actions, side by side. The web's note: "each capped well short of
    /// the card width and set wide apart, so the two actions read as a deliberate
    /// pair rather than a stack of banners."
    private var clockContent: some View {
        HStack(spacing: 36) {
            clockAction(.clockIn, caption: "Start your shift",
                        colors: ["#10b981", "#059669"], glow: (16, 185, 129))
            clockAction(.clockOut, caption: "End shift, lunch or break",
                        colors: ["#ef4444", "#dc2626"], glow: (239, 68, 68))
        }
        .frame(maxWidth: .infinity)
    }

    private func clockAction(_ action: GateClockAction, caption: String,
                             colors: [String], glow: (Double, Double, Double)) -> some View {
        GateClockActionButton(title: action.title, caption: caption,
                              colors: colors, glow: glow) {
            requested = action
            performed = nil
            pin = ""
            pinError = nil
            identified = nil
        }
    }

    /// The lower-right toggle between the roster and the clock kiosk (App.jsx:1159).
    private var viewToggle: some View {
        HStack(spacing: 4) {
            toggleButton(.login, "Log In")
            toggleButton(.clock, "Clock In")
        }
        .padding(4)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().stroke(
            Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.1), lineWidth: 1))
        .shadow(color: Color(red: 16/255, green: 24/255, blue: 40/255, opacity: 0.14),
                radius: 12, y: 8)
        .padding(20)
    }

    private func toggleButton(_ target: KioskView, _ label: String) -> some View {
        let active = view == target
        return Button { view = target } label: {
            Text(label)
                .font(TFont.body(13, 700))
                .foregroundStyle(active ? .white : GatePalette.stone)
                .padding(.horizontal, 18)
                .padding(.vertical, 9)
                .background(Capsule().fill(active ? AnyShapeStyle(GatePalette.blue)
                                                  : AnyShapeStyle(Color.clear)))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .shadow(color: active ? GatePalette.blue.opacity(0.33) : .clear,
                radius: active ? 7 : 0, y: active ? 4 : 0)
        .animation(.easeInOut(duration: 0.18), value: active)
    }

    // MARK: The clock flow

    /// Two calls, in this order, exactly as the web does it: `identify` resolves
    /// the PIN to a person, THEN the action goes out. A wrong PIN comes back an
    /// error and the pad stays open for a retry rather than closing.
    private func submitPin() {
        guard let requested, !pin.isEmpty else { return }
        pinBusy = true
        pinError = nil
        Task {
            do {
                let who = try await APIService.kioskIdentify(orgCode: orgCode, pin: pin)
                identified = who
                // Clock Out is a CHOICE, so it stops here and asks. Everything
                // else goes straight through.
                if requested == .clockOut {
                    pinBusy = false
                    return
                }
                try await perform(requested, personId: who.personId)
            } catch {
                pinBusy = false
                pinError = "That PIN didn't match. Try again."
            }
        }
    }

    private func perform(_ action: GateClockAction, personId: String) async throws {
        // Unauthenticated: at gate time the PIN is the only credential there is.
        switch action {
        case .clockIn:
            try await APIService.kioskClockIn(orgCode: orgCode, personId: personId, pin: pin)
        default:
            try await APIService.kioskAction(orgCode: orgCode, action: action.rawValue,
                                             personId: personId, pin: pin)
        }
        pinBusy = false
        // What HAPPENED, not what was asked for — see `performed`.
        performed = action
        // The pills should change the moment somebody punches.
        await refresh()
    }

    // MARK: Data

    private func refresh() async {
        if let people = try? await APIService.fetchRoster(orgCode: orgCode) {
            roster = people
        }
    }

    /// Refresh every 5s while the roster is on screen (App.jsx:1041-ish).
    ///
    /// This is a SHARED-DEVICE screen, so the status dots are about other
    /// people's phones and tablets — someone clocking in across the shop should
    /// show up here without anybody touching this Mac.
    ///
    /// Scoped to `.task(id: view)`, so it is cancelled when the view switches or
    /// the step disappears. A timer left running behind the gate would be a
    /// background network call nobody asked for.
    private func poll() async {
        guard view == .login else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(5))
            if Task.isCancelled { return }
            await refresh()
        }
    }
}
