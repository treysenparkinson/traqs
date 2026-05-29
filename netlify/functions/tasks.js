import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

function getOrgKey(event, file) {
  const orgCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!orgCode || !/^[a-zA-Z0-9]{3,20}$/.test(orgCode)) return null;
  return `orgs/${orgCode}/${file}`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = getOrgKey(event, "tasks.json");
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
      await writeJson(s3Key, tasks);
      return json(200, { ok: true });
    } catch (e) {
      console.error("tasks POST error:", e);
      return err(500, "Failed to save tasks");
    }
  }

  return err(405, "Method not allowed");
}
