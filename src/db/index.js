import Dexie from "dexie";

// IndexedDB cache for instant cold-open + delta-sync target.
//
// Tables mirror the /sync response shape. Array entities are keyed by their
// string `id` (every synced record has one — tasks/people/clients/groups/
// messages carry ids; timeclock entries use tc_/tce_/js_ ids). The two
// object entities (orgConfig, settings) live in single-row stores keyed by a
// fixed "current". `meta` holds the delta-sync cursor under "sync-cursor".
//
// Schema is versioned at 1; bump db.version(n) when the entity set changes.
export const db = new Dexie("traqs");
db.version(1).stores({
  tasks: "id, lastModifiedAt",
  people: "id, lastModifiedAt",
  clients: "id, lastModifiedAt",
  messages: "id, lastModifiedAt, threadKey",
  groups: "id, lastModifiedAt",
  timeclock: "id, lastModifiedAt, personId",
  orgConfig: "key",   // single row { key: "current", value: {...} }
  settings: "key",    // single row { key: "current", value: {...} }
  meta: "key",        // { key: "sync-cursor", serverTime, lastFullSyncAt }
});
// v2: pay/production split — timeclock.json → payhours.json (+ productionhours.json).
// Drop the old `timeclock` table (data re-syncs into `payhours` on next deltaSync)
// and add the two renamed slices. See PAYHOURS/PRODUCTIONHOURS contract.
db.version(2).stores({
  timeclock: null,    // dropped — replaced by payhours
  payhours: "id, lastModifiedAt, personId",
  productionhours: "id, lastModifiedAt, personId",
});

// Event bus so the write-through cache can tell React which slices to re-hydrate.
// applyDelta() dispatches `${entity}-changed` (and a summary `any-changed`);
// TRAQS.jsx listens and pulls the fresh slice from Dexie into React state.
export const syncBus = new EventTarget();

// Entities stored as arrays of records (vs the two object entities).
export const ARRAY_ENTITIES = ["tasks", "people", "clients", "messages", "groups", "payhours", "productionhours"];
export const OBJECT_ENTITIES = ["orgConfig", "settings"];
