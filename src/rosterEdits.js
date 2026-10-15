// WRITE WHAT WAS EDITED, ONTO THE ROSTER AS IT IS NOW (#150).
//
// The Time Clock Settings modal snapshotted every person on open, stayed open
// while an admin worked, and POSTed that snapshot entire. Everything written to
// people.json in between — a PTO approval, a phone registering a push token,
// another admin's edit — was erased by a copy of the roster that predated it.
// The window was as long as the modal was open.
//
// AND THE SERVER'S OWN PROTECTION EXEMPTS THE ONLY CALLER THAT GETS HERE.
// `people.js` pins `PROTECTED_PERSON_FIELDS` — `timeOff` among them — but only
// `if (!can(member, "manageTeam") && stored)`. Admins bypass it, and Time Clock
// Settings is admin-only. **The one caller that can reach the defect is the one
// caller the guard excuses.**
//
// THE EXEMPTION IS NOT THE BUG, and that was checked rather than assumed. Four
// admin paths deliberately write `timeOff` through this same roster POST: the
// schedule's PTO drag, the PTO context-menu cancel, the PTO edit modal, and the
// Person modal's linked-request reconciliation. Remove the exemption and all
// four stop working. It is protecting a capability that is used — so the fix
// belongs at the window, which is what this is.
//
// WHY A MERGE AND NOT A PARTIAL POST. `/people` takes a bare array and
// `reconcileDeletions` tombstones every id ABSENT from it, so sending only the
// changed rows is a mass delete. The roster that goes up must still be the
// whole roster; what changes is that it is the CURRENT one with the edits laid
// on top, instead of a stale one carrying everybody's old values.
//
// THIS NARROWS THE WINDOW, IT DOES NOT CLOSE IT. A write landing between the
// re-read and the POST is still lost. Closing it properly needs either a
// pin-capable PATCH (PATCH strips `pin` today, deliberately — "pin should only
// flow through dedicated admin paths", people.js) or the #339 delta envelope
// extended to people.js, which that entry deliberately did not do. Both are
// larger decisions than this defect. Going from minutes to one round trip is
// the available fix, and saying which it is beats implying it is the other.

/** The only fields the Time Clock Settings modal edits. */
export const SETTINGS_FIELDS = ["payType", "pin"];

/**
 * `current` with `fields` taken from `draft`, matched by id.
 *
 * The RESULT IS SHAPED BY `current`, never by the draft: same people, same
 * order, same count. A draft row for somebody since removed is ignored rather
 * than resurrecting them, and somebody added while the modal was open is
 * carried through untouched. Both matter because the array is the delete list.
 *
 * A field the draft does not carry (`undefined`) is one the modal never set,
 * not an instruction to clear it.
 *
 * Ids are compared as strings: they are mixed string/number across web, iOS and
 * the stored history, and a strict compare here would silently skip the edit.
 */
export function applyRosterEdits(current, draft, fields = SETTINGS_FIELDS) {
  const rows = Array.isArray(current) ? current : [];
  const edits = new Map(
    (Array.isArray(draft) ? draft : [])
      .filter((p) => p && p.id != null)
      .map((p) => [String(p.id), p]),
  );
  if (edits.size === 0) return rows;
  return rows.map((p) => {
    if (!p || p.id == null) return p;
    const d = edits.get(String(p.id));
    if (!d) return p;
    const patch = {};
    for (const k of fields) if (d[k] !== undefined && d[k] !== p[k]) patch[k] = d[k];
    return Object.keys(patch).length ? { ...p, ...patch } : p;
  });
}

/**
 * #150, ruled: CLOSING the window, not narrowing it. What the user changed, and nothing else —
 * the people whose listed `fields` differ between the snapshot the screen opened with (`base`)
 * and the `draft`, as `[{ id, fields: { name: value } }]`. A field cleared in the draft is sent as
 * null. The server applies these inside one conditional read-modify-write (POST
 * /people?action=fields), so no roster ever goes up and a concurrent PTO approval cannot be lost.
 */
export function fieldEdits(base, draft, fields) {
  const before = new Map((Array.isArray(base) ? base : []).filter(p => p && p.id != null).map(p => [String(p.id), p]));
  const out = [];
  for (const p of Array.isArray(draft) ? draft : []) {
    if (!p || p.id == null) continue;
    const was = before.get(String(p.id)) || {};
    const changed = {};
    for (const f of fields) {
      if (JSON.stringify(p[f] ?? null) !== JSON.stringify(was[f] ?? null)) changed[f] = p[f] ?? null;
    }
    if (Object.keys(changed).length) out.push({ id: p.id, fields: changed });
  }
  return out;
}

/** `people` with `fieldEdits` output laid on — what the server just applied, mirrored locally. */
export function applyFieldEdits(people, edits) {
  const byId = new Map((edits || []).map(e => [String(e.id), e.fields]));
  return (people || []).map(p => {
    const f = p && p.id != null ? byId.get(String(p.id)) : null;
    if (!f) return p;
    const np = { ...p };
    for (const [k, v] of Object.entries(f)) { if (v === null) delete np[k]; else np[k] = v; }
    return np;
  });
}

/** The fields each settings screen edits on a person — and nothing else is sent for them (#150). */
export const PERMISSION_FIELDS = ["adminPerms", "canSignOff", "userRole", "noAutoSchedule", "autoSchedule", "pin"];
