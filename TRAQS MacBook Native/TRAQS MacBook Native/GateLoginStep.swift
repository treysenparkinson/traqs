import SwiftUI

// MARK: - The banded brand header
//
// `LogoHeader` WITHOUT `outside` (App.jsx:379) — the older arrangement, still
// used by login and the three rejection screens: the gradient band with the
// wordmark inside it.
//
// The logo here is `UL_LOGO_WHITE`, a raster wordmark (App.jsx:381), NOT the
// Space Grotesk lockup the org step draws. That is a real difference between the
// two languages, not an inconsistency to tidy up — so this uses the same PNG,
// extracted from `src/logo.js` at its native 810×304.
//
// The iOS app's TRAQSLogoWhite is DIFFERENT art (2348×1200, aspect 1.96 against
// this one's 2.66) and carries its own transparent margin, so it cannot stand in.
struct GateBandedHeader: View {
    var subtitle: String? = nil

    var body: some View {
        GateCardHeader {
            VStack(spacing: 0) {
                Image("GateWordmarkWhite")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(height: 72)                  // height: 72
                    .padding(.bottom, 14)               // marginBottom: 14
                if let subtitle {
                    Text(subtitle)
                        .font(TFont.body(13))
                        .tracking(13 * 0.06)            // letterSpacing "0.06em"
                        .foregroundStyle(Color.white.opacity(0.75))
                }
            }
        }
    }
}

/// `LINK_BTN` — a plain underlined text button in stone.
struct GateLinkButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(TFont.body(13))
                .foregroundStyle(GatePalette.stone)
                .underline()
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Step: sign in
//
// `LoginStep` (App.jsx:652). Reached once an org is known and a person has been
// chosen (or an admin skipped the roster).
struct GateLoginStep: View {
    let orgCode: String
    let orgName: String?
    let orgDomain: String?
    let connection: String?
    /// The tapped person's email, when the roster picked one — passed to Auth0 as
    /// `login_hint` so nobody types what they just selected.
    var loginHint: String? = nil
    let onSwitch: () -> Void

    @Environment(AuthManager.self) private var auth
    @State private var busy = false

    var body: some View {
        GatePage {
            GateCard {
                GateBandedHeader()
                GateCardBody {
                    VStack(spacing: 0) {
                        // The org pill: a live green dot, the org's name, on a
                        // translucent royal-blue chip.
                        HStack(spacing: 8) {
                            Circle()
                                .fill(Color.hex("#10b981"))
                                .frame(width: 8, height: 8)
                                .shadow(color: Color.hex("#10b981").opacity(0.33), radius: 3)
                            Text(orgName ?? orgCode)
                                .font(TFont.body(13, 600))
                                .foregroundStyle(Color.hex("#4169e1"))
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(
                            Color(red: 65/255, green: 105/255, blue: 225/255, opacity: 0.12)))
                        .overlay(Capsule().stroke(
                            Color(red: 65/255, green: 105/255, blue: 225/255, opacity: 0.22),
                            lineWidth: 1))
                        .padding(.bottom, 10)           // marginBottom: 10

                        if let orgDomain, !orgDomain.isEmpty {
                            Text("@\(orgDomain) accounts only")
                                .font(TFont.body(13))
                                .foregroundStyle(GatePalette.footText)
                        }
                        Text("Sign in to access your schedule")
                            .font(TFont.body(14))
                            .foregroundStyle(GatePalette.spinnerLabel)
                            .padding(.top, 6)           // marginTop: 6
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 24)               // marginBottom: 24

                    // "Sign in with Microsoft" — and it says Microsoft because the
                    // org's Auth0 connection is passed through. Without it this is
                    // a generic Auth0 prompt.
                    GatePrimaryButton(title: "Sign in with Microsoft", loading: busy) {
                        busy = true
                        Task {
                            await auth.login(loginHint: loginHint, connection: connection)
                            busy = false
                        }
                    }

                    GateLinkButton(title: "Switch organization", action: onSwitch)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)              // marginTop: 16
                }
                GateFooter(text: "Org code: \(orgCode) · Secured by Auth0")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - The rejections
//
// Three screens, one shape: banded card, "Access Denied", a box naming the
// SPECIFIC mismatch, then a red Sign Out.
//
// Each names its own mismatch on purpose — the email and the domain it needed, or
// who you signed in as against who you picked. A generic "access denied" would not
// tell anyone what to do next.

/// The red CTA the rejections use — `BtnPrimary` with an override
/// (`linear-gradient(135deg, #ef4444, #dc2626)`, glow `rgba(239,68,68,0.33)`).
private struct GateDangerButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(TFont.body(GateMetrics.btnFontSize, 700))
                .tracking(GateMetrics.btnTracking)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, GateMetrics.btnVPad)
                .background(Capsule().fill(LinearGradient(
                    colors: [.hex("#ef4444"), .hex("#dc2626")],
                    startPoint: .topLeading, endPoint: .bottomTrailing)))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .shadow(color: Color(red: 239/255, green: 68/255, blue: 68/255, opacity: 0.33),
                radius: GateMetrics.btnGlowRadius, y: GateMetrics.btnGlowY)
    }
}

/// The shell all three rejections share.
private struct GateRejection<Body: View>: View {
    let onLogout: () -> Void
    var buttonTitle: String = "Sign Out & Try Again"
    @ViewBuilder let message: () -> Body

    var body: some View {
        GatePage {
            GateCard {
                GateBandedHeader(subtitle: "Access Denied")
                GateCardBody {
                    message()
                    GateDangerButton(title: buttonTitle, action: onLogout)
                        .padding(.top, 20)              // marginTop: 20
                }
                GateFooter(text: "Secured by Auth0 · TRAQS")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// `DomainError` (App.jsx:690).
struct GateDomainError: View {
    let userEmail: String?
    let orgDomain: String?
    let onLogout: () -> Void

    var body: some View {
        GateRejection(onLogout: onLogout) {
            GateErrorBox(title: "Email domain mismatch",
                         body: "Your account \(userEmail ?? "—") is not authorized for this "
                             + "organization.\nThis org requires @\(orgDomain ?? "—") email addresses.")
        }
    }
}

/// `NotInTeamError` (App.jsx:1326) — the server said you are not on this roster.
struct GateNotInTeamError: View {
    let userEmail: String?
    let onLogout: () -> Void

    var body: some View {
        GateRejection(onLogout: onLogout) {
            GateErrorBox(title: "Not on this team",
                         body: "Your account \(userEmail ?? "—") is not a member of this "
                             + "organization. Ask an administrator to add you, then sign in again.")
        }
    }
}

/// `WrongUserError` (App.jsx:1354) — you tapped one face and signed in as another.
struct GateWrongUserError: View {
    let loggedInEmail: String?
    let selectedName: String?
    let selectedEmail: String?
    let onLogout: () -> Void

    var body: some View {
        GateRejection(onLogout: onLogout, buttonTitle: "Sign Out & Start Over") {
            GateErrorBox(title: "That's a different account",
                         body: "You selected \(selectedName ?? selectedEmail ?? "someone else") "
                             + "(\(selectedEmail ?? "—")) but signed in as "
                             + "\(loggedInEmail ?? "—"). Sign out and pick the right name, or "
                             + "sign in with the matching account.")
        }
    }
}

// MARK: - The two-part error box
//
// `ERR_BOX` with a bold lead line and a paragraph under it — the shape all three
// rejections use. Distinct from the single-line `GateErrorBox` in GateCard.
extension GateErrorBox {
    init(title: String, body: String) {
        self.init(message: title + "\n" + body)
    }
}
