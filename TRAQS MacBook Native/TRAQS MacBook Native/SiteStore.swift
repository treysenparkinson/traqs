import Foundation
import Observation

// MARK: - Which TRAQS this window is pointed at
//
// The desktop app is a native shell around the SAME web app Netlify serves —
// not a reimplementation. That means the URL is the app's only real
// configuration, and it has to be changeable WITHOUT a rebuild: production for
// daily use, the local Netlify dev server when testing a change before it ships.
//
// Loading the deployed origin (rather than bundling `dist/`) is also what keeps
// Auth0 working untouched. `main.jsx` passes `redirect_uri: window.location.origin`,
// so the origin the web view runs on has to be one Auth0 already allows — which
// the production domain is, and a `file://` bundle would never be.
@Observable
final class SiteStore {

    enum Target: String, CaseIterable, Identifiable {
        case production, local, custom
        var id: String { rawValue }
        var label: String {
            switch self {
            case .production: return "Production"
            case .local:      return "Local dev server"
            case .custom:     return "Custom…"
            }
        }
    }

    /// The deployed app. Change this if the domain ever moves — it is only the
    /// DEFAULT for the `.production` target, so an app already pointed at a
    /// custom URL keeps that.
    static let productionURL = "https://traqs.netlify.app"
    /// Netlify Dev, per netlify.toml (`[dev] port = 8888`). Vite's own 5173 is
    /// behind it and serves the SPA without the /api function routes, so this
    /// must be 8888 or every API call 404s.
    static let localURL = "http://localhost:8888"

    private enum Key {
        static let target = "traqs.desktop.target"
        static let custom = "traqs.desktop.customURL"
    }

    var target: Target {
        didSet { UserDefaults.standard.set(target.rawValue, forKey: Key.target) }
    }
    var customURL: String {
        didSet { UserDefaults.standard.set(customURL, forKey: Key.custom) }
    }

    // Live state published by the web view's coordinator.
    var isLoading = false
    var progress: Double = 0
    var canGoBack = false
    var canGoForward = false
    var pageTitle: String?
    /// Set when a navigation fails outright. Nil while things are healthy.
    var loadError: String?

    init() {
        let d = UserDefaults.standard
        target = Target(rawValue: d.string(forKey: Key.target) ?? "") ?? .production
        customURL = d.string(forKey: Key.custom) ?? Self.productionURL
    }

    var urlString: String {
        switch target {
        case .production: return Self.productionURL
        case .local:      return Self.localURL
        case .custom:     return customURL
        }
    }

    var url: URL? { URL(string: urlString) }

    /// History, handed over by the web view when it is made.
    ///
    /// CLOSURES rather than a reference to the WKWebView, so this file stays
    /// free of WebKit and the toolbar never has a way to reach into the view
    /// beyond the two things it is allowed to do.
    var goBack: () -> Void = {}
    var goForward: () -> Void = {}

    /// Bumped to ask the web view to reload from scratch — changing the target
    /// has to force a load even though the view itself never changes identity.
    var reloadToken = 0
    func reload() { reloadToken &+= 1 }
}
