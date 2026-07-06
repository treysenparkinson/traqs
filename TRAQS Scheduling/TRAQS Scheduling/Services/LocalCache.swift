import Foundation
import SwiftData

// Per-org SwiftData cache: the offline snapshot + delta-sync target. @MainActor
// because its only caller (AppState) is, and we operate on the container's
// mainContext. Records are stored as raw JSON blobs (see SyncModels.swift).
@MainActor
final class LocalCache {
    private(set) var container: ModelContainer?
    private var currentOrg: String?

    private static let schema = Schema([
        SyncedJob.self, SyncedPerson.self, SyncedClient.self, SyncedMessage.self,
        SyncedGroup.self, SyncedTimeclockEntry.self, SyncedProductionHours.self, SyncedOrgConfig.self, SyncedSettings.self, Meta.self,
    ])

    // A parsed /sync record on its way into the cache.
    struct Incoming {
        let id: String
        let lastModifiedAt: Date?
        let deletedAt: Date?
        let payload: Data
        var isDeleted: Bool { deletedAt != nil }
    }

    // Idempotent: a second call for the same org reuses the already-open
    // container (adversarial check #1); a different org opens that org's own
    // SQLite file. Never recreates a container that's already live.
    func initialize(orgCode: String) {
        if container != nil, currentOrg == orgCode { return }
        let safe = orgCode.isEmpty ? "default" : orgCode.replacingOccurrences(of: "/", with: "_")
        let dir = URL.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(path: "traqs-cache-\(safe).sqlite")
        do {
            container = try ModelContainer(for: Self.schema, configurations: ModelConfiguration(url: url))
            currentOrg = orgCode
        } catch {
            print("[LocalCache] failed to open container: \(error)")
            container = nil
            currentOrg = nil
        }
    }

    private var ctx: ModelContext? { container?.mainContext }

    // True once any jobs/people are cached — gates "paint from cache" vs "spinner".
    func hasCachedData() -> Bool {
        guard let ctx else { return false }
        if (try? ctx.fetchCount(FetchDescriptor<SyncedJob>())) ?? 0 > 0 { return true }
        return (try? ctx.fetchCount(FetchDescriptor<SyncedPerson>())) ?? 0 > 0
    }

    func readAll<T: SyncRecord>(_ type: T.Type) -> [T] {
        guard let ctx else { return [] }
        return (try? ctx.fetch(FetchDescriptor<T>())) ?? []
    }

    // Upsert the live records and evict the tombstoned ones (matching the
    // desktop: the cache holds only live rows). One fetch per batch → O(n).
    @discardableResult
    func applyBatch<T: SyncRecord>(_ type: T.Type, _ records: [Incoming]) -> Int {
        guard let ctx, !records.isEmpty else { return 0 }
        let existing = (try? ctx.fetch(FetchDescriptor<T>())) ?? []
        var byId: [String: T] = [:]
        for e in existing { byId[e.id] = e }
        var wrote = 0, inserted = 0, deleted = 0
        for rec in records {
            if rec.isDeleted {
                if let obj = byId[rec.id] { ctx.delete(obj); byId[rec.id] = nil; deleted += 1 }
                // else: tombstone for a record we don't cache → nothing to evict
            } else if let obj = byId[rec.id] {
                // Skip no-op rewrites. SwiftData writes run on the main actor, so
                // rewriting the entire delta every sync — e.g. legacy messages that
                // /sync re-sends forever because they carry no lastModifiedAt — stalls
                // the UI. The server advances lastModifiedAt ONLY on a real content
                // change (stampArray preserves it otherwise), so equal stamps ⇒
                // unchanged. When neither side has a stamp, compare canonical payload
                // bytes (parseArray uses .sortedKeys, so equal content ⇒ equal bytes).
                let unchanged: Bool
                if let inLM = rec.lastModifiedAt, let curLM = obj.lastModifiedAt { unchanged = (inLM == curLM) }
                else if rec.lastModifiedAt == nil, obj.lastModifiedAt == nil { unchanged = (obj.payload == rec.payload) }
                else { unchanged = false }
                if unchanged { continue }
                obj.lastModifiedAt = rec.lastModifiedAt
                obj.deletedAt = nil
                obj.payload = rec.payload
                wrote += 1
            } else {
                let obj = T(id: rec.id, lastModifiedAt: rec.lastModifiedAt, deletedAt: nil, payload: rec.payload)
                ctx.insert(obj)
                byId[rec.id] = obj
                inserted += 1
            }
        }
        let writes = wrote + inserted + deleted
        if writes > 0 { try? ctx.save() }  // nothing dirtied → skip the save entirely
        return writes
    }

    // ── Cursor (Meta) ──
    func cursor() -> String? {
        guard let ctx else { return nil }
        return (try? ctx.fetch(FetchDescriptor<Meta>()))?.first?.serverTime
    }

    func setCursor(_ serverTime: String, fullSync: Bool = false) {
        guard let ctx else { return }
        if let m = (try? ctx.fetch(FetchDescriptor<Meta>()))?.first {
            m.serverTime = serverTime
            if fullSync { m.lastFullSyncAt = Date() }
        } else {
            ctx.insert(Meta(id: "sync-cursor", serverTime: serverTime, lastFullSyncAt: fullSync ? Date() : nil))
        }
        try? ctx.save()
    }

    // Wipe all entity rows (used before a full resync so server-side hard
    // deletes that left no tombstone can't linger).
    func clearAll() {
        guard let ctx else { return }
        try? ctx.delete(model: SyncedJob.self)
        try? ctx.delete(model: SyncedPerson.self)
        try? ctx.delete(model: SyncedClient.self)
        try? ctx.delete(model: SyncedMessage.self)
        try? ctx.delete(model: SyncedGroup.self)
        try? ctx.delete(model: SyncedTimeclockEntry.self)
        try? ctx.delete(model: SyncedProductionHours.self)
        try? ctx.delete(model: SyncedOrgConfig.self)
        try? ctx.delete(model: SyncedSettings.self)
        // Also drop the sync cursor so the caller re-fetches from scratch.
        // fullResync() (the other caller) immediately re-sets it via setCursor;
        // on logout, clearing it makes the next login full-resync into a clean
        // cache instead of delta-syncing from the previous user's cursor.
        try? ctx.delete(model: Meta.self)
        try? ctx.save()
    }
}
