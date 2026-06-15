import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey } from "./_utils/org.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "settings.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — read org settings. Requires membership: settings include
  // workday hours, break policy, payroll cadence — operational PII that
  // shouldn't be readable by anyone who guesses the org code.
  if (event.httpMethod === "GET") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = await readJson(s3Key);
      return json(200, data ?? {});
    } catch (e) {
      console.error("settings GET error:", e);
      return err(500, "Failed to read settings");
    }
  }

  // POST — write org settings. Admin only: settings include workday hours,
  // break policy and payroll cadence, so a non-admin member must not be able
  // to alter them (matches the role-change gate in people.js).
  if (event.httpMethod === "POST") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    if (!member.isAdmin) return err(403, "Only admins can change org settings");
    try {
      const settings = JSON.parse(event.body);
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
        return err(400, "Body must be an object");
      }
      // Refuse to overwrite a populated settings object with an empty one ({}).
      // See tasks.js for the incident this guards against.
      const force = event.queryStringParameters?.force === "1";
      if (Object.keys(settings).length === 0 && !force) {
        const existing = await readJson(s3Key);
        if (existing && typeof existing === "object" && !Array.isArray(existing) && Object.keys(existing).length > 0) {
          return err(409, "Refusing to overwrite non-empty settings with empty object");
        }
      }
      await writeJson(s3Key, settings);
      return json(200, { ok: true });
    } catch (e) {
      console.error("settings POST error:", e);
      return err(500, "Failed to save settings");
    }
  }

  return err(405, "Method not allowed");
}
