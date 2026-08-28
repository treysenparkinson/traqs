import SwiftUI

// MARK: - Account menu
//
// How the NATIVE half gets a session. The web half signs in by being a browser,
// but its Auth0 session lives in the WKWebView's localStorage while AuthManager
// uses ASWebAuthenticationSession and the Keychain — the two never share one.
//
// This is NOT the web app's auth gate. That is `src/App.jsx`: 1709 lines across
// eight steps, with a 460-line team picker, a PIN keypad, org creation, code
// recovery, three rejection screens and an animated lockup. It gets its own pass,
// ported faithfully.
//
// Nor is this a placeholder for it. A menu bar is something a Mac app has and a
// web page cannot, so there is nothing on the Netlify site for it to be identical
// to, and it stays once the real gate lands — the way Reload does. What it does
// not do is the gate's job: no org creation, no code recovery, no team picker, no
// domain or roster validation.
struct AccountCommands: Commands {
    let auth: AuthManager
    let appState: AppState

    var body: some Commands {
        CommandMenu("Account") {
            if auth.isAuthenticated {
                // The signed-in identity, as a disabled row — a menu that only
                // offers "Sign Out" leaves you guessing who you are.
                Text(auth.userEmail ?? "Signed in")
                Divider()
                Button("Sign Out") { auth.logout() }
            } else {
                Button("Sign In…") {
                    Task {
                        await auth.login()
                        // Same order the org gate uses: a session is not usable
                        // until AppState knows which org it belongs to.
                        guard auth.isAuthenticated, !appState.orgCode.isEmpty else { return }
                        appState.matchEmail = auth.userEmail
                        appState.configure(auth: auth, orgCode: appState.orgCode)
                        await appState.loadAll()
                    }
                }
            }

            Divider()

            // Org code. A menu cannot hold a text field — SwiftUI menus take
            // buttons, toggles, pickers and dividers, and anything editable is
            // silently dropped — so the command OPENS a window instead, and that
            // window owns the field.
            //
            // The real gate resolves the code from the signed-in email
            // (APIService.lookupOrgByEmail) and can create one; this is the manual
            // path, which is all the native half needs in order to reach a screen.
            Button(appState.orgCode.isEmpty ? "Set Org Code…" : "Org Code: \(appState.orgCode)…") {
                OrgCodeWindow.present(auth: auth, appState: appState)
            }
        }
    }
}

// MARK: - Org code window
//
// An AppKit panel rather than a SwiftUI `Window` scene, for one reason: a scene
// has to be declared in the App's body up front and opened through
// `openWindow(id:)`, which needs an `@Environment` value a `Commands` struct
// cannot reach. A panel can be raised from anywhere.
//
// Retained in a static so it is not deallocated the moment `present` returns, and
// reused so a second invocation raises the existing panel instead of stacking a
// new one.
@MainActor
final class OrgCodeWindow {
    private static var shared: NSWindow?

    static func present(auth: AuthManager, appState: AppState) {
        if let existing = shared {
            existing.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 190),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false)
        window.title = "Org Code"
        window.isReleasedWhenClosed = false
        window.center()
        window.contentView = NSHostingView(
            rootView: OrgCodeSheet(auth: auth, appState: appState) {
                shared?.close()
            })
        shared = window
        window.makeKeyAndOrderFront(nil)
    }
}

private struct OrgCodeSheet: View {
    let auth: AuthManager
    let appState: AppState
    let onDone: () -> Void

    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Org code")
                .font(.headline)
            Text("Which organization this window is signed in to. The real sign-in "
                 + "flow resolves this from your email; this is the manual path.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            TextField("e.g. MATRIX", text: $draft)
                .textFieldStyle(.roundedBorder)
                .font(.body.monospaced())
                .onSubmit(apply)

            HStack {
                Spacer()
                Button("Cancel", action: onDone)
                Button("Use This", action: apply)
                    .keyboardShortcut(.defaultAction)
                    .disabled(trimmed.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 420)
        .onAppear { draft = appState.orgCode }
    }

    private var trimmed: String {
        draft.trimmingCharacters(in: .whitespaces).uppercased()
    }

    private func apply() {
        let code = trimmed
        guard !code.isEmpty else { return }
        appState.orgCode = code
        onDone()
        // Only reconfigure once there is a token to configure WITH — otherwise
        // AppState would start firing requests it cannot authenticate.
        guard auth.isAuthenticated else { return }
        appState.matchEmail = auth.userEmail
        appState.configure(auth: auth, orgCode: code)
        Task { await appState.loadAll() }
    }
}
