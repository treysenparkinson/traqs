import Foundation

// Delta-sync client: pulls /sync?since=<cursor>, writes the changes through to
// the SwiftData cache, and advances the cursor. Mirrors the desktop db/sync.js.
// @MainActor so cache writes and the in-flight guard are serialized on main.
@MainActor
final class SyncService {
    private let api: APIService
    private let cache: LocalCache

    // Coalescing guard: concurrent callers collapse onto one round-trip; a call
    // that arrives mid-flight sets `rerun` so exactly one more sync runs after,
    // guaranteeing the latest server state without interleaving applies
    // (adversarial check #3).
    private var inFlight = false
    private var rerun = false

    init(api: APIService, cache: LocalCache) {
        self.api = api
        self.cache = cache
    }

    // ISO parsing — the API emits fractional-second timestamps; fall back to
    // the plain form. lastModifiedAt/deletedAt are informational in the cache.
    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static func date(_ v: Any?) -> Date? {
        guard let s = v as? String, !s.isEmpty else { return nil }
        return isoFrac.date(from: s) ?? isoPlain.date(from: s)
    }
    private static func idString(_ v: Any?) -> String? {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }

    private func parseArray(_ raw: Any?) -> [LocalCache.Incoming] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        var out: [LocalCache.Incoming] = []
        out.reserveCapacity(arr.count)
        for rec in arr {
            guard let id = Self.idString(rec["id"]) else { continue }
            let payload = (try? JSONSerialization.data(withJSONObject: rec)) ?? Data()
            out.append(.init(id: id,
                             lastModifiedAt: Self.date(rec["lastModifiedAt"]),
                             deletedAt: Self.date(rec["deletedAt"]),
                             payload: payload))
        }
        return out
    }

    private func parseObject(_ raw: Any?) -> LocalCache.Incoming? {
        guard let obj = raw as? [String: Any] else { return nil }
        let payload = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
        return .init(id: "current", lastModifiedAt: Self.date(obj["lastModifiedAt"]), deletedAt: nil, payload: payload)
    }

    // Write one /sync response through to the cache (synchronous → atomic vs
    // other main-actor work), then advance the cursor.
    private func applyDelta(_ dict: [String: Any]) {
        cache.applyBatch(SyncedJob.self, parseArray(dict["tasks"]))
        cache.applyBatch(SyncedPerson.self, parseArray(dict["people"]))
        cache.applyBatch(SyncedClient.self, parseArray(dict["clients"]))
        cache.applyBatch(SyncedMessage.self, parseArray(dict["messages"]))
        cache.applyBatch(SyncedGroup.self, parseArray(dict["groups"]))
        cache.applyBatch(SyncedTimeclockEntry.self, parseArray(dict["timeclock"]))
        if let cfg = parseObject(dict["orgConfig"]) { cache.applyBatch(SyncedOrgConfig.self, [cfg]) }
        if let set = parseObject(dict["settings"]) { cache.applyBatch(SyncedSettings.self, [set]) }
        if let serverTime = dict["serverTime"] as? String { cache.setCursor(serverTime) }
    }

    private func fetchDelta(since: String?) async throws -> [String: Any] {
        let data = try await api.fetchSyncData(since: since)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    // Full snapshot into freshly-cleared tables (first load / forced rebuild).
    private func fullResync() async throws {
        let dict = try await fetchDelta(since: nil)
        cache.clearAll()
        applyDelta(dict)
        if let st = dict["serverTime"] as? String { cache.setCursor(st, fullSync: true) }
    }

    // Incremental sync from the stored cursor; full resync if there's none yet.
    // Returns true if a sync completed successfully (so the caller can rehydrate).
    @discardableResult
    func deltaSync() async -> Bool {
        if inFlight { rerun = true; return false }
        inFlight = true
        defer { inFlight = false }
        var ok = false
        repeat {
            rerun = false
            do {
                if let cursor = cache.cursor() {
                    applyDelta(try await fetchDelta(since: cursor))
                } else {
                    try await fullResync()
                }
                ok = true
            } catch {
                print("[SyncService] deltaSync failed: \(error)")
            }
        } while rerun
        return ok
    }
}
