// ONE WALK THAT KNOWS A TOMBSTONE IS INHERITED (#356).
//
// A delete in TRAQS is a tombstone: `deletedAt` goes on the node that was
// deleted and its children are left exactly as they were. That is the right
// storage decision — it is what makes a delete undoable and what keeps a
// moveLog readable — but it means A CHILD CARRIES NO EVIDENCE OF ITS PARENT'S
// FATE. An op inside a deleted job keeps its dates, its team, its hpd and its
// unfinished status, and any traversal that checks only the node it is standing
// on reads it as live work.
//
// WHAT THAT COST, measured on Matrix before this existed: 49 of 114 jobs are
// deleted and hold 745 ops with no tombstone of their own — 565 dated and
// unfinished, 531 teamed, 258 ending today or later. The Stats page counted all
// of them. Its per-person operation count read 681 where the truth was 261,
// OVERSTATED BY 62%, and four people were shown work when they had none.
//
// WHY A SHARED FUNCTION RATHER THAN A FILTER AT THE CALL SITE. The filter is
// three lines and every one of them is easy to write correctly and easy to
// forget at the next call site; `occupyingUnits` in overlapRules.js has its own
// correct copy, written separately, and the two agreeing is luck rather than
// construction. A named walk is greppable, and a call site that uses it cannot
// drift to checking one level.
//
// NOT APPLIED TO occupyingUnits, deliberately: it also decides what "takes
// part" means for the overlap rule, so routing it through here would entangle
// two rules that only happen to share a traversal.

/** Every op in the tree with no `deletedAt` on it, its panel, or its job. */
export function liveOpsOf(tasks) {
  const out = [];
  for (const job of tasks || []) {
    if (!job || job.deletedAt) continue;
    for (const panel of job.subs || []) {
      if (!panel || panel.deletedAt) continue;
      for (const op of panel.subs || []) {
        if (!op || op.deletedAt) continue;
        out.push(op);
      }
    }
  }
  return out;
}

/** The same walk, keeping each op's ancestors — for callers that need the job. */
export function liveOpsWithParents(tasks) {
  const out = [];
  for (const job of tasks || []) {
    if (!job || job.deletedAt) continue;
    for (const panel of job.subs || []) {
      if (!panel || panel.deletedAt) continue;
      for (const op of panel.subs || []) {
        if (!op || op.deletedAt) continue;
        out.push({ op, panel, job });
      }
    }
  }
  return out;
}
