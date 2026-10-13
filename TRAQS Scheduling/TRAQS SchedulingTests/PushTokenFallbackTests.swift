import Testing
import Foundation
@testable import TRAQS_Scheduling

// #525. When the push-token PATCH failed for ANY reason, the phone fell back to a whole-
// roster POST — on launch and every foreground, with nobody touching anything, from the
// cached roster. That fallback exists for one case only: a server too old to have the
// PATCH (404 / 405). A timeout or a dropped connection is not that case, and the next
// foreground retries anyway (`confirmedPushToken` stays unset on failure).
@Suite("Push-token registration falls back to a roster save only for an old server (#525)")
struct PushTokenFallbackTests {
    @Test("a server without PATCH (404 / 405) still gets the roster fallback")
    func oldServer() {
        #expect(AppState.pushTokenFallsBackToRoster(APIError.httpError(404)))
        #expect(AppState.pushTokenFallsBackToRoster(APIError.httpError(405)))
    }

    @Test("a network blip or a server error does not post the roster")
    func everythingElse() {
        #expect(!AppState.pushTokenFallsBackToRoster(APIError.httpError(500)))
        #expect(!AppState.pushTokenFallsBackToRoster(APIError.httpError(401)))
        #expect(!AppState.pushTokenFallsBackToRoster(URLError(.timedOut)))
        #expect(!AppState.pushTokenFallsBackToRoster(URLError(.notConnectedToInternet)))
        #expect(!AppState.pushTokenFallsBackToRoster(URLError(.networkConnectionLost)))
    }
}
