// Did this edit actually move anything? (#404)
//
// `updTask` decided whether to settle the board with a KEY-PRESENCE test:
//
//     const datesMoved = hasOwnProperty(upd, "start") || hasOwnProperty(upd, "end")
//                     || hasOwnProperty(upd, "team");
//
// Both surviving callers send those keys unconditionally — `saveEditJob` passes a
// WHOLE NODE (`updTask(withIds.id, withIds, parentId)`), and the Edit Job modal
// passes a literal with `start: computedStart, end: computedEnd`. So renaming a job
// settled the board, and on Matrix that walked nine ops five days with no moveLog
// and no toast. Nobody would connect a renamed job to nine ops moving — which is
// exactly why it went unseen.
//
// A key being present is not a move. This compares the VALUES, across the whole
// patched subtree, because the Edit Job modal's edits arrive inside `subs` while
// the node's own `start`/`end` stay put: a child date change has to count, or
// fixing the trigger would stop the parents rolling up.
//
// Scoping the settle to the touched node would NOT have fixed this. A title-only
// save through the Edit Job modal touches the whole job either way — the patch
// carries `start`, `end` AND `subs`. See #415 for the scoping question, which is a
// separate and harder one, because the queue rule is relative to siblings.

/** Every id's placement in a subtree, flattened to a string. Order is structural, so two
 *  trees with the same shape and the same dates produce the same signature. */
export function scheduleSignature(node) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    // `team` is here because reassigning is a schedule change: it decides whose row
    // the work sits on, and the queue rule treats assigned and unassigned differently.
    //
    // Sorted so [7,8] and [8,7] are one value. It says nothing about the id TYPE
    // because it does not have to: `sort()` with no comparator compares string
    // forms, and `join` stringifies, so [7] and ["7"] already produce "7". A
    // `.map(String)` here was redundant — no assertion could tell it from its own
    // absence, which is how a mutation run says "delete me" (same as #70's second
    // clamp). Ids are mixed string/number across web and iOS (#411), so being
    // type-blind here is required, not incidental.
    const team = (Array.isArray(n.team) ? n.team : []).sort().join(",");
    out.push(`${n.id}|${n.start ?? ""}|${n.end ?? ""}|${n.startHour ?? ""}|${n.endHour ?? ""}|${team}`);
    for (const s of (Array.isArray(n.subs) ? n.subs : [])) walk(s);
  };
  walk(node);
  return out.join(";");
}

/**
 * Whether `after` places anything differently from `before`.
 *
 * A missing `before` reads as TRUE: an edit to something we cannot find is settled
 * rather than skipped, because the cost of settling once too often is a no-op and
 * the cost of skipping is a parent whose dates no longer match its children.
 */
export function movesSchedule(before, after) {
  if (!before || !after) return true;
  return scheduleSignature(before) !== scheduleSignature(after);
}
