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
        SyncedGroup.self, SyncedTimeclockEntry.self, SyncedOrgConfig.self, SyncedSettings.self, Meta.self,
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
    func applyBatch<T: SyncRecord>(_ type: T.Type, _ records: [Incoming]) {
        guard let ctx, !records.isEmpty else { return }
        let existing = (try? ctx.fetch(FetchDescriptor<T>())) ?? []
        var byId: [String: T] = [:]
        for e in existing { byId[e.id] = e }
        for rec in records {
            if rec.isDeleted {
                if let obj = byId[rec.id] { ctx.delete(obj); byId[rec.id] = nil }
            } else if let obj = byId[rec.id] {
                obj.lastModifiedAt = rec.lastModifiedAt
                obj.deletedAt = nil
                obj.payload = rec.payload
            } else {
                let obj = T(id: rec.id, lastModifiedAt: rec.lastModifiedAt, deletedAt: nil, payload: rec.payload)
                ctx.insert(obj)
                byId[rec.id] = obj
            }
        }
        try? ctx.save()
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
        try? ctx.delete(model: SyncedOrgConfig.self)
        try? ctx.delete(model: SyncedSettings.self)
        try? ctx.save()
    }
}
