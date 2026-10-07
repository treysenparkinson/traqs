// The per-user preference blob is MERGED, not replaced (#441).
//
// It used to be `writeJson(key, stampObject(settings, existing))` — the body
// became the blob. Combined with a client that sent every key on every write and
// a fetch that ran once per session, that made any write from any tab a
// wholesale revert of every preference that tab had not seen change:
//
//     { upsert the theme } from a tab open since 09:00
//        also rewrote colOrder, colWidths, colLabels, hiddenCols, customTheme
//        with their 09:00 values
//
// The keys at risk were the expensive ones — a column layout is minutes of
// dragging and renaming; a theme toggle is one click. The cheap write destroyed
// the expensive state.
//
// MERGING IS SAFE HERE IN A WAY IT WOULD NOT BE FOR TASKS. `reconcileDeletions`
// had to become explicit (#339) because absence meant deletion, so a partial
// body read as a mass delete. A preference is only ever SET — never removed —
// so "not mentioned" can simply mean "leave it alone", and no envelope, version
// flag or delete list is needed.
//
// NOT 409-ON-STALE. A conditional write would be the stricter answer, but it
// puts a conflict dialog in front of someone who toggled a theme, which is worse
// than the bug it prevents.

/**
 * What to store: `incoming` laid over `existing`.
 *
 * A stored value that is missing, or is not a plain object, is treated as empty
 * — the first write of an account, and the defensive case where something else
 * wrote junk to the key. Neither input is mutated.
 */
export function mergePrefs(existing, incoming) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const patch = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  return { ...base, ...patch };
}

/**
 * Whether this write would leave the account with no preferences at all, when it
 * had some before.
 *
 * STRUCTURALLY UNREACHABLE UNDER `mergePrefs`, which can only add keys, so the
 * result is always a superset of what was stored. It is kept rather than deleted
 * for the same reason the tasks guard is (#339): it is the thing standing
 * between this endpoint and the 2026-06-03 shape, and a future change back to
 * replace semantics would need it immediately. Asked about the RESULT rather
 * than the request body, so it cannot be fooled by the shape of what arrived.
 */
export function wouldEmptyPrefs(result, existing) {
  const had = existing && typeof existing === "object" && !Array.isArray(existing)
    ? Object.keys(existing).filter(k => k !== "lastModifiedAt").length : 0;
  if (had === 0) return false;                 // nothing to protect
  const now = result && typeof result === "object" && !Array.isArray(result)
    ? Object.keys(result).filter(k => k !== "lastModifiedAt").length : 0;
  return now === 0;
}
