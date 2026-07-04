import { requireOrgMember, AuthError } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { canViewThread } from "./messages.js";

// ─── Read receipts ───────────────────────────────────────────────────────────
//
// Per-thread, per-person "read up to" cursors — the server-side counterpart of
// the client's local `threadReadAt`. A message the current user sent is shown
// as "Read" once another participant's cursor for that thread is >= the
// message's timestamp.
//
// Storage: orgs/{code}/reads.json
//   { [threadKey]: { [personId]: "<ISO read-up-to timestamp>" } }
//
// Access is gated by the SAME `canViewThread` ACL as messages, so a member can
// only see/advance cursors for threads they participate in.

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const readsKey = orgKey(event, "reads.json");
  if (!readsKey) return err(400, "Missing or invalid X-Org-Code header");

  // Auth + resolve the viewer to a personId in this org.
  let auth;
  try {
    auth = await requireOrgMember(event);
  } catch (e) {
    if (e instanceof AuthError) return err(e.statusCode, e.message);
    return err(401, e?.message || "Authentication failed");
  }
  const viewerId = auth.personId;

  // GET — the read-cursor map, filtered to threads the viewer can see.
  if (event.httpMethod === "GET") {
    if (!viewerId) return json(200, {});   // unknown viewer → nothing
    try {
      const [reads, jobs, groups] = await Promise.all([
        readJson(readsKey).then(v => v ?? {}),
        readJson(orgKey(event, "tasks.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "groups.json")).then(v => filterLive(v ?? [])),
      ]);
      const out = {};
      for (const [threadKey, cursors] of Object.entries(reads || {})) {
        if (canViewThread(threadKey, viewerId, jobs, groups)) out[threadKey] = cursors;
      }
      return json(200, out);
    } catch (e) {
      console.error("message-reads GET error:", e);
      return err(500, "Failed to read receipts");
    }
  }

  // POST { threadKey, at? } — advance the viewer's read cursor for a thread.
  // Monotonic: a cursor never moves backwards. `at` defaults to now.
  if (event.httpMethod === "POST") {
    if (!viewerId) return json(200, { ok: true });   // nothing to record
    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON body"); }
    const threadKey = String(body?.threadKey || "");
    if (!threadKey) return err(400, "threadKey required");
    const at = (typeof body?.at === "string" && body.at) ? body.at : new Date().toISOString();

    try {
      const [reads, jobs, groups] = await Promise.all([
        readJson(readsKey).then(v => v ?? {}),
        readJson(orgKey(event, "tasks.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "groups.json")).then(v => filterLive(v ?? [])),
      ]);
      if (!canViewThread(threadKey, viewerId, jobs, groups)) {
        return err(403, "Not a participant in this thread");
      }
      const cursors = reads[threadKey] || {};
      const prev = cursors[viewerId];
      // Only persist + signal when the cursor actually advances, so a device
      // that re-marks the same newest message every few seconds doesn't churn
      // S3 or spam the realtime channel.
      if (!prev || at > prev) {
        cursors[viewerId] = at;
        reads[threadKey] = cursors;
        await writeJson(readsKey, reads);
        await publishChange(orgCodeFromHeader(event), "reads", { ids: [threadKey] });
      }
      return json(200, { ok: true, at: reads[threadKey]?.[viewerId] || at });
    } catch (e) {
      console.error("message-reads POST error:", e);
      return err(500, "Failed to save read receipt");
    }
  }

  return err(405, "Method not allowed");
}
