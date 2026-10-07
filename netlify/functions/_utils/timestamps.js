// Delta-sync timestamping helpers.
//
// Every syncable entity record carries a `lastModifiedAt` ISO string. The
// /sync endpoint filters by it so clients (desktop React, iOS) fetch only what
// changed since their last pull instead of the whole org on every load. The
// invariant that makes that safe: `lastModifiedAt` must advance ONLY when a
// record's content actually changes. If we stamped every record on every write,
// a single autosave would make the next sync re-send everything and the feature
// would be pointless — so `stampArray` diffs against the previous S3 version and
// preserves the old timestamp for unchanged records.
//
// Deletions use a tombstone (`deletedAt`) rather than removing the record, so a
// syncing client learns the record is gone (a filtered-away record would just
// silently linger in the client's local cache forever).

/** Current time as an ISO-8601 string — the single clock all stamps read. */
export function nowIso() {
  return new Date().toISOString();
}

// Deterministic serialization for the "did the content change?" comparison.
// Plain JSON.stringify is key-order sensitive: a record round-tripped through
// React state can come back with its keys reordered, which would make an
// unchanged record look changed and defeat the whole preserve-timestamp
// optimization. Sorting keys at every level makes the comparison depend on
// content alone. `lastModifiedAt` (and any key passed in `omit`) is skipped so a
// record only compares its meaningful fields.
function stableStringify(value, omit) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v, null)).join(",") + "]";
  const keys = Object.keys(value).filter((k) => !(omit && omit.has(k))).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k], null)).join(",") + "}";
}

// Fields excluded from the content comparison at the record ROOT. `lastModifiedAt`
// is the stamp itself; comparing it would always report "changed".
const COMPARE_OMIT = new Set(["lastModifiedAt"]);

/**
 * Return a NEW array where every record has a `lastModifiedAt`.
 *
 * For each incoming record:
 *   - If it has no `id`, we can't match it to a prior version, so it is stamped
 *     with the current time on every write (best we can do without a key).
 *   - Otherwise, if a previous record with the same id exists and its content
 *     (all fields except `lastModifiedAt`) is identical, the previous timestamp
 *     is preserved. Any change — or a brand-new id — gets the current time.
 *
 * `previous` may be null/undefined/non-array (e.g. the key didn't exist yet);
 * it is treated as "no prior records", so everything gets a fresh stamp.
 * The input arrays are never mutated.
 */
export function stampArray(next, previous) {
  const stamp = nowIso();
  if (!Array.isArray(next)) return next;

  // Index the previous version by id for O(1) lookup. Ids are compared as
  // strings because the web app stores some as Int and some as String.
  const prevById = new Map();
  if (Array.isArray(previous)) {
    for (const rec of previous) {
      if (rec && rec.id != null) prevById.set(String(rec.id), rec);
    }
  }

  return next.map((rec) => {
    if (!rec || typeof rec !== "object" || rec.id == null) {
      // No id → no stable identity to diff against → always stamp.
      return { ...rec, lastModifiedAt: stamp };
    }
    const prev = prevById.get(String(rec.id));
    if (prev && stableStringify(rec, COMPARE_OMIT) === stableStringify(prev, COMPARE_OMIT)) {
      // Unchanged content → keep the old stamp so sync doesn't re-send it.
      // If the previous copy predates timestamps (no stamp yet), fall back to
      // the current time so the record still gets one.
      return { ...rec, lastModifiedAt: prev.lastModifiedAt ?? stamp };
    }
    return { ...rec, lastModifiedAt: prev ? laterThan(prev.lastModifiedAt, stamp) : stamp };
  });
}

// A changed record's new stamp must be LATER than its old one. Stamps have
// millisecond resolution, so two writes to one record inside the same
// millisecond used to get the same stamp — and a stamp that doesn't move can't
// tell a stale copy from a fresh one (tasks.js conflict check, SCHEDULE_MAP
// #185), nor tell delta-sync the record changed again. Nudged 1ms past the old
// stamp in that case; normally `stamp` is already later and is used as is.
function laterThan(prevStamp, stamp) {
  const p = Date.parse(prevStamp ?? "");
  if (!Number.isFinite(p) || Date.parse(stamp) > p) return stamp;
  return new Date(p + 1).toISOString();
}

/**
 * Object-shaped counterpart to stampArray, for the whole-object entities
 * (org config, settings). Returns a NEW object with `lastModifiedAt`: preserved
 * if the content (all fields except `lastModifiedAt`) matches `previous`,
 * otherwise the current time. `previous` may be null/non-object (first write).
 * Non-object `next` is returned untouched.
 */
export function stampObject(next, previous) {
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;
  const isPrevObj = previous && typeof previous === "object" && !Array.isArray(previous);
  if (isPrevObj && stableStringify(next, COMPARE_OMIT) === stableStringify(previous, COMPARE_OMIT)) {
    return { ...next, lastModifiedAt: previous.lastModifiedAt ?? nowIso() };
  }
  return { ...next, lastModifiedAt: nowIso() };
}

/**
 * Tombstone a record: mark it deleted (and modified) but keep it in the array.
 * Sync includes tombstones so clients remove them from their local cache; a
 * hard splice/filter would make the deletion invisible to delta-sync clients.
 */
export function softDelete(record) {
  const stamp = nowIso();
  return { ...record, deletedAt: stamp, lastModifiedAt: stamp };
}

/**
 * Reconcile client-intended deletions for the full-array-POST entities
 * (tasks/people/clients/groups). Those endpoints receive the ENTIRE array from
 * the client, so a record the client deleted just doesn't appear in `next`. A
 * plain write would hard-delete it, and delta-sync — which only ships records
 * present in the array — could never tell caching clients it's gone, so it would
 * linger in their local store forever. So every id present in `previous` but
 * absent from `next` is turned into a tombstone kept in the returned array,
 * exactly like messages.js does on its explicit delete path.
 *
 * A record that ALREADY carries `deletedAt` is carried forward UNCHANGED (not
 * re-tombstoned): passing the identical object through means stampArray sees
 * matching content and preserves its stamp, so a standing tombstone is neither
 * re-stamped nor re-sent in every delta. Records without an id can't be tracked
 * across writes, so their deletion can't be detected here — they're ignored
 * (stampArray already stamps id-less records on every write anyway).
 *
 * Returns a NEW array; never mutates the inputs. `previous` may be null / not an
 * array (first write) → `next` is returned unchanged.
 */
// `onDelete` builds the tombstone for a newly-removed record; defaults to
// softDelete. Callers pass a custom one to strip sensitive fields before
// tombstoning (e.g. people.js drops the PIN so a removed employee's PIN doesn't
// linger at rest). It is applied ONLY to freshly-deleted records — an already
// tombstoned record is carried forward untouched so stampArray preserves its
// stamp (no re-stamp / re-sync).
export function reconcileDeletions(next, previous, onDelete = softDelete) {
  if (!Array.isArray(next) || !Array.isArray(previous) || previous.length === 0) return next;

  const prevById = new Map();
  const nextIds = new Set();
  for (const rec of previous) {
    if (rec && rec.id != null) prevById.set(String(rec.id), rec);
  }
  for (const rec of next) {
    if (rec && rec.id != null) nextIds.add(String(rec.id));
  }

  // Keep incoming records, EXCEPT never let a stale client resurrect one that
  // was already tombstoned server-side. Without this, a client still holding a
  // record deleted elsewhere re-sends it as live; it's "still present" so the
  // tombstone was skipped, and stampArray then re-stamped the live copy — the
  // deleted record reappeared on every device. Pin such records to the stored
  // tombstone instead.
  const out = next.map(rec => {
    if (!rec || rec.id == null) return rec;
    const prev = prevById.get(String(rec.id));
    return (prev && prev.deletedAt && !rec.deletedAt) ? prev : rec;
  });
  for (const rec of previous) {
    if (!rec || rec.id == null) continue;      // untracked id → can't detect deletion
    if (nextIds.has(String(rec.id))) continue; // still present → handled above
    out.push(rec.deletedAt ? rec : onDelete(rec));
  }
  return out;
}

/**
 * The delta counterpart of `reconcileDeletions` (#339).
 *
 * `reconcileDeletions` infers a deletion from ABSENCE, which is exactly what
 * stops the payload becoming partial: a POST carrying one changed job would read
 * as "delete the other 63". This takes the deletions EXPLICITLY instead, so
 * absence means nothing at all and every stored record the write does not
 * mention is carried forward untouched.
 *
 * `upsert` — records to add or replace. `deleteIds` — ids to tombstone, and
 * ONLY those. An id that is not stored is ignored rather than invented, and a
 * record that is both upserted and deleted in one write ends up deleted, because
 * the delete is the more specific statement.
 *
 * Keeps `reconcileDeletions`' anti-resurrection rule: a client still holding a
 * record that was tombstoned server-side cannot bring it back by upserting its
 * live copy. Stored order is preserved and genuinely new records are appended,
 * so the array does not reshuffle on every delta.
 *
 * Returns a NEW array; never mutates the inputs.
 */
export function applyExplicitWrite(upsert, deleteIds, previous, onDelete = softDelete) {
  const prev = Array.isArray(previous) ? previous : [];
  const ups = Array.isArray(upsert) ? upsert : [];
  const del = new Set();
  for (const id of Array.isArray(deleteIds) ? deleteIds : []) if (id != null) del.add(String(id));

  const upById = new Map();
  for (const rec of ups) if (rec && rec.id != null) upById.set(String(rec.id), rec);

  const out = [];
  const seen = new Set();
  for (const rec of prev) {
    if (!rec || rec.id == null) { out.push(rec); continue; }   // untracked — carried as-is
    const id = String(rec.id);
    seen.add(id);
    if (del.has(id)) { out.push(rec.deletedAt ? rec : onDelete(rec)); continue; }
    const inc = upById.get(id);
    if (!inc) { out.push(rec); continue; }                     // not mentioned — untouched
    out.push(rec.deletedAt && !inc.deletedAt ? rec : inc);     // no resurrection
  }
  for (const rec of ups) {
    if (!rec || rec.id == null) { out.push(rec); continue; }
    const id = String(rec.id);
    if (seen.has(id) || del.has(id)) continue;
    out.push(rec);
  }
  return out;
}

/**
 * Ids of records in `next` that are NEW or whose content changed vs `previous`
 * — exactly the ones stampArray gives a fresh lastModifiedAt. Used to tell
 * real-time subscribers WHICH records to refetch. Tombstoned records appear here
 * too (their deletedAt is a content change). Id-less records are skipped (no
 * stable id to reference). Order follows `next`.
 */
export function changedIds(next, previous) {
  if (!Array.isArray(next)) return [];
  const prevById = new Map();
  if (Array.isArray(previous)) {
    for (const rec of previous) if (rec && rec.id != null) prevById.set(String(rec.id), rec);
  }
  const ids = [];
  for (const rec of next) {
    if (!rec || rec.id == null) continue;
    const prev = prevById.get(String(rec.id));
    if (!prev || stableStringify(rec, COMPARE_OMIT) !== stableStringify(prev, COMPARE_OMIT)) {
      ids.push(String(rec.id));
    }
  }
  return ids;
}
