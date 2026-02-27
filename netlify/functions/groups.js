import { validateToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

function getOrgKey(event) {
  const orgCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!orgCode || !/^[a-zA-Z0-9]{3,20}$/.test(orgCode)) return null;
  return `orgs/${orgCode}/groups.json`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = getOrgKey(event);
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — return all groups (no auth required)
  if (event.httpMethod === "GET") {
    try {
      return json(200, (await readJson(s3Key)) ?? []);
    } catch (e) {
      console.error("groups GET error:", e);
      return err(500, "Failed to read groups");
    }
  }

  // POST — save full groups array (auth required)
  if (event.httpMethod === "POST") {
    try { await validateToken(event); } catch (e) { return err(401, e.message); }
    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }
    if (!Array.isArray(body)) return err(400, "Body must be an array");
    try {
      await writeJson(s3Key, body);
      return json(200, { ok: true });
    } catch (e) {
      console.error("groups POST error:", e);
      return err(500, "Failed to save groups");
    }
  }

  return err(405, "Method not allowed");
}
