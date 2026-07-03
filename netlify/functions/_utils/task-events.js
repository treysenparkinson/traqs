// Server-side event detection for tasks.js — diffs the incoming tasks array
// against the existing one (same "diff before write" pattern as the tombstone
// reconciliation in timestamps.js) to figure out which USER-VISIBLE events a
// write represents, so we can fire the right push notifications regardless of
// which client made the change (desktop, iOS, or a future one).
//
// Assignment lives at the OPERATION level, or — for a panel with no ops of its
// own — the panel level (a "direct-to-panel" assignment). So the diff treats
// each op, and each op-less panel, as one "unit". This mirrors the Jobs-page
// assignment rule (team on an op, or on an op-less panel).
//
// Data shapes it reads:
//   job:   { id, title, jobNumber, subs: [panel], deletedAt? }
//   panel: { id, title, status, team[], subs: [op], finishRequests[], deletedAt? }
//   op:    { id, title, status, team[], finishRequests[] }
//   finishRequests[] entry: { id, by, status: "pending"|"approved"|"declined", ... }
//     (`by` is the requester's personId; status flips pending → approved/declined
//      on admin approve/decline — see adminApproveJobFinish/adminDeclineJobFinish.)

const asStrArr = (a) => (Array.isArray(a) ? a.map(String) : []);

// id -> { unit, title, jobId, jobTitle, jobNumber, deleted }
function indexUnits(jobs) {
  const map = new Map();
  for (const job of jobs || []) {
    if (!job || job.id == null) continue;
    const jobTitle = job.title || (job.jobNumber != null ? `Job #${job.jobNumber}` : `Job ${job.id}`);
    const jobNumber = job.jobNumber != null ? String(job.jobNumber) : null;
    const jobDeleted = !!job.deletedAt;
    for (const panel of job.subs || []) {
      if (!panel || panel.id == null) continue;
      const ops = panel.subs || [];
      if (ops.length === 0) {
        map.set(String(panel.id), {
          unit: panel, title: panel.title || jobTitle,
          jobId: String(job.id), jobTitle, jobNumber,
          deleted: jobDeleted || !!panel.deletedAt,
        });
      } else {
        for (const op of ops) {
          if (!op || op.id == null) continue;
          map.set(String(op.id), {
            unit: op, title: op.title || panel.title || jobTitle,
            jobId: String(job.id), jobTitle, jobNumber,
            deleted: jobDeleted || !!panel.deletedAt || !!op.deletedAt,
          });
        }
      }
    }
  }
  return map;
}

/**
 * Returns the visible events represented by writing `nextTasks` over `prevTasks`:
 *   teamAdded:      Map<personId, Map<jobId, {title, jobNumber}>>
 *   teamRemoved:    Map<personId, Map<jobId, {title, jobNumber}>>
 *   finishResolved: [{ unitTitle, authorId, resolution: "approved"|"rejected", jobNumber }]
 *   statusChanges:  [{ unitId, unitTitle, newStatus, jobNumber, teamIds:[], excludeIds:[] }]
 *
 * teamAdded/teamRemoved are keyed by person so a person on several ops in one
 * write is counted ONCE (dedupe by jobId happens via the inner Map). A brand-new
 * unit (no prior) reports its whole team as "added" — that's the assignment that
 * happens when a job is created with a team. Status changes are reported only
 * when a prior version existed (so creating a job doesn't spam "now Not Started").
 * `excludeIds` on a status change lists that unit's finish-request author(s) this
 * write, so the caller can skip re-notifying someone who already got the more
 * specific "finish approved/rejected" push.
 */
export function diffTaskEvents(nextTasks, prevTasks) {
  const prevUnits = indexUnits(prevTasks);
  const nextUnits = indexUnits(nextTasks);

  const teamAdded = new Map();
  const teamRemoved = new Map();
  const finishResolved = [];
  const statusChanges = [];

  const addJob = (map, personId, ctx) => {
    const key = String(personId);
    if (!map.has(key)) map.set(key, new Map());
    map.get(key).set(ctx.jobId, { title: ctx.jobTitle, jobNumber: ctx.jobNumber });
  };

  for (const [id, cur] of nextUnits) {
    if (cur.deleted) continue; // don't notify about tombstoned work
    const prev = prevUnits.get(id);
    const curTeam = asStrArr(cur.unit.team);
    const prevTeam = prev ? asStrArr(prev.unit.team) : [];

    for (const pid of curTeam) if (!prevTeam.includes(pid)) addJob(teamAdded, pid, cur);
    if (prev && !prev.deleted) {
      for (const pid of prevTeam) if (!curTeam.includes(pid)) addJob(teamRemoved, pid, cur);
    }

    // Finish request resolved: a request that was "pending" before is now
    // "approved"/"declined". `by` is the author to notify.
    const prevReqs = new Map((prev?.unit?.finishRequests || []).map((r) => [String(r.id), r]));
    const finishAuthors = [];
    for (const r of cur.unit.finishRequests || []) {
      const before = prevReqs.get(String(r.id));
      if (before && before.status === "pending" && (r.status === "approved" || r.status === "declined")) {
        finishResolved.push({
          unitTitle: cur.title,
          authorId: r.by != null ? String(r.by) : null,
          resolution: r.status === "approved" ? "approved" : "rejected",
          jobNumber: cur.jobNumber,
        });
        if (r.by != null) finishAuthors.push(String(r.by));
      }
    }

    // Status change — only when a prior version existed. The unit's finish
    // author(s) are excluded downstream so an approval doesn't double-notify
    // them (finish push + status push).
    if (prev && cur.unit.status !== prev.unit.status) {
      statusChanges.push({
        unitId: id,
        unitTitle: cur.title,
        newStatus: cur.unit.status,
        jobNumber: cur.jobNumber,
        teamIds: curTeam,
        excludeIds: finishAuthors,
      });
    }
  }

  return { teamAdded, teamRemoved, finishResolved, statusChanges };
}
