import { validateToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

function getOrgKey(event) {
  const orgCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!orgCode || !/^[a-zA-Z0-9]{3,20}$/.test(orgCode)) return null;
  return `orgs/${orgCode}/settings.json`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = getOrgKey(event);
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — read org settings (no auth required)
  if (event.httpMethod === "GET") {
    try {
      const data = await readJson(s3Key);
      return json(200, data ?? {});
    } catch (e) {
      console.error("settings GET error:", e);
      return err(500, "Failed to read settings");
    }
  }

  // POST — write org settings (requires auth)
  if (event.httpMethod === "POST") {
    try {
      await validateToken(event);
    } catch (e) {
      return err(401, e.message);
    }
    try {
      const settings = JSON.parse(event.body);
      await writeJson(s3Key, settings);
      return json(200, { ok: true });
    } catch (e) {
      console.error("settings POST error:", e);
      return err(500, "Failed to save settings");
    }
  }

  return err(405, "Method not allowed");
}
