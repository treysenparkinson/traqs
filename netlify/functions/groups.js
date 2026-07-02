import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey } from "./_utils/org.js";
import { stampArray, reconcileDeletions } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "groups.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — return groups for the named org (membership required, since
  // group names + member ids implicitly reveal the team structure).
  if (event.httpMethod === "GET") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = (await readJson(s3Key)) ?? [];
      // Hide soft-deleted (tombstoned) records from normal readers; /sync does
      // NOT filter these so delta-sync clients can evict the deleted row.
      return json(200, filterLive(data));
    } catch (e) {
      console.error("groups GET error:", e);
      return err(500, "Failed to read groups");
    }
  }

  // POST — save full groups array (member of the named org required).
  if (event.httpMethod === "POST") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }
    if (!Array.isArray(body)) return err(400, "Body must be an array");
    try {
      // Read the current version once. It serves double duty: the empty-overwrite
      // guard's reference below, AND the `previous` that stampArray diffs against
      // so unchanged groups keep their existing lastModifiedAt (only genuinely
      // changed groups get a fresh timestamp, which is what delta-sync relies on).
      const existing = await readJson(s3Key);

      // Refuse to overwrite a non-empty groups.json with an empty array.
      // See tasks.js for the incident this guards against.
      // Empty-array safeguard on the RAW incoming array (before reconciliation),
      // counting only NON-tombstoned records so leftover tombstones don't make a
      // legitimately-empty list get refused.
      const force = event.queryStringParameters?.force === "1";
      if (body.length === 0 && !force) {
        if (Array.isArray(existing) && existing.some(r => r && !r.deletedAt)) {
          return err(409, "Refusing to overwrite non-empty groups with empty array");
        }
      }
      // Tombstone client-side deletions (ids in `existing` missing from incoming)
      // so delta-sync propagates them instead of the record silently vanishing.
      const reconciled = reconcileDeletions(body, existing);
      await writeJson(s3Key, stampArray(reconciled, existing));
      return json(200, { ok: true });
    } catch (e) {
      console.error("groups POST error:", e);
      return err(500, "Failed to save groups");
    }
  }

  return err(405, "Method not allowed");
}
