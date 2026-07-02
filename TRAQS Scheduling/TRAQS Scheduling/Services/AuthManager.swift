import Foundation
import AuthenticationServices
import CryptoKit

@MainActor
@Observable
class AuthManager: NSObject {
    var accessToken: String? = KeychainHelper.load(forKey: KeychainHelper.accessTokenKey)
    var isAuthenticated: Bool = false
    var isLoading: Bool = false
    var error: String?
    var userEmail: String? = KeychainHelper.load(forKey: "userEmail")

    /// Wall-clock expiry of `accessToken`. Persisted in UserDefaults so we
    /// know whether the token surviving from the last app launch is still
    /// usable; without this we'd always assume the cached token was good
    /// and let the first API call fail with 401 before reacting.
    var expiresAt: Date? = {
        let ts = UserDefaults.standard.double(forKey: "traqs_token_expires_at")
        return ts > 0 ? Date(timeIntervalSince1970: ts) : nil
    }()

    /// Deduplicates concurrent refresh calls. Two API requests that race
    /// past expiry would otherwise each fire their own POST to /oauth/token;
    /// with rotation on, one of them would invalidate the other's refresh
    /// token mid-flight. Whichever caller arrives first creates the task;
    /// everyone else awaits the same result.
    private var refreshTask: Task<String, Error>?

    private var codeVerifier: String = ""

    override init() {
        super.init()
        isAuthenticated = accessToken != nil
    }

    // MARK: - PKCE Login

    func login() async {
        isLoading = true
        error = nil
        codeVerifier = generateCodeVerifier()
        let codeChallenge = generateCodeChallenge(from: codeVerifier)

        var components = URLComponents(url: AppConfig.Auth0.authorizationURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: AppConfig.Auth0.clientId),
            URLQueryItem(name: "redirect_uri", value: AppConfig.Auth0.redirectURI),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "scope", value: AppConfig.Auth0.scope),
            URLQueryItem(name: "audience", value: AppConfig.Auth0.audience)
        ]
        guard let authURL = components.url else {
            error = "Failed to build auth URL"
            isLoading = false
            return
        }

        do {
            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: AppConfig.Auth0.callbackScheme
                ) { url, err in
                    if let err { continuation.resume(throwing: err) }
                    else if let url { continuation.resume(returning: url) }
                    else { continuation.resume(throwing: URLError(.badServerResponse)) }
                }
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                session.start()
            }

            guard let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value else {
                throw URLError(.badServerResponse)
            }

            try await exchangeCode(code)
        } catch {
            if (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                self.error = error.localizedDescription
            }
        }
        isLoading = false
    }

    private func exchangeCode(_ code: String) async throws {
        var request = URLRequest(url: AppConfig.Auth0.tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type": "authorization_code",
            "client_id": AppConfig.Auth0.clientId,
            "code": code,
            "redirect_uri": AppConfig.Auth0.redirectURI,
            "code_verifier": codeVerifier
        ].map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")" }
         .joined(separator: "&")

        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(TokenResponse.self, from: data)

        accessToken = response.accessToken
        isAuthenticated = true
        expiresAt = Date().addingTimeInterval(TimeInterval(response.expiresIn))
        UserDefaults.standard.set(expiresAt!.timeIntervalSince1970, forKey: "traqs_token_expires_at")
        KeychainHelper.save(response.accessToken, forKey: KeychainHelper.accessTokenKey)
        if let refresh = response.refreshToken {
            KeychainHelper.save(refresh, forKey: KeychainHelper.refreshTokenKey)
        }
        await fetchUserEmail(token: response.accessToken)
    }

    // MARK: - Refresh

    /// Returns an access token guaranteed to be valid for at least 30s.
    /// Refreshes silently if the cached one is expired or about to expire.
    /// Throws if no refresh token is available or the refresh itself fails —
    /// callers should treat that as "force re-login".
    func validAccessToken() async throws -> String {
        if let t = accessToken,
           let exp = expiresAt,
           exp > Date().addingTimeInterval(30) {
            return t
        }
        return try await refreshAccessToken()
    }

    /// Force a refresh via Auth0's /oauth/token endpoint. Concurrent calls
    /// share a single in-flight Task so we don't burn (and rotate away)
    /// the refresh token from two requests at once.
    @discardableResult
    func refreshAccessToken() async throws -> String {
        if let existing = refreshTask {
            return try await existing.value
        }
        let task = Task<String, Error> { [weak self] in
            defer { Task { @MainActor in self?.refreshTask = nil } }
            guard let self else { throw URLError(.cancelled) }
            return try await self.performRefresh()
        }
        refreshTask = task
        return try await task.value
    }

    private func performRefresh() async throws -> String {
        guard let refresh = KeychainHelper.load(forKey: KeychainHelper.refreshTokenKey),
              !refresh.isEmpty else {
            // No refresh token on file — the only path forward is the
            // interactive login flow. Surface that by tearing down auth
            // state so RootView swaps in LoginView.
            forceReLogin()
            throw URLError(.userAuthenticationRequired)
        }

        var request = URLRequest(url: AppConfig.Auth0.tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type": "refresh_token",
            "client_id": AppConfig.Auth0.clientId,
            "refresh_token": refresh,
        ].map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")" }
         .joined(separator: "&")
        request.httpBody = body.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            // Auth0 rejected the refresh token (expired, revoked, or
            // rotated past its reuse interval). Nothing we can do
            // silently — fall back to interactive login.
            forceReLogin()
            throw APIError.httpError(http.statusCode)
        }

        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        accessToken = decoded.accessToken
        isAuthenticated = true
        expiresAt = Date().addingTimeInterval(TimeInterval(decoded.expiresIn))
        UserDefaults.standard.set(expiresAt!.timeIntervalSince1970, forKey: "traqs_token_expires_at")
        KeychainHelper.save(decoded.accessToken, forKey: KeychainHelper.accessTokenKey)
        // With Refresh Token Rotation enabled in Auth0, every refresh
        // returns a NEW refresh token and revokes the one we just used
        // (after a short reuse window). Persist the new one immediately —
        // missing this means the next refresh fails with invalid_grant.
        if let newRefresh = decoded.refreshToken, !newRefresh.isEmpty {
            KeychainHelper.save(newRefresh, forKey: KeychainHelper.refreshTokenKey)
        }
        return decoded.accessToken
    }

    private func forceReLogin() {
        accessToken = nil
        expiresAt = nil
        isAuthenticated = false
        UserDefaults.standard.removeObject(forKey: "traqs_token_expires_at")
        KeychainHelper.delete(forKey: KeychainHelper.accessTokenKey)
        KeychainHelper.delete(forKey: KeychainHelper.refreshTokenKey)
    }

    func fetchUserEmail(token: String) async {
        guard let url = URL(string: "https://\(AppConfig.Auth0.domain)/userinfo") else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let email = json["email"] as? String else { return }
        userEmail = email
        KeychainHelper.save(email, forKey: "userEmail")
    }

    /// Called at the very start of logout() so AppState can disconnect live-sync
    /// (Ably) before the session is torn down. Registered in AppState.configure().
    var onLogout: (() -> Void)?

    func logout() {
        onLogout?()
        accessToken = nil
        userEmail = nil
        isAuthenticated = false
        expiresAt = nil
        UserDefaults.standard.removeObject(forKey: "traqs_token_expires_at")
        KeychainHelper.delete(forKey: KeychainHelper.accessTokenKey)
        KeychainHelper.delete(forKey: KeychainHelper.refreshTokenKey)
        KeychainHelper.delete(forKey: "userEmail")
    }

    // MARK: - PKCE Helpers

    private func generateCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 64)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func generateCodeChallenge(from verifier: String) -> String {
        let data = Data(verifier.utf8)
        let hash = SHA256.hash(data: data)
        return Data(hash).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - Presentation Context

extension AuthManager: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(iOS)
        return MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let active = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
            return active?.keyWindow ?? active?.windows.first ?? UIWindow()
        }
        #else
        return NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #endif
    }
}

// MARK: - Token Response

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}
