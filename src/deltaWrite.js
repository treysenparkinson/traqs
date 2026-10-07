// Send the jobs that changed, not all of them (#339, #227 item 2).
//
// Measured over the 40 most recent writes: 508.3 KB POSTed per write against
// 17.3 KB actually different (3.4%), 112 jobs sent with a median of 1 changed.
//
// THE PAYLOAD IS AN ENVELOPE, `{ upsert, delete }`, because deletion used to be
// inferred from ABSENCE — `reconcileDeletions` tombstones every stored id the
// POST does not contain, so a partial array reads as a mass delete. Deletion has
// to become explicit before the payload can become partial.
//
// ─── THE INVARIANT, AND WHY IT IS A CHECK RATHER THAN A COMMENT ───
//
// The server cannot catch the dangerous bug here. If this builds a payload that
// omits a job which DID change, the save succeeds and the edit is silently gone:
// to the server, "job 7 was left out" and "job 7 did not change" are the same
// request. That is the shape of #379 and #380 — a write that reports success
// and loses something — and the only place it can be caught is before the POST.
//
// So `missingFromDelta` RECOMPUTES the dirty set from the keys and checks it
// against the body that is actually about to be sent. It deliberately does not
// trust `buildDelta`: if it read the same intermediate value, it would be a
// tautology and would pass however wrong the payload was. Given the final body,
// it fails when a later step drops something.
//
// IT RUNS IN PRODUCTION, and it is close to free. Computing per-job keys is not
// overhead added for the check — it is the MECHANISM, the only way to know which
// jobs are dirty — and it costs one stringify of the tree, which is what the old
// full POST was already doing on every save. The check itself is a Set lookup
// per job. A failure falls back to sending everything, so a bug here degrades to
// the old behaviour instead of losing data, and says so loudly.
//
// FALSE DIRTY IS SAFE, FALSE CLEAN IS NOT. `JSON.stringify` is key-order
// sensitive, and React rebuilds these objects by spreading, so a job can
// occasionally stringify differently without changing. That over-sends, which
// costs bytes. The reverse — treating a changed job as clean — loses an edit, so
// every judgement here is made in that direction.

/** A job's content as one comparable string. */
export function jobContentKey(job) {
  try { return JSON.stringify(job); } catch { return null; }
}

/** id -> content key, for every job carrying an id. */
export function jobKeys(jobs) {
  const out = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || job.id == null) continue;
    out.set(String(job.id), jobContentKey(job));
  }
  return out;
}

/**
 * Ids that must be in this write: new jobs, changed jobs, and anything whose key
 * could not be computed (unknown is treated as dirty — the safe direction).
 *
 * `ack` is the key map as of the last write the SERVER accepted. A null/empty
 * ack means nothing is known, so everything is dirty and the write is full.
 */
export function dirtyIds(keys, ack) {
  const out = new Set();
  if (!(ack instanceof Map) || ack.size === 0) {
    for (const id of keys.keys()) out.add(id);
    return out;
  }
  for (const [id, key] of keys) {
    const was = ack.get(id);
    if (was === undefined || key === null || was !== key) out.add(id);
  }
  return out;
}

/** Ids the server has that this client no longer does — the explicit deletes. */
export function deletedIds(keys, ack) {
  const out = [];
  if (!(ack instanceof Map)) return out;
  for (const id of ack.keys()) if (!keys.has(id)) out.push(id);
  return out;
}

/**
 * The envelope for this save, or null when everything is dirty and a full write
 * is simpler and safer (first save of a session, or an ack that was cleared).
 */
export function buildDelta(jobs, ack) {
  const list = Array.isArray(jobs) ? jobs : [];
  const keys = jobKeys(list);
  if (!(ack instanceof Map) || ack.size === 0) return null;
  const dirty = dirtyIds(keys, ack);
  const del = deletedIds(keys, ack);
  // A job with no id cannot be tracked across writes, so it rides in every
  // upsert rather than being silently dropped from a partial one.
  const upsert = list.filter(j => !j || j.id == null || dirty.has(String(j.id)));
  return { upsert, delete: del };
}

/**
 * Ids that SHOULD be in `body.upsert` and are not — recomputed from the keys
 * rather than from whatever produced the body.
 *
 * Empty is the only acceptable answer. Anything else means the payload would
 * lose an edit, and the caller must send everything instead.
 */
export function missingFromDelta(body, keys, ack) {
  if (!body || Array.isArray(body)) return [];        // a full write cannot omit anything
  const sent = new Set();
  for (const job of Array.isArray(body.upsert) ? body.upsert : []) {
    if (job && job.id != null) sent.add(String(job.id));
  }
  const out = [];
  for (const id of dirtyIds(keys, ack)) if (!sent.has(id)) out.push(id);
  return out;
}
