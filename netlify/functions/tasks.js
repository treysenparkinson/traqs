import { validateToken } from "./_utils/auth.js";
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

  // GET — read tasks from S3 (no auth required for read)
  if (event.httpMethod === "GET") {
    try {
      const data = await readJson(s3Key);
      return json(200, data ?? []);
    } catch (e) {
      console.error("tasks GET error:", e);
      return err(500, "Failed to read tasks");
    }
  }

  // POST — write tasks to S3 (requires auth)
  if (event.httpMethod === "POST") {
    try {
      await validateToken(event);
    } catch (e) {
      return err(401, e.message);
    }
    try {
      const tasks = JSON.parse(event.body);
      await writeJson(s3Key, tasks);
      return json(200, { ok: true });
    } catch (e) {
      console.error("tasks POST error:", e);
      return err(500, "Failed to save tasks");
    }
  }

  return err(405, "Method not allowed");
}
