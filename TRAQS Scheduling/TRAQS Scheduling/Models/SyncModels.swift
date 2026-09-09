import Foundation
import SwiftData

// SwiftData cache models for the delta-sync layer, mirroring the /sync response.
//
// DESIGN: each record is stored as its RAW JSON payload (a Data blob) plus the
// three sync fields we actually query on (id / lastModifiedAt / deletedAt). We
// deliberately do NOT map every entity field into SwiftData columns:
//   • The nested job tree (job → panels → operations) is awkward as relationships,
//     and the spec explicitly endorses the blob approach for it.
//   • Storing the exact API JSON and decoding it back through the SAME lenient
//     Codable structs the network layer already uses (Job/Person/Client/…,
//     with decodeFlexID + decodeIfPresent + defaults) means a schema drift
//     (extra/missing fields) degrades gracefully instead of crashing — it's the
//     one decoder of record, so cache and network can never disagree.
//   • We always read/write whole entity slices, so per-field querying buys nothing.
//
// `id` is @Attribute(.unique): inserting a record whose id already exists UPSERTS
// (SwiftData replaces the existing instance) — that's how applyDelta upserts.

@Model final class SyncedJob {
    @Attribute(.unique) var id: String
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data           // raw JSON of the job record; decode with Job.self
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

@Model final class SyncedPerson {
    @Attribute(.unique) var id: String
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

@Model final class SyncedClient {
    @Attribute(.unique) var id: String
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

@Model final class SyncedMessage {
    @Attribute(.unique) var id: String
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

@Model final class SyncedGroup {
    @Attribute(.unique) var id: String
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

@Model final class SyncedTimeclockEntry {
    @Attribute(.unique) var id: String
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

// Per-job production sessions (js_… rows), synced under the "productionhours"
// entity. Mirrors SyncedTimeclockEntry — raw JSON blob + the three sync fields.
@Model final class SyncedProductionHours {
    @Attribute(.unique) var id: String
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

// Single-instance object entities. `id` is a fixed "current" so there's exactly
// one row; the whole object is the payload (decode with OrgSettings.self etc.).
@Model final class SyncedOrgConfig {
    @Attribute(.unique) var id: String   // always "current"
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String = "current", lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

@Model final class SyncedSettings {
    @Attribute(.unique) var id: String   // always "current"
    var lastModifiedAt: Date?
    var deletedAt: Date?
    var payload: Data
    init(id: String = "current", lastModifiedAt: Date?, deletedAt: Date?, payload: Data) {
        self.id = id; self.lastModifiedAt = lastModifiedAt; self.deletedAt = deletedAt; self.payload = payload
    }
}

// Shared shape of the 8 entity caches so LocalCache can operate generically
// (one fetch/upsert/delete code path instead of eight). Conformance is declared
// via extensions below — the classes already have every requirement, and being
// `final` they satisfy the init requirement without `required`.
protocol SyncRecord: PersistentModel {
    var id: String { get set }
    var lastModifiedAt: Date? { get set }
    var deletedAt: Date? { get set }
    var payload: Data { get set }
    init(id: String, lastModifiedAt: Date?, deletedAt: Date?, payload: Data)

    /// A predicate matching the named rows, built against the CONCRETE type.
    ///
    /// This deliberately cannot live in a protocol extension, and that is the
    /// whole point of it being a requirement. Written generically —
    /// `#Predicate<Self> { ids.contains($0.id) }` — `$0.id` compiles to the
    /// SyncRecord protocol-witness keypath. SwiftData resolves a predicate's
    /// keypaths against the ones the `@Model` macro registered on the concrete
    /// class, the witness is not among them, and the fetch TRAPS at runtime:
    ///
    ///     Fatal error: Couldn't find \SyncedPerson.<computed … (String)> on
    ///     SyncedPerson with fields [id, lastModifiedAt, deletedAt, payload]
    ///
    /// It traps rather than failing to compile, and only on the branch that
    /// builds a predicate at all (`LocalCache.applyBatch`, small batches), so a
    /// first sync — one big batch — sails past it and the crash lands on the
    /// NEXT launch, once the cache is warm and the delta is small.
    ///
    /// Each conformance therefore spells the predicate out, where `$0.id` is the
    /// stored property itself and the keypath is the registered one.
    static func withIDs(_ ids: [String]) -> Predicate<Self>
}

extension SyncedJob: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedJob> { #Predicate { ids.contains($0.id) } }
}
extension SyncedPerson: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedPerson> { #Predicate { ids.contains($0.id) } }
}
extension SyncedClient: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedClient> { #Predicate { ids.contains($0.id) } }
}
extension SyncedMessage: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedMessage> { #Predicate { ids.contains($0.id) } }
}
extension SyncedGroup: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedGroup> { #Predicate { ids.contains($0.id) } }
}
extension SyncedTimeclockEntry: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedTimeclockEntry> { #Predicate { ids.contains($0.id) } }
}
extension SyncedProductionHours: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedProductionHours> { #Predicate { ids.contains($0.id) } }
}
extension SyncedOrgConfig: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedOrgConfig> { #Predicate { ids.contains($0.id) } }
}
extension SyncedSettings: SyncRecord {
    static func withIDs(_ ids: [String]) -> Predicate<SyncedSettings> { #Predicate { ids.contains($0.id) } }
}

// Delta-sync cursor. Single row keyed "sync-cursor".
@Model final class Meta {
    @Attribute(.unique) var id: String   // always "sync-cursor"
    var serverTime: String?              // ISO cursor from the last /sync response
    var lastFullSyncAt: Date?
    init(id: String = "sync-cursor", serverTime: String? = nil, lastFullSyncAt: Date? = nil) {
        self.id = id; self.serverTime = serverTime; self.lastFullSyncAt = lastFullSyncAt
    }
}
