import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey } from "./_utils/org.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "clients.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  if (event.httpMethod === "GET") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = await readJson(s3Key);
      return json(200, data ?? []);
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

      // Refuse to overwrite a non-empty clients.json with an empty array.
      // See tasks.js for the incident this guards against.
      const force = event.queryStringParameters?.force === "1";
      if (clients.length === 0 && !force) {
        const existing = await readJson(s3Key);
        if (Array.isArray(existing) && existing.length > 0) {
          return err(409, "Refusing to overwrite non-empty clients with empty array");
        }
      }

      await writeJson(s3Key, clients);
      return json(200, { ok: true });
    } catch (e) {
      console.error("clients POST error:", e);
      return err(500, "Failed to save clients");
    }
  }

  return err(405, "Method not allowed");
}
