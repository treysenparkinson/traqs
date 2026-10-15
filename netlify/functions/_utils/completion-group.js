// THE ONE "Completion Requests" GROUP, and who sits in it — shared by every path that raises a
// completion request (#296).
//
// The rule used to live in two places: timeclock.js (the phone's request) and the web client's
// ensureCompletionGroup. The client copy could not work for a worker. groups.js delivers only
// the groups the caller is a member of, so a worker raising their FIRST request saw no group of
// that name, created a second one, and their request went into it rather than the shared thread
// the approvers read. The server can see every group, so the rule is decided here and both
// paths ask it.
//
// Who keeps a seat: the approvers (`approverIds`), the person requesting now, and anyone who has
// already RAISED a request in this thread — they cannot approve, but must be able to see that
// what they sent arrived and how it was resolved. Anyone else is reconciled out, so an admin
// whose toggle was switched off stops receiving every request.
//
// Pure: takes the stored arrays, returns the new groups array, the group, and whether anything
// changed. Ids are kept as the roster holds them and compared as strings.
export const COMPLETION_GROUP_NAME = "Completion Requests";

export function reconcileCompletionGroup(groups, messages, { approverIds = [], requesterId = null, newId, at } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const seen = new Set();
  const want = [...approverIds, ...(requesterId != null ? [requesterId] : [])]
    .filter(id => id != null && !seen.has(String(id)) && seen.add(String(id)));
  let grp = list.find(g => g && g.name === COMPLETION_GROUP_NAME);
  if (!grp) {
    grp = { id: newId, name: COMPLETION_GROUP_NAME, memberIds: want, createdBy: requesterId, createdAt: at };
    return { groups: [...list, grp], grp, changed: true };
  }
  const senders = new Set(
    (Array.isArray(messages) ? messages : [])
      .filter(m => m && m.type === "finish_request" && m.threadKey === `group:${grp.id}` && m.authorId != null)
      .map(m => String(m.authorId))
  );
  const allowed = new Set([...want.map(String), ...senders]);
  const kept = (grp.memberIds || []).filter(m => allowed.has(String(m)));
  const missing = want.filter(id => !kept.some(m => String(m) === String(id)));
  if (!missing.length && kept.length === (grp.memberIds || []).length) return { groups: list, grp, changed: false };
  grp = { ...grp, memberIds: [...kept, ...missing] };
  return { groups: list.map(g => (g.id === grp.id ? grp : g)), grp, changed: true };
}
