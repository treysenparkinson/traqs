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
    return { ...rec, lastModifiedAt: stamp };
  });
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
export function reconcileDeletions(next, previous) {
  if (!Array.isArray(next) || !Array.isArray(previous) || previous.length === 0) return next;

  const nextIds = new Set();
  for (const rec of next) {
    if (rec && rec.id != null) nextIds.add(String(rec.id));
  }

  const out = next.slice();
  for (const rec of previous) {
    if (!rec || rec.id == null) continue;      // untracked id → can't detect deletion
    if (nextIds.has(String(rec.id))) continue; // still present → not a deletion
    out.push(rec.deletedAt ? rec : softDelete(rec));
  }
  return out;
}
