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

/**
 * The empty-overwrite guard, shared by every whole-array POST handler.
 *
 * A client bug (failed initial fetch → React resets state → autosave fires)
 * wiped MTX2026TRAQS/tasks.json on 2026-06-03. This makes that race fatal on
 * the server instead of silently destroying data.
 *
 * Runs on the RAW incoming array, BEFORE deletion reconciliation — an empty
 * POST that got past this would tombstone every live record. Only NON-tombstoned
 * stored records count, so once everything is legitimately deleted, the leftover
 * tombstones don't make an empty array get refused forever.
 *
 * `?force=1` is the deliberate escape hatch for actually clearing a dataset.
 *
 * @returns {string|null} an error message when the write must be refused with
 *   409, or null when it may proceed.
 */
export function emptyOverwriteError(incoming, existing, event, label) {
  if (!Array.isArray(incoming) || incoming.length > 0) return null;
  if (event?.queryStringParameters?.force === "1") return null;
  if (!Array.isArray(existing) || !existing.some(isLive)) return null;
  return `Refusing to overwrite non-empty ${label} with empty array`;
}
