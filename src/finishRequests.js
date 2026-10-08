// ONE representation of "somebody has asked for this op to be marked complete".
//
// There were three, and they were wrong about each other 10 times out of 11. Sampling the
// history of Matrix's tasks.json at every moment a request was open on ANY of them:
//
//   9   finishRequest + a pending list entry, no pendingFinish, op still open
//       → #173. Raised from the web, which never set the flag. The freeze effect and the
//         Requests tab both key on that flag, so the session never froze and no admin ever
//         saw the request.
//   1   the same three flags, but the op was Finished
//       → #175. Approved from the schedule, which cleared the flag and left the list open.
//   1   all three set
//       → the server path, which is the only one that ever wrote all of them.
//
// WHAT IS AUTHORITATIVE: `finishRequests[]`. It is the only form that holds history (40
// resolved entries on Matrix), the only one that can express more than one request over an
// op's life, and the only one that records who asked and when. The other two are derived.
//
// `pendingFinish` is kept as a MIRROR, written by openRequest/resolveRequest and by nothing
// else. iOS reads it and iOS cannot be changed here, so it has to keep working — but no web
// code may treat it as the truth. `finishRequest` (singular) is written no more; it is still
// READ, because records carrying it exist and will for as long as they are not touched.
import { isClosedStatus } from "./statusText.js";

/** A pending entry is what makes a request open. Newest first, because the UI wants one. */
export function pendingEntriesOf(op) {
  return (op?.finishRequests || [])
    .filter((r) => r && r.status === "pending")
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

export function pendingEntryOf(op) {
  return pendingEntriesOf(op)[0] || null;
}

/**
 * Is a finish request open on this op?
 *
 * The reconciliation rule, in one place, used by every reader AND by the normaliser so a
 * read and a migration cannot disagree:
 *
 *   1. A pending entry exists                    → OPEN.
 *      Absence of the mirror is not evidence of resolution; two code paths fail to set it.
 *   2. pendingFinish true and the list is EMPTY  → OPEN.
 *      An old iOS build raised a request by writing only the flag. The bit is the only
 *      witness to it, and discarding it loses a real request in silence.
 *   3. pendingFinish true and every entry resolved → CLOSED.
 *      Here the list can prove its claim — it names who resolved it and when — and a bit
 *      with no record behind it does not outvote a record that has one.
 *
 * The asymmetry that settles the ties: a false OPEN costs one duplicated decision, which is
 * visible, recoverable, and itself recorded. A false CLOSED silently destroys a worker's
 * request and leaves their session held. Where the evidence runs out, be wrong in the
 * direction a human can see.
 */
export function pendingFinishOf(op) {
  if (!op) return false;
  if (pendingEntriesOf(op).length > 0) return true;                  // 1
  if (op.pendingFinish !== true) return false;
  if ((op.finishRequests || []).length === 0) return true;           // 2
  return false;                                                      // 3
}

/** Fields to SPREAD onto an op to open a request. The only writer of the mirror. */
export function openRequest(op, { requestId, by, byName, at }) {
  const entry = { id: requestId, by: by ?? null, byName: byName || "Field", at, status: "pending" };
  return {
    finishRequests: [...(op?.finishRequests || []), entry],
    pendingFinish: true,
    // The singular pointer is no longer written. Clearing it here rather than leaving it is
    // deliberate: a stale pointer at an older request is how #175's residue outlived the
    // thing it pointed at.
    finishRequest: undefined,
  };
}

/**
 * Fields to SPREAD onto an op to close a request.
 *
 * Closes the named entry, or every pending one when no id is given — which is what an
 * approve from a surface that never knew the request id has to do, and what stops a second
 * pending entry outliving the decision that was supposed to end it.
 */
export function resolveRequest(op, { requestId = null, status, by = null, byName = null, at, reason = null }) {
  const stamp = (r) => ({
    ...r, status, resolvedBy: by, resolvedByName: byName, resolvedAt: at,
    // Absent rather than empty when no reason was given, so a card can test the
    // key instead of distinguishing "" from "no reason".
    ...(reason ? { declineReason: reason } : {}),
  });
  let hit = false;
  const reqs = (op?.finishRequests || []).map((r) => {
    if (!r || r.status !== "pending") return r;
    if (requestId != null && String(r.id) !== String(requestId)) return r;
    hit = true;
    return stamp(r);
  });

  // UPSERT, NOT MAP. A request whose only trace is the mirror — an old iOS build
  // wrote `pendingFinish` and no row — matched nothing above, so closing it
  // recorded the approval NOWHERE: the list stayed empty, the flag went false,
  // and who decided it was lost. Appending the resolved row means the decider is
  // always stored. `by`/`byName` come off the deprecated singular stamp, which is
  // the only place a mirror-only request says who asked.
  //
  // SUSPECTED DEAD, AND PORTED ANYWAY — the evidence is in #476 rather than a
  // guess. On Matrix: 0 nodes carry `pendingFinish === true`, 0 carry the
  // singular pointer, and all 22 resolved entries have a row. Current iOS writes
  // the row when it raises (`CompletionRequestRules.addPendingRequest` sets the
  // stamp, the mirror AND the list). So nothing here can fire at Matrix. The
  // judgement is about the orgs that are not Matrix: this is a multi-tenant
  // product with one customer, and a branch that costs nothing and stands behind
  // a legacy record is cheaper than discovering it was needed.
  if (!hit && pendingFinishOf(op)) {
    const prior = op?.finishRequest;
    reqs.push(stamp({
      id: requestId ?? prior?.requestId ?? prior?.id ?? null,
      by: prior?.by ?? null,
      byName: prior?.byName ?? null,
      at: prior?.at || at,
    }));
  }

  return {
    finishRequests: reqs,
    pendingFinish: reqs.some((r) => r && r.status === "pending"),
    finishRequest: undefined,
  };
}

/**
 * THE STATUS OF ONE NAMED REQUEST, as the finish-request card reads it.
 *
 * Different question from `pendingFinishOf`, which asks whether ANY request is
 * open on an item. This asks what became of a PARTICULAR one, because a chat
 * bubble names the request it was raised for and has to say what happened to
 * that one even after later requests came and went.
 *
 * Extracted from the card at TRAQS.jsx so `fixtures/finish-parity.json` can be
 * computed from the REAL implementation rather than a restatement of it, and so
 * iOS's `CompletionRequestRules.status` has something to be held against (#477).
 * Behaviour is unchanged from the inline version.
 *
 * Returns "pending" | "approved" | "declined" | whatever a stored row says.
 */
export function requestStatusOf(target, requestId) {
  const row = (target?.finishRequests || []).find((r) => same(r?.id, requestId));
  if (row?.status) return row.status;
  // No row to read. Every resolution path clears `finishRequest` and
  // `pendingFinish`, so either one still being set means pending. Falling back to
  // pending when nothing resolves matches the time-off bubble and errs toward
  // leaving the admin able to act rather than stranding a request.
  if (!target) return "pending";
  if (same(target.finishRequest?.requestId, requestId) || target.pendingFinish) return "pending";
  // `isClosedStatus`, not `=== "Finished"`. The inline version this was extracted
  // from compared the literal; the ratchet exists to stop that spreading, and the
  // normalised comparison is the same answer on every live record (#446 left 0 of
  // 582 nodes outside the org's list) while also surviving a spelling drift.
  return isClosedStatus(target.status) ? "approved" : "pending";
}

/** Both sides null is NOT a match — see TRAQS.jsx's `sameId`, copied deliberately. */
function same(a, b) {
  return a != null && b != null && String(a) === String(b);
}

/**
 * Bring one op's three representations into agreement, by the rule above.
 *
 * Returns the fields to spread, or null when nothing needs changing — so a caller can skip
 * the write, and so running it twice is a no-op the second time.
 *
 * `now` and `teamLead` are only used for case 2, where an entry has to be invented because
 * the flag is the sole record of a request. Those entries are marked `synthesized` so they
 * are never mistaken for a first-hand record of who asked.
 */
export function normalizeFinishState(op, { now = new Date().toISOString(), idFor } = {}) {
  if (!op) return null;
  const list = op.finishRequests || [];
  const open = pendingFinishOf(op);
  const hasPending = pendingEntriesOf(op).length > 0;

  let next = null;

  // Case 2: the flag is the only witness. Materialise it so the list becomes the record.
  if (open && !hasPending && list.length === 0) {
    const entry = {
      id: (idFor && idFor(op)) || `fr_sync_${Math.random().toString(36).slice(2, 10)}`,
      by: (op.team || [])[0] ?? null,
      byName: null,
      at: op.lastModifiedAt || now,
      status: "pending",
      synthesized: true,
      synthesizedFrom: "pendingFinish",
    };
    next = { ...(next || {}), finishRequests: [...list, entry] };
  }

  // The mirror follows the rule, in both directions — but ABSENT already means "not
  // pending", so an op that has never had a request is not a disagreement. Comparing with
  // `!==` instead of truthiness wanted to stamp `pendingFinish: false` onto all 1,481 nodes
  // of Matrix's tree, which is a migration adding a key to every record to say nothing.
  if ((op.pendingFinish === true) !== open) next = { ...(next || {}), pendingFinish: open };

  // A singular pointer that is dangling or already resolved is residue. One that still
  // points at a live pending entry is left alone — old readers rely on it until they are
  // all moved over.
  if (op.finishRequest) {
    const target = list.find((r) => r && String(r.id) === String(op.finishRequest.requestId));
    if (!target || target.status !== "pending") next = { ...(next || {}), finishRequest: undefined };
  }

  return next;
}

/** Why an op was changed, for the normaliser's report. */
export function normalizeReason(op) {
  const list = op?.finishRequests || [];
  const open = pendingFinishOf(op);
  const hasPending = pendingEntriesOf(op).length > 0;
  const why = [];
  if (open && !hasPending && list.length === 0) why.push("flag with no list entry — entry synthesised");
  if ((op?.pendingFinish === true) !== open) why.push(`mirror ${op?.pendingFinish === true ? "true" : "false/absent"} → ${open}`);
  if (op?.finishRequest) {
    const t = list.find((r) => r && String(r.id) === String(op.finishRequest.requestId));
    if (!t) why.push("singular pointer dangling");
    else if (t.status !== "pending") why.push(`singular pointer at a ${t.status} entry`);
  }
  return why;
}
