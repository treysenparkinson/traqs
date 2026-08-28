import SwiftUI

// MARK: - The brand block
//
// `LogoHeader` with `outside: true` (App.jsx:352) — the login redesign's
// arrangement: lockup, then greeting, then hint, all centred on the paper ground
// with the card below. The banded variant of LogoHeader is a different thing and
// belongs to the other steps.
struct GateBrandHeader: View {
    let greeting: String
    let hint: String
    /// The measured rise for the lockup's travel — see `GateRiseMeasured`.
    let rise: CGFloat
    /// False until the rise has been measured. The lockup stays hidden until then:
    /// the web's comment, "Hidden until measured so it can't appear in the wrong
    /// place first."
    let measured: Bool

    var body: some View {
        VStack(spacing: 22) {                    // gap: 22
            GateLockup(size: 84)
                .gateLogoIn(rise: rise)
                .opacity(measured ? 1 : 0)

            VStack(spacing: 0) {
                Text(greeting)
                    .font(TFont.body(20, 700))
                    .tracking(20 * -0.02)        // letterSpacing "-0.02em"
                    .foregroundStyle(GatePalette.ink)
                    // minHeight 26. The web's reason: "minHeight reserves the line
                    // boxes up front. Without it the block grows as the copy types
                    // and shoves the card down mid-bounce."
                    .frame(minHeight: 26)
                    .gateFadeUp(delayMS: GateLoadUp.Timing.titleAtMS,
                                durationMS: GateLoadUp.Timing.copyMS)
                Text(hint)
                    .font(TFont.body(13.5))
                    .foregroundStyle(GatePalette.stone)
                    .frame(minHeight: 18)
                    .padding(.top, 5)            // marginTop: 5
                    .gateFadeUp(delayMS: GateLoadUp.Timing.blurbAtMS,
                                durationMS: GateLoadUp.Timing.copyMS)
            }
            .multilineTextAlignment(.center)
        }
        .padding(.bottom, 28)                    // marginBottom: 28
    }
}

// MARK: - Step: enter the org code
//
// `OrgCodeStep` (App.jsx:421). The first thing anyone sees.
//
// Note what is NOT here, because it is not on the deployed site either: there is
// no "create an organization" button and no "forgot your code" link. The card's
// footer reads "New organizations coming soon" (:487) and that is all. The router
// still handles both steps, so they remain reachable in principle — nothing in
// the UI reaches them today.
struct GateOrgCodeStep: View {
    /// Handed the validated code and the org's public config.
    let onResolved: (String, OrgInfo) -> Void

    @State private var code = ""
    @State private var loading = false
    @State private var error: String?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        GatePage {
            GateRiseMeasured { rise in
                VStack(spacing: 0) {
                    GateBrandHeader(greeting: "Welcome",
                                    hint: "Enter your organization code to get started.",
                                    rise: rise,
                                    measured: rise > 0)

                    GatePaperCard {
                        if let error {
                            GateErrorBox(message: error)
                                .padding(.bottom, 16)      // marginBottom: 16
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
                            .padding(.top, 18)             // marginTop: 18

                        // :485 — where the create-org button used to be.
                        Text("New organizations coming soon")
                            .font(TFont.body(12.5))
                            .foregroundStyle(GatePalette.strapline)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 18)
                    }
                    .gateFadeUp(delayMS: GateLoadUp.Timing.cardAtMS,
                                durationMS: GateLoadUp.Timing.copyMS)

                    // Last in, once the card has settled. The web uses tqFadeIn
                    // here (a plain fade, no travel) over 620ms.
                    GateStrapline(text: "Secured by Auth0 · TRAQS")
                        .gateFadeUp(delayMS: GateLoadUp.Timing.footAtMS, durationMS: 620)
                }
                .frame(maxWidth: GatePaperMetrics.columnWidth)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear { fieldFocused = true }        // autoFocus
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
