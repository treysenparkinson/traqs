// Classifies what a tasks.json write actually CHANGED, so the server can demand
// the matching permission instead of accepting any member's array wholesale.
//
// tasks.js takes a whole-array replace: the client POSTs the entire job tree, so
// "did this caller create a job or just drag a bar?" is only answerable by
// diffing the incoming array against the stored one. That is what this does.
//
// Sibling of task-events.js, not a reuse of it: that module flattens to
// notification units (who to tell about what), which is a different output shape
// than "which permission does this edit require".
//
// ── Worker carve-outs ───────────────────────────────────────────────────────
// Three fields are written by NON-admins in the normal course of work, and
// gating them behind editJobs would break the floor:
//   finishRequests — a worker asking for their work to be marked done
//                    (AppState.swift requestJobCompletion/requestTaskCompletion)
//   signOffs       — sign-off steps, held by anyone with canSignOff/isEngineer
//   engineering    — designed / verified / sent to Perforex ticks
// They are classified separately and checked against approve/engineer rights.
//
// A fourth, apprLog, is the append-only approval trail the Jobs grid's Activity
// cell reads. It is a SIDE EFFECT of one of the actions above, never a user edit:
// signing an engineering step writes engineering AND apprLog in the same POST. If
// apprLog fell through to the generic branch it would add editJobs and 403 every
// approver who does not also edit jobs — the exact breakage this block exists to
// prevent. So it marks the write as changed and demands nothing on its own; the
// field that actually moved carries the permission, and the authoritative approval
// state stays in signOffs / engineering / apprChain rather than in the log.

const SCHEDULE_FIELDS = new Set(["start", "end", "startHour", "endHour", "hpd"]);
const TEAM_FIELD = "team";
const APPROVAL_FIELD = "signOffs";
const ENGINEERING_FIELD = "engineering";
const REQUEST_FIELD = "finishRequests";
const LOG_FIELD = "apprLog";

// Server-owned bookkeeping. The server stamps these itself, so a client echoing
// a stale or fresh value must not read as an edit.
const IGNORED_FIELDS = new Set(["lastModifiedAt", "updatedAt", "createdAt", "subs"]);

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Team is a set, not a list: reordering the same people is not a reassignment.
const teamEq = (a, b) => {
  const norm = t => (Array.isArray(t) ? t.map(String).sort() : []);
  return eq(norm(a), norm(b));
};

/** Flatten the job tree to id -> node, tagging each node's level. */
function indexNodes(jobs) {
  const map = new Map();
  for (const job of jobs || []) {
    if (!job || job.id == null) continue;
    map.set(String(job.id), { node: job, level: "job" });
    for (const panel of job.subs || []) {
      if (!panel || panel.id == null) continue;
      map.set(String(panel.id), { node: panel, level: "panel" });
      for (const op of panel.subs || []) {
        if (!op || op.id == null) continue;
        map.set(String(op.id), { node: op, level: "op" });
      }
    }
  }
  return map;
}

/**
 * @returns {{ perms: Set<string>, needsApprove: boolean, needsEngineer: boolean, changed: boolean }}
 *   perms         — permission keys this write requires (editJobs/moveJobs/reassign)
 *   needsApprove  — touched signOffs
 *   needsEngineer — touched engineering
 *   changed       — false when the arrays are equivalent, so the constant
 *                   autosave of an unchanged tree is never rejected
 */
export function classifyTaskChanges(nextTasks, prevTasks) {
  const perms = new Set();
  let needsApprove = false;
  let needsEngineer = false;
  let changed = false;

  const next = indexNodes(nextTasks);
  const prev = indexNodes(prevTasks);

  // Added, or resurrected from a tombstone.
  for (const [id, { node }] of next) {
    const before = prev.get(id);
    if (!before) {
      changed = true;
      // A node arriving already tombstoned is bookkeeping, not a creation.
      if (!node.deletedAt) perms.add("editJobs");
      continue;
    }
    const a = before.node, b = node;

    // Soft delete / undelete.
    if (!eq(a.deletedAt ?? null, b.deletedAt ?? null)) { changed = true; perms.add("editJobs"); }

    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (IGNORED_FIELDS.has(key) || key === "deletedAt") continue;

      if (key === TEAM_FIELD) {
        if (!teamEq(a[key], b[key])) { changed = true; perms.add("reassign"); }
        continue;
      }
      if (key === APPROVAL_FIELD) {
        if (!eq(a[key], b[key])) { changed = true; needsApprove = true; }
        continue;
      }
      if (key === ENGINEERING_FIELD) {
        if (!eq(a[key], b[key])) { changed = true; needsEngineer = true; }
        continue;
      }
      if (key === LOG_FIELD) {
        // Bookkeeping only — see the apprLog note at the top of this file.
        if (!eq(a[key], b[key])) changed = true;
        continue;
      }
      if (key === REQUEST_FIELD) {
        // Any member may raise a completion request; resolving one is an
        // approval, which the approve check below covers via signOffs or the
        // admin-only approve endpoints.
        if (!eq(a[key], b[key])) changed = true;
        continue;
      }
      if (!eq(a[key], b[key])) {
        changed = true;
        perms.add(SCHEDULE_FIELDS.has(key) ? "moveJobs" : "editJobs");
      }
    }
  }

  // Hard-removed from the array entirely.
  for (const [id, { node }] of prev) {
    if (!next.has(id) && !node.deletedAt) { changed = true; perms.add("editJobs"); }
  }

  return { perms, needsApprove, needsEngineer, changed };
}
