// Send the preferences that changed, not all of them (#441).
//
// THE BLOB WAS REPLACED WHOLESALE and read ONCE per session — `user-settings.js`
// did a plain `writeJson`, and the fetch runs on `[orgCode]` with no Ably
// subscription, no sync.js entry and no IndexedDB copy. The client then sent
// every key on every write. Those three facts together mean a tab holds its
// load-time copy of every preference for as long as it stays open, and writing
// ANY key writes back ALL of them:
//
//     09:00  tabs A and B both load the blob
//     15:00  widen a column in A   -> A writes all 8 keys from A's state
//     16:00  switch theme in B     -> B writes all 8 keys from B's 09:00 state
//            -> the column width is silently back to 09:00
//
// The stale window is THE LIFETIME OF THE OLDER TAB, not the 900ms debounce.
// Nothing errors, and the write that destroyed the edit was about a completely
// unrelated preference.
//
// This is #339's shape — send what changed, merge at the far end — and it is
// EASIER HERE. There, deletion was inferred from absence, so a partial body read
// as a mass delete and the protocol needed an explicit `{ upsert, delete }`
// envelope before it could be partial at all. A preference is only ever SET,
// never removed, so absence can safely mean "not mentioned" and a plain merge is
// enough.
//
// FALSE DIRTY IS SAFE, FALSE CLEAN IS NOT. `JSON.stringify` is key-order
// sensitive and React rebuilds these objects by spreading, so a value can
// occasionally serialise differently without having changed. That over-sends a
// few bytes. The reverse — treating a changed preference as clean — loses it
// silently, so the comparison is made in that direction deliberately.

/**
 * The keys of `next` that differ from `last`, or null when none do.
 *
 * `last` is the bundle as of the last write THE SERVER ACCEPTED. It starts null
 * and is only advanced on success, so the first write of a session — and the
 * one after any failure — carries everything. Same rule as `buildDelta`'s empty
 * ack: nothing known means nothing may be assumed unchanged.
 */
export function changedPrefs(next, last) {
  const from = next && typeof next === "object" ? next : {};
  if (!last || typeof last !== "object") return { ...from };
  const out = {};
  for (const k of Object.keys(from)) {
    if (JSON.stringify(from[k]) !== JSON.stringify(last[k])) out[k] = from[k];
  }
  return Object.keys(out).length ? out : null;
}
