import SwiftUI

// MARK: - TRAQS for macOS
//
// A native rebuild of the web app, sharing the iOS app's entire data layer: this
// target compiles `TRAQS Scheduling/Models` and `TRAQS Scheduling/Services`
// directly out of the iOS project rather than copying them, so AppState,
// APIService, SyncService, RealtimeService and AuthManager are literally the
// same files. One backend, one sync path, one definition of a Job.
//
// The screens are the web app's, laid out the same way. The one intended
// difference is that controls are real Liquid Glass — see NativeShell.
//
// The web view is still here behind a toolbar toggle so each ported screen can
// be checked against the deployed original side by side. It goes when the last
// screen lands.
@main
struct TRAQSDesktopApp: App {
    @State private var auth = AuthManager()
    @State private var appState = AppState()
    @State private var themeSettings = ThemeSettings()
    @State private var appNav = AppNav()
    @State private var store = SiteStore()
    /// Native rebuild, deployed web app, or both side by side. UP HERE rather than
    /// in RootView because it is driven from the View menu now — see below.
    @AppStorage("traqs.parityMode") private var mode: ParityMode = .web

    init() {
        // Fails loudly at launch if DM Sans did not register — see
        // `TFont.assertFacesRegistered`. The app shipped without the faces for its
        // whole life and nothing said so, because a missing font resolves to the
        // system face in silence.
        #if DEBUG
        TFont.assertFacesRegistered()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView(store: store, mode: $mode)
                .environment(auth)
                .environment(appState)
                .environment(themeSettings)
                .environment(appNav)
                // The web app's own palette, by environment rather than as a
                // parameter on every screen — see ThemeEnvironment.
                .environment(\.tqTheme, MacTheme.current(isLight: themeSettings.isLightTheme))
                // App-wide tight letter spacing, matching iOS. Any Text that sets
                // its own tracking overrides this — innermost wins.
                .tracking(-0.5)
                .frame(minWidth: 900, minHeight: 600)
        }
        .defaultSize(width: 1440, height: 900)
        // NO TITLE BAR. The window's content runs to the top edge, so the traffic
        // lights sit in the brand strip's own row instead of a separate bar above
        // it — the strip is the app's only chrome. `BrandStrip.trafficLightInset`
        // is what keeps the lockup clear of them.
        //
        // This is also why the parity picker had to leave the toolbar: a declared
        // toolbar brings the bar back and puts the title area above the strip
        // again. The web half still declares one, which is correct — its
        // back/forward/reload belong to a browser, not to this app's chrome.
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unified)
        .commands {
            // One window onto one org; a second is just a second session to
            // confuse yourself with.
            CommandGroup(replacing: .newItem) { }
            CommandGroup(after: .toolbar) {
                // Was a ToolbarItem. Scaffolding either way — it goes when the
                // last screen lands — but in the toolbar it cost the app its
                // title bar merge, and a dev switch is not worth that.
                Picker("Parity View", selection: $mode) {
                    ForEach(ParityMode.allCases) { Text($0.label).tag($0) }
                }
                Divider()
                Button("Reload") { store.reload() }
                    .keyboardShortcut("r", modifiers: .command)
            }
            // How the NATIVE half gets a session — the web half's Auth0 session
            // lives in the web view and the two never share one. See
            // AccountCommands; this is not the web app's auth gate.
            AccountCommands(auth: auth)
        }
    }
}

// MARK: - Root

private struct RootView: View {
    @Bindable var store: SiteStore
    @Binding var mode: ParityMode
    @Environment(AuthManager.self) private var auth
    @Environment(AppState.self) private var appState
    @Environment(ThemeSettings.self) private var themeSettings
    @State private var showingCustomURL = false

    /// The gate decides whether the app is reachable at all. `MacAuthGate` owns
    /// the eight steps; this only asks whether it is finished.
    @State private var gateOpen = false

    var body: some View {
        Group {
            if gateOpen {
                parityContent
            } else {
                MacAuthGate { gateOpen = true }
            }
        }
        // Signing out from the Account menu drops straight back to the gate,
        // rather than leaving an empty shell behind.
        .onChange(of: auth.isAuthenticated) { _, signedIn in
            if !signedIn { gateOpen = false }
        }
    }

    private var parityContent: some View {
        ParityView(mode: $mode) { webView }
    }

    private var webView: some View {
        WebViewHost(store: store)
            .ignoresSafeArea()
            // A thin determinate bar rather than a spinner over the page: the web
            // app paints its own loading states and a modal spinner would double up.
            .overlay(alignment: .top) {
                if store.isLoading && store.progress < 1 {
                    ProgressView(value: store.progress)
                        .progressViewStyle(.linear)
                        .tint(.accentColor)
                        .frame(height: 2)
                        .transition(.opacity)
                }
            }
            .overlay {
                if let error = store.loadError { failure(error) }
            }
            .animation(.easeInOut(duration: 0.2), value: store.isLoading)
            .navigationTitle(store.pageTitle ?? "TRAQS")
            .toolbar {
                ToolbarItemGroup(placement: .navigation) {
                    Button { store.goBack() } label: {
                        Label("Back", systemImage: "chevron.backward")
                    }
                    .disabled(!store.canGoBack)
                    .keyboardShortcut("[", modifiers: .command)

                    Button { store.goForward() } label: {
                        Label("Forward", systemImage: "chevron.forward")
                    }
                    .disabled(!store.canGoForward)
                    .keyboardShortcut("]", modifiers: .command)
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Menu {
                        Picker("Site", selection: $store.target) {
                            ForEach(SiteStore.Target.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.inline)
                        Divider()
                        Button("Set Custom URL…") { showingCustomURL = true }
                    } label: {
                        Label(store.target.label, systemImage: "globe")
                    }

                    Button { store.reload() } label: {
                        Label("Reload", systemImage: "arrow.clockwise")
                    }
                    .keyboardShortcut("r", modifiers: .command)
                }
            }
            .sheet(isPresented: $showingCustomURL) { CustomURLSheet(store: store) }
            .onChange(of: store.target) { _, _ in store.reload() }
    }

    private func failure(_ message: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(.secondary)
            Text("Couldn't reach TRAQS")
                .font(.title3.weight(.semibold))
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            // The URL is the thing most likely to be wrong on a fresh install, so
            // the recovery names it rather than just offering "try again".
            Text(store.urlString)
                .font(.callout.monospaced())
                .foregroundStyle(.tertiary)
            HStack(spacing: 10) {
                Button("Try Again") { store.reload() }
                    .keyboardShortcut(.defaultAction)
                Button("Change URL…") { showingCustomURL = true }
            }
            .padding(.top, 4)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}

// MARK: - Custom URL

private struct CustomURLSheet: View {
    @Bindable var store: SiteStore
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("TRAQS address")
                .font(.headline)
            Text("Point this window at a different deployment — a Netlify branch preview, or a dev server on another machine.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("https://…", text: $draft)
                .textFieldStyle(.roundedBorder)
                .font(.body.monospaced())
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Use This") {
                    store.customURL = draft.trimmingCharacters(in: .whitespaces)
                    store.target = .custom
                    store.reload()
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(URL(string: draft.trimmingCharacters(in: .whitespaces))?.host == nil)
            }
        }
        .padding(24)
        .frame(width: 460)
        .onAppear { draft = store.customURL }
    }
}
