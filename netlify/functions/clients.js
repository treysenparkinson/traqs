import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { stampArray, reconcileDeletions, changedIds } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendSilentPush } from "./_utils/push.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "clients.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  if (event.httpMethod === "GET") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = await readJson(s3Key);
      // Hide soft-deleted (tombstoned) records from normal readers; /sync does
      // NOT filter these so delta-sync clients can evict the deleted row.
      return json(200, filterLive(data ?? []));
    } catch (e) {
      console.error("clients GET error:", e);
      return err(500, "Failed to read clients");
    }
  }

  if (event.httpMethod === "POST") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const clients = JSON.parse(event.body);
      if (!Array.isArray(clients)) return err(400, "Body must be an array");

      // Read the current version once. It serves double duty: the empty-overwrite
      // guard's reference below, AND the `previous` that stampArray diffs against
      // so unchanged clients keep their existing lastModifiedAt (only genuinely
      // changed clients get a fresh timestamp, which is what delta-sync relies on).
      const existing = await readJson(s3Key);

      // Refuse to overwrite a non-empty clients.json with an empty array.
      // See tasks.js for the incident this guards against.
      // Empty-array safeguard on the RAW incoming array (before reconciliation),
      // counting only NON-tombstoned records so leftover tombstones don't make a
      // legitimately-empty list get refused.
      const force = event.queryStringParameters?.force === "1";
      if (clients.length === 0 && !force) {
        if (Array.isArray(existing) && existing.some(r => r && !r.deletedAt)) {
          return err(409, "Refusing to overwrite non-empty clients with empty array");
        }
      }

      // Tombstone client-side deletions (ids in `existing` missing from incoming)
      // so delta-sync propagates them instead of the record silently vanishing.
      const reconciled = reconcileDeletions(clients, existing);
      await writeJson(s3Key, stampArray(reconciled, existing));
      await publishChange(orgCodeFromHeader(event), "clients", { ids: changedIds(reconciled, existing) });
      // Phase 5: silent background-sync push to org members (best-effort).
      await sendSilentPush(orgCodeFromHeader(event), { entity: "clients" });
      return json(200, { ok: true });
    } catch (e) {
      console.error("clients POST error:", e);
      return err(500, "Failed to save clients");
    }
  }

  return err(405, "Method not allowed");
}
