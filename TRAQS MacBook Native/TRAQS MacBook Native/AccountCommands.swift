import SwiftUI

// MARK: - Account menu
//
// Sign Out, and nothing else.
//
// This used to carry `Sign In…` and `Set Org Code…` too, as scaffolding — PASS 0
// had no gate, so the native half had no way to reach a session. `MacAuthGate`
// owns both of those now, and two ways to sign in is one too many.
//
// Sign Out stays because a Mac app should have it in the menu bar. It returns to
// the gate rather than to an empty shell.
struct AccountCommands: Commands {
    let auth: AuthManager

    var body: some Commands {
        CommandMenu("Account") {
            if auth.isAuthenticated {
                // The signed-in identity, as a disabled row — a menu that only
                // offers "Sign Out" leaves you guessing who you are.
                Text(auth.userEmail ?? "Signed in")
                Divider()
                Button("Sign Out") { auth.logout() }
            } else {
                Text("Not signed in")
            }
        }
    }
}
