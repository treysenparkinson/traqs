import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey } from "./_utils/org.js";
import { stampArray } from "./_utils/timestamps.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "tasks.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — read tasks from S3. Requires the caller to be a member of the
  // org named in X-Org-Code; otherwise tasks (job titles, client refs,
  // notes) would be readable by anyone who guessed the org code.
  if (event.httpMethod === "GET") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = await readJson(s3Key);
      return json(200, data ?? []);
    } catch (e) {
      console.error("tasks GET error:", e);
      return err(500, "Failed to read tasks");
    }
  }

  // POST — write tasks to S3. Requires org membership: without this, an
  // authenticated user from org A could overwrite org B's tasks.json by
  // sending X-Org-Code: ORGB along with their valid (but unrelated) JWT.
  if (event.httpMethod === "POST") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const tasks = JSON.parse(event.body);
      if (!Array.isArray(tasks)) return err(400, "Invalid tasks data");

      // Read the current version once. It serves double duty: the empty-overwrite
      // guard's reference below, AND the `previous` that stampArray diffs against
      // so unchanged jobs keep their existing lastModifiedAt (only genuinely
      // changed jobs get a fresh timestamp, which is what delta-sync relies on).
      const existing = await readJson(s3Key);

      // Refuse to overwrite a non-empty tasks.json with an empty array.
      // Why: a client bug (failed initial fetch → React resets state → autosave fires)
      // wiped MTX2026TRAQS/tasks.json on 2026-06-03. This guard makes that race fatal
      // on the server instead of silently destroying data. To intentionally clear all
      // tasks, delete the S3 object directly or pass ?force=1.
      const force = event.queryStringParameters?.force === "1";
      if (tasks.length === 0 && !force) {
        if (Array.isArray(existing) && existing.length > 0) {
          return err(409, "Refusing to overwrite non-empty tasks with empty array");
        }
      }

      await writeJson(s3Key, stampArray(tasks, existing));
      return json(200, { ok: true });
    } catch (e) {
      console.error("tasks POST error:", e);
      return err(500, "Failed to save tasks");
    }
  }

  return err(405, "Method not allowed");
}
