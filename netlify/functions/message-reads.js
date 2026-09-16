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

  // POST — advance the viewer's read cursor(s). Monotonic: a cursor never moves
  // backwards. Two accepted shapes:
  //
  //   { threadKey, at? }                       one thread ("I'm reading this")
  //   { entries: [{ threadKey, at }, ...] }    many at once ("Mark all read")
  //
  // The batch form exists because this handler is a read-modify-WRITE of one
  // S3 object. "Mark all read" over N threads as N parallel single POSTs is a
  // lost-update race: each request reads the same `reads.json` and the last
  // write wins, so most of the cursors silently never persist — which is a
  // worse failure than not sending them at all, because the UI shows read.
  // One request, one write.
  //
  // `at` defaults to now. Threads the viewer can't see are SKIPPED rather than
  // failing the batch — one stale threadKey from a client's cache must not
  // throw away every other cursor in the request.
  if (event.httpMethod === "POST") {
    if (!viewerId) return json(200, { ok: true });   // nothing to record
    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON body"); }

    const nowISO = new Date().toISOString();
    const batch = Array.isArray(body?.entries);
    const requested = batch
      ? body.entries
          .map(e => ({
            threadKey: String(e?.threadKey || ""),
            at: (typeof e?.at === "string" && e.at) ? e.at : nowISO,
          }))
          .filter(e => e.threadKey)
      : [{
          threadKey: String(body?.threadKey || ""),
          at: (typeof body?.at === "string" && body.at) ? body.at : nowISO,
        }];

    if (!batch && !requested[0].threadKey) return err(400, "threadKey required");
    if (requested.length === 0) return json(200, { ok: true, advanced: [] });

    try {
      const [reads, jobs, groups] = await Promise.all([
        readJson(readsKey).then(v => v ?? {}),
        readJson(orgKey(event, "tasks.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "groups.json")).then(v => filterLive(v ?? [])),
      ]);

      // The single-thread form keeps its hard 403 — a client posting to a thread
      // it can't see is a bug worth surfacing. The batch form skips instead.
      if (!batch && !canViewThread(requested[0].threadKey, viewerId, jobs, groups)) {
        return err(403, "Not a participant in this thread");
      }

      const advanced = [];
      for (const { threadKey, at } of requested) {
        if (!canViewThread(threadKey, viewerId, jobs, groups)) continue;
        const cursors = reads[threadKey] || {};
        const prev = cursors[viewerId];
        // Only persist + signal when the cursor actually advances, so a device
        // that re-marks the same newest message every few seconds doesn't churn
        // S3 or spam the realtime channel.
        if (!prev || at > prev) {
          cursors[viewerId] = at;
          reads[threadKey] = cursors;
          advanced.push(threadKey);
        }
      }

      if (advanced.length) {
        await writeJson(readsKey, reads);
        await publishChange(orgCodeFromHeader(event), "reads", { ids: advanced });
      }

      if (batch) return json(200, { ok: true, advanced });
      const one = requested[0];
      return json(200, { ok: true, at: reads[one.threadKey]?.[viewerId] || one.at });
    } catch (e) {
      console.error("message-reads POST error:", e);
      return err(500, "Failed to save read receipt");
    }
  }

  return err(405, "Method not allowed");
}
