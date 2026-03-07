import Foundation

enum AppConfig {
    static let netlifyBase = "https://traqs.netlify.app/.netlify/functions"

    enum Auth0 {
        static let domain = "matrixpci.us.auth0.com"
        static let clientId = "xnuXY9QAr8VaB7so8DfBHydUgTgKbGtt"
        static let audience = "https://traqs.matrixsystems.com/api"
        static let callbackScheme = "TRAQS.TRAQS-Scheduling"
        static let redirectURI = "TRAQS.TRAQS-Scheduling://callback"
        static let scope = "openid profile email offline_access"

        static var authorizationURL: URL {
            URL(string: "https://\(domain)/authorize")!
        }
        static var tokenURL: URL {
            URL(string: "https://\(domain)/oauth/token")!
        }
    }
}
