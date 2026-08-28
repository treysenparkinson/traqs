import SwiftUI

// MARK: - Step: the intro, then the org code
//
// `OrgCodeStep` (App.jsx:421), reworked into two phases — see `GateIntro` for why
// the web's timed load-up was replaced rather than ported.
//
// ONE centred column, both phases. In `.welcome` it holds the lockup and a
// button, so the lockup sits at the page's centre. In `.form` it holds the
// lockup, the greeting, the card and the strapline, so the same centred column
// puts the lockup higher — and the difference between those two layouts IS the
// logo's move. SwiftUI animates it; nothing measures anything.
struct GateOrgCodeStep: View {
    /// Handed the validated code and the org's public config.
    let onResolved: (String, OrgInfo) -> Void

    @State private var phase: GateIntroPhase = .welcome
    @State private var code = ""
    @State private var loading = false
    @State private var error: String?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        ZStack {
            GatePalette.paper.ignoresSafeArea()
            // Disperses when the form comes in.
            GateLiquidWash(dispersed: phase == .form)

            VStack(spacing: 0) {
                // Both spacers, so the column is centred whatever it holds.
                Spacer(minLength: 0)

                GateLockup(size: 84)

                if phase == .welcome {
                    GateGetStartedButton { begin() }
                        .padding(.top, 34)
                        .transition(.opacity)
                }

                if phase == .form { formContent }

                Spacer(minLength: 0)
            }
            .padding(.vertical, GateMetrics.pageVPad)
            .padding(.horizontal, GateMetrics.pageHPad)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// Everything below the lockup once the form is up. Staged so it rises while
    /// the logo is still moving — see `GateIntroPhase.contentDelayMS`.
    @ViewBuilder
    private var formContent: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Text("Welcome")
                    .font(TFont.body(20, 700))
                    .tracking(20 * -0.02)            // letterSpacing "-0.02em"
                    .foregroundStyle(GatePalette.ink)
                    .frame(minHeight: 26)
                Text("Enter your organization code to get started.")
                    .font(TFont.body(13.5))
                    .foregroundStyle(GatePalette.stone)
                    .frame(minHeight: 18)
                    .padding(.top, 5)                // marginTop: 5
            }
            .multilineTextAlignment(.center)
            .padding(.top, 22)                       // LogoHeader's gap
            .padding(.bottom, 28)                    // its marginBottom
            .gateFadeUp(delayMS: GateIntroPhase.contentDelayMS,
                        durationMS: GateLoadUp.Timing.copyMS)

            GatePaperCard {
                if let error {
                    GateErrorBox(message: error)
                        .padding(.bottom, 16)        // marginBottom: 16
                }
                GatePaperLabel(text: "Organization Code")
                GatePaperInput(placeholder: "Enter your organization code",
                               text: $code,
                               uppercase: true,
                               maxLength: 20,
                               onSubmit: submit)
                    .focused($fieldFocused)
                GatePaperButton(title: "Continue",
                                loading: loading,
                                loadingLabel: "Looking up…",
                                action: submit)
                    .padding(.top, 18)               // marginTop: 18

                // :485 — where the create-org button used to be.
                Text("New organizations coming soon")
                    .font(TFont.body(12.5))
                    .foregroundStyle(GatePalette.strapline)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 18)
            }
            .gateFadeUp(delayMS: GateIntroPhase.contentDelayMS + 180,
                        durationMS: GateLoadUp.Timing.copyMS)

            GateStrapline(text: "Secured by Auth0 · TRAQS")
                .gateFadeUp(delayMS: GateIntroPhase.contentDelayMS + 620, durationMS: 620)
        }
        .frame(maxWidth: GatePaperMetrics.columnWidth)
        .transition(.identity)   // the staged fades own the entrance
    }

    private func begin() {
        withAnimation(GateIntroPhase.travel) { phase = .form }
        // Focus once the field actually exists.
        Task {
            try? await Task.sleep(for: .milliseconds(Int(GateIntroPhase.contentDelayMS) + 220))
            fieldFocused = true
        }
    }

    private func submit() {
        let trimmed = code.trimmingCharacters(in: .whitespaces).uppercased()
        guard !trimmed.isEmpty else {
            error = "Please enter an organization code."
            return
        }
        loading = true
        error = nil
        Task {
            do {
                let info = try await APIService.lookupOrg(code: trimmed)
                loading = false
                onResolved(trimmed, info)
            } catch APIError.httpError(404) {
                // The web branches on the message containing "not found"; the
                // Swift client surfaces the status instead, which is the same
                // condition stated more directly.
                loading = false
                error = "Organization not found. Check your code or create a new organization."
            } catch let failure {
                // Bound explicitly: `catch`'s implicit binding is also called
                // `error`, which would shadow the @State of the same name.
                loading = false
                error = Self.message(for: failure)
            }
        }
    }

    private static func message(for e: Error) -> String {
        if case APIError.httpError(let code) = e { return "Lookup failed (\(code)). Try again." }
        return e.localizedDescription
    }
}
