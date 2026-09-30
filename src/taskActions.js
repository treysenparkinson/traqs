// Which permission a tasks.json write needs, decided by what the write DOES.
//
// Shared by the server (netlify/functions/tasks.js) and, for its field lists, the
// web. Pure: no imports, no browser globals — the server imports it across the
// src/ boundary, as it does scheduleRules.js.
//
// SCHEDULE_MAP root cause 4. The first classifier (_utils/task-perms.js) asked
// only "which fields changed?" and sent every field without a carve-out to
// editJobs. But actions write side effects: a move appends to moveLog; approving
// a finish writes status, pendingFinish, pendingSession, finishedAt, the placement
// and moveLog; signing a chain step rewrites apprChain. So the permission for the
// action was never enough — a moveJobs-only admin was refused every resize, and an
// approver without editJobs could approve nothing. Here the side effect is
// classified by the action it belongs to:
//
//   logs            moveLog / apprLog are append-only (rewriting or dropping an
//                   entry → editJobs). An append rides on the node's other change;
//                   a moveLog append on a node where nothing else changed is a
//                   forged entry → editJobs. apprLog on its own needs nothing, as
//                   before (it is written beside the sign-off that carries the
//                   permission).
//   finish          resolving a finish request — an existing request resolved, or
//                   pendingFinish true→false, or pendingSession cleared — makes the
//                   node, its descendants, and its ancestors' start/end bounds one
//                   approval: every FINISH_RESOLUTION_FIELDS change there →
//                   approveCompletions.
//   Finished        any other status → "Finished" is an approval too (Complete Now,
//                   the status popover) → approveCompletions, not editJobs.
//   raise           a new pending request by the caller, with its finishRequest
//                   pointer and pendingFinish true → nothing.
//   chain steps     changing only a step's done/by/byName/at → a sign (checked
//                   against canApprove or that step's assignee) or a revert
//                   (canApprove). Adding, removing or relabelling steps → editJobs.
//   attachments     append-only for anyone — a worker documenting their own work;
//                   removing or replacing one → editJobs.
//   empty           an absent key equals [], "" or {}: clients that always write the
//                   empty value are not editing anything.

export const SCHEDULE_FIELDS = ["start", "end", "startHour", "endHour", "hpd"];
export const LOG_FIELDS = ["moveLog", "apprLog"];
/** Every field approving or declining a finish may write — the web's
 *  finishedOpFields and revertSession, and the request bookkeeping. */
export const FINISH_RESOLUTION_FIELDS = [
  "status", "pendingFinish", "pendingSession", "finishedAt",
  "actualHours", "actualStart", "actualEnd",
  "plannedStart", "plannedEnd", "plannedStartHour", "plannedEndHour",
  ...SCHEDULE_FIELDS,
  "finishRequest", "finishRequests", "moveLog",
];
/** The fields of an approval-chain step that signing or reverting it changes. */
export const CHAIN_SIGN_FIELDS = ["done", "by", "byName", "at"];
export const APPEND_ONLY_FIELDS = ["attachments"];

const IGNORED_FIELDS = new Set(["lastModifiedAt", "updatedAt", "createdAt", "subs"]);
const BOUNDS_FIELDS = new Set(["start", "end", "startHour", "endHour"]);
const RESOLUTION = new Set(FINISH_RESOLUTION_FIELDS);
const SCHEDULE = new Set(SCHEDULE_FIELDS);

const isEmpty = (v) => v == null || v === ""
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const eq = (a, b) => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const teamEq = (a, b) => {
  const norm = t => (Array.isArray(t) ? t.map(String).sort() : []);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};
// b keeps every entry of a, unchanged and in order, and adds at least one.
const isAppend = (a, b) => {
  const before = Array.isArray(a) ? a : [];
  if (!Array.isArray(b) || b.length <= before.length) return false;
  return before.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
};

function newlyRaised(prevList, nextList) {
  const before = new Set((Array.isArray(prevList) ? prevList : []).filter(r => r && r.id != null).map(r => String(r.id)));
  return (Array.isArray(nextList) ? nextList : []).filter(r => r && r.id != null && !before.has(String(r.id)));
}
function resolvesExistingRequest(prevList, nextList) {
  const before = new Map((Array.isArray(prevList) ? prevList : []).filter(r => r && r.id != null).map(r => [String(r.id), r]));
  if (before.size === 0) return false;
  const after = Array.isArray(nextList) ? nextList : [];
  const seen = new Set();
  for (const r of after) {
    if (!r || r.id == null) continue;
    const id = String(r.id);
    seen.add(id);
    const was = before.get(id);
    if (was && JSON.stringify(was) !== JSON.stringify(r)) return true;
  }
  for (const id of before.keys()) if (!seen.has(id)) return true;
  return false;
}

function index(jobs) {
  const map = new Map();
  for (const job of jobs || []) {
    if (!job || job.id == null) continue;
    map.set(String(job.id), { node: job, parent: null });
    for (const panel of job.subs || []) {
      if (!panel || panel.id == null) continue;
      map.set(String(panel.id), { node: panel, parent: String(job.id) });
      for (const op of panel.subs || []) {
        if (!op || op.id == null) continue;
        map.set(String(op.id), { node: op, parent: String(panel.id) });
      }
    }
  }
  return map;
}

// Is this node resolving a finish request in this write?
const resolves = (a, b) =>
  resolvesExistingRequest(a.finishRequests, b.finishRequests)
  || (a.pendingFinish === true && b.pendingFinish !== true)
  || (!isEmpty(a.pendingSession) && isEmpty(b.pendingSession));

// Chain steps: same steps, only sign fields changed → the list of signs/reverts;
// anything structural → null.
function chainChange(a, b) {
  const x = Array.isArray(a) ? a : [], y = Array.isArray(b) ? b : [];
  if (x.length !== y.length) return null;
  const out = [];
  for (let i = 0; i < x.length; i++) {
    const s = x[i] || {}, t = y[i] || {};
    const keys = new Set([...Object.keys(s), ...Object.keys(t)]);
    let signChanged = false;
    for (const k of keys) {
      if (CHAIN_SIGN_FIELDS.includes(k)) { if (!eq(s[k], t[k])) signChanged = true; }
      else if (!eq(s[k], t[k])) return null;
    }
    if (signChanged) out.push({ index: i, signing: !!t.done, assigneeId: s.assigneeId ?? null });
  }
  return out;
}

/**
 * @returns {{ perms: Set<string>, needsApprove: boolean, needsEngineer: boolean,
 *             changed: boolean, raisedBy: Set<string>, chainSigns: {index, assigneeId}[] }}
 *   perms       — permission keys the write needs (editJobs/moveJobs/reassign/approveCompletions)
 *   needsApprove / needsEngineer — signOffs / engineering touched, or a chain step reverted
 *   raisedBy    — the `by` of every finish request raised; the caller checks they are the caller
 *   chainSigns  — each chain step signed; allowed for canApprove or that step's assignee
 */
export function classifyTaskActions(nextTasks, prevTasks) {
  const perms = new Set();
  let needsApprove = false, needsEngineer = false, changed = false;
  const raisedBy = new Set();
  const chainSigns = [];

  const next = index(nextTasks), prev = index(prevTasks);

  // Pass 1: which nodes are resolving a finish request; the scope is them and
  // every descendant, and the ancestors whose bounds follow them.
  const scope = new Set(), boundsOf = new Set();
  for (const [id, { node: b }] of next) {
    const before = prev.get(id);
    if (before && resolves(before.node, b)) scope.add(id);
  }
  for (const [id, { parent }] of next) {
    for (let p = parent; p != null; p = next.get(p)?.parent) if (scope.has(p)) { scope.add(id); break; }
  }
  for (const id of scope) for (let p = next.get(id)?.parent; p != null; p = next.get(p)?.parent) if (!scope.has(p)) boundsOf.add(p);

  for (const [id, { node: b }] of next) {
    const before = prev.get(id);
    if (!before) {
      changed = true;
      if (!b.deletedAt) perms.add("editJobs");
      continue;
    }
    const a = before.node;
    if (!eq(a.deletedAt, b.deletedAt)) { changed = true; perms.add("editJobs"); }

    const inScope = scope.has(id);
    const raises = newlyRaised(a.finishRequests, b.finishRequests);
    const raisesPending = raises.some(r => r.status === "pending");
    let otherChange = false, moveLogAppend = false;

    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (IGNORED_FIELDS.has(key) || key === "deletedAt") continue;
      if (key === "team") {
        if (!teamEq(a.team, b.team)) { changed = true; otherChange = true; perms.add("reassign"); }
        continue;
      }
      if (eq(a[key], b[key])) continue;
      changed = true;

      if (key === "moveLog") {
        if (!isAppend(a.moveLog, b.moveLog)) perms.add("editJobs");
        else if (!inScope) moveLogAppend = true;
        continue;
      }
      if (key === "apprLog") {
        if (!isAppend(a.apprLog, b.apprLog)) perms.add("editJobs");
        continue;
      }
      otherChange = true;
      if (key === "signOffs") { needsApprove = true; continue; }
      if (key === "engineering") { needsEngineer = true; continue; }
      if (key === "apprChain") {
        const steps = chainChange(a.apprChain, b.apprChain);
        if (!steps) { perms.add("editJobs"); continue; }
        for (const s of steps) {
          if (s.signing) chainSigns.push({ index: s.index, assigneeId: s.assigneeId, nodeId: id });
          else needsApprove = true;
        }
        continue;
      }
      if (APPEND_ONLY_FIELDS.includes(key)) {
        if (!isAppend(a[key], b[key])) perms.add("editJobs");
        continue;
      }
      if (key === "finishRequests") {
        if (resolvesExistingRequest(a.finishRequests, b.finishRequests)) perms.add("approveCompletions");
        for (const r of raises) {
          if (r.status !== "pending") perms.add("approveCompletions");
          raisedBy.add(String(r.by));
        }
        continue;
      }
      if (key === "finishRequest") {
        const ptr = b.finishRequest;
        const raised = ptr && ptr.requestId != null
          ? raises.find(r => String(r.id) === String(ptr.requestId) && r.status === "pending")
          : null;
        if (raised && String(ptr.by) === String(raised.by)) raisedBy.add(String(ptr.by));
        else perms.add("approveCompletions");
        continue;
      }
      if (inScope && RESOLUTION.has(key)) { perms.add("approveCompletions"); continue; }
      if (boundsOf.has(id) && BOUNDS_FIELDS.has(key)) { perms.add("approveCompletions"); continue; }
      if (key === "status") {
        perms.add(b.status === "Finished" && a.status !== "Finished" ? "approveCompletions" : "editJobs");
        continue;
      }
      if (key === "pendingFinish" && b.pendingFinish === true && raisesPending) continue;   // raising
      perms.add(SCHEDULE.has(key) ? "moveJobs" : "editJobs");
    }
    // A moveLog entry with no change beside it records nothing that happened.
    if (moveLogAppend && !otherChange) perms.add("editJobs");
  }

  for (const [id, { node }] of prev) {
    if (!next.has(id) && !node.deletedAt) { changed = true; perms.add("editJobs"); }
  }
  return { perms, needsApprove, needsEngineer, changed, raisedBy, chainSigns };
}
