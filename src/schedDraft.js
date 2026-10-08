// Scheduling a task from the Jobs grid in ONE save, not three (#456).
//
// The grid took a task to the schedule through START (save), END (save),
// ASSIGNEE (save) — the assignee cell refuses until dates exist, so the order is
// forced — and each save was a write to the shared file: three chances for a
// concurrent write or a stale tab to land between them, on the path a user is
// most likely to take. Drop in Schedule does the same thing in one save,
// `commitDates(node, { start, end, team })`, and that combined write is what the
// grid now uses too.
//
// RULED (2026-10-08):
//   1. SCOPE — only an UNSCHEDULED task being scheduled: a leaf with neither both
//      dates nor anybody on it. A single change to a placed task stays one
//      immediate save.
//   2. A HALF-FILLED DRAFT IS SAVED ON LEAVE. Dates typed and walked away from are
//      written (in one save), never thrown away silently — that would be #449's
//      failure wearing a different hat.
//
// The draft lives OUTSIDE the task tree, so a poll that replaces the tree does
// not erase it, and the autosave never sees a half-made placement.

const sid = (v) => (v == null ? "" : String(v));

/** A leaf task with neither both dates nor an assignee: the case that batches. */
export function isUnscheduledLeaf(node) {
  if (!node || (node.subs || []).length) return false;
  const dated = !!(node.start && node.end);
  const assigned = (node.team || []).filter(x => x != null).length > 0;
  return !dated && !assigned;
}

/** Whether a START/END edit on `node` is held in the draft rather than saved. */
export function holdsDateEdit(node, key) {
  return (key === "start" || key === "end") && isUnscheduledLeaf(node);
}

/** The draft after typing `val` into `key` on `node` (a new draft if `draft` is for another row). */
export function withDraftValue(draft, node, key, val) {
  const base = draft && sid(draft.id) === sid(node.id) ? draft : { id: node.id, start: node.start || "", end: node.end || "" };
  return { ...base, [key]: val || "" };
}

/** `item` as the row should show it: the draft's dates over the stored ones. */
export function overlayDraft(item, draft) {
  if (!item || !draft || sid(draft.id) !== sid(item.id)) return item;
  return { ...item, start: draft.start || item.start || "", end: draft.end || item.end || "" };
}

/** What leaving the row saves: the dates typed so far, or null when there are none. */
export function flushPatch(draft) {
  if (!draft) return null;
  const p = {};
  if (draft.start) p.start = draft.start;
  if (draft.end) p.end = draft.end;
  return Object.keys(p).length ? p : null;
}

/** The single write that schedules the task: both dates and who, together. */
export function completionPatch(draft, team) {
  if (!draft || !draft.start || !draft.end || !Array.isArray(team) || !team.length) return null;
  return { start: draft.start, end: draft.end, team: team.map(String) };
}
