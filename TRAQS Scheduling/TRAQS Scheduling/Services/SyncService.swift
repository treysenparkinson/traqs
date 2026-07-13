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
            // .sortedKeys → canonical bytes: identical content always serializes
            // to identical bytes, so applyBatch's "did this change?" byte compare
            // is reliable (JSONSerialization's default key order is not stable).
            let payload = (try? JSONSerialization.data(withJSONObject: rec, options: [.sortedKeys])) ?? Data()
            out.append(.init(id: id,
                             lastModifiedAt: Self.date(rec["lastModifiedAt"]),
                             deletedAt: Self.date(rec["deletedAt"]),
                             payload: payload))
        }
        return out
    }

    private func parseObject(_ raw: Any?) -> LocalCache.Incoming? {
        guard let obj = raw as? [String: Any] else { return nil }
        let payload = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
        return .init(id: "current", lastModifiedAt: Self.date(obj["lastModifiedAt"]), deletedAt: nil, payload: payload)
    }

    // Write one /sync response through to the cache (synchronous → atomic vs
    // other main-actor work), then advance the cursor.
    // Returns the number of records actually written to the cache (upserts +
    // inserts + deletes; no-op re-sends are skipped by applyBatch). The caller
    // rehydrates the UI ONLY when this is > 0, so a coalesced/empty delta never
    // triggers a spurious @Observable churn.
    @discardableResult
    private func applyDelta(_ dict: [String: Any]) -> Int {
        let tasks = parseArray(dict["tasks"]), people = parseArray(dict["people"]), clients = parseArray(dict["clients"])
        let messages = parseArray(dict["messages"]), groups = parseArray(dict["groups"])
        // Pay punches now arrive under "payhours"; the server also sends a
        // deprecated "timeclock" alias during rollout — fall back to it if the
        // new key is absent. Both feed the same SyncedTimeclockEntry cache.
        let payhours = dict["payhours"] != nil ? parseArray(dict["payhours"]) : parseArray(dict["timeclock"])
        let productionhours = parseArray(dict["productionhours"])
        var w = 0
        w += cache.applyBatch(SyncedJob.self, tasks)
        w += cache.applyBatch(SyncedPerson.self, people)
        w += cache.applyBatch(SyncedClient.self, clients)
        w += cache.applyBatch(SyncedMessage.self, messages)
        w += cache.applyBatch(SyncedGroup.self, groups)
        w += cache.applyBatch(SyncedTimeclockEntry.self, payhours)
        w += cache.applyBatch(SyncedProductionHours.self, productionhours)
        if let cfg = parseObject(dict["orgConfig"]) { w += cache.applyBatch(SyncedOrgConfig.self, [cfg]) }
        if let set = parseObject(dict["settings"]) { w += cache.applyBatch(SyncedSettings.self, [set]) }
        if let serverTime = dict["serverTime"] as? String { cache.setCursor(serverTime) }
        return w
    }

    // Reconcile the viewer's FULL message list (raw /messages GET bytes) into the
    // cache. Runs the same canonical parse as a delta (parseArray → .sortedKeys),
    // then LocalCache.reconcile upserts present rows and evicts absent ones so the
    // cache exactly mirrors the server's authoritative set. This is what lets a
    // rehydrate surface history the time-filtered delta stream never carried
    // (e.g. a group's messages from before the viewer joined). Empty input is a
    // no-op — a transient empty GET must not wipe the cache. Returns true iff the
    // cache actually changed, so the caller rehydrates only when needed.
    @discardableResult
    func mergeFullMessages(_ data: Data) -> Bool {
        guard let raw = try? JSONSerialization.jsonObject(with: data) else { return false }
        let incoming = parseArray(raw)
        guard !incoming.isEmpty else { return false }
        return cache.reconcile(SyncedMessage.self, incoming) > 0
    }

    private func fetchDelta(since: String?) async throws -> [String: Any] {
        let data = try await api.fetchSyncData(since: since)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    // Full snapshot into freshly-cleared tables (first load / forced rebuild).
    @discardableResult
    private func fullResync() async throws -> Int {
        let dict = try await fetchDelta(since: nil)
        cache.clearAll()
        let w = applyDelta(dict)
        if let st = dict["serverTime"] as? String { cache.setCursor(st, fullSync: true) }
        return w
    }

    // Incremental sync from the stored cursor; full resync if there's none yet.
    // Returns true only if this sync actually WROTE something to the cache, so
    // the caller can skip rehydrating (and the resulting @Observable churn) when
    // nothing changed. A coalesced call returns false — the in-flight run reruns
    // and its caller does the single rehydrate.
    @discardableResult
    func deltaSync() async -> Bool {
        if inFlight { rerun = true; return false }
        inFlight = true
        defer { inFlight = false }
        var totalWrites = 0
        repeat {
            rerun = false
            do {
                if let cursor = cache.cursor() {
                    totalWrites += applyDelta(try await fetchDelta(since: cursor))
                } else {
                    totalWrites += try await fullResync()
                }
            } catch {
                print("[sync] deltaSync failed: \(error)")
            }
        } while rerun
        return totalWrites > 0
    }
}
