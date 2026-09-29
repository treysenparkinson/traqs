import Foundation

/// An invite link from the invite email: `https://traqs.netlify.app/?org=CODE&invite=TOKEN`.
///
/// The email's Accept button is a UNIVERSAL LINK. With TRAQS installed, iOS
/// hands it to the app instead of Safari (the site's
/// `/.well-known/apple-app-site-association` claims `/?invite=…` URLs for this
/// app, and the target's Associated Domains entitlement accepts the claim).
/// Without the app it opens the website, which offers the download.
///
/// The token grants nothing by itself. It is redeemed after sign-in, and the
/// server refuses it unless the signed-in address is the invited one. Held in
/// memory only, like the web: persisting it would leave a working credential on
/// the device.
struct InviteLink: Equatable {
    let orgCode: String
    let token: String

    /// The one host that sends invites. Anything else is not ours to act on,
    /// even if it happens to carry the same query names.
    static let host = "traqs.netlify.app"

    static func parse(_ url: URL) -> InviteLink? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https",
              parts.host?.lowercased() == host,
              parts.path.isEmpty || parts.path == "/"
        else { return nil }
        let items = parts.queryItems ?? []
        func value(_ name: String) -> String? {
            let v = items.first { $0.name == name }?.value?.trimmingCharacters(in: .whitespaces)
            return (v?.isEmpty ?? true) ? nil : v
        }
        guard let org = value("org"), let token = value("invite") else { return nil }
        return InviteLink(orgCode: org.uppercased(), token: token)
    }
}
