import SwiftUI
import WebKit

// MARK: - The web app, hosted natively
//
// A WKWebView pointed at the deployed TRAQS. Everything the page does — Auth0,
// Ably's websocket, the S3 uploads, the Excel export — happens inside here
// exactly as it does in Safari; this file's whole job is to make that behave
// like a Mac app rather than a browser tab.
//
// Four things it has to get right, none of them free:
//
//   1. A PERSISTENT data store, so a login survives quitting the app. The
//      default store is persistent; an ephemeral one would log you out on every
//      launch, which is the single most obvious way a wrapper feels wrong.
//   2. `window.open` has to land somewhere. WKWebView returns nil for a popup
//      unless you handle it, and Auth0 and any external link would silently do
//      nothing. Popups load in the main view; genuinely external links go to
//      the real browser.
//   3. Downloads. The app exports XLSX through a blob: URL, which a plain
//      WKWebView drops on the floor. WKDownload handles it into ~/Downloads.
//   4. Back/forward have to be driven from the toolbar, so the observable
//      mirrors of `canGoBack`/`canGoForward` are kept current.
struct WebViewHost: NSViewRepresentable {
    let store: SiteStore

    func makeCoordinator() -> Coordinator { Coordinator(store: store) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Persistent by default — named explicitly because getting this wrong
        // is invisible until the first relaunch, when you are logged out.
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        // The Apple-only skin. Everything that makes this look like a Mac app
        // rather than the website is added here, at load time — see
        // MacNativeSkin. The deployed web app is never modified.
        config.userContentController.addUserScript(MacNativeSkin.userScript())

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        // A Mac app, not a browser: no rubber-banding past the page edges.
        view.setValue(false, forKey: "drawsBackground")
        view.allowsBackForwardNavigationGestures = true
        // Identifies the shell in server logs and lets the web app tell it is
        // running natively if it ever wants to (e.g. to hide a "install the
        // app" prompt). Appended, so the underlying Safari UA still parses.
        view.customUserAgent = (view.value(forKey: "userAgent") as? String).map { "\($0) TRAQSDesktop" }
        // Safari's Web Inspector can attach to this view (Develop ▸ <your Mac> ▸
        // TRAQS). ON IN RELEASE TOO, deliberately: this is an internal tool, the
        // installed copy in /Applications is a Release build, and being able to
        // inspect the running web app there is worth far more than hiding a DOM
        // from someone who already has the app open.
        view.isInspectable = true

        context.coordinator.observe(view)
        // The toolbar drives history through these rather than through a
        // reference to the view itself.
        store.goBack = { [weak view] in view?.goBack() }
        store.goForward = { [weak view] in view?.goForward() }
        if let url = store.url { view.load(URLRequest(url: url)) }
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.syncIfNeeded(view, store: store)
    }

    // MARK: Coordinator

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        let store: SiteStore
        private var observations: [NSKeyValueObservation] = []
        /// What the view was last told to load, so `updateNSView` — which runs on
        /// every SwiftUI update — only navigates when something actually changed.
        private var loadedURL: String?
        private var loadedToken = 0

        init(store: SiteStore) { self.store = store }

        func observe(_ view: WKWebView) {
            observations = [
                view.observe(\.estimatedProgress, options: [.new]) { [weak self] v, _ in
                    Task { @MainActor in self?.store.progress = v.estimatedProgress }
                },
                view.observe(\.isLoading, options: [.new]) { [weak self] v, _ in
                    Task { @MainActor in self?.store.isLoading = v.isLoading }
                },
                view.observe(\.canGoBack, options: [.new]) { [weak self] v, _ in
                    Task { @MainActor in self?.store.canGoBack = v.canGoBack }
                },
                view.observe(\.canGoForward, options: [.new]) { [weak self] v, _ in
                    Task { @MainActor in self?.store.canGoForward = v.canGoForward }
                },
                view.observe(\.title, options: [.new]) { [weak self] v, _ in
                    Task { @MainActor in self?.store.pageTitle = v.title }
                },
            ]
        }

        /// Navigate only on a real change — a target switch, or an explicit
        /// reload. Loading on every update would restart the page continuously.
        func syncIfNeeded(_ view: WKWebView, store: SiteStore) {
            let wantsReload = store.reloadToken != loadedToken
            guard store.urlString != loadedURL || wantsReload else { return }
            loadedURL = store.urlString
            loadedToken = store.reloadToken
            store.loadError = nil
            guard let url = store.url else { return }
            view.load(URLRequest(url: url))
        }

        // MARK: Navigation

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            store.loadError = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        private func report(_ error: Error) {
            let ns = error as NSError
            // -999 is "cancelled", which is what every superseded navigation
            // reports. Surfacing it would flash an error on ordinary use.
            guard ns.code != NSURLErrorCancelled else { return }
            store.loadError = ns.localizedDescription
        }

        /// Links that leave TRAQS open in the real browser; everything on the
        /// app's own origin stays in the window.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard navigationAction.navigationType == .linkActivated,
                  let url = navigationAction.request.url,
                  let host = url.host,
                  let ourHost = store.url?.host,
                  host != ourHost,
                  // Auth0 IS an external host and must stay in the window, or
                  // logging in would bounce you to Safari and strand the app.
                  !host.hasSuffix("auth0.com")
            else { return decisionHandler(.allow) }
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }

        // MARK: Popups
        //
        // Returning nil (the default) makes `window.open` a silent no-op. Load
        // it in the main view instead and hand back nil, which is the documented
        // way to say "I've handled it".
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url { webView.load(URLRequest(url: url)) }
            return nil
        }

        // MARK: Downloads (the XLSX export)

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        func download(_ download: WKDownload,
                      decideDestinationUsing response: URLResponse,
                      suggestedFilename: String,
                      completionHandler: @escaping @MainActor (URL?) -> Void) {
            let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
                ?? FileManager.default.temporaryDirectory
            var dest = dir.appendingPathComponent(suggestedFilename)
            // Never overwrite: an export run twice should leave two files, the
            // way any browser would.
            var n = 2
            let base = dest.deletingPathExtension().lastPathComponent
            let ext = dest.pathExtension
            while FileManager.default.fileExists(atPath: dest.path) {
                let name = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
                dest = dir.appendingPathComponent(name)
                n += 1
            }
            completionHandler(dest)
        }
    }
}
