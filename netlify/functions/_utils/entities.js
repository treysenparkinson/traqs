// Shared "is this record live?" filter for the syncable entity datasets
// (people / tasks / clients / groups).
//
// Deletions are SOFT: a removed record is kept in its array with a `deletedAt`
// tombstone so delta-sync (/sync) can tell caching clients to evict it (see
// _utils/timestamps.js). The consequence is that every INTERNAL reader that
// iterates these datasets for LOGIC — org membership, notification targets,
// message thread ACLs, roster lookups — must skip tombstones, or a "deleted"
// record still counts as live (e.g. a removed employee keeps org membership and
// can still authenticate, a deleted admin still gets notified).
//
// Deliberately NOT applied by:
//   • /sync and backup-daily — they need the raw arrays WITH tombstones (sync
//     ships tombstones so clients evict; backup snapshots everything).
//   • the entity WRITE handlers (tasks/people/clients/groups POST/PATCH,
//     timeclock, timeoff) — they read the raw array, mutate it, and write it
//     back; filtering there would silently drop the tombstones they must keep.

/** True when a record carries no deletion tombstone. */
export const isLive = (record) => !record?.deletedAt;

/**
 * Drop tombstoned records from an entity array. A non-array argument (e.g. the
 * null from a missing S3 key) is returned unchanged so callers can keep their
 * own `Array.isArray` / `?? []` handling.
 */
export const filterLive = (arr) => (Array.isArray(arr) ? arr.filter(isLive) : arr);
