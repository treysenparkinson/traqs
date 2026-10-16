// #297 — WHO MAY CLEAR A CHAT THREAD. One rule, read by the server's
// DELETE /messages and by every control that offers "Clear Chat", so a button
// is never offered for a clear the server would refuse.
//
// Ruled 2026-10-16 (Trey):
//   group:  the group's creator, or an admin (unchanged; a group has a creator)
//   job: / panel: / op:  an admin only — these threads have no creator, so
//           "any participant" was the only rule they had, and any participant
//           could wipe a job's whole history
//   dm:     nobody. Neither participant can erase the other's side of it.
// Anything else is refused: a thread kind nobody has ruled on is not clearable.
//
// `groups` is the org's group list; a group is matched by id or by name, as the
// thread key may carry either (canViewThread does the same).
export function canClearThread(threadKey, { viewerId, isAdmin }, groups) {
  const key = String(threadKey || "");
  if (viewerId == null || viewerId === "") return false;
  if (key.startsWith("group:")) {
    const ref = key.slice(6);
    const g = (groups || []).find(x => x && (String(x.id) === ref || String(x.name) === ref));
    if (!g) return false;
    return !!isAdmin || (g.createdBy != null && String(g.createdBy) === String(viewerId));
  }
  if (key.startsWith("job:") || key.startsWith("panel:") || key.startsWith("op:")) return !!isAdmin;
  return false;
}
