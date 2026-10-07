// The guard that stands between this product and another empty-tasks incident.
//
// On 2026-06-03 a client bug (failed initial fetch -> React resets state ->
// autosave fires) POSTed `[]` and wiped MTX2026TRAQS/tasks.json. The guard added
// afterwards asked ONE question:
//
//     if (tasks.length === 0 && !force) ... refuse
//
// That is a question about the request's SHAPE, which happened to correlate with
// the question anyone actually cares about: is this write about to destroy
// everything? Under the delta envelope (#339) the correlation breaks in BOTH
// directions at once:
//
//     { upsert: [], delete: [] }          an empty-LOOKING body that is a
//                                         legitimate no-op, which the shape
//                                         guard would refuse
//     { upsert: [], delete: [...all] }    a NON-empty body that is the
//                                         2026-06-03 incident exactly, which the
//                                         shape guard would wave through
//
// So the guard asks about INTENT instead, and the question is one sentence:
//
//     REFUSE A WRITE THAT WOULD LEAVE NO LIVE JOB, WHEN THERE WAS ONE BEFORE.
//
// THREE PROPERTIES, each asserted in `delta-write-test.mjs` rather than claimed:
//
//   1. IT DOES NOT DEPEND ON THE REQUEST'S SHAPE. A bare array that omits
//      everything and an envelope that deletes everything reach the same branch
//      by the same arithmetic. The old guard only caught the first.
//
//   2. IT IS STRICTLY STRONGER THAN THE OLD ONE. Every request the shape guard
//      refused, this one refuses too — including the 2026-06-03 request, which
//      is the suite's red proof and not a paraphrase of it.
//
//   3. A PARTIAL WRITE CANNOT REACH IT. With `{ upsert: [one job] }` and no
//      deletes, every stored record is carried forward, so `after === before`
//      and the comparison cannot fire. **Structurally incapable, not exempted** —
//      there is no flag saying "skip this for deltas", because a flag is
//      something a future caller can set wrongly.
//
// Counts only NON-tombstoned records, so an org whose jobs have all legitimately
// been deleted is not locked out of writing by its own leftover tombstones.

/** Live (non-tombstoned) records in a stored or reconciled array. */
export function liveCount(list) {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const r of list) if (r && !r.deletedAt) n++;
  return n;
}

/**
 * Whether this write would empty the org, and so must be refused.
 *
 * `reconciled` is the array the write WOULD store — already past deletion
 * reconciliation, so it is the intent rather than the request body. Evaluating
 * it after reconciliation is safe because the caller aborts by returning
 * `{ abort }` from the updater, which writes nothing (update-json.js).
 */
export function wouldEmptyOrg(reconciled, existing) {
  const before = liveCount(existing);
  if (before === 0) return false;        // already empty — nothing to protect
  return liveCount(reconciled) === 0;
}
