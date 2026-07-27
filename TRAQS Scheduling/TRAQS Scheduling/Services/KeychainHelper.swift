import Foundation
import Security

struct KeychainHelper {
    @discardableResult
    static func save(_ value: String, forKey key: String) -> Bool {
        let data = Data(value.utf8)
        let match: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // AfterFirstUnlock so background refresh tasks can still read
            // the token; ThisDeviceOnly to keep auth material out of
            // iCloud Keychain sync (no token portability across devices).
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        // Update-in-place, falling back to add — more robust than delete+add,
        // which could silently no-op (leaving the OLD token) when a leftover item
        // with mismatched accessibility resisted the delete. A failed write of a
        // rotated refresh token was previously invisible and bounced the user to
        // login on the next refresh; now we at least surface the OSStatus.
        var status = SecItemUpdate(match as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(match.merging(attributes) { $1 } as CFDictionary, nil)
        }
        if status != errSecSuccess {
            print("[keychain] save failed for \(key): OSStatus \(status)")
        }
        return status == errSecSuccess
    }

    static func load(forKey key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(forKey key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}

extension KeychainHelper {
    static let accessTokenKey = "traqs_access_token"
    static let refreshTokenKey = "traqs_refresh_token"
    static let orgCodeKey = "traqs_org_code"
}
