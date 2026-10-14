import Testing
import Foundation
@testable import TRAQS_Scheduling

// Trey, 2026-10-13: after logging out and back in, every DM read "DM" and the roster held only
// him. Two halves, both on the phone's cache:
//
//   1. A /sync in flight at logout landed AFTER clearAll — its rows AND its cursor — so the
//      next session delta-synced against a one-person cache instead of doing a full resync.
//      A logged-out cache is now CLOSED: it refuses every write.
//   2. loadAll's GET /people never reached the cache, so a good roster was overwritten by the
//      next rehydrate seconds later — which made a fine request look like a failed one. The
//      roster loadAll fetches now replaces the cached one (PINs stripped, as /sync strips them).
@Suite("Roster and the cache across a logout") @MainActor
struct RosterCacheTests {
    private func freshCache() -> LocalCache {
        let c = LocalCache(); c.initialize(orgCode: "ZZROSTER\(Int.random(in: 0...9_999_999))"); return c
    }
    private func row(_ id: String) -> LocalCache.Incoming {
        .init(id: id, lastModifiedAt: Date(), deletedAt: nil,
              payload: Data(#"{"id":"\#(id)","name":"N\#(id)"}"#.utf8))
    }
    private func people(_ cache: LocalCache) -> [Person] {
        cache.readAll(SyncedPerson.self).compactMap { try? JSONDecoder().decode(Person.self, from: $0.payload) }
    }

    // MARK: 1 — the late delta

    @Test("a sync that lands after logout writes nothing — no rows, no cursor")
    func aClosedCacheRefusesALateSync() {
        let cache = freshCache()
        _ = cache.applyBatch(SyncedPerson.self, (1...19).map { row("p\($0)") })
        cache.setCursor("2026-10-13T00:00:00.000Z", fullSync: true)
        cache.clearAll()
        cache.close()
        // The /sync that was in flight when the user tapped Log Out.
        _ = cache.applyBatch(SyncedPerson.self, [row("p1")])
        cache.setCursor("2026-10-13T00:05:00.000Z")
        #expect(cache.cursor() == nil, "a surviving cursor makes the next session delta-sync")
        #expect(people(cache).isEmpty)
    }

    @Test("a fresh cache for the next session works normally")
    func theNextSessionsCacheIsOpen() {
        let old = freshCache(); old.close()
        let next = freshCache()
        _ = next.applyBatch(SyncedPerson.self, [row("p1")])
        next.setCursor("2026-10-13T01:00:00.000Z")
        #expect(next.cursor() != nil)
        #expect(people(next).count == 1)
    }

    // MARK: 2 — loadAll's roster reaches the cache

    @Test("the roster GET /people returned replaces a one-person cache")
    func aFullRosterReplacesTheCachedOne() throws {
        let cache = freshCache()
        _ = cache.applyBatch(SyncedPerson.self, [row("99")])            // the Trey-only cache
        let sync = SyncService(api: APIService(auth: AuthManager(), orgCode: "ZZROSTER"), cache: cache)
        let body = Data(#"[{"id":"99","name":"Trey","pin":"1234","hasPin":true},{"id":"100","name":"Max"},{"id":"t0gnvtljt","name":"Quincy"}]"#.utf8)
        #expect(sync.mergeFullPeople(body))
        #expect(Set(people(cache).map(\.id)) == ["99", "100", "t0gnvtljt"])
        // /sync never puts a PIN in the cache; the admin GET carries one, so it is stripped.
        let payloads = cache.readAll(SyncedPerson.self).map { String(decoding: $0.payload, as: UTF8.self) }
        #expect(!payloads.contains { $0.contains("\"pin\"") })
    }

    @Test("an empty or unreadable body leaves the cache alone")
    func anEmptyBodyIsANoOp() {
        let cache = freshCache()
        _ = cache.applyBatch(SyncedPerson.self, [row("99"), row("100")])
        let sync = SyncService(api: APIService(auth: AuthManager(), orgCode: "ZZROSTER"), cache: cache)
        #expect(!sync.mergeFullPeople(Data("[]".utf8)))
        #expect(!sync.mergeFullPeople(Data("not json".utf8)))
        #expect(people(cache).count == 2)
    }
}
