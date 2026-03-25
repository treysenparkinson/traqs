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
        KeychainHelper.save(response.accessToken, forKey: KeychainHelper.accessTokenKey)
        if let refresh = response.refreshToken {
            KeychainHelper.save(refresh, forKey: KeychainHelper.refreshTokenKey)
        }
        await fetchUserEmail(token: response.accessToken)
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

    func logout() {
        accessToken = nil
        userEmail = nil
        isAuthenticated = false
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
