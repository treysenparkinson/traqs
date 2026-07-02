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
}

extension SyncedJob: SyncRecord {}
extension SyncedPerson: SyncRecord {}
extension SyncedClient: SyncRecord {}
extension SyncedMessage: SyncRecord {}
extension SyncedGroup: SyncRecord {}
extension SyncedTimeclockEntry: SyncRecord {}
extension SyncedOrgConfig: SyncRecord {}
extension SyncedSettings: SyncRecord {}

// Delta-sync cursor. Single row keyed "sync-cursor".
@Model final class Meta {
    @Attribute(.unique) var id: String   // always "sync-cursor"
    var serverTime: String?              // ISO cursor from the last /sync response
    var lastFullSyncAt: Date?
    init(id: String = "sync-cursor", serverTime: String? = nil, lastFullSyncAt: Date? = nil) {
        self.id = id; self.serverTime = serverTime; self.lastFullSyncAt = lastFullSyncAt
    }
}
