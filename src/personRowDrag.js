// WHERE A DRAGGED PERSON ROW LANDS on the schedule, as a pure function (#144, #145).
//
// `over` is what the drag recorded under the pointer:
//   { type: "person", id, pos: "before" | "after" }  — beside another person's row
//   { type: "group", id }                            — on a group header
// Ids come from `data-rowid`, so they are ALWAYS strings, and people's ids are strings
// (uid()) or, on old seed data, numbers. They are compared as sameId compares, never with
// `Number()` — #144 was `Number(rid)` against string uids, which matched nobody, so every drop
// on a real roster did nothing.
//
// The schedule groups rows by `department`, so joining a group means taking its department
// (#145). It used to write `role`, which is a different field since #413: the person stayed
// where they were and their role was overwritten with a department name.
//
// Returns the SAME array when nothing should change, so a caller can tell.
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export function movePersonRow(people, draggedId, over) {
  const list = people || [];
  const dragged = list.find(p => sameId(p.id, draggedId));
  if (!dragged || !over) return list;
  if (over.type === "group") {
    return list.map(p => (p === dragged ? { ...p, department: over.id } : p));
  }
  if (over.type !== "person" || sameId(over.id, draggedId)) return list;
  const target = list.find(p => sameId(p.id, over.id));
  if (!target) return list;
  const moved = { ...dragged, department: target.department };
  const without = list.filter(p => p !== dragged);
  const tIdx = without.indexOf(target);
  const result = [...without];
  result.splice(over.pos === "before" ? tIdx : tIdx + 1, 0, moved);
  return result;
}
